import { describe, expect, it } from 'vitest'
import type { Ability } from '../src/abilities.js'
import type { CardDef } from '../src/types.js'
import type { CardId, GameState } from '../src/state.js'
import { findFieldCard } from '../src/state.js'
import { apply } from '../src/apply.js'
import { castBlocker } from '../src/cast.js'
import { enumeratePayments } from '../src/cp.js'
import { createGame, validateDeck, validateLbDeck } from '../src/setup.js'
import { isLegal, legalCommands } from '../src/legal.js'
import { viewFor } from '../src/view.js'
import { determinise } from '../src/determinise.js'
import { seedRng } from '../src/rng.js'
import { checkInvariants } from '../src/invariants.js'
import { DEFAULT_DECK, endPhase, makeDef, makeGame, passBoth, withField, withHand, withHandSize, VANILLA_POOL } from './helpers.js'

/**
 * Rung J8 (spec J8-D2..D5, CR §7.14, §8.1, §15.2.8): the LB deck is a zone of face-down cards; LB cards are cast
 * from it for their base CP plus X other face-down cards turned face up; an LB card that reaches the hand, Break
 * Zone, main deck or removed-from-play goes on to the LB deck face up at once. Synthetic cards; real passes.
 */

const ok = (s: GameState) => expect(checkInvariants(s)).toEqual([])
const quiet = (s: GameState): GameState => withHandSize(withHandSize(s, 0, 0), 1, 0)
const NO_CP = { dullBackups: [], discards: [] }

const WATCH: Ability = {
  id: 'T-WATCH:draw', trigger: { kind: 'observesZoneChange', from: 'field', to: 'breakZone', whose: 'opponent', of: 'forward' },
  text: 'When a Forward opponent controls is put from the field into the Break Zone, draw 1 card.',
  effects: [{ kind: 'draw', count: 1 }],
}
const BURN: Ability = {
  id: 'T-LB-S:summon', trigger: { kind: 'summonResolve' }, text: 'Choose 1 Forward. Deal it 5000 damage.',
  effects: [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'any' }, then: [{ kind: 'damage', amount: 5000 }] }],
}
const BOUNCE: Ability = {
  id: 'T-BOUNCE:summon', trigger: { kind: 'summonResolve' }, text: 'Choose 1 Forward. Return it to its owner\'s hand.',
  effects: [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'any' }, then: [{ kind: 'moveToHand' }] }],
}
const DEFS: CardDef[] = [
  ...VANILLA_POOL,
  makeDef({ code: 'T-BOUNCE', type: 'summon', cost: 0, power: null, hasAbilities: true, abilityClauses: 1, abilities: [BOUNCE] }),
  makeDef({ code: 'T-LB2', cost: 0, power: 5000, limitBreak: 2, generic: false }),
  makeDef({ code: 'T-LB1', cost: 0, power: 3000, limitBreak: 1 }),
  makeDef({ code: 'T-LB-S', type: 'summon', cost: 0, power: null, limitBreak: 1, hasAbilities: true, abilityClauses: 1, abilities: [BURN] }),
  makeDef({ code: 'T-WATCH', cost: 0, power: 1000, hasAbilities: true, abilityClauses: 1, abilities: [WATCH] }),
]
const LB: string[] = ['T-LB2', 'T-LB1', 'T-LB1', 'T-LB-S']

/** Both players with the same four-card LB deck, player 0 in Main Phase 1 with empty hands. */
function game(): GameState {
  return quiet(makeGame({ defs: DEFS, lbDecks: [LB, LB] }))
}
const lb = (s: GameState, p: 0 | 1) => s.players[p].lbDeck
const lbIds = (s: GameState, p: 0 | 1, code: string) => lb(s, p).filter((x) => s.cards[x.id]!.code === code).map((x) => x.id)

describe('J8 — the LB deck is a zone (§7.14, §8.1)', () => {
  it('is dealt face down in list order, is not shuffled, and is empty when no LB deck is given', () => {
    const s = game()
    expect(lb(s, 0).map((x) => [s.cards[x.id]!.code, x.faceUp])).toEqual([['T-LB2', false], ['T-LB1', false], ['T-LB1', false], ['T-LB-S', false]])
    expect(lb(s, 1)).toHaveLength(4)
    expect(makeGame().players[0].lbDeck).toEqual([])
    ok(s)
  })
  it('§8.1.1.1/.2/.3 — refuses nine cards, four copies, a non-LB card in the LB deck, and an LB card in the main deck', () => {
    const defs = Object.fromEntries(DEFS.map((d) => [d.code, d]))
    expect(validateLbDeck(defs, Array(9).fill('T-LB1'))).toContainEqual(expect.stringContaining('eight'))
    expect(validateLbDeck(defs, ['T-LB1', 'T-LB1', 'T-LB1', 'T-LB1'])).toContainEqual(expect.stringContaining('3 copies'))
    expect(validateLbDeck(defs, ['V-F1'])).toContainEqual(expect.stringContaining('Limit Break'))
    expect(validateLbDeck(defs, LB)).toEqual([])
    expect(validateDeck(defs, [...DEFAULT_DECK.slice(1), 'T-LB1'])).toContainEqual(expect.stringContaining('Limit Break'))
    expect(() => createGame({ seed: 1, decks: [DEFAULT_DECK, DEFAULT_DECK], defs: DEFS, lbDecks: [['V-F1'], []] })).toThrow(/Limit Break/)
  })
})

describe('J8 — casting from the LB deck (§15.2.8.3)', () => {
  it('a face-down LB card is castable in the Main Phase for its base CP plus exactly X other face-down cards turned face up', () => {
    let s = game()
    const [lb2] = lbIds(s, 0, 'T-LB2')
    const others = lbIds(s, 0, 'T-LB1')
    expect(castBlocker(s, 0, lb2!)).toBeNull()
    const casts = legalCommands(s, 0).filter((c) => c.type === 'castCharacter' && c.card === lb2)
    expect(casts.length, 'one canonical flip subset per CP payment (review M2); any other is legal below').toBe(1)
    for (const c of casts) if (c.type === 'castCharacter') expect(c.payment.lbFlip).toHaveLength(2)
    expect(legalCommands(s, 0).filter((c) => c.type === 'castCharacter' && c.card === lb2).every((c) => c.type === 'castCharacter' && !!c.payment.lbFlip && isLegal(s, { ...c, payment: { ...c.payment, lbFlip: [others[1]!, lbIds(s, 0, 'T-LB-S')[0]!] } }) === null), 'a different pair of others is legal too').toBe(true)
    const r = apply(s, { type: 'castCharacter', player: 0, card: lb2!, payment: { ...NO_CP, lbFlip: others } })
    expect(findFieldCard(r.state, lb2!)?.owner).toBe(0)
    expect(lb(r.state, 0).map((x) => [r.state.cards[x.id]!.code, x.faceUp]), 'the cast card left; the two flipped are face up').toEqual([['T-LB1', true], ['T-LB1', true], ['T-LB-S', false]])
    expect(r.events).toContainEqual({ type: 'lbFlipped', player: 0, cards: others })
    expect(r.events).toContainEqual(expect.objectContaining({ type: 'cast', card: lb2, from: 'lbDeck' }))
    ok(r.state)
    s = r.state
  })
  it('refuses a wrong flip count, a face-up flip, the card flipping itself, and a card with too few others left; a face-up card is not castable', () => {
    let s = game()
    const [lb2] = lbIds(s, 0, 'T-LB2')
    const [one, two] = lbIds(s, 0, 'T-LB1')
    const [summon] = lbIds(s, 0, 'T-LB-S')
    const cast = (flip: CardId[]) => () => apply(s, { type: 'castCharacter', player: 0, card: lb2!, payment: { ...NO_CP, lbFlip: flip } })
    expect(cast([one!])).toThrow(/2/)
    expect(cast([one!, lb2!])).toThrow(/itself|face-down/)
    expect(cast([one!, one!])).toThrow(/distinct|face-down|twice/)
    // Flip one face up by casting the LB-1 card first; then the LB-2 card has only two others left, one face up.
    s = apply(s, { type: 'castCharacter', player: 0, card: one!, payment: { ...NO_CP, lbFlip: [two!] } }).state
    expect(castBlocker(s, 0, two!), 'face up: spent (review L4)').toBe('lbSpent')
    expect(castBlocker(s, 0, lb2!), 'only the Summon is still face down: one short').toBe('lbCost')
    expect(() => apply(s, { type: 'castCharacter', player: 0, card: lb2!, payment: { ...NO_CP, lbFlip: [two!, summon!] } })).toThrow(/face-down/)
    ok(s)
  })
  it('an LB Summon on the stack at game over goes to the LB deck face up, not the Break Zone (review M1)', () => {
    let s = game()
    let victim: CardId
    ;[s, victim] = withField(s, 1, 'forwards', 'V-F2')
    const [summon] = lbIds(s, 0, 'T-LB-S')
    const [flip] = lbIds(s, 0, 'T-LB1')
    let t = apply(s, { type: 'castSummon', player: 0, card: summon!, payment: { ...NO_CP, lbFlip: [flip!] } }).state
    t = apply(t, { type: 'chooseTargets', player: 0, targets: [victim] }).state
    expect(t.stack).toHaveLength(1)
    const over = apply(t, { type: 'concede', player: 1 }).state   // the Summon is still waiting
    expect(over.result?.winner).toBe(0)
    expect(over.players[0].breakZone).not.toContain(summon)
    expect(lb(over, 0).find((x) => x.id === summon)?.faceUp, '§15.2.8.4.3 holds at game over too').toBe(true)
    ok(over)
  })

  it('enumeratePayments lists one canonical flip subset per CP payment; a hand card never carries lbFlip', () => {
    let s = game()
    let hand: CardId
    ;[s, hand] = withHand(s, 0, 'V-F1')
    for (const p of enumeratePayments(s, 0, hand)) expect(p.lbFlip).toBeUndefined()
    const [lb1] = lbIds(s, 0, 'T-LB1')
    const flips = enumeratePayments(s, 0, lb1!).map((p) => p.lbFlip)
    expect(flips, 'one CP payment (free), one canonical flip').toHaveLength(1)
    for (const f of flips) { expect(f).toHaveLength(1); expect(f).not.toContain(lb1) }
  })
})

describe('J8 — the return (§15.2.8.4)', () => {
  it('an LB Forward broken in battle reaches the Break Zone — a watcher fires — and is in the LB deck face up when the command returns', () => {
    let s = quiet(endPhase(makeGame({ defs: DEFS, lbDecks: [LB, LB] })))   // player 0's declaration step
    const [lb2] = lbIds(s, 0, 'T-LB2')
    const others = lbIds(s, 0, 'T-LB1')
    // Put the LB card on the field by hand (its cast is proven above), then attack into a 7000 blocker.
    s = { ...s, players: [{ ...s.players[0], lbDeck: s.players[0].lbDeck.filter((x) => x.id !== lb2), forwards: [...s.players[0].forwards, { id: lb2!, status: 'active', damage: 0, enteredTurn: 0, attackedThisTurn: false, granted: [], powerBonus: 0, flags: [], usedThisTurn: [] }] }, s.players[1]] }
    let blocker: CardId, watcher: CardId
    ;[s, blocker] = withField(s, 1, 'forwards', 'V-F3')
    ;[s, watcher] = withField(s, 1, 'forwards', 'T-WATCH')
    ok(s)
    let t = apply(s, { type: 'declareAttack', player: 0, attackers: [lb2!] }).state
    t = passBoth(t).state
    t = apply(t, { type: 'declareBlock', player: 1, blocker }).state
    const r = passBoth(t)
    expect(findFieldCard(r.state, lb2!), '5000 into 7000: broken').toBeNull()
    expect(r.state.players[0].breakZone, 'not in the Break Zone any more').not.toContain(lb2)
    expect(lb(r.state, 0).find((x) => x.id === lb2)?.faceUp, 'in the LB deck, face up').toBe(true)
    expect(r.events.map((e) => e.type)).toContain('broken')
    expect(r.events).toContainEqual({ type: 'lbReturned', player: 0, card: lb2, from: 'breakZone' })
    expect(r.state.stack.map((i) => (i.kind === 'ability' ? i.frame.abilityId : 'summon')), '§15.2.8.4.2: the Break Zone arrival was watched').toEqual(['T-WATCH:draw'])
    expect(r.state.players[0].putIntoBreakZoneFromFieldThisTurn).not.toContain(lb2)
    ok(r.state)
    expect(others).toHaveLength(2)
    void watcher
  })
  it('an LB Summon resolves, goes to the Break Zone by §11.11.10, and is in the LB deck face up at once', () => {
    let s = game()
    let victim: CardId
    ;[s, victim] = withField(s, 1, 'forwards', 'V-F2')
    const [summon] = lbIds(s, 0, 'T-LB-S')
    const [flip] = lbIds(s, 0, 'T-LB1')
    let t = apply(s, { type: 'castSummon', player: 0, card: summon!, payment: { ...NO_CP, lbFlip: [flip!] } }).state
    t = apply(t, { type: 'chooseTargets', player: 0, targets: [victim] }).state
    expect(t.stack).toHaveLength(1)
    expect(lb(t, 0).some((x) => x.id === summon), 'on the stack, not in the LB deck').toBe(false)
    const r = passBoth(t)
    expect(r.state.stack).toEqual([])
    expect(findFieldCard(r.state, victim)).toBeNull()
    expect(r.state.players[0].breakZone).not.toContain(summon)
    expect(lb(r.state, 0).find((x) => x.id === summon)?.faceUp).toBe(true)
    expect(r.events).toContainEqual({ type: 'lbReturned', player: 0, card: summon, from: 'breakZone' })
    ok(r.state)
  })
})

describe('J8 — the return from a hidden zone (§15.2.8.4.4)', () => {
  it('an LB Forward returned to hand is in the LB deck face up when the command returns, never in the hand', () => {
    let s = game()
    const [lb2] = lbIds(s, 0, 'T-LB2')
    // On the field by hand (its cast is proven above); the opponent bounces it with a free Summon from hand.
    s = { ...s, players: [{ ...s.players[0], lbDeck: s.players[0].lbDeck.filter((x) => x.id !== lb2), forwards: [...s.players[0].forwards, { id: lb2!, status: 'active', damage: 0, enteredTurn: 0, attackedThisTurn: false, granted: [], powerBonus: 0, flags: [], usedThisTurn: [] }] }, s.players[1]] }
    let bounce: CardId
    ;[s, bounce] = withHand(s, 1, 'T-BOUNCE')
    s = apply(s, { type: 'pass', player: 0 }).state                                             // §11.1.6: the opponent may cast
    let t = apply(s, { type: 'castSummon', player: 1, card: bounce, payment: NO_CP }).state
    t = apply(t, { type: 'chooseTargets', player: 1, targets: [lb2!] }).state
    const r = passBoth(t)
    expect(findFieldCard(r.state, lb2!)).toBeNull()
    expect(r.state.players[0].hand, 'not in the hand').not.toContain(lb2)
    expect(lb(r.state, 0).find((x) => x.id === lb2)?.faceUp, 'in the LB deck, face up').toBe(true)
    expect(r.events.map((e) => e.type), 'the arrival happened (§15.2.8.4.2)').toContain('returnedToHand')
    expect(r.events).toContainEqual({ type: 'lbReturned', player: 0, card: lb2, from: 'hand' })
    ok(r.state)
  })
})

describe('J8 — what the other side sees (D5), and determinisation', () => {
  it('viewFor exposes both LB decks with identities and face state; determinise keeps them and does not deal them into a deck', () => {
    let s = game()
    const [one, two] = lbIds(s, 0, 'T-LB1')
    s = apply(s, { type: 'castCharacter', player: 0, card: one!, payment: { ...NO_CP, lbFlip: [two!] } }).state
    for (const me of [0, 1] as const) {
      const v = viewFor(s, me)
      expect(v.fields[0].lbDeck.map((x) => [v.cards[x.id]?.code, x.faceUp])).toEqual([['T-LB2', false], ['T-LB1', true], ['T-LB-S', false]])
      expect(v.fields[1].lbDeck).toHaveLength(4)
      const [d] = determinise({ view: v, decks: [DEFAULT_DECK, DEFAULT_DECK], rng: seedRng(1) })
      expect(d.players[0].lbDeck).toEqual(s.players[0].lbDeck)
      expect(d.players[1].lbDeck).toEqual(s.players[1].lbDeck)
      ok(d)
    }
  })
})
