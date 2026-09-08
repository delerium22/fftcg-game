import { describe, expect, it } from 'vitest'
import { viewFor, type Ability, type CardDef, type CardId, type GameState, type StaticEffect } from '@fftcg/engine'
import { DEFAULT_WEIGHTS, evaluate, observationKey } from '../src/index.js'
import { VANILLA_POOL, endPhase, makeDef, makeGame, withField } from '../../engine/test/helpers.js'

/**
 * Rung J6-A6 — the AI sees the continuous-effect layer through the readers: the observation key separates
 * two fields that differ by a continuous source, and `evaluate` scores a Haste and a protection the LAYER
 * grants (before J6 `abilityTerms` returned early on the stamped arrays and priced neither).
 */

const stat = (id: string, effect: StaticEffect): Ability => ({ id, trigger: { kind: 'static', effect }, text: id, effects: [] })
const HERALD: CardDef = makeDef({ code: 'T-HERALD', cost: 2, power: 3000, hasAbilities: true, abilityClauses: 1,
  abilities: [stat('T-HERALD:haste', { kind: 'grantKeyword', keyword: 'haste', to: { controller: 'self', excludeSource: true, filter: { type: 'forward' } } })] })
const AEGIS: CardDef = makeDef({ code: 'T-AEGIS', type: 'backup', power: null, cost: 1, hasAbilities: true, abilityClauses: 1,
  abilities: [stat('T-AEGIS:shield', { kind: 'grantFlag', flag: 'cannotBeBroken', to: { controller: 'self', filter: { type: 'forward' } } })] })
const DEFS = [...VANILLA_POOL, HERALD, AEGIS]

/** The same board with the source's static REMOVED from its definition — the only difference is the layer. */
const stripped = (s: GameState, code: string): GameState => ({ ...s, defs: { ...s.defs, [code]: { ...s.defs[code]!, abilities: [] } } })

describe('J6-A6 — the observation key and evaluate read the layer', () => {
  it('two fields that differ by a continuous source have different keys', () => {
    let s = makeGame({ defs: DEFS }); let f: CardId
    ;[s, f] = withField(s, 0, 'forwards', 'V-F2')
    const [withAegis] = withField(s, 0, 'backups', 'T-AEGIS')
    const [withOther] = withField(s, 0, 'backups', 'V-B1')
    expect(observationKey(viewFor(withAegis, 0))).not.toBe(observationKey(viewFor(withOther, 0)))
    expect(f).toBeGreaterThan(0)
  })

  it('a layer-only Haste on a Forward that entered this turn is worth more than no Haste', () => {
    let s = endPhase(makeGame({ defs: DEFS })); let fresh: CardId
    ;[s] = withField(s, 0, 'forwards', 'T-HERALD')
    ;[s, fresh] = withField(s, 0, 'forwards', 'V-F2', { enteredTurn: s.turn })
    expect(fresh).toBeGreaterThan(0)
    const withLayer = evaluate(s, 0, DEFAULT_WEIGHTS, 0.5)
    const without = evaluate(stripped(s, 'T-HERALD'), 0, DEFAULT_WEIGHTS, 0.5)
    expect(withLayer).toBeGreaterThan(without)
  })

  it('a layer-only protection is worth more than none', () => {
    let s = makeGame({ defs: DEFS })
    ;[s] = withField(s, 0, 'forwards', 'V-F2')
    ;[s] = withField(s, 0, 'backups', 'T-AEGIS')
    expect(evaluate(s, 0, DEFAULT_WEIGHTS, 0.5)).toBeGreaterThan(evaluate(stripped(s, 'T-AEGIS'), 0, DEFAULT_WEIGHTS, 0.5))
  })
})
