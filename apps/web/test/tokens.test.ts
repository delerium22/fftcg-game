import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DURATION_MS, EASING, SPRING, durationMs } from '../src/motion'

// Read from disk: Vitest stubs CSS imports (even `?raw`) to an empty string. A path, not `new URL(…, import.meta.url)`,
// which Vite rewrites into an asset URL.
const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'tokens.css'), 'utf8')
const kebab = (s: string): string => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)

describe('motion tokens: CSS and JS agree (spec section 7)', () => {
  it('has the six durations at the spec values', () => {
    expect(DURATION_MS).toEqual({ instant: 70, fast: 140, base: 220, move: 320, reveal: 450, dramatic: 800 })
  })

  it('declares every duration in tokens.css, scaled by --motion-scale', () => {
    for (const [name, ms] of Object.entries(DURATION_MS)) {
      expect(css, name).toContain(`--dur-${name}: calc(${ms}ms * var(--motion-scale, 1));`)
    }
  })

  it('declares every easing in tokens.css with the same curve', () => {
    for (const [name, curve] of Object.entries(EASING)) expect(css, name).toContain(`--ease-${kebab(name)}: ${curve};`)
  })

  it('scales a duration, and Instant is zero', () => {
    expect(durationMs('move', 1)).toBe(320)
    expect(durationMs('move', 0.6)).toBeCloseTo(192)
    expect(durationMs('dramatic', 0)).toBe(0)
  })

  it('has the three springs', () => {
    expect(SPRING).toEqual({ snappy: { stiffness: 520, damping: 32 }, hover: { stiffness: 380, damping: 26 }, heavy: { stiffness: 260, damping: 22 } })
  })
})

describe('colour and type tokens', () => {
  it('defines all eight element hues and the two typefaces', () => {
    for (const el of ['fire', 'ice', 'wind', 'earth', 'lightning', 'water', 'light', 'dark']) expect(css, el).toMatch(new RegExp(`--el-${el}: #[0-9a-f]{6};`))
    expect(css).toContain("--font-display: 'Barlow Condensed'")
    expect(css).toContain("--font-body: 'Barlow'")
  })
})
