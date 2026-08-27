import { describe, expect, it } from 'vitest'
import { apply } from '../src/apply.js'
import { applyAssignPartyDamage, applyDeclareAttack, applyDeclareBlock, attackCheck, legalAttackSets, legalBlockers, legalPartyDamageAssignments } from '../src/attack.js'
import { IllegalCommandError } from '../src/errors.js'
import { makeDef, makeGame, VANILLA_POOL, withField } from './helpers.js'

/**
 * Turn 1, player 0 in the attack declaration step.
 *
 * Goes through `apply` rather than `applyPass`: since C5 the Attack Phase is entered in two steps —
 * preparation, then a continuation into declaration once any beginning-of-phase clause has drained — and it
 * is `settle` inside `apply` that runs the continuation. `applyPass` alone now stops in preparation, which is
 * correct and is what real play never sees.
 */
function inAttack() {
  return apply(makeGame(), { type: 'pass', player: 0 }).state
}
const IDLE = { step: 'declaration', attackers: [], blocker: null }

describe('§10.1.2 attack declaration', () => {
  it('a forward controlled since the start of the turn may attack; one that entered this turn may not unless it has Haste', () => {
    let s = inAttack(); let old: number, fresh: number, hasty: number
    ;[s, old] = withField(s, 0, 'forwards', 'V-F2', { enteredTurn: 0 })
    ;[s, fresh] = withField(s, 0, 'forwards', 'V-F2', { enteredTurn: 1 })
    ;[s, hasty] = withField(s, 0, 'forwards', 'V-F2', { enteredTurn: 1, granted: ['haste'] })
    expect(attackCheck(s, 0, [old])).toBeNull()
    expect(attackCheck(s, 0, [fresh])).toMatch(/haste|beginning of the turn/i)
    expect(attackCheck(s, 0, [hasty])).toBeNull()
    expect(legalAttackSets(s, 0)).toEqual(expect.arrayContaining([[old], [hasty], [old, hasty]]))
    expect(legalAttackSets(s, 0)).toHaveLength(3)
  })
  it('dull forwards and forwards that already attacked cannot attack; the non-turn player cannot attack', () => {
    let s = inAttack(); let d: number, a: number
    ;[s, d] = withField(s, 0, 'forwards', 'V-F2', { status: 'dull' })
    ;[s, a] = withField(s, 0, 'forwards', 'V-F2', { attackedThisTurn: true })
    expect(attackCheck(s, 0, [d])).toMatch(/active/i)
    expect(attackCheck(s, 0, [a])).toMatch(/already attacked/i)
    expect(attackCheck(s, 1, [d])).toMatch(/turn player/i)
  })
  it('§10.1.2.1: a party must share an element; order of attackers is irrelevant', () => {
    let s = inAttack(); let e: number, l: number, el: number
    ;[s, e] = withField(s, 0, 'forwards', 'V-F2')    // earth
    ;[s, l] = withField(s, 0, 'forwards', 'V-F3')    // lightning
    ;[s, el] = withField(s, 0, 'forwards', 'V-F4')   // earth/lightning
    expect(attackCheck(s, 0, [e, l])).toMatch(/same element/i)
    expect(attackCheck(s, 0, [e, el])).toBeNull()
    expect(attackCheck(s, 0, [el, e])).toBeNull()
    expect(attackCheck(s, 0, [l, el])).toBeNull()
    expect(attackCheck(s, 0, [e, l, el])).toMatch(/same element/i)
  })
  it('§10.1.2.2 + §15.2.1: attackers dull unless Brave; all are marked as having attacked; the defender owes a block decision', () => {
    let s = inAttack(); let a: number, b: number
    ;[s, a] = withField(s, 0, 'forwards', 'V-F2')
    ;[s, b] = withField(s, 0, 'forwards', 'V-F2', { granted: ['brave'] })
    const [t, events] = applyDeclareAttack(s, 0, [a, b])
    const A = t.players[0].forwards.find((c) => c.id === a)!, B = t.players[0].forwards.find((c) => c.id === b)!
    expect(A.status).toBe('dull'); expect(B.status).toBe('active')
    expect(A.attackedThisTurn && B.attackedThisTurn).toBe(true)
    expect(t.attack).toEqual({ step: 'block', attackers: [a, b], blocker: null })
    expect(t.pending).toEqual({ kind: 'declareBlock', player: 1 })
    expect(t.priority).toBe(0)
    expect(events).toContainEqual({ type: 'attackDeclared', player: 0, attackers: [a, b] })
    expect(events).toContainEqual({ type: 'phaseStarted', phase: 'attack', step: 'block' })
  })
})

describe('§10.1.3–10.1.4 block and damage', () => {
  function attacking(power = 'V-F2') {
    let s = inAttack(); let a: number
    ;[s, a] = withField(s, 0, 'forwards', power)
    ;[s] = applyDeclareAttack(s, 0, [a])
    return { s, a }
  }
  it('only the defender may block, and only with active forwards', () => {
    let { s } = attacking(); let act: number, dull: number
    ;[s, act] = withField(s, 1, 'forwards', 'V-F2')
    ;[s, dull] = withField(s, 1, 'forwards', 'V-F2', { status: 'dull' })
    expect(legalBlockers(s, 1)).toEqual([act])
    expect(legalBlockers(s, 0)).toEqual([])
    expect(() => applyDeclareBlock(s, 1, dull)).toThrow(/active/i)
    expect(() => applyDeclareBlock(s, 0, act)).toThrow(IllegalCommandError)
    expect(() => applyDeclareBlock(s, 0, null)).toThrow(IllegalCommandError)
  })
  it('§10.1.4.1: unblocked → 1 damage to the defender, then back to declaration with nothing pending', () => {
    const { s } = attacking()
    const [t, events] = applyDeclareBlock(s, 1, null)
    expect(events[0]).toEqual({ type: 'blockDeclared', player: 1, blocker: null })
    expect(events[1]).toEqual({ type: 'phaseStarted', phase: 'attack', step: 'damage' })
    expect(t.players[1].damageZone).toHaveLength(1)
    expect(events).toContainEqual(expect.objectContaining({ type: 'playerDamaged', player: 1 }))
    expect(t.attack).toEqual(IDLE)
    expect(t.pending).toBeNull(); expect(t.priority).toBe(0); expect(t.phase).toBe('attack')
  })
  it('§10.1.4.2: blocked → both deal power as damage; the weaker one breaks (§12.4.5)', () => {
    let { s, a } = attacking('V-F2'); let b: number          // 5000 vs 7000
    ;[s, b] = withField(s, 1, 'forwards', 'V-F3')
    const [t, events] = applyDeclareBlock(s, 1, b)
    expect(events).toContainEqual({ type: 'blockDeclared', player: 1, blocker: b })
    expect(events).toContainEqual({ type: 'battleDamage', source: a, target: b, amount: 5000 })
    expect(events).toContainEqual({ type: 'battleDamage', source: b, target: a, amount: 7000 })
    expect(events).toContainEqual({ type: 'broken', card: a })
    expect(t.players[0].breakZone).toContain(a)
    expect(t.players[1].forwards.find((c) => c.id === b)?.damage).toBe(5000)
    expect(t.players[1].damageZone).toHaveLength(0)
  })
  it('§10.1.4.2.1: a blocked party — blocker takes the sum; the blocking player splits its power in 1000s', () => {
    let s = inAttack(); let a1: number, a2: number, b: number
    ;[s, a1] = withField(s, 0, 'forwards', 'V-F1')   // 3000
    ;[s, a2] = withField(s, 0, 'forwards', 'V-F2')   // 5000
    ;[s, b] = withField(s, 1, 'forwards', 'V-F3')    // 7000
    ;[s] = applyDeclareAttack(s, 0, [a1, a2])
    ;[s] = applyDeclareBlock(s, 1, b)
    expect(s.attack).toEqual({ step: 'damage', attackers: [a1, a2], blocker: b })
    expect(s.pending).toEqual({ kind: 'assignPartyDamage', player: 1 })
    const options = legalPartyDamageAssignments(s)
    expect(options).toContainEqual([{ target: a1, amount: 7000 }])
    expect(options).toContainEqual([{ target: a1, amount: 3000 }, { target: a2, amount: 4000 }])
    expect(options.every((o) => o.reduce((n, x) => n + x.amount, 0) === 7000 && o.every((x) => x.amount >= 1000 && x.amount % 1000 === 0))).toBe(true)
    expect(() => applyAssignPartyDamage(s, 0, [{ target: a1, amount: 7000 }])).toThrow(IllegalCommandError)
    expect(() => applyAssignPartyDamage(s, 1, [{ target: a1, amount: 500 }, { target: a2, amount: 6500 }])).toThrow(/1000/)
    const [t] = applyAssignPartyDamage(s, 1, [{ target: a2, amount: 4000 }, { target: a1, amount: 3000 }])   // reversed order is fine
    expect(t.players[0].breakZone).toContain(a1)                                       // 3000 ≥ 3000
    expect(t.players[0].forwards.find((c) => c.id === a2)?.damage).toBe(4000)
    expect(t.players[1].breakZone).toContain(b)                                        // 8000 ≥ 7000
    expect(t.attack).toEqual(IDLE); expect(t.pending).toBeNull(); expect(t.priority).toBe(0)
  })
  it('an unblocked party still deals only 1 damage (§10.1.3.4, §10.1.4.1)', () => {
    let s = inAttack(); let a1: number, a2: number
    ;[s, a1] = withField(s, 0, 'forwards', 'V-F1'); [s, a2] = withField(s, 0, 'forwards', 'V-F2')
    ;[s] = applyDeclareAttack(s, 0, [a1, a2])
    const [t] = applyDeclareBlock(s, 1, null)
    expect(t.players[1].damageZone).toHaveLength(1)
  })
  it('a blocker whose power is not a sum of ≥1000 multiples deals no battle damage (party damage dead end)', () => {
    // power 2500 (not a multiple of 1000, so unsplittable across a 2-forward party) but ≥1000, so it still
    // breaks normally via §12.4.5 once damage lands — isolating the party-damage-split dead end from the
    // separate (pre-existing, documented) "power < 1000 never breaks by damage" behavior in rules.ts.
    const defs = [...VANILLA_POOL, makeDef({ code: 'V-W5', power: 2500 })]
    // Through `apply`, for the same reason `inAttack` does: entering the Attack Phase is two steps since C5.
    let s = apply(makeGame({ defs }), { type: 'pass', player: 0 }).state
    let a1: number, a2: number, b: number
    ;[s, a1] = withField(s, 0, 'forwards', 'V-F1')   // 3000
    ;[s, a2] = withField(s, 0, 'forwards', 'V-F2')   // 5000
    ;[s, b] = withField(s, 1, 'forwards', 'V-W5')    // 2500 — not a sum of ≥1000 multiples
    ;[s] = applyDeclareAttack(s, 0, [a1, a2])
    ;[s] = applyDeclareBlock(s, 1, b)
    expect(legalPartyDamageAssignments(s)).toEqual([[]])
    const [t, events] = applyAssignPartyDamage(s, 1, [])
    expect(events).toContainEqual({ type: 'battleDamage', source: a1, target: b, amount: 3000 })
    expect(events).toContainEqual({ type: 'battleDamage', source: a2, target: b, amount: 5000 })
    expect(events).toContainEqual({ type: 'broken', card: b })
    expect(t.players[1].forwards.find((c) => c.id === b)).toBeUndefined()
    expect(t.players[1].breakZone).toContain(b)
    expect(t.players[0].forwards.find((c) => c.id === a1)?.damage).toBe(0)
    expect(t.players[0].forwards.find((c) => c.id === a2)?.damage).toBe(0)
    expect(t.attack).toEqual(IDLE)
    expect(t.pending).toBeNull()
  })
  it('the 7th damage ends the game', () => {
    let { s } = attacking()
    s = { ...s, players: [s.players[0], { ...s.players[1], damageZone: s.players[1].deck.slice(0, 6), deck: s.players[1].deck.slice(6) }] }
    const [t, events] = applyDeclareBlock(s, 1, null)
    expect(t.result?.winner).toBe(0)
    expect(events.at(-1)).toEqual({ type: 'gameOver', result: t.result })
  })
})
