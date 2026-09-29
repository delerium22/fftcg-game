import { describe, expect, it } from 'vitest'
import type { Ability, AbilityCost, Effect } from '../src/abilities.js'
import type { CardDef } from '../src/types.js'
import type { CardId, GameState } from '../src/state.js'
import { findFieldCard } from '../src/state.js'
import { checkInvariants } from '../src/invariants.js'
import { validateEffects } from '../src/setup.js'
import { applyNow as apply } from './helpers.js'
import { makeDef, makeGame, VANILLA_POOL, withField, withHand } from './helpers.js'

/**
 * Rung V1-A4 (V1-B plan R1): `onSource` — "<this card> gains …", Jecht 18-129C clause 1 and LB Luso 23-130H clause 2.
 * `onSubject`'s sibling: `chosen` is bound to the ability's SOURCE, not to the trigger's subject, and nothing is chosen.
 * Synthetic cards, driven through `apply`.
 */

const FREE = { dullBackups: [], discards: [] }
const fc = (s: GameState, id: CardId) => findFieldCard(s, id)?.card
const ok = (s: GameState) => expect(checkInvariants(s)).toEqual([])

const PUMP_SELF: readonly Effect[] = [{ kind: 'onSource', do: [{ kind: 'addPower', amount: 2000 }, { kind: 'grantKeyword', keyword: 'brave' }] }]
const activated = (code: string, cost: AbilityCost): Ability =>
  ({ id: `${code}:act`, trigger: { kind: 'activated', sourceZone: 'field', cost }, text: '[0]: this card gains +2000 power and Brave until the end of the turn.', effects: PUMP_SELF })
// "When a Forward you control enters the field, <this card> gains +2000 power and Brave until the end of the turn."
const WATCH: Ability = { id: 'T-SRC-WATCH:enter', trigger: { kind: 'observesEnterField', whose: 'self', of: 'forward' }, text: 'synthetic watcher', effects: PUMP_SELF }
// Prishe's shape: a "when chosen" watcher on the source itself, to show a source binding is not a choosing.
const WHEN_CHOSEN: Ability = { id: 'T-SRC-PUMP:chosen', trigger: { kind: 'observesChosen' }, text: 'synthetic: when chosen, +1000', effects: [{ kind: 'addPower', amount: 1000 }] }

const DEFS: CardDef[] = [
  ...VANILLA_POOL,
  makeDef({ code: 'T-SRC', cost: 0, power: 5000, hasAbilities: true, abilityClauses: 2, abilities: [activated('T-SRC', {}), WHEN_CHOSEN] }),
  // The pump, then a draw that happens only if `chosen` IS the source: the binding made observable off the field.
  makeDef({ code: 'T-SRC-GONE', name: 'Gone Source', cost: 0, power: 5000, hasAbilities: true, abilityClauses: 1, abilities: [{
    ...activated('T-SRC-GONE', { selfToBreakZone: true }),
    effects: [{ kind: 'onSource', do: [...(PUMP_SELF[0] as Extract<Effect, { kind: 'onSource' }>).do,
      { kind: 'if', when: { kind: 'subjectMatches', filter: { name: 'Gone Source' } }, then: [{ kind: 'draw', count: 1 }] }] }],
  }] }),
  makeDef({ code: 'T-SRC-WATCH', cost: 0, power: 1000, hasAbilities: true, abilityClauses: 1, abilities: [WATCH] }),
  makeDef({ code: 'T-ARRIVE', cost: 0, power: 3000 }),
]

const activate = (s: GameState, source: CardId, abilityId: string) =>
  apply(s, { type: 'activateAbility', player: 0, source, abilityId, payment: FREE, targets: [] })

describe('V1-A4 — onSource binds the ability\'s own card', () => {
  it('L1 §11.6.1 — "[0]: this card gains +2000 power and Brave": the source is pumped, and nothing else changes', () => {
    let s = makeGame({ defs: DEFS })
    let src: CardId, other: CardId, theirs: CardId
    ;[s, src] = withField(s, 0, 'forwards', 'T-SRC')
    ;[s, other] = withField(s, 0, 'forwards', 'V-F2')
    ;[s, theirs] = withField(s, 1, 'forwards', 'V-F2')
    const r = activate(s, src, 'T-SRC:act')
    expect(fc(r.state, src)?.powerBonus, 'the Prishe-shaped +1000 would show here if the binding counted as a choice').toBe(2000)
    expect(fc(r.state, src)?.granted).toEqual(['brave'])
    for (const id of [other, theirs]) {
      expect(fc(r.state, id)?.powerBonus).toBe(0)
      expect(fc(r.state, id)?.granted).toEqual([])
    }
    expect(r.events.some((e) => e.type === 'abilityTriggered' && e.abilityId === 'T-SRC-PUMP:chosen'), 'a source binding is not a choosing').toBe(false)
    expect(r.state.pending).toBeNull()
    ok(r.state)
  })

  it('L1 §11.8.1 — an observer clause with onSource pumps the WATCHER, not the card that arrived', () => {
    let s = makeGame({ defs: DEFS })
    let watcher: CardId, arriving: CardId
    ;[s, watcher] = withField(s, 0, 'forwards', 'T-SRC-WATCH')
    ;[s, arriving] = withHand(s, 0, 'T-ARRIVE')
    const r = apply(s, { type: 'castCharacter', player: 0, card: arriving, payment: FREE })
    expect(r.events.some((e) => e.type === 'abilityTriggered' && e.abilityId === 'T-SRC-WATCH:enter'), 'the watcher fired').toBe(true)
    expect(fc(r.state, watcher)?.powerBonus).toBe(2000)
    expect(fc(r.state, watcher)?.granted).toEqual(['brave'])
    expect(fc(r.state, arriving)?.powerBonus).toBe(0)
    expect(fc(r.state, arriving)?.granted).toEqual([])
    ok(r.state)
  })

  it('L1 §11.11.7 — a source that has left the field is still bound: the pump does nothing, and nothing throws (Review Focus 1)', () => {
    let s = makeGame({ defs: DEFS })
    let src: CardId
    ;[s, src] = withField(s, 0, 'forwards', 'T-SRC-GONE')
    const hand = s.players[0].hand.length
    const r = activate(s, src, 'T-SRC-GONE:act')
    expect(r.state.players[0].breakZone, 'the cost put the source into the Break Zone before resolution').toContain(src)
    expect(r.events.some((e) => e.type === 'powerModified' || e.type === 'keywordGranted')).toBe(false)
    // The field effects skipped it, but `chosen` was still the source: the name check read it and the draw happened.
    expect(r.state.players[0].hand.length, 'the draw inside onSource ran on the bound source').toBe(hand + 1)
    expect(r.state.stack).toEqual([])
    ok(r.state)
  })
})

describe('V1-A4 — game creation refuses a prompt inside onSource', () => {
  const def = (effects: readonly Effect[]): CardDef =>
    makeDef({ code: 'T-X', hasAbilities: true, abilityClauses: 1, abilities: [{ id: 'T-X:etb', trigger: { kind: 'enterField' }, text: 'synthetic', effects }] })

  it('admits a plain onSource and refuses a chooser, a mode choice or a search inside one', () => {
    expect(validateEffects([def(PUMP_SELF)])).toEqual([])
    const choose: Effect = { kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'any' }, then: [{ kind: 'dull' }] }
    const modes: Effect = { kind: 'chooseModes', min: 1, max: 1, modes: [{ label: 'dull', effects: [{ kind: 'dull' }] }] }
    const look: Effect = { kind: 'lookAtDeck', count: 1, audience: 'self', take: { min: 0, max: 1 }, to: 'hand', rest: 'bottom' }
    for (const inner of [choose, modes, look]) {
      expect(validateEffects([def([{ kind: 'onSource', do: [inner] }])]).join(), inner.kind).toMatch(/onSource.*prompt|prompt.*onSource/)
    }
    expect(validateEffects([def([{ kind: 'onSource', do: [{ kind: 'if', when: { kind: 'controlsAtLeast', count: 1, controller: 'self' }, then: [choose] }] }])]).join(), 'nested under an if').toMatch(/onSource/)
  })
})
