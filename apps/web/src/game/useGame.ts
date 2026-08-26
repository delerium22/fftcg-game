import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  actingPlayer, apply, createGame, legalCommands, viewFor,
  type Event, type GameState, type PlayerId, type PlayerView,
} from '@fftcg/engine'
import { GreedyAgent, type Agent } from '@fftcg/ai'
import { CARD_DEFS, DECKS } from '../deck.js'
import { buildChoiceSet, describeChoice, preferredChoices, sameCommand } from './commands.js'
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

/**
 * One log line per engine event, named from the HUMAN's *post-apply* view — by the time an event is narrated the
 * card it names has moved somewhere public (field, damage zone, break zone), so nothing here can name a card the
 * human may not see. `null` drops events the move line above them already states (`cast`, `attackDeclared`, the
 * CP that paid for them), keeping the log a narrative rather than a trace.
 */
export function describeEvent(v: PlayerView, e: Event): LogLine | null {
  switch (e.type) {
    case 'firstPlayerChosen': return { kind: 'phase', text: `${who(v, e.player)} take${e.player === v.me ? '' : 's'} the first turn` }
    case 'mulligan': return { kind: 'event', text: `${who(v, e.player)} ${whoDoes(v, e.player, e.redraw ? 'mulligan' : 'keep your hand', e.redraw ? 'mulligans' : 'keeps its hand')}` }
    case 'turnStarted': return { kind: 'phase', text: `Turn ${e.turn} — ${whoDoes(v, e.player, 'your turn', "the AI's turn")}` }
    case 'phaseStarted': return { kind: 'phase', text: `${PHASE_LABEL[e.phase] ?? e.phase}${e.step ? ` — ${e.step}` : ''}` }
    case 'drew': return { kind: 'event', text: `${who(v, e.player)} draw${e.player === v.me ? '' : 's'} ${e.count} card${e.count === 1 ? '' : 's'}` }
    case 'discarded': return e.reason === 'cp' ? null : { kind: 'event', text: `${who(v, e.player)} discard${e.player === v.me ? '' : 's'} ${name(v, e.card)} to the hand limit` }
    // B-A6: the pool has no abilities yet (rung C), so say so in play rather than letting the card quietly misbehave.
    case 'unimplementedAbility': return { kind: 'warning', text: `${name(v, e.card)} (${e.code}) has abilities that are not implemented yet — played as vanilla` }
    case 'exBurstSkipped': return { kind: 'warning', text: `EX Burst on ${name(v, e.card)} skipped (not implemented)` }
    case 'battleDamage': return { kind: 'event', text: `${name(v, e.source)} deals ${e.amount} damage to ${name(v, e.target)}` }
    case 'playerDamaged': return { kind: 'event', text: `${who(v, e.player)} take${e.player === v.me ? '' : 's'} 1 damage` }
    case 'broken': return { kind: 'event', text: `${name(v, e.card)} is broken` }
    case 'putIntoBreakZone': return { kind: 'event', text: `${name(v, e.card)} is put into the Break Zone (0 power)` }
    case 'gameOver': return { kind: 'result', text: `Game over — ${e.result.winner === null ? 'a draw' : e.result.winner === v.me ? 'you win' : 'the AI wins'} (${e.result.reason})` }
    // `cast`/`attackDeclared`/`blockDeclared`/`cpGenerated` restate the move line; `activated` and
    // `summonResolvedNoEffect` are noise (the latter doubles up on `unimplementedAbility` for every summon in the pool).
    default: return null
  }
}

const eventLines = (v: PlayerView, events: Event[]): LogLine[] =>
  events.map((e) => describeEvent(v, e)).filter((l): l is LogLine => l !== null)

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
  const result = apply(state, command)
  const humanView = viewFor(result.state, HUMAN)
  // Label the move from the actor's own view, so a card only it can see still reads sensibly; everything after
  // is narrated from the human's view.
  return { state: result.state, lines: [{ kind: 'ai', text: describeChoice(actorView, command) }, ...eventLines(humanView, result.events)] }
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
    commit(result.state, [{ kind: 'human', text: describeChoice(before, choice.command) }, ...eventLines(viewFor(result.state, HUMAN), result.events)])
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
