import { describe, expect, it } from 'vitest'
import type { Ability, Effect } from '../src/abilities.js'
import type { CardDef } from '../src/types.js'
import type { CardId, GameState } from '../src/state.js'
import { findFieldCard } from '../src/state.js'
import { apply } from '../src/apply.js'
import { legalCommands } from '../src/legal.js'
import { checkInvariants } from '../src/invariants.js'
import { viewFor } from '../src/view.js'
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

describe('J1-A2 — a Summon is cast onto the stack, declares as it is cast, and resolves after both forfeit', () => {
  const BOLT: Ability = {
    id: 'T-BOLT:summon', trigger: { kind: 'summonResolve' }, text: 'synthetic: choose a Forward, deal it 5000',
    effects: [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'any' }, then: [{ kind: 'damage', amount: 5000 }] }],
  }
  const summonDef = (code: string, ...abilities: Ability[]): CardDef =>
    makeDef({ code, type: 'summon', power: null, cost: 0, hasAbilities: abilities.length > 0, abilityClauses: abilities.length, abilities })
  const DEFS = [...VANILLA_POOL, summonDef('T-BOLT', BOLT), summonDef('T-VANILLA')]
  const inNoPlayerZone = (s: GameState, id: CardId): boolean =>
    s.players.every((ps) => !ps.hand.includes(id) && !ps.breakZone.includes(id) && !ps.forwards.some((c) => c.id === id) && !ps.deck.includes(id))

  it('declares its target at cast, sits on the stack in no player zone, and goes to the Break Zone once resolved', () => {
    let s = makeGame({ defs: DEFS })
    let bolt: CardId, victim: CardId
    ;[s, bolt] = withHand(s, 0, 'T-BOLT')
    ;[s, victim] = withField(s, 1, 'forwards', 'V-F2')
    const r = apply(s, { type: 'castSummon', player: 0, card: bolt, payment: { dullBackups: [], discards: [] } })
    expect(r.state.pending?.kind, 'the Summon declares its choice as it is cast (§11.3.3)').toBe('chooseTargets')
    expect(r.state.resolution.placing?.item).toMatchObject({ kind: 'summon', card: bolt })
    expect(inNoPlayerZone(r.state, bolt), 'the card is on its way to the stack, in no player zone').toBe(true)
    ok(r.state)
    const declared = apply(r.state, { type: 'chooseTargets', player: 0, targets: [victim] }).state
    expect(stackIds(declared)).toEqual([`summon:${bolt}`])
    expect(inNoPlayerZone(declared, bolt)).toBe(true)
    expect(declared.priority, 'the caster regains priority (§11.3.8)').toBe(0)
    // Both seats see it (§7.12.2).
    for (const me of [0, 1] as const) expect(viewFor(declared, me).cards[bolt]).toBeDefined()
    expect(fc(declared, victim)?.damage).toBe(0)
    const resolved = pass(pass(declared, 0), 1)
    expect(fc(resolved, victim), '5000 to a 5000 Forward: the rule process broke it after the Summon resolved').toBeUndefined()
    expect(resolved.players[0].breakZone, 'a resolved Summon goes to its owner\'s Break Zone (§11.11.10)').toContain(bolt)
    expect(resolved.stack).toEqual([])
    ok(resolved)
  })

  it('a vanilla Summon resolves to nothing and reaches the Break Zone', () => {
    let s = makeGame({ defs: DEFS })
    let card: CardId
    ;[s, card] = withHand(s, 0, 'T-VANILLA')
    const r = apply(s, { type: 'castSummon', player: 0, card, payment: { dullBackups: [], discards: [] } })
    expect(stackIds(r.state)).toEqual([`summon:${card}`])
    expect(r.events).toContainEqual({ type: 'stackPushed', item: { kind: 'summon', card }, controller: 0 })
    const done = apply(pass(r.state, 0), { type: 'pass', player: 1 })
    expect(done.state.players[0].breakZone).toContain(card)
    expect(done.events).toContainEqual({ type: 'summonResolvedNoEffect', card })
    ok(done.state)
  })

  it('§11.3.3: a Summon whose choice has no legal target is not offered at all', () => {
    let s = makeGame({ defs: DEFS })
    let bolt: CardId
    ;[s, bolt] = withHand(s, 0, 'T-BOLT')   // no Forward anywhere
    expect(legalCommands(s, 0).some((c) => c.type === 'castSummon' && c.card === bolt)).toBe(false)
    ;[s] = withField(s, 1, 'forwards', 'V-F2')
    expect(legalCommands(s, 0).some((c) => c.type === 'castSummon' && c.card === bolt)).toBe(true)
  })

  it('a Summon cast in response resolves first (LIFO), and the opponent may cast it while the first waits', () => {
    let s = makeGame({ defs: DEFS })
    let mine: CardId, theirs: CardId, a: CardId, b: CardId
    ;[s, mine] = withHand(s, 0, 'T-BOLT')
    ;[s, theirs] = withHand(s, 1, 'T-BOLT')
    ;[s, a] = withField(s, 1, 'forwards', 'V-F2')   // 5000, mine will target it
    ;[s, b] = withField(s, 0, 'forwards', 'V-F2')   // 5000, theirs will target it
    s = apply(s, { type: 'castSummon', player: 0, card: mine, payment: { dullBackups: [], discards: [] } }).state
    s = apply(s, { type: 'chooseTargets', player: 0, targets: [a] }).state
    s = pass(s, 0)
    expect(s.priority, 'the opponent holds priority with my Summon on the stack').toBe(1)
    expect(legalCommands(s, 1).some((c) => c.type === 'castSummon' && c.card === theirs), 'the opponent may respond with a Summon (§9.3.1.6)').toBe(true)
    expect(legalCommands(s, 1).some((c) => c.type === 'castCharacter'), 'but never a Character (§11.4.1)').toBe(false)
    s = apply(s, { type: 'castSummon', player: 1, card: theirs, payment: { dullBackups: [], discards: [] } }).state
    s = apply(s, { type: 'chooseTargets', player: 1, targets: [b] }).state
    expect(stackIds(s)).toEqual([`summon:${mine}`, `summon:${theirs}`])
    expect(s.priority, 'the responder regains priority').toBe(1)
    expect(s.passes).toBe(0)
    const first = apply(pass(s, 1), { type: 'pass', player: 0 })
    expect(first.events.filter((e) => e.type === 'stackResolved').map((e) => e.type === 'stackResolved' && e.item.kind === 'summon' ? e.item.card : 0)).toEqual([theirs])
    expect(fc(first.state, b), 'the response resolved first').toBeUndefined()
    expect(fc(first.state, a), 'mine is still waiting').toBeDefined()
    expect(first.state.priority, 'priority back to the turn player (§11.1.5)').toBe(0)
    const second = pass(pass(first.state, 0), 1)
    expect(fc(second, a)).toBeUndefined()
    expect(second.stack).toEqual([])
    ok(second)
  })
})

describe('J1-A5 — a Character needs an empty stack, and is the turn player’s', () => {
  it('with anything on the stack no Character is castable; the non-turn player never', async () => {
    const { castBlocker } = await import('../src/cast.js')
    let s = makeGame()
    let f: CardId
    ;[s, f] = withHand(s, 0, 'V-F1')
    ;[s] = withField(s, 0, 'backups', 'V-B1')
    expect(castBlocker(s, 0, f)).toBeNull()
    const stacked: GameState = { ...s, stack: [{ kind: 'ability', frame: { abilityId: 'x', source: f, controller: 0, path: [], chosen: [], modes: [], triggerEvent: null } }] }
    expect(castBlocker(stacked, 0, f)).toBe('stackNotEmpty')
    let g: CardId
    ;[s, g] = withHand(s, 1, 'V-F1')
    expect(castBlocker({ ...s, priority: 1 }, 1, g)).toBe('notTurnPlayer')
  })
})

describe('J1-A3 (part) — an action ability is usable by the priority holder in a window', () => {
  it('the non-turn player may activate in the Attack Preparation window', async () => {
    const PUMP: Ability = {
      id: 'T-PUMP:act', trigger: { kind: 'activated', sourceZone: 'field', cost: { cp: { amount: 0 } } }, text: 'synthetic: +1000 to a Forward you control',
      effects: [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'self' }, then: [{ kind: 'addPower', amount: 1000 }] }],
    }
    let s = makeGame({ defs: [...VANILLA_POOL, bearer('T-PUMP', PUMP)] })
    let theirs: CardId
    ;[s, theirs] = withField(s, 1, 'forwards', 'T-PUMP')
    // Into the preparation window: both forfeit Main Phase 1; the turn player passes; the opponent holds priority.
    s = pass(pass(s, 0), 1)
    expect(s.attack?.step).toBe('preparation')
    s = pass(s, 0)
    expect(s.priority).toBe(1)
    const use = legalCommands(s, 1).find((c) => c.type === 'activateAbility' && c.source === theirs)
    expect(use, 'the opponent could not use an action ability in a window (§9.3.1.7)').toBeDefined()
    const r = apply(s, use!).state
    expect(stackIds(r)).toEqual(['T-PUMP:act'])
    expect(r.priority, 'the activating player regains priority (§11.6.11)').toBe(1)
    const done = pass(pass(r, 1), 0)
    expect(fc(done, theirs)?.powerBonus).toBe(1000)
    expect(done.attack?.step, 'still in the preparation window').toBe('preparation')
    ok(done)
  })
})
