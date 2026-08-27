import type { PlayerId } from './types.js'
import { opponentOf } from './types.js'
import type { GameState } from './state.js'
import { updatePlayer } from './state.js'
import type { Event } from './events.js'

/**
 * Drawing, in a module that depends on nothing but state (spec C3-9).
 *
 * This used to live in `phases.ts`, which is unreachable from `resolve.ts`: `phases.ts` imports
 * `enterAttackDeclaration` from `resolve.ts`, so importing back would be a cycle. Miner's "Draw 1 card" is an
 * ability effect and therefore resolves inside `resolve.ts`, which is what forced the extraction. Both
 * callers share this one implementation so the §3.1.2 empty-deck rule cannot drift between them.
 */
export function drawCards(state: GameState, p: PlayerId, n: number): [GameState, Event[]] {
  const ps = state.players[p]
  if (ps.deck.length < n) {
    // §3.1.2 — attempting to draw from an empty deck loses; the cards that COULD be drawn are still drawn.
    const s = updatePlayer(state, p, (q) => ({ ...q, deck: [], hand: [...q.hand, ...q.deck] }))
    return [
      { ...s, result: { winner: opponentOf(p), reason: `player ${p} could not draw a card (§3.1.2)` } },
      [{ type: 'drew', player: p, count: ps.deck.length }],
    ]
  }
  const s = updatePlayer(state, p, (q) => ({ ...q, deck: q.deck.slice(n), hand: [...q.hand, ...q.deck.slice(0, n)] }))
  return [s, [{ type: 'drew', player: p, count: n }]]
}
