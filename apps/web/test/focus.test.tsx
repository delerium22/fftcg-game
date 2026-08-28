import { act, createElement, type JSX } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { applyChooseFirst, createGame, viewFor, type PlayerView } from '@fftcg/engine'
import { CARD_DEFS, DECKS } from '../src/deck.js'
import { PromptStrip } from '../src/ui/PromptStrip.js'
import { AI, HUMAN, type Choice, type ChoiceSet } from '../src/game/types.js'

/**
 * Keyboard play, found by playing with the keyboard.
 *
 * Every control the strip offers is replaced when the prompt changes, so the button just pressed is unmounted
 * and the browser drops focus to `document.body`. Invisible with a mouse; with a keyboard it means tabbing in
 * from the top of the document after every AI turn, past the entire board and log.
 *
 * These drive the REAL lifecycle — focus an action, hand the turn to the AI so the action unmounts, then hand
 * it back — rather than calling `blur()` to manufacture the end state. The first version did the latter, and
 * Codex showed why that is not the same test: it forces the implementation towards inferring "focus was lost"
 * from `body` being active, and hides the case where React reuses the focused button's DOM node so focus
 * never touches `body` at all.
 */

let root: Root | null = null
let host: HTMLDivElement | null = null

afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
  root = null; host = null
})

const base = (): PlayerView => {
  const s = createGame({ seed: 1, decks: DECKS, defs: CARD_DEFS })
  const chooser = s.pending?.kind === 'chooseFirst' ? s.pending.player : HUMAN
  return viewFor(applyChooseFirst(s, chooser, chooser === HUMAN)[0], HUMAN)
}
/** Whose decision the strip thinks it is — `yours` is what gates every action it renders. */
const seat = (v: PlayerView, p: 0 | 1): PlayerView => ({ ...v, pending: null, priority: p, result: null })

const choice = (label: string, type: 'pass' | 'concede' | 'castCharacter'): Choice =>
  ({ label, card: null, command: { type, player: HUMAN, ...(type === 'castCharacter' ? { card: 1, payment: { dullBackups: [], discards: [] } } : {}) } as Choice['command'] })

const emptySet = (): ChoiceSet => ({ all: [], byCard: new Map(), loose: [], prompt: 'Main Phase 1 — cast, attack, or pass' })

function render(shown: Choice[], who: 0 | 1 = HUMAN): void {
  const v = seat(base(), who)
  const el = (): JSX.Element => createElement(PromptStrip, {
    view: v, choices: emptySet(), shown: who === HUMAN ? shown : [], aiThinking: who !== HUMAN, onChoose: () => {},
  })
  if (!root) {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  }
  act(() => { root!.render(el()) })
}

const focusedText = (): string => (document.activeElement as HTMLElement | null)?.textContent ?? ''
const focusAction = (label: string): void => {
  const btn = [...document.querySelectorAll<HTMLButtonElement>('.prompt__actions button')].find((b) => b.textContent === label)
  expect(btn, `no action labelled "${label}" to focus`).toBeDefined()
  btn!.focus()
}

describe('the keyboard keeps its place across a prompt change', () => {
  it('restores focus after the AI takes the turn and hands it back', () => {
    render([choice('Pass', 'pass'), choice('Concede', 'concede')])
    focusAction('Pass')
    // The AI's turn: the strip renders no actions, so the focused button unmounts and the browser drops focus.
    render([], AI)
    expect(document.activeElement, 'the fixture did not reproduce the dropped focus').toBe(document.body)

    render([choice('Attack with Cloud', 'castCharacter'), choice('Pass', 'pass'), choice('Concede', 'concede')])
    expect(focusedText(), 'the player was left tabbing in from the top of the document').toBe('Attack with Cloud')
  })

  it('does NOT grab focus on first mount, before the player has touched anything', () => {
    // Restoration follows the player's own activation; seizing focus on arrival is an unrequested context
    // change (WCAG 3.2.5), and the first version did exactly that because it read `body` as "lost".
    render([choice('Pass', 'pass'), choice('Concede', 'concede')])
    expect(document.activeElement, 'focus was taken before the player asked for it').toBe(document.body)
  })

  it('does NOT take focus away from somewhere the player put it', () => {
    render([choice('Pass', 'pass'), choice('Concede', 'concede')])
    focusAction('Pass')
    const elsewhere = document.createElement('button')
    elsewhere.textContent = 'the log'
    document.body.appendChild(elsewhere)
    elsewhere.focus()

    render([choice('Attack with Cloud', 'castCharacter'), choice('Pass', 'pass'), choice('Concede', 'concede')])
    expect(document.activeElement, 'focus was yanked out from under the player').toBe(elsewhere)
    elsewhere.remove()
  })

  it('never leaves focus on Concede, even when React could reuse the button', () => {
    // The dangerous one. With positional keys React reused the focused button's DOM NODE, so a prompt whose
    // only action is Concede INHERITED the focus that was on Pass — without focus ever touching `body`, so no
    // guard saw it, and the next Enter would concede the game. Semantic keys are what stop the reuse.
    render([choice('Pass', 'pass'), choice('Concede', 'concede')])
    focusAction('Pass')
    render([choice('Concede', 'concede')])
    const active = document.activeElement as HTMLElement | null
    expect(active?.getAttribute('data-command'), 'focus is sitting on Concede — the next Enter loses the game').not.toBe('concede')
  })
})
