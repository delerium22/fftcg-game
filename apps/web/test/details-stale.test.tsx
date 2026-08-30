import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import {
  actingPlayer, apply, createGame, legalCommands, viewFor,
  type CardId, type GameState,
} from '@fftcg/engine'
import { CARD_DEFS, DECKS } from '../src/deck.js'
import { Board } from '../src/ui/Board.js'
import { buildChoiceSet, paymentAlternatives, preferredChoices } from '../src/game/commands.js'
import { HUMAN, type Choice, type ChoiceSet, type GameApi } from '../src/game/types.js'

/**
 * Rung G4 — the details panel keeps a claim the board has already invalidated.
 *
 * Found by playing: cast Luso from hand, and the panel went on reading "Luso … 4 ways to pay" while Luso was
 * standing on the field, where there is no payment to make and nothing to click.
 *
 * `Board` stores what you looked at as `useState<{ code, action }>` — a SNAPSHOT taken at hover or focus
 * time. The code half is deliberate and right: it is a property of the definition, and it survives the
 * instance leaving play mid-look, which is exactly what you want when a card you are reading gets broken.
 * The action half rides along for a stated reason too — it belongs to the instance, so it cannot be looked up
 * from the code alone.
 *
 * But a snapshot cannot go stale gracefully. The panel's own contract is "what clicking this card will DO,
 * BEFORE the click", and once the click has happened it is describing a move that can no longer be made —
 * the same defect G2 removed from the prompt strip, in the other half of the screen.
 */

Element.prototype.scrollIntoView = function scrollIntoView() {}

let root: Root | null = null
let host: HTMLDivElement | null = null
afterEach(() => { act(() => { root?.unmount() }); host?.remove(); root = null; host = null })

function choicesFor(s: GameState): ChoiceSet {
  const view = viewFor(s, HUMAN)
  const legal = legalCommands(s, HUMAN)
  return buildChoiceSet(view, preferredChoices(view, legal), paymentAlternatives(legal))
}

function render(s: GameState, onChoose: (c: Choice) => void = () => {}): void {
  const api: GameApi = {
    view: viewFor(s, HUMAN), choices: choicesFor(s), log: [], aiThinking: false,
    choose: onChoose, restart: () => {},
  }
  act(() => { root!.render(createElement(Board, { game: api })) })
}

const details = (): string => document.querySelector('.details__action')?.textContent ?? ''

/** What the board WOULD say about this card right now — the same three forms `Board.actionFor` produces. */
function currentAction(s: GameState, id: CardId): string {
  const forCard = choicesFor(s).byCard.get(id) ?? []
  if (forCard.length === 0) return ''
  if (forCard.length > 1) return `${forCard.length} options`
  const ways = (forCard[0]?.alternatives?.length ?? 0) + 1
  return ways > 1 ? `${ways} ways to pay` : (forCard[0]?.label ?? '')
}

/** Walk to a position where the human holds a card that opens a payment choice. */
function positionWithPayableCard(): { state: GameState; card: CardId; action: string } {
  for (let seed = 1; seed <= 20; seed++) {
    let s: GameState = createGame({ seed, decks: DECKS, defs: CARD_DEFS })
    for (let i = 0; i < 200 && !s.result; i++) {
      const p = actingPlayer(s)
      if (p === null) break
      if (p === HUMAN) {
        const cs = choicesFor(s)
        for (const [id, list] of cs.byCard) {
          const ways = (list[0]?.alternatives?.length ?? 0) + 1
          if (list.length === 1 && ways > 1) return { state: s, card: id, action: `${ways} ways to pay` }
        }
      }
      const legal = legalCommands(s, p)
      const next = legal.find((c) => c.type !== 'concede')
      if (!next) break
      s = apply(s, next).state
    }
  }
  throw new Error('no position with a multi-payment card was reached, so this test asserts nothing')
}

describe('G4 — the details panel never outlives its own claim', () => {
  it('follows the looked-at card’s action as the board changes under it', () => {
    // Two earlier versions of this test were wrong, in ways worth recording because both would have "proved"
    // a fix that did nothing.
    //
    //   1. It asserted that playing a card empties the panel. False: the card went to the Break Zone, where
    //      Luso's and Sphene's clauses can target it, so "2 options" was still TRUE. Leaving the hand does not
    //      imply having no action.
    //   2. It then tracked one card id while the game moved on — but the focused button is destroyed when the
    //      card leaves the hand, focus moves, and `inspected` follows it. The panel was describing a DIFFERENT
    //      Billy Bob, correctly, while the test compared it against the original.
    //
    // So the card under test is pinned by FOCUS: assertions only run while the same button still holds it,
    // which is exactly the situation the defect lives in — a player reads the panel and does not look again.
    const { state, card, action } = positionWithPayableCard()
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    render(state)

    const button = document.querySelector<HTMLElement>(`[data-card-id="${card}"] button`)
    expect(button, 'the payable card rendered no button').not.toBeNull()
    act(() => { button!.focus() })
    expect(document.activeElement, 'focus did not land on the card').toBe(button)
    expect(details(), 'the panel never showed the action in the first place').toBe(action)

    let s = state
    let checked = 0
    let changed = 0
    for (let step = 0; step < 40 && !s.result; step++) {
      const p = actingPlayer(s)
      if (p === null) break
      const next = legalCommands(s, p).find((c) => c.type !== 'concede')
      if (!next) break
      s = apply(s, next).state
      render(s)
      // Only while the SAME element still holds focus is `inspected` still this card.
      const still = document.querySelector<HTMLElement>(`[data-card-id="${card}"] button`)
      if (still === null || document.activeElement !== still) break
      const want = currentAction(s, card)
      checked++
      if (want !== action) changed++
      expect(details(), `after ${step + 1} moves the panel says "${details()}" but the board offers "${want}"`)
        .toBe(want)
    }
    expect(checked, 'focus was lost immediately, so nothing was ever compared').toBeGreaterThan(0)
    expect(changed, 'the looked-at card’s action never changed while it was being looked at — staleness was never possible')
      .toBeGreaterThan(0)
  })
})
