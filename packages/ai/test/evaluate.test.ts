import { describe, expect, it } from 'vitest'
import { DEFAULT_WEIGHTS, evaluate } from '../src/evaluate.js'
import { makeGame, withField, withHand, withHandSize } from '../../engine/test/helpers.js'

describe('evaluate', () => {
  it('is exactly zero-sum at aggression 0.5, including on an asymmetric board', () => {
    let s = makeGame()   // P0 has 6 cards vs 5 already
    ;[s] = withField(s, 0, 'forwards', 'V-F3'); [s] = withField(s, 1, 'backups', 'V-B1')
    expect(evaluate(s, 0) + evaluate(s, 1)).toBeCloseTo(0, 6)
  })
  it('values a better hand (handQuality) between two equal-size hands', () => {
    let sLow = withHandSize(makeGame(), 0, 0); let sHigh = withHandSize(makeGame(), 0, 0)
    ;[sLow] = withHand(sLow, 0, 'V-F1')    // cheap, low-value forward
    ;[sHigh] = withHand(sHigh, 0, 'V-F8')  // expensive, high-value forward
    expect(evaluate(sHigh, 0)).toBeGreaterThan(evaluate(sLow, 0))
  })
  it('more own damage is worse; more own board is better; dull forwards count less', () => {
    let s = makeGame(); let f: number
    const base = evaluate(s, 0)
    const hurt = { ...s, players: [{ ...s.players[0], damageZone: s.players[0].deck.slice(0, 2), deck: s.players[0].deck.slice(2) }, s.players[1]] as typeof s.players }
    expect(evaluate(hurt, 0)).toBeLessThan(base)
    ;[s, f] = withField(s, 0, 'forwards', 'V-F3')
    expect(evaluate(s, 0)).toBeGreaterThan(base)
    const dulled = { ...s, players: [{ ...s.players[0], forwards: s.players[0].forwards.map((c) => (c.id === f ? { ...c, status: 'dull' as const } : c)) }, s.players[1]] as typeof s.players }
    expect(evaluate(dulled, 0)).toBeLessThan(evaluate(s, 0))
  })
  it('terminal states dominate', () => {
    const s = makeGame()
    expect(evaluate({ ...s, result: { winner: 0, reason: 'x' } }, 0)).toBe(DEFAULT_WEIGHTS.terminal)
    expect(evaluate({ ...s, result: { winner: 1, reason: 'x' } }, 0)).toBe(-DEFAULT_WEIGHTS.terminal)
    expect(evaluate({ ...s, result: { winner: null, reason: 'x' } }, 0)).toBe(0)
  })
  it('aggression 1 ignores my own material, aggression 0 ignores the opponent\'s', () => {
    let s = makeGame(); [s] = withField(s, 0, 'forwards', 'V-F3'); [s] = withField(s, 1, 'forwards', 'V-F3')
    const mineOnly = evaluate(s, 0, DEFAULT_WEIGHTS, 0)
    const oppOnly = evaluate(s, 0, DEFAULT_WEIGHTS, 1)
    expect(mineOnly).toBeGreaterThan(0); expect(oppOnly).toBeLessThan(0)
  })
  it('F6: aggression 0 is exactly invariant when only the opponent\'s board changes', () => {
    let s = makeGame()
    const before = evaluate(s, 0, DEFAULT_WEIGHTS, 0)
    ;[s] = withField(s, 1, 'forwards', 'V-F3')
    expect(evaluate(s, 0, DEFAULT_WEIGHTS, 0)).toBe(before)
  })
  it('F6: aggression 1 is exactly invariant when only my own board changes', () => {
    let s = makeGame()
    const before = evaluate(s, 0, DEFAULT_WEIGHTS, 1)
    ;[s] = withField(s, 0, 'forwards', 'V-F3')
    expect(evaluate(s, 0, DEFAULT_WEIGHTS, 1)).toBe(before)
  })
  it('F6: throws a RangeError when aggression is outside [0, 1]', () => {
    const s = makeGame()
    expect(() => evaluate(s, 0, DEFAULT_WEIGHTS, -0.001)).toThrow(RangeError)
    expect(() => evaluate(s, 0, DEFAULT_WEIGHTS, 1.001)).toThrow(RangeError)
  })
})
