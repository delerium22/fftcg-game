import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { actingPlayer, apply, applyChooseFirst, createGame, legalCommands, viewFor, type GameState } from '@fftcg/engine'
import { GreedyAgent } from '@fftcg/ai'
import { CARD_DEFS, DECKS } from '../src/deck.js'
import { Board } from '../src/ui/Board.js'
import { buildChoiceSet, preferredChoices } from '../src/game/commands.js'
import { stepAi } from '../src/game/useGame.js'
import { HUMAN, type Choice, type GameApi, type LogLine } from '../src/game/types.js'

/**
 * The two channels a player who cannot see the board depends on: what is required, and what happened.
 *
 * Before rung E8 the app had ZERO live regions. The prompt computed the whole instruction — the attacker's
 * identity and power, the trigger cause, "click a highlighted card" — and rendered it in an ordinary span;
 * the log appended ordinary paragraphs and scrolled. So after the AI moved, a screen-reader player was told
 * nothing, and in a turn-based game against an AI those two facts ARE the interface.
 *
 * WHAT THESE TESTS CAN AND CANNOT PROVE. They pin the DOM contract: the roles, the live properties, that the
 * region pre-exists its content and survives an update, and that the log really gains an AI line. They do
 * NOT prove anything was announced — not the timing, the ordering, the interruption, or the duplication.
 * Only a real screen reader shows that. (My first draft of this spec claimed automation could prove "none of
 * the behaviour", which was too strong in the other direction: Playwright can read the browser's computed
 * accessibility tree, and `e2e/announcements.spec.ts` does.)
 */

Element.prototype.scrollIntoView = function scrollIntoView() {}

let root: Root | null = null
let host: HTMLDivElement | null = null
afterEach(() => { act(() => { root?.unmount() }); host?.remove(); root = null; host = null })

/** The mulligan: the human owes a decision, so the strip carries a real instruction. */
function mulliganState(): GameState {
  const s = createGame({ seed: 1, decks: DECKS, defs: CARD_DEFS })
  const chooser = s.pending?.kind === 'chooseFirst' ? s.pending.player : HUMAN
  return applyChooseFirst(s, chooser, chooser === HUMAN)[0]
}

function render(s: GameState, log: LogLine[] = []): void {
  const v = viewFor(s, HUMAN)
  const api: GameApi = {
    view: v, choices: buildChoiceSet(v, preferredChoices(v, legalCommands(s, HUMAN))), log, aiThinking: false,
    choose: (_c: Choice) => {}, restart: () => {},
  }
  if (!root) { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) }
  act(() => { root!.render(createElement(Board, { game: api })) })
}

/** Located by CLASS, never by role — see the mutation note in the first test. */
const status = (): HTMLElement => {
  const el = document.querySelector<HTMLElement>('.prompt__text')
  expect(el, 'the prompt text is not rendered at all').not.toBe(null)
  return el!
}

describe('what the game requires is announced', () => {
  it('carries the full live-region contract', () => {
    // Every one of these is asserted separately, because they fail separately. With both `role="status"`
    // and `aria-live` present, removing only the role still leaves a working generic polite region — so a
    // single "is it a live region" assertion would call that mutant equivalent when it is not.
    //
    // And located by CLASS. A role locator would stop matching the moment the role is mutated away, so the
    // test would die in the locator rather than at the assertion — a red run that proves nothing, which is
    // exactly how a mutation of the game-over dialog fooled me in rung E7.
    render(mulliganState())
    const el = status()
    expect(el.getAttribute('role'), 'the prompt is not a status region').toBe('status')
    expect(el.getAttribute('aria-live'), 'an interruption on every phase change would be intolerable').toBe('polite')
    expect(el.getAttribute('aria-atomic'), 'half an instruction is worse than none').toBe('true')
  })

  it('updates the SAME node across a real transition', () => {
    // The mechanism a live region depends on: the container pre-exists and RECEIVES updates. Asserting only
    // that "the text changed" proves React's dataflow and nothing about announcement — a region replaced on
    // every change announces nothing at all, and would pass that weaker check every time.
    const before = mulliganState()
    render(before)
    const node = status()
    expect(node.textContent, 'the opening instruction is not what this fixture expects').toBe('Keep your hand or mulligan')

    // A real transition, driven through the engine.
    const after = apply(before, { type: 'mulligan', player: HUMAN, redraw: false }).state
    render(after)

    expect(document.querySelector('.prompt__text'), 'the live region was replaced, so it announces nothing').toBe(node)
    expect(node.textContent, 'the instruction did not change').not.toBe('Keep your hand or mulligan')
    expect(node.textContent!.length, 'the region emptied instead of updating').toBeGreaterThan(0)
  })

  it('leaves focus where the player put it', () => {
    // A live region announces WITHOUT moving focus; that is the whole point of choosing one. Asserted from
    // an external sentinel rather than as "activeElement never changes anywhere" — the strip deliberately
    // restores focus after the player uses it, and `focus.test.tsx` requires that. Both behaviours are
    // correct and they coexist: the status owns the instruction, restoration owns keyboard position.
    const before = mulliganState()
    render(before)
    const sentinel = document.createElement('button')
    sentinel.textContent = 'outside'
    document.body.appendChild(sentinel)
    act(() => { sentinel.focus() })

    render(apply(before, { type: 'mulligan', player: HUMAN, redraw: false }).state)
    expect(document.activeElement, 'a state change stole focus from where the player had put it').toBe(sentinel)
    sentinel.remove()
  })
})

describe('what the AI did is announced', () => {
  it('is a labelled log that gains the AI’s own line', () => {
    // The named defect is specifically that the AI acts SILENTLY — so an opening line or the player's own
    // action would not do. This drives a real AI command and requires its line to appear in the pre-existing
    // log node, with the earlier line still there.
    const agent = new GreedyAgent({ seed: 1, decks: DECKS, depth: 1 })
    let s = mulliganState()
    for (let i = 0; i < 6 && s.pending?.kind === 'mulligan'; i++) {
      s = apply(s, { type: 'mulligan', player: s.pending.player, redraw: false }).state
    }
    // Run the AI until it produces narration of its own.
    let lines: LogLine[] = [{ kind: 'event', text: 'New game — you are P0, the AI is P1' }]
    let aiLine: string | null = null
    for (let i = 0; i < 400 && aiLine === null && !s.result; i++) {
      if (actingPlayer(s) === null) break
      const step = stepAi(s, agent)
      s = step.state
      for (const l of step.lines) {
        lines = [...lines, l]
        if (aiLine === null && l.text.startsWith('The AI:')) aiLine = l.text
      }
    }
    expect(aiLine, 'the AI never narrated anything, so this test asserts nothing').not.toBe(null)

    render(s, lines)
    const log = document.querySelector<HTMLElement>('.log__lines')
    expect(log, 'the log is not rendered').not.toBe(null)
    expect(log!.getAttribute('role'), 'the AI’s moves arrive silently').toBe('log')
    // `aria-label`, not `aria-labelledby`: naming the region by its visible heading made Chromium compute
    // "GAME LOG", because it applies the heading's CSS `text-transform` to the accessible name.
    expect(log!.getAttribute('aria-label'), 'the log region has no accessible name').toBe('Game log')

    const texts = [...log!.querySelectorAll('p')].map((p) => p.textContent)
    expect(texts, 'the AI’s line is not inside the log region').toContain(aiLine)
    expect(texts, 'the earlier narration was dropped').toContain('New game — you are P0, the AI is P1')
  })
})
