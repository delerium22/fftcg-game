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
  it('scales Normal 1, Fast 0.6, Instant 0 (spec section 8)', () => {
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
