import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { actingPlayer, applyChooseFirst, createGame, legalCommands, viewFor, type GameResult, type GameState } from '@fftcg/engine'
import { GreedyAgent } from '@fftcg/ai'
import { CARD_DEFS, DECKS } from '../src/deck.js'
import { Board } from '../src/ui/Board.js'
import { buildChoiceSet, describeResult } from '../src/game/commands.js'
import { describeEvent, stepAi } from '../src/game/useGame.js'
import { AI, HUMAN, type Choice, type ChoiceSet, type GameApi, type LogLine } from '../src/game/types.js'

/**
 * What the browser says when the game ends.
 *
 * It used to tell the person who had just lost: "The AI wins / player 0 has 7 damage (§12.4.1)". "player 0"
 * is the human, who is "you" everywhere else in this UI, and the citation belongs in the code comments where
 * it already is. Found by driving a real game to a real conclusion and rendering the finished board — nothing
 * covered the endgame at all, so nothing had ever looked at it.
 */

Element.prototype.scrollIntoView = function scrollIntoView() {}

let root: Root | null = null
let host: HTMLDivElement | null = null
afterEach(() => { act(() => { root?.unmount() }); host?.remove(); root = null; host = null })

/** A real finished game, played out rather than constructed. */
function playToTheEnd(seed: number): { state: GameState; log: LogLine[] } {
  const agent = new GreedyAgent({ seed, decks: DECKS, depth: 1 })
  let s: GameState = createGame({ seed, decks: DECKS, defs: CARD_DEFS })
  const log: LogLine[] = []
  for (let i = 0; i < 6000 && !s.result; i++) {
    if (actingPlayer(s) === null) break
    const step = stepAi(s, agent)
    s = step.state
    log.push(...step.lines)
  }
  return { state: s, log }
}

function mountFinished(s: GameState, log: LogLine[], choices?: ChoiceSet, onRestart?: () => void): void {
  const v = viewFor(s, HUMAN)
  const api: GameApi = {
    view: v, choices: choices ?? buildChoiceSet(v, []), log, aiThinking: false,
    choose: (_c: Choice) => {}, restart: onRestart ?? (() => {}),
  }
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  act(() => { root!.render(createElement(Board, { game: api })) })
}

/** A brand-new game where the AI owes the first decision, so the human has no action to focus. */
function remountPending(): void {
  const s = createGame({ seed: 5, decks: DECKS, defs: CARD_DEFS })
  const v = { ...viewFor(s, HUMAN), pending: { kind: 'chooseFirst' as const, player: AI }, priority: AI }
  const api: GameApi = {
    view: v, choices: buildChoiceSet(v, []), log: [], aiThinking: true,
    choose: (_c: Choice) => {}, restart: () => {},
  }
  act(() => { root!.render(createElement(Board, { game: api })) })
}

/**
 * The SAME Board rendered on a fresh, unfinished game — what a restart actually produces.
 *
 * Advanced past `chooseFirst`, because at a brand-new game that decision can belong to the AI and the human
 * then has no actions at all to receive focus. The first thing a restart really shows a player is their
 * mulligan; a fixture stopping one step earlier tests a screen nobody is looking at.
 */
function remountLive(): void {
  let s = createGame({ seed: 5, decks: DECKS, defs: CARD_DEFS })
  const first = s.pending?.kind === 'chooseFirst' ? s.pending.player : HUMAN
  s = applyChooseFirst(s, first, first === HUMAN)[0]
  const v = viewFor(s, HUMAN)
  const api: GameApi = {
    view: v, choices: buildChoiceSet(v, legalCommands(s, HUMAN)), log: [], aiThinking: false,
    choose: (_c: Choice) => {}, restart: () => {},
  }
  act(() => { root!.render(createElement(Board, { game: api })) })
}

describe('the game-over dialog is a dialog (rung E7)', () => {
  const dialog = (): HTMLDialogElement => {
    const d = document.querySelector<HTMLDialogElement>('dialog.banner')
    expect(d, 'the game-over dialog did not render').not.toBe(null)
    return d!
  }
  /** Resolve an aria relationship to the text it actually points at. */
  const resolves = (el: Element, attr: string): string => {
    const id = el.getAttribute(attr)
    expect(id, `the dialog has no ${attr}`).not.toBe(null)
    return document.getElementById(id!)?.textContent ?? ''
  }

  it('is a native dialog with the alertdialog contract', () => {
    const { state, log } = playToTheEnd(3)
    mountFinished(state, log)
    const d = dialog()
    expect(d.tagName).toBe('DIALOG')
    expect(d.getAttribute('role')).toBe('alertdialog')
    expect(d.getAttribute('aria-modal'), 'the board behind is still exposed to assistive technology').toBe('true')
  })

  it('names and describes itself with the OUTCOME, not just "Game over"', () => {
    // The plan review's CRITICAL, and the third time this shape has been caught in this program. The old
    // banner's only accessible name was `aria-label="Game over"`, so a screen reader announced that and
    // stopped: the player learned the game had ended, not who won. Both relationships are resolved to their
    // text here, so neither can be removed or mispointed without this failing.
    const { state, log } = playToTheEnd(3)
    mountFinished(state, log)
    const d = dialog()
    expect(d.getAttribute('aria-label'), 'a bare aria-label would override the heading it is meant to use').toBe(null)
    expect(resolves(d, 'aria-labelledby'), 'the dialog is not named by the outcome').toBe('The AI wins')
    expect(resolves(d, 'aria-describedby'), 'the dialog is not described by the reason').toBe('You have taken 7 damage.')
  })

  it('puts focus on the HEADING, not the dialog and not the button', () => {
    // Focusing the container announces the dialog's own name and stops. Focusing the button announces the
    // action before the outcome. The heading is what carries "The AI wins", with the reason after it.
    const { state, log } = playToTheEnd(3)
    mountFinished(state, log)
    const heading = dialog().querySelector<HTMLElement>('h2')!
    expect(heading.getAttribute('tabindex'), 'the heading cannot take focus').toBe('-1')
    expect(document.activeElement, 'focus did not land on the outcome').toBe(heading)
  })

  it('calls showModal, which is what makes the board inert', () => {
    // A SPY, not an emulation. This jsdom implements neither `showModal` nor `inert`, so the actual modality
    // — top layer, focus containment, the board leaving the tab order — is proven in a real browser and
    // nowhere else. What can honestly be checked here is that the lifecycle asks for it.
    const calls: string[] = []
    const proto = window.HTMLDialogElement?.prototype as { showModal?: () => void } | undefined
    const had = proto !== undefined && typeof proto.showModal === 'function'
    if (proto) proto.showModal = function spy() { calls.push('showModal') }
    try {
      const { state, log } = playToTheEnd(3)
      mountFinished(state, log)
      expect(calls, 'the dialog was rendered but never opened modally').toEqual(['showModal'])
    } finally {
      if (proto && !had) delete proto.showModal
    }
  })

  it('puts focus back on the new game after Play again', () => {
    // The dialog is modal, so the button the player just pressed is destroyed with it and focus falls to
    // `document.body` — measured in a browser, not assumed. From there a keyboard player tabs in from the
    // top of the document to make the first decision of a brand new game, which is the very state this rung
    // exists to prevent at the end of one.
    const { state, log } = playToTheEnd(3)
    let restarted = false
    mountFinished(state, log, undefined, () => { restarted = true })
    act(() => { dialog().querySelector('button')!.click() })
    expect(restarted, 'Play again did not restart').toBe(true)

    // The real sequence, not a shortcut. A new game's first decision is often the AI's, so the render right
    // after a restart offers NO prompt button — the strip says "Waiting for the opponent…". The first
    // version of this test jumped straight to the mulligan and so never exercised that gap, while the real
    // browser left focus on `document.body` until the player tabbed in from the top of the document.
    remountPending()
    expect(document.querySelectorAll('.prompt__actions button'), 'this step is meant to have no actions').toHaveLength(0)
    remountLive()
    expect(document.activeElement, 'focus fell to the document body after restarting').not.toBe(document.body)
    expect(
      document.activeElement?.closest('.prompt__actions'),
      'focus did not land on an action of the new game',
    ).not.toBe(null)
  })

  it('refuses to be dismissed — there is nothing to dismiss to', () => {
    // `defaultPrevented` read AFTER dispatch. Reading it inside a listener on the target is the mistake the
    // card grid taught: events bubble target-first, so such a listener runs before the handler under test.
    const { state, log } = playToTheEnd(3)
    mountFinished(state, log)
    const ev = new Event('cancel', { bubbles: false, cancelable: true })
    act(() => { dialog().dispatchEvent(ev) })
    expect(ev.defaultPrevented, 'Escape would close the dialog onto a dead board').toBe(true)
  })
})

describe('a finished game in a real Board', () => {
  it('leaks neither a player index nor a rules citation, anywhere in the DOM', () => {
    // The whole document, not just `.banner`. `describeEvent` renders the game-over line into the event log
    // independently of the banner, and `Board` keeps the log mounted behind the overlay — so fixing only the
    // banner would have left the identical leak a few pixels lower, in a DOM a screen reader still walks.
    const { state, log } = playToTheEnd(3)
    expect(state.result, 'no game finished, so this test asserts nothing').not.toBe(null)
    mountFinished(state, log)

    const dom = document.body.textContent ?? ''
    expect(dom, 'the finished board still calls the human "player 0"').not.toMatch(/player \d/)
    expect(dom, 'the finished board still shows a Comprehensive Rules citation').not.toContain('§')
    // An absence alone would pass on an empty banner, so pin the sentence too.
    expect(document.querySelector('.banner')?.textContent).toContain('You have taken 7 damage.')
    expect(document.querySelector('.banner__title')?.textContent).toBe('The AI wins')
  })

  it('still offers a way to play again', () => {
    const { state, log } = playToTheEnd(3)
    mountFinished(state, log)
    expect(document.querySelector('.banner button')?.textContent).toBe('Play again')
  })

  it('offers no stale choice once the game is over, even if handed one', () => {
    // The first version of this asserted "no choice buttons" against a fixture built with `buildChoiceSet(v,
    // [])` — an empty choice set asserting it was empty. It could not fail. Hand the finished board a
    // DELIBERATELY non-empty set, so the assertion is about the board's behaviour rather than the fixture's.
    const { state, log } = playToTheEnd(3)
    const v = viewFor(state, HUMAN)
    const stale = buildChoiceSet(v, [{ type: 'concede', player: HUMAN }])
    expect(stale.all.length, 'the stale set is empty, so this proves nothing again').toBeGreaterThan(0)
    mountFinished(state, log, stale)
    expect(
      [...document.querySelectorAll('.prompt__actions button')].map((b) => b.textContent),
      'a finished game still offered a move',
    ).toEqual([])
  })
})

// ── The wording table ──────────────────────────────────────────────────────────────────────────────────

/**
 * Every non-draw cause, from BOTH seats. One loser-side and one winner-side sentence would catch a phrasing
 * that ignores `v.me`, but not `deckOut` wired to the `damageWithEmptyDeck` sentence or a missing `concede`
 * branch — cross-cause mistakes need the whole table.
 */
const TABLE: ReadonlyArray<readonly [GameResult['cause'], string, string]> = [
  ['damage', 'You have taken 7 damage.', 'The AI has taken 7 damage.'],
  ['concede', 'You conceded.', 'The AI conceded.'],
  ['deckOut', 'You could not draw from an empty deck.', 'The AI could not draw from an empty deck.'],
  ['damageWithEmptyDeck', 'You took damage with an empty deck.', 'The AI took damage with an empty deck.'],
]

describe('describeResult', () => {
  for (const [cause, whenYouLose, whenYouWin] of TABLE) {
    if (cause === 'bothReachedSeven') continue
    it(`${cause}: reads correctly from both seats`, () => {
      // The human lost: the AI is the winner.
      expect(describeResult(HUMAN, { winner: AI, cause, reason: 'x' })).toBe(whenYouLose)
      // The human won: the human is the winner, so the sentence is about the AI.
      expect(describeResult(HUMAN, { winner: HUMAN, cause, reason: 'x' })).toBe(whenYouWin)
    })
  }

  it('reads correctly for a viewer sitting at seat 1 (the same sentences, other seat)', () => {
    // The browser pins the human to seat 0 (`HUMAN` is a module constant), so this configuration does not
    // occur in the app today. It is still worth asserting, and it is NOT the "fixture that cannot exist"
    // mistake: `describeResult` is a pure function whose contract is defined for any seat, so this tests the
    // contract rather than manufacturing an unreachable game position. The mirror tournament already swaps
    // seats for the AI benchmark, and `winner === me` is the kind of comparison that silently assumes 0.
    expect(describeResult(AI, { winner: HUMAN, cause: 'damage', reason: 'x' })).toBe('You have taken 7 damage.')
    expect(describeResult(AI, { winner: AI, cause: 'damage', reason: 'x' })).toBe('The AI has taken 7 damage.')
  })

  it('a draw is phrased as a draw, not as somebody losing', () => {
    expect(describeResult(HUMAN, { winner: null, cause: 'bothReachedSeven', reason: 'x' }))
      .toBe('You both reached 7 damage — the game is a draw.')
  })

  describe('the event log line uses the same sentence as the banner', () => {
    // Two consumers, one formatter — and the whole union, both sides. Checking only a damage loss let a
    // mutant through where ONLY `damage` called `describeResult` and every other cause logged "You have
    // taken 7 damage.": all 253 web tests passed and it linted cleanly. A shared formatter is not shown to
    // be shared by exercising one of its five branches.
    const view = viewFor(createGame({ seed: 1, decks: DECKS, defs: CARD_DEFS }), HUMAN)
    const logLine = (result: GameResult): string =>
      describeEvent(view, { type: 'gameOver', result })?.text ?? ''

    for (const [cause] of TABLE) {
      if (cause === 'bothReachedSeven') continue
      for (const winner of [HUMAN, AI] as const) {
        it(`${cause}, won by ${winner === HUMAN ? 'you' : 'the AI'}`, () => {
          const result = { winner, cause, reason: 'player 0 lost somehow (§0)' } as GameResult
          expect(logLine(result)).toContain(describeResult(HUMAN, result))
          expect(logLine(result), 'the log still prints the engine reason').not.toContain('§')
        })
      }
    }

    it('the draw', () => {
      const result: GameResult = { winner: null, cause: 'bothReachedSeven', reason: 'both players reached 7 damage (§3.3)' }
      expect(logLine(result)).toContain(describeResult(HUMAN, result))
      expect(logLine(result)).not.toContain('§')
    })
  })
})
