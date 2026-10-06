import { describe, expect, it } from 'vitest'
import type { Ability, DamageChange, DamageScope, Effect } from '../src/abilities.js'
import type { CardDef, PlayerId } from '../src/types.js'
import type { CardId, GameState, Pending } from '../src/state.js'
import type { Event } from '../src/events.js'
import { findFieldCard } from '../src/state.js'
import { applyDamagePacket, previewDamagePacket, replacementChoice } from '../src/damage.js'
import { apply } from '../src/apply.js'
import { actingPlayer, forcedDecision, isLegal, legalCommands } from '../src/legal.js'
import { drainResolution, enqueueTrigger } from '../src/resolve.js'
import { checkInvariants } from '../src/invariants.js'
import { viewFor } from '../src/view.js'
import { determinise } from '../src/determinise.js'
import { seedRng } from '../src/rng.js'
import { IllegalCommandError } from '../src/errors.js'
import { applyNow, attackInto, blockWith, endPhase, makeDef, makeGame, passBoth, VANILLA_POOL, withField } from './helpers.js'

/**
 * Rung V2-A2, Task 3 (plan A2-D4, R1, R3, R4; §11.12.5.7): when the order of a packet's replacement effects changes its
 * result, the controller of the damaged Forward chooses — before anything of that simultaneous damage lands.
 */

const replacement = (code: string, slug: string, affects: DamageScope, change: DamageChange): Ability => ({
  id: `${code}:${slug}`, trigger: { kind: 'static', effect: { kind: 'damageReplacement', id: slug, affects, change } }, text: 'synthetic', effects: [],
})
const withAbilities = (def: CardDef, ...abilities: Ability[]): CardDef => ({ ...def, hasAbilities: true, abilityClauses: abilities.length, abilities })
const etb = (code: string, effects: readonly Effect[]): Ability => ({ id: `${code}:etb`, trigger: { kind: 'enterField' }, text: 'synthetic', effects })

/** "If a Forward you control deals damage to a Forward, the damage increases by 2000 instead." */
const WUK = withAbilities(makeDef({ code: 'O-WUK', power: 8000 }), replacement('O-WUK', 'wuk', { target: { controller: 'any' }, bySource: { controller: 'self', filter: { type: 'forward' } } }, { add: 2000 }))
/** "If <this> is dealt damage, the damage becomes 0 instead" — a battle-reachable "becomes 0" for these fixtures. */
const NULL = withAbilities(makeDef({ code: 'O-NULL', power: 7000 }), replacement('O-NULL', 'null', { target: 'self' }, { becomes: 0 }))
const NULL_FS = withAbilities(makeDef({ code: 'O-NULLFS', power: 5000, keywords: ['firstStrike'] }), replacement('O-NULLFS', 'null', { target: 'self' }, { becomes: 0 }))
/** Yuzuki's Fire clause: "If a Fire Forward you control is dealt damage by your opponent's abilities, the damage becomes 0 instead." */
const YUZUKI = withAbilities(makeDef({ code: 'O-YUZ', type: 'backup', power: null }),
  replacement('O-YUZ', 'fire', { target: { controller: 'self', filter: { element: 'fire' } }, byCause: 'ability', byController: 'opponent' }, { becomes: 0 }))
const FIRE = makeDef({ code: 'O-FIRE', elements: ['fire'], power: 9000 })
/** Ifrit's shape on a Forward (so Wuk Lamat's "a Forward you control deals damage" reads it): choose 1, deal 5000. */
const BURNER = withAbilities(makeDef({ code: 'O-BURN', power: 3000 }),
  etb('O-BURN', [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'opponent' }, then: [{ kind: 'damage', amount: 5000 }] }]))
/** Palom's shape: choose 1, then an `if`, then the damage. */
const PALOM = withAbilities(makeDef({ code: 'O-PAL', power: 3000 }),
  etb('O-PAL', [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'opponent' }, then: [{ kind: 'if', when: { kind: 'controlsAtLeast', count: 1, controller: 'self' }, then: [{ kind: 'damage', amount: 5000 }] }] }]))
/** Zack's sweep: every Forward the opponent controls, 5000 each, and a Backup-counted amount's shape is irrelevant here. */
const SWEEP = withAbilities(makeDef({ code: 'O-SWEEP', power: 3000 }),
  etb('O-SWEEP', [{ kind: 'forEach', from: { zone: 'forwards', controller: 'opponent' }, do: [{ kind: 'dull' }, { kind: 'damage', amount: 5000 }] }]))

const POOL = [...VANILLA_POOL, WUK, NULL, NULL_FS, YUZUKI, FIRE, BURNER, PALOM, SWEEP]
const game = (): GameState => makeGame({ defs: POOL })
const dmg = (s: GameState, id: CardId): number | undefined => findFieldCard(s, id)?.card.damage
const ok = (s: GameState): void => expect(checkInvariants(s)).toEqual([])
type OrderPending = Extract<Pending, { kind: 'chooseReplacementOrder' }>
const orderPending = (s: GameState): OrderPending => {
  if (s.pending?.kind !== 'chooseReplacementOrder') throw new Error(`expected a replacement order, got ${s.pending?.kind ?? 'none'}`)
  return s.pending
}
/** The option whose outcome is `final`. */
const optionFor = (s: GameState, final: number): number => {
  const i = orderPending(s).outcomes.findIndex((o) => o.final === final)
  if (i < 0) throw new Error(`no option ends at ${final}`)
  return i
}
const answer = (s: GameState, final: number) => applyNow(s, { type: 'chooseReplacementOrder', player: orderPending(s).player, order: optionFor(s, final) })
const damageEvents = (events: readonly Event[]) => events.filter((e) => e.type === 'battleDamage' || e.type === 'abilityDamage' || e.type === 'damageReducedToZero')

describe('battle: the order is asked before the batch lands (plan A2-D4, R4)', () => {
  it('Wuk Lamat +2000 against "becomes 0": two outcomes, the blocker\'s controller is asked, each answer lands its amount', () => {
    for (const final of [0, 2000]) {
      let s = game(); let a: CardId, b: CardId
      ;[s] = withField(s, 0, 'forwards', 'O-WUK')
      ;[s, a] = withField(s, 0, 'forwards', 'V-F8')
      ;[s, b] = withField(s, 1, 'forwards', 'O-NULL')
      s = endPhase(s)
      const r = blockWith(attackInto(s, [a]).state, b)
      const p = orderPending(r.state)
      expect(p).toMatchObject({ player: 1, owner: 'battle', target: b, original: 9000 })
      expect(p.outcomes.map((o) => o.final).sort((x, y) => x - y)).toEqual([0, 2000])
      expect(damageEvents(r.events)).toEqual([])                  // nothing of the batch has landed
      expect(dmg(r.state, a)).toBe(0)
      expect(actingPlayer(r.state)).toBe(1)                        // the non-turn player owes it mid-battle
      expect(forcedDecision(r.state)).toBeNull()
      expect(legalCommands(r.state, 1).filter((c) => c.type === 'chooseReplacementOrder')).toHaveLength(2)
      ok(r.state)
      const t = answer(r.state, final)
      expect(dmg(t.state, b)).toBe(final)
      expect(dmg(t.state, a)).toBe(7000)                           // the blocker's hit landed in the same batch
      expect(t.state.attack).not.toHaveProperty('replacementOrders')
      ok(t.state)
    }
  })

  it('a blocked party is one packet: one prompt, and the answer lands the one total (Review Focus 3)', () => {
    let s = game(); let m1: CardId, m2: CardId, b: CardId
    ;[s] = withField(s, 0, 'forwards', 'O-WUK')
    ;[s, m1] = withField(s, 0, 'forwards', 'V-F1')
    ;[s, m2] = withField(s, 0, 'forwards', 'V-F2')
    ;[s, b] = withField(s, 1, 'forwards', 'O-NULL', { status: 'active' })
    s = endPhase(s)
    let r = blockWith(attackInto(s, [m1, m2]).state, b)
    // The blocker's split over the party is owed first (§10.1.4.2.1), then the order.
    expect(r.state.pending?.kind).toBe('assignPartyDamage')
    r = applyNow(r.state, { type: 'assignPartyDamage', player: 1, assignments: [{ target: m1, amount: 3000 }, { target: m2, amount: 4000 }] })
    expect(orderPending(r.state)).toMatchObject({ target: b, original: 8000 })
    expect(r.state.attack?.blockerAssignments).toEqual([{ target: m1, amount: 3000 }, { target: m2, amount: 4000 }])
    ok(r.state)
    const t = answer(r.state, 2000)
    expect(damageEvents(t.events)).toMatchObject([{ type: 'battleDamage', target: b, dealers: [m1, m2], original: 8000, amount: 2000 }, { target: m1, amount: 3000 }, { target: m2, amount: 4000 }])
    ok(t.state)
  })

  it('a split: every split packet that owes an order asks, the held split survives each prompt, and only then anything lands (plan R4)', () => {
    let s = game(); let m1: CardId, m2: CardId, b: CardId
    ;[s, m1] = withField(s, 0, 'forwards', 'O-NULL')
    ;[s, m2] = withField(s, 0, 'forwards', 'O-NULL')
    ;[s] = withField(s, 1, 'forwards', 'O-WUK')
    ;[s, b] = withField(s, 1, 'forwards', 'V-F7')
    s = endPhase(s)
    let r = blockWith(attackInto(s, [m1, m2]).state, b)
    r = applyNow(r.state, { type: 'assignPartyDamage', player: 1, assignments: [{ target: m1, amount: 4000 }, { target: m2, amount: 4000 }] })
    expect(orderPending(r.state)).toMatchObject({ player: 0, target: m1 })
    let t = answer(r.state, 2000)
    expect(orderPending(t.state)).toMatchObject({ player: 0, target: m2 })
    expect(t.state.attack?.replacementOrders).toHaveLength(1)
    expect(t.state.attack?.blockerAssignments).toHaveLength(2)
    expect(damageEvents(t.events)).toEqual([])
    ok(t.state)
    t = answer(t.state, 0)
    expect(damageEvents(t.events).map((e) => [e.type, e.target])).toEqual([['battleDamage', b], ['battleDamage', m1], ['damageReducedToZero', m2]])
    expect(dmg(t.state, m2)).toBe(0)
    ok(t.state)
  })

  it('First Strike: the first batch asks before it lands, its held occurrence carries the final amount, the second batch asks its own (Review Focus 4)', () => {
    let s = game(); let a: CardId, b: CardId
    ;[s] = withField(s, 0, 'forwards', 'O-WUK')
    ;[s, a] = withField(s, 0, 'forwards', 'O-NULLFS')
    ;[s] = withField(s, 1, 'forwards', 'O-WUK')
    ;[s, b] = withField(s, 1, 'forwards', 'O-NULL')
    s = endPhase(s)
    const r = blockWith(attackInto(s, [a]).state, b)
    expect(orderPending(r.state)).toMatchObject({ player: 1, target: b, original: 5000 })
    expect(r.state.attack?.firstStrikers).toEqual([a])
    ok(r.state)
    const first = answer(r.state, 2000)
    expect(first.state.attack).toMatchObject({ step: 'firstStrike', heldDamage: [{ source: a, target: b, amount: 2000 }] })
    expect(first.state.attack).not.toHaveProperty('replacementOrders')
    expect(dmg(first.state, a)).toBe(0)
    ok(first.state)
    const window = passBoth(first.state)
    expect(orderPending(window.state)).toMatchObject({ player: 0, target: a, original: 7000 })
    expect(window.state.attack?.heldDamage).toHaveLength(1)
    ok(window.state)
    const second = answer(window.state, 0)
    expect(damageEvents(second.events).map((e) => e.type)).toEqual(['damageReducedToZero'])
    expect(dmg(second.state, a)).toBe(0)
    expect(second.state.attack?.heldDamage).toBeUndefined()
    ok(second.state)
  })

  it('a wrong answer is refused: another player, an index out of range', () => {
    let s = game(); let a: CardId, b: CardId
    ;[s] = withField(s, 0, 'forwards', 'O-WUK')
    ;[s, a] = withField(s, 0, 'forwards', 'V-F2')
    ;[s, b] = withField(s, 1, 'forwards', 'O-NULL')
    s = endPhase(s)
    const r = blockWith(attackInto(s, [a]).state, b)
    expect(() => apply(r.state, { type: 'chooseReplacementOrder', player: 0, order: 0 })).toThrow(IllegalCommandError)
    expect(() => apply(r.state, { type: 'chooseReplacementOrder', player: 1, order: 2 })).toThrow(/not one of the 2 orders/)
    expect(isLegal(r.state, { type: 'chooseReplacementOrder', player: 1, order: 1 })).toBeNull()
    expect(isLegal(r.state, { type: 'chooseReplacementOrder', player: 1, order: 5 })).not.toBeNull()
  })
})

describe('ability damage: the frame suspends and lands nothing until every order is in (plan R1, R3)', () => {
  const fire = (s: GameState, src: CardId, controller: PlayerId = 0): GameState => {
    const ability = findAbility(s, src)
    return drainResolution(enqueueTrigger(s, src, controller, ability))[0]
  }
  const findAbility = (s: GameState, src: CardId): Ability => {
    const code = s.cards[src]!.code
    return s.defs[code]!.abilities!.find((x) => x.trigger.kind === 'enterField')!
  }

  it("Yuzuki's \"becomes 0\" against Wuk Lamat's +2000 on the opponent's ability: the damaged Forward's controller is asked (Review Focus 1)", () => {
    for (const final of [0, 2000]) {
      let s = game(); let src: CardId, f: CardId
      ;[s] = withField(s, 0, 'forwards', 'O-WUK')
      ;[s, src] = withField(s, 0, 'forwards', 'O-BURN')
      ;[s] = withField(s, 1, 'backups', 'O-YUZ')
      ;[s, f] = withField(s, 1, 'forwards', 'O-FIRE')
      s = fire(s, src)
      s = applyNow(s, { type: 'chooseTargets', player: 0, targets: [f] }).state
      const p = orderPending(s)
      expect(p).toMatchObject({ player: 1, owner: 'frame', target: f, original: 5000 })
      expect(s.resolution.active?.abilityId).toBe('O-BURN:etb')
      ok(s)
      const t = answer(s, final)
      expect(dmg(t.state, f)).toBe(final)
      expect(t.state.pending).toBeNull()
      expect(t.state.resolution.active).toBeNull()
      ok(t.state)
    }
  })

  it('the wording of each option: the replacements in order, by the card they belong to', () => {
    let s = game(); let src: CardId, f: CardId, wuk: CardId, yz: CardId
    ;[s, wuk] = withField(s, 0, 'forwards', 'O-WUK')
    ;[s, src] = withField(s, 0, 'forwards', 'O-BURN')
    ;[s, yz] = withField(s, 1, 'backups', 'O-YUZ')
    ;[s, f] = withField(s, 1, 'forwards', 'O-FIRE')
    s = applyNow(fire(s, src), { type: 'chooseTargets', player: 0, targets: [f] }).state
    const p = orderPending(s)
    expect(p.replacements).toEqual([{ id: `${wuk}:wuk`, by: wuk, change: { add: 2000 } }, { id: `${yz}:fire`, by: yz, change: { becomes: 0 } }])
    expect(p.options).toEqual([[`${wuk}:wuk`, `${yz}:fire`], [`${yz}:fire`, `${wuk}:wuk`]])
    expect(p.outcomes).toEqual([{ final: 0, consumes: [] }, { final: 2000, consumes: [] }])
  })

  it("Palom's shape resumes through the chooser and the `if`, and records the chosen target once", () => {
    let s = game(); let src: CardId, f: CardId
    ;[s] = withField(s, 0, 'forwards', 'O-WUK')
    ;[s, src] = withField(s, 0, 'forwards', 'O-PAL')
    ;[s] = withField(s, 1, 'backups', 'O-YUZ')
    ;[s, f] = withField(s, 1, 'forwards', 'O-FIRE')
    s = applyNow(fire(s, src), { type: 'chooseTargets', player: 0, targets: [f] }).state
    expect(s.resolution.active?.declared?.filter((d) => d.path.length === 1)).toHaveLength(1)
    const t = answer(s, 2000)
    expect(dmg(t.state, f)).toBe(2000)
    ok(t.state)
  })

  it("Zack's sweep: every order is asked before any iteration lands — the dull before it included — and then all of it lands", () => {
    let s = game(); let src: CardId, f1: CardId, f2: CardId, plain: CardId
    ;[s] = withField(s, 0, 'forwards', 'O-WUK')
    ;[s, src] = withField(s, 0, 'forwards', 'O-SWEEP')
    ;[s] = withField(s, 1, 'backups', 'O-YUZ')
    ;[s, f1] = withField(s, 1, 'forwards', 'O-FIRE')
    ;[s, plain] = withField(s, 1, 'forwards', 'V-F8')
    ;[s, f2] = withField(s, 1, 'forwards', 'O-FIRE')
    const [asked, events] = drainResolution(enqueueTrigger(s, src, 0, findAbility(s, src)))
    expect(orderPending(asked)).toMatchObject({ player: 1, owner: 'frame', target: f1 })
    expect(events.filter((e) => e.type === 'dulled' || e.type === 'abilityDamage')).toEqual([])
    expect(findFieldCard(asked, f1)?.card.status).toBe('active')
    expect(asked.resolution.active?.path).toEqual([0])                       // suspended at the forEach itself
    ok(asked)
    const second = answer(asked, 0)
    expect(orderPending(second.state)).toMatchObject({ target: f2 })
    expect(damageEvents(second.events)).toEqual([])
    expect(second.state.resolution.active?.replacementOrders).toHaveLength(1)
    ok(second.state)
    const done = answer(second.state, 2000)
    expect(damageEvents(done.events).map((e) => [e.type, e.target, 'amount' in e ? e.amount : 0])).toEqual([
      ['damageReducedToZero', f1, 0], ['abilityDamage', plain, 7000], ['abilityDamage', f2, 2000],
    ])
    expect([f1, plain, f2].map((id) => findFieldCard(done.state, id)?.card.status)).toEqual(['dull', 'dull', 'dull'])
    expect(done.state.resolution.active).toBeNull()
    ok(done.state)
  })

  it('an ability resolving in the blocked window owns its prompt as a frame, not the battle (plan R3)', () => {
    let s = game(); let a: CardId, b: CardId, src: CardId, f: CardId
    ;[s] = withField(s, 0, 'forwards', 'O-WUK')
    ;[s, src] = withField(s, 0, 'forwards', 'O-BURN')
    ;[s, a] = withField(s, 0, 'forwards', 'V-F2')
    ;[s, b] = withField(s, 1, 'forwards', 'V-F3')
    ;[s] = withField(s, 1, 'backups', 'O-YUZ')
    ;[s, f] = withField(s, 1, 'forwards', 'O-FIRE')
    s = endPhase(s)
    s = apply(attackInto(s, [a]).state, { type: 'declareBlock', player: 1, blocker: b }).state
    expect(s.attack?.step).toBe('blocked')
    s = applyNow(fire(s, src), { type: 'chooseTargets', player: 0, targets: [f] }).state
    expect(orderPending(s)).toMatchObject({ owner: 'frame', player: 1 })
    expect(s.attack?.step).toBe('blocked')
    ok(s)
    const t = answer(s, 2000)
    expect(dmg(t.state, f)).toBe(2000)
    expect(t.state.attack?.step).toBe('blocked')
    ok(t.state)
  })

  it("the pending survives the other seat's view and a determinisation unchanged — it is all public", () => {
    let s = game(); let src: CardId, f: CardId
    ;[s] = withField(s, 0, 'forwards', 'O-WUK')
    ;[s, src] = withField(s, 0, 'forwards', 'O-BURN')
    ;[s] = withField(s, 1, 'backups', 'O-YUZ')
    ;[s, f] = withField(s, 1, 'forwards', 'O-FIRE')
    s = applyNow(fire(s, src), { type: 'chooseTargets', player: 0, targets: [f] }).state
    const decks = ([0, 1] as const).map((p) => {
      const q = s.players[p]
      return [...q.deck, ...q.hand, ...q.forwards.map((c) => c.id), ...q.backups.map((c) => c.id), ...q.damageZone, ...q.breakZone, ...q.removedFromGame].map((id) => s.cards[id]!.code)
    }) as [string[], string[]]
    for (const seat of [0, 1] as const) {
      const v = viewFor(s, seat)
      expect(v.pending).toEqual(s.pending)
      const [d] = determinise({ view: v, decks, rng: seedRng(3) })
      expect(d.pending).toEqual(s.pending)
      expect(legalCommands(d, 1).filter((c) => c.type === 'chooseReplacementOrder')).toHaveLength(2)
    }
  })
})

describe('when there is a choice at all (plan A2-D4, R2)', () => {
  const shield = (id: string, source: CardId, reduce = 2000) => ({ id, reduce, source })
  it('no prompt when every order gives the same result: 1000 − 2000 + 2000 either way (spec V2-D3)', () => {
    let s = game(); let a: CardId, f: CardId
    ;[s] = withField(s, 0, 'forwards', 'O-WUK')
    ;[s, a] = withField(s, 0, 'forwards', 'V-F6')
    ;[s, f] = withField(s, 1, 'forwards', 'V-F8', { shields: [shield('p:1:0', 5)] })
    const p = { target: f, amount: 1000, cause: 'battle' as const, causeController: 0 as const, dealers: [{ source: a, sourceController: 0 as const }] }
    expect(replacementChoice(s, p)).toBeNull()
    expect(applyDamagePacket(s, p).final).toBe(1000)
  })
  it('two equal shields and a 1000 hit: either is used up, the same outcome — no prompt, the canonical order spends the first', () => {
    let s = game(); let a: CardId, f: CardId
    ;[s, a] = withField(s, 0, 'forwards', 'V-F6')
    ;[s, f] = withField(s, 1, 'forwards', 'V-F8', { shields: [shield('p:1:0', 5), shield('q:1:0', 6)] })
    const p = { target: f, amount: 1000, cause: 'battle' as const, causeController: 0 as const, dealers: [{ source: a, sourceController: 0 as const }] }
    expect(replacementChoice(s, p)).toBeNull()
    const r = applyDamagePacket(s, p)
    expect(r.final).toBe(0)
    expect(findFieldCard(r.state, f)?.card.shields).toEqual([shield('q:1:0', 6)])
    expect(previewDamagePacket(s, p)).toEqual({ applied: true, final: 0 })
  })
  it('shields of 1000 and 2000 and a 1000 hit: which amount survives differs, so the controller is asked', () => {
    let s = game(); let a: CardId, f: CardId
    ;[s, a] = withField(s, 0, 'forwards', 'V-F6')
    ;[s, f] = withField(s, 1, 'forwards', 'V-F8', { shields: [shield('p:1:0', 5, 1000), shield('q:1:0', 6)] })
    const p = { target: f, amount: 1000, cause: 'battle' as const, causeController: 0 as const, dealers: [{ source: a, sourceController: 0 as const }] }
    const choice = replacementChoice(s, p)
    expect(choice?.outcomes).toEqual([{ final: 0, consumes: ['p:1:0'] }, { final: 0, consumes: ['q:1:0'] }])
    expect(() => applyDamagePacket(s, p)).toThrow(/owes an order/)
    const r = applyDamagePacket(s, p, choice!.options[1])
    expect(findFieldCard(r.state, f)?.card.shields).toEqual([shield('p:1:0', 5, 1000)])
  })
  it('the same total used up is not the same outcome: 2000 against shields of 1000, 1000 and 2000 leaves {2000}, {1000} or {1000, 1000}', () => {
    let s = game(); let a: CardId, f: CardId
    ;[s, a] = withField(s, 0, 'forwards', 'V-F6')
    ;[s, f] = withField(s, 1, 'forwards', 'V-F8', { shields: [shield('p:1:0', 5, 1000), shield('q:1:0', 6, 1000), shield('r:1:0', 7)] })
    const p = { target: f, amount: 2000, cause: 'battle' as const, causeController: 0 as const, dealers: [{ source: a, sourceController: 0 as const }] }
    const choice = replacementChoice(s, p)
    expect(choice?.outcomes).toEqual([{ final: 0, consumes: ['p:1:0', 'q:1:0'] }, { final: 0, consumes: ['p:1:0', 'r:1:0'] }, { final: 0, consumes: ['r:1:0'] }])
  })
  it('an order that is not an order of the replacements is refused', () => {
    let s = game(); let a: CardId, b: CardId
    ;[s] = withField(s, 0, 'forwards', 'O-WUK')
    ;[s, a] = withField(s, 0, 'forwards', 'V-F2')
    ;[s, b] = withField(s, 1, 'forwards', 'O-NULL')
    const p = { target: b, amount: 5000, cause: 'battle' as const, causeController: 0 as const, dealers: [{ source: a, sourceController: 0 as const }] }
    expect(() => applyDamagePacket(s, p, ['nope'])).toThrow(/is not an order/)
  })
})
