import { describe, expect, it } from 'vitest'
import { apply, createGame, legalCommands, viewFor, type Command, type GameState, type PlayerId } from '@fftcg/engine'
import { GreedyAgent, type SearchDiagnostics, type SearchResult } from '@fftcg/ai'
import { CARD_DEFS, DECKS } from '../src/deck.js'
import { AI, HUMAN } from '../src/game/types.js'
import type { WorkerRequestMessage, WorkerResponseMessage, WorkerSearchRequest } from '../src/game/search/protocol.js'
import {
  FALLBACK_WARNING, SearchCoordinator, searchSeed, workerTransport,
  type Clock, type SearchRequestHandlers, type SearchTransport, type SearchTransportFactory, type TransportHandlers,
} from '../src/game/search/coordinator.js'

const GAME_SEED = 4242
const STEP_MS = 600
const WATCHDOG_MS = 5_000
const STARTUP_WATCHDOG_MS = 10_000

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const actorOf = (state: GameState): PlayerId | null => (state.result ? null : (state.pending?.player ?? state.priority))

/** Fast-forward a real game to a position the AI actually owns — the only kind the coordinator may be asked for. */
function aiToAct(seed: number): GameState {
  let state: GameState = createGame({ seed, decks: DECKS, defs: CARD_DEFS })
  const agent = new GreedyAgent({ seed, decks: DECKS, depth: 1 })
  for (let i = 0; i < 400; i++) {
    const p = actorOf(state)
    if (p === null) break
    if (p === AI) return state
    state = apply(state, agent.decide(viewFor(state, p), legalCommands(state, p))).state
  }
  throw new Error(`seed ${seed} never reached an AI decision`)
}

function humanToAct(seed: number): GameState {
  let state: GameState = createGame({ seed, decks: DECKS, defs: CARD_DEFS })
  const agent = new GreedyAgent({ seed, decks: DECKS, depth: 1 })
  for (let i = 0; i < 400; i++) {
    const p = actorOf(state)
    if (p === null) break
    if (p === HUMAN) return state
    state = apply(state, agent.decide(viewFor(state, p), legalCommands(state, p))).state
  }
  throw new Error(`seed ${seed} never reached a human decision`)
}

const EMPTY_DIAGNOSTICS: SearchDiagnostics = {
  determinisations: 1, treeApplies: 1, rolloutApplies: 1, evaluations: 1, nodes: 1, maxCommandDepth: 1, rootChildren: [],
}

/** A worker reply for `state`, carrying a command that really is legal there so nothing downstream is faked. */
function resultFor(state: GameState, requestId: number): WorkerResponseMessage {
  const command = legalCommands(state, AI)[0]
  if (!command) throw new Error('no legal AI command')
  const result: SearchResult = { command, diagnostics: EMPTY_DIAGNOSTICS }
  return { type: 'result', requestId, result }
}

class FakeClock implements Clock {
  private t = 0
  private seq = 0
  private readonly timers = new Map<number, { at: number; fn: () => void }>()

  now(): number { return this.t }

  after(ms: number, fn: () => void): () => void {
    const id = ++this.seq
    this.timers.set(id, { at: this.t + ms, fn })
    return () => { this.timers.delete(id) }
  }

  get armed(): number { return this.timers.size }

  advance(ms: number): void {
    const target = this.t + ms
    for (;;) {
      let pickId = -1
      let pickAt = Number.POSITIVE_INFINITY
      for (const [id, timer] of this.timers) {
        if (timer.at <= target && (timer.at < pickAt || (timer.at === pickAt && id < pickId))) { pickAt = timer.at; pickId = id }
      }
      const timer = pickId < 0 ? undefined : this.timers.get(pickId)
      if (!timer) break
      this.timers.delete(pickId)
      this.t = timer.at
      timer.fn()
    }
    this.t = target
  }
}

class FakeTransport implements SearchTransport {
  readonly sent: WorkerRequestMessage[] = []
  terminations = 0
  postThrows: string | null = null
  constructor(readonly handlers: TransportHandlers) {}

  post(message: WorkerRequestMessage): void {
    if (this.postThrows !== null) throw new DOMException(this.postThrows, 'DataCloneError')
    this.sent.push(message)
  }

  terminate(): void { this.terminations++ }

  get searches(): WorkerSearchRequest[] {
    return this.sent.filter((m): m is WorkerSearchRequest => m.type === 'search')
  }
}

interface Harness {
  readonly clock: FakeClock
  readonly coordinator: SearchCoordinator
  readonly transports: FakeTransport[]
  readonly delivered: { command: Command; state: GameState }[]
  readonly warnings: string[]
  readonly handlers: SearchRequestHandlers
  readonly transport: () => FakeTransport
  readState(): GameState
  setState(state: GameState): void
  setCommit(v: boolean): void
  setCommitThrows(message: string | null): void
}

function harness(opts: { seed?: number; factory?: SearchTransportFactory; onCreate?: (t: FakeTransport) => void } = {}): Harness {
  const clock = new FakeClock()
  const transports: FakeTransport[] = []
  const delivered: { command: Command; state: GameState }[] = []
  const warnings: string[] = []
  let current = aiToAct(opts.seed ?? 11)
  let commits = true
  let commitThrows: string | null = null

  const handlers: SearchRequestHandlers = {
    onCommand: (command, forState) => {
      delivered.push({ command, state: forState })
      if (commitThrows !== null) throw new Error(commitThrows)
      return commits
    },
    onWarning: (text) => { warnings.push(text) },
  }
  const factory: SearchTransportFactory = opts.factory ?? ((h) => {
    const t = new FakeTransport(h)
    transports.push(t)
    opts.onCreate?.(t)
    return t
  })
  const coordinator = new SearchCoordinator({
    decks: DECKS,
    gameSeed: GAME_SEED,
    readState: () => current,
    stepMs: STEP_MS,
    iterations: 25,
    rolloutCommandCap: 8,
    explorationC: 1,
    watchdogMs: WATCHDOG_MS,
    startupWatchdogMs: STARTUP_WATCHDOG_MS,
    createTransport: factory,
    clock,
  })
  return {
    clock, coordinator, transports, delivered, warnings, handlers,
    transport: () => { const t = transports[0]; if (!t) throw new Error('no transport was created'); return t },
    readState: () => current,
    setState: (s) => { current = s },
    setCommit: (v) => { commits = v },
    setCommitThrows: (m) => { commitThrows = m },
  }
}

/** The whole point of the fallback: whatever went wrong, a command still arrives on the same deadline. */
function expectOneWarningAndACommand(h: Harness): void {
  expect(h.delivered).toHaveLength(0)
  h.clock.advance(STEP_MS)
  expect(h.delivered).toHaveLength(1)
  expect(h.warnings).toHaveLength(1)
  expect(h.warnings[0]).toContain(FALLBACK_WARNING)
  expect(h.coordinator.usingFallback).toBe(true)
  const only = h.delivered[0]
  if (!only) throw new Error('unreachable')
  expect(legalCommands(only.state, AI).some((c) => c.type === only.command.type)).toBe(true)
}

// ---------------------------------------------------------------------------

describe('searchSeed (D2-3)', () => {
  it('is a pure function of (gameSeed, decisionIndex)', () => {
    expect(searchSeed(7, 3)).toBe(searchSeed(7, 3))
    expect(searchSeed(7, 3)).not.toBe(searchSeed(7, 4))
    expect(searchSeed(7, 3)).not.toBe(searchSeed(8, 3))
  })

  it('stays a non-negative 32-bit integer', () => {
    for (const [seed, index] of [[0, 0], [-1, 5], [2_147_483_646, 199], [Date.now() % 2_147_483_647, 12]] as const) {
      const s = searchSeed(seed, index)
      expect(Number.isSafeInteger(s)).toBe(true)
      expect(s).toBeGreaterThanOrEqual(0)
      expect(s).toBeLessThanOrEqual(0xffff_ffff)
    }
  })
})

describe('SearchCoordinator: seeds are per POSITION (D2-3)', () => {
  it('asks the same position twice with the same seed', () => {
    const h = harness()
    h.coordinator.request(h.readState(), h.handlers)
    // StrictMode's cleanup+setup, a retry and a superseded request all look like this.
    h.coordinator.invalidate()
    h.coordinator.request(h.readState(), h.handlers)

    const searches = h.transport().searches
    expect(searches).toHaveLength(2)
    expect(searches[0]?.seed).toBe(searches[1]?.seed)
    expect(searches[0]?.seed).toBe(searchSeed(GAME_SEED, 0))
    // The correlation ids must still differ, or a stale reply could not be told apart.
    expect(searches[0]?.requestId).not.toBe(searches[1]?.requestId)
  })

  it('posts init exactly once, ahead of the first search', () => {
    const h = harness()
    h.coordinator.request(h.readState(), h.handlers)
    h.coordinator.invalidate()
    h.coordinator.request(h.readState(), h.handlers)
    const t = h.transport()
    expect(t.sent.filter((m) => m.type === 'init')).toHaveLength(1)
    expect(t.sent[0]?.type).toBe('init')
    const init = t.sent[0]
    if (init?.type !== 'init') throw new Error('unreachable')
    expect(init.rolloutCommandCap).toBe(8)
    expect(init.explorationC).toBe(1)
    expect(init.decks).toBe(DECKS)
  })

  it('advances the seed only when a command actually commits', () => {
    const h = harness()
    const first = h.readState()
    h.coordinator.request(first, h.handlers)
    const t = h.transport()
    expect(t.searches[0]?.seed).toBe(searchSeed(GAME_SEED, 0))

    // A delivered-but-rejected command must NOT consume the position's seed — not through any rung of the
    // escalation a rejection now triggers (worker → Greedy → last resort), each of which delivers in turn.
    // Read the seed off the coordinator rather than off a second posted search: a rejection also demotes the
    // worker permanently, so there is no second search to read it from.
    h.setCommit(false)
    t.handlers.message(resultFor(first, t.searches[0]?.requestId ?? 0))
    h.clock.advance(STEP_MS)
    expect(h.delivered.length).toBeGreaterThanOrEqual(1)
    expect(h.coordinator.nextSeed).toBe(searchSeed(GAME_SEED, 0))

    // Now let one commit, and the next position becomes a different question.
    h.setCommit(true)
    h.coordinator.request(first, h.handlers)
    h.clock.advance(STEP_MS)
    expect(h.coordinator.nextSeed).toBe(searchSeed(GAME_SEED, 1))
    expect(h.coordinator.nextSeed).not.toBe(searchSeed(GAME_SEED, 0))
  })

  // The worker is trusted until it is not: one rejected command demotes it for the rest of the game, the same
  // way a transport error does. Otherwise a search that keeps proposing illegal commands is asked forever.
  it('demotes the worker permanently when it proposes a command that will not commit', () => {
    const h = harness()
    const first = h.readState()
    h.coordinator.request(first, h.handlers)
    const t = h.transport()
    h.setCommit(false)
    t.handlers.message(resultFor(first, t.searches[0]?.requestId ?? 0))
    h.clock.advance(STEP_MS)

    expect(h.coordinator.usingFallback).toBe(true)
    expect(h.warnings[0]).toContain('not legal')
    // This harness rejects EVERY command, so the escalation runs to its floor: the worker is demoted, Greedy
    // is refused too, and the last-resort legal move is refused as well. The point is where it ends up —
    // announcing that it has stopped, rather than leaving a spinner turning with nothing in the log.
    expect(h.delivered.length).toBeGreaterThanOrEqual(2)
    expect(h.warnings).toHaveLength(2)
    expect(h.warnings[1]).toContain('could not make a move and has stopped')
  })
})

// Codex's D2 code review found both of these, and they are the SAME liveness bug as the one the failure
// funnel was already repaired for, reached through the two paths that funnel did not cover. In each case the
// old code cleared `delivery`, scheduled nothing, and left the caller's state untouched — so the state-keyed
// effect that would re-request never reran. Spinner up, log empty, game over.
// D2-A5 says each failure class must "still finish a game". The per-failure tests assert one warning and one
// delivered command, which is not the same claim: a coordinator that answers once and then wedges passes them
// all. This drives a real game to its result under each failure, committing every command for real.
describe('SearchCoordinator: a failed worker still finishes a whole game (D2-A5)', () => {
  const drive = (factory: SearchTransportFactory): { result: GameState; warnings: string[] } => {
    const clock = new FakeClock()
    const warnings: string[] = []
    let current = aiToAct(11)
    const greedy = new GreedyAgent({ seed: 7, decks: DECKS, depth: 1 })
    const handlers: SearchRequestHandlers = {
      // Commit for real, exactly as the hook does: re-check legality against the captured state, then apply.
      onCommand: (command, forState) => {
        if (forState !== current) return false
        if (!legalCommands(forState, AI).some((c) => JSON.stringify(c) === JSON.stringify(command))) return false
        current = apply(forState, command).state
        return true
      },
      onWarning: (text) => { warnings.push(text) },
    }
    const coordinator = new SearchCoordinator({
      decks: DECKS, gameSeed: GAME_SEED, readState: () => current, stepMs: STEP_MS,
      iterations: 25, rolloutCommandCap: 8, explorationC: 1,
      watchdogMs: WATCHDOG_MS, startupWatchdogMs: STARTUP_WATCHDOG_MS, createTransport: factory, clock,
    })
    for (let i = 0; i < 4000 && !current.result; i++) {
      const actor = actorOf(current)
      if (actor === null) break
      if (actor === AI) {
        const before = current
        coordinator.request(current, handlers)
        clock.advance(STEP_MS)
        // A worker that simply never replies produces no correlated event, so the only thing that moves the
        // game on is the watchdog deadline. Wait it out rather than assuming the pacing delay is enough.
        if (current === before) clock.advance(STARTUP_WATCHDOG_MS + STEP_MS)
        if (current === before) throw new Error('the AI made no progress on its turn')
        continue
      }
      // The human seat is played by Greedy so the game actually progresses to a result.
      current = apply(current, greedy.decide(viewFor(current, HUMAN), legalCommands(current, HUMAN))).state
    }
    coordinator.dispose()
    return { result: current, warnings }
  }

  it('finishes when the worker cannot be constructed at all', () => {
    const { result, warnings } = drive(() => { throw new Error('Worker is not defined') })
    expect(result.result).not.toBeNull()
    expect(warnings.filter((w) => w.includes(FALLBACK_WARNING))).toHaveLength(1)
  })

  it('finishes when every post throws a clone error', () => {
    const { result, warnings } = drive(() => ({
      post: () => { throw new DOMException('could not be cloned', 'DataCloneError') },
      terminate: () => {},
    }))
    expect(result.result).not.toBeNull()
    expect(warnings.filter((w) => w.includes(FALLBACK_WARNING))).toHaveLength(1)
  })

  it('finishes when the worker accepts requests and never replies', () => {
    const { result, warnings } = drive(() => ({ post: () => {}, terminate: () => {} }))
    expect(result.result).not.toBeNull()
    expect(warnings.filter((w) => w.includes(FALLBACK_WARNING))).toHaveLength(1)
  })
})

describe('SearchCoordinator: delivery itself must not be able to end the game', () => {
  it('recovers when the commit handler THROWS rather than returning false', () => {
    const h = harness()
    const first = h.readState()
    h.coordinator.request(first, h.handlers)
    const t = h.transport()
    // A throw used to skip even the seed rollback, so the position was silently consumed on the way out.
    h.setCommitThrows('the board blew up while applying')
    t.handlers.message(resultFor(first, t.searches[0]?.requestId ?? 0))
    h.clock.advance(STEP_MS)
    expect(h.delivered.length).toBeGreaterThanOrEqual(1)

    // It must be treated as a worker failure: warn, demote, and answer this same turn with Greedy.
    expect(h.warnings[0]).toContain(FALLBACK_WARNING)
    expect(h.coordinator.usingFallback).toBe(true)
    expect(h.coordinator.nextSeed).toBe(searchSeed(GAME_SEED, 0))

    // And once the board stops throwing, the recovered move commits for real.
    h.setCommitThrows(null)
    h.clock.advance(STEP_MS)
    const last = h.delivered[h.delivered.length - 1]
    if (!last) throw new Error('unreachable')
    expect(legalCommands(last.state, AI).some((c) => c.type === last.command.type)).toBe(true)
  })

  it('recovers when the transport reports failure SYNCHRONOUSLY, before anything is outstanding', () => {
    // Native `Worker` dispatches errors asynchronously, so no production transport does this — but the seam
    // does not require it, and `active` is not assigned until after the posts return. `fail()` therefore used
    // to find no target at all, record a permanent fallback, and schedule nothing.
    const h = harness({
      factory: (handlers) => {
        handlers.failure('the transport gave up during construction')
        return { post: () => {}, terminate: () => {} }
      },
    })
    h.coordinator.request(h.readState(), h.handlers)
    expectOneWarningAndACommand(h)
    expect(h.warnings[0]).toContain('gave up during construction')
  })

  it('recovers when the transport reports failure synchronously from inside post()', () => {
    let handlers: TransportHandlers | null = null
    const h = harness({
      factory: (hs) => {
        handlers = hs
        return { post: () => { hs.failure('the transport gave up while posting') }, terminate: () => {} }
      },
    })
    h.coordinator.request(h.readState(), h.handlers)
    expect(handlers).not.toBeNull()
    expectOneWarningAndACommand(h)
    expect(h.warnings[0]).toContain('gave up while posting')
  })
})

describe('SearchCoordinator: the four-condition acceptance rule (D2-4)', () => {
  it('applies a correlated reply for the state it was asked about', () => {
    const h = harness()
    const state = h.readState()
    h.coordinator.request(state, h.handlers)
    const t = h.transport()
    t.handlers.message(resultFor(state, t.searches[0]?.requestId ?? 0))
    h.clock.advance(STEP_MS)
    expect(h.delivered).toHaveLength(1)
    expect(h.delivered[0]?.state).toBe(state)
    expect(h.warnings).toHaveLength(0)
  })

  it('drops a reply whose requestId has been superseded', () => {
    const h = harness()
    const state = h.readState()
    h.coordinator.request(state, h.handlers)
    const staleId = h.transport().searches[0]?.requestId ?? 0
    h.coordinator.request(state, h.handlers)

    h.transport().handlers.message(resultFor(state, staleId))
    h.clock.advance(STEP_MS * 4)
    expect(h.delivered).toHaveLength(0)
  })

  it('drops a reply that arrives after restart', () => {
    const h = harness()
    const state = h.readState()
    h.coordinator.request(state, h.handlers)
    const t = h.transport()
    const id = t.searches[0]?.requestId ?? 0

    // `restart()` replaces `stateRef.current` and invalidates — but the reply is already on its way.
    h.setState(aiToAct(12))
    h.coordinator.invalidate()

    t.handlers.message(resultFor(state, id))
    h.clock.advance(STEP_MS * 4)
    expect(h.delivered).toHaveLength(0)
  })

  // The non-obvious racer: concede is legal even when the human is not the acting player, so a human click
  // really can commit a new state in the middle of the AI's turn.
  it('drops a reply that arrives after a human concede', () => {
    const h = harness()
    const state = h.readState()
    h.coordinator.request(state, h.handlers)
    const t = h.transport()
    const id = t.searches[0]?.requestId ?? 0

    const concede: Command = { type: 'concede', player: HUMAN }
    expect(legalCommands(state, HUMAN).some((c) => c.type === 'concede')).toBe(true)
    const conceded = apply(state, concede).state
    expect(conceded.result).not.toBeNull()
    h.setState(conceded)
    h.coordinator.invalidate()

    t.handlers.message(resultFor(state, id))
    h.clock.advance(STEP_MS * 4)
    expect(h.delivered).toHaveLength(0)
  })

  // Defence in depth: the identity check must hold even when nobody remembered to invalidate.
  it('drops a reply whose state is no longer stateRef.current even without an invalidate', () => {
    const h = harness()
    const state = h.readState()
    h.coordinator.request(state, h.handlers)
    const t = h.transport()

    h.setState(apply(state, { type: 'concede', player: HUMAN }).state)
    t.handlers.message(resultFor(state, t.searches[0]?.requestId ?? 0))
    h.clock.advance(STEP_MS * 4)
    expect(h.delivered).toHaveLength(0)
  })

  it('drops a reply that arrives after effect cleanup', () => {
    const h = harness()
    const state = h.readState()
    h.coordinator.request(state, h.handlers)
    const t = h.transport()
    h.coordinator.invalidate()
    t.handlers.message(resultFor(state, t.searches[0]?.requestId ?? 0))
    h.clock.advance(STEP_MS * 4)
    expect(h.delivered).toHaveLength(0)
  })

  it('drops a reply that arrives after unmount, and terminates the worker', () => {
    const h = harness()
    const state = h.readState()
    h.coordinator.request(state, h.handlers)
    const t = h.transport()
    h.coordinator.dispose()
    expect(t.terminations).toBe(1)

    t.handlers.message(resultFor(state, t.searches[0]?.requestId ?? 0))
    h.clock.advance(STEP_MS * 4)
    expect(h.delivered).toHaveLength(0)
    // A disposed coordinator is inert: a later request must not resurrect a worker.
    h.coordinator.request(state, h.handlers)
    expect(h.transports).toHaveLength(1)
  })

  it('cancels an accepted-but-unpaced delivery when cleanup lands inside the deadline', () => {
    const h = harness()
    const state = h.readState()
    h.coordinator.request(state, h.handlers)
    const t = h.transport()
    t.handlers.message(resultFor(state, t.searches[0]?.requestId ?? 0))
    h.clock.advance(STEP_MS / 2)
    h.coordinator.invalidate()
    h.clock.advance(STEP_MS * 4)
    expect(h.delivered).toHaveLength(0)
  })

  it('never delivers for a state the AI does not own', () => {
    const h = harness()
    const humanState = humanToAct(11)
    h.setState(humanState)
    h.coordinator.request(humanState, h.handlers)
    const t = h.transport()
    const command = legalCommands(humanState, HUMAN)[0]
    if (!command) throw new Error('no legal human command')
    t.handlers.message({ type: 'result', requestId: t.searches[0]?.requestId ?? 0, result: { command, diagnostics: EMPTY_DIAGNOSTICS } })
    h.clock.advance(STEP_MS * 4)
    expect(h.delivered).toHaveLength(0)
  })

  it('leaves no timer armed once a game is disposed', () => {
    const h = harness()
    h.coordinator.request(h.readState(), h.handlers)
    expect(h.clock.armed).toBeGreaterThan(0)
    h.coordinator.dispose()
    expect(h.clock.armed).toBe(0)
  })
})

describe('SearchCoordinator: pacing is a deadline, not an added delay (D2-5)', () => {
  it('holds a fast result until AI_STEP_MS has passed since the request', () => {
    const h = harness()
    const state = h.readState()
    h.coordinator.request(state, h.handlers)
    const t = h.transport()

    h.clock.advance(50)
    t.handlers.message(resultFor(state, t.searches[0]?.requestId ?? 0))
    h.clock.advance(STEP_MS - 51)
    expect(h.delivered).toHaveLength(0)
    h.clock.advance(1)
    expect(h.delivered).toHaveLength(1)
  })

  it('applies a slow result immediately rather than adding another AI_STEP_MS', () => {
    const h = harness()
    const state = h.readState()
    h.coordinator.request(state, h.handlers)
    const t = h.transport()

    h.clock.advance(750)   // the search already showed 750 ms of thinking
    t.handlers.message(resultFor(state, t.searches[0]?.requestId ?? 0))
    h.clock.advance(0)
    expect(h.delivered).toHaveLength(1)
  })
})

describe('SearchCoordinator: fallback detection (D2-6)', () => {
  it('falls back when the environment has no Worker at all', () => {
    // The real factory, in an environment that genuinely has none — which is this test runner.
    expect(typeof Worker).toBe('undefined')
    const h = harness({ factory: workerTransport })
    h.coordinator.request(h.readState(), h.handlers)
    expectOneWarningAndACommand(h)
  })

  it('the real factory refuses to construct without Worker support', () => {
    const noop: TransportHandlers = { message: () => {}, failure: () => {} }
    expect(() => workerTransport(noop)).toThrow(/Web Worker/)
  })

  it('falls back when the transport constructor throws', () => {
    const h = harness({ factory: () => { throw new Error('module chunk 404') } })
    h.coordinator.request(h.readState(), h.handlers)
    expectOneWarningAndACommand(h)
    expect(h.warnings[0]).toContain('module chunk 404')
  })

  it('falls back on a synchronous postMessage clone failure', () => {
    const h = harness({ onCreate: (t) => { t.postThrows = 'could not be cloned' } })
    h.coordinator.request(h.readState(), h.handlers)
    expectOneWarningAndACommand(h)
    expect(h.transport().terminations).toBe(1)
  })

  it('falls back on an error event', () => {
    const h = harness()
    h.coordinator.request(h.readState(), h.handlers)
    h.transport().handlers.failure('the search worker failed to load')
    expectOneWarningAndACommand(h)
    expect(h.transport().terminations).toBe(1)
  })

  it('falls back on a messageerror event', () => {
    const h = harness()
    h.coordinator.request(h.readState(), h.handlers)
    h.transport().handlers.failure('the search worker sent a message that could not be read')
    expectOneWarningAndACommand(h)
  })

  it('falls back on a typed error message', () => {
    const h = harness()
    h.coordinator.request(h.readState(), h.handlers)
    const t = h.transport()
    t.handlers.message({ type: 'error', requestId: t.searches[0]?.requestId ?? 0, message: 'searchIsmcts: the game is already over' })
    expectOneWarningAndACommand(h)
    expect(h.warnings[0]).toContain('searchIsmcts')
  })

  /**
   * The failure funnel must RECOVER, never merely give up. `fail()` used to `invalidate()` — cancelling the
   * outstanding request and any pending delivery — and then return early whenever the error did not correlate
   * with what was live, scheduling no move and emitting no warning. The AI then never acted again: the effect
   * keys on the committed state, which never changes, so nothing re-requests. Silent hang, spinner up, empty
   * log — the inverse of the silent degradation D2-6 exists to forbid, and worse, because it stops the game.
   */
  it('recovers even when the error names a request that is no longer the live one', () => {
    const h = harness()
    h.coordinator.request(h.readState(), h.handlers)
    const t = h.transport()
    const superseded = t.searches[0]?.requestId ?? 0
    h.coordinator.invalidate()
    h.coordinator.request(h.readState(), h.handlers)   // a newer request is now outstanding
    t.handlers.message({ type: 'error', requestId: superseded, message: 'worker blew up on the old request' })
    expectOneWarningAndACommand(h)
  })

  it('does not cancel a fallback move that a previous failure already scheduled', () => {
    const h = harness()
    h.coordinator.request(h.readState(), h.handlers)
    const t = h.transport()
    t.handlers.failure('first failure')
    // A second failure landing inside the fallback's own pacing window must leave the queued Greedy move alone.
    t.handlers.failure('second failure')
    expectOneWarningAndACommand(h)
  })

  it('falls back on an init failure, which carries no requestId', () => {
    const h = harness()
    h.coordinator.request(h.readState(), h.handlers)
    h.transport().handlers.message({ type: 'error', requestId: null, message: 'search worker received a request before init' })
    expectOneWarningAndACommand(h)
  })

  // The one failure with no correlated event of any kind: a worker that is killed or hangs.
  it('falls back when the worker simply never replies', () => {
    const h = harness()
    h.coordinator.request(h.readState(), h.handlers)
    expect(h.delivered).toHaveLength(0)

    h.clock.advance(STARTUP_WATCHDOG_MS)
    // The deadline is long past by now, so the Greedy command lands on the same tick.
    expect(h.delivered).toHaveLength(1)
    expect(h.warnings).toHaveLength(1)
    expect(h.warnings[0]).toContain('did not respond')
    expect(h.coordinator.usingFallback).toBe(true)
    expect(h.transport().terminations).toBe(1)
  })

  it('uses the shorter watchdog once the worker has started', () => {
    const h = harness()
    const state = h.readState()
    h.coordinator.request(state, h.handlers)
    const t = h.transport()
    t.handlers.message(resultFor(state, t.searches[0]?.requestId ?? 0))
    h.clock.advance(STEP_MS)
    expect(h.delivered).toHaveLength(1)

    h.coordinator.request(state, h.handlers)
    h.clock.advance(WATCHDOG_MS)
    expect(h.coordinator.usingFallback).toBe(true)
    expect(h.delivered).toHaveLength(2)
  })

  it('warns once per game, however many things go wrong', () => {
    const h = harness()
    const state = h.readState()
    h.coordinator.request(state, h.handlers)
    h.transport().handlers.failure('first failure')
    h.clock.advance(STEP_MS)
    h.transport().handlers.failure('second failure')

    h.coordinator.request(state, h.handlers)
    h.clock.advance(STEP_MS)
    h.coordinator.request(state, h.handlers)
    h.clock.advance(STEP_MS)

    expect(h.warnings).toHaveLength(1)
    expect(h.warnings[0]).toContain('first failure')
    expect(h.delivered).toHaveLength(3)
  })

  // A worker can die between decisions, when nothing is outstanding to rescue. Deferring the warning to
  // "the next request" loses it entirely when there is no next request — the game has just ended, or the
  // human is conceding. It must be shown at once, and shown only once.
  it('warns immediately when it fails with nothing outstanding, and does not warn twice', () => {
    const h = harness()
    const state = h.readState()
    h.coordinator.request(state, h.handlers)
    const t = h.transport()
    t.handlers.message(resultFor(state, t.searches[0]?.requestId ?? 0))
    h.clock.advance(STEP_MS)
    expect(h.delivered).toHaveLength(1)

    t.handlers.failure('the worker died between decisions')
    expect(h.warnings).toHaveLength(1)
    expect(h.warnings[0]).toContain('died between decisions')
    expect(h.coordinator.usingFallback).toBe(true)

    h.coordinator.request(state, h.handlers)
    h.clock.advance(STEP_MS)
    expect(h.warnings).toHaveLength(1)   // still one: the warning is per game, not per request
    expect(h.delivered).toHaveLength(2)
  })

  it('never builds another worker once it has fallen back', () => {
    const h = harness()
    h.coordinator.request(h.readState(), h.handlers)
    h.transport().handlers.failure('gone')
    h.clock.advance(STEP_MS)
    h.coordinator.request(h.readState(), h.handlers)
    h.clock.advance(STEP_MS)
    expect(h.transports).toHaveLength(1)
    expect(h.transport().searches).toHaveLength(1)
  })

  // The fallback carries the same staleness and pacing rules, or it would corrupt games the worker never touched.
  it('drops a fallback command when the position moves on inside the deadline', () => {
    const h = harness()
    const state = h.readState()
    h.coordinator.request(state, h.handlers)
    h.transport().handlers.failure('gone')
    h.setState(apply(state, { type: 'concede', player: HUMAN }).state)
    h.clock.advance(STEP_MS * 4)
    expect(h.delivered).toHaveLength(0)
    expect(h.warnings).toHaveLength(1)
  })

  // The decision counter keeps tracking committed commands under the fallback. Note what this is NOT: once
  // the worker is gone no search is ever posted again, and Greedy carries its own RNG, so the SEED derived
  // from that counter has no consumer here. What is worth pinning is that the fallback keeps committing
  // decisions at all, and that the counter stays a true count of them rather than freezing.
  it('keeps counting committed decisions under the fallback', () => {
    const h = harness()
    const state = h.readState()
    h.coordinator.request(state, h.handlers)
    h.transport().handlers.failure('gone')
    h.clock.advance(STEP_MS)
    expect(h.delivered).toHaveLength(1)

    h.coordinator.request(h.readState(), h.handlers)
    h.clock.advance(STEP_MS)
    expect(h.delivered).toHaveLength(2)
    expect(h.transports).toHaveLength(1)   // and never another worker
  })
})
