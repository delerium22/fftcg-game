import { describe, expect, it } from 'vitest'
import type { Ability } from '../src/abilities.js'
import type { CardId, GameState } from '../src/state.js'
import { apply } from '../src/apply.js'
import { DEFAULT_SET_CAP, isLegal, legalCommands, legalCommandsWithMeta } from '../src/legal.js'
import { endPhase, makeDef, makeGame, VANILLA_POOL, withField, withHand, withHandSize } from './helpers.js'

/**
 * Rung J7-A2 — `legalCommands` lists every legal set below the cap and a marked SAMPLE above it: the
 * singletons, the pairs, larger sets to the cap, and the largest legal sets. Everything listed is legal.
 */

const PICK3: Ability = {
  id: 'T-PICK3:etb', trigger: { kind: 'enterField' }, text: 'choose up to 3 Forwards, dull them',
  effects: [{ kind: 'chooseTargets', min: 0, max: 3, from: { zone: 'forwards', controller: 'any' }, then: [{ kind: 'dull' }] }],
}
const DEFS = [...VANILLA_POOL, makeDef({ code: 'T-PICK3', cost: 0, hasAbilities: true, abilityClauses: 1, abilities: [PICK3] })]

/** Player 0 has cast T-PICK3 with `n` Forwards on the two fields: the placement prompt is up. */
function prompt(n: number): GameState {
  let s = makeGame({ defs: DEFS })
  for (let i = 0; i < n; i++) [s] = withField(s, i % 2 as 0 | 1, 'forwards', 'V-F1')
  let card: CardId
  ;[s, card] = withHand(s, 0, 'T-PICK3')
  s = apply(s, { type: 'castCharacter', player: 0, card, payment: { dullBackups: [], discards: [] } }).state
  expect(s.pending?.kind).toBe('chooseTargets')
  return s
}

describe('J7-A2 — the cap', () => {
  it('below the cap the list is complete and unmarked, and equal to the uncapped enumeration', () => {
    const s = prompt(5)   // 5 Forwards + the caster itself = 6 candidates: Σ C(6,k), k=0..3 = 1+6+15+20 = 42 ≤ 64
    const r = legalCommandsWithMeta(s, 0)
    expect(r.capped).toBe(false)
    expect(r.commands.filter((c) => c.type === 'chooseTargets')).toHaveLength(42)
    expect(r.commands).toEqual(legalCommandsWithMeta(s, 0, Number.POSITIVE_INFINITY).commands)
  })

  it('above the cap: at most the cap, marked, every listed set legal, all singletons and the full set present', () => {
    const s = prompt(12)   // 13 candidates with the caster: 1+13+78+286 = 378 > 64
    const r = legalCommandsWithMeta(s, 0)
    expect(r.capped).toBe(true)
    const sets = r.commands.filter((c) => c.type === 'chooseTargets')
    expect(sets.length).toBeLessThanOrEqual(DEFAULT_SET_CAP + 1)   // the largest set may ride above the cap
    for (const c of sets) expect(isLegal(s, c), JSON.stringify(c)).toBeNull()
    const pending = s.pending as Extract<NonNullable<GameState['pending']>, { kind: 'chooseTargets' }>
    for (const id of pending.candidates) expect(sets.some((c) => c.type === 'chooseTargets' && c.targets.length === 1 && c.targets[0] === id)).toBe(true)
    expect(sets.some((c) => c.type === 'chooseTargets' && c.targets.length === 3), 'the full set').toBe(true)
    // And what the list omits is still legal by the predicate — the whole point of J7-D1.
    const omitted = { type: 'chooseTargets' as const, player: 0 as const, targets: pending.candidates.slice(9, 12) }
    expect(r.commands.some((c) => JSON.stringify(c) === JSON.stringify(omitted))).toBe(false)
    expect(isLegal(s, omitted)).toBeNull()
  })

  it('attacks: eight ready Forwards are 255 parties; bounded, the singles, the pairs and each element’s full party', () => {
    let s = endPhase(makeGame({ defs: DEFS }))
    const ids: CardId[] = []
    for (const code of ['V-F1', 'V-F2', 'V-F5', 'V-F7', 'V-F3', 'V-F6', 'V-F8', 'V-F4']) { let id: CardId; [s, id] = withField(s, 0, 'forwards', code); ids.push(id) }
    const r = legalCommandsWithMeta(s, 0)
    expect(r.capped).toBe(true)
    const attacks = r.commands.filter((c) => c.type === 'declareAttack')
    for (const c of attacks) expect(isLegal(s, c)).toBeNull()
    for (const id of ids) expect(attacks.some((c) => c.type === 'declareAttack' && c.attackers.length === 1 && c.attackers[0] === id)).toBe(true)
    // The earth party (V-F1, V-F2, V-F5, V-F7, V-F4) and the lightning party (V-F3, V-F6, V-F8, V-F4) are listed whole.
    expect(attacks.some((c) => c.type === 'declareAttack' && c.attackers.length === 5)).toBe(true)
    expect(attacks.some((c) => c.type === 'declareAttack' && c.attackers.length === 4)).toBe(true)
    expect(legalCommands(s, 0).length).toBe(r.commands.length)
  })

  it('a hand-size discard over ten cards lists a legal sample of exactly `count`-sized sets', () => {
    let s = withHandSize(makeGame(), 0, 0)
    for (let i = 0; i < 10; i++) [s] = withHand(s, 0, 'V-F1')
    s = { ...s, pending: { kind: 'discardToHandSize', player: 0, count: 3 } }   // C(10,3) = 120
    const r = legalCommandsWithMeta(s, 0)
    expect(r.capped).toBe(true)
    const d = r.commands.filter((c) => c.type === 'discardToHandSize')
    expect(d).toHaveLength(DEFAULT_SET_CAP)
    for (const c of d) expect(isLegal(s, c)).toBeNull()
  })
})
