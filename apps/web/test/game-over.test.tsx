import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { actingPlayer, createGame, viewFor, type GameResult, type GameState } from '@fftcg/engine'
import { GreedyAgent } from '@fftcg/ai'
import { CARD_DEFS, DECKS } from '../src/deck.js'
import { Board } from '../src/ui/Board.js'
import { buildChoiceSet, describeResult } from '../src/game/commands.js'
import { describeEvent, stepAi } from '../src/game/useGame.js'
import { AI, HUMAN, type Choice, type GameApi, type LogLine } from '../src/game/types.js'

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

function mountFinished(s: GameState, log: LogLine[]): void {
  const v = viewFor(s, HUMAN)
  const api: GameApi = {
    view: v, choices: buildChoiceSet(v, []), log, aiThinking: false,
    choose: (_c: Choice) => {}, restart: () => {},
  }
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  act(() => { root!.render(createElement(Board, { game: api })) })
}

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
    expect([...document.querySelectorAll('.prompt__actions button')], 'stale choices survived the end of the game').toEqual([])
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

  it('a draw is phrased as a draw, not as somebody losing', () => {
    expect(describeResult(HUMAN, { winner: null, cause: 'bothReachedSeven', reason: 'x' }))
      .toBe('You both reached 7 damage — the game is a draw.')
  })

  it('the event log line uses the same sentence as the banner', () => {
    // Two consumers, one formatter. Written separately once, and that is exactly how the log kept the leak.
    const result: GameResult = { winner: AI, cause: 'damage', reason: 'player 0 has 7 damage (§12.4.1)' }
    const line = describeEvent(viewFor(createGame({ seed: 1, decks: DECKS, defs: CARD_DEFS }), HUMAN), { type: 'gameOver', result })?.text ?? ''
    expect(line).toContain(describeResult(HUMAN, result))
    expect(line, 'the log still prints the engine reason').not.toContain('§')
  })
})
