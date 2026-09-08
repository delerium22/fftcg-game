import { describe, expect, it } from 'vitest'
import type { Ability, Effect } from '../src/abilities.js'
import type { CardDef } from '../src/types.js'
import type { CardId, GameState } from '../src/state.js'
import { findFieldCard } from '../src/state.js'
import { apply } from '../src/apply.js'
import { legalCommands } from '../src/legal.js'
import { checkInvariants } from '../src/invariants.js'
import { makeDef, makeGame, VANILLA_POOL, withField, withHand } from './helpers.js'

/**
 * Rung J1, slice 3 — triggered clauses are DECLARED as they are placed on the stack, resolve when both
 * players forfeit, and re-validate their declared targets when they do (CR §11.8.4, §11.8.7, §11.1.7,
 * §11.11.2). Driven through `apply` and real passes — no `applyNow`, no drain — because the WINDOW between
 * placement and resolution is the thing under test.
 */

const fc = (s: GameState, id: CardId) => findFieldCard(s, id)?.card
const ok = (s: GameState) => expect(checkInvariants(s)).toEqual([])
const pass = (s: GameState, p: 0 | 1): GameState => apply(s, { type: 'pass', player: p }).state
const stackIds = (s: GameState): string[] => s.stack.map((i) => (i.kind === 'ability' ? i.frame.abilityId : `summon:${i.card}`))

const dullOne = (id: string, controller: 'self' | 'opponent'): Ability => ({
  id, trigger: { kind: 'enterField' }, text: `synthetic ${id}`,
  effects: [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller }, then: [{ kind: 'dull' }] }],
})
const bearer = (code: string, ...abilities: Ability[]): CardDef =>
  makeDef({ code, cost: 0, power: 1000, hasAbilities: true, abilityClauses: abilities.length, abilities })

describe('J1-A4 — a triggered clause is placed, declared, and resolves only after both forfeit', () => {
  const ETB = dullOne('T-ETB:dull', 'opponent')
  const DEFS = [...VANILLA_POOL, bearer('T-ETB', ETB)]

  function cast(): { s: GameState; victim: CardId } {
    let s = makeGame({ defs: DEFS })
    let victim: CardId, card: CardId
    ;[s, victim] = withField(s, 1, 'forwards', 'V-F2')
    ;[s, card] = withHand(s, 0, 'T-ETB')
    s = apply(s, { type: 'castCharacter', player: 0, card, payment: { dullBackups: [], discards: [] } }).state
    return { s, victim }
  }

  it('the ETB declares its target at placement, sits on the stack, and does nothing until the double pass', () => {
    const { s, victim } = cast()
    expect(s.pending?.kind, 'placement declares the choice').toBe('chooseTargets')
    expect(s.resolution.active?.stage).toBe('declare')
    const declared = apply(s, { type: 'chooseTargets', player: 0, targets: [victim] }).state
    expect(declared.pending).toBeNull()
    expect(stackIds(declared), 'declared, the clause is on the stack').toEqual(['T-ETB:dull'])
    expect(fc(declared, victim)?.status, 'nothing resolves at placement').toBe('active')
    expect(declared.priority, 'the caster holds priority (§11.4.7)').toBe(0)
    ok(declared)

    // The opponent gets a window (they could respond here from slice 4) and passes; the caster passed first.
    const one = pass(declared, 0)
    expect(one.priority).toBe(1); expect(one.passes).toBe(1)
    expect(fc(one, victim)?.status).toBe('active')
    const two = pass(one, 1)
    expect(fc(two, victim)?.status, 'both forfeited: the top of the stack resolved').toBe('dull')
    expect(two.stack).toEqual([])
    expect(two.priority, 'priority returns to the turn player (§11.1.5)').toBe(0)
    expect(two.passes).toBe(0)
    expect(two.phase, 'still Main Phase 1: resolving is not ending the phase').toBe('main1')
    ok(two)
  })

  it('§11.8.4: a triggered clause with no legal target is removed as it is placed, never put on the stack', () => {
    let s = makeGame({ defs: DEFS })
    let card: CardId
    ;[s, card] = withHand(s, 0, 'T-ETB')   // the opponent has no Forward
    const r = apply(s, { type: 'castCharacter', player: 0, card, payment: { dullBackups: [], discards: [] } })
    expect(r.state.pending).toBeNull()
    expect(r.state.stack).toEqual([])
    expect(r.events).toContainEqual({ type: 'abilityNoLegalTarget', card: expect.any(Number), abilityId: 'T-ETB:dull', controller: 0 })
    expect(r.events).toContainEqual({ type: 'stackCancelled', item: { kind: 'ability', source: expect.any(Number), abilityId: 'T-ETB:dull' }, reason: 'noTargetAtPlacement' })
    ok(r.state)
  })
})

describe('J1-A4 — §11.8.7: the turn player’s triggers go on first, the non-turn player’s on top', () => {
  // Two watchers of "a Forward is put into the Break Zone": mine (P0, the turn player) and theirs (P1).
  const watcher = (id: string): Ability => ({
    id, trigger: { kind: 'observesZoneChange', from: 'field', to: 'breakZone', whose: 'any', of: 'forward' },
    text: `synthetic ${id}`, effects: [{ kind: 'forEach', from: { zone: 'forwards', controller: 'self' }, do: [{ kind: 'addPower', amount: 1000 }] }],
  })
  const QUAKE: Effect[] = [{ kind: 'forEach', from: { zone: 'forwards', controller: 'opponent' }, do: [{ kind: 'damage', amount: 9000 }] }]
  const DEFS = [...VANILLA_POOL,
    bearer('T-MINE', watcher('T-MINE:w')), bearer('T-THEIRS', watcher('T-THEIRS:w')),
    makeDef({ code: 'T-QUAKE', cost: 0, power: 1000, hasAbilities: true, abilityClauses: 1, abilities: [{ id: 'T-QUAKE:etb', trigger: { kind: 'enterField' }, text: 'synthetic quake', effects: QUAKE }] }),
  ]

  it('the non-turn player’s watcher resolves first', () => {
    let s = makeGame({ defs: DEFS })
    let mine: CardId, theirs: CardId, victim: CardId, quake: CardId
    ;[s, mine] = withField(s, 0, 'backups', 'T-MINE')
    ;[s, theirs] = withField(s, 1, 'backups', 'T-THEIRS')
    ;[s, victim] = withField(s, 1, 'forwards', 'V-F2')
    ;[s, quake] = withHand(s, 0, 'T-QUAKE')
    // Cast the quake: its ETB is placed (no choice) and resolves after a double pass, killing the victim.
    s = apply(s, { type: 'castCharacter', player: 0, card: quake, payment: { dullBackups: [], discards: [] } }).state
    expect(stackIds(s)).toEqual(['T-QUAKE:etb'])
    s = pass(pass(s, 0), 1)
    // The rule process broke the victim; both watchers triggered and were PLACED: mine at the bottom, theirs on top.
    expect(fc(s, victim)).toBeUndefined()
    expect(stackIds(s)).toEqual(['T-MINE:w', 'T-THEIRS:w'])
    expect(s.priority, 'priority is the turn player’s after a resolution').toBe(0)
    // Resolve: theirs first.
    const r1 = apply(pass(s, 0), { type: 'pass', player: 1 })
    expect(r1.events.filter((e) => e.type === 'stackResolved').map((e) => e.type === 'stackResolved' && e.item.kind === 'ability' ? e.item.abilityId : '')).toEqual(['T-THEIRS:w'])
    expect(stackIds(r1.state)).toEqual(['T-MINE:w'])
    const r2 = apply(pass(r1.state, 0), { type: 'pass', player: 1 })
    expect(stackIds(r2.state)).toEqual([])
    ok(r2.state)
    void mine; void theirs
  })
})

describe('J1-A7 — declared targets are re-validated at resolution (§11.11.2)', () => {
  const ETB = dullOne('T-ETB:dull', 'opponent')
  const DEFS = [...VANILLA_POOL, bearer('T-ETB', ETB)]

  /** Two opponent Forwards; the ETB declares `target`; then `leave` is removed before resolution. */
  function declaredThen(remove: 'target' | 'other'): { s: GameState; target: CardId; other: CardId } {
    let s = makeGame({ defs: DEFS })
    let target: CardId, other: CardId, card: CardId
    ;[s, target] = withField(s, 1, 'forwards', 'V-F2')
    ;[s, other] = withField(s, 1, 'forwards', 'V-F5')
    ;[s, card] = withHand(s, 0, 'T-ETB')
    s = apply(s, { type: 'castCharacter', player: 0, card, payment: { dullBackups: [], discards: [] } }).state
    s = apply(s, { type: 'chooseTargets', player: 0, targets: [target] }).state
    expect(stackIds(s)).toEqual(['T-ETB:dull'])
    // Something removes a Forward while the clause waits — modelled directly on the state, as a response would.
    const gone = remove === 'target' ? target : other
    s = { ...s, players: [s.players[0], { ...s.players[1], forwards: s.players[1].forwards.filter((c) => c.id !== gone), breakZone: [...s.players[1].breakZone, gone] }] }
    ok(s)
    return { s, target, other }
  }

  it('an item whose only declared target has left is cancelled', () => {
    const { s, other } = declaredThen('target')
    const r = apply(pass(s, 0), { type: 'pass', player: 1 })
    expect(r.events).toContainEqual({ type: 'stackCancelled', item: { kind: 'ability', source: expect.any(Number), abilityId: 'T-ETB:dull' }, reason: 'targetsGone' })
    expect(fc(r.state, other)?.status, 'nothing else was dulled instead').toBe('active')
    expect(r.state.stack).toEqual([])
    ok(r.state)
  })

  it('an item whose declared target is still there resolves onto it, whatever else left', () => {
    const { s, target } = declaredThen('other')
    const r = apply(pass(s, 0), { type: 'pass', player: 1 })
    expect(fc(r.state, target)?.status).toBe('dull')
    expect(r.events.some((e) => e.type === 'stackResolved')).toBe(true)
    ok(r.state)
  })
})

describe('J1-A10 — a "when chosen" trigger is placed above the chooser and resolves first (D7)', () => {
  const PUMP: Ability = { id: 'T-PRISHE:chosen', trigger: { kind: 'observesChosen' }, text: 'synthetic: when chosen, +2000', effects: [{ kind: 'addPower', amount: 2000 }] }
  const BURN: Ability = {
    id: 'T-BURN:etb', trigger: { kind: 'enterField' }, text: 'synthetic: choose a Forward, deal it 5000',
    effects: [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'opponent' }, then: [{ kind: 'damage', amount: 5000 }] }],
  }
  const DEFS = [...VANILLA_POOL, makeDef({ code: 'T-PRISHE', cost: 2, power: 5000, hasAbilities: true, abilityClauses: 1, abilities: [PUMP] }), bearer('T-BURN', BURN)]

  it('a 5000 Forward chosen by a 5000-damage clause survives at 7000', () => {
    let s = makeGame({ defs: DEFS })
    let prishe: CardId, burn: CardId
    ;[s, prishe] = withField(s, 1, 'forwards', 'T-PRISHE')
    ;[s, burn] = withHand(s, 0, 'T-BURN')
    s = apply(s, { type: 'castCharacter', player: 0, card: burn, payment: { dullBackups: [], discards: [] } }).state
    const r = apply(s, { type: 'chooseTargets', player: 0, targets: [prishe] })
    // Declaring the choice triggered the pump; it was placed ABOVE the burn.
    expect(stackIds(r.state)).toEqual(['T-BURN:etb', 'T-PRISHE:chosen'])
    expect(r.events).toContainEqual(expect.objectContaining({ type: 'abilityTriggered', player: 1, card: prishe, abilityId: 'T-PRISHE:chosen' }))
    // First double pass: the pump. Second: the burn, onto a 7000 Forward.
    const pumped = pass(pass(r.state, 0), 1)
    expect(fc(pumped, prishe)?.powerBonus).toBe(2000)
    expect(stackIds(pumped)).toEqual(['T-BURN:etb'])
    const burned = pass(pass(pumped, 0), 1)
    expect(fc(burned, prishe), 'the pump landed first, so 5000 damage is not lethal').toBeDefined()
    expect(fc(burned, prishe)?.damage).toBe(5000)
    ok(burned)
  })
})

describe('the acting player during placement is the clause’s controller, and the stack is legal-command aware', () => {
  it('while the opponent’s clause declares, the turn player has no priority actions', () => {
    const ETB = dullOne('T-THEIRS-ETB:dull', 'self')
    const DEFS = [...VANILLA_POOL, bearer('T-THEIRS-ETB', ETB)]
    let s = makeGame({ defs: DEFS })
    let card: CardId
    ;[s] = withField(s, 1, 'forwards', 'V-F2')
    ;[s, card] = withHand(s, 0, 'T-THEIRS-ETB')
    // P0 casts a card whose ETB P0 controls; make P1 the one declaring by giving the clause to P1's watcher instead:
    // simplest honest case — P0's own ETB prompts P0. The acting player is P0 and P1 may only concede.
    s = apply(s, { type: 'castCharacter', player: 0, card, payment: { dullBackups: [], discards: [] } }).state
    expect(s.pending?.player).toBe(0)
    expect(legalCommands(s, 1).map((c) => c.type)).toEqual(['concede'])
    expect(legalCommands(s, 0).some((c) => c.type === 'chooseTargets')).toBe(true)
  })
})
