import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import {
  actingPlayer, apply, createGame, legalCommands, viewFor,
  type CardId, type GameState, type PlayerView,
} from '@fftcg/engine'
import { GreedyAgent } from '@fftcg/ai'
import { CARD_DEFS, DECKS } from '../src/deck.js'
import { Board } from '../src/ui/Board.js'
import { buildChoiceSet, headline, paymentAlternatives, preferredChoices } from '../src/game/commands.js'
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

/**
 * Does the announced name end with EXACTLY this action?
 *
 * `includes` is not good enough and a review proved it: `cardAccessibleName` joins its parts with ", ", so
 * "…, 12 ways to pay" contains "2 ways to pay", and a mutation adding ten to every small count passed. The
 * separator has to be part of the match, which is what makes the comparison exact rather than a suffix.
 */
const endsWithAction = (said: string, action: string): boolean => said.endsWith(`, ${action}`)

/** Which row drew this card — so coverage can be asserted per zone rather than in aggregate. */
function zoneOf(view: PlayerView, id: CardId): 'hand' | 'field' | 'orphan' {
  if (view.hand.includes(id)) return 'hand'
  const onField = ([0, 1] as const).some((p) =>
    [...view.fields[p].forwards, ...view.fields[p].backups].some((c) => c.id === id))
  return onField ? 'field' : 'orphan'
}

/**
 * The one of TWO forms this card's action must take, from the choices alone (rung I1). F6 had three, chosen
 * by what the click would do; no click commits now, so a sole choice is announced by its payment-free
 * HEADLINE and several by their count. The `N ways to pay` form is gone with the strip's payment chooser.
 */
function expectedAction(view: PlayerView, choices: ChoiceSet, id: CardId): string {
  const forCard = choices.byCard.get(id) ?? []
  if (forCard.length > 1) return `${forCard.length} options`
  return headline(view, forCard[0]!)
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
    let silent = 0
    const seen = { hand: 0, field: 0, orphan: 0 }
    const skipped = { hand: 0, field: 0, orphan: 0 }
    const examples: string[] = []
    for (const s of positions()) {
      const view = viewFor(s, HUMAN)
      const legal = legalCommands(s, HUMAN)
      const choices = buildChoiceSet(view, preferredChoices(view, legal), paymentAlternatives(legal))
      if (choices.byCard.size === 0) continue
      mount(s)
      for (const id of choices.byCard.keys()) {
        const zone = zoneOf(view, id)
        const said = announced(id)
        if (said === null) { skipped[zone]++; continue }   // in byCard but no button in this position
        seen[zone]++
        const want = expectedAction(view, choices, id)
        if (!endsWithAction(said, want)) {
          silent++
          if (examples.length < 4) examples.push(`${zone} ${id}: "${said}" is not "…, ${want}"`)
        }
      }
      act(() => { root?.unmount() }); host?.remove(); root = null; host = null
    }
    // PER ZONE, not in aggregate. A review showed the aggregate floor passes with an entire row missing:
    // drop all 65 orphan buttons and 378 remain, drop all 214 field buttons and 229 remain. The `continue`
    // above can swallow exactly the missing-button regression this test exists to catch, so each row has to
    // prove it was examined.
    expect(seen.hand, 'no HAND card was examined').toBeGreaterThan(50)
    expect(seen.field, 'no FIELD card was examined — the row F6 had to reach').toBeGreaterThan(50)
    expect(seen.orphan, 'no ORPHAN card was examined — the row F6 had to reach').toBeGreaterThan(20)
    expect(skipped, 'a card was in byCard but rendered no button — that IS the defect this test catches')
      .toEqual({ hand: 0, field: 0, orphan: 0 })
    expect(silent, `cards announcing no action: ${examples.join(' | ')}`).toBe(0)
    // The two mutations that make this test earn its place, and the second settles a review's CRITICAL:
    //   revert `actionFor`'s non-commit branch  -> 171 silent
    //   ALSO revert the field/orphan threading  -> 279 silent
    // The extra 108 are cards my first probe scored as fine because it measured the PREDICATE rather than
    // the rendered button — including committing ones like "Attack with Undead Princess", where the click
    // does commit and the card said only its power. Pre-F6 the real figure was 279 of 443, not 171.
    // For scale, this corpus is hand 164, field 214, orphan 65 — 443 card occurrences in all.
  }, 30_000)
})

describe('the two forms are exact (F6-A3, F6-A4, as rung I1 re-drew them)', () => {
  it('a sole-choice card names its headline — never a payment — and pressing it opens the sheet, not the move', () => {
    for (const s of positions()) {
      const view = viewFor(s, HUMAN)
      const legal = legalCommands(s, HUMAN)
      const choices = buildChoiceSet(view, preferredChoices(view, legal), paymentAlternatives(legal))
      const sole = [...choices.byCard.entries()].find(([, list]) => list.length === 1 && (list[0]?.alternatives?.length ?? 0) > 0)
      if (!sole) continue
      const { chosen } = mount(s)
      const [id, list] = sole
      const said = announced(id)
      if (said === null) { act(() => { root?.unmount() }); host?.remove(); root = null; host = null; continue }
      expect(endsWithAction(said, headline(view, list[0]!)), `"${said}" does not end in the headline`).toBe(true)
      expect(said, 'the card named a payment the press will not make').not.toContain('paying')
      act(() => { document.querySelector<HTMLElement>(`[data-card-id="${id}"] button`)!.click() })
      expect(chosen.length, 'pressing a card submitted a move').toBe(0)
      expect(document.querySelector('dialog[data-card-sheet]'), 'pressing the card did not open its sheet').not.toBeNull()
      return
    }
    throw new Error('no payable sole-choice card was ever reached, so this test asserts nothing')
  })

  it('a card with several choices names only their count, and submits nothing', () => {
    // The structural half. A string rule ("no payment, no target") passes on a leaked `Attack with Cloud`;
    // this fails on ANY leaked label, because the announced action must be the bare count.
    let checked = 0
    for (const s of positions()) {
      const view = viewFor(s, HUMAN)
      const legal = legalCommands(s, HUMAN)
      const choices = buildChoiceSet(view, preferredChoices(view, legal), paymentAlternatives(legal))
      const opens = [...choices.byCard.entries()].find(([, list]) => list.length > 1)
      if (!opens) continue
      const { chosen } = mount(s)
      const [id, list] = opens
      const said = announced(id)
      if (said === null) { act(() => { root?.unmount() }); host?.remove(); root = null; host = null; continue }
      checked++
      for (const c of list) expect(said, `a several-choice card leaked the label "${c.label}"`).not.toContain(c.label)
      expect(endsWithAction(said, expectedAction(view, choices, id)),
        `"${said}" does not end in exactly ", ${expectedAction(view, choices, id)}"`).toBe(true)
      act(() => { document.querySelector<HTMLElement>(`[data-card-id="${id}"] button`)!.click() })
      expect(chosen.length, 'a card that only opens a choice submitted something').toBe(0)
      if (checked >= 3) return
      act(() => { root?.unmount() }); host?.remove(); root = null; host = null
    }
    expect(checked, 'no several-choice card was ever reached').toBeGreaterThan(0)
  })
})
