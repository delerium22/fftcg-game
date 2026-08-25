export type Rng = number

export function seedRng(seed: number): Rng {
  return seed >>> 0
}

/** mulberry32 step: returns [uniform int in [0,max), nextState] */
export function nextInt(rng: Rng, maxExclusive: number): [number, Rng] {
  const next = (rng + 0x6d2b79f5) >>> 0
  let t = next
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  const u = ((t ^ (t >>> 14)) >>> 0) / 4294967296
  return [Math.floor(u * maxExclusive), next]
}

export function shuffle<T>(rng: Rng, items: readonly T[]): [T[], Rng] {
  const out = [...items]
  let r = rng
  for (let i = out.length - 1; i > 0; i--) {
    const [j, n] = nextInt(r, i + 1)
    r = n
    const tmp = out[i] as T
    out[i] = out[j] as T
    out[j] = tmp
  }
  return [out, r]
}
