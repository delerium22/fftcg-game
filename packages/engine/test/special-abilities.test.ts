import { describe, expect, it } from 'vitest'
import type { Ability, AbilityCost, Effect } from '../src/abilities.js'
import { describeAbilityCost } from '../src/abilities.js'
import type { CardDef } from '../src/types.js'
import type { CardId, GameState } from '../src/state.js'
import type { Command, Payment } from '../src/commands.js'
import { findFieldCard } from '../src/state.js'
import { apply } from '../src/apply.js'
import { isLegal, legalCommands } from '../src/legal.js'
import { activationCheck, hasAnyActivation } from '../src/activate.js'
import { checkInvariants } from '../src/invariants.js'
import { validateEffects } from '../src/setup.js'
import { deckOf, makeDef, makeGame, VANILLA_POOL, withField, withHand } from './helpers.js'

/**
 * Rung V1-A3 (spec V1-D13): special abilities, §11.7. "Special abilities are activated by paying a cost in the same way as
 * action abilities, but the player has to discard a card with the same name to use it, in addition to any other cost"
 * (§11.7.1). Jecht 18-129C's shape, synthetic: "Jecht Beam [S][Dull]: Choose 1 Forward. Deal it 8000 damage."
 */

const NO_PAY: Payment = { dullBackups: [], discards: [] }
const BEAM_COST: AbilityCost = { dull: true, discardSameName: true }
const beam = (code: string): Ability => ({
  id: `${code}:beam`, trigger: { kind: 'activated', sourceZone: 'field', cost: BEAM_COST, special: { name: 'T Beam' } },
  // Opponent's Forwards only, so whether §11.7.5's "cannot choose themselves" reaches the source card never arises here.
  text: 'T Beam [S][Dull]: Choose 1 Forward opponent controls. Deal it 8000 damage.',
  effects: [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'opponent' }, then: [{ kind: 'damage', amount: 8000 }] } satisfies Effect],
})
const DEFS: CardDef[] = [
  ...VANILLA_POOL,
  makeDef({ code: 'T-JECHT', name: 'Jecht', elements: ['fire'], cost: 3, power: 7000, generic: false, hasAbilities: true, abilityClauses: 1, abilities: [beam('T-JECHT')] }),
  // Another printing with the same name (as LB Zack 22-112R is to Zack 27-123S): a same-NAME card pays, whatever its code.
  makeDef({ code: 'T-JECHT2', name: 'Jecht', elements: ['water'], cost: 5, power: 9000, generic: false }),
  makeDef({ code: 'T-FIRE', elements: ['fire'], cost: 2, power: 5000 }),
]

function board(copies: readonly string[] = ['T-JECHT2']): { s: GameState; jecht: CardId; victim: CardId; hand: CardId[] } {
  let s = makeGame({ defs: DEFS, decks: [deckOf(VANILLA_POOL.map((d) => d.code)), deckOf(VANILLA_POOL.map((d) => d.code))] })
  let jecht: CardId, victim: CardId
  ;[s, jecht] = withField(s, 0, 'forwards', 'T-JECHT')
  ;[s, victim] = withField(s, 1, 'forwards', 'V-F7')
  const hand: CardId[] = []
  for (const code of copies) { let id: CardId; [s, id] = withHand(s, 0, code); hand.push(id) }
  return { s, jecht, victim, hand }
}
const beams = (s: GameState): Extract<Command, { type: 'activateAbility' }>[] =>
  legalCommands(s, 0).flatMap((c) => (c.type === 'activateAbility' && c.abilityId === 'T-JECHT:beam' ? [c] : []))
const use = (source: CardId, targets: CardId[], payment: Payment): Command => ({ type: 'activateAbility', player: 0, source, abilityId: 'T-JECHT:beam', payment, targets })

describe('V1-A3 — a special ability discards a card with the same name (§11.7)', () => {
  it('L1 §11.7.1 — with a same-name card in hand it is listed once, paying with that card, and activating discards it', () => {
    const { s, jecht, victim, hand } = board()
    const listed = beams(s)
    expect(listed).toHaveLength(1)
    expect(listed[0]?.payment).toEqual({ dullBackups: [], discards: [], sameName: hand[0] })
    expect(listed[0]?.targets).toEqual([victim])
    const r = apply(s, listed[0]!)
    // §11.7.10: every cost at once — the source dulled and the copy discarded, before anything resolves.
    expect(r.state.players[0].hand).not.toContain(hand[0])
    expect(r.state.players[0].breakZone).toContain(hand[0])
    expect(findFieldCard(r.state, jecht)?.card.status).toBe('dull')
    expect(r.events).toContainEqual({ type: 'discarded', player: 0, card: hand[0], reason: 'cost' })
    expect(checkInvariants(r.state)).toEqual([])
  })

  it('L1 §11.7.11 — activated, it is on the stack and the activator regains priority', () => {
    const { s, victim } = board()
    const r = apply(s, beams(s)[0]!)
    expect(r.state.stack.map((i) => (i.kind === 'ability' ? i.frame.abilityId : 'summon'))).toEqual(['T-JECHT:beam'])
    expect(r.state.priority).toBe(0)
    // Both pass: it resolves and deals its 8000.
    let t = apply(r.state, { type: 'pass', player: 0 }).state
    t = apply(t, { type: 'pass', player: 1 }).state
    expect(t.players[1].forwards.some((c) => c.id === victim)).toBe(false)
  })

  it('L1 §11.7.12 — its only target gone before it resolves, the whole ability is cancelled', () => {
    const { s, victim } = board()
    const placed = apply(s, beams(s)[0]!).state
    // The target leaves the field while the ability waits on the stack.
    const gone: GameState = { ...placed, players: [placed.players[0], { ...placed.players[1], forwards: placed.players[1].forwards.filter((c) => c.id !== victim), breakZone: [...placed.players[1].breakZone, victim] }] }
    const r1 = apply(gone, { type: 'pass', player: 0 })
    const r2 = apply(r1.state, { type: 'pass', player: 1 })
    expect(r2.events.some((e) => e.type === 'abilityNoLegalTarget')).toBe(true)
    expect(r2.events.some((e) => e.type === 'abilityDamage')).toBe(false)
    expect(r2.state.stack).toEqual([])
  })

  it('L1 §11.7.1 — with no same-name card in hand it is refused, and not listed', () => {
    const { s, jecht, victim } = board(['T-FIRE'])
    expect(activationCheck(s, 0, jecht, 'T-JECHT:beam', [victim])).toMatch(/no card with the same name in your hand/)
    expect(beams(s)).toEqual([])
  })

  it('L1 §11.7.1 — the source never pays for itself, and any same-name card in hand may pay, not only the listed one', () => {
    const { s, jecht, victim, hand } = board(['T-JECHT2', 'T-JECHT2'])
    expect(beams(s), 'one canonical payer, not one command per copy').toHaveLength(1)
    const self = use(jecht, [victim], { ...NO_PAY, sameName: jecht })
    expect(isLegal(s, self)).toMatch(/not in your hand/)
    expect(() => apply(s, self)).toThrow(/not in your hand/)
    const second = use(jecht, [victim], { ...NO_PAY, sameName: hand[1]! })
    expect(isLegal(s, second)).toBeNull()
    expect(apply(s, second).state.players[0].breakZone).toContain(hand[1])
  })

  it('L1 §11.7.1 — a different-name card, a card also discarded for CP, or no card at all does not pay', () => {
    const { s, jecht, victim } = board(['T-JECHT2', 'T-FIRE'])
    const fire = s.players[0].hand.find((id) => s.cards[id]?.code === 'T-FIRE')!
    const copy = s.players[0].hand.find((id) => s.cards[id]?.code === 'T-JECHT2')!
    const cases: [Payment, RegExp][] = [
      [{ ...NO_PAY, sameName: fire }, /same name/],
      [NO_PAY, /same name/],
      [{ dullBackups: [], discards: [{ card: copy, element: 'water' }], sameName: copy }, /also discarded for CP/],
    ]
    for (const [payment, why] of cases) {
      expect(isLegal(s, use(jecht, [victim], payment))).toMatch(why)
      expect(() => apply(s, use(jecht, [victim], payment))).toThrow(why)
    }
  })

  it('L1 §11.7.1 — a cast discards no card with the same name', () => {
    const { s, hand } = board(['T-JECHT2', 'T-FIRE', 'T-FIRE'])
    // A payment that covers the cast in full, so the same-name card is the only thing wrong with it.
    const cp: Payment = { dullBackups: [], discards: [{ card: hand[2]!, element: 'fire' }] }
    expect(isLegal(s, { type: 'castCharacter', player: 0, card: hand[1]!, payment: cp })).toBeNull()
    const cast: Command = { type: 'castCharacter', player: 0, card: hand[1]!, payment: { ...cp, sameName: hand[0]! } }
    expect(isLegal(s, cast)).toMatch(/same name/)
    expect(() => apply(s, cast)).toThrow(/same name/)
  })

  it('L1 §11.7.2.2 — the dull icon: refused the turn its source entered, without Haste', () => {
    const { s, jecht, victim } = board()
    const fresh = { ...s, players: [{ ...s.players[0], forwards: s.players[0].forwards.map((c) => (c.id === jecht ? { ...c, enteredTurn: s.turn } : c)) }, s.players[1]] as GameState['players'] }
    expect(activationCheck(fresh, 0, jecht, 'T-JECHT:beam', [victim])).toMatch(/entered the field this turn/)
    expect(beams(fresh)).toEqual([])
    const hasted = { ...fresh, players: [{ ...fresh.players[0], forwards: fresh.players[0].forwards.map((c) => (c.id === jecht ? { ...c, granted: ['haste' as const] } : c)) }, fresh.players[1]] as GameState['players'] }
    expect(activationCheck(hasted, 0, jecht, 'T-JECHT:beam', [victim])).toBeNull()
  })

  it('L1 §11.7.5 — "choose" needs a legal target: with none, it cannot be used', () => {
    let { s, jecht } = board()
    s = { ...s, players: [s.players[0], { ...s.players[1], forwards: [] }] }
    expect(activationCheck(s, 0, jecht, 'T-JECHT:beam', [])).toMatch(/no legal target/)
    expect(beams(s)).toEqual([])
  })

  it('L1 §11.7.1 — game creation refuses a special ability without the same-name discard, and the discard without the S', () => {
    const with_ = (trigger: Ability['trigger']): CardDef => makeDef({ code: 'T-S', hasAbilities: true, abilityClauses: 1, abilities: [{ ...beam('T-S'), trigger }] })
    expect(validateEffects([with_({ kind: 'activated', sourceZone: 'field', cost: { dull: true }, special: { name: 'T Beam' } })]).join()).toMatch(/special ability without/)
    expect(validateEffects([with_({ kind: 'activated', sourceZone: 'field', cost: { discardSameName: true } })]).join()).toMatch(/same-name discard without/)
    expect(validateEffects([with_({ kind: 'activated', sourceZone: 'field', cost: BEAM_COST, special: { name: 'T Beam' } })])).toEqual([])
  })

  it('L1 §11.7.1 — the same-name copy is never also the CP discard: with it as the only card, nothing is usable (review L2)', () => {
    // [Fire] + S: the copy is Fire, so it COULD pay the CP — but then nothing would be left to discard for the S.
    const burn: Ability = { ...beam('T-JF'), id: 'T-JF:beam', trigger: { kind: 'activated', sourceZone: 'field', cost: { cp: { amount: 1, requiredElements: ['fire'] }, discardSameName: true }, special: { name: 'T Burn' } } }
    const defs = [...DEFS, makeDef({ code: 'T-JF', name: 'Burner', elements: ['fire'], cost: 2, power: 5000, generic: false, hasAbilities: true, abilityClauses: 1, abilities: [burn] })]
    const game = (hand: readonly string[]): { s: GameState; src: CardId } => {
      let s = makeGame({ defs, decks: [deckOf(VANILLA_POOL.map((d) => d.code)), deckOf(VANILLA_POOL.map((d) => d.code))] })
      s = { ...s, players: [{ ...s.players[0], hand: [], backups: [] }, s.players[1]] }
      let src: CardId
      ;[s, src] = withField(s, 0, 'forwards', 'T-JF')
      ;[s] = withField(s, 1, 'forwards', 'V-F7')
      for (const code of hand) [s] = withHand(s, 0, code)
      return { s, src }
    }
    const listed = (s: GameState) => legalCommands(s, 0).filter((c) => c.type === 'activateAbility' && c.abilityId === 'T-JF:beam')
    const both = game(['T-JF', 'T-FIRE'])
    expect(listed(both.s)).toHaveLength(1)
    expect(hasAnyActivation(both.s, 0)).toBe(true)
    const only = game(['T-JF'])
    expect(listed(only.s)).toEqual([])
    expect(hasAnyActivation(only.s, 0), 'agrees with legalCommands').toBe(false)
  })

  it('names the discard in the printed cost', () => {
    expect(describeAbilityCost(BEAM_COST, 'Jecht')).toBe('[Dull], discard Jecht')
    expect(describeAbilityCost(BEAM_COST)).toBe('[Dull], discard a card with the same name')
  })
})
