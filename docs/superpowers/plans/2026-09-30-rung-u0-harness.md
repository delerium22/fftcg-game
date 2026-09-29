# Rung U0 — harness and baseline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the switches and measuring tools every later UI rung depends on — a settings store, `--motion-scale`,
production-safe `?motion=instant` / `?art=off` / `?perf=1` flags, Instant for the e2e suite, a fixture gallery with a
screenshot baseline, and a recorded baseline of today's UI (screenshots and a throttled performance trace).

**Architecture:** a pure `settings.ts` (load/save/apply, no React) and a `bootstrap.ts` that reads the URL once at
page load, applies session-only overrides on top of the stored settings, and writes CSS custom properties and `data-*`
attributes on `<html>`. `main.tsx` calls it before rendering. A second Vite entry (`fixtures.html`) renders every
`Card` state. Nothing in the game changes behaviour: nothing animates yet, so Instant is a recorded setting with no
visible effect until U3/U4.

**Tech Stack:** React 19.2, Vite 7, Vitest 3 (jsdom), Playwright 1.62, TypeScript (strict, `exactOptionalPropertyTypes`,
`noUncheckedIndexedAccess`).

**Spec:** `docs/superpowers/specs/2026-09-30-ui-overhaul-design.md` — §8 (settings), §10 (testing), §11 row U0, D9,
D18, D24.

## Global Constraints

- No new runtime dependency (Motion arrives in U4; fonts in U1).
- Flags are parsed in `apps/web/src/bootstrap.ts`, wired from `main.tsx` — not in `App.tsx` (spec §10).
- Settings live in `localStorage` under `fftcg.settings`, every read and write inside try/catch; defaults apply when
  storage is blocked (spec §8).
- Speeds: Normal = 1, Fast = 0.6, Instant = 0 (spec §8, D9). Reduced motion: System / On / Off. Effects: Full / Reduced.
  Skip on click: default On.
- URL flags are session-only: `?motion=instant` never writes to storage.
- A malformed flag value is ignored with a `console.warn`, like `?seed=` (App.tsx precedent).
- Never commit card art. Screenshots are taken with `?art=off` only.
- Screenshot baselines exist only for the fixture gallery (D18).
- `git add` named paths only. Commit messages end with the session's Co-Authored-By / Claude-Session lines.
- Verify: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:browser` (all from the worktree root).

## Review Focus

1. **Storage that throws** (private windows, blocked site data): `loadSettings`/`saveSettings` must return defaults /
   `false`, never throw. Pinned in Task 1 with a throwing storage stub.
2. **A stored value from another version** (`{"speed":"turbo","skipOnClick":"yes"}`, `null`, an array, bad JSON):
   each field falls back to its own default; valid fields survive. Pinned in Task 1.
3. **A malformed flag** (`?motion=slow`, `?art=on`, `?perf=yes`): ignored with a warning; the stored settings stand.
   Pinned in Task 2 (unit) and Task 5 (browser).
4. **No `matchMedia`** (jsdom, very old engines) and a **system reduced-motion change while the page is open**:
   bootstrap must not throw without it, and must re-apply `data-reduced-motion` on a change event. Pinned in Task 2.
5. **`?art=off` must mean no request at all**, not a request that fails: no `img.card__img` in the DOM and no request
   to `/cards/`. Pinned in Task 2 (unit: `isArtMissing`) and Task 5 (browser: request log).

---

### Task 1: the settings store

**Files:**
- Create: `apps/web/src/settings.ts`
- Test: `apps/web/test/settings.test.ts`

**Interfaces:**
- Produces: `type Speed = 'normal' | 'fast' | 'instant'`, `type ReducedMotionPref = 'system' | 'on' | 'off'`,
  `type Effects = 'full' | 'reduced'`, `interface Settings { speed; reducedMotion; effects; skipOnClick: boolean }`,
  `DEFAULT_SETTINGS`, `SETTINGS_KEY = 'fftcg.settings'`, `type SettingsStorage = Pick<Storage, 'getItem' | 'setItem'>`,
  `loadSettings(storage?: SettingsStorage | null): Settings`, `saveSettings(s: Settings, storage?: SettingsStorage | null): boolean`,
  `SPEED_SCALE: Record<Speed, number>`, `reducedMotionActive(s: Settings, systemPrefersReduced: boolean): boolean`,
  `applySettings(s: Settings, root: HTMLElement, systemPrefersReduced: boolean): void`.

- [ ] **Step 1: Write the failing test** — `apps/web/test/settings.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS, SETTINGS_KEY, SPEED_SCALE, applySettings, loadSettings, reducedMotionActive, saveSettings,
  type SettingsStorage,
} from '../src/settings'

/** A Storage stand-in: a Map, or one that throws on every access like a blocked private window. */
const memory = (init: Record<string, string> = {}): SettingsStorage & { data: Map<string, string> } => {
  const data = new Map(Object.entries(init))
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v) } }
}
const throwing: SettingsStorage = {
  getItem: () => { throw new DOMException('blocked', 'SecurityError') },
  setItem: () => { throw new DOMException('blocked', 'SecurityError') },
}

describe('loadSettings', () => {
  it('returns the defaults when nothing is stored', () => {
    expect(loadSettings(memory())).toEqual(DEFAULT_SETTINGS)
    expect(DEFAULT_SETTINGS).toEqual({ speed: 'normal', reducedMotion: 'system', effects: 'full', skipOnClick: true })
  })

  it('returns the defaults when storage throws or is absent (Review Focus 1)', () => {
    expect(loadSettings(throwing)).toEqual(DEFAULT_SETTINGS)
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS)
  })

  it('reads a complete stored value', () => {
    const stored = { speed: 'fast', reducedMotion: 'on', effects: 'reduced', skipOnClick: false }
    expect(loadSettings(memory({ [SETTINGS_KEY]: JSON.stringify(stored) }))).toEqual(stored)
  })

  it('falls back per field, keeping the valid ones (Review Focus 2)', () => {
    const s = loadSettings(memory({ [SETTINGS_KEY]: JSON.stringify({ speed: 'turbo', effects: 'reduced', skipOnClick: 'yes' }) }))
    expect(s).toEqual({ ...DEFAULT_SETTINGS, effects: 'reduced' })
  })

  it('treats bad JSON, null, arrays and numbers as nothing stored (Review Focus 2)', () => {
    for (const raw of ['{not json', 'null', '[1,2]', '42', '"instant"']) {
      expect(loadSettings(memory({ [SETTINGS_KEY]: raw })), raw).toEqual(DEFAULT_SETTINGS)
    }
  })

  it('returns a fresh object, so a caller cannot mutate the defaults', () => {
    const s = loadSettings(memory())
    s.speed = 'instant'
    expect(DEFAULT_SETTINGS.speed).toBe('normal')
  })
})

describe('saveSettings', () => {
  it('round-trips through loadSettings', () => {
    const store = memory()
    const s = { speed: 'instant', reducedMotion: 'off', effects: 'full', skipOnClick: false } as const
    expect(saveSettings(s, store)).toBe(true)
    expect(loadSettings(store)).toEqual(s)
  })

  it('reports false instead of throwing when storage is blocked or absent (Review Focus 1)', () => {
    expect(saveSettings(DEFAULT_SETTINGS, throwing)).toBe(false)
    expect(saveSettings(DEFAULT_SETTINGS, null)).toBe(false)
  })
})

describe('speed and reduced motion', () => {
  it('scales Normal 1, Fast 0.6, Instant 0 (spec §8)', () => {
    expect(SPEED_SCALE).toEqual({ normal: 1, fast: 0.6, instant: 0 })
  })

  it('follows the system only when set to System', () => {
    expect(reducedMotionActive({ ...DEFAULT_SETTINGS, reducedMotion: 'system' }, true)).toBe(true)
    expect(reducedMotionActive({ ...DEFAULT_SETTINGS, reducedMotion: 'system' }, false)).toBe(false)
    expect(reducedMotionActive({ ...DEFAULT_SETTINGS, reducedMotion: 'on' }, false)).toBe(true)
    expect(reducedMotionActive({ ...DEFAULT_SETTINGS, reducedMotion: 'off' }, true)).toBe(false)
  })
})

describe('applySettings', () => {
  it('writes --motion-scale and the data attributes CSS and tests select on', () => {
    const root = document.createElement('html')
    applySettings({ speed: 'fast', reducedMotion: 'system', effects: 'reduced', skipOnClick: true }, root, true)
    expect(root.style.getPropertyValue('--motion-scale')).toBe('0.6')
    expect(root.dataset['speed']).toBe('fast')
    expect(root.dataset['reducedMotion']).toBe('true')
    expect(root.dataset['effects']).toBe('reduced')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run apps/web/test/settings.test.ts`
Expected: FAIL — `Failed to resolve import "../src/settings"`.

- [ ] **Step 3: Implement** — `apps/web/src/settings.ts`

```ts
/**
 * The player's presentation settings (UI overhaul spec §8, D9): animation speed, reduced motion, effects, and skip on
 * click. Per-browser conveniences, so they live in `localStorage` — and every access is guarded, because a private
 * window or blocked site data makes the accessor itself throw, and a settings failure must never stop the game.
 *
 * Pure: nothing here knows about React or the URL. `bootstrap.ts` layers the URL's session-only flags on top.
 */

export type Speed = 'normal' | 'fast' | 'instant'
export type ReducedMotionPref = 'system' | 'on' | 'off'
export type Effects = 'full' | 'reduced'

export interface Settings {
  speed: Speed
  reducedMotion: ReducedMotionPref
  effects: Effects
  skipOnClick: boolean
}

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({ speed: 'normal', reducedMotion: 'system', effects: 'full', skipOnClick: true })
export const SETTINGS_KEY = 'fftcg.settings'

/** Every duration token is multiplied by this (spec §7): Instant is 0, and U3's director drains synchronously at 0. */
export const SPEED_SCALE: Readonly<Record<Speed, number>> = Object.freeze({ normal: 1, fast: 0.6, instant: 0 })

export type SettingsStorage = Pick<Storage, 'getItem' | 'setItem'>

const SPEEDS: readonly Speed[] = ['normal', 'fast', 'instant']
const REDUCED: readonly ReducedMotionPref[] = ['system', 'on', 'off']
const EFFECTS: readonly Effects[] = ['full', 'reduced']

const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback

/** The browser's storage, or null where even touching `localStorage` throws. */
function browserStorage(): SettingsStorage | null {
  try { return globalThis.localStorage ?? null } catch { return null }
}

/** The stored settings, each field validated on its own so one stale field never discards the rest. */
export function loadSettings(storage: SettingsStorage | null = browserStorage()): Settings {
  let raw: string | null
  try { raw = storage?.getItem(SETTINGS_KEY) ?? null } catch { raw = null }
  let parsed: unknown = null
  if (raw !== null) {
    try { parsed = JSON.parse(raw) } catch { parsed = null }
  }
  const o: Record<string, unknown> = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  return {
    speed: oneOf(o['speed'], SPEEDS, DEFAULT_SETTINGS.speed),
    reducedMotion: oneOf(o['reducedMotion'], REDUCED, DEFAULT_SETTINGS.reducedMotion),
    effects: oneOf(o['effects'], EFFECTS, DEFAULT_SETTINGS.effects),
    skipOnClick: typeof o['skipOnClick'] === 'boolean' ? o['skipOnClick'] : DEFAULT_SETTINGS.skipOnClick,
  }
}

/** Persist the settings. `false` when there is no storage or it refused — the caller keeps them for this page only. */
export function saveSettings(settings: Settings, storage: SettingsStorage | null = browserStorage()): boolean {
  if (storage === null) return false
  try { storage.setItem(SETTINGS_KEY, JSON.stringify(settings)); return true } catch { return false }
}

/** Reduced motion is on when the player says so, or when they left it to the system and the system asks for it. */
export function reducedMotionActive(settings: Settings, systemPrefersReduced: boolean): boolean {
  return settings.reducedMotion === 'on' || (settings.reducedMotion === 'system' && systemPrefersReduced)
}

/**
 * Publish the settings to CSS: `--motion-scale` for every duration token, and `data-*` attributes for the rules that
 * swap motion for fades or drop particles. On `<html>`, so every stylesheet and the fixture page can read them.
 */
export function applySettings(settings: Settings, root: HTMLElement, systemPrefersReduced: boolean): void {
  root.style.setProperty('--motion-scale', String(SPEED_SCALE[settings.speed]))
  root.dataset['speed'] = settings.speed
  root.dataset['reducedMotion'] = String(reducedMotionActive(settings, systemPrefersReduced))
  root.dataset['effects'] = settings.effects
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm vitest run apps/web/test/settings.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/settings.ts apps/web/test/settings.test.ts
git commit -m "feat(web): the presentation settings store (U0)"
```

---

### Task 2: URL flags, `?art=off`, and the bootstrap

**Files:**
- Create: `apps/web/src/bootstrap.ts`
- Modify: `apps/web/src/game/art.ts` (add `disableArt`; `isArtMissing` honours it; `resetMissingArt` re-enables)
- Modify: `apps/web/src/main.tsx` (call `bootstrap()` before rendering)
- Test: `apps/web/test/bootstrap.test.ts`, `apps/web/test/art.test.ts` (extend)

**Interfaces:**
- Consumes: `loadSettings`, `applySettings`, `Settings`, `SettingsStorage` (Task 1).
- Produces: `interface Flags { motionInstant: boolean; artOff: boolean; perf: boolean }`,
  `parseFlags(search: string): Flags`, `effectiveSettings(stored: Settings, flags: Flags): Settings`,
  `interface Boot { settings: Settings; flags: Flags }`, `bootstrap(win?: Window, storage?: SettingsStorage | null): Boot`;
  in `art.ts`: `disableArt(): void`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/test/art.test.ts` (inside the file, after the `missing-art cache` block; `disableArt` joins the
existing import from `'../src/game/art'`):

```ts
describe('?art=off (U0)', () => {
  beforeEach(() => { resetMissingArt() })

  it('reports every code missing, so <Card> never renders an <img> (Review Focus 5)', () => {
    expect(isArtMissing('12-120C')).toBe(false)
    disableArt()
    expect(isArtMissing('12-120C')).toBe(true)
    expect(isArtMissing('27-124S')).toBe(true)
  })

  it('is undone by the test seam', () => {
    disableArt()
    resetMissingArt()
    expect(isArtMissing('12-120C')).toBe(false)
  })
})
```

Create `apps/web/test/bootstrap.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bootstrap, effectiveSettings, parseFlags } from '../src/bootstrap'
import { isArtMissing, resetMissingArt } from '../src/game/art'
import { DEFAULT_SETTINGS, SETTINGS_KEY, type SettingsStorage } from '../src/settings'

const memory = (init: Record<string, string> = {}): SettingsStorage & { data: Map<string, string> } => {
  const data = new Map(Object.entries(init))
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v) } }
}

/** A window stand-in: the real jsdom document, a chosen query string, and an optional matchMedia. */
function fakeWindow(search: string, media?: { matches: boolean }): { win: Window; fire: (matches: boolean) => void } {
  let listener: (() => void) | null = null
  const mq = media && {
    get matches() { return media.matches },
    addEventListener: (_: string, cb: () => void) => { listener = cb },
  }
  const win = { location: { search }, document, ...(mq ? { matchMedia: () => mq } : {}) } as unknown as Window
  return { win, fire: (matches) => { if (media) media.matches = matches; listener?.() } }
}

afterEach(() => {
  resetMissingArt()
  const root = document.documentElement
  root.removeAttribute('style')
  for (const k of ['speed', 'reducedMotion', 'effects']) delete root.dataset[k]
  vi.restoreAllMocks()
})

describe('parseFlags', () => {
  it('reads the three flags', () => {
    expect(parseFlags('')).toEqual({ motionInstant: false, artOff: false, perf: false })
    expect(parseFlags('?motion=instant&art=off&perf=1&seed=5')).toEqual({ motionInstant: true, artOff: true, perf: true })
  })

  it('ignores a malformed value with a warning (Review Focus 3)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(parseFlags('?motion=slow&art=on&perf=yes')).toEqual({ motionInstant: false, artOff: false, perf: false })
    expect(warn).toHaveBeenCalledTimes(3)
    expect(warn.mock.calls[0]?.[0]).toContain('?motion=slow')
  })
})

describe('effectiveSettings', () => {
  it('lets ?motion=instant override the stored speed and nothing else', () => {
    const stored = { ...DEFAULT_SETTINGS, speed: 'fast' as const, effects: 'reduced' as const }
    expect(effectiveSettings(stored, { motionInstant: true, artOff: false, perf: false })).toEqual({ ...stored, speed: 'instant' })
    expect(effectiveSettings(stored, { motionInstant: false, artOff: false, perf: false })).toBe(stored)
  })
})

describe('bootstrap', () => {
  it('applies the stored settings to <html>', () => {
    const store = memory({ [SETTINGS_KEY]: JSON.stringify({ speed: 'fast' }) })
    const boot = bootstrap(fakeWindow('').win, store)
    expect(boot.settings.speed).toBe('fast')
    expect(document.documentElement.style.getPropertyValue('--motion-scale')).toBe('0.6')
  })

  it('applies ?motion=instant for this page only — nothing is written to storage', () => {
    const store = memory()
    bootstrap(fakeWindow('?motion=instant').win, store)
    expect(document.documentElement.style.getPropertyValue('--motion-scale')).toBe('0')
    expect(store.data.has(SETTINGS_KEY)).toBe(false)
  })

  it('turns art off for ?art=off (Review Focus 5)', () => {
    bootstrap(fakeWindow('?art=off').win, memory())
    expect(isArtMissing('12-120C')).toBe(true)
  })

  it('works without matchMedia, treating the system as not reduced (Review Focus 4)', () => {
    bootstrap(fakeWindow('').win, memory())
    expect(document.documentElement.dataset['reducedMotion']).toBe('false')
  })

  it('re-applies when the system reduced-motion setting changes (Review Focus 4)', () => {
    const { win, fire } = fakeWindow('', { matches: false })
    bootstrap(win, memory())
    expect(document.documentElement.dataset['reducedMotion']).toBe('false')
    fire(true)
    expect(document.documentElement.dataset['reducedMotion']).toBe('true')
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run apps/web/test/bootstrap.test.ts apps/web/test/art.test.ts`
Expected: FAIL — `../src/bootstrap` does not resolve; `disableArt` is not exported.

- [ ] **Step 3: Implement**

In `apps/web/src/game/art.ts`, replace the `isArtMissing` and `resetMissingArt` functions and add `disableArt`:

```ts
/** `?art=off` (UI overhaul U0): every card renders as its text card, with no `<img>` and so no request at all. */
let disabled = false

/** Turn art off for this page load. Used by `bootstrap` for `?art=off`, which the screenshot baselines rely on. */
export function disableArt(): void {
  disabled = true
}

/** True once this code's art is known absent, or art is off; `<Card>` then renders the text card without an `<img>`. */
export function isArtMissing(code: string): boolean {
  return disabled || missing.has(code)
}

/** Test seam — the cache and the off switch are module-global and would otherwise leak between cases. */
export function resetMissingArt(): void {
  missing.clear()
  disabled = false
}
```

Create `apps/web/src/bootstrap.ts`:

```ts
import { disableArt } from './game/art.js'
import { applySettings, loadSettings, type Settings, type SettingsStorage } from './settings.js'

/**
 * Page-load setup (UI overhaul U0): the URL's session-only flags, layered on the stored settings, published to CSS.
 *
 * Here and not in `App.tsx` on purpose (spec §10): these are facts about the PAGE, read once before React renders, and
 * the fixture page needs them too without mounting a game. Every flag is production-safe — a player who adds
 * `?motion=instant` gets exactly what it says — and, like `?seed=`, a malformed value warns and is ignored rather
 * than failing the page.
 */

export interface Flags {
  /** `?motion=instant`: Instant speed for this page load only. What the browser suite runs at (D24). */
  motionInstant: boolean
  /** `?art=off`: text cards only. What every screenshot baseline uses (D18). */
  artOff: boolean
  /** `?perf=1`: the frame and long-task overlay. */
  perf: boolean
}

const ACCEPTED = { motion: 'instant', art: 'off', perf: '1' } as const

export function parseFlags(search: string): Flags {
  const q = new URLSearchParams(search)
  const read = (name: keyof typeof ACCEPTED): boolean => {
    const raw = q.get(name)
    if (raw === null) return false
    if (raw === ACCEPTED[name]) return true
    console.warn(`Ignoring ?${name}=${raw}: the only accepted value is ${ACCEPTED[name]}.`)
    return false
  }
  return { motionInstant: read('motion'), artOff: read('art'), perf: read('perf') }
}

/** The settings this page runs with. The URL overrides; it never writes back (a flag is not a preference). */
export function effectiveSettings(stored: Settings, flags: Flags): Settings {
  return flags.motionInstant ? { ...stored, speed: 'instant' } : stored
}

export interface Boot { settings: Settings; flags: Flags }

const REDUCED_QUERY = '(prefers-reduced-motion: reduce)'

/**
 * Read the flags and the stored settings, apply them to `<html>`, and keep `data-reduced-motion` in step with the
 * system setting while the page is open. `storage` is a test seam; the page passes nothing and gets `localStorage`.
 */
export function bootstrap(win: Window = window, storage?: SettingsStorage | null): Boot {
  const flags = parseFlags(win.location.search)
  const settings = effectiveSettings(storage === undefined ? loadSettings() : loadSettings(storage), flags)
  if (flags.artOff) disableArt()
  // jsdom and some embedded engines have no matchMedia: treat the system as not asking for reduced motion.
  const media = typeof win.matchMedia === 'function' ? win.matchMedia(REDUCED_QUERY) : null
  const apply = (): void => { applySettings(settings, win.document.documentElement, media?.matches ?? false) }
  apply()
  media?.addEventListener('change', apply)
  return { settings, flags }
}
```

Modify `apps/web/src/main.tsx` — call the bootstrap before rendering:

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import { bootstrap } from './bootstrap.js'
import './styles.css'

// Before the first render: `?art=off` has to be in force before any <Card> mounts, and the CSS custom properties
// before the first paint.
bootstrap()

const root = document.getElementById('root')
if (!root) throw new Error('index.html is missing #root')
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm vitest run apps/web/test/bootstrap.test.ts apps/web/test/art.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/bootstrap.ts apps/web/src/game/art.ts apps/web/src/main.tsx apps/web/test/bootstrap.test.ts apps/web/test/art.test.ts
git commit -m "feat(web): ?motion=instant, ?art=off and ?perf=1 flags, applied before the first render (U0)"
```

---

### Task 3: the `?perf=1` overlay

**Files:**
- Create: `apps/web/src/dev/frameStats.ts`, `apps/web/src/dev/PerfOverlay.tsx`
- Modify: `apps/web/src/main.tsx` (render the overlay when `flags.perf`)
- Test: `apps/web/test/perf-overlay.test.tsx`

**Interfaces:**
- Consumes: `bootstrap()` → `Boot.flags.perf` (Task 2).
- Produces: `class FrameStats { constructor(windowSize?: number); frame(t: number): void; readonly maxGapMs: number; readonly fps: number }`,
  `PerfOverlay(): JSX.Element` (renders `.perf-overlay`, `aria-hidden`).

- [ ] **Step 1: Write the failing test** — `apps/web/test/perf-overlay.test.tsx`

```tsx
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { FrameStats } from '../src/dev/frameStats'
import { PerfOverlay } from '../src/dev/PerfOverlay'

describe('FrameStats', () => {
  it('reports nothing before two frames', () => {
    const s = new FrameStats()
    expect(s.maxGapMs).toBe(0)
    expect(s.fps).toBe(0)
    s.frame(0)
    expect(s.maxGapMs).toBe(0)
  })

  it('reports the largest gap and the mean rate', () => {
    const s = new FrameStats()
    for (const t of [0, 16, 32, 132, 148]) s.frame(t)
    expect(s.maxGapMs).toBe(100)
    expect(s.fps).toBeCloseTo(1000 / 37, 5)   // four gaps: 16, 16, 100, 16 → mean 37 ms
  })

  it('keeps only the most recent window of gaps', () => {
    const s = new FrameStats(2)
    for (const t of [0, 200, 216, 232]) s.frame(t)   // the 200 ms gap has left the window
    expect(s.maxGapMs).toBe(16)
  })
})

let root: Root | null = null
afterEach(() => { act(() => root?.unmount()); root = null; document.body.innerHTML = '' })

describe('PerfOverlay', () => {
  it('mounts without PerformanceObserver support and stays out of the accessibility tree', () => {
    const host = document.body.appendChild(document.createElement('div'))
    root = createRoot(host)
    act(() => root?.render(createElement(PerfOverlay)))
    const el = host.querySelector('.perf-overlay')
    expect(el).not.toBeNull()
    expect(el?.getAttribute('aria-hidden')).toBe('true')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run apps/web/test/perf-overlay.test.tsx`
Expected: FAIL — `../src/dev/frameStats` does not resolve.

- [ ] **Step 3: Implement**

`apps/web/src/dev/frameStats.ts`:

```ts
/**
 * Frame-gap statistics over a sliding window, for the `?perf=1` overlay (UI overhaul U0) and the performance budget in
 * spec §9: "no frame longer than 50 ms comes from the presentation layer". Pure, so it is testable without a browser.
 */
export class FrameStats {
  private last: number | null = null
  private readonly gaps: number[] = []

  constructor(private readonly windowSize = 300) {}

  /** Record one animation frame's timestamp (a `requestAnimationFrame` callback argument). */
  frame(t: number): void {
    if (this.last !== null) {
      this.gaps.push(t - this.last)
      if (this.gaps.length > this.windowSize) this.gaps.shift()
    }
    this.last = t
  }

  get maxGapMs(): number {
    return this.gaps.length === 0 ? 0 : Math.max(...this.gaps)
  }

  get fps(): number {
    if (this.gaps.length === 0) return 0
    const mean = this.gaps.reduce((a, b) => a + b, 0) / this.gaps.length
    return mean === 0 ? 0 : 1000 / mean
  }
}
```

`apps/web/src/dev/PerfOverlay.tsx`:

```tsx
import { useEffect, useState, type CSSProperties, type JSX } from 'react'
import { FrameStats } from './frameStats.js'

const BOX: CSSProperties = {
  position: 'fixed', top: 8, right: 8, zIndex: 2147483647, pointerEvents: 'none',
  font: '11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace', color: '#e9f0f4',
  background: 'rgb(8 11 15 / 82%)', border: '1px solid #3d5260', borderRadius: 6, padding: '4px 8px',
}

interface Reading { fps: number; maxGapMs: number; longTasks: number }

/**
 * `?perf=1`: frames per second, the worst frame gap in the last ~5 s, and the long tasks seen since load. A developer
 * aid for the motion rungs, never shown otherwise. Hidden from assistive technology, and it takes no pointer events,
 * so it can sit over the board without changing what a player or a test can reach.
 */
export function PerfOverlay(): JSX.Element {
  const [reading, setReading] = useState<Reading>({ fps: 0, maxGapMs: 0, longTasks: 0 })
  useEffect(() => {
    const stats = new FrameStats()
    let longTasks = 0
    let raf = 0
    const tick = (t: number): void => { stats.frame(t); raf = requestAnimationFrame(tick) }
    // jsdom without `pretendToBeVisual` has no requestAnimationFrame; the overlay then shows zeros instead of throwing.
    if (typeof requestAnimationFrame === 'function') raf = requestAnimationFrame(tick)
    // Long tasks are Chromium-only; elsewhere (and in jsdom) the count simply stays at 0.
    let observer: PerformanceObserver | null = null
    try {
      observer = new PerformanceObserver((list) => { longTasks += list.getEntries().length })
      observer.observe({ type: 'longtask', buffered: true })
    } catch { observer = null }
    // Twice a second, not per frame: the overlay must not become the thing it measures.
    const timer = setInterval(() => { setReading({ fps: stats.fps, maxGapMs: stats.maxGapMs, longTasks }) }, 500)
    return () => { if (raf) cancelAnimationFrame(raf); clearInterval(timer); observer?.disconnect() }
  }, [])
  return (
    <div className="perf-overlay" aria-hidden="true" style={BOX}>
      {reading.fps.toFixed(0)} fps · worst frame {reading.maxGapMs.toFixed(0)} ms · long tasks {reading.longTasks}
    </div>
  )
}
```

Modify `apps/web/src/main.tsx` — keep the `Boot` and render the overlay:

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import { bootstrap } from './bootstrap.js'
import { PerfOverlay } from './dev/PerfOverlay.js'
import './styles.css'

// Before the first render: `?art=off` has to be in force before any <Card> mounts, and the CSS custom properties
// before the first paint.
const boot = bootstrap()

const root = document.getElementById('root')
if (!root) throw new Error('index.html is missing #root')
createRoot(root).render(
  <StrictMode>
    <App />
    {boot.flags.perf && <PerfOverlay />}
  </StrictMode>,
)
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm vitest run apps/web/test/perf-overlay.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/dev/frameStats.ts apps/web/src/dev/PerfOverlay.tsx apps/web/src/main.tsx apps/web/test/perf-overlay.test.tsx
git commit -m "feat(web): the ?perf=1 frame and long-task overlay (U0)"
```

---

### Task 4: the fixture gallery

**Files:**
- Create: `apps/web/fixtures.html`, `apps/web/src/fixtures/main.tsx`, `apps/web/src/fixtures/cardFixtures.ts`,
  `apps/web/src/fixtures/Gallery.tsx`, `apps/web/src/fixtures/fixtures.css`
- Modify: `apps/web/vite.config.ts` (a second build entry)
- Test: `apps/web/test/fixtures.test.tsx`

**Interfaces:**
- Consumes: `bootstrap()` (Task 2); `Card`, `CardProps` from `apps/web/src/ui/Card.tsx`; `CARD_DEFS`, `DECK_CHOICES`
  from `apps/web/src/deck.ts`.
- Produces: `interface CardFixture { name: string; group: string; props: CardProps }`, `CARD_FIXTURES: readonly CardFixture[]`,
  `Gallery(): JSX.Element` rendering one `figure[data-fixture="<name>"]` per fixture. U1 extends `CARD_FIXTURES`.

- [ ] **Step 1: Write the failing test** — `apps/web/test/fixtures.test.tsx`

```tsx
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { CARD_FIXTURES } from '../src/fixtures/cardFixtures'
import { Gallery } from '../src/fixtures/Gallery'

let root: Root | null = null
afterEach(() => { act(() => root?.unmount()); root = null; document.body.innerHTML = '' })

describe('the fixture gallery', () => {
  it('names every fixture uniquely', () => {
    const names = CARD_FIXTURES.map((f) => f.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('covers each state the card can show today', () => {
    const has = (pred: (f: (typeof CARD_FIXTURES)[number]) => boolean): boolean => CARD_FIXTURES.some(pred)
    expect(has((f) => f.props.type === 'forward')).toBe(true)
    expect(has((f) => f.props.type === 'backup')).toBe(true)
    expect(has((f) => f.props.type === 'summon')).toBe(true)
    for (const size of ['hand', 'field', 'small', 'large'] as const) expect(has((f) => f.props.size === size), size).toBe(true)
    expect(has((f) => f.props.dull === true)).toBe(true)
    expect(has((f) => f.props.frozen === true)).toBe(true)
    expect(has((f) => (f.props.damage ?? 0) > 0)).toBe(true)
    expect(has((f) => f.props.actionable === true)).toBe(true)
    expect(has((f) => f.props.selected === true)).toBe(true)
    expect(has((f) => f.props.chosen === true)).toBe(true)
    expect(has((f) => f.props.faceDown === true)).toBe(true)
    for (const paying of ['dull', 'discard', 'flip'] as const) expect(has((f) => f.props.paying === paying), paying).toBe(true)
    for (const lb of ['down', 'up'] as const) expect(has((f) => f.props.lb === lb), lb).toBe(true)
  })

  it('renders one labelled figure per fixture, each holding a card', () => {
    const host = document.body.appendChild(document.createElement('div'))
    root = createRoot(host)
    act(() => root?.render(createElement(Gallery)))
    const figures = host.querySelectorAll('figure[data-fixture]')
    expect(figures.length).toBe(CARD_FIXTURES.length)
    for (const fig of figures) expect(fig.querySelector('.card'), fig.getAttribute('data-fixture') ?? '').not.toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run apps/web/test/fixtures.test.tsx`
Expected: FAIL — `../src/fixtures/cardFixtures` does not resolve.

- [ ] **Step 3: Implement**

`apps/web/src/fixtures/cardFixtures.ts`:

```ts
import type { CardDef } from '@fftcg/engine'
import { CARD_DEFS, DECK_CHOICES } from '../deck.js'
import type { CardProps } from '../ui/Card.js'

/**
 * Every visual state of `<Card>`, from real pool cards (UI overhaul U0, spec §10). The fixture page renders these and
 * its Playwright screenshot is the visual-regression surface for the card; U1 redesigns the card against it.
 *
 * Cards are picked by TYPE from the real pool, never by a hard-coded code, so a pool change cannot silently empty a
 * fixture — `def()` throws instead.
 */
export interface CardFixture { name: string; group: string; props: CardProps }

function def(pred: (d: CardDef) => boolean, what: string): CardDef {
  const d = CARD_DEFS.find(pred)
  if (!d) throw new Error(`fixture gallery: no card in the pool is ${what}`)
  return d
}

const inPool = new Set([...DECK_CHOICES.vol1.main, ...DECK_CHOICES.vol2.main])
const lbCodes = new Set([...DECK_CHOICES.vol1.lb, ...DECK_CHOICES.vol2.lb])

const forward = def((d) => inPool.has(d.code) && d.type === 'forward' && (d.power ?? 0) >= 7000, 'a forward of 7000+ power')
const backup = def((d) => inPool.has(d.code) && d.type === 'backup', 'a backup')
const summon = def((d) => inPool.has(d.code) && d.type === 'summon', 'a summon')
const lbCard = def((d) => lbCodes.has(d.code), 'an LB card')

function props(d: CardDef, extra: Partial<CardProps> = {}): CardProps {
  return {
    code: d.code, name: d.name, cost: d.cost, elements: [...d.elements], type: d.type,
    power: d.type === 'forward' ? d.power ?? 0 : null,
    ...(d.text === undefined ? {} : { text: d.text }),
    size: 'field',
    ...extra,
  }
}

export const CARD_FIXTURES: readonly CardFixture[] = [
  { group: 'Types and sizes', name: 'forward, field', props: props(forward) },
  { group: 'Types and sizes', name: 'forward, hand', props: props(forward, { size: 'hand' }) },
  { group: 'Types and sizes', name: 'forward, small', props: props(forward, { size: 'small' }) },
  { group: 'Types and sizes', name: 'forward, large', props: props(forward, { size: 'large' }) },
  { group: 'Types and sizes', name: 'backup, field', props: props(backup) },
  { group: 'Types and sizes', name: 'summon, hand', props: props(summon, { size: 'hand' }) },
  { group: 'Types and sizes', name: 'two elements (synthetic)', props: props(forward, { elements: ['earth', 'lightning'] }) },
  { group: 'Types and sizes', name: 'face down', props: props(forward, { faceDown: true }) },
  { group: 'Board state', name: 'forward, dull', props: props(forward, { dull: true }) },
  { group: 'Board state', name: 'backup, dull', props: props(backup, { dull: true }) },
  { group: 'Board state', name: 'frozen', props: props(forward, { frozen: true }) },
  { group: 'Board state', name: 'damaged', props: props(forward, { damage: 3000 }) },
  { group: 'Board state', name: 'buffed', props: props(forward, { power: (forward.power ?? 0) + 2000, powerBonus: 2000, granted: ['haste', 'brave'] }) },
  { group: 'Board state', name: 'cannot be broken', props: props(forward, { flags: ['cannotBeBroken'] }) },
  { group: 'Interaction', name: 'selectable', props: props(forward, { actionable: true }) },
  { group: 'Interaction', name: 'selected', props: props(forward, { selected: true }) },
  { group: 'Interaction', name: 'chosen for a set', props: props(forward, { chosen: true }) },
  { group: 'Payment', name: 'paying by dulling', props: props(backup, { paying: 'dull' }) },
  { group: 'Payment', name: 'paying by discarding', props: props(forward, { size: 'hand', paying: 'discard' }) },
  { group: 'Payment', name: 'paying by an LB flip', props: props(lbCard, { lb: 'down', paying: 'flip', size: 'small' }) },
  { group: 'Limit Break', name: 'LB face down', props: props(lbCard, { lb: 'down', size: 'small' }) },
  { group: 'Limit Break', name: 'LB spent', props: props(lbCard, { lb: 'up', size: 'small' }) },
]
```

`apps/web/src/fixtures/Gallery.tsx`:

```tsx
import type { JSX } from 'react'
import { Card } from '../ui/Card.js'
import { CARD_FIXTURES } from './cardFixtures.js'

/** The fixture page body: every `CARD_FIXTURES` entry, grouped, each in a `figure[data-fixture]` a test can select. */
export function Gallery(): JSX.Element {
  const groups = [...new Set(CARD_FIXTURES.map((f) => f.group))]
  return (
    <main className="gallery">
      <h1>Card fixtures</h1>
      {groups.map((g) => (
        <section key={g} className="gallery__group">
          <h2>{g}</h2>
          <div className="gallery__row">
            {CARD_FIXTURES.filter((f) => f.group === g).map((f) => (
              <figure key={f.name} className="gallery__item" data-fixture={f.name}>
                <Card {...f.props} />
                <figcaption>{f.name}</figcaption>
              </figure>
            ))}
          </div>
        </section>
      ))}
    </main>
  )
}
```

`apps/web/src/fixtures/fixtures.css`:

```css
/* The game's stylesheet pins html/body/#root to the viewport for the board; the gallery is a long, scrolling page. */
html, body, #root { height: auto; min-height: 100%; }
body { overflow: auto; }
.gallery { padding: 24px 32px 64px; color: var(--ink); font-family: var(--font-ui); }
.gallery h1 { font-family: var(--font-condensed); letter-spacing: 0.08em; text-transform: uppercase; }
.gallery h2 { font-family: var(--font-condensed); font-size: 14px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--ink-2); margin: 28px 0 12px; }
.gallery__row { display: flex; flex-wrap: wrap; gap: 28px; align-items: flex-end; }
.gallery__item { margin: 0; display: grid; justify-items: center; gap: 8px; }
.gallery__item figcaption { font-size: 12px; color: var(--ink-3); }
```

`apps/web/src/fixtures/main.tsx`:

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { bootstrap } from '../bootstrap.js'
import { Gallery } from './Gallery.js'
import '../styles.css'
import './fixtures.css'

// The same page-load setup as the game, so `?art=off&motion=instant` means the same thing here.
bootstrap()

const root = document.getElementById('root')
if (!root) throw new Error('fixtures.html is missing #root')
createRoot(root).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
)
```

`apps/web/fixtures.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <title>FFTCG — card fixtures</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/fixtures/main.tsx"></script>
  </body>
</html>
```

Modify `apps/web/vite.config.ts` — replace `build: { target: 'es2022' },` with:

```ts
  // Two pages: the game, and the card fixture gallery (UI overhaul U0) that the screenshot baseline renders.
  build: {
    target: 'es2022',
    rollupOptions: { input: { main: fileURLToPath(new URL('./index.html', import.meta.url)), fixtures: fileURLToPath(new URL('./fixtures.html', import.meta.url)) } },
  },
```

and add `import { fileURLToPath } from 'node:url'` to its imports.

- [ ] **Step 4: Run it to verify it passes, and that the production build emits both pages**

Run: `pnpm vitest run apps/web/test/fixtures.test.tsx`
Expected: PASS (3 tests).

Run: `pnpm --filter @fftcg/web build && ls apps/web/dist/*.html`
Expected: `apps/web/dist/fixtures.html` and `apps/web/dist/index.html`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/fixtures.html apps/web/src/fixtures apps/web/vite.config.ts apps/web/test/fixtures.test.tsx
git commit -m "feat(web): the card fixture gallery, a second Vite entry (U0)"
```

---

### Task 5: the browser suite at Instant, the harness checks, and the gallery baseline

**Files:**
- Modify: `playwright.config.ts` (storageState gains `fftcg.settings` = Instant)
- Modify: `apps/web/e2e/how-to-play.spec.ts` (its empty storage drops the setting, so its gotos add `&motion=instant`,
  or `?motion=instant` for the bare `/`)
- Create: `apps/web/e2e/harness.spec.ts`, `apps/web/e2e/fixtures.spec.ts` and its committed baseline
  `apps/web/e2e/fixtures.spec.ts-snapshots/card-gallery-*.png`

**Interfaces:**
- Consumes: the flags (Task 2), `.perf-overlay` (Task 3), `fixtures.html` and `figure[data-fixture]` (Task 4).

- [ ] **Step 1: Write the browser checks**

`apps/web/e2e/harness.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test'

/**
 * UI overhaul U0 — the page-load switches, proved in a real browser: the CSS custom property the motion rungs read,
 * the session-only override, and `?art=off` making no request at all.
 */
const motionScale = (page: Page): Promise<string> =>
  page.evaluate(() => document.documentElement.style.getPropertyValue('--motion-scale'))

test('the suite runs at Instant through the configured storage state', async ({ page }) => {
  await page.goto('/?seed=1&decks=vol2,vol2')
  expect(await motionScale(page)).toBe('0')
  await expect(page.locator('html')).toHaveAttribute('data-speed', 'instant')
})

test.describe('with nothing stored', () => {
  test.use({ storageState: { cookies: [], origins: [{ origin: 'http://localhost:5199', localStorage: [{ name: 'fftcg.howToPlay.seen', value: '1' }] }] } })

  test('the default is Normal', async ({ page }) => {
    await page.goto('/?seed=1&decks=vol2,vol2')
    expect(await motionScale(page)).toBe('1')
  })

  test('?motion=instant applies to this page only and is never saved', async ({ page }) => {
    await page.goto('/?seed=1&decks=vol2,vol2&motion=instant')
    expect(await motionScale(page)).toBe('0')
    expect(await page.evaluate(() => localStorage.getItem('fftcg.settings'))).toBeNull()
  })

  test('a malformed flag is ignored with a warning (Review Focus 3)', async ({ page }) => {
    const warnings: string[] = []
    page.on('console', (m) => { if (m.type() === 'warning') warnings.push(m.text()) })
    await page.goto('/?seed=1&decks=vol2,vol2&motion=slow')
    expect(await motionScale(page)).toBe('1')
    expect(warnings.some((w) => w.includes('?motion=slow'))).toBe(true)
  })
})

test('?art=off renders text cards and requests no art at all (Review Focus 5)', async ({ page }) => {
  const artRequests: string[] = []
  page.on('request', (r) => { if (new URL(r.url()).pathname.startsWith('/cards/')) artRequests.push(r.url()) })
  // Seed 1 hands the human the first decision; both LB decks are face-up cards on the board from the start.
  await page.goto('/?seed=1&decks=vol2,vol2&art=off')
  await expect(page.locator('.card').first()).toBeVisible()
  await expect(page.locator('img.card__img')).toHaveCount(0)
  expect(artRequests).toEqual([])
})

test('?perf=1 shows the overlay, out of the accessibility tree', async ({ page }) => {
  await page.goto('/?seed=1&decks=vol2,vol2&perf=1')
  const overlay = page.locator('.perf-overlay')
  await expect(overlay).toBeVisible()
  await expect(overlay).toHaveAttribute('aria-hidden', 'true')
})
```

`apps/web/e2e/fixtures.spec.ts`:

```ts
import { expect, test } from '@playwright/test'

/**
 * The card fixture gallery's screenshot baseline (UI overhaul D18): the only committed screenshot in the suite.
 * Art off and Instant, so the image depends on nothing git-ignored and on no timing. Re-baseline deliberately, with
 * `pnpm test:browser fixtures --update-snapshots`, when a rung changes the card on purpose (U1 will).
 */
test('the card fixture gallery matches its baseline', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/fixtures.html?art=off&motion=instant')
  await expect(page.locator('figure[data-fixture]').first()).toBeVisible()
  await expect(page).toHaveScreenshot('card-gallery.png', { fullPage: true })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm test:browser harness fixtures`
Expected: FAIL — `the suite runs at Instant…` reads `'1'` (the storage state has no settings yet), and the gallery test
fails with "A snapshot doesn't exist … writing actual".

- [ ] **Step 3: Configure Instant for the suite**

In `playwright.config.ts`, the `storageState` origin's `localStorage` becomes:

```ts
      origins: [{ origin: 'http://localhost:5199', localStorage: [
        { name: 'fftcg.howToPlay.seen', value: '1' },
        // UI overhaul D24: the suite plays at Instant, where the presentation drains synchronously and no timer can
        // race the driver. `how-to-play.spec.ts` replaces this whole state, so its URLs carry `motion=instant`.
        { name: 'fftcg.settings', value: JSON.stringify({ speed: 'instant' }) },
      ] }],
```

In `apps/web/e2e/how-to-play.spec.ts`, change its three gotos:
`'/?seed=1&decks=vol2,vol2'` → `'/?seed=1&decks=vol2,vol2&motion=instant'`, `'/'` → `'/?motion=instant'`,
`'/?seed=21&decks=vol2,vol2'` → `'/?seed=21&decks=vol2,vol2&motion=instant'`.

- [ ] **Step 4: Write the gallery baseline, then run the whole browser suite**

Run: `pnpm test:browser fixtures --update-snapshots`
Expected: writes `apps/web/e2e/fixtures.spec.ts-snapshots/card-gallery-<platform>.png`. Open it and check every
fixture shows as a text card with its caption.

Run: `pnpm test:browser`
Expected: every spec passes, including the pre-existing ones unchanged apart from how-to-play's URLs.

- [ ] **Step 5: Commit**

```bash
git add playwright.config.ts apps/web/e2e/how-to-play.spec.ts apps/web/e2e/harness.spec.ts apps/web/e2e/fixtures.spec.ts apps/web/e2e/fixtures.spec.ts-snapshots
git commit -m "test(web): the browser suite at Instant; harness checks; the fixture gallery baseline (U0)"
```

---

### Task 6: the recorded baseline of today's UI

**Files:**
- Modify: `apps/web/e2e/drive.ts` (`playToTheEnd` gains an optional `until` predicate; existing callers unchanged)
- Create: `apps/web/e2e/baseline.spec.ts` (skipped unless `FFTCG_BASELINE=1`)
- Create: `docs/superpowers/measurements/u0/README.md`, `perf-baseline.json`, `board-1280x720.png`,
  `board-1440x900.png`, `board-1920x1080.png`

**Interfaces:**
- Produces: `playToTheEnd(page: Page, budgetMs?: number, until?: () => Promise<boolean>): Promise<void>` — returns when
  `until()` resolves true, as well as at game over. Later rungs re-run this spec to compare against U0.

- [ ] **Step 1: Extend the driver** — in `apps/web/e2e/drive.ts`, change the signature and the loop head:

```ts
export async function playToTheEnd(page: Page, budgetMs = 120_000, until?: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + budgetMs
  while (Date.now() < deadline) {
    if (await page.locator('dialog.banner').count() > 0) return
    // A caller that wants a mid-game position (the U0 baseline screenshots) stops here instead of at game over.
    if (until && await until()) return
```

(The rest of the function is unchanged.)

- [ ] **Step 2: Write the measurement spec** — `apps/web/e2e/baseline.spec.ts`

```ts
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { playToTheEnd } from './drive'

/**
 * UI overhaul U0 — a recorded baseline of today's UI, for the later rungs to compare against. NOT a regression test:
 * the AI's search is time-boxed, so the positions differ run to run. Skipped unless asked for:
 *
 *   FFTCG_BASELINE=1 pnpm test:browser baseline
 *
 * Writes into docs/superpowers/measurements/u0/. Art off, so nothing git-ignored reaches a committed image.
 */
const OUT = fileURLToPath(new URL('../../../docs/superpowers/measurements/u0/', import.meta.url))
const ROUTE = '/?seed=1&decks=vol2,vol2&art=off'

test.skip(!process.env['FFTCG_BASELINE'], 'set FFTCG_BASELINE=1 to re-measure the U0 baseline')

test('screenshots of the board at turn 3, three desktop sizes', async ({ page }) => {
  test.setTimeout(240_000)
  mkdirSync(OUT, { recursive: true })
  for (const [w, h] of [[1280, 720], [1440, 900], [1920, 1080]] as const) {
    await page.setViewportSize({ width: w, height: h })
    await page.goto(ROUTE)
    // textContent, not innerText: the prompt is styled uppercase, and innerText applies text-transform ("TURN 3").
    await playToTheEnd(page, 90_000, async () => /Turn 3\b/.test((await page.locator('.prompt').textContent().catch(() => '')) ?? ''))
    await page.screenshot({ path: `${OUT}board-${w}x${h}.png` })
  }
})

test('a full game at 4× CPU throttling: frame gaps and long tasks', async ({ page }) => {
  test.setTimeout(420_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.addInitScript(() => {
    const perf = { gaps: [] as number[], longTasks: [] as number[] }
    ;(window as unknown as { __perf: typeof perf }).__perf = perf
    let last: number | null = null
    const tick = (t: number): void => { if (last !== null) perf.gaps.push(t - last); last = t; requestAnimationFrame(tick) }
    requestAnimationFrame(tick)
    try {
      new PerformanceObserver((l) => { for (const e of l.getEntries()) perf.longTasks.push(e.duration) }).observe({ type: 'longtask', buffered: true })
    } catch { /* not Chromium */ }
  })
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  const started = Date.now()
  await page.goto(ROUTE)
  await playToTheEnd(page, 360_000)
  const gameMs = Date.now() - started
  const raw = await page.evaluate(() => (window as unknown as { __perf: { gaps: number[]; longTasks: number[] } }).__perf)
  const sorted = [...raw.gaps].sort((a, b) => a - b)
  const at = (q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0
  const result = {
    measured: new Date().toISOString(), route: ROUTE, viewport: '1440x900', cpuThrottle: 4, gameMs,
    frames: raw.gaps.length,
    frameGapMs: { p50: at(0.5), p95: at(0.95), p99: at(0.99), max: sorted.at(-1) ?? 0 },
    longTasks: { count: raw.longTasks.length, maxMs: Math.max(0, ...raw.longTasks), totalMs: raw.longTasks.reduce((a, b) => a + b, 0) },
  }
  mkdirSync(OUT, { recursive: true })
  writeFileSync(`${OUT}perf-baseline.json`, `${JSON.stringify(result, null, 2)}\n`)
  expect(result.frames).toBeGreaterThan(0)
})
```

- [ ] **Step 3: Run it and check it records**

Run: `FFTCG_BASELINE=1 pnpm test:browser baseline`
Expected: 2 passed; three PNGs and `perf-baseline.json` in `docs/superpowers/measurements/u0/`. Open the PNGs: the
board at turn 3 with text cards only.

Run: `pnpm test:browser baseline`
Expected: 2 skipped.

- [ ] **Step 4: Write the README** — `docs/superpowers/measurements/u0/README.md`: what was measured, the command,
the date, the machine (`sysctl -n machdep.cpu.brand_string`), the four numbers from `perf-baseline.json` (frame gap
p95/p99/max and long-task count) quoted with their units, and one sentence per screenshot on what today's layout
gets wrong at that size (the seat halves scrolling, the LB rows, card sizes) — the facts U2's acceptance (UO-A1)
is measured against.

- [ ] **Step 5: Commit**

```bash
git add apps/web/e2e/drive.ts apps/web/e2e/baseline.spec.ts docs/superpowers/measurements/u0
git commit -m "test(web): the U0 baseline — board screenshots and a throttled full-game trace"
```

---

### Task 7: as-built note and the full gate

**Files:**
- Modify: `docs/superpowers/specs/2026-09-30-ui-overhaul-design.md` (an `## As built` section with a U0 entry)

- [ ] **Step 1:** Add, after §14 and before `## Questions for your review`:

```markdown
## As built

- **U0** (branch `feat/u0-harness`): `settings.ts`, `bootstrap.ts` (wired from `main.tsx`), `?motion=instant`,
  `?art=off`, `?perf=1`, the fixture gallery (`fixtures.html`) with its baseline, the browser suite at Instant, and the
  recorded baseline in `docs/superpowers/measurements/u0/` (<the four numbers>). <Any deviation from this plan, with
  its reason.>
```

- [ ] **Step 2:** Run the gate: `pnpm typecheck && pnpm lint && pnpm test && pnpm test:browser`. Expected: all green.
- [ ] **Step 3:** Commit: `git add docs/superpowers/specs/2026-09-30-ui-overhaul-design.md && git commit -m "docs: U0 as built"`.
