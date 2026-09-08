import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import {
  actingPlayer, apply, createGame, legalCommands, viewFor,
  type CardId, type GameState,
} from '@fftcg/engine'
import { CARD_DEFS, DECKS } from '../src/deck.js'
import { Board } from '../src/ui/Board.js'
import { buildChoiceSet, headline, paymentAlternatives, preferredChoices } from '../src/game/commands.js'
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
  // Rung I1: a sole choice is announced by its HEADLINE (no payment — the tray chooses that).
  return headline(viewFor(s, HUMAN), forCard[0]!)
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
          if (list.length === 1 && ways > 1) return { state: s, card: id, action: headline(viewFor(s, HUMAN), list[0]!) }
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
      // Pass when possible: the looked-at card then stays in hand (so its button keeps focus) while the turn
      // changes under it, and "Cast X" becomes nothing at all — the change this test needs to observe. The
      // first-non-concede policy used to serve because "N ways to pay" moved with every backup; since rung
      // I1 the action is the move's headline, which only changes when the card's choices do.
      const legalHere = legalCommands(s, p)
      const next = legalHere.find((c) => c.type === 'pass') ?? legalHere.find((c) => c.type !== 'concede')
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

  it('drops the claim when the looked-at card is the one you play', () => {
    // The transition the rung was FOUND on, and the test above cannot see it: playing the inspected card
    // destroys its button, focus moves, and `inspected` follows focus to some other card — so the assertion
    // there stops rather than checking the interesting moment. A code review pointed that out.
    //
    // Blurring instead of letting focus wander pins `inspected` to the played card, which is what happens in
    // practice when the pointer is elsewhere or the player used the strip.
    const { state, card, action } = positionWithPayableCard()
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    render(state)

    const button = document.querySelector<HTMLElement>(`[data-card-id="${card}"] button`)!
    act(() => { button.focus() })
    expect(details()).toBe(action)
    act(() => { button.blur() })

    const choice = choicesFor(state).byCard.get(card)?.[0]
    expect(choice, 'the card lost its choice between renders').toBeDefined()
    const after = apply(state, choice!.command).state
    expect(after.players[HUMAN].hand.includes(card), 'the card never left the hand').toBe(false)
    render(after)

    // Whatever the truth is now — no action at all, or a Break-Zone target's "N options" — the panel must say
    // THAT. Asserting emptiness here would be wrong: this pool can legitimately target a card in the Break
    // Zone, which is how the first version of this test failed against a correct fix.
    expect(details(), `the panel still claims "${details()}" for a card that has been played`)
      .toBe(currentAction(after, card))
  })

  it('does not carry a claim across "Play again" (found in code review)', () => {
    // Card ids are minted from 1 per game and `Board` stays mounted across a restart, so an id captured in the
    // old game names a DIFFERENT card in the new one. With a fixed deck order the reused id happens to carry
    // the same code, which hides the mismatch — so the panel is checked against the new game's truth for that
    // id, and `inspectedAction` re-identifies the instance by code before trusting it.
    const { state, card, action } = positionWithPayableCard()
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    render(state)
    const button = document.querySelector<HTMLElement>(`[data-card-id="${card}"] button`)!
    act(() => { button.focus() })
    expect(details()).toBe(action)
    act(() => { button.blur() })

    // A brand new game: same component, freshly minted ids starting again at 1. Rendered at SETUP first,
    // exactly as `restart()` does — the reset watches for turn 0 in the setup phase, so a test that jumped
    // straight to mid-game would never trigger it and would be testing a path the app does not take.
    // Then on to a position where that same id DOES have an action, which is the only place the two builds
    // differ: at setup nothing is clickable, so a stale `inspected` and a cleared one look identical and the
    // mutation survives. This is what makes the assertion below able to fail. The first-legal-command walk is
    // degenerate (it ends games by turn 8), so the new game's seed is searched for one where the id acts.
    let fresh: GameState | null = null
    for (let seed = 99; seed < 140 && fresh === null; seed++) {
      let g = createGame({ seed, decks: DECKS, defs: CARD_DEFS })
      const start = g
      for (let i = 0; i < 600 && !g.result; i++) {
        if (choicesFor(g).byCard.has(card) && actingPlayer(g) === HUMAN) { fresh = g; break }
        const p2 = actingPlayer(g)
        if (p2 === null) break
        const next = legalCommands(g, p2).find((c) => c.type !== 'concede')
        if (!next) break
        g = apply(g, next).state
      }
      if (fresh) render(start)   // rendered at SETUP first, exactly as `restart()` does
    }
    expect(fresh, 'the reused id never became actionable in any new game, so nothing is proven').not.toBeNull()
    fresh = fresh!
    render(fresh)
    // NOTHING, not `currentAction(fresh, card)`. Asserting the latter was my first attempt and it could not
    // fail: the buggy build looks up exactly that, and with a fixed deck order the reused id even carries the
    // same code. The player has not looked at anything in this game, so the panel must claim nothing.
    expect(details(), `the panel carried "${details()}" into a new game`).toBe('')
  })
})
