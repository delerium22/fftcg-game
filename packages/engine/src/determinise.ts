import type { PlayerId } from './types.js'
import type { CardId, CardInstance, GameState, PlayerState } from './state.js'
import type { PlayerView } from './view.js'
import { shuffle, type Rng } from './rng.js'
import { effectAtPath } from './abilities.js'
import { abilityOf, resolveChosenSpec, targetCandidates } from './resolve.js'

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
    // A Summon this player OWNS that is on the stack (rung J1) is out of their hand and deck, public, and
    // keeps its id — leaving it out would deal its code back into the unseen multiset, a 51-card game.
    const placing = view.resolution.placing?.item
    const onStack = [...view.stack, ...(placing ? [placing] : [])].flatMap((item) => (item.kind === 'summon' && view.cards[item.card]?.owner === p ? [item.card] : []))
    const visibleIds = [...f.forwards.map((c) => c.id), ...f.backups.map((c) => c.id), ...f.damageZone, ...f.breakZone, ...f.removedFromGame, ...knownDeck, ...onStack, ...f.lbDeck.map((x) => x.id), ...(p === view.me ? view.hand : [])]
    // Rung J8: LB cards are never in the main-deck list, so their codes are not subtracted from the unseen multiset.
    const visibleCodes = visibleIds.map((id) => { const c = view.cards[id]; if (!c) throw new Error(`view lacks visible card ${id}`); return c.code }).filter((code) => view.defs[code]?.limitBreak === undefined)
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
    players.push({ deck, hand, lbDeck: [...f.lbDeck], forwards: f.forwards, backups: f.backups, damageZone: f.damageZone, breakZone: f.breakZone, removedFromGame: f.removedFromGame, putIntoBreakZoneFromFieldThisTurn: [...f.putIntoBreakZoneFromFieldThisTurn], mulliganDecided: view.mulliganDecided[p] })
  }
  const state: GameState = {
    rng: r, turn: view.turn, turnPlayer: view.turnPlayer, firstPlayer: view.firstPlayer, phase: view.phase, attack: view.attack,
    priority: view.priority, pending: view.pending, resolution: view.resolution, stack: view.stack, passes: view.passes,
    players: [players[0]!, players[1]!], cards, knownBy, defs: view.defs, result: view.result,
  }
  // Everything EXCEPT `defs` is copied; `defs` travels by reference (spec D4).
  //
  // The card database is immutable reference data — built once by `loadCards`, thereafter only read by code,
  // key and ability id — and it is 17.9 KiB against 4.9 KiB for the whole rest of the state. Cloning it here
  // made `structuredClone` 12 % of ALL search CPU, because this runs once per iteration, 200 times per
  // decision: a deep copy of the entire card list, 200 times, for a value that never changes.
  //
  // The rest of the clone stays. It is not needed by the search — `apply` is immutable and the search only
  // reads — but this returns an exported, mutable `GameState`, and without it the result would alias the
  // caller's own view down to its `FieldCard`s and `resolution`. That is an API boundary, not an
  // optimisation, so it is kept even where it is not computationally required.
  const { defs, ...rest } = rebuildHiddenPending(state)
  return [{ ...structuredClone(rest), defs }, r]
}

/**
 * Rung V1-A2 (spec V1-D11, R4): a select this viewer saw `hidden` — over the other player's hand — gets candidates
 * again, computed from the suspended node against the SAMPLED hand, the way the engine computed them when it raised
 * the prompt. The flag stays, so the search keys the pending by its bounds alone. `min` clamps to the sample as `max`
 * does: a printed min of 1 over a sample with no match becomes 0 — a determinisation simplification no pool select
 * reaches (every hand select in the pool is "you may", min 0, or unfiltered).
 */
function rebuildHiddenPending(state: GameState): GameState {
  const pending = state.pending
  const frame = state.resolution.active
  if (pending?.kind !== 'chooseTargets' || pending.hidden !== true || !frame) return state
  const ability = abilityOf(state, frame)
  const node = ability ? effectAtPath(ability.effects, frame.path, frame.modes) : null
  if (node?.kind !== 'chooseTargets') return state
  const candidates = targetCandidates(state, frame.source, frame.controller, resolveChosenSpec(state, node.from, frame.chosen))
  return { ...state, pending: { ...pending, candidates, min: Math.min(node.min, candidates.length), max: Math.min(node.max, candidates.length), hidden: true } }
}
