import { describe, expect, it } from 'vitest'
import type { Ability, Effect, Frame } from '../src/abilities.js'
import type { CardId, DamageOccurrence, GameState } from '../src/state.js'
import type { Event } from '../src/events.js'
import type { DamagePacket } from '../src/damage.js'
import { applyDamagePacket, damageProvenance, previewDamagePacket } from '../src/damage.js'
import { defOf, findFieldCard } from '../src/state.js'
import { drainResolution, enqueueTrigger } from '../src/resolve.js'
import { checkInvariants } from '../src/invariants.js'
import { applyNow, makeDef, makeGame, VANILLA_POOL, withField, withHand } from './helpers.js'

/**
 * Rung V2-A1 (spec V2-D1, plan R2–R5): every damage to a Forward is a PACKET applied at one point. These pin the pure
 * applier on hand-built packets, and the provenance a resolving frame gives its damage (spec V2-D6's `cause`).
 */

const battle = (target: number, dealers: [number, 0 | 1][], amount: number): DamagePacket => ({
  target, amount, cause: 'battle', causeController: dealers[0]![1], dealers: dealers.map(([source, sourceController]) => ({ source, sourceController })),
})

describe('applyDamagePacket (rung V2-A1, spec V2-D1)', () => {
  it('one dealer: marks the damage, one battleDamage event, one occurrence carrying the final amount', () => {
    let s = makeGame(); let a: number, b: number
    ;[s, a] = withField(s, 0, 'forwards', 'V-F2')
    ;[s, b] = withField(s, 1, 'forwards', 'V-F3')
    const r = applyDamagePacket(s, battle(b, [[a, 0]], 5000))
    expect(r.applied).toBe(true)
    expect(r.final).toBe(5000)
    expect(r.trace).toEqual([])
    expect(findFieldCard(r.state, b)?.card.damage).toBe(5000)
    expect(r.events).toEqual([{ type: 'battleDamage', target: b, dealers: [a], original: 5000, amount: 5000, trace: [] }])
    expect(r.occurrences).toEqual([{ source: a, sourceController: 0, target: b, victim: null, amount: 5000, targetController: 1 }])
  })

  it('§15.1.1.9.8: a party packet is ONE total — one mark, one event naming every dealer, one occurrence PER dealer', () => {
    let s = makeGame(); let a1: number, a2: number, b: number
    ;[s, a1] = withField(s, 0, 'forwards', 'V-F1')
    ;[s, a2] = withField(s, 0, 'forwards', 'V-F2')
    ;[s, b] = withField(s, 1, 'forwards', 'V-F3', { damage: 1000 })
    const r = applyDamagePacket(s, battle(b, [[a1, 0], [a2, 0]], 8000))
    expect(findFieldCard(r.state, b)?.card.damage).toBe(9000)
    expect(r.events).toEqual([{ type: 'battleDamage', target: b, dealers: [a1, a2], original: 8000, amount: 8000, trace: [] }])
    // Each member is a source of the whole packet (§15.1.1.9.8), for its dealt-damage clause.
    expect(r.occurrences.map((o) => [o.source, o.amount, o.targetController])).toEqual([[a1, 8000, 1], [a2, 8000, 1]])
  })

  it('an ability packet emits abilityDamage from its one source', () => {
    let s = makeGame(); let src: number, f: number
    ;[s, src] = withField(s, 0, 'backups', 'V-B1')
    ;[s, f] = withField(s, 1, 'forwards', 'V-F3')
    const r = applyDamagePacket(s, { target: f, amount: 3000, cause: 'ability', causeController: 0, dealers: [{ source: src, sourceController: 0 }] })
    expect(r.events).toEqual([{ type: 'abilityDamage', source: src, target: f, original: 3000, amount: 3000, trace: [] }])
    expect(r.occurrences).toEqual([{ source: src, sourceController: 0, target: f, victim: null, amount: 3000, targetController: 1 }])
  })

  it('a non-battle packet has exactly one dealer', () => {
    let s = makeGame(); let a1: number, a2: number, f: number
    ;[s, a1] = withField(s, 0, 'forwards', 'V-F1')
    ;[s, a2] = withField(s, 0, 'forwards', 'V-F2')
    ;[s, f] = withField(s, 1, 'forwards', 'V-F3')
    const dealers = [{ source: a1, sourceController: 0 as const }, { source: a2, sourceController: 0 as const }]
    expect(() => applyDamagePacket(s, { target: f, amount: 3000, cause: 'summon', causeController: 0, dealers })).toThrow(/one dealer/)
  })

  it('a target that left the field: not applied, and nothing changes or is emitted (plan R3)', () => {
    let s = makeGame(); let a: number
    ;[s, a] = withField(s, 0, 'forwards', 'V-F2')
    const gone = 99_999
    const r = applyDamagePacket(s, battle(gone, [[a, 0]], 5000))
    expect(r).toEqual({ state: s, applied: false, final: 0, trace: [], occurrences: [], events: [] })
    expect(r.state).toBe(s)
    expect(previewDamagePacket(s, battle(gone, [[a, 0]], 5000))).toEqual({ applied: false, final: 0 })
  })

  it('a Backup is not a Forward: only Forwards carry damage (plan R3)', () => {
    let s = makeGame(); let a: number, bk: number
    ;[s, a] = withField(s, 0, 'forwards', 'V-F2')
    ;[s, bk] = withField(s, 1, 'backups', 'V-B1')
    const r = applyDamagePacket(s, battle(bk, [[a, 0]], 5000))
    expect(r.applied).toBe(false)
    expect(r.state).toBe(s)
    expect(r.events).toEqual([])
    expect(previewDamagePacket(s, battle(bk, [[a, 0]], 5000))).toEqual({ applied: false, final: 0 })
  })

  it('previewDamagePacket agrees with the applier and changes nothing', () => {
    let s = makeGame(); let a: number, b: number
    ;[s, a] = withField(s, 0, 'forwards', 'V-F2')
    ;[s, b] = withField(s, 1, 'forwards', 'V-F3')
    const before = JSON.stringify(s)
    const p = battle(b, [[a, 0]], 5000)
    expect(previewDamagePacket(s, p)).toEqual({ applied: true, final: applyDamagePacket(s, p).final })
    expect(JSON.stringify(s)).toBe(before)
  })
})

describe('damageProvenance (rung V2-A1, plan R5, spec V2-D6)', () => {
  const frame = (source: number, controller: 0 | 1, origin?: Frame['origin']): Frame => ({
    abilityId: 'x', source, controller, path: [], chosen: [], modes: [], triggerEvent: null, ...(origin ? { origin } : {}),
  })
  let s = makeGame(); let summon: number, forward: number, backup: number
  ;[s, summon] = withHand(s, 1, 'V-S1')
  ;[s, forward] = withField(s, 1, 'forwards', 'V-F2')
  ;[s, backup] = withField(s, 1, 'backups', 'V-B1')

  it('a cast Summon (its frames run with the Summon card as source, cast.ts) → summon', () => {
    expect(damageProvenance(s, frame(summon, 1))).toEqual({ cause: 'summon', causeController: 1 })
  })
  it('an EX Burst Summon → summon, exBurst (it is still a Summon: Yuzuki does not reduce it)', () => {
    expect(damageProvenance(s, frame(summon, 1, 'exBurst'))).toEqual({ cause: 'summon', causeController: 1, exBurst: true })
  })
  it("a Character's EX Burst → ability, exBurst", () => {
    expect(damageProvenance(s, frame(backup, 1, 'exBurst'))).toEqual({ cause: 'ability', causeController: 1, exBurst: true })
  })
  it('an auto ability → ability', () => {
    expect(damageProvenance(s, frame(forward, 1))).toEqual({ cause: 'ability', causeController: 1 })
    expect(damageProvenance(s, frame(forward, 1, 'triggered'))).toEqual({ cause: 'ability', causeController: 1 })
  })
  it('an action ability → ability, controlled by whoever activated it', () => {
    expect(damageProvenance(s, frame(backup, 0, 'activated'))).toEqual({ cause: 'ability', causeController: 0 })
  })
})

describe('ability damage through the applier (rung V2-A1, plan R9 exact order)', () => {
  const DEALT: Ability = { id: 'T-SRC:dealt', trigger: { kind: 'dealtDamage', to: 'forward', whose: 'any' }, text: 'synthetic', effects: [] }
  const setup = (effects: readonly Effect[]): { s: GameState; src: CardId } => {
    const ability: Ability = { id: 'T-SRC:etb', trigger: { kind: 'enterField' }, text: 'synthetic', effects }
    let s = makeGame({ defs: [...VANILLA_POOL, makeDef({ code: 'T-SRC', power: 1000, hasAbilities: true, abilityClauses: 2, abilities: [ability, DEALT] })] })
    let src: CardId
    ;[s, src] = withField(s, 0, 'forwards', 'T-SRC')
    return { s, src }
  }
  const fire = (s: GameState, src: CardId): [GameState, Event[]] => drainResolution(enqueueTrigger(s, src, 0, defOf(s, src).abilities![0]!))
  const kinds = (events: readonly Event[]): string[] => events.flatMap((e) =>
    e.type === 'abilityDamage' ? [`damage:${e.target}`] : e.type === 'broken' ? [`broken:${e.card}`] : e.type === 'abilityTriggered' && e.abilityId === DEALT.id ? [`trigger:${e.abilityId}`] : [])

  it('forEach: one packet per card in field order; every packet lands before the §12.4.5 process and before any trigger', () => {
    let { s, src } = setup([{ kind: 'forEach', from: { zone: 'forwards', controller: 'opponent' }, do: [{ kind: 'damage', amount: 5000 }] }])
    let f1: CardId, f2: CardId, f3: CardId
    ;[s, f1] = withField(s, 1, 'forwards', 'V-F1')   // 3000: breaks
    ;[s, f2] = withField(s, 1, 'forwards', 'V-F8')   // 9000: survives
    ;[s, f3] = withField(s, 1, 'forwards', 'V-F2')   // 5000: breaks
    const [t, events] = fire(s, src)
    expect(kinds(events)).toEqual([
      `damage:${f1}`, `damage:${f2}`, `damage:${f3}`, `broken:${f1}`, `broken:${f3}`,
      'trigger:T-SRC:dealt', 'trigger:T-SRC:dealt', 'trigger:T-SRC:dealt',
    ])
    expect(findFieldCard(t, f2)?.card.damage).toBe(5000)
    expect(checkInvariants(t)).toEqual([])
  })

  it('a target that left before its damage: no packet lands, no event, no dealt-damage trigger', () => {
    // "Break it, then deal it 3000": by the damage the chosen Forward is in the Break Zone.
    let { s, src } = setup([{ kind: 'forEach', from: { zone: 'forwards', controller: 'opponent' }, do: [{ kind: 'breakCard' }, { kind: 'damage', amount: 3000 }] }])
    let f: CardId
    ;[s, f] = withField(s, 1, 'forwards', 'V-F8')
    const [t, events] = fire(s, src)
    expect(t.players[1].breakZone).toContain(f)
    expect(events.some((e) => e.type === 'abilityDamage')).toBe(false)
    expect(events.some((e) => e.type === 'abilityTriggered' && e.abilityId === 'T-SRC:dealt')).toBe(false)
  })

  it('several chosen targets: one packet each, in chosen order, each an abilityDamage from the one source', () => {
    let { s, src } = setup([{ kind: 'chooseTargets', min: 2, max: 2, from: { zone: 'forwards', controller: 'opponent' }, then: [{ kind: 'damage', amount: 2000 }] }])
    let f1: CardId, f2: CardId
    ;[s, f1] = withField(s, 1, 'forwards', 'V-F8')
    ;[s, f2] = withField(s, 1, 'forwards', 'V-F7')
    const [held] = fire(s, src)
    expect(held.pending?.kind).toBe('chooseTargets')
    const { events } = applyNow(held, { type: 'chooseTargets', player: 0, targets: [f2, f1] })
    expect(events.filter((e) => e.type === 'abilityDamage')).toEqual([
      { type: 'abilityDamage', source: src, target: f2, original: 2000, amount: 2000, trace: [] },
      { type: 'abilityDamage', source: src, target: f1, original: 2000, amount: 2000, trace: [] },
    ])
  })
})

describe('held First Strike occurrences are checked by the invariants (rung V2-A1, plan R9)', () => {
  const held = (heldDamage: readonly DamageOccurrence[]): string[] => {
    let s = makeGame(); let a: number, b: number
    ;[s, a] = withField(s, 0, 'forwards', 'V-F2')
    ;[s, b] = withField(s, 1, 'forwards', 'V-F3')
    return checkInvariants({ ...s, phase: 'attack', attack: { step: 'firstStrike', attackers: [a], blocker: b, firstStrikers: [a], heldDamage } })
      .filter((p) => p.startsWith('held occurrence'))
  }
  const good = { source: 1, sourceController: 0 as const, target: 2, victim: null, amount: 5000, targetController: 1 as const }

  it('a well-formed held occurrence passes', () => {
    expect(held([good])).toEqual([])
  })
  it('refuses a zero, fractional or negative amount, both or neither recipient, and a Forward hit without its side', () => {
    expect(held([{ ...good, amount: 0 }])).toEqual([expect.stringContaining('positive integer')])
    expect(held([{ ...good, amount: 2500.5 }])).toEqual([expect.stringContaining('positive integer')])
    expect(held([{ ...good, victim: 1 }])).toEqual([expect.stringContaining('exactly one')])
    expect(held([{ ...good, target: null }])).toEqual([expect.stringContaining('exactly one')])
    const { targetController: _drop, ...noSide } = good
    void _drop
    expect(held([noSide])).toEqual([expect.stringContaining('targetController')])
  })
})
