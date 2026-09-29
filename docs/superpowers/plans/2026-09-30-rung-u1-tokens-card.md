# Rung U1 — tokens and the card — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the "Crystal Arena" design tokens, the two typefaces, a JS mirror of the motion tokens, generative crystal art
for cards with no scan, and the card restyled to the spec's look with its `data-*` visual-state model — shown in the
fixture gallery and re-baselined.

**Architecture:** a new `tokens.css` loaded after `styles.css` (so its re-saturated element hues win everywhere) and a
`motion.ts` whose values a test proves equal to the CSS. A pure `cardArt.ts` turns a card code into shard polygons
(seeded, deterministic); `CardArt.tsx` draws them. `Card.tsx` keeps every class name and text the tests rely on
(`is-dull`, `is-selectable`, `is-paying-*`, `card__back`, `card__name`, `card__img`) and gains `data-*` attributes from
a pure `cardVisualState(props)`; the redesign itself is CSS.

**Tech Stack:** React 19.2, Vite 7, Vitest 3, Playwright 1.62; `@fontsource/barlow` and `@fontsource/barlow-condensed`
5.3.0 (OFL-1.1).

**Spec:** `docs/superpowers/specs/2026-09-30-ui-overhaul-design.md` — section 5 (visual direction, tokens, the card, the
state model), section 7 (motion tokens), D10, D17, D18.

## Global Constraints

- Fonts: Barlow Condensed 800/900 for numbers, names, banners; Barlow 500/600 for rules text; self-hosted via
  `@fontsource`, pinned exactly (spec section 5, D10).
- Motion tokens (at 1×, times `--motion-scale`): instant 70, fast 140, base 220, move 320, reveal 450, dramatic 800 ms.
  Easings `--ease-out cubic-bezier(.16,1,.3,1)`, `--ease-in cubic-bezier(.7,0,.84,0)`, `--ease-in-out`, `--ease-overshoot
  cubic-bezier(.34,1.56,.64,1)`. Springs `snappy` (520, 32), `hover` (380, 26), `heavy` (260, 22) (spec section 7).
- Card radius is 7% of card width (spec section 5).
- The text card is first-class: generative art seeded by the card code, never random per render (D17).
- Animate only `transform` and `opacity`; glows animate the opacity of a pre-rendered `::after`, never `box-shadow`
  (spec section 7/9) — for the states this rung touches.
- No section sign followed by a number in code, tests or specs (the `rules-citations` test).
- Keep every class name and accessible name the existing tests read. The board layout (`styles.css`, `Board.tsx`) is
  U2's; this rung does not restyle it.
- `git add` named paths only; commit trailers as in U0.
- Verify: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:browser`.

## Review Focus

1. **A card with no elements, or three** (a malformed def, a future multi-element card): `cardArt` must still return
   shards and use only the card's own element tokens (or the neutral fallback). Pinned in Task 2.
2. **The same code rendered twice** (a card in hand and its copy on the field; a re-render after a move): the art is
   identical — no `Math.random`, no per-render state. Pinned in Task 2.
3. **Two cards' SVG ids colliding** (gradients referenced by `url(#id)` on a board with 30 cards): each `CardArt` uses
   `useId`. Pinned in Task 2 (render two, ids differ).
4. **A loaded scan**: the generative art must not also render underneath once the image has loaded (wasted paint),
   but must show while loading and after a failure. Pinned in Task 3.
5. **Readability over bright art**: name and power keep a dark stroke/plate so they read over any scan or shard
   colour; the large (sheet) size clamps the gem and numbers instead of scaling them to absurd sizes. Checked in
   the gallery screenshot (Task 4) at every size.

---

### Task 1: tokens, fonts and the motion mirror

**Files:**
- Modify: `apps/web/package.json` (via `pnpm add`), `pnpm-lock.yaml`
- Create: `apps/web/src/tokens.css`, `apps/web/src/motion.ts`
- Modify: `apps/web/src/main.tsx`, `apps/web/src/fixtures/main.tsx` (import fonts and tokens after `styles.css`)
- Test: `apps/web/test/tokens.test.ts`

**Interfaces:**
- Produces: `DURATION_MS`, `type DurationToken`, `EASING`, `SPRING`, `durationMs(token, scale): number` from
  `motion.ts`; CSS custom properties `--stage-0…3`, `--accent-act`, `--accent-act-glow`, `--accent-gold`,
  `--accent-gold-glow`, `--danger-hot`, `--gain`, `--state-targetable|selected|invalid|opponent`, `--el-*` (8),
  `--font-display`, `--font-body`, `--z-board…--z-dialog`, `--shadow-1…3`, `--dur-*`, `--ease-*`.

- [ ] **Step 1: Write the failing test** — `apps/web/test/tokens.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import css from '../src/tokens.css?raw'
import { DURATION_MS, EASING, SPRING, durationMs } from '../src/motion'

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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run apps/web/test/tokens.test.ts`
Expected: FAIL — `../src/tokens.css?raw` / `../src/motion` do not resolve.

- [ ] **Step 3: Add the fonts**

Run: `pnpm --filter @fftcg/web add @fontsource/barlow@5.3.0 @fontsource/barlow-condensed@5.3.0 --save-exact`
Expected: both appear under `dependencies` in `apps/web/package.json` with exact versions.

- [ ] **Step 4: Implement** — `apps/web/src/motion.ts`

```ts
/**
 * The motion tokens, mirrored for JavaScript (UI overhaul spec section 7). `tokens.css` holds the same values as CSS
 * custom properties; `test/tokens.test.ts` fails if the two drift. Starting values, to be tuned faster in U9.
 */
export const DURATION_MS = Object.freeze({ instant: 70, fast: 140, base: 220, move: 320, reveal: 450, dramatic: 800 })
export type DurationToken = keyof typeof DURATION_MS

export const EASING = Object.freeze({
  out: 'cubic-bezier(0.16, 1, 0.3, 1)',
  in: 'cubic-bezier(0.7, 0, 0.84, 0)',
  inOut: 'cubic-bezier(0.65, 0, 0.35, 1)',
  overshoot: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
})

/** Springs for Motion (U4): stiffness and damping, not durations, so an interrupted motion never jumps. */
export const SPRING = Object.freeze({
  snappy: { stiffness: 520, damping: 32 },
  hover: { stiffness: 380, damping: 26 },
  heavy: { stiffness: 260, damping: 22 },
})

/** A duration at the current speed: `scale` is `SPEED_SCALE[settings.speed]` (1, 0.6 or 0). */
export function durationMs(token: DurationToken, scale: number): number {
  return DURATION_MS[token] * scale
}
```

`apps/web/src/tokens.css`:

```css
/*
 * Crystal Arena design tokens (UI overhaul spec section 5, D10). Loaded AFTER styles.css, so the element hues here
 * replace the older ones everywhere they are used (pips, frames, gems). The board chrome keeps its own tokens until
 * U2 restyles it. Durations and easings are mirrored in motion.ts; test/tokens.test.ts keeps the two equal.
 */
:root {
  /* the stage: deep indigo to violet */
  --stage-0: #07081a;
  --stage-1: #0d0f2a;
  --stage-2: #15173d;
  --stage-3: #221f55;

  /* accents: cyan means "you can act", gold means emphasis and "yours" */
  --accent-act: #5de4ff;
  --accent-act-glow: rgb(93 228 255 / 55%);
  --accent-gold: #ffc94d;
  --accent-gold-glow: rgb(255 201 77 / 50%);
  --danger-hot: #ff4d6d;
  --gain: #3ee08f;

  /* card states */
  --state-targetable: var(--accent-act);
  --state-selected: var(--accent-gold);
  --state-invalid: #6a6f99;
  --state-opponent: #ff7a59;

  /* elements, re-saturated */
  --el-fire: #ff5a36;
  --el-ice: #5fd0ff;
  --el-wind: #3ee08f;
  --el-earth: #f0b232;
  --el-lightning: #b86bff;
  --el-water: #3d8bff;
  --el-light: #fff1b8;
  --el-dark: #8c7bd1;

  /* type */
  --font-display: 'Barlow Condensed', 'Avenir Next Condensed', 'Roboto Condensed', sans-serif;
  --font-body: 'Barlow', 'Avenir Next', 'Segoe UI', system-ui, sans-serif;

  /* elevation */
  --z-board: 0;
  --z-hand: 10;
  --z-stack: 20;
  --z-flight: 30;
  --z-fx: 40;
  --z-inspect: 50;
  --z-banner: 60;
  --z-dialog: 70;
  --shadow-1: 0 2px 6px rgb(0 0 0 / 45%);
  --shadow-2: 0 8px 18px rgb(0 0 0 / 55%);
  --shadow-3: 0 18px 40px rgb(0 0 0 / 65%);

  /* motion (spec section 7): every duration scales with the speed setting, and Instant is 0 */
  --dur-instant: calc(70ms * var(--motion-scale, 1));
  --dur-fast: calc(140ms * var(--motion-scale, 1));
  --dur-base: calc(220ms * var(--motion-scale, 1));
  --dur-move: calc(320ms * var(--motion-scale, 1));
  --dur-reveal: calc(450ms * var(--motion-scale, 1));
  --dur-dramatic: calc(800ms * var(--motion-scale, 1));
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-in: cubic-bezier(0.7, 0, 0.84, 0);
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
  --ease-overshoot: cubic-bezier(0.34, 1.56, 0.64, 1);
}
```

In `apps/web/src/main.tsx` and `apps/web/src/fixtures/main.tsx`, after the `styles.css` import, add:

```ts
import '@fontsource/barlow/500.css'
import '@fontsource/barlow/600.css'
import '@fontsource/barlow-condensed/600.css'
import '@fontsource/barlow-condensed/800.css'
import '@fontsource/barlow-condensed/900.css'
import '@fontsource/barlow-condensed/900-italic.css'
import './tokens.css'
```

(in `fixtures/main.tsx` the last line is `import '../tokens.css'`, before `./fixtures.css`).

- [ ] **Step 5: Run it to verify it passes**

Run: `pnpm vitest run apps/web/test/tokens.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/src/tokens.css apps/web/src/motion.ts apps/web/src/main.tsx apps/web/src/fixtures/main.tsx apps/web/test/tokens.test.ts
git commit -m "feat(web): Crystal Arena tokens, Barlow fonts, and the motion mirror (U1)"
```

---

### Task 2: generative crystal art

**Files:**
- Create: `apps/web/src/ui/cardArt.ts`, `apps/web/src/ui/CardArt.tsx`
- Test: `apps/web/test/card-art.test.tsx`

**Interfaces:**
- Produces: `hashCode(s: string): number`, `interface Shard { points: string; fill: string; opacity: number }`,
  `interface CardArtSpec { shards: Shard[]; glow: { cx: number; cy: number; fill: string } }`,
  `cardArt(code: string, elements: readonly Element[]): CardArtSpec`, `CardArt({ code, elements }): JSX.Element`
  (an `svg.card__genart`, `aria-hidden`).

- [ ] **Step 1: Write the failing test** — `apps/web/test/card-art.test.tsx`

```tsx
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { CardArt } from '../src/ui/CardArt'
import { cardArt, hashCode } from '../src/ui/cardArt'

describe('cardArt', () => {
  it('is the same for the same card, every time (Review Focus 2)', () => {
    expect(cardArt('27-124S', ['lightning'])).toEqual(cardArt('27-124S', ['lightning']))
  })

  it('differs between cards', () => {
    expect(cardArt('27-124S', ['lightning'])).not.toEqual(cardArt('27-125S', ['lightning']))
    expect(hashCode('27-124S')).not.toBe(hashCode('27-125S'))
  })

  it('draws five to eight shards inside a padded 100 × 140 box', () => {
    for (const code of ['1-121C', '12-120C', '27-124S', '2-085H', '18-064C']) {
      const { shards } = cardArt(code, ['earth'])
      expect(shards.length, code).toBeGreaterThanOrEqual(5)
      expect(shards.length, code).toBeLessThanOrEqual(8)
      for (const s of shards) {
        for (const pair of s.points.split(' ')) {
          const [x, y] = pair.split(',').map(Number) as [number, number]
          expect(x).toBeGreaterThan(-60); expect(x).toBeLessThan(160)
          expect(y).toBeGreaterThan(-60); expect(y).toBeLessThan(200)
        }
        expect(s.opacity).toBeGreaterThan(0); expect(s.opacity).toBeLessThanOrEqual(1)
      }
    }
  })

  it('colours with the card's own elements only (Review Focus 1)', () => {
    const fills = new Set(cardArt('12-120C', ['earth', 'lightning']).shards.map((s) => s.fill))
    expect([...fills].sort()).toEqual(['var(--el-earth)', 'var(--el-lightning)'])
    const three = new Set(cardArt('12-120C', ['fire', 'ice', 'wind']).shards.map((s) => s.fill))
    for (const f of three) expect(['var(--el-fire)', 'var(--el-ice)', 'var(--el-wind)']).toContain(f)
  })

  it('falls back to a neutral colour for a card with no element (Review Focus 1)', () => {
    const art = cardArt('0-000X', [])
    expect(art.shards.length).toBeGreaterThanOrEqual(5)
    for (const s of art.shards) expect(s.fill).toBe('var(--state-invalid)')
    expect(art.glow.fill).toBe('var(--state-invalid)')
  })
})

let root: Root | null = null
afterEach(() => { act(() => root?.unmount()); root = null; document.body.innerHTML = '' })

describe('<CardArt>', () => {
  it('draws one polygon per shard, hidden from assistive technology', () => {
    const host = document.body.appendChild(document.createElement('div'))
    root = createRoot(host)
    act(() => root?.render(createElement(CardArt, { code: '12-120C', elements: ['earth'] })))
    const svg = host.querySelector('svg.card__genart')
    expect(svg?.getAttribute('aria-hidden')).toBe('true')
    expect(svg?.querySelectorAll('polygon').length).toBe(cardArt('12-120C', ['earth']).shards.length)
  })

  it('gives each instance its own gradient id (Review Focus 3)', () => {
    const host = document.body.appendChild(document.createElement('div'))
    root = createRoot(host)
    act(() => root?.render(createElement('div', null,
      createElement(CardArt, { code: '12-120C', elements: ['earth'] }),
      createElement(CardArt, { code: '12-120C', elements: ['earth'] }))))
    // By id suffix, not by tag: jsdom's selector engine may lowercase an SVG tag name like radialGradient.
    const ids = [...host.querySelectorAll('[id$="-glow"]')].map((g) => g.id)
    expect(ids).toHaveLength(2)
    expect(ids[0]).not.toBe(ids[1])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run apps/web/test/card-art.test.tsx`
Expected: FAIL — `../src/ui/CardArt` does not resolve.

- [ ] **Step 3: Implement**

`apps/web/src/ui/cardArt.ts`:

```ts
import type { Element } from '@fftcg/engine'

/**
 * Generative crystal art for a card with no scan (UI overhaul spec section 5, D17). Several starter exclusives have
 * no art anywhere, so the text card is a permanent design: a cluster of crystal shards in the card's element hues,
 * seeded by the card code so the same card always looks the same — in hand, on the field, after every re-render.
 *
 * Pure and deterministic: an FNV-1a hash of the code seeds a mulberry32 generator. Coordinates are in a 100 × 140
 * box (the card's 5:7 aspect); shards may overhang it, and the SVG's viewBox clips them.
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
```

`apps/web/src/ui/CardArt.tsx`:

```tsx
import { useId, useMemo, type JSX } from 'react'
import type { Element } from '@fftcg/engine'
import { cardArt } from './cardArt.js'

/**
 * The generative art for a card with no loaded scan. Decorative: the card's name, cost and power are on the frame,
 * so this is hidden from assistive technology. `useId` keeps each card's gradient id unique on a board of 30 cards.
 */
export function CardArt({ code, elements }: { code: string; elements: readonly Element[] }): JSX.Element {
  const key = elements.join('|')
  // `key`, not `elements`: callers pass a fresh array every render, and the art depends only on its values.
  const art = useMemo(() => cardArt(code, elements), [code, key])
  // React's ids contain characters (":", "«", "»") that break a `url(#…)` reference, so keep only the safe ones.
  const glowId = `${useId().replace(/[^A-Za-z0-9_-]/g, '')}-glow`
  return (
    <svg className="card__genart" viewBox="0 0 100 140" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id={glowId}>
          <stop offset="0%" stopColor={art.glow.fill} stopOpacity="0.55" />
          <stop offset="100%" stopColor={art.glow.fill} stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx={art.glow.cx} cy={art.glow.cy} r="55" fill={`url(#${glowId})`} />
      {art.shards.map((s, i) => (
        <polygon key={i} points={s.points} fill={s.fill} fillOpacity={s.opacity} stroke="rgb(255 255 255 / 0.35)" strokeWidth="0.6" />
      ))}
    </svg>
  )
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm vitest run apps/web/test/card-art.test.tsx`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/ui/cardArt.ts apps/web/src/ui/CardArt.tsx apps/web/test/card-art.test.tsx
git commit -m "feat(web): generative crystal art for cards with no scan (U1)"
```

---

### Task 3: the card's visual-state model and the restyle

**Files:**
- Modify: `apps/web/src/ui/Card.tsx` (props `role?`, `emphasis?`; `cardVisualState`; `data-*` attributes; `CardArt`
  replaces `.card__crystal`; buff badges move from inline styles to classes)
- Modify: `apps/web/src/ui/Card.css` (the redesign)
- Test: `apps/web/test/card-state.test.tsx`

**Interfaces:**
- Consumes: `CardArt` (Task 2); tokens (Task 1).
- Produces: `type CardRole = 'none' | 'selectable' | 'selected' | 'targetable' | 'targeted' | 'invalid'`,
  `type CardEmphasis = 'none' | 'attacking' | 'blocking' | 'on-stack' | 'just-played'`, `CardProps.role?`,
  `CardProps.emphasis?`, `cardVisualState(props: CardProps): { orientation: 'active' | 'dull'; face: 'up' | 'down';
  role: CardRole; emphasis: CardEmphasis; paying: 'none' | 'dull' | 'discard' | 'flip' }`. The root element carries
  `data-orientation`, `data-face`, `data-role`, `data-emphasis`, `data-paying`.

- [ ] **Step 1: Write the failing test** — `apps/web/test/card-state.test.tsx`

```tsx
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { disableArt, resetMissingArt } from '../src/game/art'
import { Card, cardVisualState, type CardProps } from '../src/ui/Card'

const base: CardProps = { code: '12-120C', name: 'Shantotto', cost: 2, elements: ['earth', 'lightning'], type: 'forward', power: 7000 }

describe('cardVisualState (spec section 5)', () => {
  it('derives each attribute from the props', () => {
    expect(cardVisualState(base)).toEqual({ orientation: 'active', face: 'up', role: 'none', emphasis: 'none', paying: 'none' })
    expect(cardVisualState({ ...base, dull: true }).orientation).toBe('dull')
    expect(cardVisualState({ ...base, paying: 'dull' })).toMatchObject({ orientation: 'dull', paying: 'dull' })
    expect(cardVisualState({ ...base, faceDown: true }).face).toBe('down')
    expect(cardVisualState({ ...base, actionable: true }).role).toBe('selectable')
    expect(cardVisualState({ ...base, selected: true }).role).toBe('selected')
    expect(cardVisualState({ ...base, chosen: true }).role).toBe('selected')
    expect(cardVisualState({ ...base, emphasis: 'attacking' }).emphasis).toBe('attacking')
  })

  it('lets an explicit role win over the derived one', () => {
    expect(cardVisualState({ ...base, actionable: true, role: 'targetable' }).role).toBe('targetable')
    expect(cardVisualState({ ...base, role: 'invalid' }).role).toBe('invalid')
  })
})

let root: Root | null = null
beforeEach(() => { resetMissingArt() })
afterEach(() => { act(() => root?.unmount()); root = null; document.body.innerHTML = ''; resetMissingArt() })

function render(props: CardProps): HTMLElement {
  const host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  act(() => root?.render(createElement(Card, props)))
  return host.querySelector('.card') as HTMLElement
}

describe('<Card> attributes and art', () => {
  it('puts the state on the root element for CSS and tests', () => {
    const el = render({ ...base, dull: true, actionable: true, emphasis: 'blocking' })
    expect(el.dataset['orientation']).toBe('dull')
    expect(el.dataset['face']).toBe('up')
    expect(el.dataset['role']).toBe('selectable')
    expect(el.dataset['emphasis']).toBe('blocking')
    expect(el.dataset['paying']).toBe('none')
    // The classes the older tests and the e2e driver read are still there.
    expect(el.classList.contains('is-dull')).toBe(true)
    expect(el.classList.contains('is-selectable')).toBe(true)
  })

  it('face-down cards carry the attributes too', () => {
    expect(render({ ...base, faceDown: true }).dataset['face']).toBe('down')
  })

  it('shows generative art while the scan is loading, and when there is none (Review Focus 4)', () => {
    expect(render(base).querySelector('svg.card__genart')).not.toBeNull()   // loading: the <img> has not reported
    act(() => root?.unmount()); root = null; document.body.innerHTML = ''
    disableArt()
    const el = render(base)
    expect(el.querySelector('svg.card__genart')).not.toBeNull()
    expect(el.querySelector('img.card__img')).toBeNull()
  })

  it('drops the generative art once the scan has loaded (Review Focus 4)', () => {
    const el = render(base)
    const img = el.querySelector('img.card__img') as HTMLImageElement
    act(() => { img.dispatchEvent(new Event('load')) })
    expect(el.querySelector('svg.card__genart')).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run apps/web/test/card-state.test.tsx`
Expected: FAIL — `cardVisualState` is not exported.

- [ ] **Step 3: Implement the model in `Card.tsx`**

Add after the imports (and add `import { CardArt } from './CardArt.js'`):

```ts
/** Spec section 5: who may do what with this card right now. Derived from the props unless the board names it. */
export type CardRole = 'none' | 'selectable' | 'selected' | 'targetable' | 'targeted' | 'invalid'
/** Spec section 5: why this card is the centre of attention in the current beat. Set by the board (U4, U6). */
export type CardEmphasis = 'none' | 'attacking' | 'blocking' | 'on-stack' | 'just-played'

export interface CardVisualState {
  orientation: 'active' | 'dull'
  face: 'up' | 'down'
  role: CardRole
  emphasis: CardEmphasis
  paying: 'none' | 'dull' | 'discard' | 'flip'
}

/** The card's visual state, derived and never stored (spec section 5). CSS styles it through `data-*` attributes. */
export function cardVisualState(p: CardProps): CardVisualState {
  const derivedRole: CardRole = p.selected || p.chosen ? 'selected' : p.actionable ? 'selectable' : 'none'
  return {
    orientation: p.dull || p.paying === 'dull' ? 'dull' : 'active',
    face: p.faceDown ? 'down' : 'up',
    role: p.role ?? derivedRole,
    emphasis: p.emphasis ?? 'none',
    paying: p.paying ?? 'none',
  }
}
```

In `CardProps`, add after `chosen?`:

```ts
  /** Overrides the role derived from `actionable`/`selected`/`chosen` — targeting (U5) names targetable and targeted. */
  role?: CardRole | undefined
  /** The beat's emphasis on this card (U4, U6). */
  emphasis?: CardEmphasis | undefined
```

In `Card()`: compute `const visual = cardVisualState(props)` and
`const dataAttrs = { 'data-orientation': visual.orientation, 'data-face': visual.face, 'data-role': visual.role, 'data-emphasis': visual.emphasis, 'data-paying': visual.paying }`;
spread `{...dataAttrs}` onto the `<button>` and onto the `<div>`.

Replace `<span className="card__crystal" />` with `{status !== 'ok' && <CardArt code={code} elements={elements} />}`.

Replace the buff row's inline styles: delete the `BUFF_ROW` and `BUFF` constants and their `CSSProperties` import use,
and render

```tsx
            <span className="card__buffs">
              {buffs.map((b) => (
                <span key={b.badge} className="card__buff">{b.badge}</span>
              ))}
            </span>
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm vitest run apps/web/test/card-state.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 5: Restyle** — replace `apps/web/src/ui/Card.css` rules as follows (every rule not listed stays):

1. `.card`: `transition: transform var(--dur-fast) var(--ease-out), filter var(--dur-fast) ease;`
2. `.card__face`: `border-radius: calc(var(--cw) * 0.07); box-shadow: 0 2px 0 color-mix(in oklab, var(--el-a) 45%, black), var(--shadow-2);`
3. `.card__frame`: `padding: calc(var(--cw) * 0.035); border-radius: calc(var(--cw) * 0.07); background: linear-gradient(155deg, color-mix(in oklab, var(--el-a) 80%, white) 0%, var(--el-a) 28%, color-mix(in oklab, var(--el-a) 55%, black) 48%, color-mix(in oklab, var(--el-b) 55%, black) 52%, var(--el-b) 72%, color-mix(in oklab, var(--el-b) 80%, white) 100%);`
4. `.card__body`: `border-radius: calc(var(--cw) * 0.05); background: var(--stage-0); box-shadow: inset 0 0 0 1px rgb(255 255 255 / 14%), inset 0 2px 8px rgb(0 0 0 / 60%);`
5. `.card__art`: `background: radial-gradient(120% 90% at 50% 18%, color-mix(in oklab, var(--el-a) 38%, var(--stage-1)), var(--stage-0) 78%);` plus a new
   `.card__art::after { content: ''; position: absolute; inset: 0; pointer-events: none; opacity: 0.16; mix-blend-mode: overlay; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='96' height='96'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='96' height='96' filter='url(%23n)'/%3E%3C/svg%3E"); }`
   and `.card__genart { position: absolute; inset: 0; width: 100%; height: 100%; }`. Delete the three `.card__crystal` rules.
6. `.card__code`: `font-family: var(--font-display); font-weight: 600; font-size: clamp(6px, calc(var(--cw) * 0.07), 11px); color: rgb(238 240 255 / 60%);`
7. `.card__gem`: `top: calc(var(--cw) * -0.07); left: calc(var(--cw) * -0.07); width: clamp(18px, calc(var(--cw) * 0.3), 40px); height: clamp(18px, calc(var(--cw) * 0.3), 40px); border-radius: 22%; background: linear-gradient(155deg, color-mix(in oklab, var(--el-a) 65%, white), var(--el-a) 45%, color-mix(in oklab, var(--el-b) 65%, black)); box-shadow: 0 0 0 clamp(1px, calc(var(--cw) * 0.018), 2px) rgb(255 255 255 / 80%), var(--shadow-1);`
   `.card__gem span`: `font-family: var(--font-display); font-weight: 900; font-size: clamp(11px, calc(var(--cw) * 0.17), 24px); color: #fff; -webkit-text-stroke: 0.14em var(--stage-0); paint-order: stroke fill; text-shadow: none;`
   Delete the two `.card--small .card__gem` rules (the clamps replace them).
8. `.pip`: `width: clamp(6px, calc(var(--cw) * 0.085), 12px); height: clamp(8px, calc(var(--cw) * 0.12), 17px); border-radius: 0; transform: none; clip-path: polygon(50% 0, 100% 35%, 50% 100%, 0 35%); box-shadow: none; background: linear-gradient(160deg, color-mix(in oklab, currentcolor 45%, white), currentcolor 60%);`
9. `.card__plate`: `padding: calc(var(--cw) * 0.035) calc(var(--cw) * 0.05) calc(var(--cw) * 0.045); border-top: 1px solid color-mix(in oklab, var(--el-a) 55%, transparent); background: linear-gradient(180deg, rgb(7 8 26 / 78%), rgb(7 8 26 / 97%));`
10. `.card__name`: `font-family: var(--font-display); font-weight: 800; font-size: clamp(8px, calc(var(--cw) * 0.12), 22px); letter-spacing: 0.03em; text-transform: uppercase;` and delete the two per-size `.card__name` font-size rules.
11. `.card__type`: `font-family: var(--font-display); font-weight: 600; font-size: clamp(6px, calc(var(--cw) * 0.075), 12px);`
12. `.card__power` (both existing rules replaced by one): `position: absolute; right: calc(var(--cw) * 0.05); bottom: calc(100% + var(--cw) * 0.02); z-index: 2; font-family: var(--font-display); font-weight: 900; font-style: italic; font-size: clamp(12px, calc(var(--cw) * 0.25), 44px); line-height: 1; color: #fff; -webkit-text-stroke: 0.16em var(--stage-0); paint-order: stroke fill; text-shadow: 0 2px 6px rgb(0 0 0 / 60%); font-variant-numeric: tabular-nums; white-space: nowrap;`
    `.card__power em`: `font-size: 0.45em; color: rgb(238 240 255 / 75%); -webkit-text-stroke-width: 0.2em;`
    `.card__power--hurt`: `color: var(--danger-hot);`
    and add `.card__meta { position: static; }` so the power positions against the plate (`.card__plate` is already `position: relative`).
13. Buff badges: `.card__buffs { position: absolute; left: calc(var(--cw) * 0.04); bottom: calc(var(--cw) * 0.06); z-index: 1; display: flex; flex-wrap: wrap; gap: 2px; max-width: 62%; }`
    `.card__buff { padding: 0 0.35em; border-radius: 3px; background: var(--accent-gold); color: var(--stage-0); font-family: var(--font-display); font-weight: 800; font-size: clamp(7px, calc(var(--cw) * 0.085), 12px); line-height: 1.5; letter-spacing: 0.05em; text-transform: uppercase; white-space: nowrap; }`
14. `.card__back`: `border-radius: calc(var(--cw) * 0.07); background: radial-gradient(circle at 50% 42%, #2b3fa0 0%, #141a52 55%, #090b24 100%); box-shadow: inset 0 0 0 calc(var(--cw) * 0.03) rgb(255 201 77 / 65%), inset 0 0 0 calc(var(--cw) * 0.06) #090b24, inset 0 0 0 calc(var(--cw) * 0.072) rgb(255 201 77 / 35%), var(--shadow-2);`
    `.card__back::after`: `width: 30%; aspect-ratio: 3 / 4; clip-path: polygon(50% 0%, 100% 32%, 78% 100%, 22% 100%, 0% 32%); background: linear-gradient(160deg, #e6fbff, var(--accent-act) 45%, #2a5fd0); opacity: 0.9;`
    and add `.card__back::before { content: ''; position: absolute; top: 50%; left: 50%; width: 48%; aspect-ratio: 1; transform: translate(-50%, -50%) rotate(45deg); border: 1px solid rgb(255 201 77 / 55%); }`
15. Selectable (replacing the two `.card.is-selectable .card__face` rules and `@keyframes playable-pulse`):
    `.card__face::after { content: ''; position: absolute; inset: -3px; border-radius: inherit; pointer-events: none; opacity: 0; }`
    `.card[data-role='selectable'] .card__face::after, .card[data-role='targetable'] .card__face::after { opacity: 0.8; box-shadow: 0 0 0 2px var(--accent-act), 0 0 18px var(--accent-act-glow); animation: act-pulse calc(1600ms * var(--motion-scale, 1)) ease-in-out infinite; }`
    (The static `opacity: 0.8` is what shows when the animation cannot run: at Instant its duration is 0, so the
    keyframes never apply, and a glow left at the base `opacity: 0` would vanish — the playable signal gone.)
    `.card[data-role='selectable']:hover .card__face::after { opacity: 1; animation: none; }`
    `@keyframes act-pulse { 0%, 100% { opacity: 0.45; } 50% { opacity: 1; } }`
    `html[data-reduced-motion='true'] .card .card__face::after { animation: none; opacity: 0.9; }`
    (A `--motion-scale` of 0 makes the duration 0 — no pulse at Instant, only the static glow above.)
16. The other roles and the emphasis states (new):
    `.card[data-role='targeted'] .card__face::after { opacity: 1; box-shadow: 0 0 0 3px var(--accent-act), 0 0 22px var(--accent-act-glow), inset 0 0 0 999px rgb(93 228 255 / 10%); }`
    `.card[data-role='invalid'] { filter: saturate(0.35) brightness(0.6); }`
    `.card[data-emphasis='attacking'] .card__face { box-shadow: 0 0 0 3px var(--danger-hot), 0 0 22px rgb(255 77 109 / 55%), var(--shadow-2); }`
    `.card[data-emphasis='blocking'] .card__face { box-shadow: 0 0 0 3px var(--state-opponent), 0 0 22px rgb(255 122 89 / 50%), var(--shadow-2); }`
    `.card[data-emphasis='on-stack'] .card__face { box-shadow: 0 0 0 3px var(--accent-gold), 0 0 22px var(--accent-gold-glow), var(--shadow-2); }`
    `.card[data-emphasis='just-played'] .card__face { box-shadow: 0 0 0 2px #fff, 0 0 26px rgb(255 255 255 / 55%), var(--shadow-2); }`
17. Selected keeps its gold ring, now `var(--accent-gold)` / `var(--accent-gold-glow)` in place of `--gold` / `--gold-glow`.

- [ ] **Step 6: Run the card's tests and every older test that renders cards**

Run: `pnpm vitest run apps/web`
Expected: PASS, with the same test count as before plus this task's 6 (the older card, focus, payment, sheet and
selection tests are untouched by the restyle because class names and names are unchanged).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/ui/Card.tsx apps/web/src/ui/Card.css apps/web/test/card-state.test.tsx
git commit -m "feat(web): the card restyle and its data-* visual-state model (U1)"
```

---

### Task 4: the gallery shows every new state, and the baseline moves

**Files:**
- Modify: `apps/web/src/fixtures/cardFixtures.ts` (roles, emphasis, and one fixture per pool card)
- Modify: `apps/web/test/fixtures.test.tsx` (coverage for the new states)
- Modify: `apps/web/e2e/fixtures.spec.ts-snapshots/card-gallery-darwin.png` (re-baselined)

**Interfaces:**
- Consumes: `CardRole`, `CardEmphasis` (Task 3).

- [ ] **Step 1: Write the failing test** — add to `apps/web/test/fixtures.test.tsx`, inside `describe('the fixture gallery')`:

```tsx
  it('covers the roles and emphasis states the board will set (U1)', () => {
    const has = (pred: (f: (typeof CARD_FIXTURES)[number]) => boolean): boolean => CARD_FIXTURES.some(pred)
    for (const role of ['targetable', 'targeted', 'invalid'] as const) expect(has((f) => f.props.role === role), role).toBe(true)
    for (const e of ['attacking', 'blocking', 'on-stack', 'just-played'] as const) expect(has((f) => f.props.emphasis === e), e).toBe(true)
  })

  it('shows every card in both pools once, so the generative art of each is on the baseline', () => {
    const pool = CARD_FIXTURES.filter((f) => f.group === 'Every pool card')
    expect(pool.length).toBeGreaterThan(20)
    expect(new Set(pool.map((f) => f.props.code)).size).toBe(pool.length)
  })
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run apps/web/test/fixtures.test.tsx`
Expected: FAIL — no fixture has `role: 'targetable'`.

- [ ] **Step 3: Implement** — in `cardFixtures.ts`, add to the array (before `Payment`):

```ts
  { group: 'Targeting (U5)', name: 'targetable', props: props(forward, { role: 'targetable' }) },
  { group: 'Targeting (U5)', name: 'targeted', props: props(forward, { role: 'targeted' }) },
  { group: 'Targeting (U5)', name: 'not a legal target', props: props(forward, { role: 'invalid' }) },
  { group: 'Emphasis (U4, U6)', name: 'attacking', props: props(forward, { emphasis: 'attacking' }) },
  { group: 'Emphasis (U4, U6)', name: 'blocking', props: props(forward, { emphasis: 'blocking' }) },
  { group: 'Emphasis (U4, U6)', name: 'on the stack', props: props(summon, { emphasis: 'on-stack', size: 'hand' }) },
  { group: 'Emphasis (U4, U6)', name: 'just played', props: props(forward, { emphasis: 'just-played' }) },
```

and append the pool (after the `Limit Break` entries):

```ts
  ...[...new Set([...inPool, ...lbCodes])].sort().map((code): CardFixture => {
    const d = def((x) => x.code === code, `the pool card ${code}`)
    return { group: 'Every pool card', name: `${d.name} (${code})`, props: props(d, { size: 'small' }) }
  }),
```

- [ ] **Step 4: Run it to verify it passes, then re-baseline and look**

Run: `pnpm vitest run apps/web/test/fixtures.test.tsx`
Expected: PASS (5 tests).

Run: `pnpm test:browser fixtures --update-snapshots`
Then open `apps/web/e2e/fixtures.spec.ts-snapshots/card-gallery-darwin.png` and check, at every size: the cost gem
and the power number read clearly over the art; the name plate never clips a short name; dull cards are rotated;
every pool card's shard art differs; face-down shows the new back; nothing overflows its card.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/fixtures/cardFixtures.ts apps/web/test/fixtures.test.tsx apps/web/e2e/fixtures.spec.ts-snapshots
git commit -m "test(web): the gallery shows the new card states and every pool card; re-baselined (U1)"
```

---

### Task 5: as built and the full gate

- [ ] **Step 1:** Add a **U1** entry to the spec's `## As built` section: what shipped, the font versions, and any
  ruling from the ledger, in one short paragraph.
- [ ] **Step 2:** Run `pnpm typecheck && pnpm lint && pnpm test && pnpm test:browser`. Expected: all green.
- [ ] **Step 3:** Play one game at 1440×900 with art on (`pnpm --filter @fftcg/web dev`, `/?seed=1&decks=vol2,vol2`),
  screenshot the board with a Forward on each side, and check the restyled cards read on the old board.
- [ ] **Step 4:** Commit the spec: `git add docs/superpowers/specs/2026-09-30-ui-overhaul-design.md && git commit -m "docs: U1 as built"`.
