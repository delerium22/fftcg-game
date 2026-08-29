import { describe, expect, it } from 'vitest'
import { viewFor, type CardId, type FieldCard, type PlayerView } from '@fftcg/engine'
import { apply, actingPlayer, createGame, type GameState } from '@fftcg/engine'
import { CARD_DEFS, DECKS } from '../src/deck.js'
import { promptFor } from '../src/game/commands.js'
import { GreedyAgent } from '@fftcg/ai'
import { stepAi } from '../src/game/useGame.js'
import { AI, HUMAN } from '../src/game/types.js'

/** `createGame` deals nothing — hands only exist once the first-player choice is answered (§8.2.1.3). */
function dealtGame(seed: number): GameState {
  const state = createGame({ seed, decks: DECKS, defs: CARD_DEFS })
  return apply(state, { type: 'chooseFirst', player: actingPlayer(state)!, goFirst: true }).state
}

/**
 * The block prompt names the attacker and its power.
 *
 * It used to read "Choose a blocker", full stop — no attacker, no power. Found by playing: the AI cast
 * Lightning, broke my Forward with its ETB, gave itself Haste, and swung, and the browser named nothing.
 * A player deciding whether to trade a Forward for a point of damage needs to know what is coming.
 */

const CLOUD = '27-124S'      // 7000 Forward
const LUSO = '27-125S'       // 3000 Forward
const LIGHTNING = '27-127S'  // 9000 Forward

/**
 * Puts `code` on the AI's field as a declared attacker, and returns its instance id.
 *
 * NO `as never`. The first version of this helper used casts, and they hid a fixture describing a state the
 * engine cannot produce: attackers left `active` though `applyDeclareAttack` dulls them, a `zone` field
 * `CardInstance` does not have, a missing required `usedThisTurn`, and invented `pending.candidates`. A
 * fixture that cannot occur proves nothing, and a cast is what let it look fine. Typed exactly, it cannot.
 */
function attacker(v: PlayerView, id: CardId, code: string, over: Partial<FieldCard> = {}): CardId {
  const def = CARD_DEFS.find((d) => d.code === code)
  expect(def, `no card ${code} in the pool`).toBeDefined()
  v.cards[id] = { id, code, owner: AI }
  v.defs[code] = def!
  const fc: FieldCard = {
    id,
    // §10.1.2.2 / §15.2.1: declaring an attack dulls the attacker unless it has Brave. None of these do.
    status: 'dull',
    damage: 0, enteredTurn: 0, attackedThisTurn: true,
    granted: [], powerBonus: 0, flags: [], usedThisTurn: [],
    ...over,
  }
  v.fields[AI].forwards = [...v.fields[AI].forwards, fc]
  return id
}

/**
 * A view sitting on a real `declareBlock` question, built to match what the engine would actually hold:
 * the AI is the turn player, its attackers are dulled and flagged, and priority stays with the TURN player
 * behind the pending decision rather than moving to the defender.
 */
function blocking(build: (v: PlayerView) => CardId[]): PlayerView {
  const v = structuredClone(viewFor(dealtGame(1), HUMAN))
  v.fields[AI].forwards = []
  const ids = build(v)
  v.turn = 2
  v.turnPlayer = AI
  v.phase = 'attack'
  v.attack = { step: 'block', attackers: ids, blocker: null }
  // `declareBlock` carries only the player who owes the answer — no candidate list.
  v.pending = { kind: 'declareBlock', player: HUMAN }
  v.priority = AI
  return v
}

describe('the block prompt', () => {
  it('names the attacker and its power', () => {
    const v = blocking((view) => [attacker(view, 901, CLOUD)])
    expect(promptFor(v)).toBe('Choose a blocker for Cloud (power 7000)')
  })

  it('reports EFFECTIVE power, not printed', () => {
    // A pumped attacker. Printed 7000, effective 10000 — if the prompt reads the definition instead of the
    // field card, the two are indistinguishable on an unpumped attacker and this criterion proves nothing.
    const v = blocking((view) => [attacker(view, 901, CLOUD, { powerBonus: 3000 })])
    expect(promptFor(v)).toBe('Choose a blocker for Cloud (power 10000)')
  })

  it('does NOT subtract damage already marked on the attacker', () => {
    // The dangerous mutant, and the reason this case exists: `Card` computes and displays a "remaining"
    // number on the card face, so `effectivePower - damage` looks like the natural thing to report. It is
    // wrong — marked damage does not reduce a Forward's power or the combat damage it deals. A blocker
    // choosing against a damaged 7000 Cloud is still about to eat 7000.
    const v = blocking((view) => [attacker(view, 901, CLOUD, { damage: 5000 })])
    expect(promptFor(v), 'the prompt understated the incoming damage').toBe('Choose a blocker for Cloud (power 7000)')
  })

  it('lists a party member by member, with each power, and never a total', () => {
    // One member pumped so that printed (3000/7000), individual effective (7000/7000) and the sum (14000)
    // are all distinct — otherwise a mutant that sums, or one that reads printed power, could still agree.
    const v = blocking((view) => [
      attacker(view, 901, LUSO, { powerBonus: 4000 }),
      attacker(view, 902, CLOUD),
    ])
    expect(promptFor(v)).toBe('Choose a blocker for Luso (power 7000) and Cloud (power 7000)')
    // No `not.toContain('14000')` here: the exact equality above already implies it, so it could never fail
    // and killed no mutant. A dead assertion is worse than none — it reads like coverage.
  })

  it('lists a THREE-member party without dropping one', () => {
    // Parties are not limited to two: `legalAttackSets` enumerates every legal subset. A `slice(0, 2)` mutant
    // passed all seven earlier tests, including the reached-by-play one, silently omitting an attacker and
    // its power from a decision that turns on exactly those numbers.
    const v = blocking((view) => [
      attacker(view, 901, LUSO),
      attacker(view, 902, CLOUD),
      attacker(view, 903, LIGHTNING),
    ])
    expect(promptFor(v)).toBe('Choose a blocker for Luso (power 3000), Cloud (power 7000) and Lightning (power 9000)')
  })

  it('says nothing about taking damage', () => {
    // Ruled on in plan review: "take 1 damage" is a CR default, not something the engine derives, and card
    // text takes precedence over general rules — so printing it would become a quiet lie with no test
    // watching. This test is that watch.
    const v = blocking((view) => [attacker(view, 901, CLOUD)])
    expect(promptFor(v).toLowerCase()).not.toContain('damage')
  })

  it('falls back rather than throwing when no attacker resolves', () => {
    // Defensive unit case ONLY, and labelled as such: a `declareBlock` pending is raised from attackers the
    // engine has just validated and there is no priority window in which one could leave, so this state is
    // not reachable in play today. Asserting otherwise would be pretending to reach a position that does
    // not exist.
    const v = blocking(() => [])
    expect(promptFor(v)).toBe('Choose a blocker')
  })
})

/**
 * The hand-built fixtures above are only worth anything if the state they describe is one the engine really
 * produces. This reaches a `declareBlock` by PLAYING — greedy against greedy until someone declares an
 * attack — and checks the prompt the browser would show from that genuine position.
 *
 * It also guards the fixture itself: if the engine ever stops putting attacker ids in `attack.attackers`, or
 * stops raising `declareBlock` with the defender on the clock, this fails while the unit cases above would
 * happily keep passing against a state that can no longer occur.
 */
describe('a declareBlock position reached by playing', () => {
  it('names an attacker and a power', () => {
    const agent = new GreedyAgent({ seed: 7, decks: DECKS, depth: 1 })
    let state = createGame({ seed: 7, decks: DECKS, defs: CARD_DEFS })
    let seen: string | null = null
    for (let i = 0; i < 4000 && !state.result && seen === null; i++) {
      const actor = actingPlayer(state)
      if (actor === null) break
      if (state.pending?.kind === 'declareBlock') {
        const v = viewFor(state, state.pending.player)
        seen = promptFor(v)
        break
      }
      state = stepAi(state, agent).state
    }
    expect(seen, 'no block was ever offered in 4000 steps — this test stopped proving anything').not.toBe(null)
    expect(seen, 'the prompt does not name what is attacking').not.toBe('Choose a blocker')
    expect(seen).toMatch(/^Choose a blocker for .+ \(power \d+\)/)
  })
})
