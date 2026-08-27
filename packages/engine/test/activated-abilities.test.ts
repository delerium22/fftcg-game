import { describe, expect, it } from 'vitest'
import type { CardDef } from '../src/types.js'
import type { CardId, GameState } from '../src/state.js'
import type { Ability, AbilityCost, Effect } from '../src/abilities.js'
import type { Payment } from '../src/commands.js'
import { describeAbilityCost } from '../src/abilities.js'
import { apply } from '../src/apply.js'
import { legalCommands } from '../src/legal.js'
import { activatedAbility, activationCheck, activationTargetSets } from '../src/activate.js'
import { IllegalCommandError } from '../src/errors.js'
import { deckOf, makeDef, makeGame, VANILLA_POOL, withField, withHand } from './helpers.js'

/**
 * Rung C3 — the activation transaction, tested on synthetic cards.
 *
 * Synthetic on purpose: these are assertions about cost atomicity, trigger ordering and legality, not about
 * Red Mage. The printed cards get their own tests in `packages/cards`, where the AST is checked against the
 * printed wording.
 */

const NO_PAY: Payment = { dullBackups: [], discards: [] }

function actionCard(code: string, cost: AbilityCost, effects: readonly Effect[], over: Partial<CardDef> = {}): CardDef {
  const ability: Ability = { id: `${code}:act`, trigger: { kind: 'activated', sourceZone: over.type === 'backup' ? 'field' : 'field', cost }, text: 'synthetic activated clause', effects }
  return makeDef({ code, cost: 1, power: 5000, hasAbilities: true, abilityClauses: 1, text: 'synthetic', abilities: [ability], ...over })
}

/** A card whose ability is usable only from hand — the `sourceZone` precondition (spec C3-3). */
function handCard(code: string, cost: AbilityCost, effects: readonly Effect[]): CardDef {
  const ability: Ability = { id: `${code}:act`, trigger: { kind: 'activated', sourceZone: 'hand', cost }, text: 'synthetic hand clause', effects }
  return makeDef({ code, cost: 1, power: 5000, hasAbilities: true, abilityClauses: 1, text: 'synthetic', abilities: [ability] })
}

/** A watcher of "a Forward opponent controls is put from the field into the Break Zone" — Lightning's shape. */
function watcherCard(code: string, effects: readonly Effect[]): CardDef {
  const ability: Ability = {
    id: `${code}:watch`,
    trigger: { kind: 'observesZoneChange', from: 'field', to: 'breakZone', whose: 'opponent', of: 'forward' },
    text: 'synthetic observer clause',
    effects,
  }
  return makeDef({ code, cost: 1, power: 5000, hasAbilities: true, abilityClauses: 1, text: 'synthetic', abilities: [ability] })
}

function gameWith(defs: CardDef[]): GameState {
  const pool = [...VANILLA_POOL, ...defs]
  return makeGame({ defs: pool, decks: [deckOf(VANILLA_POOL.map((d) => d.code)), deckOf(VANILLA_POOL.map((d) => d.code))] })
}

const activate = (s: GameState, source: CardId, abilityId: string, payment = NO_PAY, targets: readonly CardId[] = []) =>
  apply(s, { type: 'activateAbility', player: 0, source, abilityId, payment, targets })

// ---------------------------------------------------------------------------
// C3-A2 — the cost removes the source, and the effect still resolves in full
// ---------------------------------------------------------------------------

describe('cost and effect are separate (C3-A2)', () => {
  it('resolves in full even though the cost already put the source into the Break Zone', () => {
    // Noel's shape: dull AND self-break as the cost, then "dull all the Forwards opponent controls".
    const def = actionCard('T-SELFBREAK', { dull: true, selfToBreakZone: true },
      [{ kind: 'forEach', from: { zone: 'forwards', controller: 'opponent' }, do: [{ kind: 'dull' }] }])
    let s = gameWith([def])
    let src: CardId; let a: CardId; let b: CardId
    ;[s, src] = withField(s, 0, 'forwards', 'T-SELFBREAK')
    ;[s, a] = withField(s, 1, 'forwards', 'V-F1')
    ;[s, b] = withField(s, 1, 'forwards', 'V-F2')

    const r = activate(s, src, 'T-SELFBREAK:act')
    // The source is gone...
    expect(r.state.players[0].forwards.some((c) => c.id === src)).toBe(false)
    expect(r.state.players[0].breakZone).toContain(src)
    // ...and every opponent Forward was still dulled by the ability it paid for.
    expect(r.state.players[1].forwards.find((c) => c.id === a)?.status).toBe('dull')
    expect(r.state.players[1].forwards.find((c) => c.id === b)?.status).toBe('dull')
  })

  it('declares its target with the activation, validated against the POST-cost board', () => {
    // Undead Princess's shape. Targets are declared up front (spec C3-1), and validated against the state as
    // it will be once the cost is paid — so she is already in the Break Zone and cannot be her own target.
    const def = actionCard('T-PUMP', { selfToBreakZone: true },
      [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'any' }, then: [{ kind: 'addPower', amount: 4000 }] }])
    let s = gameWith([def])
    let src: CardId; let ally: CardId
    ;[s, src] = withField(s, 0, 'forwards', 'T-PUMP')
    ;[s, ally] = withField(s, 0, 'forwards', 'V-F1')

    // The source is not offered as its own target...
    expect(activationTargetSets(s, 0, src, activatedAbility(s, src, 'T-PUMP:act')!)).toEqual([[ally]])
    expect(activationCheck(s, 0, src, 'T-PUMP:act', [src])).toMatch(/not a legal target/)

    // ...and the declared target resolves with NO further prompt: the frame starts with its choice made.
    const r = activate(s, src, 'T-PUMP:act', NO_PAY, [ally])
    expect(r.state.pending).toBeNull()
    expect(r.state.players[0].forwards.find((c) => c.id === ally)?.powerBonus).toBe(4000)
  })

  it('refuses an AST whose choice is not its first effect, rather than paying and no-opping', () => {
    // The code review's counterexample, turned into a guard. A `forEach` followed by a mandatory
    // `chooseTargets` used to pass validation, pay its cost, and then resolve to nothing.
    const def = actionCard('T-LATE', { selfToBreakZone: true }, [
      { kind: 'forEach', from: { zone: 'forwards', controller: 'self' }, do: [{ kind: 'dull' }] },
      { kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'any' }, then: [{ kind: 'addPower', amount: 1000 }] },
    ])
    let s = gameWith([def])
    let src: CardId
    ;[s, src] = withField(s, 0, 'forwards', 'T-LATE')
    expect(() => activationCheck(s, 0, src, 'T-LATE:act', [])).toThrow(/FIRST effect/)
  })

  it('lets an "up to N" ability activate with nothing to choose', () => {
    // `min: 0` means declining is a legal answer, so an empty board must not make the ability unusable — an
    // earlier revision rejected any empty candidate set outright.
    const def = actionCard('T-UPTO', { dull: true }, [
      { kind: 'chooseTargets', min: 0, max: 2, from: { zone: 'forwards', controller: 'opponent' }, then: [{ kind: 'dull' }] },
    ], { type: 'backup', power: null })
    let s = gameWith([def])
    let src: CardId
    ;[s, src] = withField(s, 0, 'backups', 'T-UPTO')
    expect(activationCheck(s, 0, src, 'T-UPTO:act', [])).toBeNull()
    expect(activate(s, src, 'T-UPTO:act', NO_PAY, []).state.pending).toBeNull()
  })

  it('is ILLEGAL, rather than a cost paid for nothing, when the ability has no legal target', () => {
    // The source is the only Forward, so once she pays there is nothing to pump (§11.6.5).
    const def = actionCard('T-PUMP', { selfToBreakZone: true },
      [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'any' }, then: [{ kind: 'addPower', amount: 4000 }] }])
    let s = gameWith([def])
    let src: CardId
    ;[s, src] = withField(s, 0, 'forwards', 'T-PUMP')

    expect(activationCheck(s, 0, src, 'T-PUMP:act')).toMatch(/no legal target/)
    expect(legalCommands(s, 0).some((c) => c.type === 'activateAbility')).toBe(false)
    expect(() => activate(s, src, 'T-PUMP:act')).toThrow(IllegalCommandError)
    // And nothing was spent finding that out.
    expect(s.players[0].breakZone).not.toContain(src)
  })
})

// ---------------------------------------------------------------------------
// C3-A3 / C3-A4 — the cost's own zone movement
// ---------------------------------------------------------------------------

describe('a self-break cost is a zone movement but NOT a break (C3-A3/C3-A4)', () => {
  const setup = () => {
    // The action draws for player 0; the opponent's watcher draws for player 1. `drew.player` tells the two
    // apart, so the EVENT ORDER answers "which resolved first".
    const action = actionCard('T-ACT', { selfToBreakZone: true }, [{ kind: 'draw', count: 1 }])
    const watcher = watcherCard('T-WATCH', [{ kind: 'draw', count: 1 }])
    let s = gameWith([action, watcher])
    let src: CardId
    ;[s, src] = withField(s, 0, 'forwards', 'T-ACT')
    ;[s] = withField(s, 1, 'forwards', 'T-WATCH')
    return { s, src }
  }

  it('fires the opponent watcher BEFORE the ability the cost paid for (FIFO agenda)', () => {
    const { s, src } = setup()
    const r = activate(s, src, 'T-ACT:act')
    const draws = r.events.filter((e) => e.type === 'drew').map((e) => (e as { player: number }).player)
    // The cost's trigger is enqueued ahead of the action frame, so player 1 draws first.
    expect(draws).toEqual([1, 0])
  })

  it('emits no break event for the cost, and does not consult cannotBeBroken', () => {
    const action = actionCard('T-ACT', { selfToBreakZone: true }, [{ kind: 'draw', count: 1 }])
    let s = gameWith([action])
    let src: CardId
    // `cannotBeBroken` would stop `breakCard` dead. A cost is not a break (§15.1.1.3.2), so it must not care.
    ;[s, src] = withField(s, 0, 'forwards', 'T-ACT', { flags: ['cannotBeBroken'] })

    const r = activate(s, src, 'T-ACT:act')
    expect(r.state.players[0].breakZone).toContain(src)
    expect(r.events.some((e) => e.type === 'brokenByAbility' || e.type === 'broken' || e.type === 'breakPrevented')).toBe(false)
    expect(r.events.some((e) => e.type === 'paidToBreakZone')).toBe(true)
  })

  it('still reaches an observer of "put from the field into the Break Zone"', () => {
    // The half that is easy to get backwards: not-a-break does NOT mean not-a-movement. The implemented
    // watcher's printed wording is about the movement, so it must see this.
    const { s, src } = setup()
    const r = activate(s, src, 'T-ACT:act')
    expect(r.events.filter((e) => e.type === 'drew').some((e) => (e as { player: number }).player === 1)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// C3-A5 — legality, constructed rather than swept for
// ---------------------------------------------------------------------------

describe('activation legality (C3-A5)', () => {
  const dullCost: AbilityCost = { dull: true }
  const dullDef = () => actionCard('T-DULLCOST', dullCost, [{ kind: 'draw', count: 1 }])

  it('a [Dull] cost needs an ACTIVE source', () => {
    let s = gameWith([dullDef()])
    let src: CardId
    ;[s, src] = withField(s, 0, 'forwards', 'T-DULLCOST', { status: 'dull' })
    expect(activationCheck(s, 0, src, 'T-DULLCOST:act')).toMatch(/already dull/)
  })

  it('a [Dull] cost is illegal the turn its source entered, and legal with Haste (§11.6.2.2)', () => {
    let s = gameWith([dullDef()])
    let fresh: CardId; let hasted: CardId
    ;[s, fresh] = withField(s, 0, 'forwards', 'T-DULLCOST', { enteredTurn: s.turn })
    ;[s, hasted] = withField(s, 0, 'forwards', 'T-DULLCOST', { enteredTurn: s.turn, granted: ['haste'] })
    expect(activationCheck(s, 0, fresh, 'T-DULLCOST:act')).toMatch(/entered the field this turn/)
    expect(activationCheck(s, 0, hasted, 'T-DULLCOST:act')).toBeNull()
  })

  it('WITHOUT a [Dull] icon, a dulled source that entered this turn is still legal', () => {
    // Undead Princess. The restriction rides on the icon, not on activation in general — revision 1 of the
    // spec had this wrong and would have made her unusable the turn she arrives.
    const def = actionCard('T-NODULL', { selfToBreakZone: true }, [{ kind: 'draw', count: 1 }])
    let s = gameWith([def])
    let src: CardId
    ;[s, src] = withField(s, 0, 'forwards', 'T-NODULL', { status: 'dull', enteredTurn: s.turn })
    expect(activationCheck(s, 0, src, 'T-NODULL:act')).toBeNull()
  })

  it('the source may not pay its own CP cost, as a dulled Backup or as a discard (C3-5)', () => {
    const def = actionCard('T-CP', { cp: { amount: 1, requiredElements: ['earth'] }, dull: true }, [{ kind: 'draw', count: 1 }], { type: 'backup', power: null })
    let s = gameWith([def])
    let src: CardId
    ;[s, src] = withField(s, 0, 'backups', 'T-CP')
    // Dulling itself would pay the [Earth] AND the [Dull] with one action.
    expect(() => activate(s, src, 'T-CP:act', { dullBackups: [src], discards: [] })).toThrow(IllegalCommandError)
    // And no enumerated payment offers it either.
    const offered = legalCommands(s, 0).filter((c) => c.type === 'activateAbility')
    for (const c of offered) {
      if (c.type !== 'activateAbility') continue
      expect(c.payment.dullBackups).not.toContain(src)
      expect(c.payment.discards.map((d) => d.card)).not.toContain(src)
    }
  })

  it('is illegal outside the turn player\'s Main Phases (MVP0-SIMPLIFICATION C3-11)', () => {
    let s = gameWith([dullDef()])
    let src: CardId
    ;[s, src] = withField(s, 0, 'forwards', 'T-DULLCOST')
    expect(activationCheck(s, 0, src, 'T-DULLCOST:act')).toBeNull()
    expect(activationCheck({ ...s, phase: 'attack' }, 0, src, 'T-DULLCOST:act')).toMatch(/Main Phase/)
    expect(activationCheck({ ...s, turnPlayer: 1 }, 0, src, 'T-DULLCOST:act')).toMatch(/your own turn/)
  })

  it('honours sourceZone: a hand ability is unusable from the field and vice versa', () => {
    const inHand = handCard('T-HAND', { selfDiscard: true }, [{ kind: 'draw', count: 1 }])
    const onField = actionCard('T-FIELD', { dull: true }, [{ kind: 'draw', count: 1 }])
    let s = gameWith([inHand, onField])
    let handId: CardId; let fieldId: CardId; let strayField: CardId
    ;[s, handId] = withHand(s, 0, 'T-HAND')
    ;[s, fieldId] = withField(s, 0, 'forwards', 'T-FIELD')
    ;[s, strayField] = withField(s, 0, 'forwards', 'T-HAND')

    expect(activationCheck(s, 0, handId, 'T-HAND:act')).toBeNull()
    expect(activationCheck(s, 0, fieldId, 'T-FIELD:act')).toBeNull()
    // The same card on the field cannot use its hand-only ability.
    expect(activationCheck(s, 0, strayField, 'T-HAND:act')).toMatch(/only be used from your hand/)
  })

  it('discarding from hand as a cost moves the source to the Break Zone and draws', () => {
    const def = handCard('T-HAND', { selfDiscard: true }, [{ kind: 'draw', count: 1 }])
    let s = gameWith([def])
    let handId: CardId
    ;[s, handId] = withHand(s, 0, 'T-HAND')
    const before = s.players[0].hand.length

    const r = activate(s, handId, 'T-HAND:act')
    expect(r.state.players[0].breakZone).toContain(handId)
    expect(r.state.players[0].hand).not.toContain(handId)
    // -1 for the discarded source, +1 for the draw.
    expect(r.state.players[0].hand.length).toBe(before)
  })
})

// ---------------------------------------------------------------------------
// Enumeration and labelling
// ---------------------------------------------------------------------------

describe('activations are enumerated and labelled', () => {
  it('legalCommands offers one activation per clause, from every source zone', () => {
    const field = actionCard('T-FIELD', { dull: true }, [{ kind: 'draw', count: 1 }])
    const hand = handCard('T-HAND', { selfDiscard: true }, [{ kind: 'draw', count: 1 }])
    let s = gameWith([field, hand])
    ;[s] = withField(s, 0, 'forwards', 'T-FIELD')
    ;[s] = withHand(s, 0, 'T-HAND')
    const acts = legalCommands(s, 0).filter((c) => c.type === 'activateAbility')
    expect(acts.map((c) => (c.type === 'activateAbility' ? c.abilityId : '')).sort())
      .toEqual(['T-FIELD:act', 'T-HAND:act'])
  })

  it('renders the printed cost the way the card prints it', () => {
    expect(describeAbilityCost({ cp: { amount: 1, requiredElements: ['lightning'] }, dull: true })).toBe('[Lightning][Dull]')
    expect(describeAbilityCost({ cp: { amount: 2 }, dull: true, selfToBreakZone: true })).toBe('[2][Dull], put into the Break Zone')
    expect(describeAbilityCost({ selfToBreakZone: true })).toBe('put into the Break Zone')
    expect(describeAbilityCost({ cp: { amount: 0 } })).toBe('[0]')
  })
})
