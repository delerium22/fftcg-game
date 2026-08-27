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
  // Rebuilt rather than copied: sampled cards get fresh ids, so the view's mask cannot carry over unchanged.
  const knownBy: Record<CardId, number> = { ...view.knownBy }
  for (const p of [0, 1] as const) {
    for (const code of decks[p]) if (!view.defs[code]) throw new Error(`deck list for player ${p} contains code ${code} which has no definition in view.defs`)
  }
  const maxVisibleId = Object.keys(cards).reduce((m, id) => Math.max(m, Number(id)), 0)
  let nextId = Math.max(SYNTHETIC_ID_BASE, maxVisibleId + 1)
  let r = rng
  const players: PlayerState[] = []
  for (const p of [0, 1] as const) {
    const f = view.fields[p]
    // Removed cards are public and gone. Leaving them out of `visibleIds` would leave their codes in the
    // unseen multiset, and the search would deal them back into a deck — reasoning about a 51-card game.
    // A deck slot whose id this viewer knows is as fixed as a card on the field: it must keep that identity,
    // and its code must come out of the unseen multiset or the sampler will deal a second copy (spec C9-5).
    const knownDeck = f.deck.map((slot) => slot.card).filter((id): id is CardId => id !== null)
    const visibleIds = [...f.forwards.map((c) => c.id), ...f.backups.map((c) => c.id), ...f.damageZone, ...f.breakZone, ...f.removedFromGame, ...knownDeck, ...(p === view.me ? view.hand : [])]
    const visibleCodes = visibleIds.map((id) => { const c = view.cards[id]; if (!c) throw new Error(`view lacks visible card ${id}`); return c.code })
    const unseen = removeVisible(decks[p], visibleCodes, p)
    const [order, r2] = shuffle(r, unseen); r = r2
    const mint = (code: string): CardId => { const id = nextId++; cards[id] = { id, code, owner: p }; return id }
    let hand: CardId[]
    let deck: CardId[]
    // Sampled cards fill the slots this viewer does NOT know, IN ORDER, leaving the known ones where they are.
    const fill = (sampled: string[]): CardId[] => {
      const pool = [...sampled]
      const filled = f.deck.map((slot) => {
        if (slot.card !== null) return slot.card
        const code = pool.shift()
        // The length check below cannot see this any more: `fill` always returns one entry per slot, so a
        // deck list that is too SHORT used to be caught by the count and would now quietly mint a card with
        // no code at all. Conservation has to be asserted where the cards actually run out.
        if (code === undefined) throw new Error(`deck list for player ${p} has too few cards for its ${f.deck.length}-card deck`)
        const id = mint(code)
        // The identity is invented, but the FACT that someone knows this position is not. An opponent who
        // looked at their own top three is not guessing, and a determinisation that dropped this would model
        // one who had never looked (spec C9-5).
        if (slot.knownBy !== 0) knownBy[id] = slot.knownBy
        return id
      })
      // ...and too MANY is the other half. The length check below cannot see this either — `fill` returns one
      // entry per slot whatever it is handed — so a surplus deck list used to be swallowed silently, and the
      // simulated player played a deck missing cards their real one holds. Conservation is asserted where the
      // cards actually run out, in both directions.
      if (pool.length !== 0) throw new Error(`deck list for player ${p} has ${pool.length} more cards than its ${f.deck.length}-card deck and ${f.handCount}-card hand can hold`)
      return filled
    }
    if (p === view.me) { hand = view.hand; deck = fill(order) }
    else { hand = order.slice(0, f.handCount).map(mint); deck = fill(order.slice(f.handCount)) }
    if (deck.length !== f.deck.length || hand.length !== f.handCount) throw new Error(`deck list for player ${p} is inconsistent with the view (unseen ${unseen.length}, expected hand ${f.handCount} + deck ${f.deck.length})`)
    players.push({ deck, hand, forwards: f.forwards, backups: f.backups, damageZone: f.damageZone, breakZone: f.breakZone, removedFromGame: f.removedFromGame, putIntoBreakZoneFromFieldThisTurn: [...f.putIntoBreakZoneFromFieldThisTurn], mulliganDecided: view.mulliganDecided[p] })
  }
  const state: GameState = {
    rng: r, turn: view.turn, turnPlayer: view.turnPlayer, firstPlayer: view.firstPlayer, phase: view.phase, attack: view.attack,
    priority: view.priority, pending: view.pending, resolution: view.resolution, players: [players[0]!, players[1]!], cards, knownBy, defs: view.defs, result: view.result,
  }
  return [structuredClone(state), r]
}
