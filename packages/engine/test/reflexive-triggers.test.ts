import { describe, expect, it } from 'vitest'
import type { Ability, Effect } from '../src/abilities.js'
import type { CardDef } from '../src/types.js'
import type { CardId, GameState } from '../src/state.js'
import { findFieldCard } from '../src/state.js'
import { apply } from '../src/apply.js'
import type { Event } from '../src/events.js'
import { checkInvariants } from '../src/invariants.js'
import { validateEffects } from '../src/setup.js'
import { makeDef, makeGame, VANILLA_POOL, withField, withHand } from './helpers.js'

/**
 * Rung V1-D (plan D-D2, R3, R6): "When you do so, …" is a REFLEXIVE auto-ability. The official ruling of 2019-07-19
 * (Fusilier 9-013C): the follow-up is put on the stack after the first part resolves, and players may respond. So the
 * clause is its own stack item: fired only by a `triggerReflexive` effect, placed at the next priority grant like any
 * trigger, its "choose" declared as it is placed (§11.8.4 applies), and resolved after a window. Driven through `apply`
 * and real passes — the window is the thing under test.
 */

const ok = (s: GameState) => expect(checkInvariants(s)).toEqual([])
const stackIds = (s: GameState): string[] => s.stack.map((i) => (i.kind === 'ability' ? i.frame.abilityId : `summon:${i.card}`))

/** Vincent's shape: "you may put 1 Fire Backup you control into the Break Zone. When you do so, choose 1 Forward opponent controls. Deal it 9000 damage." */
const ETB: Ability = {
  id: 'T-VINC:etb', trigger: { kind: 'enterField' }, text: 'synthetic: you may put 1 Fire Backup you control into the Break Zone.',
  effects: [{
    kind: 'chooseTargets', select: 'self', onlyIfChosen: true, min: 0, max: 1,
    from: { zone: 'backups', controller: 'self', filter: { element: 'fire' } },
    then: [{ kind: 'putIntoBreakZone' }, { kind: 'triggerReflexive', abilityId: 'T-VINC:when-you-do-so' }],
  }],
}
const REFLEX: Ability = {
  id: 'T-VINC:when-you-do-so', trigger: { kind: 'reflexive' }, text: 'When you do so, choose 1 Forward opponent controls. Deal it 9000 damage.',
  effects: [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'opponent' }, then: [{ kind: 'damage', amount: 9000 }] }],
}
/** The response: "Choose 1 Forward you control. Put it into the Break Zone." — removes the Forward the reflexive chose. */
const SACRIFICE: Ability = {
  id: 'T-SAC:summon', trigger: { kind: 'summonResolve' }, text: 'synthetic sacrifice',
  effects: [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'self' }, then: [{ kind: 'putIntoBreakZone' }] }],
}
/** A zone watcher on Vincent's side: "When a Backup you control is put into the Break Zone, draw 1 card." */
const WATCH: Ability = {
  id: 'T-WATCH:w', trigger: { kind: 'observesZoneChange', from: 'field', to: 'breakZone', whose: 'self', of: 'backup' }, text: 'synthetic watcher',
  effects: [{ kind: 'draw', count: 1 }],
}
const DEFS: CardDef[] = [
  ...VANILLA_POOL,
  makeDef({ code: 'T-VINC', elements: ['fire'], cost: 0, power: 7000, hasAbilities: true, abilityClauses: 2, abilities: [ETB, REFLEX] }),
  makeDef({ code: 'T-FB', type: 'backup', elements: ['fire'], cost: 0, power: null }),
  makeDef({ code: 'T-SAC', type: 'summon', cost: 0, power: null, hasAbilities: true, abilityClauses: 1, abilities: [SACRIFICE] }),
  makeDef({ code: 'T-WATCH', type: 'backup', cost: 0, power: null, hasAbilities: true, abilityClauses: 1, abilities: [WATCH] }),
]

const pass = (log: Event[], s: GameState, p: 0 | 1): GameState => step(log, s, { type: 'pass', player: p })
function step(log: Event[], s: GameState, c: Parameters<typeof apply>[1]): GameState {
  const r = apply(s, c)
  log.push(...r.events)
  return r.state
}

/** Vincent cast; his ETB on the stack, both pass, and the select is asked. */
function toSelect(opts: { victim?: boolean; watcher?: boolean } = {}) {
  let s = makeGame({ defs: DEFS })
  const log: Event[] = []
  let vinc: CardId, fb: CardId, victim: CardId | null = null, watcher: CardId | null = null
  if (opts.victim !== false) [s, victim] = withField(s, 1, 'forwards', 'V-F2')   // 5000
  if (opts.watcher) [s, watcher] = withField(s, 0, 'backups', 'T-WATCH')
  ;[s, fb] = withField(s, 0, 'backups', 'T-FB')
  ;[s, vinc] = withHand(s, 0, 'T-VINC')
  s = step(log, s, { type: 'castCharacter', player: 0, card: vinc, payment: { dullBackups: [], discards: [] } })
  expect(stackIds(s)).toEqual(['T-VINC:etb'])
  s = pass(log, pass(log, s, 0), 1)
  expect(s.pending).toEqual({ kind: 'chooseTargets', player: 0, min: 0, max: 1, candidates: [fb] })
  return { s, log, vinc, fb, victim, watcher }
}

describe('V1-D — "When you do so" is its own auto-ability, placed after the first part resolves', () => {
  it('the reflexive clause triggers, declares its choice as it is placed, and waits on the stack', () => {
    const { s: s0, log, vinc, fb, victim } = toSelect()
    let s = step(log, s0, { type: 'chooseTargets', player: 0, targets: [fb] })
    expect(s.players[0].breakZone).toContain(fb)
    expect(log).toContainEqual({ type: 'stackResolved', item: { kind: 'ability', source: vinc, abilityId: 'T-VINC:etb' } })
    expect(log).toContainEqual({ type: 'abilityTriggered', player: 0, card: vinc, abilityId: 'T-VINC:when-you-do-so', cause: null })
    // Declared at placement (R3): the choice is asked before any priority, and nothing is dealt yet.
    expect(s.resolution.active?.stage).toBe('declare')
    expect(s.pending).toEqual({ kind: 'chooseTargets', player: 0, min: 1, max: 1, candidates: [victim] })
    s = step(log, s, { type: 'chooseTargets', player: 0, targets: [victim!] })
    expect(stackIds(s)).toEqual(['T-VINC:when-you-do-so'])
    expect(findFieldCard(s, victim!)?.card.damage, 'nothing resolves at placement').toBe(0)
    expect(s.priority).toBe(0)
    ok(s)
    s = pass(log, pass(log, s, 0), 1)
    expect(findFieldCard(s, victim!), '9000 breaks the 5000 Forward').toBeNull()
    expect(s.stack).toEqual([])
    ok(s)
  })

  it('the opponent may respond between the put and the damage: removing the chosen Forward cancels it (Review Focus 2, §11.11.2)', () => {
    const { s: s0, log, vinc, fb, victim } = toSelect()
    let s = step(log, s0, { type: 'chooseTargets', player: 0, targets: [fb] })
    s = step(log, s, { type: 'chooseTargets', player: 0, targets: [victim!] })
    let sac: CardId
    ;[s, sac] = withHand(s, 1, 'T-SAC')
    s = pass(log, s, 0)
    expect(s.priority, 'the opponent holds priority with the reflexive on the stack').toBe(1)
    s = step(log, s, { type: 'castSummon', player: 1, card: sac, payment: { dullBackups: [], discards: [] } })
    s = step(log, s, { type: 'chooseTargets', player: 1, targets: [victim!] })
    expect(stackIds(s)).toEqual(['T-VINC:when-you-do-so', `summon:${sac}`])
    s = pass(log, pass(log, s, 1), 0)
    expect(findFieldCard(s, victim!), 'the response resolved first').toBeNull()
    s = pass(log, pass(log, s, 0), 1)
    expect(log).toContainEqual({ type: 'stackCancelled', item: { kind: 'ability', source: vinc, abilityId: 'T-VINC:when-you-do-so' }, reason: 'targetsGone' })
    expect(log.some((e) => e.type === 'abilityDamage')).toBe(false)
    expect(s.stack).toEqual([])
    ok(s)
  })

  it('declining the select fires no reflexive trigger', () => {
    const { s: s0, log, fb } = toSelect()
    const s = step(log, s0, { type: 'chooseTargets', player: 0, targets: [] })
    expect(s.players[0].backups.map((b) => b.id)).toContain(fb)
    expect(log.filter((e) => e.type === 'abilityTriggered').map((e) => e.type === 'abilityTriggered' && e.abilityId)).toEqual(['T-VINC:etb'])
    expect(s.pending).toBeNull()
    expect(s.stack).toEqual([])
    ok(s)
  })

  it('with no opposing Forward when it is placed, the reflexive clause triggers and is removed (§11.8.4)', () => {
    const { s: s0, log, vinc, fb } = toSelect({ victim: false })
    const s = step(log, s0, { type: 'chooseTargets', player: 0, targets: [fb] })
    expect(s.players[0].breakZone, 'the first part still happened').toContain(fb)
    expect(log).toContainEqual(expect.objectContaining({ type: 'abilityTriggered', abilityId: 'T-VINC:when-you-do-so' }))
    expect(log).toContainEqual({ type: 'stackCancelled', item: { kind: 'ability', source: vinc, abilityId: 'T-VINC:when-you-do-so' }, reason: 'noTargetAtPlacement' })
    expect(s.stack).toEqual([])
    expect(s.pending).toBeNull()
    ok(s)
  })

  it('a zone watcher of the put resolves before the reflexive (same controller: last-triggered placed first, §11.8.7 simplified)', () => {
    const { s: s0, log, fb, victim } = toSelect({ watcher: true })
    let s = step(log, s0, { type: 'chooseTargets', player: 0, targets: [fb] })
    // The watcher triggered first (at the put), the reflexive second; the reflexive is placed first and declares.
    s = step(log, s, { type: 'chooseTargets', player: 0, targets: [victim!] })
    expect(stackIds(s)).toEqual(['T-VINC:when-you-do-so', 'T-WATCH:w'])
    const hand = s.players[0].hand.length
    s = pass(log, pass(log, s, 0), 1)
    expect(s.players[0].hand.length, 'the watcher drew first').toBe(hand + 1)
    expect(stackIds(s)).toEqual(['T-VINC:when-you-do-so'])
    ok(s)
  })
})

describe('V1-D — game creation checks a reflexive clause', () => {
  const bad = (abilities: Ability[]): string => validateEffects([makeDef({ code: 'T-BAD', hasAbilities: true, abilities })]).join('; ')
  const fire = (abilityId: string): Effect => ({ kind: 'triggerReflexive', abilityId })

  it('refuses a trigger of a clause that is not a reflexive clause on the same card', () => {
    expect(bad([{ id: 'T-BAD:etb', trigger: { kind: 'enterField' }, text: '', effects: [fire('T-BAD:nope')] }]))
      .toMatch(/T-BAD:etb triggers T-BAD:nope, which is not a reflexive clause of this card/)
    expect(bad([
      { id: 'T-BAD:etb', trigger: { kind: 'enterField' }, text: '', effects: [fire('T-BAD:other')] },
      { id: 'T-BAD:other', trigger: { kind: 'enterField' }, text: '', effects: [] },
    ])).toMatch(/T-BAD:etb triggers T-BAD:other, which is not a reflexive clause of this card/)
  })

  it('refuses a reflexive clause that triggers a reflexive clause, at any depth', () => {
    expect(bad([
      { id: 'T-BAD:r', trigger: { kind: 'reflexive' }, text: '', effects: [{ kind: 'if', when: { kind: 'damageReceived', atLeast: 0 }, then: [fire('T-BAD:r')] }] },
    ])).toMatch(/T-BAD:r is a reflexive clause that triggers a reflexive clause/)
  })

  it('accepts the synthetic Vincent', () => {
    expect(validateEffects(DEFS)).toEqual([])
  })
})
