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
