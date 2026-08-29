import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, createElement, type JSX } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { actingPlayer, apply, applyChooseFirst, createGame, legalCommands, viewFor, type CardDef, type CardId, type Command, type GameState, type PlayerView } from '@fftcg/engine'
import { CARD_DEFS, DECKS } from '../src/deck.js'
import { Board } from '../src/ui/Board.js'
import { GreedyAgent } from '@fftcg/ai'
import { stepAi } from '../src/game/useGame.js'
import { Card, type CardProps } from '../src/ui/Card.js'
import { CardDetails } from '../src/ui/CardDetails.js'
import { buildChoiceSet, preferredChoices } from '../src/game/commands.js'
import { AI, HUMAN, type Choice, type ChoiceSet, type GameApi } from '../src/game/types.js'

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
/**
 * A position with a Forward on the player's own field, reached by actually casting one.
 *
 * The field is a THIRD Board render path (`FieldCardView`), separate from the hand and from orphan targets,
 * and it had no behavioural coverage at all: every helper in this file selects `.hand .card`, so deleting the
 * field's `onInspect` forwarding left all eleven tests green. Reading a Forward's text is not a marginal
 * case — it is what a player does before deciding an attack or a block.
 */
function fieldState(): GameState {
  let s = mainPhaseState()
  const cast = legalCommands(s, HUMAN).find((c) => c.type === 'castCharacter')
  if (!cast) throw new Error('no castable character in the opening Main Phase — the fixture deck or seed changed')
  s = apply(s, cast).state
  return s
}

/** A position with a FORWARD on the human's field — not merely the first castable character, which is a
 *  Backup at this seed and has no power for a power assertion to bite on. */
function forwardOnFieldState(): GameState {
  let s = mainPhaseState()
  for (let i = 0; i < 40 && s.players[HUMAN].forwards.length === 0; i++) {
    const v = viewFor(s, HUMAN)
    const cast = legalCommands(s, HUMAN).find((c) =>
      c.type === 'castCharacter' && v.defs[v.cards[c.card]?.code ?? '']?.type === 'forward')
    const next = cast ?? legalCommands(s, HUMAN).find((c) => c.type === 'pass')
    if (!next) break
    s = apply(s, next).state
  }
  return s
}

function mount(s: GameState): void {
  mountView(viewFor(s, HUMAN), legalCommands(s, HUMAN), s)
}

/** Renders a NEW state into the SAME root, the way a real command updates the board — focus is not reset. */
function remount(s: GameState): void {
  const v = viewFor(s, HUMAN)
  mountedState = s
  mounted = buildChoiceSet(v, preferredChoices(v, legalCommands(s, HUMAN)))
  const api: GameApi = {
    view: v, choices: mounted, log: [], aiThinking: false,
    choose: (c: Choice) => { chosen.push(c) }, restart: () => {},
  }
  act(() => { root!.render(createElement(Board, { game: api })) })
}

/** Mounts from an explicit view and command list, for a position real play cannot cheaply reach. */
function mountView(v: PlayerView, legal: Command[], s?: GameState): void {
  chosen = []
  mountedState = s ?? null
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
/**
 * The element that ANNOUNCES a named hand card — which is not always the card itself. A card with no button
 * of its own is focused through its grid cell, so the cell carries the name and the card stands down; a
 * castable card keeps both on its own button.
 */
const named = (name: string): HTMLElement => {
  const el = [...document.querySelectorAll<HTMLElement>('.hand [role="gridcell"], .hand .card')]
    .find((c) => (c.getAttribute('aria-label') ?? '').startsWith(name))
  expect(el, `no card labelled "${name}" in hand — the fixture deck or seed changed`).toBeDefined()
  return el!
}
/** The printed name of a card instance in the mounted view, for matching against a rendered aria-label. */
const nameOf = (id: CardId): string => {
  const v = viewFor(mountedState!, HUMAN)
  const code = v.cards[id]?.code
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

  it('does not PLAY a card merely hovered, when hovering it could', () => {
    // The mulligan case above cannot catch this. A non-selectable card has no `onClick` at all, so wiring
    // hover to the click there is a no-op — the mutant `onMouseEnter={() => { onInspect?.(); onClick?.() }}`
    // survived every one of the eleven tests, while hovering a castable card played it. The dangerous branch
    // is the SELECTABLE one, so the assertion has to be made where the card actually has something to do.
    mount(mainPhaseState())
    hover(named(RAMUH))
    expect(chosen, 'hovering a castable card played it').toEqual([])
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

describe('the route a keyboard takes through the board', () => {
  it('reaches the cards BEFORE the buttons that commit to them', () => {
    // At the mulligan the prompt offers "Keep hand", "Mulligan" and "Concede" — irreversible, all three —
    // and the DOM used to render it before the hand, so a keyboard player met the controls before the five
    // cards they were being asked about. The grid places every section by explicit `grid-area`, so fixing
    // the order moves nothing on screen and NOTHING VISUAL WOULD REVEAL A REGRESSION. Hence this test.
    mount(mulliganState())
    // Take the MOST specific class, not the first: `table__seat table__seat--player` starts with
    // `table__seat`, so mapping to the first match recorded that instead and `indexOf('table__seat--player')`
    // was permanently -1 — which is less than every real index, so the ordering assertion below could not
    // fail however the sections were arranged.
    const order = [...document.querySelectorAll<HTMLElement>('.table__hand, .table__prompt, .table__seat--player')]
      .map((el) => el.className.split(' ').filter((c) => c.startsWith('table__')).sort((a, b) => b.length - a.length)[0] ?? '')
    expect(order.indexOf('table__hand'), 'the hand is not rendered').toBeGreaterThanOrEqual(0)
    expect(order.indexOf('table__prompt'), 'the prompt is not rendered').toBeGreaterThanOrEqual(0)
    expect(
      order.indexOf('table__hand') < order.indexOf('table__prompt'),
      'the commitment controls come before the cards again',
    ).toBe(true)
    expect(
      order.indexOf('table__seat--player') < order.indexOf('table__hand'),
      'your own board should be read before your hand',
    ).toBe(true)
  })
})

describe('the hand as a keyboard grid (rung E3b-1)', () => {
  const cells = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('.hand [role="gridcell"]')]
  /** What actually takes focus for a card: its button when it has one, else the cell. */
  const target = (cell: HTMLElement): HTMLElement => cell.querySelector('button') ?? cell
  const press = (key: string): void => {
    act(() => { document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })) })
  }

  it('makes the MULLIGAN hand reachable at all — the defect E3 was written about', () => {
    // At the mulligan no hand card is selectable, so before this every card was a `role="img"` div outside
    // the tab order and there was no key that reached one. The opening decision of every game, made blind.
    mount(mulliganState())
    expect(cells()).toHaveLength(5)
    const first = target(cells()[0]!)
    act(() => { first.focus() })
    expect(document.activeElement, 'the first card cannot take focus').toBe(first)
  })

  it('moves across the hand with arrow keys, and to the ends with Home/End', () => {
    mount(mulliganState())
    act(() => { target(cells()[0]!).focus() })
    press('ArrowRight')
    expect(document.activeElement).toBe(target(cells()[1]!))
    press('ArrowRight')
    expect(document.activeElement).toBe(target(cells()[2]!))
    press('ArrowLeft')
    expect(document.activeElement).toBe(target(cells()[1]!))
    press('End')
    expect(document.activeElement).toBe(target(cells()[4]!))
    press('Home')
    expect(document.activeElement).toBe(target(cells()[0]!))
  })

  it('stops at the ends rather than wrapping', () => {
    // Wrapping is a choice, not a default; a row that silently teleports from the last card to the first is
    // disorienting without a visible cursor. Pinned so it is a decision rather than an accident.
    mount(mulliganState())
    act(() => { target(cells()[0]!).focus() })
    press('ArrowLeft')
    expect(document.activeElement, 'moving left off the first card wrapped to the last').toBe(target(cells()[0]!))
    press('End')
    press('ArrowRight')
    expect(document.activeElement, 'moving right off the last card wrapped to the first').toBe(target(cells()[4]!))
  })

  it('keeps exactly one tab stop in the hand, wherever the cursor is', () => {
    // The whole point of a roving tabindex. Two stops and Tab lands inside the row; none and the row is
    // unreachable. No behavioural observable exists for this under jsdom — it has no Tab traversal — so the
    // attribute is the only available evidence, and saying so is better than dressing it up.
    mount(mulliganState())
    const stops = () => [...document.querySelectorAll('.hand [tabindex="0"], .hand button:not([tabindex="-1"])')]
    expect(stops()).toHaveLength(1)
    act(() => { target(cells()[0]!).focus() })
    press('ArrowRight')
    expect(stops(), 'moving the cursor left more than one tab stop behind').toHaveLength(1)
  })

  it('reads the focused card into the details panel', () => {
    // E3a wired inspection to focus; this rung only had to make focus reachable. If that seam broke, the
    // keyboard player can move but still cannot read.
    mount(mulliganState())
    const ramuh = cells().find((c) => (c.textContent ?? '').includes('Ramuh'))
    expect(ramuh, 'Ramuh is not in the opening hand — the fixture deck or seed changed').toBeDefined()
    act(() => { target(ramuh!).focus() })
    expect(details()).toContain(RAMUH_TEXT)
  })

  it('claims the arrow keys it handles, so they do not also scroll', () => {
    // The mirror of the Enter/Space test below. A navigation key that is handled AND left to the browser
    // does two things at once: focus moves and the page scrolls — and since the card rows became
    // horizontally scrollable, the row itself scrolls out from under the card being focused. Found by my own
    // mutation sweep: deleting `preventDefault()` passed all 58 tests.
    mount(mulliganState())
    for (const key of ['ArrowRight', 'ArrowLeft', 'Home', 'End']) {
      act(() => { target(cells()[1]!).focus() })
      const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
      act(() => { document.activeElement!.dispatchEvent(ev) })
      expect(ev.defaultPrevented, `${key} was handled but left to the browser as well`).toBe(true)
    }
  })

  it('leaves Enter and Space to the card, and arrows do not play it', () => {
    mount(mainPhaseState())
    act(() => { target(cells()[0]!).focus() })
    press('ArrowRight')
    expect(chosen, 'an arrow key played a card').toEqual([])

    // Actually SEND Enter and Space. The previous version of this test sent only ArrowRight and then
    // asserted the element was a button — which a mutant calling `preventDefault()` on Enter survives
    // happily, while real keyboard activation is broken. jsdom does not synthesise a click from Enter, so
    // what is checked is that the grid does not swallow the event: it must reach the button undefended.
    // `defaultPrevented` is read AFTER dispatch, not inside a listener on the button. Events bubble target
    // first, so a listener there runs BEFORE the grid's handler and always sees `false` — the original
    // version of this test could not detect the grid preventing anything. Found by mutation: hoisting
    // `preventDefault()` above the key check, which would swallow Tab and Enter alike, passed it.
    for (const key of ['Enter', ' ', 'Tab']) {
      const btn = target(cells()[1]!)
      let reached = false
      const spy = (): void => { reached = true }
      btn.addEventListener('keydown', spy)
      const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
      act(() => { btn.dispatchEvent(ev) })
      btn.removeEventListener('keydown', spy)
      expect(reached, `${key} never reached the card`).toBe(true)
      expect(ev.defaultPrevented, `the grid swallowed ${key}, so the card can never be activated or left`).toBe(false)
    }
  })

  it('announces name and printed text on the element that ACTUALLY takes focus', () => {
    // The MAJOR from review 25. At the mulligan focus lands on the gridcell, but the name and
    // `aria-describedby` sat on its unfocused `role="img"` child — so the focused element announced nothing,
    // and the card's `.sr-only` text risked being folded into the cell's name instead, defeating the whole
    // concise-name / verbose-description split. The earlier tests inspected `.card` and so enforced the
    // child's relation while proving nothing about what a screen reader lands on.
    mount(mulliganState())
    const cell = cells()[0]!
    act(() => { target(cell).focus() })
    expect(document.activeElement, 'the cell is not the focus target at the mulligan').toBe(cell)

    const name = cell.getAttribute('aria-label')
    expect(name, 'the focused element has no accessible name').not.toBe(null)
    expect(name).toMatch(/^\w[^,]*, cost \d/)
    const descId = cell.getAttribute('aria-describedby')
    expect(descId, 'the focused element has no accessible description').not.toBe(null)
    expect(document.getElementById(descId!)?.textContent ?? '', 'the description is empty').not.toBe('')

    // And the card inside must have stood down, or everything is announced twice.
    const inner = cell.querySelector('.card')!
    expect(inner.getAttribute('aria-hidden'), 'the card still announces itself under the cell').toBe('true')
    expect(inner.getAttribute('aria-label'), 'the card kept a competing name').toBe(null)
  })

  it('leaves a SELECTABLE card announcing itself, since its button is the focus target', () => {
    // The other branch: a castable card keeps name and description on its own button, and the cell must not
    // duplicate them — two names for one thing is as bad as none.
    mount(mainPhaseState())
    const cell = cells()[0]!
    expect(cell.getAttribute('aria-label'), 'the cell competed with the button it contains').toBe(null)
    const btn = cell.querySelector('button')!
    expect(btn.getAttribute('aria-label')).toMatch(/, cost \d/)
    expect(btn.getAttribute('aria-describedby'), 'a castable card lost its description').not.toBe(null)
  })

  it('arrows move from wherever focus actually IS, not from where the grid last put it', () => {
    // A player can arrive at a card without arrow keys — by clicking it, or by Shift+Tabbing back into the
    // row. If the roving position does not follow, the next arrow press moves relative to a stale card and
    // jumps somewhere unrelated.
    mount(mulliganState())
    act(() => { target(cells()[3]!).focus() })      // straight to the fourth card, no arrows used
    press('ArrowRight')
    expect(document.activeElement, 'the arrow moved from the grid’s remembered card, not the focused one')
      .toBe(target(cells()[4]!))
  })

  it('recovers focus when the focused card leaves the hand', () => {
    // Casting the card you are standing on unmounts it, and the browser drops focus to `document.body` —
    // from which a keyboard player is tabbing in from the top of the document again, past everything. This
    // is the least-tested code in the rung and the case a real player hits on their first turn.
    const before = mainPhaseState()
    mount(before)
    const cast = legalCommands(before, HUMAN).find((c) => c.type === 'castCharacter' || c.type === 'castSummon')
    expect(cast, 'nothing castable, so nothing can leave the hand').toBeDefined()
    const goneId = (cast as { card: CardId }).card
    const cell = document.querySelector<HTMLElement>(`.hand [data-card-id="${goneId}"]`)
    expect(cell, 'the card about to be cast is not in the rendered hand').not.toBe(null)
    act(() => { (cell!.querySelector('button') ?? cell!).focus() })
    expect(document.activeElement === document.body).toBe(false)

    // The same Board, one command later — the focused card is gone from the hand.
    const after = apply(before, cast!).state
    remount(after)
    expect(document.activeElement, 'focus fell to the document body when a card was played').not.toBe(document.body)
    expect(document.querySelector('.hand')?.contains(document.activeElement), 'focus left the hand entirely').toBe(true)
  })

  it('does not steal focus when a hand it does not own changes', () => {
    // The mirror of the case above, and the reason the repair is guarded: a zone that was not being used
    // must never yank focus away. Here the player is on a prompt button when the hand changes underneath.
    const before = mainPhaseState()
    mount(before)
    const pass = document.querySelector<HTMLButtonElement>('.prompt__actions button')
    expect(pass, 'no prompt action to hold focus').not.toBe(null)
    act(() => { pass!.focus() })
    const cast = legalCommands(before, HUMAN).find((c) => c.type === 'castCharacter' || c.type === 'castSummon')
    remount(apply(before, cast!).state)
    expect(document.querySelector('.hand')?.contains(document.activeElement), 'the hand stole focus off the prompt').toBe(false)
  })

  it('forgets it owned focus once focus has LEFT it', () => {
    // "Owned focus" must mean "owns it now", not "owned it once". Codex found exactly that bug in
    // PromptStrip — a provenance ref set on focusin and never cleared — and a grid with the same flaw pulls
    // the player back off the button they had deliberately tabbed to. Found by mutation: deleting the blur
    // handler passed every other test here, because none of them ever left the hand after entering it.
    const before = mainPhaseState()
    mount(before)
    const cell = document.querySelector<HTMLElement>('.hand [data-card-id]')
    act(() => { (cell!.querySelector('button') ?? cell!).focus() })          // the hand owns focus
    const pass = document.querySelector<HTMLButtonElement>('.prompt__actions button')
    act(() => { pass!.focus() })                                             // and now it does not
    const cast = legalCommands(before, HUMAN).find((c) => c.type === 'castCharacter' || c.type === 'castSummon')
    remount(apply(before, cast!).state)
    expect(
      document.querySelector('.hand')?.contains(document.activeElement),
      'the hand pulled focus back after the player had deliberately left it',
    ).toBe(false)
  })

  it('is a labelled grid, not a listbox', () => {
    // A listbox means SELECTING an option, which is false for a hand at the mulligan where nothing is
    // playable. A layout grid means "these widgets share one tab stop", which is what is true.
    mount(mulliganState())
    const grid = document.querySelector('.hand')
    expect(grid?.getAttribute('role')).toBe('grid')
    expect(grid?.getAttribute('aria-label'), 'the hand had no accessible name at all before this').toBe('Your hand')
    expect(document.querySelector('.hand [role="row"]')).not.toBe(null)
  })
})

describe('the field zones as keyboard grids (rung E3b-2)', () => {
  const zoneGrid = (label: string): HTMLElement | null =>
    document.querySelector<HTMLElement>(`[role="grid"][aria-label="${label}"]`)

  it('gives a non-empty field zone a labelled grid, and an empty one none', () => {
    // An empty grid has no tab stop to give and nothing to say, and four field rows are empty for most of a
    // game — a keyboard player should not be tabbing through announcements of nothing.
    const s = fieldState()
    mount(s)
    const v = viewFor(s, HUMAN)
    const mine = v.fields[HUMAN].forwards.length > 0 ? 'Your Forwards' : 'Your Backups'
    expect(zoneGrid(mine), `${mine} holds a card but is not a grid`).not.toBe(null)
    expect(zoneGrid('AI Forwards'), 'an empty zone rendered a grid with no cells').toBe(null)
  })

  it('makes a card on the field focusable and readable', () => {
    const s = fieldState()
    mount(s)
    const v = viewFor(s, HUMAN)
    const placed = [...v.fields[HUMAN].forwards, ...v.fields[HUMAN].backups][0]!
    const code = v.cards[placed.id]?.code
    const def = code === undefined ? undefined : v.defs[code]
    const cell = document.querySelector<HTMLElement>(`.zone [data-card-id="${placed.id}"]`)
    expect(cell, 'the field card is not in a grid cell').not.toBe(null)
    const focusTarget = cell!.querySelector('button') ?? cell!
    act(() => { focusTarget.focus() })
    expect(document.activeElement, 'the field card cannot take focus').toBe(focusTarget)
    expect(details(), 'focusing a field card does not read it').toContain(def?.text)
  })

  it('announces a field card’s pumps, damage and dullness, not just its printed numbers', () => {
    // The refactor routes every field card through `fieldCardProps`. Deleting `powerBonus`, `granted`,
    // `flags`, `damage` or `dull` from it left the whole suite green, because the props and the component
    // were only ever tested apart. This mounts a real Board on a field card carrying all of them and pins
    // the exact string its focused cell announces.
    // A FORWARD specifically. `fieldState()` casts the first castable character, which at this seed is a
    // Backup with `power === null` — so the power assertions below sat behind an `if` that never ran, and
    // dropping `powerBonus` or `damage` from the props survived. A conditional that silently skips is the
    // same defect as a test that cannot fail.
    const base = forwardOnFieldState()
    const v = structuredClone(viewFor(base, HUMAN))
    const mine = v.fields[HUMAN].forwards[0]
    expect(mine, 'no Forward reached the field, so the power assertions cannot run').toBeDefined()
    expect(v.defs[v.cards[mine!.id]?.code ?? '']?.power, 'the field card has no printed power').not.toBe(null)
    const pumped = { ...mine!, powerBonus: 3000, damage: 1000, status: 'dull' as const, granted: ['haste' as const] }
    v.fields[HUMAN] = { ...v.fields[HUMAN], forwards: [pumped] }
    mountView(v, [])

    const cell = document.querySelector<HTMLElement>(`.zone [data-card-id="${mine!.id}"]`)
    expect(cell, 'the modified field card did not render').not.toBe(null)
    const said = (cell!.querySelector('button') ?? cell!).getAttribute('aria-label') ?? ''
    const printed = v.defs[v.cards[mine!.id]?.code ?? '']?.power
    expect(printed, 'the fixture Forward has no printed power').not.toBe(null)
    // Effective power is printed + pump, and the REMAINING number subtracts marked damage — the card face
    // shows what is left, which is a different quantity from the power it DEALS (see the block prompt).
    expect(said, 'the pump is missing from what the card announces').toContain(`power ${printed! + 3000 - 1000} of ${printed! + 3000}`)
    expect(said, 'the expiring pump is not explained').toContain('including 3000 that expires at the end of the turn')
    expect(said, 'a dull card does not say so').toContain('dull')
    expect(said, 'a granted keyword is not announced').toContain('Haste granted')
  })

  it('lets a blocker be chosen with the ATTACKER readable — the case E3a could not serve', () => {
    // Deciding a block means reading a Forward on the opponent's side of the board. Reached by playing, not
    // hand-built: the fixture-that-cannot-occur mistake has been made twice in this program already.
    //
    // The first version stopped at the first `declareBlock` it saw. At that position both of the human's
    // Forwards were DULL, so the only legal answer was "don't block" — no blocker button existed at all, and
    // `selectable = false` would have removed every one of them with this test still green. It now requires
    // a position where a blocker can actually be declared.
    // Seed 1, not 7. Seed 7 does reach a `declareBlock`, but with both of the human's Forwards dull — so it
    // offers no legal blocker at all, which is exactly why the first version of this test proved nothing.
    // Seeds 1 through 5 all reach a position where a blocker can really be declared.
    let s: GameState = createGame({ seed: 1, decks: DECKS, defs: CARD_DEFS })
    const agent = new GreedyAgent({ seed: 1, decks: DECKS, depth: 1 })
    const canBlock = (g: GameState): boolean =>
      g.pending?.kind === 'declareBlock' && g.pending.player === HUMAN
      && legalCommands(g, HUMAN).some((c) => c.type === 'declareBlock' && c.blocker !== null)
    for (let i = 0; i < 8000 && !s.result && !canBlock(s); i++) {
      if (actingPlayer(s) === null) break
      s = stepAi(s, agent).state
    }
    expect(canBlock(s), 'never reached a block decision with a legal blocker, so this asserts nothing').toBe(true)
    expect(s.pending?.player, 'stopped at the AI decision, not the human one').toBe(HUMAN)
    mount(s)

    // The attacker must be readable — with a NEGATIVE precondition, because the panel already says
    // "Point at a card to read it." before anything is inspected, so a length check alone is permanently
    // true and a no-op `onLookAt` survives it.
    const attackerId = (s.attack?.attackers ?? [])[0]!
    const v = viewFor(s, HUMAN)
    const attackerName = (v.defs[v.cards[attackerId]?.code ?? '']?.name) ?? '?'
    expect(details(), 'the panel showed the attacker before anything was focused').not.toContain(attackerName)
    const attacker = document.querySelector<HTMLElement>(`.zone [data-card-id="${attackerId}"]`)
    expect(attacker, 'the attacker is not reachable in any grid').not.toBe(null)
    act(() => { (attacker!.querySelector('button') ?? attacker!).focus() })
    expect(details(), 'focusing the attacker did not read it').toContain(attackerName)

    // And a blocker must actually be a button, or the decision cannot be taken by keyboard at all.
    const blockerId = legalCommands(s, HUMAN)
      .flatMap((c) => (c.type === 'declareBlock' && c.blocker !== null ? [c.blocker] : []))[0]!
    const blockerCell = document.querySelector<HTMLElement>(`.zone [data-card-id="${blockerId}"]`)
    expect(blockerCell, 'the legal blocker is not rendered in a grid').not.toBe(null)
    const btn = blockerCell!.querySelector('button')
    expect(btn, 'a legal blocker is not a button, so it cannot be chosen').not.toBe(null)
    act(() => { btn!.click() })
    expect(chosen.map((c) => c.command.type), 'clicking the blocker did not declare a block').toContain('declareBlock')
  })
})

describe('the public piles, opened and read (rung E3b-3)', () => {
  /** A position where somebody's Break Zone actually holds cards, reached by playing. */
  function withBreakZone(): GameState {
    const agent = new GreedyAgent({ seed: 7, decks: DECKS, depth: 1 })
    let s: GameState = createGame({ seed: 7, decks: DECKS, defs: CARD_DEFS })
    for (let i = 0; i < 4000 && !s.result; i++) {
      if (s.players[HUMAN].breakZone.length > 0 || s.players[AI].breakZone.length > 0) break
      if (actingPlayer(s) === null) break
      s = stepAi(s, agent).state
    }
    return s
  }

  const opener = (name: RegExp): HTMLButtonElement | undefined =>
    [...document.querySelectorAll<HTMLButtonElement>('.seat button')]
      .find((b) => name.test(b.getAttribute('aria-label') ?? ''))

  /**
   * The opener belonging to a SPECIFIC seat. Matching on the pile name alone finds whichever seat renders
   * first, which is the AI — so a test about the human's damage zone opened the AI's and then looked for a
   * card that was never rendered.
   */
  const ownerOpener = (owner: 0 | 1, pile: string): HTMLButtonElement | undefined =>
    opener(new RegExp(`^${owner === HUMAN ? 'Your' : "the AI's"} ${pile}, \\d+ cards?$`))

  it('shows a non-empty pile as something openable, and says how many are in it', () => {
    const s = withBreakZone()
    const total = s.players[HUMAN].breakZone.length + s.players[AI].breakZone.length
    expect(total, 'no Break Zone ever filled, so this test asserts nothing').toBeGreaterThan(0)
    mount(s)
    const btn = opener(/Break Zone, \d+ cards?$/)
    expect(btn, 'a non-empty Break Zone is not openable').toBeDefined()
    expect(btn!.getAttribute('aria-expanded'), 'the pile claims to be open before it is').toBe('false')
  })

  /** A position where `kind` holds cards for `owner`, reached by playing. */
  function withPile(owner: 0 | 1, kind: 'breakZone' | 'damageZone' | 'removedFromGame'): GameState | null {
    for (const seed of [1, 2, 3, 5, 7, 11]) {
      let s: GameState = createGame({ seed, decks: DECKS, defs: CARD_DEFS })
      const agent = new GreedyAgent({ seed, decks: DECKS, depth: 1 })
      for (let i = 0; i < 4000 && !s.result; i++) {
        if (s.players[owner][kind].length > 0) return s
        if (actingPlayer(s) === null) break
        s = stepAi(s, agent).state
      }
    }
    return null
  }

  /**
   * The focused element must announce the card's printed text, not merely put it on screen.
   *
   * Removing `text` from `pileItems` passed all 299 web tests: the cell still announced its name, cost, type
   * and power, and the visible panel still worked, while a screen reader could not read the card's abilities
   * at all. The pile tests were checking the PANEL — and this same suite already contains a test asserting
   * the panel is not an accessible substitute. Testing the visible surface instead of the accessible
   * relation is the exact mistake the E3b-1 review caught, made again one rung later.
   */
  const expectDescribedBy = (el: HTMLElement, text: string): void => {
    const id = el.getAttribute('aria-describedby')
    expect(id, 'the focused card in a pile has no accessible description').not.toBe(null)
    expect(document.getElementById(id!)?.textContent, 'the description does not carry the printed text').toBe(text)
  }

  /** The printed text of the first card in a pile, from the STATE — never from the DOM under test. */
  const firstCardText = (s: GameState, owner: 0 | 1, kind: 'breakZone' | 'damageZone' | 'removedFromGame'): string => {
    const v = viewFor(s, HUMAN)
    const id = s.players[owner][kind][0]!
    return v.defs[v.cards[id]?.code ?? '']?.text ?? ''
  }

  /** The name of the first card in a pile, from the STATE — never from the DOM the test is checking. */
  const firstCardName = (s: GameState, owner: 0 | 1, kind: 'breakZone' | 'damageZone' | 'removedFromGame'): string => {
    const v = viewFor(s, HUMAN)
    const id = s.players[owner][kind][0]!
    return v.defs[v.cards[id]?.code ?? '']?.name ?? '?'
  }

  it('renders pile cards as inert cells, not as buttons that do nothing', () => {
    // `cell.querySelector('button') ?? cell` is how the other pile tests find a focus target, and it accepts
    // EITHER structure — so flipping pile cards to `selectable: true` passed all 878 tests while turning
    // every inert card into an actionless `<button aria-pressed="false">`. A test that accepts two shapes
    // certifies neither. Nothing in a pile can be played, so nothing in a pile is a button.
    const s = withPile(HUMAN, 'breakZone') ?? withPile(AI, 'breakZone')
    expect(s).not.toBe(null)
    const owner = s!.players[HUMAN].breakZone.length > 0 ? HUMAN : AI
    mount(s!)
    act(() => { ownerOpener(owner, 'Break Zone')!.click() })
    const grid = document.querySelector<HTMLElement>('[role="grid"][aria-label*="Break Zone"]')
    expect(grid, 'the pile did not open').not.toBe(null)
    expect(grid!.querySelectorAll('button').length, 'a pile card is a button, but there is nothing to press').toBe(0)
    const cell = grid!.querySelector<HTMLElement>('[role="gridcell"]')!
    expect(cell.getAttribute('tabindex'), 'the cell is not the focus target for an inert card').toBe('0')
    act(() => { cell.focus() })
    expect(document.activeElement, 'the pile cell cannot take focus').toBe(cell)
  })

  it('opens the pile and READS it — not merely opens it', () => {
    // The reason this rung exists: Luso asks whether to take its "Character in your Break Zone" mode, and
    // whether Billy Bob is worth casting, BEFORE any target choice is raised. The orphan target row comes
    // too late to answer either. Until now the board showed the pile only as a number.
    //
    // The earlier version ended at `details().length > 0`, which the panel's own "Point at a card to read
    // it." placeholder already satisfies — so replacing the pile's `onLookAt` with a no-op left all 55 tests
    // green. This is the THIRD time that assertion shape has been caught; it now has a negative precondition
    // and an expected name.
    const s = withPile(HUMAN, 'breakZone') ?? withPile(AI, 'breakZone')
    expect(s, 'no Break Zone ever filled, so this test asserts nothing').not.toBe(null)
    const owner = s!.players[HUMAN].breakZone.length > 0 ? HUMAN : AI
    const name = firstCardName(s!, owner, 'breakZone')
    mount(s!)
    const btn = ownerOpener(owner, 'Break Zone')!
    act(() => { btn.click() })
    expect(details(), 'the panel already showed the card before anything was focused').not.toContain(name)

    const id = s!.players[owner].breakZone[0]!
    const cell = document.querySelector<HTMLElement>(`.zone [data-card-id="${id}"]`)
    expect(cell, 'the opened pile did not render its first card').not.toBe(null)
    const target = (cell!.querySelector('button') ?? cell!) as HTMLElement
    act(() => { target.focus() })
    expect(details(), 'focusing a card in an opened pile did not read it').toContain(name)
    expectDescribedBy(target, firstCardText(s!, owner, 'breakZone'))
  })

  it('opens and reads the DAMAGE zone', () => {
    // Damage-zone identities are public and are how a player tracks what is left in a deck. Returning no
    // grid items for every Damage Zone survived the whole suite, because nothing opened one.
    const s = withPile(HUMAN, 'damageZone') ?? withPile(AI, 'damageZone')
    expect(s, 'nobody ever took damage, so this test asserts nothing').not.toBe(null)
    const owner = s!.players[HUMAN].damageZone.length > 0 ? HUMAN : AI
    const name = firstCardName(s!, owner, 'damageZone')
    mount(s!)
    const btn = ownerOpener(owner, 'Damage')
    expect(btn, 'a non-empty damage zone is not openable').toBeDefined()
    act(() => { btn!.click() })
    expect(details()).not.toContain(name)
    const id = s!.players[owner].damageZone[0]!
    const cell = document.querySelector<HTMLElement>(`.zone [data-card-id="${id}"]`)
    expect(cell, 'the damage zone opened to nothing').not.toBe(null)
    const target = (cell!.querySelector('button') ?? cell!) as HTMLElement
    act(() => { target.focus() })
    expect(details(), 'a damage card cannot be read').toContain(name)
    expectDescribedBy(target, firstCardText(s!, owner, 'damageZone'))
  })

  it('opens and reads REMOVED FROM GAME, which the board never showed at all', () => {
    // Suppressing these buttons entirely survived the suite. The zone is public (spec C7-1) and was not
    // rendered anywhere before this rung — not even as a count.
    const s = withPile(HUMAN, 'removedFromGame') ?? withPile(AI, 'removedFromGame')
    expect(s, 'nothing was ever removed from the game, so this test asserts nothing').not.toBe(null)
    const owner = s!.players[HUMAN].removedFromGame.length > 0 ? HUMAN : AI
    const name = firstCardName(s!, owner, 'removedFromGame')
    mount(s!)
    const btn = ownerOpener(owner, 'Removed from game')
    expect(btn, 'a non-empty removed-from-game zone is not openable').toBeDefined()
    act(() => { btn!.click() })
    expect(details()).not.toContain(name)
    const id = s!.players[owner].removedFromGame[0]!
    const cell = document.querySelector<HTMLElement>(`.zone [data-card-id="${id}"]`)
    expect(cell, 'removed-from-game opened to nothing').not.toBe(null)
    const target = (cell!.querySelector('button') ?? cell!) as HTMLElement
    act(() => { target.focus() })
    expect(details(), 'a removed card cannot be read').toContain(name)
    expectDescribedBy(target, firstCardText(s!, owner, 'removedFromGame'))
  })

  it('closes an open pile when its last card leaves', () => {
    // `openPile` remembers a seat and a kind, not a set of cards. A Break Zone whose last card is returned
    // to hand — Billy Bob does exactly that — left the opener gone and an orphaned labelled empty row behind.
    const s = withPile(HUMAN, 'breakZone') ?? withPile(AI, 'breakZone')
    expect(s).not.toBe(null)
    const owner = s!.players[HUMAN].breakZone.length > 0 ? HUMAN : AI
    mount(s!)
    act(() => { ownerOpener(owner, 'Break Zone')!.click() })
    expect(document.querySelector('[role="grid"][aria-label*="Break Zone"]'), 'the pile did not open').not.toBe(null)

    const emptied: GameState = {
      ...s!,
      players: s!.players.map((ps, i) => (i === owner ? { ...ps, breakZone: [] } : ps)) as GameState['players'],
    }
    remount(emptied)
    // NOT `.not.toContain('Break Zone')` on the array of labels: `toContain` tests exact membership, and the
    // label reads "Your Break Zone", so that assertion passed whether or not the orphan row was there. The
    // row that survives is an EMPTY zone, which renders a placeholder rather than a grid — so looking for a
    // missing grid proved nothing either. What identifies it is the label.
    const labels = [...document.querySelectorAll('.zone__label')].map((l) => l.textContent ?? '')
    expect(
      labels.filter((l) => l.includes('Break Zone')),
      'an emptied pile left an orphaned, labelled, empty row behind',
    ).toEqual([])

    // And it must stay closed when the pile FILLS AGAIN. Declining to render an empty row is not the same as
    // forgetting it was open: with the state still set, the pile sprang back open by itself the moment a card
    // returned to it, `aria-expanded="true"`, with the player never having asked for it.
    remount(s!)
    expect(
      ownerOpener(owner, 'Break Zone')?.getAttribute('aria-expanded'),
      'an emptied pile reopened itself when it filled again',
    ).toBe('false')
  })

  it('closes the pile when the same count is pressed again', () => {
    const s = withBreakZone()
    mount(s)
    const btn = opener(/Break Zone, \d+ cards?$/)!
    act(() => { btn.click() })
    act(() => { btn.click() })
    expect(btn.getAttribute('aria-expanded')).toBe('false')
  })

  it('lets a long pile be scrolled rather than clipping it', () => {
    // A Break Zone grows all game. Measured in a real browser, an opened pile of 24 cards laid out 1215px
    // wide inside a 912px container and the surplus was simply CLIPPED — unreachable by pointer, and by
    // keyboard too, because a non-scrollable container cannot scroll a focused card into view. jsdom has no
    // layout, so this pins the CSS contract that makes it reachable rather than the measurement.
    const s = withBreakZone()
    mount(s)
    const btn = opener(/Break Zone, \d+ cards?$/)!
    act(() => { btn.click() })
    const grid = document.querySelector<HTMLElement>('[role="grid"][aria-label*="Break Zone"]')
    expect(grid, 'the pile did not open').not.toBe(null)
    expect(grid!.className, 'the pile is not styled as a card row').toContain('zone__cards')

    // Asserted against the STYLESHEET, not `getComputedStyle`: jsdom has no layout and does not load the
    // CSS, so a computed style here reads its defaults and would fail against correct code. This cannot
    // verify the measurement — that was done in a real browser — but it does stop the rule being deleted.
    const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../src/styles.css'), 'utf8')
    const rule = css.slice(css.indexOf('.zone__cards {'), css.indexOf('}', css.indexOf('.zone__cards {')))
    expect(rule, 'a long pile would be clipped instead of scrolled').toContain('overflow-x: auto')
    // `safe center`, not plain `center`: a centred flex row overflows in BOTH directions, and the cards at
    // the start can then never be scrolled back to.
    expect(rule, 'a centred row cannot be scrolled back to its start').toContain('justify-content: safe center')
  })

  it('leaves an EMPTY pile as a plain number, not a control', () => {
    // Nothing to read, so nothing to open — and a button that opens an empty row is a tab stop that wastes
    // a keyboard player's time and announces nothing.
    mount(mulliganState())
    expect(opener(/Break Zone/), 'an empty Break Zone offered itself as openable').toBeUndefined()
  })

  it('does not announce the damage total twice when it is openable', () => {
    // The pip track carries `aria-label="N of 7 damage"`. Inside a disclosure button whose own name already
    // says the count, that is the same fact twice in a row.
    //
    // The first version of this bailed out with a bare `return` when nobody had taken damage — a test that
    // silently skips is a test that cannot fail, and the mutation proved it: announcing the track inside the
    // button survived. It now seeks a damaged position and FAILS if it cannot find one.
    const agent = new GreedyAgent({ seed: 7, decks: DECKS, depth: 1 })
    let s: GameState = createGame({ seed: 7, decks: DECKS, defs: CARD_DEFS })
    for (let i = 0; i < 4000 && !s.result; i++) {
      if (s.players[HUMAN].damageZone.length > 0 || s.players[AI].damageZone.length > 0) break
      if (actingPlayer(s) === null) break
      s = stepAi(s, agent).state
    }
    expect(
      s.players[HUMAN].damageZone.length + s.players[AI].damageZone.length,
      'nobody ever took damage, so this test asserts nothing',
    ).toBeGreaterThan(0)
    mount(s)
    const dmg = opener(/Damage, \d+ cards?$/)
    expect(dmg, 'a non-empty damage zone is not openable').toBeDefined()
    expect(dmg!.querySelector('.damage-track')?.getAttribute('aria-hidden'), 'the pip track is announced inside the button that already states the count').toBe('true')
    expect(dmg!.querySelector('.damage-track')?.getAttribute('aria-label')).toBe(null)
  })

  it('still announces the damage total when there is nothing to open', () => {
    // The other side of it: with no damage there is no button, so the pip track is the only thing that can
    // say the total, and it must keep its label.
    mount(mulliganState())
    const track = document.querySelector('.damage-track')
    expect(track?.getAttribute('aria-label'), 'an unopenable damage track lost its label').toMatch(/of \d+ damage/)
    expect(track?.getAttribute('aria-hidden')).toBe(null)
  })
})

describe('the printed text as an accessible description (rung E3b-1)', () => {
  /** What a screen reader would announce as the DESCRIPTION of `el`, resolved through aria-describedby. */
  const describedText = (el: HTMLElement): string => {
    const id = el.getAttribute('aria-describedby')
    return id === null ? '' : document.getElementById(id)?.textContent ?? ''
  }

  it('a hand card carries its printed text as a description, before anything is focused', () => {
    // The defect the E3b plan review found: the details panel shows this to a SIGHTED player, but it is not
    // a live region and is not programmatically related to the focused card, so assistive technology is
    // never told the text exists. A rung that only made cards focusable would have gone green while a
    // screen-reader user still could not read one.
    mount(mainPhaseState())
    expect(describedText(named(RAMUH)), 'the card has no accessible description at all').toContain(RAMUH_TEXT)
  })

  it('describes rather than renames — the accessible NAME stays concise', () => {
    // A description, not a longer label. The name is what gets read when skimming a row of six cards.
    mount(mainPhaseState())
    const el = named(RAMUH)
    expect(el.getAttribute('aria-label'), 'the printed text was folded into the name').not.toContain(RAMUH_TEXT)
    expect(el.getAttribute('aria-label')).toContain('Ramuh, cost 2')
  })

  it('points each card at its OWN text', () => {
    // One `useId` per rendered card. A single shared id would describe every card with whichever one
    // rendered last, which is worse than no description because it is confidently wrong.
    mount(mainPhaseState())
    const ids = handCards().map((c) => c.getAttribute('aria-describedby'))
    expect(new Set(ids).size, 'two cards share one description').toBe(ids.length)
    const ramuh = describedText(named(RAMUH))
    const other = handCards().find((c) => !(c.getAttribute('aria-label') ?? '').startsWith(RAMUH))
    expect(describedText(other!), 'a different card was given Ramuh’s text').not.toBe(ramuh)
  })

  it('keeps a NON-SELECTABLE card’s name concise too', () => {
    // The "describes rather than renames" test above picks a castable card, so it only ever exercises the
    // `<button>` branch. The `role="img"` branch is separate code, and a mutant appending the text to its
    // `aria-label` survived every other assertion — the field lookup still matched, because the value still
    // starts with the name. Non-selectable cards would then announce the printed text twice.
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
    act(() => {
      root!.render(createElement(Card, {
        code: 'X-001', name: 'Fixture', cost: 1, elements: ['fire'], type: 'forward', power: 1000,
        selectable: false, text: 'PRINTED CLAUSE.',
      }))
    })
    const el = document.querySelector<HTMLElement>('.card')
    expect(el!.tagName, 'this fixture is meant to exercise the non-button branch').toBe('DIV')
    expect(el!.getAttribute('aria-label'), 'the printed text was folded into a non-selectable card’s name')
      .toBe('Fixture, cost 1, fire, forward, power 1000 of 1000')
    const id = el!.getAttribute('aria-describedby')
    expect(document.getElementById(id!)?.textContent).toBe('PRINTED CLAUSE.')
  })

  it('gives two copies of the SAME card distinct description ids', () => {
    // The hand at this seed holds five distinct codes, so asserting "all ids differ" across it survives
    // replacing `useId()` with the card's code. Two copies of one card is the case that separates them, and
    // duplicate DOM ids would point both cards at whichever rendered last.
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
    const one: CardProps = { code: 'X-001', name: 'Fixture', cost: 1, elements: ['fire'], type: 'forward', power: 1000, text: 'PRINTED CLAUSE.' }
    act(() => {
      root!.render(createElement('div', null, [
        createElement(Card, { ...one, key: 'a' }),
        createElement(Card, { ...one, key: 'b' }),
      ]))
    })
    const ids = [...document.querySelectorAll<HTMLElement>('.card')].map((c) => c.getAttribute('aria-describedby'))
    expect(ids).toHaveLength(2)
    expect(ids[0], 'a card has no description id').not.toBe(null)
    expect(ids[0], 'two copies of one card share a DOM id').not.toBe(ids[1])
  })

  it('keeps the description OUTSIDE the card element', () => {
    // `role="img"` is a leaf role, so its subtree is pruned from the accessibility tree. Whether
    // `aria-describedby` still resolves text out of a pruned subtree is a spec subtlety that varies between
    // screen readers — and I cannot test a real one here. A sibling does not depend on the answer, so the
    // structure is pinned rather than left to be re-nested by someone tidying the markup later.
    mount(mainPhaseState())
    const el = named(RAMUH)
    const id = el.getAttribute('aria-describedby')
    expect(id, 'no description to place').not.toBe(null)
    const desc = document.getElementById(id!)
    expect(desc, 'the described-by target does not exist').not.toBe(null)
    expect(el.contains(desc), 'the description is nested inside the card it describes').toBe(false)
  })

  it('describes a card on the field too, not only one in hand', () => {
    const s = fieldState()
    mount(s)
    const v = viewFor(s, HUMAN)
    const placed = [...v.fields[HUMAN].forwards, ...v.fields[HUMAN].backups][0]
    const code = v.cards[placed!.id]?.code
    const def = code === undefined ? undefined : v.defs[code]
    const el = [...document.querySelectorAll<HTMLElement>('.zone [role="gridcell"], .zone .card')]
      .find((c) => (c.getAttribute('aria-label') ?? '').startsWith(def?.name ?? '?'))
    expect(el, `nothing on the field announces "${def?.name}"`).toBeDefined()
    expect(describedText(el!)).toBe(def?.text)
  })

  it('gives no description at all to a card with no printed text', () => {
    // Every card in this pool prints something, so this is a component-level case by necessity. An
    // `aria-describedby` pointing at an empty node is worse than none: a screen reader announces the name,
    // then a description, then nothing.
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
    act(() => {
      root!.render(createElement(Card, {
        code: 'X-001', name: 'Fixture', cost: 1, elements: ['fire'], type: 'forward', power: 1000, text: '',
      }))
    })
    const el = document.querySelector<HTMLElement>('.card')
    expect(el, 'the fixture card did not render').not.toBe(null)
    expect(el!.getAttribute('aria-describedby'), 'an empty description was attached').toBe(null)
  })

  it('describes a face-down card with nothing, whatever text it is handed', () => {
    // The opponent's hand renders face-down. Attaching the printed text there would leak the card outright.
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
    act(() => {
      root!.render(createElement(Card, {
        code: 'X-001', name: 'Fixture', cost: 1, elements: ['fire'], type: 'forward', power: 1000,
        faceDown: true, text: 'SECRET PRINTED TEXT',
      }))
    })
    const el = document.querySelector<HTMLElement>('.card')
    expect(el!.getAttribute('aria-describedby'), 'a face-down card leaked its text to assistive tech').toBe(null)
    // `textContent` excludes ATTRIBUTES, so it cannot see the leak that matters: a secret placed in
    // `aria-label` or `title` goes straight to assistive technology while a text-only assertion stays green.
    // `outerHTML` covers both, and the whole document covers the sr-only sibling too.
    expect(el!.outerHTML, 'a face-down card leaked its text through an attribute').not.toContain('SECRET')
    expect(document.body.innerHTML, 'a face-down card leaked its text somewhere in the DOM').not.toContain('SECRET')
    expect(el!.getAttribute('aria-label')).toBe('Face-down card')
  })
})

describe('the other two Board render paths', () => {
  // The announcing element, which is the cell for a card with no button of its own — same rule as the hand.
  const fieldCards = (): HTMLElement[] =>
    [...document.querySelectorAll<HTMLElement>('.zone [role="gridcell"], .zone .card')]
      .filter((el) => el.getAttribute('aria-label') !== null)

  it('inspects a card on the FIELD, not only one in hand', () => {
    const s = fieldState()
    mount(s)
    // Which card is on my field comes from the STATE, not from guessing at a rendered label — the first
    // castable character in this position is a Backup, not a Forward, so matching on "power" found nothing.
    const v = viewFor(s, HUMAN)
    const placed = [...v.fields[HUMAN].forwards, ...v.fields[HUMAN].backups][0]
    expect(placed, 'nothing reached the field after casting a character').toBeDefined()
    const code = v.cards[placed!.id]?.code
    const name = (code === undefined ? undefined : v.defs[code]?.name) ?? '?'
    const el = fieldCards().find((c) => (c.getAttribute('aria-label') ?? '').startsWith(name))
    expect(el, `no card labelled "${name}" on the field`).toBeDefined()
    expect(details()).not.toContain(name)
    hover(el!)
    expect(details(), 'the field path does not forward onInspect').toContain(name)
  })

  it('inspects an ORPHAN target — a card the board would not otherwise draw', () => {
    // Billy Bob's ETB targets your Break Zone, which the board shows only as a count, so `Board` gives any
    // targetable card it does not already draw a row of its own. That row is the third render path, and it
    // is the one a player is MOST likely to need the text of: the card is not on screen anywhere else.
    const s = mainPhaseState()
    const v = viewFor(s, HUMAN)
    const id = v.hand[0]
    expect(id, 'the fixture hand is empty').toBeDefined()
    const broken = {
      ...v,
      hand: v.hand.slice(1),
      fields: { ...v.fields, [HUMAN]: { ...v.fields[HUMAN], breakZone: [id!] } },
      pending: { kind: 'chooseTargets' as const, player: HUMAN, min: 1, max: 1, candidates: [id!] },
    }
    mountView(broken, [{ type: 'chooseTargets', player: HUMAN, targets: [id!] }])
    const code = broken.cards[id!]?.code
    const name = code === undefined ? '?' : broken.defs[code]?.name ?? '?'
    const orphan = [...document.querySelectorAll<HTMLElement>('.zone .card')]
      .find((c) => (c.getAttribute('aria-label') ?? '').startsWith(name))
    expect(orphan, 'the orphan target row did not render the Break Zone card').toBeDefined()
    hover(orphan!)
    expect(details(), 'the orphan path does not forward onInspect').toContain(name)
    // The panel gets its definition through `onInspect`, so hovering proves nothing about the DESCRIPTION.
    // Deleting `text` from the orphan call site left the whole suite green: an orphan target would have
    // stayed a button with no printed description, and it is the card a player most needs to read, because
    // the board draws it nowhere else.
    const descId = orphan!.getAttribute('aria-describedby')
    expect(descId, 'the orphan card has no accessible description').not.toBe(null)
    expect(document.getElementById(descId!)?.textContent).toBe(code === undefined ? undefined : broken.defs[code]?.text)
  })
})

describe('what a cast will cost, before the click (rung E4)', () => {
  it('names the DISCARD in the card’s accessible name, not just the card', () => {
    // The defect: one click cast a 2-cost Ramuh by discarding a 5-cost Odin, and said so only afterwards in
    // the log. The button said "Ramuh, cost 2, lightning, summon" and nothing more.
    //
    // The expectation is written out BY HAND, not read from the choice set — an assertion built by the code
    // under test agrees with that code however wrong it is. At this seed casting Ramuh spends Sphene, and
    // that is the fact a player is entitled to know before clicking.
    mount(mainPhaseState())
    const el = named(RAMUH)
    expect(el.getAttribute('aria-label'), 'the accessible name does not say what the click will spend')
      .toContain('Cast Ramuh paying: discard Sphene as lightning')
  })

  it('keeps the card’s own description in the accessible name', () => {
    // Appended, not substituted. A screen-reader user must still hear name, cost, element and type — they
    // were already the worst served here, since they cannot see the log update either.
    mount(mainPhaseState())
    const said = named(RAMUH).getAttribute('aria-label') ?? ''
    expect(said, 'the card is no longer described at all').toContain('Ramuh, cost 2')
    expect(said).toContain('lightning')
    expect(said).toContain('summon')
    expect(said).toContain('paying:')
  })

  it('keeps a FORWARD’s power in the accessible name', () => {
    // Ramuh is a Summon, so its `power` is null and the test above never exercises the power phrase at all.
    // A mutant dropping power whenever an action is present passed all twenty tests — an actionable Forward
    // would have lost the number a player compares before casting it. Found by mutation.
    mount(mainPhaseState())
    const forward = handCards().find((c) => {
      const l = c.getAttribute('aria-label') ?? ''
      return l.includes('forward') && l.includes('paying:')
    })
    expect(forward, 'no castable Forward in the opening Main Phase — this cannot check power').toBeDefined()
    expect(forward!.getAttribute('aria-label'), 'a castable Forward lost its power from its accessible name')
      .toMatch(/power \d+ of \d+/)
  })

  it('shows the same line VISIBLY in the details panel', () => {
    // A separate surface with its own criterion, because either one alone leaves someone worse off: panel
    // only abandons screen-reader users, label only leaves sighted users on a slow native tooltip.
    mount(mainPhaseState())
    hover(named(RAMUH))
    expect(document.querySelector('.details__action')?.textContent, 'the panel does not disclose the payment')
      .toBe('Cast Ramuh paying: discard Sphene as lightning')
  })

  it('discloses nothing for a card that cannot be cast', () => {
    // At the mulligan no hand card is playable at all, so no card may carry a dangling "paying:" fragment.
    mount(mulliganState())
    for (const c of handCards()) expect(c.getAttribute('aria-label') ?? '').not.toContain('paying')
    hover(named(RAMUH))
    expect(document.querySelector('.details__action')).toBe(null)
  })

  it('discloses nothing for a card that offers SEVERAL things', () => {
    // Geomancer can be cast or used for its CP ability, so clicking it does not commit — it opens the prompt
    // strip, which lists both. Naming one payment here would tell the player the click is about to spend
    // something it is not. Found by mutation: disclosing `forCard[0]` unconditionally passed every other test.
    mount(mainPhaseState())
    // The guard must be about the card actually asserted on. Checking that SOME card has several choices
    // would keep passing on the day Geomancer stops having them, leaving the assertion below vacuous.
    const geoId = viewFor(mainPhaseState(), HUMAN).hand.find((id) => nameOf(id) === 'Geomancer')
    expect(geoId, 'Geomancer is not in the opening hand — the fixture deck or seed changed').toBeDefined()
    expect(mounted?.byCard.get(geoId!)?.length ?? 0,
      'Geomancer no longer offers several choices, so this test proves nothing').toBeGreaterThan(1)
    const geo = named('Geomancer')
    expect(geo.getAttribute('aria-label') ?? '', 'a card that does not commit on click named a payment anyway').not.toContain('paying')
    hover(geo)
    expect(document.querySelector('.details__action')).toBe(null)
  })

  it('discloses the string the click actually submits', () => {
    // Not a second formatter that happens to agree: the disclosed text and the submitted choice's own label
    // are compared against each other, and A1 above supplies the independent hand-written oracle.
    mount(mainPhaseState())
    const disclosed = named(RAMUH).getAttribute('aria-label') ?? ''
    act(() => { (named(RAMUH) as HTMLButtonElement).click() })
    expect(chosen.length).toBe(1)
    expect(disclosed, 'the card disclosed a different action from the one it submitted').toContain(chosen[0]!.label)
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
      // Typed exactly, not cast: `onCast` is not a trigger this engine has, and an `as never` would have
      // hidden that while the fixture went on claiming to describe a real card.
      abilities: [{ id: 'X-001:a', text: 'Implemented clause.', trigger: { kind: 'enterField' }, effects: [] }],
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
