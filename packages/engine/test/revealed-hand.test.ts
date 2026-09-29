import { describe, expect, it } from 'vitest'
import { checkInvariants } from '../src/invariants.js'
import { viewFor } from '../src/view.js'
import { determinise, SYNTHETIC_ID_BASE } from '../src/determinise.js'
import { knows, learn } from '../src/state.js'
import { seedRng } from '../src/rng.js'
import { drainResolution, enqueueTrigger } from '../src/resolve.js'
import { apply } from '../src/apply.js'
import { validateEffects } from '../src/setup.js'
import type { Ability, CardDef, CardId, Effect, Event, GameState, PlayerId } from '../src/index.js'
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

const etb = (id: string, effects: readonly Effect[]): Ability => ({ id, trigger: { kind: 'enterField' }, text: `synthetic ${id}`, effects })
const bearer = (code: string, a: Ability): CardDef => makeDef({ code, type: 'backup', power: null, cost: 1, hasAbilities: true, abilityClauses: 1, abilities: [a] })

/** Run `a` for `controller` from a fresh game, answering a deck prompt with `picks`; the events of the answer are returned. */
function resolve(a: Ability, controller: PlayerId, picks: number[] | null, prepare: (s: GameState) => GameState = (x) => x): { s: GameState; events: Event[] } {
  const code = a.id.split(':')[0]!
  let s = prepare(makeGame({ defs: [...VANILLA_POOL, bearer(code, a)], decks: DECKS }))
  let src: CardId
  ;[s, src] = withField(s, controller, 'backups', code)
  s = drainResolution(enqueueTrigger(s, src, controller, a))[0]
  if (picks === null) return { s, events: [] }
  expect(s.pending?.kind, 'the search did not ask').toBe('chooseFromDeck')
  const r = apply(s, { type: 'chooseFromDeck', player: controller, picks })
  return { s: r.state, events: r.events }
}

describe('a search reveals the card it takes (V1-E, E-D5, §15.1.1.8.1)', () => {
  const search = (revealTaken: boolean): Ability => etb('T-SRCH:etb', [{
    kind: 'lookAtDeck', count: 'all', audience: 'self', take: { min: 0, max: 1, filter: { name: 'V-F8' } }, to: 'hand', rest: 'shuffle',
    ...(revealTaken ? { revealTaken: true as const } : {}),
  }])
  /** The index of the first V-F8 in player 0's deck, read off the state the prompt was raised in. */
  const firstF8 = (s: GameState): number => s.players[0].deck.findIndex((id) => s.cards[id]!.code === 'V-F8')

  it('the opponent learns the taken card, and only it: no deck card is known to anyone after the shuffle (Review Focus 5)', () => {
    const asked = resolve(search(true), 0, null).s
    const i = firstF8(asked)
    const taken = asked.players[0].deck[i]!
    const { s, events } = resolve(search(true), 0, [i])
    expect(s.players[0].hand).toContain(taken)
    expect(knows(s, 1, taken), 'the reveal did not reach the opponent').toBe(true)
    expect(knows(s, 0, taken), 'the shuffle forgot the card that had already left the deck').toBe(true)
    for (const id of s.players[0].deck) expect(s.knownBy[id], `deck card ${id} still known after the shuffle`).toBeUndefined()
    expect(viewFor(s, 1).fields[0].knownHand).toEqual([taken])
    expect(events).toContainEqual({ type: 'addedToHand', player: 0, card: taken, revealed: true })
    expect(checkInvariants(s)).toEqual([])
  })

  it('without revealTaken the take stays private, as before', () => {
    const asked = resolve(search(false), 0, null).s
    const i = firstF8(asked)
    const taken = asked.players[0].deck[i]!
    const { s, events } = resolve(search(false), 0, [i])
    expect(knows(s, 1, taken)).toBe(false)
    expect(viewFor(s, 1).fields[0].knownHand).toEqual([])
    expect(events).toContainEqual({ type: 'addedToHand', player: 0, card: taken })
  })

  it('taking nothing reveals nothing', () => {
    const { s, events } = resolve(search(true), 0, [])
    expect(viewFor(s, 1).fields[0].knownHand).toEqual([])
    expect(events.some((e) => e.type === 'addedToHand')).toBe(false)
  })

  it('game creation refuses revealTaken on a search that does not take to hand (R5)', () => {
    const toField = etb('T-FLD:etb', [{ kind: 'lookAtDeck', count: 'all', audience: 'self', take: { min: 0, max: 1 }, to: 'field', rest: 'shuffle', revealTaken: true }])
    const toHand = search(true)
    const problems = validateEffects([bearer('T-FLD', toField), bearer('T-SRCH', toHand)]).join('; ')
    expect(problems).toMatch(/T-FLD:etb reveals the taken card of a search that does not take to hand/)
    expect(problems).not.toMatch(/T-SRCH/)
  })
})

describe('a card that returns to a hand from a public zone is known to both players (V1-E, R2, Review Focus 1)', () => {
  it('a Forward never exposed before it entered the field, bounced: known, and surfaced to the other seat', () => {
    // Put onto player 1's field straight from nowhere — no reveal, no look — so the bit can only come from the bounce.
    let bounced: CardId = -1
    const bounce = etb('T-BNC:etb', [{ kind: 'forEach', from: { zone: 'forwards', controller: 'opponent' }, do: [{ kind: 'moveToHand' }] }])
    const { s } = resolve(bounce, 0, null, (x) => { let t: GameState; [t, bounced] = withField(x, 1, 'forwards', 'V-F2'); return t })
    expect(s.players[1].hand).toContain(bounced)
    expect(knows(s, 0, bounced) && knows(s, 1, bounced)).toBe(true)
    expect(viewFor(s, 0).fields[1].knownHand).toEqual([bounced])
    expect(checkInvariants(s)).toEqual([])
  })

  it('a card returned from the Break Zone: the same', () => {
    let back: CardId = -1
    const retrieve = etb('T-RET:etb', [{ kind: 'forEach', from: { zone: 'breakZone', controller: 'self' }, do: [{ kind: 'moveToHand' }] }])
    const { s } = resolve(retrieve, 1, null, (x) => {
      const ps = x.players[1]
      back = ps.deck[0]!
      const players: GameState['players'] = [x.players[0], { ...ps, deck: ps.deck.slice(1), breakZone: [...ps.breakZone, back] }]
      return { ...x, players }
    })
    expect(s.players[1].hand).toContain(back)
    expect(viewFor(s, 0).fields[1].knownHand).toEqual([back])
  })
})

describe('deck-slot knowledge surfaces when the card is drawn (V1-E, R6)', () => {
  /** Player 0's deck cut to three, the top two exposed and sent to the bottom, then all three drawn. */
  const lookThenDraw = (audience: 'self' | 'all'): { s: GameState; exposed: CardId[] } => {
    let exposed: CardId[] = []
    const look = etb('T-LOOK:etb', [
      { kind: 'lookAtDeck', count: 2, audience, take: { min: 0, max: 0 }, to: 'hand', rest: 'bottom' },
      { kind: 'draw', count: 3 },
    ])
    const { s } = resolve(look, 0, [], (x) => {
      const ps = x.players[0]
      exposed = ps.deck.slice(0, 2)
      const players: GameState['players'] = [{ ...ps, deck: ps.deck.slice(0, 3) }, x.players[1]]
      return { ...x, players }
    })
    for (const id of exposed) expect(s.players[0].hand, 'the fixture did not draw the exposed cards').toContain(id)
    return { s, exposed }
  }

  it("Miner's reveal: the two revealed cards, sent to the bottom and drawn, stay known to the opponent", () => {
    const { s, exposed } = lookThenDraw('all')
    expect([...viewFor(s, 1).fields[0].knownHand].sort()).toEqual([...exposed].sort())
  })

  it('a private look: the looked-at cards, drawn, do NOT surface to the opponent', () => {
    const { s } = lookThenDraw('self')
    expect(viewFor(s, 1).fields[0].knownHand).toEqual([])
  })
})
