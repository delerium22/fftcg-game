import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  actingPlayer, apply, createGame, legalCommands, viewFor,
  type AbilityTrigger, type CardId, type Event, type FieldFlag, type Frame, type GameState, type Keyword, type PlayerId, type PlayerView,
} from '@fftcg/engine'
import { GreedyAgent, type Agent } from '@fftcg/ai'
import { CARD_DEFS, DECKS } from '../deck.js'
import { buildChoiceSet, describeChoice, describeTriggerCause, preferredChoices, sameCommand, type TriggerCause } from './commands.js'
import { AI, HUMAN, type Choice, type GameApi, type LogLine } from './types.js'

/** Spec B7: the agent decides in ~0.27 ms, far too fast to watch — one move per this many ms instead. */
export const AI_STEP_MS = 600

const PHASE_LABEL: Record<string, string> = {
  setup: 'Setup', active: 'Active Phase', draw: 'Draw Phase',
  main1: 'Main Phase 1', attack: 'Attack Phase', main2: 'Main Phase 2', end: 'End Phase',
}

function name(v: PlayerView, id: number): string {
  const inst = v.cards[id]
  if (!inst) return `#${id}`
  return v.defs[inst.code]?.name ?? inst.code
}
const who = (v: PlayerView, p: PlayerId): string => (p === v.me ? 'You' : 'The AI')
const whoDoes = (v: PlayerView, p: PlayerId, mine: string, theirs: string): string => (p === v.me ? mine : theirs)

const KEYWORD_LABEL: Record<Keyword, string> = { haste: 'Haste', brave: 'Brave', firstStrike: 'First Strike', backAttack: 'Back Attack' }
const FLAG_LABEL: Record<FieldFlag, string> = { cannotBeBroken: 'cannot be broken this turn' }

/**
 * The printed wording of the clause that is resolving, quoted from the AST on `CardDef` (spec C1-1). Printed
 * text is multi-line — a modal clause prints one line per mode — and a log line is one line, so runs of
 * whitespace collapse. Nothing else about the wording is touched: reviewers check the AST against THIS.
 */
function abilityText(v: PlayerView, card: number, abilityId: string): string | null {
  const code = v.cards[card]?.code
  const def = code === undefined ? undefined : v.defs[code]
  const text = def?.abilities?.find((a) => a.id === abilityId)?.text
  return text === undefined ? null : text.replace(/\s+/g, ' ').trim()
}

/**
 * One log line per engine event, named from the HUMAN's *post-apply* view — by the time an event is narrated the
 * card it names has moved somewhere public (field, damage zone, break zone), so nothing here can name a card the
 * human may not see. `null` drops events the move line above them already states (`cast`, `attackDeclared`, the
 * CP that paid for them), keeping the log a narrative rather than a trace.
 *
 * `cause` is what fired an `abilityTriggered` (spec C2-5) — `eventLines` supplies it; it is ignored everywhere
 * else. Callers narrating a single event out of context can leave it off.
 */
export function describeEvent(v: PlayerView, e: Event, cause: TriggerCause | null = null): LogLine | null {
  switch (e.type) {
    case 'firstPlayerChosen': return { kind: 'phase', text: `${who(v, e.player)} take${e.player === v.me ? '' : 's'} the first turn` }
    case 'mulligan': return { kind: 'event', text: `${who(v, e.player)} ${whoDoes(v, e.player, e.redraw ? 'mulligan' : 'keep your hand', e.redraw ? 'mulligans' : 'keeps its hand')}` }
    case 'turnStarted': return { kind: 'phase', text: `Turn ${e.turn} — ${whoDoes(v, e.player, 'your turn', "the AI's turn")}` }
    case 'phaseStarted': return { kind: 'phase', text: `${PHASE_LABEL[e.phase] ?? e.phase}${e.step ? ` — ${e.step}` : ''}` }
    case 'drew': return { kind: 'event', text: `${who(v, e.player)} draw${e.player === v.me ? '' : 's'} ${e.count} card${e.count === 1 ? '' : 's'}` }
    case 'discarded': return e.reason === 'cp' ? null : { kind: 'event', text: `${who(v, e.player)} discard${e.player === v.me ? '' : 's'} ${name(v, e.card)} to the hand limit` }
    // B-A6 + C1-9: coverage is per CLAUSE. `clauses` counts the ones still missing on a card that DOES have an
    // implemented clause; its absence means the whole text box is unimplemented and the card played as vanilla.
    case 'unimplementedAbility': return e.clauses === undefined
      ? { kind: 'warning', text: `${name(v, e.card)} (${e.code}) has abilities that are not implemented yet — played as vanilla` }
      : { kind: 'warning', text: `${name(v, e.card)} (${e.code}) has ${e.clauses} more ability clause${e.clauses === 1 ? '' : 's'} that ${e.clauses === 1 ? 'is' : 'are'} not implemented yet` }
    case 'exBurstSkipped': return { kind: 'warning', text: `EX Burst on ${name(v, e.card)} skipped (not implemented)` }
    case 'battleDamage': return { kind: 'event', text: `${name(v, e.source)} deals ${e.amount} damage to ${name(v, e.target)}` }
    case 'playerDamaged': return { kind: 'event', text: `${who(v, e.player)} take${e.player === v.me ? '' : 's'} 1 damage` }
    case 'broken': return { kind: 'event', text: `${name(v, e.card)} is broken` }
    case 'putIntoBreakZone': return { kind: 'event', text: `${name(v, e.card)} is put into the Break Zone (0 power)` }
    // --- ability resolution (rung C1). The choice itself is already a move line — the human's from `choose`,
    // the AI's from `stepAi` — so these narrate what triggered and what it DID, closing the loop between the
    // printed text box and the board state the player is looking at.
    // C2: an OBSERVER trigger fires because of something that happened to a DIFFERENT card, so the cause goes
    // in front of the printed text. "Lightning's ability triggers — the AI's Prishe was broken" is the only
    // thing tying the prompt that follows to the board; and for a clause with no prompt at all (Luso's "break
    // it") the log is the ONLY evidence the trigger happened.
    case 'abilityTriggered': {
      const text = abilityText(v, e.card, e.abilityId)
      const why = cause ? ` — ${describeTriggerCause(v, cause)}` : ''
      return { kind: 'event', text: `${name(v, e.card)}'s ability triggers${why}${text ? `: "${text}"` : ''}` }
    }
    case 'abilityNoLegalTarget': return { kind: 'event', text: `${name(v, e.card)}'s ability finds no legal target — nothing happens` }
    case 'dulled': return { kind: 'event', text: `${name(v, e.card)} is dulled` }
    case 'abilityDamage': return { kind: 'event', text: `${name(v, e.source)} deals ${e.amount} damage to ${name(v, e.target)}` }
    case 'powerModified': return { kind: 'event', text: `${name(v, e.card)} gets ${e.amount >= 0 ? '+' : ''}${e.amount} power until the end of the turn` }
    case 'keywordGranted': return { kind: 'event', text: `${name(v, e.card)} gains ${KEYWORD_LABEL[e.keyword]} until the end of the turn` }
    case 'flagGranted': return { kind: 'event', text: `${name(v, e.card)} ${FLAG_LABEL[e.flag]}` }
    case 'returnedToHand': return { kind: 'event', text: `${name(v, e.card)} returns to ${whoDoes(v, e.player, 'your hand', "the AI's hand")}` }
    case 'brokenByAbility': return { kind: 'event', text: `${name(v, e.card)} is broken by ${name(v, e.source)}` }
    case 'breakPrevented': return { kind: 'event', text: `${name(v, e.card)} survives — it ${FLAG_LABEL[e.flag]}` }
    case 'gameOver': return { kind: 'result', text: `Game over — ${e.result.winner === null ? 'a draw' : e.result.winner === v.me ? 'you win' : 'the AI wins'} (${e.result.reason})` }
    // `cast`/`attackDeclared`/`blockDeclared`/`cpGenerated` restate the move line; `activated` and
    // `summonResolvedNoEffect` are noise (the latter doubles up on `unimplementedAbility` for every summon in the pool).
    default: return null
  }
}

/** The clause an `abilityTriggered` names, from the AST on `CardDef` — its `trigger` says what fired it. */
function triggerOf(v: PlayerView, card: CardId, abilityId: string): AbilityTrigger | null {
  const code = v.cards[card]?.code
  const def = code === undefined ? undefined : v.defs[code]
  return def?.abilities?.find((a) => a.id === abilityId)?.trigger ?? null
}

/**
 * §7.10 puts a broken card in its OWNER's Break Zone, which is where narration finds it once it has left the
 * field. Owner and controller coincide for this pool — nothing in it changes control (rung C5) — so this is
 * the controller the clause's `whose` is measured against.
 */
function holderOf(v: PlayerView, id: CardId): PlayerId {
  for (const p of [0, 1] as const) if (v.fields[p].breakZone.includes(id)) return p
  return v.cards[id]?.owner ?? v.me
}

interface Hit { readonly source: CardId; readonly target: CardId; readonly amount: number; used: boolean }
interface PlayerHit { readonly victim: PlayerId; used: boolean }
interface ZoneHit { readonly card: CardId; readonly controller: PlayerId; used: boolean }

/**
 * Pair one `abilityTriggered` with the event that fired it, consuming the candidate so the NEXT trigger of the
 * same clause gets the next one (CR §11.8.6 / spec C2-A3: one Lightning watching two simultaneous breaks
 * triggers twice, and the two lines must not both name the same Forward).
 *
 * `dealtDamage` is exact by construction: `enqueueDamageTriggers` hangs the clause off the DAMAGE SOURCE, so
 * the watcher id IS the source to match on. `observesZoneChange` is matched on `whose` relative to the frame's
 * own controller (`e.player`), never the turn player — spec C2-10, so the clause means the same from either
 * seat. Anything unmatched returns null and the line simply loses its cause clause rather than gaining a
 * wrong one.
 */
function causeOf(
  v: PlayerView, e: Extract<Event, { type: 'abilityTriggered' }>,
  hits: Hit[], playerHits: PlayerHit[], zoneHits: ZoneHit[],
): TriggerCause | null {
  const trigger = triggerOf(v, e.card, e.abilityId)
  if (!trigger) return null
  if (trigger.kind === 'dealtDamage') {
    if (trigger.to === 'player') {
      const hit = playerHits.find((h) => !h.used)
      if (!hit) return null
      hit.used = true
      return { kind: 'damage', source: e.card, target: null, victim: hit.victim, amount: 1 }
    }
    const hit = hits.find((h) => !h.used && h.source === e.card)
    if (!hit) return null
    hit.used = true
    return { kind: 'damage', source: hit.source, target: hit.target, victim: null, amount: hit.amount }
  }
  if (trigger.kind === 'observesZoneChange') {
    const wants = (controller: PlayerId): boolean =>
      trigger.whose === 'any' || (trigger.whose === 'self') === (controller === e.player)
    const hit = zoneHits.find((h) => !h.used && wants(h.controller))
    if (!hit) return null
    hit.used = true
    return { kind: 'zoneChange', card: hit.card, controller: hit.controller }
  }
  return null   // enterField/summonResolve are about the source itself — there is nothing to explain
}

/**
 * Narrate one command's events, saying what each triggered clause was reacting to (spec C2-5).
 *
 * `queued` is the agenda queue as it stood BEFORE the command, and it is the exact answer wherever it reaches:
 * those frames carry their own `triggerEvent`, `drainResolution` starts them FIFO, and starting a frame is what
 * emits `abilityTriggered` — so the n-th trigger of the batch is `queued[n]`. That is what rescues a trigger
 * whose cause happened in an EARLIER batch: a second Lightning occurrence sits in the queue across the prompt
 * the first one raised, and by the time it starts, the break that fired it is long gone from the event stream.
 *
 * A frame both queued and drained inside THIS batch is in no queue anyone can see, so its cause is
 * reconstructed from the events instead — `causeOf`. That is the common case (Luso's "break it" raises no
 * prompt at all) and it is sound because the engine pushes a damage or break event before the trigger that
 * event queues, transition-major (spec C2-11). Both routes are guarded: an unmatched trigger loses its cause
 * clause rather than gaining a wrong one.
 */
export function eventLines(v: PlayerView, events: readonly Event[], queued: readonly Frame[] = []): LogLine[] {
  const hits: Hit[] = []
  const playerHits: PlayerHit[] = []
  const zoneHits: ZoneHit[] = []
  const lines: LogLine[] = []
  let started = 0
  for (const e of events) {
    switch (e.type) {
      // Combat and ability damage alike — the printed text says "deals damage" (spec C2-7).
      case 'battleDamage':
      case 'abilityDamage': hits.push({ source: e.source, target: e.target, amount: e.amount, used: false }); break
      // `playerDamaged.card` is the card TAKEN as damage, not the dealer; the dealer is the watcher itself.
      case 'playerDamaged': playerHits.push({ victim: e.player, used: false }); break
      case 'broken':
      case 'brokenByAbility':
      case 'putIntoBreakZone': zoneHits.push({ card: e.card, controller: holderOf(v, e.card), used: false }); break
      default: break
    }
    let cause: TriggerCause | null = null
    if (e.type === 'abilityTriggered') {
      const frame = queued[started++]
      // The identity check is the guard on the FIFO assumption: mismatch means the queue is not what this
      // trigger came from, so fall through to reconstruction rather than narrate another clause's subject.
      cause = frame && frame.source === e.card && frame.abilityId === e.abilityId
        ? frame.triggerEvent
        : causeOf(v, e, hits, playerHits, zoneHits)
    }
    const line = describeEvent(v, e, cause)
    if (line) lines.push(line)
  }
  return lines
}

/**
 * The view a command's events are narrated from: the state AFTER it, plus the cards that were public BEFORE.
 * An ability can move a card out of a public zone into a hidden one — Billy Bob returns a Forward from the
 * Break Zone to its owner's HAND — and `#51 returns to the AI's hand` is a worse log line than naming a card
 * whose identity the player could read off the table a moment ago. Nothing hidden before can enter this union,
 * so B-A3 still holds: `before` is itself a human view.
 */
export const narrator = (before: PlayerView, after: PlayerView): PlayerView => ({ ...after, cards: { ...before.cards, ...after.cards } })

/**
 * Apply exactly ONE command for whoever is currently acting, chosen by `agent`, and return the resulting state
 * with the lines it produced. Pure and React-free so the whole driver is testable headlessly (spec B-A7). The
 * membership check is spec B-A4 held to both seats: `apply` is never reached by a command outside `legalCommands`.
 */
export function stepAi(state: GameState, agent: Agent): { state: GameState; lines: LogLine[] } {
  const p = actingPlayer(state)
  if (p === null) return { state, lines: [] }
  const actorView = viewFor(state, p)
  const legal = legalCommands(state, p)
  const command = agent.decide(actorView, legal)
  if (!legal.some((c) => sameCommand(c, command))) throw new Error(`agent chose an illegal command: ${command.type}`)
  const before = viewFor(state, HUMAN)
  const result = apply(state, command)
  // Label the move from the actor's own view, so a card only it can see still reads sensibly; everything after
  // is narrated from the human's view.
  const lines = eventLines(narrator(before, viewFor(result.state, HUMAN)), result.events, state.resolution.queue)
  return { state: result.state, lines: [{ kind: 'ai', text: describeChoice(actorView, command) }, ...lines] }
}

const newGame = (seed: number): GameState => createGame({ seed, decks: DECKS, defs: CARD_DEFS })
/** Spec B4 + the B-risks open-deck-list note: `GreedyAgent` determinises with BOTH lists, and in a mirror starter
 *  matchup both are public — so passing `DECKS` twice leaks nothing a real opponent would not already know. */
const newAgent = (seed: number): Agent => new GreedyAgent({ seed, decks: DECKS, depth: 1 })

const openingLog = (): LogLine[] => [{ kind: 'phase', text: 'New game — you are P0, the AI is P1' }]

export function useGame(seed?: number): GameApi {
  const seedRef = useRef<number>(seed ?? Date.now() % 2_147_483_647)
  // Spec B3: the ground truth lives here and only `viewFor(state, HUMAN)` ever leaves the hook. `stateRef` is
  // the authority `choose` reads, so two clicks inside one render can't both apply to the same stale state.
  const [state, setState] = useState<GameState>(() => newGame(seedRef.current))
  const stateRef = useRef<GameState>(state)
  const agentRef = useRef<Agent | null>(null)
  agentRef.current ??= newAgent(seedRef.current)   // lazy: `useRef(newAgent(...))` would build one every render
  const [log, setLog] = useState<LogLine[]>(openingLog)
  const [aiThinking, setAiThinking] = useState(false)

  const commit = useCallback((next: GameState, lines: LogLine[]) => {
    stateRef.current = next
    setState(next)
    if (lines.length) setLog((prev) => [...prev, ...lines])
  }, [])

  const view = useMemo(() => viewFor(state, HUMAN), [state])
  const choices = useMemo(() => buildChoiceSet(view, preferredChoices(view, legalCommands(state, HUMAN))), [state, view])

  const choose = useCallback((choice: Choice): void => {
    const current = stateRef.current
    // Spec B-A4: prove the command is still legal before touching `apply`, so an illegal click is impossible
    // rather than merely rejected by the engine after the fact.
    const legal = legalCommands(current, HUMAN)
    if (!legal.some((c) => sameCommand(c, choice.command))) throw new Error(`illegal command: ${choice.label}`)
    const before = viewFor(current, HUMAN)
    const result = apply(current, choice.command)
    const lines = eventLines(narrator(before, viewFor(result.state, HUMAN)), result.events, current.resolution.queue)
    commit(result.state, [{ kind: 'human', text: describeChoice(before, choice.command) }, ...lines])
  }, [commit])

  const restart = useCallback((): void => {
    // A fresh but reproducible seed: `useGame(seed)` stays deterministic across restarts, which tests rely on.
    const next = ++seedRef.current
    const game = newGame(next)
    stateRef.current = game
    agentRef.current = newAgent(next)
    setState(game)
    setLog(openingLog())
    setAiThinking(false)
  }, [])

  // Spec B7: one AI move per tick until the human is on the clock again or the game ends. Re-running on every
  // `state` change is what makes it a loop. The cleanup both clears the timer and latches `cancelled`, so
  // StrictMode's mount→unmount→mount double-invoke discards the first timer instead of stepping the AI twice.
  useEffect(() => {
    if (state.result || actingPlayer(state) !== AI) { setAiThinking(false); return }
    setAiThinking(true)
    let cancelled = false
    const timer = setTimeout(() => {
      if (cancelled) return
      const stepped = stepAi(stateRef.current, agentRef.current as Agent)
      commit(stepped.state, stepped.lines)
    }, AI_STEP_MS)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [state, commit])

  return { view, choices, log, aiThinking, choose, restart }
}
