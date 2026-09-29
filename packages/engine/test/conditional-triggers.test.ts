import { describe, expect, it } from 'vitest'
import type { Ability } from '../src/abilities.js'
import type { CardDef } from '../src/types.js'
import type { CardId, GameState } from '../src/state.js'
import { findFieldCard } from '../src/state.js'
import { apply } from '../src/apply.js'
import { checkInvariants } from '../src/invariants.js'
import { createGame, validateEffects } from '../src/setup.js'
import { DEFAULT_DECK, makeDef, makeGame, VANILLA_POOL, withField, withHand } from './helpers.js'

/**
 * Rung V1-D (spec V1-D, plan D-D1/R4): conditional auto-abilities, "(trigger), if (condition), (effect)" (§11.8.13). The
 * condition is checked as the event happens — false, the clause does not trigger at all — and again as the item starts
 * resolving (§11.11.3) — false then, it is removed from the stack and does nothing. Driven through `apply` and real
 * passes, because the window between placement and resolution is where the condition can change.
 */

const ok = (s: GameState) => expect(checkInvariants(s)).toEqual([])
const pass = (s: GameState, p: 0 | 1): GameState => apply(s, { type: 'pass', player: p }).state
const stackIds = (s: GameState): string[] => s.stack.map((i) => (i.kind === 'ability' ? i.frame.abilityId : `summon:${i.card}`))
const power = (s: GameState, id: CardId): number | undefined => findFieldCard(s, id)?.card.powerBonus

/** "When T-COND enters the field, if you control 3 or more Water Characters, T-COND gains +1000 power." */
const CONDITIONAL: Ability = {
  id: 'T-COND:etb', trigger: { kind: 'enterField' }, text: 'synthetic conditional ETB',
  triggerIf: { kind: 'controlsAtLeast', count: 3, controller: 'self', filter: { element: 'water' } },
  effects: [{ kind: 'onSource', do: [{ kind: 'addPower', amount: 1000 }] }],
}
const DEFS: CardDef[] = [
  ...VANILLA_POOL,
  makeDef({ code: 'T-COND', cost: 0, power: 5000, hasAbilities: true, abilityClauses: 1, abilities: [CONDITIONAL] }),
  makeDef({ code: 'T-WB', type: 'backup', elements: ['water'], cost: 0, power: null }),
]

/** `waters` Water Backups on P0's field, T-COND cast from hand. */
function castWith(waters: number): { s: GameState; cond: CardId; backups: CardId[]; events: ReturnType<typeof apply>['events'] } {
  let s = makeGame({ defs: DEFS })
  const backups: CardId[] = []
  for (let i = 0; i < waters; i++) { let b: CardId; [s, b] = withField(s, 0, 'backups', 'T-WB'); backups.push(b) }
  let cond: CardId
  ;[s, cond] = withHand(s, 0, 'T-COND')
  const r = apply(s, { type: 'castCharacter', player: 0, card: cond, payment: { dullBackups: [], discards: [] } })
  return { s: r.state, cond, backups, events: r.events }
}

describe('§11.8.13 — a conditional auto-ability triggers only if its condition holds as the event happens', () => {
  it('triggers with the condition met, and resolves', () => {
    const { s, cond, events } = castWith(3)
    expect(events).toContainEqual(expect.objectContaining({ type: 'abilityTriggered', abilityId: 'T-COND:etb' }))
    expect(stackIds(s)).toEqual(['T-COND:etb'])
    const after = pass(pass(s, 0), 1)
    expect(power(after, cond)).toBe(1000)
    ok(after)
  })

  it('does not trigger with the condition unmet: no event, nothing on the stack', () => {
    const { s, events } = castWith(2)
    expect(events.some((e) => e.type === 'abilityTriggered')).toBe(false)
    expect(s.stack).toEqual([])
    expect(s.resolution.queue).toEqual([])
    ok(s)
  })

  it('a condition that becomes true only after the event never triggers it (Review Focus 1)', () => {
    const { s: s0, cond } = castWith(2)
    let s = s0
    let third: CardId
    ;[s, third] = withHand(s, 0, 'T-WB')
    const r = apply(s, { type: 'castCharacter', player: 0, card: third, payment: { dullBackups: [], discards: [] } })
    expect(r.state.players[0].backups.length, 'three Water Characters now').toBe(3)
    expect(r.events.some((e) => e.type === 'abilityTriggered')).toBe(false)
    expect(r.state.resolution.queue).toEqual([])
    expect(power(r.state, cond)).toBe(0)
    ok(r.state)
  })
})

describe('§11.11.3 — a conditional auto-ability re-checks its condition as it resolves', () => {
  it('a condition that became false while the item waited cancels it, with a visible event (Review Focus 1)', () => {
    const { s: placed, cond, backups } = castWith(3)
    expect(stackIds(placed)).toEqual(['T-COND:etb'])
    // A Water Backup leaves while the clause waits — modelled on the state, as a response would (cr11-stack's J1-A7).
    const gone = backups[0]!
    const s: GameState = { ...placed, players: [{ ...placed.players[0], backups: placed.players[0].backups.filter((c) => c.id !== gone), breakZone: [...placed.players[0].breakZone, gone] }, placed.players[1]] }
    ok(s)
    const r = apply(pass(s, 0), { type: 'pass', player: 1 })
    expect(r.events).toContainEqual({ type: 'stackCancelled', item: { kind: 'ability', source: cond, abilityId: 'T-COND:etb' }, reason: 'condition' })
    expect(r.events.some((e) => e.type === 'abilityNoLegalTarget'), 'a condition is not a target').toBe(false)
    expect(power(r.state, cond), 'the effect did nothing').toBe(0)
    expect(r.state.stack).toEqual([])
    ok(r.state)
  })

  it('a condition still met at resolution resolves normally', () => {
    const { s, cond } = castWith(4)
    const placed: GameState = { ...s, players: [{ ...s.players[0], backups: s.players[0].backups.slice(1) }, s.players[1]] }
    const r = apply(pass(placed, 0), { type: 'pass', player: 1 })
    expect(r.events.some((e) => e.type === 'stackCancelled')).toBe(false)
    expect(power(r.state, cond)).toBe(1000)
  })
})

describe('§11.8.13 — game creation checks a trigger condition', () => {
  const bad = (a: Ability): string => validateEffects([makeDef({ code: 'T-BAD', hasAbilities: true, abilities: [a] })]).join('; ')

  it('refuses a condition on an activated or a static ability, which never triggers', () => {
    const when = { kind: 'damageReceived', atLeast: 1 } as const
    expect(bad({ id: 'T-BAD:act', trigger: { kind: 'activated', sourceZone: 'field', cost: {} }, triggerIf: when, text: '', effects: [] }))
      .toMatch(/T-BAD:act has a trigger condition on an ability that does not trigger/)
    expect(bad({ id: 'T-BAD:st', trigger: { kind: 'static', effect: { kind: 'produceElement', element: 'fire' } }, triggerIf: when, text: '', effects: [] }))
      .toMatch(/T-BAD:st has a trigger condition on an ability that does not trigger/)
  })

  it('refuses a condition that counts on an instance axis or by a count below 1', () => {
    const on = (triggerIf: NonNullable<Ability['triggerIf']>): Ability => ({ id: 'T-BAD:etb', trigger: { kind: 'enterField' }, triggerIf, text: '', effects: [] })
    expect(bad(on({ kind: 'controlsAtLeast', count: 0, controller: 'self' }))).toMatch(/T-BAD:etb has a condition count 0/)
    expect(bad(on({ kind: 'controlsAtLeast', count: 1, controller: 'self', filter: { status: 'dull' } as object }))).toMatch(/T-BAD:etb counts on instance axis status/)
    expect(bad(on({ kind: 'controlsAtLeast', count: 1, controller: 'nobody' as 'self' }))).toMatch(/T-BAD:etb has an unknown condition controller/)
  })

  it('accepts the synthetic card', () => {
    expect(() => createGame({ seed: 1, decks: [DEFAULT_DECK, DEFAULT_DECK], defs: DEFS })).not.toThrow()
  })
})
