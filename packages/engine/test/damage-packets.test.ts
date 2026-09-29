import { describe, expect, it } from 'vitest'
import type { Frame } from '../src/abilities.js'
import type { DamagePacket } from '../src/damage.js'
import { applyDamagePacket, damageProvenance, previewDamagePacket } from '../src/damage.js'
import { findFieldCard } from '../src/state.js'
import { makeGame, withField, withHand } from './helpers.js'

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
