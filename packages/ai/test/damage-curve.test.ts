import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DAMAGE_TO_LOSE, type GameState, type PlayerId } from '@fftcg/engine'
import { DEFAULT_WEIGHTS, evaluate, resolveWeights } from '../src/evaluate.js'
import { corpus, withDamage, type Case } from './fixtures/frozen-scores.js'

/**
 * Rung G1b — `damageCurve`, and the two things its acceptance has to prove.
 *
 * The plan review found that the criteria I first wrote would have been satisfied by the `n²` basis the
 * PREVIOUS review rejected: both are neutral at zero, and both have increasing marginals. So "the marginal
 * increases" is not the property under test. The property is `n(n−1)` exactly — 0 → 1 unchanged for every
 * value of the weight — and that is what separates the two.
 */

const frozen: Record<string, number> = JSON.parse(
  readFileSync(new URL('./fixtures/frozen-scores.json', import.meta.url), 'utf8'),
) as Record<string, number>

describe('G1b-A1 — damageCurve: 0 leaves evaluate bitwise unchanged', () => {
  it('reproduces scores frozen from the code BEFORE the weight existed, exactly', () => {
    // Frozen, not recomputed. Comparing the new evaluator against itself is how A1 passes vacuously, which the
    // review named explicitly; `fixtures/frozen-scores.json` was written on the parent commit and does not move.
    const cases = corpus()
    expect(cases.length, 'the corpus is empty, so this reconciles nothing').toBeGreaterThan(100)
    let checked = 0
    for (const c of cases) {
      const want = frozen[c.label]
      expect(want, `no frozen score for ${c.label} — the corpus changed shape, so A1 is not comparing like with like`)
        .toBeDefined()
      // Exact equality, not `toBeCloseTo`: subtracting a finite `+0` is exactly neutral in IEEE 754, so any
      // difference at all is a real change of behaviour rather than rounding.
      expect(evaluate(c.state, c.me, DEFAULT_WEIGHTS, c.aggression), `${c.label} moved`).toBe(want)
      checked++
    }
    expect(checked).toBe(cases.length)
  })

  it('the corpus actually contains the states where a damage weight could hide', () => {
    // A1 is trivially satisfied by zero damage, symmetric damage, or a decided result. If the corpus were only
    // those, it would pass while the weight did anything it liked.
    const cases = corpus()
    const unequalNonZero = cases.filter((c) => {
      const [a, b] = [c.state.players[0].damageZone.length, c.state.players[1].damageZone.length]
      return a !== b && a > 0 && b > 0 && !c.state.result
    })
    expect(unequalNonZero.length, 'no case has unequal, non-zero damage on both sides').toBeGreaterThan(20)
    const nearCliff = cases.filter((c) => c.state.players[0].damageZone.length >= 5 || c.state.players[1].damageZone.length >= 5)
    expect(nearCliff.length, 'no case sits at five or six damage — the range the curve exists for').toBeGreaterThan(20)
    expect(cases.every((c) => !c.state.result), 'a terminal state is in the corpus, where material never runs').toBe(true)
  })
})

/** One side's `material` contribution, isolated by scoring at the aggression that zeroes the other side. */
const mineOnly = (s: GameState, me: PlayerId, curve: number): number =>
  evaluate(s, me, resolveWeights({ damageCurve: curve }), 0) / 2

describe('G1b-A2 — the basis is n(n−1), and nothing else', () => {
  const base = corpus().find((c: Case) => c.state.players[0].damageZone.length === 0 && c.state.players[1].damageZone.length === 0)!
  const at = (n: number, curve: number): number => mineOnly(withDamage(base.state, 0, n), 0, curve)

  it('leaves 0 → 1 at exactly its old price, for every value of the weight', () => {
    // THE clause that distinguishes the centred basis from the rejected quadratic. Under `n²` the first damage
    // gets more expensive as the weight grows; under `n(n−1)` it cannot, because f(0) = f(1) = 0.
    const zeroToOne = at(0, 0) - at(1, 0)
    expect(zeroToOne, 'the first damage should cost the damage weight plus the deck card it consumes')
      .toBeCloseTo(DEFAULT_WEIGHTS.damage + DEFAULT_WEIGHTS.deck, 10)
    for (const c of [0.5, 1, 2, 4, 30]) {
      expect(at(0, c) - at(1, c), `damageCurve ${c} changed the price of the FIRST damage — that is the n² basis`)
        .toBeCloseTo(zeroToOne, 10)
    }
  })

  it('raises every later marginal by exactly 2 × damageCurve', () => {
    // The exact values, not merely "increasing". `n(n−1)` has second difference 2, so each step costs 2c more
    // than the one before it — a property `n²` shares, which is why the clause above is the one that separates
    // them and this one pins the magnitude.
    for (const c of [0.5, 1, 2, 4]) {
      for (let n = 1; n < DAMAGE_TO_LOSE - 1; n++) {
        const step = at(n, c) - at(n + 1, c)
        const prev = at(n - 1, c) - at(n, c)
        expect(step - prev, `damageCurve ${c}: the ${n} → ${n + 1} marginal did not exceed the one before it by 2c`)
          .toBeCloseTo(2 * c, 9)
      }
    }
  })

  it('cancels when both players hold equal damage, so the term is antisymmetric', () => {
    // The opponent's sign. An own-side-only implementation passes every clause above and fails this one: at
    // aggression 0.5 the curve contributes c × [f(theirs) − f(mine)], which is zero when the two are equal.
    for (const n of [2, 4, 6]) {
      const equal = withDamage(withDamage(base.state, 0, n), 1, n)
      const plain = evaluate(equal, 0, DEFAULT_WEIGHTS, 0.5)
      for (const c of [0.5, 4]) {
        expect(evaluate(equal, 0, resolveWeights({ damageCurve: c }), 0.5),
          `damageCurve ${c} at ${n}-${n}: equal damage should cancel, so this is one-sided`).toBeCloseTo(plain, 9)
      }
    }
  })

  it('prices MY damage as a cost and THEIRS as a gain', () => {
    // Direction, stated separately from cancellation: a sign error would cancel just as neatly.
    const c = 4
    const iAmHurt = withDamage(base.state, 0, 6)
    const theyAreHurt = withDamage(base.state, 1, 6)
    expect(evaluate(iAmHurt, 0, resolveWeights({ damageCurve: c }), 0.5))
      .toBeLessThan(evaluate(iAmHurt, 0, DEFAULT_WEIGHTS, 0.5))
    expect(evaluate(theyAreHurt, 0, resolveWeights({ damageCurve: c }), 0.5))
      .toBeGreaterThan(evaluate(theyAreHurt, 0, DEFAULT_WEIGHTS, 0.5))
  })
})
