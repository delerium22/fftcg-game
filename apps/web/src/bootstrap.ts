import { disableArt } from './game/art.js'
import { applySettings, loadSettings, type Settings, type SettingsStorage } from './settings.js'

/**
 * Page-load setup (UI overhaul U0): the URL's session-only flags, layered on the stored settings, published to CSS.
 *
 * Here and not in `App.tsx` on purpose (spec section 10): these are facts about the PAGE, read once before React
 * renders, and the fixture page needs them too without mounting a game. Every flag is production-safe — a player who
 * adds `?motion=instant` gets exactly what it says — and, like `?seed=`, a malformed value warns and is ignored rather
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
