import { describe, expect, it } from 'vitest'
import { canPay, defOf, generateCp, legalCommands } from '@fftcg/engine'
import { preferredPayment } from '../src/payment.js'
import { VANILLA_POOL, makeDef, makeGame, withField, withHand, withHandSize } from '../../engine/test/helpers.js'

describe('preferredPayment', () => {
  it('dulls matching backups before discarding, and the result satisfies canPay', () => {
    let s = withHandSize(makeGame(), 0, 0); let b1: number, b2: number, card: number
    ;[s, b1] = withField(s, 0, 'backups', 'V-B1')      // earth
    ;[s, b2] = withField(s, 0, 'backups', 'V-B2')      // lightning
    ;[s] = withHand(s, 0, 'V-F8')                       // lightning 9000 — valuable, must not be discarded
    ;[s, card] = withHand(s, 0, 'V-F2')                 // earth cost 2
    const p = preferredPayment(s, 0, card)!
    expect([...p.dullBackups].sort()).toEqual([b1, b2].sort()); expect(p.discards).toEqual([])
    expect(canPay(2, ['earth'], generateCp(s, 0, p, card))).toBe(true)
  })
  it('discards the lowest-value cards when backups are insufficient, never the card itself', () => {
    let s = withHandSize(makeGame(), 0, 0); let cheap: number, card: number
    ;[s, cheap] = withHand(s, 0, 'V-S2')                 // earth summon cost 1 — low value
    ;[s] = withHand(s, 0, 'V-F7')                        // earth 8000 — high value
    ;[s, card] = withHand(s, 0, 'V-F2')                  // earth cost 2
    const p = preferredPayment(s, 0, card)!
    expect(p.discards.map((d) => d.card)).toEqual([cheap]); expect(p.dullBackups).toEqual([])
  })
  it('R1: picks the lowest-VALUE discard for a required element regardless of hand order', () => {
    // The test above happens to hold the cheap card first, so an implementation that ranks equal-CP sources by
    // hand position still passes it. Both discards supply earth and both generate 2 CP, so only card value can
    // separate them: reversing the hand must not change which one is thrown away.
    for (const order of [['V-S2', 'V-F7'], ['V-F7', 'V-S2']]) {
      let s = withHandSize(makeGame(), 0, 0); let card: number
      for (const code of order) [s] = withHand(s, 0, code)   // V-S2 = earth summon cost 1 (low value), V-F7 = earth 8000 (high)
      ;[s, card] = withHand(s, 0, 'V-F2')                     // earth cost 2
      const p = preferredPayment(s, 0, card)!
      expect(p.discards.map((d) => defOf(s, d.card).code)).toEqual(['V-S2'])
    }
  })
  it('R5: is MINIMAL — never spends a source the payment does not need (Codex counterexample)', () => {
    // Earth cost-2 with one active Earth backup (1 CP) and one cheap Earth discard (2 CP). The required-element
    // phase took the backup (cheapest source for earth), then the top-up phase added the discard to reach 2 CP —
    // spending BOTH for a total of 3 CP, when the discard alone pays exactly. Worse, `enumeratePayments` only
    // emits MINIMAL payments, so this non-minimal result is not in `legalCommands` at all: measured over real
    // games, 40.2% of preferredPayment results were unusable as commands for that reason.
    let s = withHandSize(makeGame(), 0, 0); let card: number
    ;[s] = withField(s, 0, 'backups', 'V-B1')   // earth backup, 1 CP
    ;[s] = withHand(s, 0, 'V-S2')                // earth summon cost 1 — cheap discard, 2 CP
    ;[s, card] = withHand(s, 0, 'V-F2')          // earth cost 2
    const p = preferredPayment(s, 0, card)!
    expect(generateCp(s, 0, p, card)).toHaveLength(2)   // exactly the cost, not 3
    expect(p.dullBackups).toEqual([])                    // the backup stays active
    expect(p.discards).toHaveLength(1)
  })
  it('R5: every preferredPayment result is among the minimal payments legalCommands offers', () => {
    // The property that makes preferredPayment usable as a UI/AI move generator at all: whatever it returns must
    // be a command the engine would list. Checked across fixtures that exercise backups-only, discards-only,
    // mixed, and multi-element costs.
    const fixtures: (() => [ReturnType<typeof makeGame>, number])[] = [
      () => { let s = withHandSize(makeGame(), 0, 0); let c: number
        ;[s] = withField(s, 0, 'backups', 'V-B1'); ;[s] = withField(s, 0, 'backups', 'V-B3'); ;[s, c] = withHand(s, 0, 'V-F2'); return [s, c] },
      () => { let s = withHandSize(makeGame(), 0, 0); let c: number
        ;[s] = withField(s, 0, 'backups', 'V-B1'); ;[s] = withHand(s, 0, 'V-S2'); ;[s, c] = withHand(s, 0, 'V-F2'); return [s, c] },
      () => { let s = withHandSize(makeGame(), 0, 0); let c: number
        ;[s] = withHand(s, 0, 'V-S2'); ;[s] = withHand(s, 0, 'V-F6'); ;[s, c] = withHand(s, 0, 'V-F2'); return [s, c] },
      () => { let s = withHandSize(makeGame(), 0, 0); let c: number
        ;[s] = withField(s, 0, 'backups', 'V-B1'); ;[s] = withHand(s, 0, 'V-F6'); ;[s, c] = withHand(s, 0, 'V-F4'); return [s, c] },
    ]
    for (const [i, make] of fixtures.entries()) {
      const [s, card] = make()
      const p = preferredPayment(s, 0, card)
      if (!p) continue
      const legal = legalCommands(s, 0).filter((c) => (c.type === 'castCharacter' || c.type === 'castSummon') && c.card === card)
      const match = legal.some((c) => JSON.stringify((c as { payment: unknown }).payment) === JSON.stringify(p))
      expect(match, `fixture ${i}: ${JSON.stringify(p)} not among ${legal.length} legal payments`).toBe(true)
    }
  })
  it('satisfies multi-element requirements and returns null when unaffordable', () => {
    let s = withHandSize(makeGame(), 0, 0); let dual: number, poor: number
    ;[s] = withField(s, 0, 'backups', 'V-B1')          // earth
    ;[s] = withHand(s, 0, 'V-F6')                       // lightning 2000 — cheap discard supplies lightning
    ;[s, dual] = withHand(s, 0, 'V-F4')                 // earth/lightning cost 2
    const p = preferredPayment(s, 0, dual)!
    expect(canPay(2, ['earth', 'lightning'], generateCp(s, 0, p, dual))).toBe(true)
    let t = withHandSize(makeGame(), 0, 0)
    ;[t, poor] = withHand(t, 0, 'V-F8')                 // cost 5, nothing to pay with
    expect(preferredPayment(t, 0, poor)).toBeNull()
  })
  it('F4: satisfies scarce elements first so a dual-element discard is kept for the element only it can pay (Codex counterexample)', () => {
    const defs = [
      ...VANILLA_POOL,
      makeDef({ code: 'V-TARGET', type: 'forward', elements: ['earth', 'lightning'], cost: 3, power: 5000 }),   // the cast target
      makeDef({ code: 'V-DUAL', type: 'forward', elements: ['earth', 'lightning'], cost: 1, power: 1000 }),      // cheap — only source of lightning
      makeDef({ code: 'V-EARTHONLY', type: 'forward', elements: ['earth'], cost: 5, power: 9000 }),              // expensive — but still needed for earth
    ]
    let s = withHandSize(makeGame({ defs }), 0, 0); let target: number
    ;[s] = withHand(s, 0, 'V-EARTHONLY')
    ;[s] = withHand(s, 0, 'V-DUAL')
    ;[s, target] = withHand(s, 0, 'V-TARGET')
    // A greedy cheapest-first-by-element algorithm spends V-DUAL on earth (it's cheaper than V-EARTHONLY) and then
    // has nothing left for lightning. The correct payment spends V-EARTHONLY on earth and V-DUAL on lightning.
    const p = preferredPayment(s, 0, target)!
    expect(p).not.toBeNull()
    expect(canPay(3, ['earth', 'lightning'], generateCp(s, 0, p, target))).toBe(true)
  })
  it('does not count a multi-element backup for its non-first element (engine produces elements[0] only)', () => {
    const defs = [...VANILLA_POOL, makeDef({ code: 'V-BD', type: 'backup', elements: ['earth', 'lightning'], cost: 1, power: null })]
    let s = withHandSize(makeGame({ defs }), 0, 0); let card: number
    ;[s] = withField(s, 0, 'backups', 'V-BD')          // produces EARTH only
    ;[s, card] = withHand(s, 0, 'V-F6')                 // lightning cost 1 — cannot be paid
    expect(preferredPayment(s, 0, card)).toBeNull()
  })
  it('C2: bounded backtracking covers 3 required elements when a single scarcity-ordered greedy pass would strand one (Codex counterexample)', () => {
    const defs = [
      ...VANILLA_POOL,
      makeDef({ code: 'V-TARGET3', type: 'forward', elements: ['earth', 'lightning', 'fire'], cost: 3, power: 5000 }),
      makeDef({ code: 'V-EARTH', type: 'forward', elements: ['earth'], cost: 4, power: 8000 }),          // sole earth-only source — EXPENSIVE
      makeDef({ code: 'V-EL', type: 'forward', elements: ['earth', 'lightning'], cost: 1, power: 1000 }), // sole other earth source, one of two lightning sources — CHEAP
      makeDef({ code: 'V-LF', type: 'forward', elements: ['lightning', 'fire'], cost: 2, power: 3000 }),  // sole fire source, other lightning source
    ]
    let s = withHandSize(makeGame({ defs }), 0, 0); let target: number
    ;[s] = withHand(s, 0, 'V-EARTH')
    ;[s] = withHand(s, 0, 'V-EL')
    ;[s] = withHand(s, 0, 'V-LF')
    ;[s, target] = withHand(s, 0, 'V-TARGET3')
    // Scarcity puts fire first (only V-LF), then earth (tie, processed next): a single greedy pass picks the
    // CHEAPEST earth source, V-EL — but V-EL is the ONLY remaining source for lightning once V-LF is spent on
    // fire, so a non-backtracking greedy pass then fails lightning even though {earth: V-EARTH, lightning: V-EL,
    // fire: V-LF} is a legal assignment. Bounded backtracking must find it.
    const p = preferredPayment(s, 0, target)
    expect(p).not.toBeNull()
    expect(canPay(3, ['earth', 'lightning', 'fire'], generateCp(s, 0, p!, target))).toBe(true)
  })
  it('C3: preferredPayment pays a Light card with two off-element (earth) backups, no same-element CP needed', () => {
    const defs = [...VANILLA_POOL, makeDef({ code: 'V-L1', elements: ['light'], cost: 2, power: 5000 })]
    let s = withHandSize(makeGame({ defs }), 0, 0); let card: number
    ;[s] = withField(s, 0, 'backups', 'V-B1')   // earth
    ;[s] = withField(s, 0, 'backups', 'V-B3')   // earth
    ;[s, card] = withHand(s, 0, 'V-L1')
    const p = preferredPayment(s, 0, card)
    expect(p).not.toBeNull()
    expect(p!.discards).toEqual([])
    expect(canPay(2, [], generateCp(s, 0, p!, card))).toBe(true)
  })
})
