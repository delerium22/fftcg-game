import type { CardDef, PlayerId } from './types.js'
import { KEYWORDS, opponentOf } from './types.js'
import { EMPTY_RESOLUTION, FIELD_FLAGS } from './abilities.js'
import type { CardId, CardInstance, GameState, PlayerState } from './state.js'
import { updatePlayer } from './state.js'
import { nextInt, seedRng, shuffle } from './rng.js'
import type { Event } from './events.js'
import { IllegalCommandError } from './errors.js'
import { startTurn } from './phases.js'

export interface CreateGameOptions { seed: number; decks: [string[], string[]]; defs: CardDef[]; skipDeckValidation?: boolean; /** Rung J8: each player's LB deck list (§7.14), none by default. */ lbDecks?: [string[], string[]] }

export function validateDeck(defs: Record<string, CardDef>, codes: string[]): string[] {
  const problems: string[] = []
  if (codes.length !== 50) problems.push(`main deck must have exactly 50 cards (§8.1.1.1), has ${codes.length}`)
  const counts = new Map<string, number>()
  for (const c of codes) {
    if (!defs[c]) { problems.push(`unknown card code ${c}`); continue }
    if (defs[c]?.limitBreak !== undefined) problems.push(`${c} has Limit Break and belongs in the LB deck, not the main deck (§8.1.3)`)
    counts.set(c, (counts.get(c) ?? 0) + 1)
  }
  for (const [c, n] of counts) if (n > 3) problems.push(`${c} appears ${n} times; max 3 copies (§8.1.1.2)`)
  return problems
}

/** §8.1.1.1–.3 (rung J8): up to eight cards, ≤3 copies, every one a Limit Break card. Empty is fine. */
export function validateLbDeck(defs: Record<string, CardDef>, codes: string[]): string[] {
  const problems: string[] = []
  if (codes.length > 8) problems.push(`an LB deck holds at most eight cards (§8.1.1.1), has ${codes.length}`)
  const counts = new Map<string, number>()
  for (const c of codes) {
    if (!defs[c]) { problems.push(`unknown card code ${c}`); continue }
    if (defs[c]?.limitBreak === undefined) problems.push(`${c} has no Limit Break and may not be in an LB deck (§8.1.3)`)
    counts.set(c, (counts.get(c) ?? 0) + 1)
  }
  for (const [c, n] of counts) if (n > 3) problems.push(`${c} appears ${n} times; max 3 copies (§8.1.1.2)`)
  return problems
}

function emptyPlayer(): PlayerState {
  return { deck: [], hand: [], lbDeck: [], forwards: [], backups: [], damageZone: [], breakZone: [], removedFromGame: [], putIntoBreakZoneFromFieldThisTurn: [], mulliganDecided: false }
}

/**
 * Rung J6-D9: a continuous static that arrived through JSON is checked once, here — a non-finite amount or an
 * instance axis in its scope would poison every reader of power, keywords and flags.
 */
export function validateContinuousStatics(defs: readonly CardDef[]): string[] {
  const problems: string[] = []
  const instanceAxes = ['minPower', 'maxPower', 'status', 'grantedKeyword', 'excludeSource', 'excludeSourceName', 'putIntoBreakZoneFromFieldThisTurn']
  for (const d of defs) {
    for (const a of d.abilities ?? []) {
      if (a.trigger.kind !== 'static') continue
      const e = a.trigger.effect
      if (e.kind === 'modifyPower' && !Number.isFinite(e.amount)) problems.push(`${d.code}: ${a.id} has a non-finite amount`)
      if (e.kind === 'grantKeyword' && !KEYWORDS.includes(e.keyword)) problems.push(`${d.code}: ${a.id} grants unknown keyword ${String(e.keyword)}`)
      if (e.kind === 'grantFlag' && !FIELD_FLAGS.includes(e.flag)) problems.push(`${d.code}: ${a.id} grants unknown flag ${String(e.flag)}`)
      if (e.kind === 'modifyPower' || e.kind === 'grantKeyword' || e.kind === 'grantFlag') {
        for (const k of Object.keys(e.to.filter ?? {})) if (instanceAxes.includes(k)) problems.push(`${d.code}: ${a.id} scopes on instance axis ${k}`)
        if (!['self', 'opponent', 'any'].includes(e.to.controller)) problems.push(`${d.code}: ${a.id} has an unknown scope controller`)
      }
    }
  }
  return problems
}

export function createGame(opts: CreateGameOptions): GameState {
  const bad = validateContinuousStatics(opts.defs)
  if (bad.length) throw new Error(`invalid continuous statics: ${bad.join('; ')}`)
  const defs = Object.fromEntries(opts.defs.map((d) => [d.code, d]))
  if (!opts.skipDeckValidation) {
    for (const p of [0, 1] as const) {
      const problems = validateDeck(defs, opts.decks[p])
      if (problems.length) throw new Error(`player ${p} deck invalid: ${problems.join('; ')}`)
      const lbProblems = validateLbDeck(defs, opts.lbDecks?.[p] ?? [])
      if (lbProblems.length) throw new Error(`player ${p} LB deck invalid: ${lbProblems.join('; ')}`)
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
    // §7.14 / §8.2.1.1 (rung J8): the LB deck, face down, in list order — not shuffled (§8.2.1.1 does not require it).
    for (const code of opts.lbDecks?.[p] ?? []) { cards[id] = { id, code, owner: p }; players[p].lbDeck.push({ id: id++, faceUp: false }) }
  }
  const [chooser, r2] = nextInt(rng, 2)     // §8.2.1.2
  return {
    rng: r2, turn: 0, turnPlayer: 0, firstPlayer: 0, phase: 'setup', attack: null, priority: chooser as PlayerId,
    pending: { kind: 'chooseFirst', player: chooser as PlayerId }, resolution: EMPTY_RESOLUTION,
    passes: 0, stack: [],
    players, cards, knownBy: {}, defs, result: null,
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
