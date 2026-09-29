import { describe, expect, it } from 'vitest'
import { checkInvariants } from '../src/invariants.js'
import { viewFor } from '../src/view.js'
import { determinise, SYNTHETIC_ID_BASE } from '../src/determinise.js'
import { learn } from '../src/state.js'
import { seedRng } from '../src/rng.js'
import { drainResolution, enqueueTrigger } from '../src/resolve.js'
import type { Ability, CardId, GameState, PlayerId } from '../src/index.js'
import { DEFAULT_DECK, VANILLA_POOL, makeDef, makeGame, withField, withHand, withHandSize } from './helpers.js'

/**
 * Rung V1-E: a card revealed and then kept in a hand stays known to the opponent (§15.1.1.8.1 reveals what a search
 * finds; §7 keeps the hand hidden otherwise). The knowledge bit already existed (spec C9-5); this rung surfaces it.
 */
const DECKS: [string[], string[]] = [DEFAULT_DECK, DEFAULT_DECK]

const codesOf = (s: GameState, p: PlayerId): string[] => {
  const q = s.players[p]
  return [...q.deck, ...q.hand, ...q.forwards.map((c) => c.id), ...q.backups.map((c) => c.id), ...q.damageZone, ...q.breakZone, ...q.removedFromGame].map((id) => s.cards[id]!.code).sort()
}

describe('a known card in the other player\'s hand is surfaced (V1-E, E-D1)', () => {
  /** Player 1's hand of five, of which the first two are known to player 0 — as if revealed and then kept. */
  function revealedTwo(): { s: GameState; known: CardId[]; unknown: CardId[] } {
    const s0 = makeGame({ defs: VANILLA_POOL, decks: DECKS })
    const hand = s0.players[1].hand
    expect(hand.length, 'the fixture needs a full opening hand').toBe(5)
    const known = hand.slice(0, 2)
    return { s: learn(s0, [0, 1], known), known, unknown: hand.slice(2) }
  }

  it('names the known cards to the other seat, carries their instances, and keeps the rest opaque', () => {
    const { s, known, unknown } = revealedTwo()
    const v = viewFor(s, 0)
    expect(v.fields[1].knownHand).toEqual(known)
    expect(v.fields[1].handCount).toBe(5)
    for (const id of known) expect(v.cards[id], `known ${id} has no instance`).toEqual(s.cards[id])
    for (const id of unknown) expect(v.cards[id], `unknown ${id} leaked`).toBeUndefined()
    for (const id of known) expect(v.knownBy[id]).toBe(3)
  })

  it('is empty for the viewer\'s own seat — they see their whole hand', () => {
    const { s } = revealedTwo()
    expect(viewFor(s, 1).fields[1].knownHand).toEqual([])
    expect(viewFor(s, 1).fields[0].knownHand).toEqual([])
    expect(viewFor(s, 0).fields[0].knownHand).toEqual([])
  })

  it('does not surface a card known only to its owner', () => {
    const s0 = makeGame({ defs: VANILLA_POOL, decks: DECKS })
    const s = learn(s0, [1], s0.players[1].hand.slice(0, 2))
    expect(viewFor(s, 0).fields[1].knownHand).toEqual([])
  })

  /**
   * R1 (review H1): the V1-A2 redaction keyed on VISIBILITY, so once the known ids became visible a select whose filter
   * matched only them would have shown its candidates — and so told the other seat that the unknown cards fail it.
   */
  it('a select over that hand stays hidden even when every candidate is a known card (R1)', () => {
    const SELECT: Ability = { id: 'T-SEL:etb', trigger: { kind: 'enterField' }, text: 'synthetic select',
      effects: [{ kind: 'chooseTargets', select: 'self', min: 0, max: 1, from: { zone: 'hand', controller: 'self', filter: { type: 'forward', cost: 3 } }, then: [{ kind: 'playOntoField' }] }] }
    const DEFS = [...VANILLA_POOL, makeDef({ code: 'T-SEL', cost: 0, power: 1000, hasAbilities: true, abilityClauses: 1, abilities: [SELECT] })]
    let s = withHandSize(makeGame({ defs: DEFS, decks: DECKS }), 1, 0)
    let a: CardId, b: CardId, src: CardId
    ;[s, a] = withHand(s, 1, 'V-F5')    // cost 3
    ;[s, b] = withHand(s, 1, 'V-F5')
    ;[s] = withHand(s, 1, 'V-F1')       // cost 1: fails the filter, unknown
    ;[s, src] = withField(s, 1, 'forwards', 'T-SEL')
    s = learn(s, [0, 1], [a, b])
    s = drainResolution(enqueueTrigger(s, src, 1, SELECT))[0]
    const live = s.pending as Extract<GameState['pending'], { kind: 'chooseTargets' }>
    expect([...live.candidates].sort()).toEqual([a, b].sort())
    expect(viewFor(s, 0).fields[1].knownHand).toEqual([a, b])
    expect(viewFor(s, 0).pending).toEqual({ kind: 'chooseTargets', player: 1, min: live.min, max: live.max, candidates: [], hidden: true })
    expect(viewFor(s, 1).pending).toEqual(live)
  })
})

describe('determinisation pins the known hand cards (V1-E, E-D2, Review Focus 3)', () => {
  it('from the opponent\'s seat: exactly the two known ids, three sampled, conservation and invariants hold', () => {
    const s0 = makeGame({ defs: VANILLA_POOL, decks: DECKS })
    const known = s0.players[1].hand.slice(0, 2)
    const s = learn(s0, [0, 1], known)
    const view = viewFor(s, 0)
    for (const seed of [1, 2, 3, 4, 5]) {
      const [det] = determinise({ view, decks: DECKS, rng: seedRng(seed) })
      const hand = det.players[1].hand
      expect(hand.length, `seed ${seed}`).toBe(5)
      expect(hand.filter((id) => known.includes(id)).sort(), `seed ${seed}`).toEqual([...known].sort())
      for (const id of known) expect(det.cards[id]!.code).toBe(s.cards[id]!.code)
      for (const id of known) expect(det.knownBy[id], `seed ${seed}: the reveal was forgotten`).toBe(3)
      expect(hand.filter((id) => !known.includes(id)).every((id) => id >= SYNTHETIC_ID_BASE), `seed ${seed}: three sampled`).toBe(true)
      // A known card's code is out of the unseen multiset: dealing it again would make a 51-card game.
      expect(codesOf(det, 1), `seed ${seed}`).toEqual(codesOf(s, 1))
      expect(codesOf(det, 0), `seed ${seed}`).toEqual(codesOf(s, 0))
      expect(checkInvariants(det), `seed ${seed}`).toEqual([])
    }
  })

  it('throws when a known code is absent from the declared list', () => {
    const s0 = makeGame({ defs: VANILLA_POOL, decks: DECKS })
    const s = learn(s0, [0, 1], s0.players[1].hand.slice(0, 1))
    const code = s.cards[s.players[1].hand[0]!]!.code
    const short = DEFAULT_DECK.filter((c) => c !== code)
    expect(() => determinise({ view: viewFor(s, 0), decks: [DEFAULT_DECK, short], rng: seedRng(1) })).toThrow(/does not contain visible card/)
  })
})
