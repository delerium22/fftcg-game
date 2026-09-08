import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import {
  actingPlayer, apply, createGame, forcedPass, isResponseWindow, legalCommands, viewFor,
  type Command, type GameState, type PlayerView,
} from '@fftcg/engine'
import { GreedyAgent } from '@fftcg/ai'
import { CARD_DEFS, DECKS } from '../src/deck.js'
import { Board } from '../src/ui/Board.js'
import { buildChoiceSet, paymentAlternatives, preferredChoices, promptFor, stackItemLabel } from '../src/game/commands.js'
import { stepAi } from '../src/game/useGame.js'
import { HUMAN, type Choice, type ChoiceSet, type GameApi } from '../src/game/types.js'

/**
 * Rung J1-A12 (D15) — a window with a real answer shows the STACK ROW, and the prompt names the item on top.
 *
 * Found by playing, not by the audit: with a Summon of yours declared and waiting, the strip said "Main Phase 1
 * — cast, use an ability, or pass" and nothing on the table showed that Ramuh existed, so a Pass looked like
 * the end of the phase rather than the moment Ramuh resolves. The row is the stack (§7.12.2: public), bottom
 * to top, with the top marked as what resolves next.
 */

// jsdom draws nothing, so the log's scroll-to-end is a no-op here (as in card-sheet.test.tsx).
Element.prototype.scrollIntoView = function scrollIntoView() {}

let root: Root | null = null
let host: HTMLDivElement | null = null
afterEach(() => { act(() => { root?.unmount() }); host?.remove(); root = null; host = null })

function mount(s: GameState): { view: PlayerView; choices: ChoiceSet; chosen: Choice[] } {
  const view = viewFor(s, HUMAN)
  const legal = legalCommands(s, HUMAN)
  const choices = buildChoiceSet(view, preferredChoices(view, legal), paymentAlternatives(legal))
  const chosen: Choice[] = []
  const api: GameApi = { view, choices, log: [], aiThinking: false, choose: (c) => { chosen.push(c) }, restart: () => {} }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root!.render(createElement(Board, { game: api })) })
  return { view, choices, chosen }
}

const row = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-stack-row]')

/**
 * A position where the HUMAN holds priority with their own Summon declared and waiting on the stack — a real
 * window (they may cast another, or pass to let it resolve). Reached by playing: the first seed whose first
 * Main Phase 1 offers a Summon; its prompts are answered with the first legal answer.
 */
function summonWaiting(): GameState | null {
  for (let seed = 1; seed < 60; seed++) {
    const agent = new GreedyAgent({ seed, decks: DECKS, depth: 1 })
    let s: GameState = createGame({ seed, decks: DECKS, defs: CARD_DEFS })
    for (let i = 0; i < 80 && !s.result; i++) {
      const p = actingPlayer(s)
      if (p === null) break
      if (p !== HUMAN) { s = stepAi(s, agent).state; continue }
      if (s.phase === 'main1' && s.turnPlayer === HUMAN && !s.pending) {
        const summon = legalCommands(s, HUMAN).find((c) => c.type === 'castSummon')
        if (!summon) break
        let t = apply(s, summon).state
        for (let j = 0; j < 6 && t.pending && actingPlayer(t) === HUMAN; j++) {
          const answer = legalCommands(t, HUMAN).find((c) => c.type !== 'concede') as Command
          t = apply(t, answer).state
        }
        if (!t.pending && t.stack.length > 0 && actingPlayer(t) === HUMAN && isResponseWindow(t)) return t
        break
      }
      const next = legalCommands(s, HUMAN).find((c) => c.type === 'mulligan' && !c.redraw) ?? legalCommands(s, HUMAN).find((c) => c.type !== 'concede')
      if (!next) break
      s = apply(s, next).state
    }
  }
  return null
}

describe('J1-A12 — the stack row', () => {
  it('is absent while the stack is empty', () => {
    const s = createGame({ seed: 1, decks: DECKS, defs: CARD_DEFS })
    mount(s)
    expect(row()).toBeNull()
  })

  it('lists the waiting item, marks the top as next to resolve, and the prompt names it', () => {
    const s = summonWaiting()
    expect(s, 'no seed under 60 reaches a Summon waiting on the stack, so this asserts nothing').not.toBeNull()
    const { view } = mount(s!)
    const el = row()
    expect(el, 'the stack row is not rendered').not.toBeNull()
    expect(el!.getAttribute('aria-label')).toBe('The stack')
    const items = [...el!.querySelectorAll('li')]
    expect(items).toHaveLength(s!.stack.length)
    const top = s!.stack[s!.stack.length - 1]!
    const label = stackItemLabel(view, top)
    expect(label).toMatch(/^(your|the AI's) /)
    expect(items.at(-1)!.textContent).toContain(label)
    expect(items.at(-1)!.textContent).toMatch(/resolves next/)
    // The live region names the item: a pass here is "let it resolve", not "end the phase".
    const text = document.querySelector('.prompt__text')!.textContent ?? ''
    expect(text.toLowerCase()).toContain(label.toLowerCase())   // the sentence capitalises "Your"
    expect(text).toMatch(/pass/)
    expect(promptFor(view, legalCommands(s!, HUMAN))).toBe(text)
  })

  it('a pass-only window never reaches the row: the hook closes it first (D15)', () => {
    // The row is for windows with a real answer. Whatever position the search above reaches, the OPPONENT's
    // side of it (after the human forfeits) is either a real window for the AI or a forced pass — never a
    // strip the human sees with only Pass on it.
    const s = summonWaiting()
    expect(s).not.toBeNull()
    const passed = apply(s!, { type: 'pass', player: HUMAN }).state
    expect(isResponseWindow(passed)).toBe(true)
    if (forcedPass(passed)) expect(actingPlayer(passed)).not.toBe(HUMAN)
  })
})
