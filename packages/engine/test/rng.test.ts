import { describe, expect, it } from 'vitest'
import { nextInt, seedRng, shuffle } from '../src/rng.js'

describe('rng', () => {
  it('is deterministic for a seed', () => {
    const a = shuffle(seedRng(42), [1, 2, 3, 4, 5, 6, 7, 8])
    const b = shuffle(seedRng(42), [1, 2, 3, 4, 5, 6, 7, 8])
    expect(a[0]).toEqual(b[0])
    expect(a[1]).toBe(b[1])
  })
  it('differs across seeds and preserves the multiset', () => {
    const [a] = shuffle(seedRng(1), [1, 2, 3, 4, 5, 6, 7, 8])
    const [b] = shuffle(seedRng(2), [1, 2, 3, 4, 5, 6, 7, 8])
    expect(a).not.toEqual(b)
    expect([...a].sort()).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })
  it('nextInt stays in range', () => {
    let r = seedRng(7)
    for (let i = 0; i < 1000; i++) {
      const [v, n] = nextInt(r, 6)
      expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(6); r = n
    }
  })
})
