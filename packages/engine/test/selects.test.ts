import { describe, expect, it } from 'vitest'
import type { Ability, Effect } from '../src/abilities.js'
import type { CardDef } from '../src/types.js'
import type { CardId, GameState } from '../src/state.js'
import { findFieldCard } from '../src/state.js'
import { apply } from '../src/apply.js'
import { legalCommands } from '../src/legal.js'
import { checkInvariants } from '../src/invariants.js'
import { validateEffects } from '../src/setup.js'
import { makeDef, makeGame, VANILLA_POOL, withField, withHand } from './helpers.js'

/**
 * Rung V1-A2 (spec V1-D8..D11): selects, zone movements and hand targets. §11.3.3: "To select something is not
 * equivalent to to choose something" — a select is made as the ability RESOLVES, by its controller or by the
 * opponent, never declared as it is placed, never seen by a "when chosen" watcher, and never a castability gate.
 * Synthetic cards, driven through `apply` and real passes so the window between placement and resolution shows.
 */

const fc = (s: GameState, id: CardId) => findFieldCard(s, id)?.card
const ok = (s: GameState) => expect(checkInvariants(s)).toEqual([])
const pass = (s: GameState, p: 0 | 1): GameState => apply(s, { type: 'pass', player: p }).state
const stackIds = (s: GameState): string[] => s.stack.map((i) => (i.kind === 'ability' ? i.frame.abilityId : `summon:${i.card}`))
const FREE = { dullBackups: [], discards: [] }

const etb = (id: string, effects: readonly Effect[]): Ability => ({ id, trigger: { kind: 'enterField' }, text: `synthetic ${id}`, effects })
const bearer = (code: string, ...abilities: Ability[]): CardDef =>
  makeDef({ code, cost: 0, power: 1000, hasAbilities: true, abilityClauses: abilities.length, abilities })
const summonDef = (code: string, ...abilities: Ability[]): CardDef =>
  makeDef({ code, type: 'summon', power: null, cost: 0, hasAbilities: true, abilityClauses: abilities.length, abilities })

// Alphinaud 20-106R's shape: "your opponent selects 1 dull Forward they control. Put it into the Break Zone." — here
// dulling instead, so Task 1 needs no new effect.
const OPP_SELECT = etb('T-ALPH:etb', [{ kind: 'chooseTargets', select: 'opponent', min: 1, max: 1, from: { zone: 'forwards', controller: 'opponent' }, then: [{ kind: 'dull' }] }])
const PUMP: Ability = { id: 'T-PRISHE:chosen', trigger: { kind: 'observesChosen' }, text: 'synthetic: when chosen, +2000', effects: [{ kind: 'addPower', amount: 2000 }] }
// A Summon whose only node is a select over the caster's dull Forwards.
const SELECT_SUMMON: Ability = { id: 'T-SSEL:summon', trigger: { kind: 'summonResolve' }, text: 'synthetic: select 1 dull Forward you control, dull it',
  effects: [{ kind: 'chooseTargets', select: 'self', min: 1, max: 1, from: { zone: 'forwards', controller: 'self', filter: { status: 'dull' } }, then: [{ kind: 'dull' }] }] }
// Vincent 23-119R's shape: "you may select 1 Forward you control … When you do so, choose 1 Forward opponent controls".
const WHEN_YOU_DO = etb('T-VINC:etb', [{ kind: 'chooseTargets', select: 'self', onlyIfChosen: true, min: 0, max: 1, from: { zone: 'forwards', controller: 'self', filter: { excludeSource: true } }, then: [
  { kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'opponent' }, then: [{ kind: 'dull' }] },
] }])

const DEFS: CardDef[] = [
  ...VANILLA_POOL,
  bearer('T-ALPH', OPP_SELECT),
  makeDef({ code: 'T-PRISHE', cost: 2, power: 5000, hasAbilities: true, abilityClauses: 1, abilities: [PUMP] }),
  summonDef('T-SSEL', SELECT_SUMMON),
  bearer('T-VINC', WHEN_YOU_DO),
]

describe('V1-A2 — a select is made at resolution, by whoever the text names', () => {
  it('L1 §11.3.3 — your opponent selects: nothing is asked as the clause is placed, and player 1 answers as it resolves', () => {
    let s = makeGame({ defs: DEFS })
    let alph: CardId, a: CardId, b: CardId
    ;[s, a] = withField(s, 1, 'forwards', 'V-F2')
    ;[s, b] = withField(s, 1, 'forwards', 'V-F7')
    ;[s, alph] = withHand(s, 0, 'T-ALPH')
    s = apply(s, { type: 'castCharacter', player: 0, card: alph, payment: FREE }).state
    expect(s.pending, 'placement declares nothing: a select is not a choice').toBeNull()
    expect(stackIds(s)).toEqual(['T-ALPH:etb'])
    s = pass(pass(s, 0), 1)
    expect(s.pending).toMatchObject({ kind: 'chooseTargets', player: 1, min: 1, max: 1, candidates: [a, b] })
    expect(s.resolution.active?.stage).toBe('resolve')
    expect(stackIds(s), 'the item is resolving, still on top of the stack').toEqual(['T-ALPH:etb'])
    ok(s)
    expect(legalCommands(s, 0).map((c) => c.type), 'the caster waits').toEqual(['concede'])
    expect(legalCommands(s, 1).filter((c) => c.type === 'chooseTargets')).toHaveLength(2)
    const r = apply(s, { type: 'chooseTargets', player: 1, targets: [b] })
    expect(fc(r.state, b)?.status).toBe('dull')
    expect(fc(r.state, a)?.status).toBe('active')
    expect(r.state.pending).toBeNull()
    expect(r.state.stack).toEqual([])
    expect(r.state.priority, 'priority returns to the turn player as after any resolution (§11.1.5)').toBe(0)
    expect(r.state.turnPlayer).toBe(0)
    ok(r.state)
  })

  it('L1 §11.3.3 — a select is not a choice: a "when chosen" watcher does not trigger', () => {
    let s = makeGame({ defs: DEFS })
    let alph: CardId, prishe: CardId
    ;[s, prishe] = withField(s, 1, 'forwards', 'T-PRISHE')
    ;[s, alph] = withHand(s, 0, 'T-ALPH')
    s = apply(s, { type: 'castCharacter', player: 0, card: alph, payment: FREE }).state
    s = pass(pass(s, 0), 1)
    const r = apply(s, { type: 'chooseTargets', player: 1, targets: [prishe] })
    expect(r.events.some((e) => e.type === 'abilityTriggered' && e.abilityId === 'T-PRISHE:chosen')).toBe(false)
    expect(stackIds(r.state)).toEqual([])
    expect(fc(r.state, prishe)?.powerBonus).toBe(0)
    ok(r.state)
  })

  it('L1 §11.3.3 — a Summon whose only node is a select with nothing to select is castable and resolves as a no-op', () => {
    let s = makeGame({ defs: DEFS })
    let card: CardId
    ;[s] = withField(s, 0, 'forwards', 'V-F2')   // active: the filter wants a dull one
    ;[s, card] = withHand(s, 0, 'T-SSEL')
    expect(legalCommands(s, 0).some((c) => c.type === 'castSummon' && c.card === card)).toBe(true)
    const cast = apply(s, { type: 'castSummon', player: 0, card, payment: FREE })
    expect(cast.state.pending, 'nothing is declared as it is cast').toBeNull()
    expect(stackIds(cast.state)).toEqual([`summon:${card}`])
    const r = apply(pass(cast.state, 0), { type: 'pass', player: 1 })
    expect(r.state.pending).toBeNull()
    expect(r.state.stack).toEqual([])
    expect(r.state.players[0].breakZone).toContain(card)
    expect(r.events.some((e) => e.type === 'abilityNoLegalTarget'), 'an empty select is not a failed choice').toBe(false)
    expect(r.events.some((e) => e.type === 'stackCancelled')).toBe(false)
    ok(r.state)
  })
})

describe('V1-A2 — onlyIfChosen: "when you do so" runs only after a pick', () => {
  function vincent(): { s: GameState; own: CardId; foe: CardId } {
    let s = makeGame({ defs: DEFS })
    let own: CardId, foe: CardId, card: CardId
    ;[s, own] = withField(s, 0, 'forwards', 'V-F2')
    ;[s, foe] = withField(s, 1, 'forwards', 'V-F7')
    ;[s, card] = withHand(s, 0, 'T-VINC')
    s = apply(s, { type: 'castCharacter', player: 0, card, payment: FREE }).state
    s = pass(pass(s, 0), 1)
    return { s, own, foe }
  }

  it('an empty answer skips everything nested: no second prompt', () => {
    const { s, foe } = vincent()
    expect(s.pending).toMatchObject({ kind: 'chooseTargets', player: 0, min: 0 })
    const r = apply(s, { type: 'chooseTargets', player: 0, targets: [] })
    expect(r.state.pending).toBeNull()
    expect(r.state.stack).toEqual([])
    expect(fc(r.state, foe)?.status).toBe('active')
    ok(r.state)
  })

  it('a pick runs the nested choice, which prompts the controller at resolution', () => {
    const { s, own, foe } = vincent()
    const picked = apply(s, { type: 'chooseTargets', player: 0, targets: [own] }).state
    expect(picked.pending).toMatchObject({ kind: 'chooseTargets', player: 0, candidates: [foe] })
    ok(picked)
    const done = apply(picked, { type: 'chooseTargets', player: 0, targets: [foe] }).state
    expect(fc(done, foe)?.status).toBe('dull')
    ok(done)
  })
})

describe('V1-A2 — game creation checks the select flags wherever they are nested', () => {
  it('rejects an unknown select and an onlyIfChosen that is not true, inside a mode and an if branch', () => {
    // As data arriving through JSON would: the spreads carry what the types forbid.
    const inMode = etb('T-BAD1:etb', [{ kind: 'chooseModes', min: 1, max: 1, modes: [{ label: 'x', effects: [
      { kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'any' }, then: [], ...({ select: 'anyone' } as object) },
    ] }] }])
    const inIf = etb('T-BAD2:etb', [{ kind: 'if', when: { kind: 'damageReceived', atLeast: 1 }, then: [], else: [
      { kind: 'chooseTargets', min: 0, max: 1, from: { zone: 'forwards', controller: 'any' }, then: [], ...({ onlyIfChosen: 1 } as object) },
    ] }])
    const problems = validateEffects([bearer('T-BAD1', inMode), bearer('T-BAD2', inIf)]).join('; ')
    expect(problems).toMatch(/T-BAD1:etb has an unknown select anyone/)
    expect(problems).toMatch(/T-BAD2:etb has an `onlyIfChosen` that is not true/)
    expect(validateEffects(DEFS)).toEqual([])
  })
})
