import { describe, expect, it } from 'vitest'
import { apply } from '../src/apply.js'
import { drawCards } from '../src/draw.js'
import { dealPlayerDamage, runRuleProcesses } from '../src/rules.js'
import type { GameEndCause, GameResult } from '../src/state.js'
import { makeGame } from './helpers.js'

/**
 * Every way a game can end, and the exact result each producer emits.
 *
 * Two properties, and the difference between them is the whole point. Collecting the causes that appear
 * anywhere proves only that the producers are SURJECTIVE over the enum — swap two construction sites' causes
 * and the set is identical, so a test built that way passes while `concede` reports `deckOut`. Each producer
 * is therefore asserted individually, against a hand-written expected result.
 *
 * The `reason` strings are pinned here too, in full. The terminal prints them, citation and all, and there
 * are five independently written ones: checking a single cause would let any of the other four lose its
 * citation or change its wording unnoticed.
 */

/** Seven damage for one player, taken off their own deck, as the damage zone really fills. */
const atSeven = (s: ReturnType<typeof makeGame>, p: 0 | 1) => ({
  ...s,
  players: s.players.map((ps, i) =>
    i === p ? { ...ps, damageZone: ps.deck.slice(0, 7), deck: ps.deck.slice(7) } : ps) as typeof s.players,
})

/** The seats, so every player-dependent producer is checked from both. */
const SEATS = [0, 1] as const

/** With `p`'s deck emptied. */
const noDeck = (s: ReturnType<typeof makeGame>, p: 0 | 1) => ({
  ...s,
  players: s.players.map((ps, i) => (i === p ? { ...ps, deck: [] } : ps)) as typeof s.players,
})

describe('every game-ending producer sets its own cause', () => {
  // Both seats at every player-dependent producer. Checking only player 0 leaves the WINNER unpinned: a
  // mutant replacing `opponentOf(p)` with a literal `1` makes player 1 win when player 1 decks out — a
  // semantically wrong result that still typechecks, and which passed all 827 tests. The loser is the
  // interesting half of these results and it only shows up under symmetry.
  for (const p of SEATS) {
    const other = (1 - p) as 0 | 1

    it(`concede — §2.1, player ${p}`, () => {
      expect(apply(makeGame(), { type: 'concede', player: p }).state.result).toEqual<GameResult>({
        winner: other, cause: 'concede', reason: `player ${p} conceded (§2.1)`,
      })
    })

    it(`deck-out — §3.1.2, player ${p}`, () => {
      expect(drawCards(noDeck(makeGame(), p), p, 1)[0].result).toEqual<GameResult>({
        winner: other, cause: 'deckOut', reason: `player ${p} could not draw a card (§3.1.2)`,
      })
    })

    it(`seven damage — §12.4.1, player ${p}`, () => {
      expect(runRuleProcesses(atSeven(makeGame(), p))[0].result).toEqual<GameResult>({
        winner: other, cause: 'damage', reason: `player ${p} has 7 damage (§12.4.1)`,
      })
    })

    it(`damage with an empty deck — §3.1.3, player ${p}`, () => {
      expect(dealPlayerDamage(noDeck(makeGame(), p), p, null)[0].result).toEqual<GameResult>({
        winner: other, cause: 'damageWithEmptyDeck', reason: `player ${p} took damage with an empty deck (§3.1.3)`,
      })
    })
  }

  it('both at seven is a draw — §3.3', () => {
    // NOT reachable through legal play, and that is worth stating rather than implying. The engine branch is
    // required by §3.3, but nothing damages both players at once: `dealPlayerDamage` takes a single victim
    // and rule processes run after each landed point. So the RESULT here is engine-produced — it is
    // `runRuleProcesses` that builds it — while its INPUT is synthetic, a state no command sequence reaches.
    const both = atSeven(atSeven(makeGame(), 0), 1)
    expect(runRuleProcesses(both)[0].result).toEqual<GameResult>({
      winner: null, cause: 'bothReachedSeven', reason: 'both players reached 7 damage (§3.3)',
    })
  })
})

describe('the GameEndCause union', () => {
  it('has an entry here for every member, so a sixth ending cannot be added silently', () => {
    // Exhaustive by construction: `Record<GameEndCause, …>` fails to COMPILE if a cause is added without a
    // line here, which is the check a runtime assertion over collected values cannot make.
    const covered: Record<GameEndCause, string> = {
      damage: '§12.4.1', concede: '§2.1', deckOut: '§3.1.2',
      damageWithEmptyDeck: '§3.1.3', bothReachedSeven: '§3.3',
    }
    expect(Object.keys(covered)).toHaveLength(5)
  })
})
