import type { Element } from '@fftcg/engine'

/**
 * Generative crystal art for a card with no scan (UI overhaul spec section 5, D17). Several starter exclusives have
 * no art anywhere, so the text card is a permanent design: a cluster of crystal shards in the card's element hues,
 * seeded by the card code so the same card always looks the same — in hand, on the field, after every re-render.
 *
 * Pure and deterministic: an FNV-1a hash of the code seeds a mulberry32 generator. Coordinates are in a 100 × 140
 * box (the card's 5:7 aspect); shards may overhang it, and the SVG's viewBox clips them.
 *
 * Named `crystalArt`, not `cardArt`, because `CardArt.tsx` sits beside it and macOS resolves module names without
 * regard to case: `./CardArt` would find `cardArt.ts` first.
 */
export interface Shard { points: string; fill: string; opacity: number }
export interface CardArtSpec { shards: Shard[]; glow: { cx: number; cy: number; fill: string } }

/** FNV-1a, 32-bit. */
export function hashCode(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** mulberry32: a small, well-mixed PRNG in [0, 1). */
function generator(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const round = (n: number): number => Math.round(n * 10) / 10

export function cardArt(code: string, elements: readonly Element[]): CardArtSpec {
  const next = generator(hashCode(code))
  const fills = elements.length === 0 ? ['var(--state-invalid)'] : elements.map((e) => `var(--el-${e})`)
  const fill = (i: number): string => fills[i % fills.length] as string
  const count = 5 + Math.floor(next() * 4)
  const shards: Shard[] = []
  for (let i = 0; i < count; i++) {
    const cx = 15 + next() * 70
    const cy = 25 + next() * 85
    const h = 34 + next() * 56
    const w = h * (0.26 + next() * 0.18)
    const angle = ((next() - 0.5) * 56 * Math.PI) / 180
    // A crystal: pointed top, bevelled shoulders, flat-ish base — six points around the centre.
    const outline: [number, number][] = [
      [0, -h / 2], [w / 2, -h / 2 + w * 0.7], [w / 2, h / 2 - w * 0.35],
      [0, h / 2], [-w / 2, h / 2 - w * 0.35], [-w / 2, -h / 2 + w * 0.7],
    ]
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    const points = outline.map(([x, y]) => `${round(cx + x * cos - y * sin)},${round(cy + x * sin + y * cos)}`).join(' ')
    shards.push({ points, fill: fill(i), opacity: round(0.3 + next() * 0.55) })
  }
  return { shards, glow: { cx: round(30 + next() * 40), cy: round(35 + next() * 40), fill: fill(0) } }
}
