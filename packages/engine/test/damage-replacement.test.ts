import { describe, expect, it } from 'vitest'
import type { Ability, DamageChange, DamageScope, Frame, StaticCondition, StaticEffect } from '../src/abilities.js'
import type { CardDef } from '../src/types.js'
import type { CardId, GameState } from '../src/state.js'
import type { Event } from '../src/events.js'
import type { DamagePacket, Replacement } from '../src/damage.js'
import { applyDamagePacket, applyInOrder, damageProvenance, previewDamagePacket, replacementsFor } from '../src/damage.js'
import { findFieldCard } from '../src/state.js'
import { createGame } from '../src/setup.js'
import { checkInvariants } from '../src/invariants.js'
import { attackInto, blockWith, DEFAULT_DECK, endPhase, makeDef, makeGame, VANILLA_POOL, withField, withHand } from './helpers.js'

/**
 * Rung V2-A2, Task 1 (plan A2-D1, A2-D3, A2-D5; spec V2-D3, V2-D4, V2-D6): damage-modifying replacement statics on
 * SYNTHETIC cards — the pool is unchanged until rung V2-B. Each static below mirrors one printed clause's shape.
 */

const replacement = (code: string, affects: DamageScope, change: DamageChange, when?: StaticCondition, slug = 'replace'): Ability => ({
  id: `${code}:${slug}`, trigger: { kind: 'static', effect: { kind: 'damageReplacement', id: slug, affects, change, ...(when ? { when } : {}) } },
  text: 'synthetic', effects: [],
})
const withStatic = (def: CardDef, ...abilities: Ability[]): CardDef => ({ ...def, hasAbilities: true, abilityClauses: abilities.length, abilities })

/** Charlotte's shape: "If <this> is dealt damage, reduce the damage by 1000 instead." */
const CHARLOTTE = withStatic(makeDef({ code: 'R-CHAR', power: 7000 }), replacement('R-CHAR', { target: 'self' }, { reduce: 1000 }))
/** Yuzuki's two clauses on one Backup: Water −2000; Fire becomes 0 against the opponent's abilities. */
const YUZUKI = withStatic(makeDef({ code: 'R-YUZ', type: 'backup', power: null }),
  replacement('R-YUZ', { target: { controller: 'self', filter: { element: 'fire' } }, byCause: 'ability', byController: 'opponent' }, { becomes: 0 }, undefined, 'fire'),
  replacement('R-YUZ', { target: { controller: 'self', filter: { element: 'water' } } }, { reduce: 2000 }, undefined, 'water'))
/** Wuk Lamat's granted clause: "If a Forward you control deals damage to a Forward, the damage increases by 2000 instead." */
const WUK = withStatic(makeDef({ code: 'R-WUK', power: 8000 }),
  replacement('R-WUK', { target: { controller: 'any' }, bySource: { controller: 'self', filter: { type: 'forward' } } }, { add: 2000 }))
/** Wuk Lamat's condition, on a copy: "If you control 7 or more Characters". */
const WUK7 = withStatic(makeDef({ code: 'R-WUK7', power: 8000 }),
  replacement('R-WUK7', { target: { controller: 'any' }, bySource: { controller: 'self', filter: { type: 'forward' } } }, { add: 2000 }, { kind: 'controlsAtLeast', count: 7, controller: 'self' }))
const WATER = makeDef({ code: 'R-WATER', elements: ['water'], power: 7000 })
const FIRE = makeDef({ code: 'R-FIRE', elements: ['fire'], power: 7000 })
const WEAK = makeDef({ code: 'R-WEAK', power: 1000 })
/** Luso's shape: "When <this> deals damage to a Forward, break it." */
const BREAKER = withStatic(makeDef({ code: 'R-BRK', power: 1000 }),
  { id: 'R-BRK:dealt', trigger: { kind: 'dealtDamage', to: 'forward', whose: 'any' }, text: 'synthetic', effects: [{ kind: 'onSubject', do: [{ kind: 'breakCard' }] }] })

const POOL = [...VANILLA_POOL, CHARLOTTE, YUZUKI, WUK, WUK7, WATER, FIRE, WEAK, BREAKER]
const game = (): GameState => makeGame({ defs: POOL })
const dmg = (s: GameState, id: CardId): number | undefined => findFieldCard(s, id)?.card.damage

const battle = (target: CardId, dealers: [CardId, 0 | 1][], amount: number): DamagePacket => ({
  target, amount, cause: 'battle', causeController: dealers[0]![1], dealers: dealers.map(([source, sourceController]) => ({ source, sourceController })),
})
const frame = (source: CardId, controller: 0 | 1, origin?: Frame['origin']): Frame => ({
  abilityId: 'x', source, controller, path: [], chosen: [], modes: [], triggerEvent: null, ...(origin ? { origin } : {}),
})
/** A packet from `source`'s frame, with the provenance the executor gives it (spec V2-D6). */
const fromFrame = (s: GameState, target: CardId, source: CardId, controller: 0 | 1, amount: number, origin?: Frame['origin']): DamagePacket => ({
  target, amount, dealers: [{ source, sourceController: controller }], ...damageProvenance(s, frame(source, controller, origin)),
})

describe('§4.3 arithmetic (plan A2-D3, spec V2-D3)', () => {
  const r = (by: number, change: DamageChange): Replacement => ({ id: `${by}`, by, change })
  it('a running amount may go negative between steps and keeps its sign: 1000 − 2000 + 2000 = 1000, either order', () => {
    expect(applyInOrder(1000, [r(1, { reduce: 2000 }), r(2, { add: 2000 })])).toEqual({ final: 1000, trace: [{ by: 1, before: 1000, after: -1000 }, { by: 2, before: -1000, after: 1000 }] })
    expect(applyInOrder(1000, [r(2, { add: 2000 }), r(1, { reduce: 2000 })]).final).toBe(1000)
  })
  it('a final amount below 0 is 0', () => {
    expect(applyInOrder(1000, [r(1, { reduce: 3000 })]).final).toBe(0)
  })
  it('"becomes 0" sets the running amount; a later increase still applies to that 0 (plan Review Focus 1)', () => {
    expect(applyInOrder(7000, [r(1, { add: 2000 }), r(2, { becomes: 0 })]).final).toBe(0)
    expect(applyInOrder(7000, [r(2, { becomes: 0 }), r(1, { add: 2000 })]).final).toBe(2000)
  })
})

describe('damage replacement statics (rung V2-A2, plan A2-D1)', () => {
  it("self reduce (Charlotte): 5000 → 4000, traced; another Forward's damage is untouched", () => {
    let s = game(); let a: CardId, ch: CardId, other: CardId
    ;[s, a] = withField(s, 0, 'forwards', 'V-F2')
    ;[s, ch] = withField(s, 1, 'forwards', 'R-CHAR')
    ;[s, other] = withField(s, 1, 'forwards', 'V-F3')
    const r = applyDamagePacket(s, battle(ch, [[a, 0]], 5000))
    expect(r.final).toBe(4000)
    expect(dmg(r.state, ch)).toBe(4000)
    expect(r.events).toEqual([{ type: 'battleDamage', target: ch, dealers: [a], original: 5000, amount: 4000, trace: [{ by: ch, before: 5000, after: 4000 }] }])
    expect(r.occurrences.map((o) => o.amount)).toEqual([4000])
    expect(previewDamagePacket(s, battle(ch, [[a, 0]], 5000))).toEqual({ applied: true, final: 4000 })
    expect(applyDamagePacket(s, battle(other, [[a, 0]], 5000)).final).toBe(5000)
  })

  it('element-scoped reduce (Yuzuki, Water): your Water Forward only — not your Fire one, not the opponent\'s Water one', () => {
    let s = game(); let yz: CardId, mine: CardId, fire: CardId, theirs: CardId, a: CardId
    ;[s, yz] = withField(s, 1, 'backups', 'R-YUZ')
    ;[s, mine] = withField(s, 1, 'forwards', 'R-WATER')
    ;[s, fire] = withField(s, 1, 'forwards', 'R-FIRE')
    ;[s, theirs] = withField(s, 0, 'forwards', 'R-WATER')
    ;[s, a] = withField(s, 0, 'forwards', 'V-F2')
    expect(applyDamagePacket(s, battle(mine, [[a, 0]], 5000)).events[0]).toMatchObject({ amount: 3000, trace: [{ by: yz, before: 5000, after: 3000 }] })
    expect(applyDamagePacket(s, battle(fire, [[a, 0]], 5000)).final).toBe(5000)
    expect(applyDamagePacket(s, battle(theirs, [[mine, 1]], 5000)).final).toBe(5000)
  })

  it("becomes 0 by the opponent's abilities (Yuzuki, Fire, spec V2-D6): an action/auto ability and a Character's EX Burst — never a Summon, an EX Burst Summon, your own ability or battle", () => {
    let s = game(); let fire: CardId, oppFwd: CardId, oppBackup: CardId, summon: CardId, own: CardId
    ;[s] = withField(s, 1, 'backups', 'R-YUZ')
    ;[s, fire] = withField(s, 1, 'forwards', 'R-FIRE')
    ;[s, own] = withField(s, 1, 'forwards', 'V-F2')
    ;[s, oppFwd] = withField(s, 0, 'forwards', 'V-F2')
    ;[s, oppBackup] = withField(s, 0, 'backups', 'V-B1')
    ;[s, summon] = withHand(s, 0, 'V-S1')
    const final = (p: DamagePacket): number => applyDamagePacket(s, p).final
    expect(final(fromFrame(s, fire, oppFwd, 0, 5000))).toBe(0)                       // an auto ability
    expect(final(fromFrame(s, fire, oppBackup, 0, 5000, 'activated'))).toBe(0)       // an action ability
    expect(final(fromFrame(s, fire, oppBackup, 0, 5000, 'exBurst'))).toBe(0)         // a Character's EX Burst
    expect(final(fromFrame(s, fire, summon, 0, 5000))).toBe(5000)                    // a Summon
    expect(final(fromFrame(s, fire, summon, 0, 5000, 'exBurst'))).toBe(5000)         // an EX Burst Summon is still a Summon
    expect(final(fromFrame(s, fire, own, 1, 5000))).toBe(5000)                       // your own ability
    expect(final(battle(fire, [[oppFwd, 0]], 5000))).toBe(5000)                      // battle
  })

  it('Wuk Lamat: +2000 on battle and ability damage dealt by a Forward you control, to either side; never a Backup\'s or a Summon\'s, never the opponent\'s Forward', () => {
    let s = game(); let wuk: CardId, mine: CardId, backup: CardId, summon: CardId, opp: CardId, oppFwd: CardId
    ;[s, wuk] = withField(s, 0, 'forwards', 'R-WUK')
    ;[s, mine] = withField(s, 0, 'forwards', 'V-F2')
    ;[s, backup] = withField(s, 0, 'backups', 'V-B1')
    ;[s, summon] = withHand(s, 0, 'V-S1')
    ;[s, opp] = withField(s, 1, 'forwards', 'V-F3')
    ;[s, oppFwd] = withField(s, 1, 'forwards', 'V-F7')
    const final = (p: DamagePacket): number => applyDamagePacket(s, p).final
    expect(final(battle(opp, [[mine, 0]], 5000))).toBe(7000)
    expect(final(battle(opp, [[wuk, 0]], 8000))).toBe(10000)
    expect(final(fromFrame(s, opp, mine, 0, 3000))).toBe(5000)
    expect(final(fromFrame(s, mine, wuk, 0, 3000))).toBe(5000)   // plan R8: your Forward's ability to your OWN Forward
    expect(final(fromFrame(s, opp, backup, 0, 3000))).toBe(3000)
    expect(final(fromFrame(s, opp, summon, 0, 3000))).toBe(3000)
    expect(final(battle(mine, [[oppFwd, 1]], 8000))).toBe(8000)
    expect(applyDamagePacket(s, battle(opp, [[mine, 0]], 5000)).events[0]).toMatchObject({ original: 5000, amount: 7000, trace: [{ by: wuk, before: 5000, after: 7000 }] })
  })

  it('§11.12.5.5, plan R8: a blocked party is ONE packet, so Wuk Lamat adds 2000 once — not once per member', () => {
    let s = game(); let m1: CardId, m2: CardId, b: CardId
    ;[s] = withField(s, 0, 'forwards', 'R-WUK')
    ;[s, m1] = withField(s, 0, 'forwards', 'V-F1')
    ;[s, m2] = withField(s, 0, 'forwards', 'V-F2')
    ;[s, b] = withField(s, 1, 'forwards', 'V-F8')
    const r = applyDamagePacket(s, battle(b, [[m1, 0], [m2, 0]], 8000))
    expect(r.final).toBe(10000)
    expect(r.trace).toHaveLength(1)
  })

  it("a static's condition is read per packet (Wuk Lamat's 7 Characters)", () => {
    let s = game(); let w: CardId, opp: CardId
    ;[s, w] = withField(s, 0, 'forwards', 'R-WUK7')
    ;[s, opp] = withField(s, 1, 'forwards', 'V-F8')
    expect(applyDamagePacket(s, battle(opp, [[w, 0]], 8000)).final).toBe(8000)
    for (let i = 0; i < 6; i++) [s] = withField(s, 0, 'backups', 'V-B1')
    expect(applyDamagePacket(s, battle(opp, [[w, 0]], 8000)).final).toBe(10000)
  })

  it('a static off the field does nothing (§11.12.5.3): Charlotte in hand reduces nothing', () => {
    let s = game(); let a: CardId, f: CardId
    ;[s] = withHand(s, 1, 'R-CHAR')
    ;[s, a] = withField(s, 0, 'forwards', 'V-F2')
    ;[s, f] = withField(s, 1, 'forwards', 'R-WATER')
    expect(replacementsFor(s, battle(f, [[a, 0]], 5000))).toEqual([])
  })

  it('collects in the canonical order: by the card carrying it, then by id', () => {
    let s = game(); let yz: CardId, wuk: CardId, water: CardId, a: CardId
    ;[s, wuk] = withField(s, 0, 'forwards', 'R-WUK')
    ;[s, yz] = withField(s, 1, 'backups', 'R-YUZ')
    ;[s, water] = withField(s, 1, 'forwards', 'R-WATER')
    ;[s, a] = withField(s, 0, 'forwards', 'V-F2')
    expect(replacementsFor(s, battle(water, [[a, 0]], 5000))).toEqual([
      { id: `${wuk}:replace`, by: wuk, change: { add: 2000 } },
      { id: `${yz}:water`, by: yz, change: { reduce: 2000 } },
    ].sort((x, y) => x.by - y.by))
  })
})

describe('0 damage is not damage (plan A2-D5, spec V2-D4, ruling 2021-08-19)', () => {
  it('reduced to 0: nothing marked, no battleDamage and no occurrence; one damageReducedToZero naming the dealers', () => {
    let s = game(); let a: CardId, ch: CardId
    ;[s, a] = withField(s, 0, 'forwards', 'R-WEAK')
    ;[s, ch] = withField(s, 1, 'forwards', 'R-CHAR')
    const r = applyDamagePacket(s, battle(ch, [[a, 0]], 1000))
    expect(r).toMatchObject({ applied: true, final: 0, occurrences: [] })
    expect(dmg(r.state, ch)).toBe(0)
    expect(r.events).toEqual([{ type: 'damageReducedToZero', target: ch, dealers: [a], original: 1000, trace: [{ by: ch, before: 1000, after: 0 }] }])
  })

  it("in battle, Luso's shape — \"when this deals damage to a Forward, break it\" — does not fire on 0, and the blocker survives", () => {
    let s = game(); let brk: CardId, ch: CardId
    ;[s, brk] = withField(s, 0, 'forwards', 'R-BRK')
    ;[s, ch] = withField(s, 1, 'forwards', 'R-CHAR')
    s = endPhase(s)
    const r = blockWith(attackInto(s, [brk]).state, ch)
    const types = r.events.map((e: Event) => e.type)
    expect(types).toContain('damageReducedToZero')
    expect(r.events.filter((e) => e.type === 'battleDamage').map((e) => (e as Extract<Event, { type: 'battleDamage' }>).target)).toEqual([brk])   // only Charlotte's hit on the attacker
    expect(r.events.some((e) => e.type === 'abilityTriggered' && e.abilityId === 'R-BRK:dealt')).toBe(false)
    expect(findFieldCard(r.state, ch)).not.toBeNull()
    expect(checkInvariants(r.state)).toEqual([])
  })

  it('a packet of 0 to begin with emits nothing at all', () => {
    let s = game(); let a: CardId, f: CardId
    ;[s, a] = withField(s, 0, 'forwards', 'V-F2')
    ;[s, f] = withField(s, 1, 'forwards', 'V-F3')
    expect(applyDamagePacket(s, battle(f, [[a, 0]], 0))).toMatchObject({ applied: true, final: 0, events: [], occurrences: [] })
  })
})

describe('game creation validates a damage replacement (plan A2-D1)', () => {
  // Malformed data arrives through JSON (card data, a saved session), so the fixture is built through JSON too.
  const bad = (affects: unknown, change: unknown): CardDef => {
    const effect: StaticEffect = JSON.parse(JSON.stringify({ kind: 'damageReplacement', id: 'r', affects, change }))
    return withStatic(makeDef({ code: 'R-BAD' }), { id: 'R-BAD:r', trigger: { kind: 'static', effect }, text: 'x', effects: [] })
  }
  const create = (def: CardDef) => () => createGame({ seed: 1, decks: [DEFAULT_DECK, DEFAULT_DECK], defs: [...VANILLA_POOL, def] })
  it('accepts the shapes above', () => {
    expect(() => createGame({ seed: 1, decks: [DEFAULT_DECK, DEFAULT_DECK], defs: POOL })).not.toThrow()
  })
  it('refuses two damage replacements with one id on one card: the id names it in an order prompt', () => {
    const r = replacement('R-DUP', { target: 'self' }, { reduce: 1000 })
    expect(create(withStatic(makeDef({ code: 'R-DUP' }), r, { ...r, id: 'R-DUP:other' }))).toThrow(/invalid continuous statics/)
  })
  it.each([
    ['a non-integral amount', { target: 'self' }, { reduce: 1500.5 }],
    ['a zero amount', { target: 'self' }, { add: 0 }],
    ['an unknown change', { target: 'self' }, { becomes: 1000 }],
    ['two changes at once', { target: 'self' }, { add: 1000, reduce: 1000 }],
    ['an instance axis on the damaged Forward', { target: { controller: 'self', filter: { minPower: 5000 } } }, { reduce: 1000 }],
    ['an unknown cause', { target: 'self', byCause: 'summon' }, { reduce: 1000 }],
    ['an unknown dealer controller', { target: 'self', bySource: { controller: 'opponent', filter: {} } }, { reduce: 1000 }],
  ])('refuses %s', (_, affects, change) => {
    expect(create(bad(affects, change))).toThrow(/invalid continuous statics/)
  })
})
