import { act, createElement, type JSX } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { apply, applyChooseFirst, createGame, legalCommands, viewFor, type CardDef, type GameState } from '@fftcg/engine'
import { CARD_DEFS, DECKS } from '../src/deck.js'
import { Board } from '../src/ui/Board.js'
import { CardDetails } from '../src/ui/CardDetails.js'
import { buildChoiceSet, preferredChoices } from '../src/game/commands.js'
import { HUMAN, type Choice, type ChoiceSet, type GameApi } from '../src/game/types.js'

/**
 * The card details panel, driven through the REAL `Board` from a REAL mulligan view.
 *
 * The plan review refused the first version of this rung largely on this point: every criterion I had
 * written could pass with the panel wired to nothing. Testing `CardDetails` in isolation says the component
 * renders; it says nothing about whether `Board` stores the inspected card, passes the handlers down any of
 * its three card-rendering paths, or puts the panel in the rail. Those are the mutations that matter, and
 * only a mounted Board can catch them. `CardDetails`-only tests below are IN ADDITION, never instead.
 */

// jsdom has no layout, so it has no `scrollIntoView` — and the event log calls it on every render to keep
// the newest line visible. Stubbed rather than guarded in the component: the autoscroll is real behaviour
// that a browser does have, and making production code defensive about a test environment hides bugs.
Element.prototype.scrollIntoView = function scrollIntoView() {}

let root: Root | null = null
let host: HTMLDivElement | null = null

afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
  root = null; host = null
})

/** Every choice the board actually submitted, so an interaction that must NOT act can be asserted on. */
let chosen: Choice[] = []
/** The choice set the mounted board was given, so a test can pick a card by what it can DO, not by name. */
let mounted: ChoiceSet | null = null
let mountedState: GameState | null = null

/** The real opening position: first turn chosen, both hands dealt, the mulligan question on the table. */
function mulliganState(): GameState {
  const s = createGame({ seed: 1, decks: DECKS, defs: CARD_DEFS })
  const chooser = s.pending?.kind === 'chooseFirst' ? s.pending.player : HUMAN
  return applyChooseFirst(s, chooser, chooser === HUMAN)[0]
}

/**
 * Turn 1, Main Phase 1, both hands kept — the first position where a hand card is SELECTABLE, and therefore
 * the first where it is a real `<button>` that can take keyboard focus. The mulligan cannot serve here: it
 * is a subjectless command, so no hand card enters `choices.byCard` and every one renders as an unfocusable
 * `role="img"` div. That is rung E3a's stated gap, and it is why this position exists as its own fixture
 * rather than the focus case quietly riding on the mulligan one.
 */
function mainPhaseState(): GameState {
  let s = createGame({ seed: 1, decks: DECKS, defs: CARD_DEFS })
  const first = s.pending?.kind === 'chooseFirst' ? s.pending.player : HUMAN
  s = applyChooseFirst(s, first, first === HUMAN)[0]
  // Both players keep. `pending.player` names whose answer is owed, so this follows the engine rather than
  // assuming an order.
  for (let i = 0; i < 2 && s.pending?.kind === 'mulligan'; i++) {
    s = apply(s, { type: 'mulligan', player: s.pending.player, redraw: false }).state
  }
  return s
}

/**
 * Mounts the real Board on a real game state.
 *
 * Takes the STATE, not the view: `legalCommands` needs the full state, and the first version of this helper
 * passed the view with an `as never` cast. It happened to work at the mulligan, whose branch never touches
 * `state.players`, and blew up the moment a Main Phase position asked what was castable. A cast that silences
 * the type checker silences it about real mistakes too.
 */
function mount(s: GameState): void {
  chosen = []
  const v = viewFor(s, HUMAN)
  const legal = legalCommands(s, HUMAN)
  mountedState = s
  mounted = buildChoiceSet(v, preferredChoices(v, legal))
  const api: GameApi = {
    view: v,
    choices: mounted,
    log: [], aiThinking: false,
    choose: (c: Choice) => { chosen.push(c) },
    restart: () => {},
  }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root!.render(createElement(Board, { game: api })) })
}

const details = (): string => document.querySelector('.details')?.textContent ?? ''
const handCards = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('.hand .card')]
const named = (name: string): HTMLElement => {
  const el = handCards().find((c) => (c.getAttribute('aria-label') ?? '').startsWith(name))
  expect(el, `no card labelled "${name}" in hand — the fixture deck or seed changed`).toBeDefined()
  return el!
}
/** The printed name of a card instance in the mounted view, for matching against a rendered aria-label. */
const nameOf = (id: number): string => {
  const v = viewFor(mountedState!, HUMAN)
  const code = v.cards[id as never]?.code
  return (code === undefined ? undefined : v.defs[code]?.name) ?? '?'
}

const hover = (el: HTMLElement): void => {
  act(() => { el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })) })
}

// Ramuh is in the opening hand at seed 1, and its printed text is the same string the terminal prints.
// Written out by hand rather than read from `defs`, so a panel that renders the wrong field cannot agree
// with it by construction.
const RAMUH = 'Ramuh'
// The line breaks are the card's own: `cards.json` prints each of the three actions on its own line, and
// the panel must keep them (`white-space: pre-line`) or they run together into one unreadable paragraph.
const RAMUH_TEXT = [
  'Select up to 2 of the 3 following actions.',
  '"Choose 1 Forward. Dull it."',
  '"Choose 1 Forward. Deal it 5000 damage."',
  '"Choose 1 Forward. It gains Haste until the end of the turn."',
].join('\n')

describe('the details panel, in a real Board at the mulligan', () => {
  it('shows a hovered hand card’s full printed text', () => {
    mount(mulliganState())
    expect(details(), 'the panel should start empty').not.toContain(RAMUH_TEXT)
    hover(named(RAMUH))
    expect(details()).toContain(RAMUH_TEXT)
  })

  it('keeps the text when the pointer leaves the card', () => {
    // Reading a card and then moving to the button that acts on it must not blank what you just read.
    mount(mulliganState())
    hover(named(RAMUH))
    act(() => { named(RAMUH).dispatchEvent(new MouseEvent('mouseout', { bubbles: true })) })
    act(() => { document.body.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })) })
    expect(details()).toContain(RAMUH_TEXT)
  })

  it('shows a hovered SELECTABLE card’s text too', () => {
    // A selectable card renders as a `<button>` and a non-selectable one as a `role="img"` div — two
    // different elements, two different sets of handlers. The mulligan cases above only exercise the div,
    // so removing the hover handler from the button survived them all: a player hovering a castable card in
    // Main Phase 1 would have got nothing, silently. Found by mutation, not by reading the code.
    mount(mainPhaseState())
    const btn = named(RAMUH)
    expect(btn.tagName, 'this position is meant to render castable cards as buttons').toBe('BUTTON')
    hover(btn)
    expect(details()).toContain(RAMUH_TEXT)
  })

  it('does not submit a choice for looking at a card', () => {
    mount(mulliganState())
    hover(named(RAMUH))
    expect(chosen, 'hovering a card played it').toEqual([])
  })
})

describe('the details panel, driven by keyboard focus', () => {
  it('shows a focused hand card’s printed text, without hovering it', () => {
    // Focus, NOT hover, and asserted separately: a handler wired to only one of the two satisfies any test
    // that merely checks "the panel updated". No mouse event is dispatched anywhere in this test.
    mount(mainPhaseState())
    const btn = named(RAMUH)
    expect(btn.tagName, 'a castable hand card must be a real button or it cannot take focus at all').toBe('BUTTON')
    expect(details()).not.toContain(RAMUH_TEXT)
    act(() => { (btn as HTMLButtonElement).focus() })
    expect(details()).toContain(RAMUH_TEXT)
  })

  it('does not play a card that is merely focused', () => {
    mount(mainPhaseState())
    act(() => { (named(RAMUH) as HTMLButtonElement).focus() })
    expect(chosen, 'focusing a card played it').toEqual([])
  })

  it('still plays a card on a real click', () => {
    // The inspect handlers must not have displaced the click. Picked by what the card can DO — exactly one
    // way to play it, so a click submits rather than opening a variant menu — rather than by name, which
    // would re-break the day the seed deals a different hand.
    mount(mainPhaseState())
    const single = [...(mounted?.byCard ?? new Map())].find(([, cs]) => cs.length === 1)
    expect(single, 'no hand card with a single way to play it, so this position cannot test a click').toBeDefined()
    const el = handCards().find((c) => (c.getAttribute('aria-label') ?? '').startsWith(nameOf(single![0])))
    expect(el?.tagName, 'the card with a single choice is not rendered as a button').toBe('BUTTON')
    act(() => { (el as HTMLButtonElement).click() })
    expect(chosen.length, 'clicking a castable card no longer plays it').toBe(1)
    expect(chosen[0]).toBe(single![1][0])
  })
})

// ── Component-level cases, for defs the pool cannot produce ────────────────────────────────────────────

const def = (over: Partial<CardDef>): CardDef => ({
  code: 'X-001', name: 'Fixture', type: 'forward', elements: ['fire'], cost: 1,
  power: 1000, keywords: [], generic: false, exBurst: false, text: '', hasAbilities: false,
  ...over,
})

function renderDetails(d: CardDef | undefined): string {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root!.render(createElement(CardDetails, { def: d }) as JSX.Element) })
  return document.querySelector('.details')?.textContent ?? ''
}

describe('the details panel, on defs the current pool cannot produce', () => {
  it('shows the complete printed text INCLUDING a clause this build does not implement, and says so', () => {
    // The single most important case in this rung. For Cloud, joining the implemented clause texts
    // reconstructs `def.text` exactly — so a panel rendering `abilities.map(a => a.text).join()` passes a
    // test written against a real named card, while dropping precisely the unimplemented printed clauses
    // this panel exists to disclose. This fixture's `text` is deliberately NOT the concatenation of its
    // implemented clauses, so that mutant cannot survive.
    const out = renderDetails(def({
      hasAbilities: true, abilityClauses: 2,
      text: 'Implemented clause. UNIMPLEMENTED CLAUSE.',
      abilities: [{ id: 'a', text: 'Implemented clause.', trigger: { kind: 'onCast' }, effects: [] }] as never,
    }))
    expect(out, 'the unimplemented clause was dropped — the panel is rendering the AST, not the card').toContain('UNIMPLEMENTED CLAUSE.')
    expect(out).toContain('Implemented clause.')
    expect(out.toLowerCase(), 'no caveat, so the player would plan around a clause that never fires').toContain('not implemented in this build')
  })

  it('shows printed keyword-only text with no caveat', () => {
    // `hasAbilities` deliberately excludes keyword-only lines during normalisation, so it is NOT a proxy for
    // "has printed text". A panel gated on it drops a printed Haste from any future keyword-only card.
    const out = renderDetails(def({ hasAbilities: false, text: 'Haste' }))
    expect(out).toContain('Haste')
    expect(out.toLowerCase()).not.toContain('not implemented in this build')
  })

  it('renders no text block and no caveat for a card that prints nothing', () => {
    const out = renderDetails(def({ hasAbilities: false, text: '' }))
    expect(document.querySelector('.details__text'), 'an empty paragraph for a card with no text').toBe(null)
    expect(out.toLowerCase()).not.toContain('not implemented in this build')
  })

  it('prompts rather than showing a blank panel before anything is inspected', () => {
    expect(renderDetails(undefined).length).toBeGreaterThan(0)
  })
})
