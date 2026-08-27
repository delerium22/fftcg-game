import type { CardDef, PlayerId } from './types.js'
import { opponentOf } from './types.js'
import { EMPTY_RESOLUTION } from './abilities.js'
import type { CardId, CardInstance, GameState, PlayerState } from './state.js'
import { updatePlayer } from './state.js'
import { nextInt, seedRng, shuffle } from './rng.js'
import type { Event } from './events.js'
import { IllegalCommandError } from './errors.js'
import { startTurn } from './phases.js'

export interface CreateGameOptions { seed: number; decks: [string[], string[]]; defs: CardDef[]; skipDeckValidation?: boolean }

export function validateDeck(defs: Record<string, CardDef>, codes: string[]): string[] {
  const problems: string[] = []
  if (codes.length !== 50) problems.push(`main deck must have exactly 50 cards (§8.1.1.1), has ${codes.length}`)
  const counts = new Map<string, number>()
  for (const c of codes) {
    if (!defs[c]) { problems.push(`unknown card code ${c}`); continue }
    counts.set(c, (counts.get(c) ?? 0) + 1)
  }
  for (const [c, n] of counts) if (n > 3) problems.push(`${c} appears ${n} times; max 3 copies (§8.1.1.2)`)
  return problems
}

function emptyPlayer(): PlayerState {
  return { deck: [], hand: [], forwards: [], backups: [], damageZone: [], breakZone: [], removedFromGame: [], mulliganDecided: false }
}

export function createGame(opts: CreateGameOptions): GameState {
  const defs = Object.fromEntries(opts.defs.map((d) => [d.code, d]))
  if (!opts.skipDeckValidation) {
    for (const p of [0, 1] as const) {
      const problems = validateDeck(defs, opts.decks[p])
      if (problems.length) throw new Error(`player ${p} deck invalid: ${problems.join('; ')}`)
    }
  }
  let rng = seedRng(opts.seed)
  const cards: Record<CardId, CardInstance> = {}
  const players: [PlayerState, PlayerState] = [emptyPlayer(), emptyPlayer()]
  let id = 1
  for (const p of [0, 1] as const) {
    const ids: CardId[] = []
    for (const code of opts.decks[p]) { cards[id] = { id, code, owner: p }; ids.push(id++) }
    const [shuffled, r] = shuffle(rng, ids)   // §8.2.1.1
    rng = r
    players[p].deck = shuffled
  }
  const [chooser, r2] = nextInt(rng, 2)     // §8.2.1.2
  return {
    rng: r2, turn: 0, turnPlayer: 0, firstPlayer: 0, phase: 'setup', attack: null, priority: chooser as PlayerId,
    pending: { kind: 'chooseFirst', player: chooser as PlayerId }, resolution: EMPTY_RESOLUTION,
    players, cards, defs, result: null,
  }
}

/** Move n cards from top of deck to hand. Caller handles the empty-deck loss rule (§3.1.2) — see Task 5 drawCards. */
export function dealCards(state: GameState, p: PlayerId, n: number): GameState {
  return updatePlayer(state, p, (ps) => ({ ...ps, deck: ps.deck.slice(n), hand: [...ps.hand, ...ps.deck.slice(0, n)] }))
}

export function applyChooseFirst(state: GameState, player: PlayerId, goFirst: boolean): [GameState, Event[]] {
  if (state.pending?.kind !== 'chooseFirst' || state.pending.player !== player) throw new IllegalCommandError('no first-player choice owed by this player')
  const first = goFirst ? player : opponentOf(player)
  let s: GameState = { ...state, firstPlayer: first, turnPlayer: first, pending: { kind: 'mulligan', player: first }, priority: first }
  s = dealCards(s, 0, 5)   // §8.2.1.3
  s = dealCards(s, 1, 5)
  return [s, [{ type: 'firstPlayerChosen', player: first }]]
}

export function applyMulligan(state: GameState, player: PlayerId, redraw: boolean): [GameState, Event[]] {
  if (state.pending?.kind !== 'mulligan' || state.pending.player !== player) throw new IllegalCommandError('no mulligan decision owed by this player')
  let s = state
  if (redraw) {
    // §8.2.1.4: hand to the bottom of the deck, draw 5 new. MVP0-SIMPLIFICATION: the player may choose the order of the 5 cards; we keep hand order.
    s = updatePlayer(s, player, (ps) => ({ ...ps, deck: [...ps.deck, ...ps.hand], hand: [] }))
    s = dealCards(s, player, 5)
  }
  s = updatePlayer(s, player, (ps) => ({ ...ps, mulliganDecided: true }))
  const events: Event[] = [{ type: 'mulligan', player, redraw }]
  const other = opponentOf(player)
  if (!s.players[other].mulliganDecided) {
    return [{ ...s, pending: { kind: 'mulligan', player: other }, priority: other }, events]
  }
  const [started, more] = startTurn({ ...s, pending: null }, 1, s.firstPlayer)   // §8.2.1.5
  return [started, [...events, ...more]]
}
