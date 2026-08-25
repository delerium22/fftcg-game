import type { PlayerId } from './types.js'
import type { CardId, CardInstance, GameState, PlayerState } from './state.js'
import type { PlayerView } from './view.js'
import { shuffle, type Rng } from './rng.js'

export const SYNTHETIC_ID_BASE = 100_000
/**
 * `decks` must be the players' complete, publicly declared 50-card lists — the game-mode assumption that both
 * decks are open/fixed information (e.g. a fixed starter matchup), not a general rules guarantee. Callers must
 * supply only declared lists here, never lists reconstructed from hidden `GameState` (that would leak information
 * a real opponent would not have revealed).
 */
export interface DeterminiseOptions { view: PlayerView; decks: [string[], string[]]; rng: Rng }

function removeVisible(multiset: string[], codes: string[], p: PlayerId): string[] {
  const left = [...multiset]
  for (const code of codes) {
    const i = left.indexOf(code)
    if (i < 0) throw new Error(`deck list for player ${p} does not contain visible card ${code}`)
    left.splice(i, 1)
  }
  return left
}

/** Rebuild a full GameState consistent with `view`: visible cards keep their ids; the opponent's hand and both decks are sampled from each player's unseen deck-list multiset. Returns the state and the advanced rng. */
export function determinise({ view, decks, rng }: DeterminiseOptions): [GameState, Rng] {
  const cards: Record<CardId, CardInstance> = { ...view.cards }
  for (const p of [0, 1] as const) {
    for (const code of decks[p]) if (!view.defs[code]) throw new Error(`deck list for player ${p} contains code ${code} which has no definition in view.defs`)
  }
  const maxVisibleId = Object.keys(cards).reduce((m, id) => Math.max(m, Number(id)), 0)
  let nextId = Math.max(SYNTHETIC_ID_BASE, maxVisibleId + 1)
  let r = rng
  const players: PlayerState[] = []
  for (const p of [0, 1] as const) {
    const f = view.fields[p]
    const visibleIds = [...f.forwards.map((c) => c.id), ...f.backups.map((c) => c.id), ...f.damageZone, ...f.breakZone, ...(p === view.me ? view.hand : [])]
    const visibleCodes = visibleIds.map((id) => { const c = view.cards[id]; if (!c) throw new Error(`view lacks visible card ${id}`); return c.code })
    const unseen = removeVisible(decks[p], visibleCodes, p)
    const [order, r2] = shuffle(r, unseen); r = r2
    const mint = (code: string): CardId => { const id = nextId++; cards[id] = { id, code, owner: p }; return id }
    let hand: CardId[]
    let deck: CardId[]
    if (p === view.me) { hand = view.hand; deck = order.map(mint) }
    else { hand = order.slice(0, f.handCount).map(mint); deck = order.slice(f.handCount).map(mint) }
    if (deck.length !== f.deckCount || hand.length !== f.handCount) throw new Error(`deck list for player ${p} is inconsistent with the view (unseen ${unseen.length}, expected hand ${f.handCount} + deck ${f.deckCount})`)
    players.push({ deck, hand, forwards: f.forwards, backups: f.backups, damageZone: f.damageZone, breakZone: f.breakZone, mulliganDecided: view.mulliganDecided[p] })
  }
  const state: GameState = {
    rng: r, turn: view.turn, turnPlayer: view.turnPlayer, firstPlayer: view.firstPlayer, phase: view.phase, attack: view.attack,
    priority: view.priority, pending: view.pending, players: [players[0]!, players[1]!], cards, defs: view.defs, result: view.result,
  }
  return [structuredClone(state), r]
}
