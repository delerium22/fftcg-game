import { describe, expect, it } from 'vitest'
import type { Ability, StaticEffect } from '../src/abilities.js'
import type { CardDef } from '../src/types.js'
import type { CardId, GameState } from '../src/state.js'
import { findFieldCard, keywordsOf } from '../src/state.js'
import { validateContinuousStatics } from '../src/setup.js'
import { checkInvariants } from '../src/invariants.js'
import { makeDef, makeGame, VANILLA_POOL, withField } from './helpers.js'

/**
 * Rung V1-A1 (spec V1-D6/D7): conditions and amounts. `controlsAtLeast` counts field Characters by DEFINITION, so
 * a static reading it never reads the layer's own output. Synthetic cards.
 */

const ok = (s: GameState) => expect(checkInvariants(s)).toEqual([])
const fc = (s: GameState, id: CardId) => findFieldCard(s, id)!.card
const stat = (id: string, effect: StaticEffect): Ability => ({ id, trigger: { kind: 'static', effect }, text: `synthetic ${id}`, effects: [] })

const DEFS: CardDef[] = [
  ...VANILLA_POOL,
  // Zack 27-123S's shape: "If your opponent controls 3 or more Forwards, Zack gains Haste."
  makeDef({ code: 'T-ZACK', cost: 2, power: 7000, hasAbilities: true, abilityClauses: 1,
    abilities: [stat('T-ZACK:haste', { kind: 'grantKeyword', keyword: 'haste', to: { controller: 'self', self: true },
      when: { kind: 'controlsAtLeast', count: 3, controller: 'opponent', filter: { type: 'forward' } } })] }),
  // "If you control 2 or more Characters, <this> gains Brave." — no filter: any Character.
  makeDef({ code: 'T-CROWD', cost: 2, power: 5000, hasAbilities: true, abilityClauses: 1,
    abilities: [stat('T-CROWD:brave', { kind: 'grantKeyword', keyword: 'brave', to: { controller: 'self', self: true },
      when: { kind: 'controlsAtLeast', count: 2, controller: 'self' } })] }),
]

describe('V1-A1 — controlsAtLeast (a static condition)', () => {
  it('L1 §11.12.4.4 — "if your opponent controls 3 or more Forwards": 2 do not, 3 do, and their Backups never count', () => {
    let s = makeGame({ defs: DEFS }); let zack: CardId
    ;[s, zack] = withField(s, 0, 'forwards', 'T-ZACK')
    ;[s] = withField(s, 1, 'forwards', 'V-F1'); [s] = withField(s, 1, 'forwards', 'V-F2')
    ;[s] = withField(s, 1, 'backups', 'V-B1'); [s] = withField(s, 1, 'backups', 'V-B3')
    expect(keywordsOf(s, fc(s, zack)).has('haste'), 'two Forwards and two Backups: not three Forwards').toBe(false)
    ;[s] = withField(s, 1, 'forwards', 'V-F5')
    expect(keywordsOf(s, fc(s, zack)).has('haste')).toBe(true)
    ok(s)
  })

  it('counts relative to the source: the same three Forwards on its OWN side do not satisfy "your opponent controls"', () => {
    let s = makeGame({ defs: DEFS }); let zack: CardId
    ;[s, zack] = withField(s, 0, 'forwards', 'T-ZACK')
    ;[s] = withField(s, 0, 'forwards', 'V-F1'); [s] = withField(s, 0, 'forwards', 'V-F2'); [s] = withField(s, 0, 'forwards', 'V-F5')
    expect(keywordsOf(s, fc(s, zack)).has('haste')).toBe(false)
  })

  it('StaticScope.self: the grant reaches the source alone, not another Forward its controller has', () => {
    let s = makeGame({ defs: DEFS }); let zack: CardId, other: CardId
    ;[s, zack] = withField(s, 0, 'forwards', 'T-ZACK')
    ;[s, other] = withField(s, 0, 'forwards', 'V-F2')
    for (const code of ['V-F1', 'V-F2', 'V-F5']) [s] = withField(s, 1, 'forwards', code)
    expect(keywordsOf(s, fc(s, zack)).has('haste')).toBe(true)
    expect(keywordsOf(s, fc(s, other)).has('haste')).toBe(false)
  })

  it('with no filter counts any Character: a Forward and a Backup make 2 (the source itself counts)', () => {
    let s = makeGame({ defs: DEFS }); let crowd: CardId
    ;[s, crowd] = withField(s, 0, 'forwards', 'T-CROWD')
    expect(keywordsOf(s, fc(s, crowd)).has('brave'), 'the source alone is 1').toBe(false)
    ;[s] = withField(s, 0, 'backups', 'V-B1')
    expect(keywordsOf(s, fc(s, crowd)).has('brave')).toBe(true)
    ok(s)
  })

  it('game creation rejects a condition filter on an instance axis, a count below 1, and an unknown side', () => {
    const bad = (when: unknown) => makeDef({ code: 'T-BAD', hasAbilities: true, abilityClauses: 1,
      abilities: [stat('T-BAD:x', { kind: 'grantKeyword', keyword: 'haste', to: { controller: 'self', self: true }, when: when as never })] })
    expect(validateContinuousStatics([bad({ kind: 'controlsAtLeast', count: 2, controller: 'self', filter: { minPower: 5000 } })]).join()).toMatch(/instance axis minPower/)
    expect(validateContinuousStatics([bad({ kind: 'controlsAtLeast', count: 0, controller: 'self' })]).join()).toMatch(/count/)
    expect(validateContinuousStatics([bad({ kind: 'controlsAtLeast', count: 1.5, controller: 'self' })]).join()).toMatch(/count/)
    expect(validateContinuousStatics([bad({ kind: 'controlsAtLeast', count: 2, controller: 'any' })]).join()).toMatch(/controller/)
    expect(validateContinuousStatics(DEFS)).toEqual([])
  })
})
