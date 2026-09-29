import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { learn, legalCommands, viewFor, type CardId, type GameState } from '@fftcg/engine'
import { makeGame, withHand } from '../../../packages/engine/test/helpers.js'
import { CARD_DEFS, DECKS } from '../src/deck.js'
import { buildChoiceSet, occurrenceOf, preferredChoices } from '../src/game/commands.js'
import { AI, HUMAN, type Choice, type GameApi } from '../src/game/types.js'
import { Board, boardCardIds } from '../src/ui/Board.js'

/**
 * Rung V1-E (R4): the AI's hand cards the human was shown — revealed by a search or by Miner, or returned from the
 * field — are drawn face up in their own row; the rest of that hand stays a count.
 */

Element.prototype.scrollIntoView = function scrollIntoView() {}

let root: Root | null = null
let host: HTMLDivElement | null = null
afterEach(() => { act(() => { root?.unmount() }); host?.remove(); root = null; host = null })

function render(s: GameState): void {
  const v = viewFor(s, HUMAN)
  const api: GameApi = {
    view: v, choices: buildChoiceSet(v, preferredChoices(v, legalCommands(s, HUMAN))), log: [], aiThinking: false,
    choose: (_c: Choice) => {}, restart: () => {},
  }
  if (!root) { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) }
  act(() => { root!.render(createElement(Board, { game: api })) })
}

const knownRow = (): HTMLElement | null => document.querySelector<HTMLElement>('.table__seat--opponent [role="grid"][aria-label^="AI hand"]')

describe('the AI hand row (rung V1-E, R4)', () => {
  const base = makeGame({ seed: 1, decks: DECKS, defs: CARD_DEFS })   // past the mulligans: both hands dealt

  it('draws the known cards face up, names the count of the rest, and draws no unknown one', () => {
    const hand = base.players[AI].hand
    const known = hand.slice(0, 2)
    render(learn(base, [HUMAN, AI], known))
    const row = knownRow()
    expect(row, 'no AI hand row').not.toBeNull()
    expect(row!.getAttribute('aria-label')).toBe(`AI hand — 2 of ${hand.length} known`)
    const drawn = [...row!.querySelectorAll<HTMLElement>('[data-card-id]')].map((el) => Number(el.dataset.cardId))
    expect(drawn).toEqual(known)
    for (const id of known) expect(row!.textContent).toContain(CARD_DEFS.find((d) => d.code === base.cards[id]!.code)!.name)
    for (const id of hand.slice(2)) expect(document.querySelector(`[data-card-id="${id}"]`), `unknown ${id} drawn`).toBeNull()
  })

  it('is absent while the human knows none of that hand, so the board keeps its height', () => {
    render(base)
    expect(knownRow()).toBeNull()
    expect(document.querySelector('.table__seat--opponent')!.textContent).not.toMatch(/known/)
  })

  it('counts the known cards as drawn, so a choice naming one would not also get an orphan row', () => {
    const known: CardId = base.players[AI].hand[0]!
    const v = viewFor(learn(base, [HUMAN, AI], [known]), HUMAN)
    expect(boardCardIds(v).has(known)).toBe(true)
    expect(boardCardIds(viewFor(base, HUMAN)).has(known)).toBe(false)
  })

  it('numbers two known cards of one name "(1)" and "(2)", on the row and for the log (review L1)', () => {
    const code = base.cards[base.players[AI].hand[0]!]!.code
    const [one, a] = withHand(base, AI, code)
    const [two, b] = withHand(one, AI, code)
    const s = learn(two, [HUMAN, AI], [a, b])
    const v = viewFor(s, HUMAN)
    expect([occurrenceOf(v, a), occurrenceOf(v, b)]).toEqual([1, 2])
    render(s)
    const name = CARD_DEFS.find((d) => d.code === code)!.name
    const said = (id: CardId): string => knownRow()!.querySelector(`[data-card-id="${id}"]`)!.textContent ?? ''
    expect(said(a)).toContain(`${name} (1)`)
    expect(said(b)).toContain(`${name} (2)`)
  })
})
