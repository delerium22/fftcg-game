import { act, createElement, type JSX } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { apply, applyChooseFirst, createGame, legalCommands, viewFor, type CardDef, type CardId, type Command, type GameState, type PlayerView } from '@fftcg/engine'
import { CARD_DEFS, DECKS } from '../src/deck.js'
import { Board } from '../src/ui/Board.js'
import { Card } from '../src/ui/Card.js'
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

function mount(s: GameState): void {
  mountView(viewFor(s, HUMAN), legalCommands(s, HUMAN), s)
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
const named = (name: string): HTMLElement => {
  const el = handCards().find((c) => (c.getAttribute('aria-label') ?? '').startsWith(name))
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

  it('describes a card on the field too, not only one in hand', () => {
    const s = fieldState()
    mount(s)
    const v = viewFor(s, HUMAN)
    const placed = [...v.fields[HUMAN].forwards, ...v.fields[HUMAN].backups][0]
    const code = v.cards[placed!.id]?.code
    const def = code === undefined ? undefined : v.defs[code]
    const el = [...document.querySelectorAll<HTMLElement>('.zone .card')]
      .find((c) => (c.getAttribute('aria-label') ?? '').startsWith(def?.name ?? '?'))
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
    expect(document.body.textContent, 'a face-down card leaked its text into the DOM').not.toContain('SECRET')
  })
})

describe('the other two Board render paths', () => {
  const fieldCards = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('.zone .card')]

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
