import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import {
  actingPlayer, apply, createGame, legalCommands, viewFor, type CardId, type GameState,
} from '@fftcg/engine'
import { GreedyAgent } from '@fftcg/ai'
import { CARD_DEFS, DECKS } from '../src/deck.js'
import { Board } from '../src/ui/Board.js'
import { buildChoiceSet, paymentAlternatives, preferredChoices } from '../src/game/commands.js'
import { HUMAN, type Choice, type ChoiceSet, type GameApi } from '../src/game/types.js'

/**
 * Rung F6 — every card you can press says what pressing it does.
 *
 * METHOD, stated so the counts are reproducible. A review found that the first version of this measurement
 * was not: it recorded no seeds and no policy, and — the part that would have changed the answer — did not
 * say that the ChoiceSet is built with `paymentAlternatives(rawLegal)`. Without that every E11 alternative
 * disappears and a multi-payment card is misclassified as committing.
 *
 *   seeds        1..6, `createGame({ seed, decks: DECKS, defs: CARD_DEFS })`
 *   both seats   `GreedyAgent({ seed, decks: DECKS, depth: 1 })` drives the game forward
 *   sampled at   every state where `actingPlayer === HUMAN` and `byCard` is non-empty
 *   choice set   `buildChoiceSet(view, preferredChoices(view, legal), paymentAlternatives(legal))`
 *   step cap     600 commands per seed
 *
 * The oracle is STRUCTURAL, not string matching. A property like "no payment or target appears on a
 * non-committing card" passes on a Forward that leaks `Attack with Cloud`, which contains neither — the
 * review's example. So each card's announced action must equal exactly one of three forms, chosen by what
 * the click will actually do.
 */

Element.prototype.scrollIntoView = function scrollIntoView() {}

let root: Root | null = null
let host: HTMLDivElement | null = null
afterEach(() => { act(() => { root?.unmount() }); host?.remove(); root = null; host = null })

function mount(s: GameState): { choices: ChoiceSet; chosen: Choice[] } {
  const view = viewFor(s, HUMAN)
  const legal = legalCommands(s, HUMAN)
  const choices = buildChoiceSet(view, preferredChoices(view, legal), paymentAlternatives(legal))
  const chosen: Choice[] = []
  const api: GameApi = {
    view, choices, log: [], aiThinking: false,
    choose: (c: Choice) => { chosen.push(c) }, restart: () => {},
  }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root!.render(createElement(Board, { game: api })) })
  return { choices, chosen }
}

/** What the interface actually announces for this card — the BUTTON's name, which is what a reader gets. */
function announced(id: CardId): string | null {
  const cell = document.querySelector<HTMLElement>(`[data-card-id="${id}"]`)
  const button = cell?.querySelector('button')
  return button?.getAttribute('aria-label') ?? null
}

/** The one of three forms this card's action must take, from the choices alone. */
function expectedAction(choices: ChoiceSet, id: CardId): string {
  const forCard = choices.byCard.get(id) ?? []
  if (forCard.length > 1) return `${forCard.length} options`
  const alts = forCard[0]?.alternatives?.length ?? 0
  // ONE entry whose alternatives hold the rest, so the count is the preferred payment PLUS the others — not
  // `byCard.length`, which is always 1 here. Getting that wrong was a MAJOR in review.
  return alts > 0 ? `${alts + 1} ways to pay` : (forCard[0]?.label ?? '')
}

/** Walks seeds and yields every position where the human has something to click. */
function* positions(): Generator<GameState> {
  for (let seed = 1; seed <= 6; seed++) {
    const greedy = new GreedyAgent({ seed, decks: DECKS, depth: 1 })
    let s: GameState = createGame({ seed, decks: DECKS, defs: CARD_DEFS })
    for (let i = 0; i < 600 && !s.result; i++) {
      const p = actingPlayer(s)
      if (p === null) break
      if (p === HUMAN) yield s
      s = apply(s, greedy.decide(viewFor(s, p), legalCommands(s, p))).state
    }
  }
}

describe('every pressable card says what pressing it does (F6-A1)', () => {
  it('leaves NO clickable card silent, across hand, field and the orphan row', () => {
    let checked = 0, silent = 0, fromField = 0, fromOrphan = 0
    const examples: string[] = []
    for (const s of positions()) {
      const view = viewFor(s, HUMAN)
      const legal = legalCommands(s, HUMAN)
      const choices = buildChoiceSet(view, preferredChoices(view, legal), paymentAlternatives(legal))
      if (choices.byCard.size === 0) continue
      mount(s)
      const onBoard = new Set(view.hand)
      for (const id of choices.byCard.keys()) {
        const said = announced(id)
        if (said === null) continue          // not rendered as a button in this position
        checked++
        const want = expectedAction(choices, id)
        if (!said.includes(want)) {
          silent++
          if (!onBoard.has(id)) fromOrphan++
          else fromField++
          if (examples.length < 4) examples.push(`${id}: "${said}" lacks "${want}"`)
        }
      }
      act(() => { root?.unmount() }); host?.remove(); root = null; host = null
    }
    expect(checked, 'no clickable card was examined, so this asserts nothing').toBeGreaterThan(200)
    expect(silent, `cards announcing no action: ${examples.join(' | ')}`).toBe(0)
    // The two mutations that make this test earn its place, and the second settles a review's CRITICAL:
    //   revert `actionFor`'s non-commit branch  -> 171 silent
    //   ALSO revert the field/orphan threading  -> 279 silent
    // The extra 108 are cards my first probe scored as fine because it measured the PREDICATE rather than
    // the rendered button — including committing ones like "Attack with Undead Princess", where the click
    // does commit and the card said only its power. Pre-F6 the real figure was 279 of 443, not 171.
    void fromField; void fromOrphan
  })
})

describe('the three forms are exact (F6-A3, F6-A4)', () => {
  it('a committing card names its exact action and nothing else', () => {
    for (const s of positions()) {
      const view = viewFor(s, HUMAN)
      const legal = legalCommands(s, HUMAN)
      const choices = buildChoiceSet(view, preferredChoices(view, legal), paymentAlternatives(legal))
      const commit = [...choices.byCard.entries()]
        .find(([, list]) => list.length === 1 && !list[0]?.alternatives?.length)
      if (!commit) continue
      const { chosen } = mount(s)
      const [id, list] = commit
      const said = announced(id)
      if (said === null) { act(() => { root?.unmount() }); host?.remove(); root = null; host = null; continue }
      expect(said, 'a committing card does not name its action').toContain(list[0]!.label)
      // and it really does commit — the claim is about the click, so the click is what is checked
      act(() => { document.querySelector<HTMLElement>(`[data-card-id="${id}"] button`)!.click() })
      expect(chosen.length, 'the card named an action but pressing it submitted nothing').toBe(1)
      expect(chosen[0]!.label).toBe(list[0]!.label)
      return
    }
    throw new Error('no committing card was ever reached, so this test asserts nothing')
  })

  it('a card that does NOT commit never names a choice label, and submits nothing', () => {
    // The structural half. A string rule ("no payment, no target") passes on a leaked `Attack with Cloud`;
    // this fails on ANY leaked label, because the announced action must be the bare count.
    let checked = 0
    for (const s of positions()) {
      const view = viewFor(s, HUMAN)
      const legal = legalCommands(s, HUMAN)
      const choices = buildChoiceSet(view, preferredChoices(view, legal), paymentAlternatives(legal))
      const opens = [...choices.byCard.entries()]
        .find(([, list]) => list.length > 1 || (list[0]?.alternatives?.length ?? 0) > 0)
      if (!opens) continue
      const { chosen } = mount(s)
      const [id, list] = opens
      const said = announced(id)
      if (said === null) { act(() => { root?.unmount() }); host?.remove(); root = null; host = null; continue }
      checked++
      for (const c of [...list, ...(list[0]?.alternatives ?? [])]) {
        expect(said, `a non-committing card leaked the label "${c.label}"`).not.toContain(c.label)
      }
      expect(said, 'a non-committing card does not say what pressing it does')
        .toContain(expectedAction(choices, id))
      act(() => { document.querySelector<HTMLElement>(`[data-card-id="${id}"] button`)!.click() })
      expect(chosen.length, 'a card that only opens a choice submitted something').toBe(0)
      if (checked >= 3) return
      act(() => { root?.unmount() }); host?.remove(); root = null; host = null
    }
    expect(checked, 'no non-committing card was ever reached').toBeGreaterThan(0)
  })
})
