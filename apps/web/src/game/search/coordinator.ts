import {
  DEFAULT_EXPLORATION_C, DEFAULT_ITERATIONS, DEFAULT_ROLLOUT_COMMAND_CAP, GreedyAgent, type Agent,
} from '@fftcg/ai'
import { actingPlayer, legalCommands, viewFor, type Command, type GameState } from '@fftcg/engine'
import { AI } from '../types.js'
import {
  describeFailure,
  type WorkerRequestMessage, type WorkerResponseMessage,
} from './protocol.js'

/**
 * The layer between React and the worker (spec D2 layer 3). Every race in the rung lives here — stale replies,
 * seed allocation, the pacing deadline, worker death and the `GreedyAgent` fallback — precisely so each one is
 * a unit test rather than a matter of React timing folklore.
 *
 * `useGame` keeps its existing shape: capture a state, ask for a command, re-check legality against that exact
 * state, narrate, commit.
 */

// ---------------------------------------------------------------------------
// Seams (so the tests need no real Worker and no real clock)
// ---------------------------------------------------------------------------

export interface SearchTransport {
  post(message: WorkerRequestMessage): void
  terminate(): void
}

export interface TransportHandlers {
  message(message: WorkerResponseMessage): void
  /** An uncorrelated failure — `error`, `messageerror`. There is no `requestId` to attach to either. */
  failure(text: string): void
}

export type SearchTransportFactory = (handlers: TransportHandlers) => SearchTransport

export interface Clock {
  now(): number
  /** Schedules `fn` and returns its canceller — a closure rather than a handle, so no timer type leaks out. */
  after(ms: number, fn: () => void): () => void
}

export const realClock: Clock = {
  now: () => performance.now(),
  after: (ms, fn) => {
    const timer = setTimeout(fn, ms)
    return () => clearTimeout(timer)
  },
}

/**
 * Vite's supported static form — the URL must be a literal or the worker chunk is not emitted at all. Every
 * listener is installed BEFORE the coordinator posts anything, so a module-load failure cannot arrive
 * unobserved while the first request is already in flight.
 */
export const workerTransport: SearchTransportFactory = (handlers) => {
  if (typeof Worker === 'undefined') throw new Error('this browser does not support Web Workers')
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  worker.addEventListener('message', (e: MessageEvent<WorkerResponseMessage>) => handlers.message(e.data))
  worker.addEventListener('error', (e) => handlers.failure(e.message || 'the search worker failed to load'))
  worker.addEventListener('messageerror', () => handlers.failure('the search worker sent a message that could not be read'))
  return { post: (m) => worker.postMessage(m), terminate: () => worker.terminate() }
}

// ---------------------------------------------------------------------------
// Seeds (spec D2-3)
// ---------------------------------------------------------------------------

/**
 * The search seed for the n-th COMMITTED AI decision of a game. Derived from the position rather than the
 * request, so StrictMode's double-invoke, a retry, a superseded request and a replaced worker all re-ask the
 * same question and get the same answer. A seed advanced when a request is *posted* makes development and
 * production choose different moves from the same board — which reads as a search bug and is not one.
 *
 * The avalanche is there so consecutive decisions do not start near-identical streams; `searchIsmcts` splits
 * this one number into its three streams itself (spec D-8).
 */
export function searchSeed(gameSeed: number, decisionIndex: number): number {
  let h = (gameSeed ^ Math.imul(decisionIndex + 1, 0x9e3779b1)) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0
  return (h ^ (h >>> 16)) >>> 0
}

// ---------------------------------------------------------------------------
// Coordinator
// ---------------------------------------------------------------------------

export interface SearchRequestHandlers {
  /**
   * The chosen command, with the exact state it was chosen for. **Return `true` only if it was committed** —
   * the per-position seed advances on that and nothing else (D2-3), so a rejected or dropped command must
   * report `false` or the next search of the same position asks a different question.
   */
  onCommand(command: Command, forState: GameState): boolean
  /** At most one per game (D2-6): the worker is gone and Greedy has taken over for good. */
  onWarning(text: string): void
}

export interface SearchCoordinatorOptions {
  readonly decks: readonly [readonly string[], readonly string[]]
  /** The game's own seed. With the committed-decision index this is the whole of a search seed (D2-3). */
  readonly gameSeed: number
  /** `stateRef.current`. The fourth acceptance condition is identity against this, so it must be the live ref. */
  readonly readState: () => GameState
  /** The pacing DEADLINE from the moment a request is posted — `AI_STEP_MS`, never an added delay (D2-5). */
  readonly stepMs: number
  readonly iterations?: number | undefined
  readonly rolloutCommandCap?: number | undefined
  readonly explorationC?: number | undefined
  /** Longer than a normal reply: a fresh worker also has to fetch and evaluate its module chunk. */
  readonly startupWatchdogMs?: number | undefined
  readonly watchdogMs?: number | undefined
  readonly createTransport?: SearchTransportFactory | undefined
  readonly clock?: Clock | undefined
}

export const DEFAULT_STARTUP_WATCHDOG_MS = 10_000
export const DEFAULT_WATCHDOG_MS = 5_000

export const FALLBACK_WARNING =
  'The background search stopped working, so the AI is playing its faster, weaker opponent for the rest of this game'

/** One request's claim on the caller: which state it was asked for, and when its answer may be shown. */
interface Target {
  readonly state: GameState
  readonly handlers: SearchRequestHandlers
  /** `startedAt + stepMs`. A fast search still waits this out; a slow one applies the moment it lands (D2-5). */
  readonly notBefore: number
}

/** How far the delivery escalation has already fallen. See `deliver`. */
type Stage = 'primary' | 'lastResort'

interface Outstanding extends Target {
  readonly requestId: number
  readonly cancelWatchdog: () => void
}

export class SearchCoordinator {
  private readonly opts: SearchCoordinatorOptions
  private readonly clock: Clock
  private readonly createTransport: SearchTransportFactory

  private transport: SearchTransport | null = null
  private initialised = false
  /**
   * Set once the current transport has proved it is alive by answering anything at all. `starting` — "there
   * was no transport before this request" — is not the same question: a request superseded before the worker
   * ever replied would hand its replacement the SHORT watchdog while the module was still being fetched and
   * evaluated, and condemn a worker that was merely slow to boot.
   */
  private responded = false
  private disposed = false
  /** Permanent for this game (D2-6): a worker that failed once is not retried mid-game. */
  private fallback = false
  private warned = false
  private failureReason = ''

  private nextRequestId = 0
  /** Advances ONLY on a committed AI command. Never on a post, a retry or a worker replacement. */
  private decisionIndex = 0

  private active: Outstanding | null = null
  private delivery: { readonly cancel: () => void; readonly target: Target } | null = null
  private greedy: Agent | null = null
  /**
   * The turn `request()` is currently setting up, live from BEFORE the transport is built until `active` is
   * assigned. A transport that reports failure synchronously — by calling `failure()` rather than throwing —
   * would otherwise reach `fail()` with `active`, `delivery` and the explicit target all null, be recorded as
   * a permanent fallback, and schedule nothing. Native `Worker` dispatches errors asynchronously so no
   * production transport does this, but the seam does not require that and the hole should not depend on it.
   */
  private pendingTarget: Target | null = null
  /**
   * Handlers to warn through when a failure arrives with no turn to rescue. Warning only through a live
   * target means a failure that lands after the last AI decision of the game — or while the human is
   * conceding — is never shown at all, which is the silent degradation D2-6 forbids.
   */
  private warnSink: SearchRequestHandlers | null = null

  constructor(opts: SearchCoordinatorOptions) {
    this.opts = opts
    this.clock = opts.clock ?? realClock
    this.createTransport = opts.createTransport ?? workerTransport
  }

  /** True once the worker has been given up on — the caller can say so in its status line. */
  get usingFallback(): boolean {
    return this.fallback
  }

  /** The seed the NEXT request for the current position will carry. Exposed so the races can be asserted. */
  get nextSeed(): number {
    return searchSeed(this.opts.gameSeed, this.decisionIndex)
  }

  /**
   * Ask for the AI's command in `state`. Supersedes anything outstanding: the reply to the old request is
   * dropped by id, not waited for.
   */
  request(state: GameState, handlers: SearchRequestHandlers): void {
    if (this.disposed) return
    this.invalidate()
    this.emitWarning(handlers)

    const notBefore = this.clock.now() + this.opts.stepMs
    const target: Target = { state, handlers, notBefore }
    this.warnSink = handlers
    if (this.fallback) {
      this.scheduleGreedy(target)
      return
    }
    // Live from here until `active` is assigned, so a synchronous transport failure has a turn to recover.
    this.pendingTarget = target
    try {
      this.post(target)
    } finally {
      this.pendingTarget = null
    }
  }

  /** The part of `request()` that can fail. Split out so `pendingTarget` is always released. */
  private post(target: Target): void {
    const { state, handlers, notBefore } = target

    let transport = this.transport
    if (!transport) {
      try {
        transport = this.createTransport({
          message: (m) => this.onMessage(m),
          failure: (text) => this.onFailure(text),
        })
      } catch (e) {
        // Missing `Worker`, or a constructor that threw. Nothing was posted, so nothing is outstanding.
        this.fail(describeFailure(e), { state, handlers, notBefore })
        return
      }
      this.transport = transport
      // A factory that reported failure synchronously (by calling `failure()` rather than throwing) has
      // already been given up on and has already had a recovery scheduled from `pendingTarget`. Posting to it
      // would be posting to a transport we just terminated.
      if (this.fallback) return
    }

    const requestId = ++this.nextRequestId
    try {
      if (!this.initialised) {
        transport.post({
          type: 'init',
          decks: this.opts.decks,
          rolloutCommandCap: this.opts.rolloutCommandCap ?? DEFAULT_ROLLOUT_COMMAND_CAP,
          explorationC: this.opts.explorationC ?? DEFAULT_EXPLORATION_C,
        })
        this.initialised = true
      }
      transport.post({
        type: 'search',
        requestId,
        view: viewFor(state, AI),
        seed: this.nextSeed,
        iterations: this.opts.iterations ?? DEFAULT_ITERATIONS,
      })
    } catch (e) {
      // `postMessage` throws synchronously when the payload will not structured-clone.
      this.fail(describeFailure(e), { state, handlers, notBefore })
      return
    }
    // A transport whose failure handler fired synchronously inside `post` has already been given up on; arming
    // a watchdog for it would raise a second failure against a request nobody is waiting for.
    if (this.fallback) return

    // A worker that is killed or simply hangs produces no correlated event at all, so the only way to notice
    // it is a deadline (D2-6).
    const timeout = this.responded
      ? this.opts.watchdogMs ?? DEFAULT_WATCHDOG_MS
      : this.opts.startupWatchdogMs ?? DEFAULT_STARTUP_WATCHDOG_MS
    const cancelWatchdog = this.clock.after(timeout, () => {
      const outstanding = this.active
      if (!outstanding || outstanding.requestId !== requestId) return
      this.fail('the search worker did not respond', outstanding)
    })
    this.active = { requestId, state, handlers, notBefore, cancelWatchdog }
  }

  /**
   * Synchronously drop whatever is outstanding. Called on every restart, every external commit (including a
   * human `choose()` — **concede is legal even when the human is not the acting player**, so it really can
   * commit mid-AI-turn) and on effect cleanup.
   */
  invalidate(): void {
    if (this.active) {
      this.active.cancelWatchdog()
      this.active = null
    }
    if (this.delivery) {
      this.delivery.cancel()
      this.delivery = null
    }
  }

  /** Unmount: invalidate, then terminate. A worker outliving its hook is a leak and a source of stale replies. */
  dispose(): void {
    this.invalidate()
    this.disposed = true
    this.killTransport()
  }

  // -------------------------------------------------------------------------

  private onMessage(message: WorkerResponseMessage): void {
    if (this.disposed) return
    // Anything at all, even an error, proves the module loaded and is running: from here the short watchdog
    // is the right deadline for this transport.
    this.responded = true
    if (message.type === 'error') {
      const outstanding = this.active
      // A typed error means the search itself threw, so the worker is no more use for this game whether or
      // not the error correlates with what is currently outstanding.
      this.fail(message.message, outstanding && (message.requestId === null || message.requestId === outstanding.requestId) ? outstanding : null)
      return
    }
    const outstanding = this.active
    // The four-condition acceptance rule (D2-4). `readState()` identity is the one that catches a reply that
    // raced a commit the coordinator was never told about.
    if (!outstanding) return
    if (outstanding.requestId !== message.requestId) return
    // A reply that raced a commit the coordinator was never told about is correctly DROPPED — but dropping it
    // must also release the request, or the watchdog later fires on a worker that answered perfectly well and
    // condemns the rest of the game to Greedy with a warning that says the search "stopped working".
    if (this.opts.readState() !== outstanding.state || actingPlayer(outstanding.state) !== AI) {
      outstanding.cancelWatchdog()
      this.active = null
      return
    }

    // Clear the active id BEFORE applying, so anything the commit re-enters cannot see this request as live.
    outstanding.cancelWatchdog()
    this.active = null
    const command = message.result.command
    this.schedule(outstanding, () => command)
  }

  /** `error` / `messageerror` from the transport: uncorrelated by nature, so it is attributed to what is live. */
  private onFailure(text: string): void {
    if (this.disposed) return
    this.fail(text, this.active)
  }

  /**
   * The single funnel for every way the worker can fail (D2-6): invalidate, terminate, switch to Greedy for
   * the rest of the game, warn ONCE, and still produce a command under the same pacing deadline.
   */
  private fail(text: string, target: Target | null): void {
    // A SECOND failure while a fallback move is already scheduled must not touch it. `invalidate()` would
    // cancel the very Greedy command the first failure queued, and nothing would ever reschedule it.
    if (this.fallback && this.delivery) return

    // Capture the recovery target BEFORE `invalidate()`, which clears `active` AND cancels any pending
    // delivery — the two places a live turn can be hiding when the error does not correlate with what is
    // outstanding. Returning early instead left the AI stalled forever with the spinner up and nothing in the
    // log: the silent degradation D2-6 exists to forbid, inverted into a silent hang.
    const recover = target ?? this.active ?? this.delivery?.target ?? this.pendingTarget ?? null
    this.invalidate()
    if (!this.fallback) this.failureReason = text
    this.fallback = true
    this.killTransport()
    // Warn even when there is no turn to rescue. Deferring the warning to "the next request" loses it
    // entirely when there is no next request — the game just ended, or the human is conceding.
    const handlers = recover?.handlers ?? this.warnSink
    if (handlers) this.emitWarning(handlers)
    if (recover) this.scheduleGreedy(recover)
  }

  private killTransport(): void {
    if (!this.transport) return
    this.transport.terminate()
    this.transport = null
    this.initialised = false
    this.responded = false
  }

  private emitWarning(handlers: SearchRequestHandlers): void {
    if (!this.fallback || this.warned) return
    this.warned = true
    handlers.onWarning(`${FALLBACK_WARNING} (${this.failureReason})`)
  }

  private scheduleGreedy(target: Target): void {
    this.schedule(target, () => {
      const agent = (this.greedy ??= new GreedyAgent({
        seed: this.opts.gameSeed,
        decks: [[...this.opts.decks[0]], [...this.opts.decks[1]]],
        depth: 1,
      }))
      const legal = agent.needsLegalCommands === false ? [] : legalCommands(target.state, AI)
      return agent.decide(viewFor(target.state, AI), legal)
    })
  }

  /** D2-5: the deadline is `startedAt + stepMs`, so a 750 ms search applies at once — never 750 + 600. */
  private schedule(target: Target, produce: () => Command, stage: Stage = 'primary'): void {
    const cancel = this.clock.after(Math.max(0, target.notBefore - this.clock.now()), () => {
      this.delivery = null
      if (this.disposed) return
      // Re-checked here and not only at acceptance: the wait is itself a window in which a concede can land.
      if (this.opts.readState() !== target.state) return
      if (actingPlayer(target.state) !== AI) return
      this.deliver(target, produce, stage)
    })
    this.delivery = { cancel, target }
  }

  /**
   * Produce a command and hand it over — and treat BOTH ways this can fail as something to recover from
   * rather than a place to stop.
   *
   * Neither was handled before, and both ended identically: `delivery` is already cleared, no move is
   * scheduled, and the caller's state never changes — so the state-keyed effect that would re-request never
   * reruns. Permanent spinner, empty log. That is the same silent hang the failure funnel was repaired for,
   * reached through the one path that funnel does not cover.
   *
   * - `produce()` THROWS. Not hypothetical: `GreedyAgent` throws by design when it cannot decide (the
   *   deliberate "fail loudly" policy of 5e82a7e), so the *fallback itself* could kill the game.
   * - `onCommand` RETURNS FALSE, rejecting the command as illegal for the captured state.
   *
   * `stage` bounds the escalation — worker → Greedy → last resort → loud stop — so a recovery that is itself
   * rejected cannot recurse. It is carried through `schedule` rather than held in a field because the field
   * would have to survive an async gap it does not span.
   */
  private deliver(target: Target, produce: () => Command, stage: Stage): void {
    // Advance BEFORE the handler runs, and roll back if it rejects: a handler that commits and re-requests
    // synchronously would otherwise reuse this decision's seed for the next position (D2-3).
    const at = this.decisionIndex
    this.decisionIndex++
    let command: Command
    try {
      command = produce()
    } catch (e) {
      this.decisionIndex = at
      this.recover(target, `the AI could not choose a move (${describeFailure(e)})`, stage)
      return
    }
    let accepted = false
    try {
      accepted = target.handlers.onCommand(command, target.state)
    } catch (e) {
      this.decisionIndex = at
      this.recover(target, `the AI's move was refused (${describeFailure(e)})`, stage)
      return
    }
    if (!accepted) {
      this.decisionIndex = at
      this.recover(target, 'the AI proposed a move that was not legal', stage)
    }
  }

  /**
   * A command could not be produced or could not be committed. Fall to the next rung and try again for the
   * SAME turn, so the game always moves.
   */
  private recover(target: Target, text: string, stage: Stage): void {
    // The floor already failed. Stop — but stop where the player can see it, because a spinner that never
    // resolves is the one outcome this whole funnel exists to prevent.
    if (stage === 'lastResort') return this.emitStop(target, text)
    // Still trusting the worker: demote to Greedy for the rest of the game exactly as a transport failure
    // would, and let it answer this same turn.
    if (!this.fallback) return this.fail(text, target)
    // Greedy is what just failed, so there is no stronger agent left to ask. Play a legal move.
    this.scheduleLastResort(target, text)
  }

  /**
   * The floor. Pick a legal command directly, preferring the least committal one.
   *
   * `concede` is deliberately last: it is legal in every position and sorts FIRST out of `legalCommands`, so
   * "just take the first legal command" would quietly throw the game away — a silent loss being precisely as
   * bad as the silent hang.
   */
  private scheduleLastResort(target: Target, text: string): void {
    const legal = legalCommands(target.state, AI)
    const pick = legal.find((c) => c.type === 'pass') ?? legal.find((c) => c.type !== 'concede') ?? legal[0]
    if (!pick) return this.emitStop(target, text)
    this.schedule(target, () => pick, 'lastResort')
  }

  /** Tell the player the AI has stopped, rather than leaving them watching a spinner forever. */
  private emitStop(target: Target, text: string): void {
    target.handlers.onWarning(`The AI could not make a move and has stopped (${text})`)
  }
}
