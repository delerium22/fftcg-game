import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createGame, viewFor } from '@fftcg/engine'
import { CARD_DEFS, DECKS } from '../src/deck.js'
import { Board } from '../src/ui/Board.js'
import { HowToPlay } from '../src/ui/HowToPlay.js'
import { INTRO_SEEN_KEY, hasSeenIntro, markIntroSeen } from '../src/game/intro.js'
import { buildChoiceSet } from '../src/game/commands.js'
import { HUMAN, type Choice, type GameApi } from '../src/game/types.js'

/**
 * Rung H1 — the game explains itself before the first decision.
 *
 * This jsdom implements neither `showModal` nor `inert`, so modality, Tab containment and "the board is not
 * clickable through the sheet" are proved in `e2e/how-to-play.spec.ts`. What can honestly be checked here:
 * the lifecycle CALLS `showModal`, focus lands on the heading, both ways out call `onClose`, the rail button
 * exists only when the board is given something to open, and the storage helpers survive a browser that
 * throws on `localStorage`.
 */

Element.prototype.scrollIntoView = function scrollIntoView() {}

let root: Root | null = null
let host: HTMLDivElement | null = null
afterEach(() => { act(() => { root?.unmount() }); host?.remove(); root = null; host = null })

/**
 * This jsdom has the `Storage` class but NO `localStorage` global — measured, and the reason the first run of
 * this file failed on `localStorage.clear`. So each test installs its own in-memory store, and one test
 * removes it again to prove the helpers survive the global being absent, which is exactly what this
 * environment does to production code.
 */
function installStorage(behaviour: 'memory' | 'throwing' | 'absent'): void {
  if (behaviour === 'absent') { delete (globalThis as { localStorage?: unknown }).localStorage; return }
  const data = new Map<string, string>()
  const boom = (): never => { throw new Error('SecurityError: storage disabled') }
  const store = behaviour === 'throwing'
    ? { getItem: boom, setItem: boom, removeItem: boom, clear: boom }
    : {
        getItem: (k: string) => data.get(k) ?? null,
        setItem: (k: string, v: string) => { data.set(k, String(v)) },
        removeItem: (k: string) => { data.delete(k) },
        clear: () => { data.clear() },
      }
  Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true, writable: true })
}
beforeEach(() => { installStorage('memory') })
afterEach(() => { installStorage('absent') })

function mount(el: React.ReactElement): void {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  act(() => { root!.render(el) })
}

/** Runs `fn` with `HTMLDialogElement.prototype.showModal` replaced by a spy, restoring it UNCONDITIONALLY. */
function withShowModalSpy(fn: (calls: string[]) => void): void {
  const calls: string[] = []
  const proto = window.HTMLDialogElement?.prototype as { showModal?: () => void } | undefined
  const original = proto === undefined ? undefined : Object.getOwnPropertyDescriptor(proto, 'showModal')
  if (proto) proto.showModal = function spy() { calls.push('showModal') }
  try { fn(calls) } finally {
    if (proto) {
      if (original) Object.defineProperty(proto, 'showModal', original)
      else delete proto.showModal
    }
  }
}

describe('the intro flag (H1-D2)', () => {
  it('is unseen on a fresh browser, and seen once marked', () => {
    expect(hasSeenIntro()).toBe(false)
    markIntroSeen()
    expect(hasSeenIntro()).toBe(true)
    expect(localStorage.getItem(INTRO_SEEN_KEY)).toBe('1')
  })

  it('treats a browser that throws on storage as unseen, without throwing', () => {
    installStorage('throwing')
    expect(() => markIntroSeen()).not.toThrow()
    expect(hasSeenIntro()).toBe(false)
  })

  it('treats a browser with NO localStorage global the same way', () => {
    installStorage('absent')
    expect(() => markIntroSeen()).not.toThrow()
    expect(hasSeenIntro()).toBe(false)
  })
})

describe('the How to play dialog (H1-A3)', () => {
  it('opens modally, is a labelled dialog, and puts focus on its heading', () => {
    withShowModalSpy((calls) => {
      mount(createElement(HowToPlay, { onClose: () => {} }))
      expect(calls, 'the dialog was rendered but never opened modally').toEqual(['showModal'])
    })
    const dialog = document.querySelector('dialog')!
    expect(dialog.getAttribute('role')).toBe('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    const heading = document.getElementById(dialog.getAttribute('aria-labelledby')!)!
    expect(heading.textContent).toBe('How to play')
    expect(document.activeElement, 'focus did not land on the title').toBe(heading)
  })

  it('closes on Play, and marks the intro seen', () => {
    let closed = 0
    mount(createElement(HowToPlay, { onClose: () => { closed++ } }))
    act(() => { [...document.querySelectorAll('dialog button')].find((b) => b.textContent === 'Play')!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(closed).toBe(1)
    expect(hasSeenIntro()).toBe(true)
  })

  it('closes on Escape — unlike game over, there is a board to return to', () => {
    let closed = 0
    mount(createElement(HowToPlay, { onClose: () => { closed++ } }))
    // Escape on a modal dialog fires `cancel`; React's `onCancel` is the hook. Dispatching the event is what
    // jsdom can do; that Escape produces it is the platform's job and the browser test's.
    act(() => { document.querySelector('dialog')!.dispatchEvent(new Event('cancel', { bubbles: false, cancelable: true })) })
    expect(closed).toBe(1)
  })

  it('names the goal, CP, and that highlighted cards are clickable', () => {
    mount(createElement(HowToPlay, { onClose: () => {} }))
    const text = document.querySelector('dialog')!.textContent ?? ''
    expect(text).toMatch(/7 damage|seven damage/i)
    expect(text).toMatch(/\bCP\b/)
    expect(text).toMatch(/highlighted card/i)
  })
})

describe('the rail button (H1-D3)', () => {
  function api(): GameApi {
    const v = viewFor(createGame({ seed: 1, decks: DECKS, defs: CARD_DEFS }), HUMAN)
    return { view: v, choices: buildChoiceSet(v, []), log: [], aiThinking: false, choose: (_c: Choice) => {}, restart: () => {} }
  }
  const helpButton = (): HTMLButtonElement | undefined =>
    [...document.querySelectorAll<HTMLButtonElement>('.table__rail button')].find((b) => b.textContent === 'How to play')

  it('is absent when the board is given nothing to open — so no existing test moves', () => {
    mount(createElement(Board, { game: api() }))
    expect(helpButton()).toBeUndefined()
  })

  it('opens the sheet when given onHelp', () => {
    let opened = 0
    mount(createElement(Board, { game: api(), onHelp: () => { opened++ } }))
    const btn = helpButton()
    expect(btn, 'no "How to play" button in the rail').toBeDefined()
    act(() => { btn!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(opened).toBe(1)
  })
})
