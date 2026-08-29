import { describe, expect, it } from 'vitest'
import { DEFAULT_WEIGHTS, evaluate } from '../src/evaluate.js'
import { makeGame, withField, withHand, withHandSize } from '../../engine/test/helpers.js'

/** The C1 terms switched off — what `evaluate` scored before rung C1 landed. */
const NO_ABILITY_TERMS = { ...DEFAULT_WEIGHTS, haste: 0, brave: 0, protection: 0 }

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
    expect(evaluate({ ...s, result: { winner: 0, cause: 'damage', reason: 'x' } }, 0)).toBe(DEFAULT_WEIGHTS.terminal)
    expect(evaluate({ ...s, result: { winner: 1, cause: 'damage', reason: 'x' } }, 0)).toBe(-DEFAULT_WEIGHTS.terminal)
    expect(evaluate({ ...s, result: { winner: null, cause: 'bothReachedSeven', reason: 'x' } }, 0)).toBe(0)
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

  describe('C1: the until-end-of-turn terms', () => {
    it('is EXACTLY the pre-C1 score on a board with no granted keywords and no flags', () => {
      // The seed-1 gate must not move. No card in the C1 pool prints a keyword, so on a vanilla board the three
      // new terms have to contribute exactly nothing — not "almost nothing".
      let s = withHandSize(makeGame(), 0, 3)
      ;[s] = withField(s, 0, 'forwards', 'V-F3'); [s] = withField(s, 0, 'backups', 'V-B1')
      ;[s] = withField(s, 1, 'forwards', 'V-F8', { damage: 4000 }); [s] = withField(s, 1, 'backups', 'V-B2')
      expect(evaluate(s, 0)).toBe(evaluate(s, 0, NO_ABILITY_TERMS))
      expect(evaluate(s, 1)).toBe(evaluate(s, 1, NO_ABILITY_TERMS))
    })

    it('prices Haste only where it unlocks an attack — and by nothing at all where it does not', () => {
      const base = withHandSize(makeGame(), 0, 0)
      expect(base.turnPlayer).toBe(0)
      const fresh = (over: Parameters<typeof withField>[4]) => withField(base, 0, 'forwards', 'V-F5', over)[0]
      const fields = {
        plain: fresh({ enteredTurn: base.turn }),
        hasted: fresh({ enteredTurn: base.turn, granted: ['haste'] }),
        hastedButDull: fresh({ enteredTurn: base.turn, granted: ['haste'], status: 'dull' }),
        hastedButSpent: fresh({ enteredTurn: base.turn, granted: ['haste'], attackedThisTurn: true }),
        hastedButAlreadyEligible: fresh({ enteredTurn: 0, granted: ['haste'] }),
      }
      expect(evaluate(fields.hasted, 0)).toBeGreaterThan(evaluate(fields.plain, 0))
      // Every case where Haste changes nothing scores identically to the same board without it (§10.1.2.1.1).
      expect(evaluate(fields.hastedButDull, 0)).toBe(evaluate(fields.hastedButDull, 0, NO_ABILITY_TERMS))
      expect(evaluate(fields.hastedButSpent, 0)).toBe(evaluate(fields.hastedButSpent, 0, NO_ABILITY_TERMS))
      expect(evaluate(fields.hastedButAlreadyEligible, 0)).toBe(evaluate(fields.hastedButAlreadyEligible, 0, NO_ABILITY_TERMS))
    })

    it('Haste on the opponent\'s board is worth nothing while it is my turn', () => {
      const base = withHandSize(makeGame(), 0, 0)
      const [theirs] = withField(base, 1, 'forwards', 'V-F5', { enteredTurn: base.turn, granted: ['haste'] })
      expect(evaluate(theirs, 0)).toBe(evaluate(theirs, 0, NO_ABILITY_TERMS))   // it is eligible on its own next turn regardless
    })

    it('prices Brave, and prices cannotBeBroken by exposure', () => {
      const base = withHandSize(makeGame(), 0, 0)
      const [plain] = withField(base, 0, 'forwards', 'V-F5')
      const [brave] = withField(base, 0, 'forwards', 'V-F5', { granted: ['brave'] })
      expect(evaluate(brave, 0)).toBeGreaterThan(evaluate(plain, 0))
      const [safe] = withField(base, 0, 'forwards', 'V-F5', { flags: ['cannotBeBroken'] })
      const [safeAndHurt] = withField(base, 0, 'forwards', 'V-F5', { flags: ['cannotBeBroken'], damage: 6000 })
      const [hurt] = withField(base, 0, 'forwards', 'V-F5', { damage: 6000 })
      expect(evaluate(safe, 0)).toBeGreaterThan(evaluate(plain, 0))
      expect(evaluate(safeAndHurt, 0) - evaluate(hurt, 0)).toBeGreaterThan(evaluate(safe, 0) - evaluate(plain, 0))   // a §12.4.5 break averted is worth more than one deferred
    })

    it('reads power through `powerOf`, so an until-end-of-turn pump is already visible (spec C1-7)', () => {
      const base = withHandSize(makeGame(), 0, 0)
      const [plain] = withField(base, 0, 'forwards', 'V-F1')
      const [pumped] = withField(base, 0, 'forwards', 'V-F1', { powerBonus: 3000 })
      expect(evaluate(pumped, 0)).toBeGreaterThan(evaluate(plain, 0))
    })
  })
})
