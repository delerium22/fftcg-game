import { act, createElement, type JSX } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { legalCommands, viewFor } from '@fftcg/engine'
import { PromptStrip } from '../src/ui/PromptStrip.js'
import { buildChoiceSet } from '../src/game/commands.js'
import { HUMAN } from '../src/game/types.js'
import { makeGame } from '../../../packages/engine/test/helpers.js'

/** Rung K5-A3 (was K4-A3): the full-control toggle on the strip. */
describe('the full-control toggle on the strip (K5-A3)', () => {
  function mount(fullControl: boolean, onFullControl?: (on: boolean) => void, tray?: JSX.Element): { host: HTMLElement; unmount: () => void } {
    const s = makeGame()
    const view = viewFor(s, HUMAN)
    const choices = buildChoiceSet(view, legalCommands(s, HUMAN))
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    act(() => {
      root.render(createElement(PromptStrip, { view, choices, shown: choices.loose, aiThinking: false, onChoose: () => {}, fullControl, onFullControl, ...(tray ? { tray } : {}) }))
    })
    return { host, unmount: () => { act(() => { root.unmount() }); host.remove() } }
  }
  it('renders pressed state, flips through its handler, and is absent without one', () => {
    const onFullControl = vi.fn()
    const { host, unmount } = mount(false, onFullControl)
    const toggle = host.querySelector<HTMLButtonElement>('[data-toggle="full-control"]')!
    expect(toggle).not.toBeNull()
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    expect(toggle.textContent).toBe('Full control: off')
    expect(toggle.hasAttribute('data-command'), 'not one of the position’s answers').toBe(false)
    act(() => { toggle.click() })
    expect(onFullControl).toHaveBeenCalledWith(true)
    unmount()
    const on = mount(true, onFullControl)
    expect(on.host.querySelector('[data-toggle="full-control"]')?.getAttribute('aria-pressed')).toBe('true')
    expect(on.host.querySelector('[data-toggle="full-control"]')?.textContent).toBe('Full control: on')
    on.unmount()
    const none = mount(false)
    expect(none.host.querySelector('[data-toggle="full-control"]')).toBeNull()
    none.unmount()
    // Not beside a tray's own "Auto": the tray replaces the strip while a payment or a set is being built.
    const withTray = mount(false, onFullControl, createElement('div', { 'data-payment-tray': true }, 'tray'))
    expect(withTray.host.querySelector('[data-toggle="full-control"]')).toBeNull()
    withTray.unmount()
  })
})
