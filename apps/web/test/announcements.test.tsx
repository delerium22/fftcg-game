import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { actingPlayer, apply, applyChooseFirst, createGame, legalCommands, viewFor, type GameState } from '@fftcg/engine'
import { GreedyAgent } from '@fftcg/ai'
import { CARD_DEFS, DECKS } from '../src/deck.js'
import { Board } from '../src/ui/Board.js'
import { buildChoiceSet, preferredChoices } from '../src/game/commands.js'
import { stepAi } from '../src/game/useGame.js'
import { AI, HUMAN, type Choice, type GameApi, type LogLine } from '../src/game/types.js'

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
    // The EXACT new instruction. "different and non-empty" is satisfied by any placeholder — mutating the
    // waiting branch to "Please wait" passed it — which proves the text changed, not that the right thing
    // is being announced.
    expect(node.textContent, 'the region does not carry the new instruction').toBe('Waiting for the AI')
    // And the contract must still hold AFTER the update: semantics removed on a later render would leave a
    // region that announced once and then went quiet.
    expect(node.getAttribute('role')).toBe('status')
    expect(node.getAttribute('aria-live')).toBe('polite')
    expect(node.getAttribute('aria-atomic')).toBe('true')
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
  it('gains the AI’s own line inside the SAME pre-existing log region', () => {
    // Two things this has to prove, and my first version proved neither.
    //
    // It gathered every line first and mounted once, so it never exercised an UPDATE — `key={log.length}`
    // on the region, which replaces the live node on every append and therefore announces nothing at all,
    // passed the whole suite. That is the original defect restored, hiding behind a green test.
    //
    // And its "AI line" was not the AI's. `mulliganState()` puts the human first, so the first step applied
    // a HUMAN command — and `narrateApply` hard-codes the "The AI:" prefix, so a `startsWith('The AI:')`
    // check matched the prefix rather than an AI action. It now requires `actingPlayer === AI` before the
    // step that produces the line.
    const agent = new GreedyAgent({ seed: 1, decks: DECKS, depth: 1 })
    let s = mulliganState()
    for (let i = 0; i < 6 && s.pending?.kind === 'mulligan'; i++) {
      s = apply(s, { type: 'mulligan', player: s.pending.player, redraw: false }).state
    }
    // Advance to a point where the AI genuinely owes the next command.
    for (let i = 0; i < 400 && actingPlayer(s) !== AI && !s.result; i++) {
      const acting = actingPlayer(s)
      if (acting === null) break
      s = stepAi(s, agent).state
    }
    expect(actingPlayer(s), 'never reached a position where the AI acts, so this asserts nothing').toBe(AI)

    const opening: LogLine[] = [{ kind: 'event', text: 'New game — you are P0, the AI is P1' }]
    render(s, opening)
    const region = document.querySelector<HTMLElement>('.log__lines')
    expect(region, 'the log is not rendered').not.toBe(null)
    expect(region!.getAttribute('role'), 'the AI’s moves arrive silently').toBe('log')
    expect(region!.getAttribute('aria-live'), 'the log carries no politeness of its own').toBe('polite')
    // `aria-label`, not `aria-labelledby`: naming the region by its visible heading made Chromium compute
    // "GAME LOG", because it applies the heading's CSS `text-transform` to the accessible name.
    expect(region!.getAttribute('aria-label'), 'the log region has no accessible name').toBe('Game log')

    // ONE real AI command, and the line it narrates.
    const step = stepAi(s, agent)
    const aiLines = step.lines.filter((l) => l.text.startsWith('The AI:'))
    expect(aiLines.length, 'the AI acted without narrating anything').toBeGreaterThan(0)
    const aiLine = aiLines[0]!.text

    render(step.state, [...opening, ...step.lines])

    expect(document.querySelector('.log__lines'), 'the log region was replaced, so an append announces nothing').toBe(region)
    const texts = [...region!.querySelectorAll('p')].map((p) => p.textContent)
    expect(texts, 'the AI’s line is not inside the log region').toContain(aiLine)
    expect(texts, 'the earlier narration was dropped').toContain('New game — you are P0, the AI is P1')
  })

  it('falls silent once the game-over dialog owns the announcement', () => {
    // Three live channels fire on the result transition: the status changes to "Game over", the log gains
    // the result line, and the alertdialog mounts and takes focus. An `alertdialog` is the right owner of a
    // terminal announcement, so the other two stand down rather than saying the same thing three ways.
    const agent = new GreedyAgent({ seed: 3, decks: DECKS, depth: 1 })
    let s: GameState = createGame({ seed: 3, decks: DECKS, defs: CARD_DEFS })
    for (let i = 0; i < 6000 && !s.result; i++) {
      if (actingPlayer(s) === null) break
      s = stepAi(s, agent).state
    }
    expect(s.result, 'no game finished, so this asserts nothing').not.toBe(null)
    render(s, [{ kind: 'result', text: 'Game over — the AI wins. You have taken 7 damage.' }])
    expect(document.querySelector('.prompt__text')?.getAttribute('aria-live'),
      'the prompt still announces over the dialog').toBe('off')
    expect(document.querySelector('.log__lines')?.getAttribute('aria-live'),
      'the log still announces over the dialog').toBe('off')
  })
})
