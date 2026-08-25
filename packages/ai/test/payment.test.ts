import { describe, expect, it } from 'vitest'
import { canPay, generateCp } from '@fftcg/engine'
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
})
