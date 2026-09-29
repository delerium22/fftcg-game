/**
 * The player's presentation settings (UI overhaul spec section 8, D9): animation speed, reduced motion, effects, and
 * skip on click. Per-browser conveniences, so they live in `localStorage` — and every access is guarded, because a
 * private window or blocked site data makes the accessor itself throw, and a settings failure must never stop the game.
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

/** Every duration token is multiplied by this (spec section 7): Instant is 0, and U3's director drains synchronously at 0. */
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
