# Rung U2c — drawer, preview, menu, settings — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the rail goes: the log becomes a drawer that stays in the accessibility tree when closed, the hover preview
(a large card plus its printed text) replaces the `CardDetails` rail in the right column, the top bar gains a menu with
an always-available Concede and How to play, a settings popover, and a log toggle; the AI's hand shows as fanned backs;
the stack column draws top-first; `Board.tsx` sheds its zone components into `ui/board/`.

**Architecture:** the right column (`--rail-w`, 320px) splits into two named areas, `stack` (row 2) and `preview`
(rows 3–5). The log drawer is a grid item over that column (rows 2–5) when open, and the clip pattern when closed, so
the `role="log"` node is one stable element in every state. The toolbar row holds one wrapper, `.table__top`, whose DOM
order is [tools cluster][deck picker] so the picker stays the last three tab stops. Settings become a live store
(`settingsStore.ts`) that `bootstrap()` initialises and the popover writes; the system reduced-motion listener reads the
store, not boot-time state. No gameplay code path changes: the menu's Concede is the existing concede choice, submitted
through `choose`.

**Tech Stack:** React 19, CSS grid, Vitest (jsdom), Playwright.

**Spec:** `docs/superpowers/specs/2026-09-30-ui-overhaul-design.md` — section 5 (the hover preview), section 6 (the top
bar, the stack column, the log drawer, the hover preview, settings), section 8 (the settings table), section 10
(allowed e2e edits), section 11 row U2c, D21, D22, D31, D33, and the U2b As-built carried items.

## Decisions (taken in planning; the plan review may overturn them)

- **D34 — the preview is a panel in the right column, not a floating card.** A floating card near the pointer covers
  other cards (against UO-A1's spirit), has no keyboard reading path, and makes layout tests flaky. The panel keeps rung
  E3b's "focus a card, read it" path and the `.details*` classes the tests pin. The spec's 300 ms hover delay is for a
  transient popup; a persistent panel updates at once, as the rail did (the delay would only slow reading). U7's tilt and
  foil apply to the panel's card. Cost if wrong: the preview is 60 px narrower than the spec's "about 320 px" at 1280×720.
- **D35 — the stack column is row 2 of the right column; the preview takes rows 3–5.** The spec says the column "runs full
  height" because the rail goes; with D34 the column is shared. A stack rarely holds more than three entries; the preview
  needs the height. The stack list is the prompt strip's `.stack-row`, placed by `grid-area` as in U2b, so its reading
  position (between the phase pill and the prompt text) does not move.
- **D36 — top-first is CSS, not DOM.** `.stack-row { flex-direction: column-reverse }` draws the resolving entry first.
  `stack-row.test.tsx` pins the DOM order (the last `li` is the top, "resolves next"), and a screen reader hears the stack
  bottom-up with the top marked, as today.
- **D37 — the log drawer is a grid item over the right column, not a fixed overlay.** Open, it spans rows 2–5 of column 4
  exactly (`--rail-w` wide), so it covers the stack and the preview and never a card or the toolbar. Closed, it is the clip
  pattern: the `aside` and the `role="log"` node stay in the DOM and the accessibility tree (D21).
- **D38 — the tools cluster comes before the deck picker in the DOM.** `deck-picker.spec.ts` asserts that after the first
  tab stop inside `.table__toolbar` the remaining stops are exactly the two selects and New game. The cluster is
  `.tools` inside `.table__top`, drawn at the right by `order`, and is never classed `.table__toolbar`.
- **D39 — Concede from the menu confirms in a native dialog**, not the strip's two-click arming (which `focus.test.tsx`
  pins to `PromptStrip`). The dialog is an `alertdialog`; focus lands on "Keep playing", so Enter never concedes.
- **D40 — the AI's unknown hand cards are decoration.** Fanned backs are `aria-hidden`, carry no `data-card-id` and no
  text; the HUD's "Hand N" stays the accessible count. Known cards keep their own grid (rung V1-E), unchanged.
- **D41 — the ticker is `aria-hidden`.** It duplicates the log's latest line, which the log region already announces. It
  sits under the prompt text inside a `.prompt__centre` wrapper that owns `grid-area: centre`; the `role="status"` element
  is unchanged and unkeyed.

## Global Constraints

- DOM order is the reading and tab order and must not change for existing content; place with `grid-area`. The only
  markup moves are named in a task: the "How to play" button into the menu; the log into the drawer; the details into the
  preview; the picker into `.table__top`.
- Keep every class the tests read: `.hand`, `.prompt__text`, `.prompt__actions`, `.prompt__phase`, `.prompt__lead`,
  `.phase-track`, `.table__seat`, `.table__seat--opponent|player`, `.table__hand`, `.table__prompt`, `.table__toolbar`
  (on the picker only), `.picker`, `.seat`, `.damage-track`, `.zone`, `.zone__cards`, `.zone__label`, `.stat__open`,
  `[data-stack-row]`, `.details`, `.details__text`, `.details__action`, `.log`, `.log__lines`, `.log__line`,
  `.log__line--*`; the pile openers' names and `aria-expanded`.
- `.prompt__text` (`role="status"`) and `.log__lines` (`role="log"`, name exactly `Game log`, `aria-live` polite/off) stay
  one stable element each, never keyed, conditionally rendered, `hidden`, `aria-hidden`, `inert` or `display: none`.
- `.zone__cards`'s own rule keeps `overflow-x: auto` and `justify-content: safe center` (`card-details.test.tsx` slices
  the stylesheet from the FIRST `.zone__cards {` — new rules that contain that text go after it).
- The known-hand grid stays the only element in the opponent seat whose `aria-label` starts with `AI hand`, and the seat's
  text never contains "known" unless a card is known (`known-hand.test.tsx`).
- `?motion=instant` is never written to storage (`harness.spec.ts`); the stored speed is what the popover edits.
- `bootstrap(win, storage)` keeps its signature and `Boot` shape; new fields are additive.
- Allowed e2e edits (UO-A4): selectors for moved elements, opening the log drawer. `drive.ts` is not edited.
- Animate only transform and opacity. No new dependencies.
- No section sign followed by a number in code, tests or specs (`rules-citations`); `git add` named paths; commit
  trailers: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_01Jim632aq25BAyqSnoqU4KX`.
- Verify: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:browser`. Known exception: `game-over.test.tsx` times out
  under full-suite load; rerun it alone.

## Review Focus

1. **Concede from the menu while the AI is thinking, and at a G6 concede-only position** (the strip shows nothing):
   the menu still offers Concede, the first press opens the confirmation, nothing is submitted until "Concede game",
   and "Keep playing" or Escape submits nothing. Pinned in Task 1.
2. **Settings with blocked storage, and under `?motion=instant`**: a change applies to this page (`--motion-scale`,
   `data-*` on `<html>`) without throwing; the speed control is disabled under the flag and nothing is written. Pinned in
   Task 2.
3. **The closed drawer is exposed but not a tab stop**: the browser computes `role=log`, name `Game log`, live `polite`
   with the drawer closed; the scroller's `tabindex` is -1 closed and 0 open; Escape inside the open drawer closes it and
   returns focus to the Log toggle. Pinned in Task 3.
4. **A previewed card that leaves play, and a new game**: the preview keeps the card's face and text when the instance
   leaves the model (built from its definition); "Play again" empties it. Pinned in Task 4.
5. **The right column at 1280×720 under stress**: a six-entry stack and Cloud's text — the stack list and the details
   scroll inside their panels, the preview's card is whole, nothing overlaps a card, and the open drawer covers only the
   column. Pinned in Task 0 and Task 4.

---

### Task 0: the acceptance checks (RED)

**Files:**
- Modify: `apps/web/e2e/layout.spec.ts` (append)
- Create: `apps/web/e2e/chrome.spec.ts`

**Interfaces:**
- Produces: the selectors every later task must satisfy: `.table__preview` (the preview panel), `.drawer` with
  `.drawer--open`, a button named `Log` with `aria-expanded`, a button named `Menu`, a button named `Settings`.

- [ ] **Step 1: Append the U2c layout checks to `layout.spec.ts`**

```ts
/*
 * Rung U2c: the rail's replacements. The preview panel and the log drawer sit in the right column and cover no card,
 * open or closed (D34, D37), at the tightest size.
 */
test('the preview and the drawer cover no card at 1280×720, closed and open (U2c)', async ({ page }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1280, height: 720 })
  await turn3(page)
  await page.locator('[role="grid"][aria-label="Your hand"] .card').first().hover()
  const cards = await page.locator('.card:not(.table__preview .card)').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON() as Box))
  const preview = (await page.locator('.table__preview').boundingBox())!
  expect(preview, 'no preview panel').not.toBeNull()
  expect(cards.filter((c) => overlaps(preview, c)), 'the preview covers a card').toEqual([])
  expect(await page.locator('.table__preview .card--large').count(), 'the hovered card is not previewed large').toBe(1)
  expect(await page.evaluate(scrolls('.table__preview')), 'the preview panel scrolls as a whole').toEqual([{ x: false, y: false }])
  const toggle = page.getByRole('button', { name: 'Log' })
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  const drawer = (await page.locator('.drawer--open').boundingBox())!
  expect(drawer, 'the drawer did not open').not.toBeNull()
  expect(cards.filter((c) => overlaps(drawer, c)), 'the open drawer covers a card').toEqual([])
  expect(drawer.width, 'the drawer is wider than the column').toBeLessThanOrEqual(321)
  expect(await page.evaluate(scrolls('.table__seat, .hand'))).toEqual([{ x: false, y: false }, { x: false, y: false }, { x: false, y: false }])
})

test('a six-entry stack and the longest card text both scroll inside their panels at 1280×720 (U2c, Review Focus 5)', async ({ page }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1280, height: 720 })
  await turn3(page)
  await page.evaluate(`(() => {
    const stack = document.createElement('ol'); stack.className = 'stack-row'; stack.setAttribute('data-stack-row', '')
    for (let i = 0; i < 6; i++) { const li = document.createElement('li'); li.className = 'stack-row__item'; li.textContent = 'Your Ramuh, Summon, targeting the AI\\'s Forward number ' + i; stack.append(li) }
    document.querySelector('.table').append(stack)
    const text = document.querySelector('.details__text') ?? document.querySelector('.details').appendChild(Object.assign(document.createElement('p'), { className: 'details__text' }))
    text.textContent = 'When Cloud enters the field, choose 1 Forward. '.repeat(12)
  })()`)
  const seats = await page.evaluate(scrolls('.table__seat, .hand, .table__preview')) as { x: boolean; y: boolean }[]
  expect(seats, 'something outside the panels scrolls').toEqual([{ x: false, y: false }, { x: false, y: false }, { x: false, y: false }, { x: false, y: false }])
  const panels = await page.evaluate(`[...document.querySelectorAll('.stack-row, .details')].map((e) => getComputedStyle(e).overflowY)`) as string[]
  for (const y of panels) expect(['auto', 'scroll']).toContain(y)
  const card = (await page.locator('.table__preview .card').boundingBox())!
  const preview = (await page.locator('.table__preview').boundingBox())!
  expect(card.y, 'the preview card is pushed above its panel').toBeGreaterThanOrEqual(preview.y - 1)
  expect(card.y + card.height, 'the preview card is cut off').toBeLessThanOrEqual(preview.y + preview.height + 1)
})
```

- [ ] **Step 2: Create `chrome.spec.ts` with the closed-drawer exposure check**

```ts
import { expect, test } from '@playwright/test'

/**
 * Rung U2c — the top bar's chrome: the log drawer (D21, D37), the menu (D31, D39) and the settings popover (section 8).
 * Everything here is what jsdom cannot prove: computed accessibility, persistence across a reload, what Tab reaches.
 * `ariaSnapshot` reads Chromium's computed tree, the same source `announcements.spec.ts`'s `axTree` helper uses.
 */

test('the log is exposed to assistive technology while the drawer is closed, and its scroller is not a tab stop (D21)', async ({ page }) => {
  await page.goto('/?seed=1&decks=vol2,vol2')
  await expect(page.getByRole('button', { name: 'Take the first turn' })).toBeVisible()
  const toggle = page.getByRole('button', { name: 'Log' })
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  // Closed: the region exists, has its role, its exact name and its live setting. Not opened first — that is the claim.
  const tree = await page.locator('.log__lines').ariaSnapshot()
  expect(tree, 'the log region is missing from the accessibility tree while closed').toMatch(/log "Game log"/)
  const state = await page.evaluate(() => {
    const lines = document.querySelector<HTMLElement>('.log__lines')!
    const aside = lines.closest('aside')!
    return {
      tabIndex: lines.tabIndex,
      hidden: [lines, aside].some((e) => e.hidden || e.getAttribute('aria-hidden') === 'true' || e.inert || getComputedStyle(e).display === 'none' || getComputedStyle(e).visibility === 'hidden'),
      live: lines.getAttribute('aria-live'),
    }
  })
  expect(state).toEqual({ tabIndex: -1, hidden: false, live: 'polite' })
  // Open: the scroller takes focus, Escape closes and returns focus to the toggle.
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(page.locator('.log__lines')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(toggle).toBeFocused()
})
```

- [ ] **Step 3: Run both specs to verify they fail**

Run: `pnpm test:browser layout chrome`
Expected: the two new `layout.spec.ts` tests FAIL (no `.table__preview`, no button named `Log`); `chrome.spec.ts` FAILS (no
button named `Log`). The ten existing `layout.spec.ts` tests PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/e2e/layout.spec.ts apps/web/e2e/chrome.spec.ts
git commit -m "test(web): the preview, the drawer and the closed log are exposed — the U2c acceptance checks (red)"
```

---

### Task 1: the top bar — the tools cluster, the menu, Concede with a confirmation, How to play moves

**Files:**
- Create: `apps/web/src/ui/usePopover.ts`
- Create: `apps/web/src/ui/board/Menu.tsx`
- Create: `apps/web/src/ui/board/ConcedeDialog.tsx`
- Create: `apps/web/src/ui/board/TopBar.tsx`
- Modify: `apps/web/src/ui/Board.tsx` (the rail's help button goes; `.table__top` renders before the sheets' siblings as described)
- Modify: `apps/web/src/ui/DeckPicker.tsx:21` (root class `table__toolbar picker` stays; nothing else)
- Modify: `apps/web/src/styles.css` (the `.picker` block, new `.table__top`, `.tools`, `.popover`, `.menu`, `.confirm`)
- Modify: `apps/web/test/how-to-play.test.tsx:131-150`, `apps/web/e2e/how-to-play.spec.ts:24-37`
- Create: `apps/web/test/menu.test.tsx`

**Interfaces:**
- Produces: `usePopover(defaultOpen = false): { open: boolean; setOpen: (v: boolean) => void; toggleRef: RefObject<HTMLButtonElement | null>; panelRef: RefObject<HTMLElement | null>; close: (restoreFocus: boolean) => void }`;
  `Menu({ onHelp?: (() => void) | undefined; concede: Choice | null; onConcede: (c: Choice) => void; defaultOpen?: boolean })`;
  `ConcedeDialog({ onConfirm: () => void; onCancel: () => void })`;
  `TopBar({ picker: ReactNode; children: ReactNode })` — renders `<div className="table__top"><div className="tools">{children}</div>{picker}</div>`.
  Task 2 adds the settings toggle and Task 3 the log toggle as further `children` of `TopBar`, BEFORE the menu.

- [ ] **Step 1: Write the failing menu tests**

`apps/web/test/menu.test.tsx`:

```tsx
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { apply, createGame, legalCommands, viewFor, type GameState } from '@fftcg/engine'
import { CARD_DEFS, DECKS } from '../src/deck.js'
import { Board } from '../src/ui/Board.js'
import { buildChoiceSet, paymentAlternatives, preferredChoices } from '../src/game/commands.js'
import { HUMAN, type Choice, type ChoiceSet, type GameApi } from '../src/game/types.js'

/**
 * Rung U2c (D31, D39) — the top-bar menu: Concede is reachable at every position, through a confirmation, and How to
 * play lives here now. The strip's own Concede keeps its two-click arming (`focus.test.tsx`); this is the other route.
 */

Element.prototype.scrollIntoView = function scrollIntoView() {}
// jsdom has no `showModal`; the confirmation is a native dialog and proves modality in the browser.
HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) { this.setAttribute('open', '') }

let root: Root | null = null
let host: HTMLDivElement | null = null
afterEach(() => { act(() => { root?.unmount() }); host?.remove(); root = null; host = null })

function choicesFor(s: GameState): ChoiceSet {
  const view = viewFor(s, HUMAN)
  const legal = legalCommands(s, HUMAN)
  return buildChoiceSet(view, preferredChoices(view, legal), paymentAlternatives(legal))
}

function mount(s: GameState, extra: Partial<GameApi> = {}, onHelp?: () => void): Choice[] {
  const chosen: Choice[] = []
  const api: GameApi = { view: viewFor(s, HUMAN), choices: choicesFor(s), log: [], aiThinking: false, choose: (c) => { chosen.push(c) }, restart: () => {}, ...extra }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root!.render(createElement(Board, { game: api, onHelp })) })
  return chosen
}

const toggle = (): HTMLButtonElement => document.querySelector<HTMLButtonElement>('.tools button[aria-haspopup="menu"]')!
const item = (which: 'help' | 'concede'): HTMLButtonElement | null => document.querySelector<HTMLButtonElement>(`[role="menuitem"][data-menu="${which}"]`)
const click = (el: Element): void => { act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) }) }
const key = (el: Element, k: string): void => { act(() => { el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })) }) }

describe('the menu button', () => {
  it('is a menu button: closed by default, opens a labelled menu, and says so', () => {
    mount(createGame({ seed: 1, decks: DECKS, defs: CARD_DEFS }))
    const t = toggle()
    expect(t.getAttribute('aria-expanded')).toBe('false')
    expect(document.querySelector('[role="menu"]')).toBeNull()
    click(t)
    expect(t.getAttribute('aria-expanded')).toBe('true')
    const menu = document.querySelector('[role="menu"]')
    expect(menu).not.toBeNull()
    expect(t.getAttribute('aria-controls')).toBe(menu!.id)
    expect(item('concede')).not.toBeNull()
  })

  it('offers How to play only when the board is given something to open', () => {
    mount(createGame({ seed: 1, decks: DECKS, defs: CARD_DEFS }))
    click(toggle())
    expect(item('help')).toBeNull()
  })

  it('How to play opens the sheet and closes the menu, with focus back on the button', () => {
    let opened = 0
    mount(createGame({ seed: 1, decks: DECKS, defs: CARD_DEFS }), {}, () => { opened++ })
    click(toggle())
    click(item('help')!)
    expect(opened).toBe(1)
    expect(document.querySelector('[role="menu"]')).toBeNull()
    expect(document.activeElement).toBe(toggle())
  })

  it('Escape closes the menu and returns focus; arrows move between items', () => {
    mount(createGame({ seed: 1, decks: DECKS, defs: CARD_DEFS }), {}, () => {})
    click(toggle())
    expect(document.activeElement, 'opening did not focus the first item').toBe(item('help'))
    key(item('help')!, 'ArrowDown')
    expect(document.activeElement).toBe(item('concede'))
    key(item('concede')!, 'ArrowDown')
    expect(document.activeElement, 'the arrow does not wrap').toBe(item('help'))
    key(item('help')!, 'Escape')
    expect(document.querySelector('[role="menu"]')).toBeNull()
    expect(document.activeElement).toBe(toggle())
  })
})

describe('Concede from the menu (D31, D39)', () => {
  it('asks first, and "Keep playing" submits nothing', () => {
    const chosen = mount(createGame({ seed: 1, decks: DECKS, defs: CARD_DEFS }))
    click(toggle())
    click(item('concede')!)
    const dialog = document.querySelector<HTMLDialogElement>('dialog[data-concede-dialog]')
    expect(dialog, 'no confirmation').not.toBeNull()
    expect(dialog!.getAttribute('role')).toBe('alertdialog')
    expect(document.activeElement?.textContent, 'focus should land on the safe answer').toBe('Keep playing')
    click(document.querySelector('dialog[data-concede-dialog] [data-command="cancel-concede"]')!)
    expect(chosen).toEqual([])
    expect(document.querySelector('dialog[data-concede-dialog]')).toBeNull()
    expect(document.activeElement).toBe(toggle())
  })

  it('"Concede game" submits the concede choice, once', () => {
    const chosen = mount(createGame({ seed: 1, decks: DECKS, defs: CARD_DEFS }))
    click(toggle())
    click(item('concede')!)
    click(document.querySelector('dialog[data-concede-dialog] [data-command="concede"]')!)
    expect(chosen.map((c) => c.command.type)).toEqual(['concede'])
  })

  it('is offered while the AI is thinking, when the strip offers nothing (Review Focus 1)', () => {
    const chosen = mount(createGame({ seed: 1, decks: DECKS, defs: CARD_DEFS }), { aiThinking: true })
    expect(document.querySelector('.prompt__actions button[data-command]')).toBeNull()
    click(toggle())
    expect(item('concede')!.disabled).toBe(false)
    click(item('concede')!)
    click(document.querySelector('dialog[data-concede-dialog] [data-command="concede"]')!)
    expect(chosen.map((c) => c.command.type)).toEqual(['concede'])
  })

  it('is offered at a concede-only position, where the strip shows no button (G6, Review Focus 1)', () => {
    const s = createGame({ seed: 1, decks: DECKS, defs: CARD_DEFS })
    const view = viewFor(s, HUMAN)
    const real = choicesFor(s)
    const concede = real.all.find((c) => c.command.type === 'concede')!
    // The G6 shape: every other answer is on a card, so the strip holds nothing; the menu must still concede.
    const cardChoice: Choice = { command: concede.command, label: 'On a card', card: view.hand[0]! }
    const choices: ChoiceSet = { ...real, all: [concede, cardChoice], loose: [concede], byCard: new Map([[view.hand[0]!, [cardChoice]]]) }
    const chosen = mount(s, { choices })
    expect(document.querySelector('.prompt__actions button[data-command="concede"]'), 'G6 regressed: the strip offers Concede alone').toBeNull()
    click(toggle())
    click(item('concede')!)
    click(document.querySelector('dialog[data-concede-dialog] [data-command="concede"]')!)
    expect(chosen).toEqual([concede])
  })

  it('is disabled once the game is over', () => {
    const s = createGame({ seed: 1, decks: DECKS, defs: CARD_DEFS })
    const concede = legalCommands(s, HUMAN).find((c) => c.type === 'concede')!
    const over = apply(s, concede).state
    expect(over.result, 'conceding did not end the game').not.toBeNull()
    mount(over)
    click(toggle())
    expect(item('concede')!.disabled).toBe(true)
  })
})
```

(`apply` is imported from `@fftcg/engine` alongside `createGame`.) Never cast a fixture with `as never` or `as GameState`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run apps/web/test/menu.test.tsx`
Expected: FAIL — `toggle()` is null (no `.tools button[aria-haspopup="menu"]`).

- [ ] **Step 3: Write `usePopover.ts`**

```ts
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

/**
 * A toggle button and the panel it opens (rung U2c): the menu, the settings popover. One rule set for both:
 * Escape closes and puts focus back on the toggle; a pointer press outside the two closes without moving focus; focus
 * leaving both (Tab out) closes. The caller renders the panel only while `open`, so a closed panel is not in the DOM.
 */
export function usePopover(defaultOpen = false): {
  open: boolean
  setOpen: (v: boolean) => void
  toggleRef: RefObject<HTMLButtonElement | null>
  panelRef: RefObject<HTMLElement | null>
  /** Close; `restoreFocus` puts focus on the toggle (keyboard paths), false leaves it where the player put it. */
  close: (restoreFocus: boolean) => void
} {
  const [open, setOpen] = useState(defaultOpen)
  const toggleRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLElement | null>(null)
  const close = useCallback((restoreFocus: boolean): void => {
    setOpen(false)
    if (restoreFocus) toggleRef.current?.focus()
  }, [])
  useEffect(() => {
    if (!open) return undefined
    const inside = (t: EventTarget | null): boolean =>
      t instanceof Node && (panelRef.current?.contains(t) === true || toggleRef.current?.contains(t) === true)
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.stopPropagation(); close(true) } }
    const onPointer = (e: PointerEvent): void => { if (!inside(e.target)) close(false) }
    const onFocus = (e: FocusEvent): void => { if (!inside(e.target)) close(false) }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('focusin', onFocus)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('focusin', onFocus)
    }
  }, [open, close])
  return { open, setOpen, toggleRef, panelRef, close }
}
```

- [ ] **Step 4: Write `ConcedeDialog.tsx`**

```tsx
import { useEffect, useId, useRef, type JSX } from 'react'

/**
 * "Concede this game?" (rung U2c, D39). The strip's Concede arms on a first click and fires on a second; the menu's goes
 * through this native modal instead, because a menu item that needs two presses is not a pattern anyone knows. An
 * `alertdialog`: it interrupts to confirm an irreversible act. Focus starts on "Keep playing", so Enter never concedes.
 */
export function ConcedeDialog({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }): JSX.Element {
  const ref = useRef<HTMLDialogElement | null>(null)
  const titleId = useId()
  const textId = useId()
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (typeof el.showModal === 'function' && !el.open) el.showModal()
    el.querySelector<HTMLButtonElement>('[data-command="cancel-concede"]')?.focus()
  }, [])
  return (
    <dialog
      ref={ref} className="sheet confirm" role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={textId}
      data-concede-dialog onCancel={(e) => { e.preventDefault(); onCancel() }}
    >
      <div className="confirm__body">
        <h2 id={titleId} className="sheet__name">Concede this game?</h2>
        <p id={textId} className="confirm__text">The AI wins, and the board is kept so you can look over it. There is no undo.</p>
        <div className="sheet__actions">
          <button type="button" className="btn btn--ghost" data-command="cancel-concede" onClick={onCancel}>Keep playing</button>
          <button type="button" className="btn btn--danger" data-command="concede" onClick={onConfirm}>Concede game</button>
        </div>
      </div>
    </dialog>
  )
}
```

- [ ] **Step 5: Write `Menu.tsx`**

```tsx
import { useEffect, useId, useState, type JSX, type KeyboardEvent } from 'react'
import type { Choice } from '../../game/types.js'
import { usePopover } from '../usePopover.js'
import { ConcedeDialog } from './ConcedeDialog.js'

/**
 * The top-bar menu (rung U2c, D31): Concede, available at every position because the strip hides it at concede-only
 * decisions (G6) and locks during playback (U3+); and How to play, which left the rail with the rail.
 *
 * A WAI menu button: `aria-haspopup="menu"`, `aria-expanded`, a `role="menu"` of `menuitem`s, arrows that wrap, Escape
 * back to the button. Opening puts focus on the first item, so a keyboard player is in the menu, not beside it.
 */
export function Menu({ onHelp, concede, onConcede, defaultOpen = false }: {
  onHelp?: (() => void) | undefined
  /** The position's concede choice, or null once the game is over. */
  concede: Choice | null
  onConcede: (c: Choice) => void
  /** The fixture gallery renders it open. */
  defaultOpen?: boolean
}): JSX.Element {
  const { open, setOpen, toggleRef, panelRef, close } = usePopover(defaultOpen)
  const [confirming, setConfirming] = useState(false)
  const id = useId()
  useEffect(() => {
    if (open) panelRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not([disabled])')?.focus()
  }, [open, panelRef])
  const arrows = (e: KeyboardEvent<HTMLDivElement>): void => {
    const items = [...(panelRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])]
    const at = items.findIndex((b) => b === document.activeElement)
    let to: number
    switch (e.key) {
      case 'ArrowDown': to = (at + 1) % items.length; break
      case 'ArrowUp': to = (at - 1 + items.length) % items.length; break
      case 'Home': to = 0; break
      case 'End': to = items.length - 1; break
      default: return
    }
    e.preventDefault()
    items[to]?.focus()
  }
  const done = (): void => { setConfirming(false); toggleRef.current?.focus() }
  return (
    <div className="menu">
      <button
        ref={toggleRef} type="button" className="btn btn--ghost tools__btn" aria-haspopup="menu" aria-expanded={open}
        aria-controls={id} onClick={() => setOpen(!open)}
      >
        <span className="tools__glyph" aria-hidden="true">☰</span> Menu
      </button>
      {open && (
        <div ref={(el) => { panelRef.current = el }} id={id} role="menu" aria-label="Menu" className="popover menu__panel" onKeyDown={arrows}>
          {onHelp && (
            <button type="button" role="menuitem" className="menu__item" data-menu="help" onClick={() => { close(true); onHelp() }}>How to play</button>
          )}
          <button
            type="button" role="menuitem" className="menu__item menu__item--danger" data-menu="concede" disabled={concede === null}
            onClick={() => { close(false); setConfirming(true) }}
          >
            Concede
          </button>
        </div>
      )}
      {confirming && <ConcedeDialog onConfirm={() => { done(); if (concede) onConcede(concede) }} onCancel={done} />}
    </div>
  )
}
```

- [ ] **Step 6: Write `TopBar.tsx`**

```tsx
import type { JSX, ReactNode } from 'react'

/**
 * The toolbar row (rung U2c, D38): the tools cluster first in the DOM, the deck picker second, drawn the other way round.
 * The picker must stay the LAST three tab stops of the page (`deck-picker.spec.ts`: New game throws the game away, so a
 * keyboard player meets it after everything else), and only the picker carries `.table__toolbar`.
 */
export function TopBar({ picker, children }: { picker: ReactNode; children: ReactNode }): JSX.Element {
  return (
    <div className="table__top">
      <div className="tools">{children}</div>
      {picker}
    </div>
  )
}
```

- [ ] **Step 7: Wire it in `Board.tsx`**

Add the imports:

```ts
import { Menu } from './board/Menu.js'
import { TopBar } from './board/TopBar.js'
```

Add, after `const shown = …` (line 449):

```ts
  // Rung U2c (D31): the menu's Concede. `legalCommands` lists concede for either player at any time, so it is in
  // `choices.all` whenever the game is on — while the AI thinks, and at the G6 positions where the strip hides it.
  const concedeChoice = view.result ? null : choices.all.find((c) => c.command.type === 'concede') ?? null
```

Replace the rail's help block (lines 682–687) by deleting it, and replace the picker line (695) with:

```tsx
      {/* Rung V1-C / U2c (D38): drawn above the board, LAST in the DOM. The tools come first inside, so the picker keeps
          the last three tab stops; the menu, settings and log are chrome a keyboard player reaches after the board. */}
      <TopBar picker={selection && <DeckPicker selected={selection} onSelect={setSelection} onNewGame={newGame} />}>
        <Menu onHelp={onHelp} concede={concedeChoice} onConcede={(c) => { setPaying(null); setSelecting(null); choose(c) }} />
      </TopBar>
```

The `<aside className="table__rail">` keeps `CardDetails` and `EventLog` for now (Tasks 3 and 4 move them).

- [ ] **Step 8: CSS**

In `styles.css`, in the deck picker block, change `.picker` to drop `grid-area: toolbar` and the border (the wrapper owns
both), and add the new rules after it:

```css
.picker {
  display: flex;
  align-items: center;
  gap: var(--s2) var(--s3);
  flex-wrap: wrap;
  padding: var(--s1) var(--s5);
  order: 1;
}

/* Rung U2c (D38): the toolbar row. The tools are FIRST in the DOM and drawn LAST, so the picker stays the end of the tab
 * order (deck-picker.spec). */
.table__top { grid-area: toolbar; display: flex; align-items: center; border-bottom: 1px solid var(--line-soft); }
.tools { order: 2; margin-left: auto; display: flex; align-items: center; gap: var(--s2); padding: var(--s1) var(--s4); }
.tools__btn { padding: var(--s1) var(--s3); }
.tools__glyph { font-size: 14px; line-height: 1; }
.menu { position: relative; }
.popover {
  position: absolute; top: calc(100% + 4px); right: 0; z-index: var(--z-inspect);
  min-width: 200px; padding: var(--s2); border: 1px solid var(--line-strong); border-radius: var(--r-md);
  background: var(--surface); color: var(--ink); box-shadow: var(--shadow-panel);
}
.menu__panel { display: flex; flex-direction: column; gap: 2px; }
.menu__item {
  padding: var(--s2) var(--s3); border: 0; border-radius: var(--r-sm); background: transparent; color: var(--ink);
  font: inherit; text-align: left; cursor: pointer;
}
.menu__item:hover:not(:disabled), .menu__item:focus-visible { background: color-mix(in oklab, var(--accent-act) 14%, transparent); }
.menu__item:disabled { color: var(--dim); cursor: default; }
.menu__item--danger:hover:not(:disabled) { color: #ff9c9c; }
.confirm { width: min(28rem, calc(100vw - 2 * var(--s5))); }
.confirm__body { display: flex; flex-direction: column; gap: var(--s3); padding: var(--s5) var(--s6); }
.confirm__text { margin: 0; color: var(--ink-2); }
```

Check `--surface`, `--shadow-panel`, `--r-md`, `--r-sm`, `--line-strong`, `--dim` exist in `styles.css` (lines 60–95) — they
are used by `.panel` and `.picker__select` today. If one is missing, use the nearest existing token and say so in the commit.

- [ ] **Step 9: Update the How to play tests for the moved button**

`apps/web/test/how-to-play.test.tsx` lines 131–150 — replace the `helpButton` helper and the two tests:

```ts
describe('the menu item (H1-D3, moved into the menu by rung U2c)', () => {
  function api(): GameApi {
    const v = viewFor(createGame({ seed: 1, decks: DECKS, defs: CARD_DEFS }), HUMAN)
    return { view: v, choices: buildChoiceSet(v, []), log: [], aiThinking: false, choose: (_c: Choice) => {}, restart: () => {} }
  }
  const openMenu = (): void => {
    const t = document.querySelector<HTMLButtonElement>('.tools button[aria-haspopup="menu"]')!
    act(() => { t.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  }
  const helpItem = (): HTMLButtonElement | undefined =>
    [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((b) => b.textContent === 'How to play')

  it('is absent when the board is given nothing to open — so no existing test moves', () => {
    mount(createElement(Board, { game: api() }))
    openMenu()
    expect(helpItem()).toBeUndefined()
  })

  it('opens the sheet when given onHelp', () => {
    let opened = 0
    mount(createElement(Board, { game: api(), onHelp: () => { opened++ } }))
    openMenu()
    const btn = helpItem()
    expect(btn, 'no "How to play" item in the menu').toBeDefined()
    act(() => { btn!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(opened).toBe(1)
  })
})
```

`apps/web/e2e/how-to-play.spec.ts`: line 25–26, the always-present board control becomes the menu button:

```ts
    // The top bar's menu button: always present, always outside the sheet.
    const outside = document.querySelector<HTMLElement>('.tools button[aria-haspopup="menu"]')
```

Line 36, the on-board list: replace `.table__rail` with `.table__top, .table__preview, .drawer`. The H1-A2 test
(`getByRole('button', { name: 'How to play' })`) becomes: click the `Menu` button, then the `How to play` menuitem:

```ts
  await page.getByRole('button', { name: 'Menu' }).click()
  await page.getByRole('menuitem', { name: 'How to play' }).click()
```

- [ ] **Step 10: Run the tests**

Run: `pnpm vitest run apps/web/test/menu.test.tsx apps/web/test/how-to-play.test.tsx apps/web/test/focus.test.tsx apps/web/test/card-details.test.tsx && pnpm test:browser how-to-play deck-picker`
Expected: all PASS. `deck-picker.spec.ts`'s tab-order lap still ends `select:Your deck, select:AI deck, button:New game…`
— if the lap records a `tools` stop after the picker, the DOM order inside `TopBar` is wrong.

- [ ] **Step 11: Commit**

```bash
git add apps/web/src/ui/usePopover.ts apps/web/src/ui/board/Menu.tsx apps/web/src/ui/board/ConcedeDialog.tsx apps/web/src/ui/board/TopBar.tsx apps/web/src/ui/Board.tsx apps/web/src/styles.css apps/web/test/menu.test.tsx apps/web/test/how-to-play.test.tsx apps/web/e2e/how-to-play.spec.ts
git commit -m "feat(web): the top bar — a menu with Concede (confirmed) and How to play (U2c)"
```

---

### Task 2: live settings — the store and the popover

**Files:**
- Create: `apps/web/src/settingsStore.ts`
- Modify: `apps/web/src/bootstrap.ts` (uses the store; keeps `parseFlags`, `effectiveSettings`, `Boot`, `Flags` exports)
- Create: `apps/web/src/ui/board/SettingsPopover.tsx`
- Modify: `apps/web/src/ui/Board.tsx` (a `<SettingsPopover />` in `TopBar`, before `<Menu>`)
- Modify: `apps/web/src/styles.css` (the `.settings` rules)
- Create: `apps/web/test/settings-store.test.ts`, `apps/web/test/settings-popover.test.tsx`
- Modify: `apps/web/e2e/chrome.spec.ts` (append)

**Interfaces:**
- Produces: `initSettingsStore(stored: Settings, flags: Flags, env: { root: HTMLElement; storage: SettingsStorage | null | undefined; systemPrefersReduced: boolean }): Settings`;
  `setSystemPrefersReduced(v: boolean): void`;
  `settingsStore: { get(): Settings; flags(): Flags; subscribe(cb: () => void): () => void; update(patch: Partial<Settings>): boolean }`;
  `useSettings(): { settings: Settings; flags: Flags; update: (patch: Partial<Settings>) => void }`;
  `SettingsPopover({ defaultOpen?: boolean })`.
- Consumes: `TopBar` (Task 1), `usePopover` (Task 1).

- [ ] **Step 1: Write the failing store tests**

`apps/web/test/settings-store.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest'
import { initSettingsStore, setSystemPrefersReduced, settingsStore } from '../src/settingsStore'
import { DEFAULT_SETTINGS, SETTINGS_KEY, type SettingsStorage } from '../src/settings'

const NO_FLAGS = { motionInstant: false, artOff: false, perf: false }
const memory = (init: Record<string, string> = {}): SettingsStorage & { data: Map<string, string> } => {
  const data = new Map(Object.entries(init))
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v) } }
}
const root = (): HTMLElement => document.documentElement

afterEach(() => {
  root().removeAttribute('style')
  for (const k of ['speed', 'reducedMotion', 'effects']) delete root().dataset[k]
})

describe('the settings store (rung U2c, spec section 8)', () => {
  it('applies on init and again on every update, and tells subscribers', () => {
    const store = memory()
    initSettingsStore({ ...DEFAULT_SETTINGS }, NO_FLAGS, { root: root(), storage: store, systemPrefersReduced: false })
    expect(root().style.getPropertyValue('--motion-scale')).toBe('1')
    let told = 0
    const off = settingsStore.subscribe(() => { told++ })
    expect(settingsStore.update({ speed: 'fast' })).toBe(true)
    expect(settingsStore.get().speed).toBe('fast')
    expect(root().style.getPropertyValue('--motion-scale')).toBe('0.6')
    expect(root().dataset['speed']).toBe('fast')
    expect(JSON.parse(store.data.get(SETTINGS_KEY)!)).toEqual({ ...DEFAULT_SETTINGS, speed: 'fast' })
    expect(told).toBe(1)
    off()
    settingsStore.update({ effects: 'reduced' })
    expect(told, 'an unsubscribed listener was told').toBe(1)
  })

  it('re-applies the CURRENT settings when the system reduced-motion preference changes (Review Focus 2)', () => {
    initSettingsStore({ ...DEFAULT_SETTINGS }, NO_FLAGS, { root: root(), storage: memory(), systemPrefersReduced: false })
    settingsStore.update({ effects: 'reduced' })
    setSystemPrefersReduced(true)
    expect(root().dataset['reducedMotion']).toBe('true')
    expect(root().dataset['effects'], 'the system change re-applied boot-time settings').toBe('reduced')
    settingsStore.update({ reducedMotion: 'off' })
    expect(root().dataset['reducedMotion']).toBe('false')
  })

  it('keeps ?motion=instant for the page and never writes it (harness.spec, Review Focus 2)', () => {
    const store = memory()
    initSettingsStore({ ...DEFAULT_SETTINGS, speed: 'fast' }, { ...NO_FLAGS, motionInstant: true }, { root: root(), storage: store, systemPrefersReduced: false })
    expect(settingsStore.get().speed).toBe('instant')
    expect(settingsStore.flags().motionInstant).toBe(true)
    settingsStore.update({ effects: 'reduced' })
    expect(JSON.parse(store.data.get(SETTINGS_KEY)!)).toEqual({ ...DEFAULT_SETTINGS, speed: 'fast', effects: 'reduced' })
    expect(settingsStore.get().speed, 'the flag stopped overriding').toBe('instant')
  })

  it('applies for this page and reports the failed save when storage is blocked (Review Focus 2)', () => {
    initSettingsStore({ ...DEFAULT_SETTINGS }, NO_FLAGS, { root: root(), storage: null, systemPrefersReduced: false })
    expect(settingsStore.update({ speed: 'instant' })).toBe(false)
    expect(settingsStore.get().speed).toBe('instant')
    expect(root().style.getPropertyValue('--motion-scale')).toBe('0')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run apps/web/test/settings-store.test.ts`
Expected: FAIL — cannot resolve `../src/settingsStore`.

- [ ] **Step 3: Write `settingsStore.ts`**

```ts
import { useSyncExternalStore } from 'react'
import { applySettings, saveSettings, type Settings, type SettingsStorage } from './settings.js'

/**
 * The live settings (rung U2c, spec section 8). `bootstrap()` seeds it once from storage and the URL; the settings popover
 * writes it; `<html>` is re-styled on every change and on every system reduced-motion change — reading the CURRENT
 * settings, which `bootstrap()`'s old listener could not do (it closed over boot time).
 *
 * `stored` is the preference, `effective` is what the page runs: `?motion=instant` overrides the speed for this page and
 * is never written back (a flag is not a preference). A module-level store: there is one page and one `<html>`.
 */

export interface Flags {
  /** `?motion=instant`: Instant speed for this page load only. What the browser suite runs at (D24). */
  motionInstant: boolean
  /** `?art=off`: text cards only. What every screenshot baseline uses (D18). */
  artOff: boolean
  /** `?perf=1`: the frame and long-task overlay. */
  perf: boolean
}

/** The settings this page runs with. The URL overrides; it never writes back. */
export function effectiveSettings(stored: Settings, flags: Flags): Settings {
  return flags.motionInstant ? { ...stored, speed: 'instant' } : stored
}

interface Env { root: HTMLElement; storage: SettingsStorage | null | undefined; systemPrefersReduced: boolean }

let stored: Settings = { speed: 'normal', reducedMotion: 'system', effects: 'full', skipOnClick: true }
let flags: Flags = { motionInstant: false, artOff: false, perf: false }
let effective: Settings = stored
let env: Env | null = null
const listeners = new Set<() => void>()

function apply(): void {
  if (env) applySettings(effective, env.root, env.systemPrefersReduced)
}

/** Seed the store and style `<html>`. Returns the effective settings. */
export function initSettingsStore(initial: Settings, pageFlags: Flags, environment: Env): Settings {
  stored = initial
  flags = pageFlags
  env = environment
  effective = effectiveSettings(stored, flags)
  apply()
  for (const l of listeners) l()
  return effective
}

/** The system changed its reduced-motion preference: re-style with the settings as they are NOW. */
export function setSystemPrefersReduced(v: boolean): void {
  if (!env) return
  env = { ...env, systemPrefersReduced: v }
  apply()
}

export const settingsStore = {
  get: (): Settings => effective,
  flags: (): Flags => flags,
  subscribe: (cb: () => void): (() => void) => { listeners.add(cb); return () => { listeners.delete(cb) } },
  /** Change the preference, persist it, re-style. `false` when storage refused: the change holds for this page only. */
  update: (patch: Partial<Settings>): boolean => {
    stored = { ...stored, ...patch }
    effective = effectiveSettings(stored, flags)
    // `undefined` storage means "the browser's": `saveSettings` falls back to `localStorage` for an absent argument.
    const saved = env?.storage === undefined ? saveSettings(stored) : saveSettings(stored, env.storage)
    apply()
    for (const l of listeners) l()
    return saved
  },
}

export function useSettings(): { settings: Settings; flags: Flags; update: (patch: Partial<Settings>) => void } {
  const settings = useSyncExternalStore(settingsStore.subscribe, settingsStore.get, settingsStore.get)
  return { settings, flags: settingsStore.flags(), update: settingsStore.update }
}
```

Note `saveSettings(stored)` with no second argument: `env.storage === undefined` is the page (the browser's storage);
`null` is "no storage" and `saveSettings(stored, null)` returns false.

- [ ] **Step 4: Rewire `bootstrap.ts`**

Replace the `Flags` interface and `effectiveSettings` function with re-exports, and the body of `bootstrap`:

```ts
import { disableArt } from './game/art.js'
import { loadSettings, type Settings, type SettingsStorage } from './settings.js'
import { effectiveSettings, initSettingsStore, setSystemPrefersReduced, type Flags } from './settingsStore.js'

export { effectiveSettings, type Flags }

// … `ACCEPTED`, `parseFlags` unchanged …

export interface Boot { settings: Settings; flags: Flags }

const REDUCED_QUERY = '(prefers-reduced-motion: reduce)'

/**
 * Read the flags and the stored settings, seed the live store (which styles `<html>`), and keep `data-reduced-motion` in
 * step with the system setting while the page is open. `storage` is a test seam; the page passes nothing and gets
 * `localStorage`.
 */
export function bootstrap(win: Window = window, storage?: SettingsStorage | null): Boot {
  const flags = parseFlags(win.location.search)
  const stored = storage === undefined ? loadSettings() : loadSettings(storage)
  if (flags.artOff) disableArt()
  // jsdom and some embedded engines have no matchMedia: treat the system as not asking for reduced motion.
  const media = typeof win.matchMedia === 'function' ? win.matchMedia(REDUCED_QUERY) : null
  const settings = initSettingsStore(stored, flags, { root: win.document.documentElement, storage, systemPrefersReduced: media?.matches ?? false })
  media?.addEventListener('change', () => { setSystemPrefersReduced(media.matches) })
  return { settings, flags }
}
```

Run: `pnpm vitest run apps/web/test/bootstrap.test.ts apps/web/test/settings-store.test.ts apps/web/test/settings.test.ts`
Expected: PASS (the five `bootstrap` cases, including "re-applies when the system reduced-motion setting changes").

- [ ] **Step 5: Write the failing popover test**

`apps/web/test/settings-popover.test.tsx`:

```tsx
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createGame, viewFor } from '@fftcg/engine'
import { CARD_DEFS, DECKS } from '../src/deck.js'
import { Board } from '../src/ui/Board.js'
import { buildChoiceSet } from '../src/game/commands.js'
import { HUMAN, type Choice, type GameApi } from '../src/game/types.js'
import { initSettingsStore, settingsStore } from '../src/settingsStore.js'
import { DEFAULT_SETTINGS, SETTINGS_KEY, type SettingsStorage } from '../src/settings.js'

/** Rung U2c (spec section 8): the settings popover edits the live store; every control is a native radio. */

Element.prototype.scrollIntoView = function scrollIntoView() {}
const NO_FLAGS = { motionInstant: false, artOff: false, perf: false }
const memory = (): SettingsStorage & { data: Map<string, string> } => {
  const data = new Map<string, string>()
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v) } }
}

let root: Root | null = null
let host: HTMLDivElement | null = null
let store = memory()
beforeEach(() => { store = memory(); initSettingsStore({ ...DEFAULT_SETTINGS }, NO_FLAGS, { root: document.documentElement, storage: store, systemPrefersReduced: false }) })
afterEach(() => { act(() => { root?.unmount() }); host?.remove(); root = null; host = null })

function mount(): void {
  const v = viewFor(createGame({ seed: 1, decks: DECKS, defs: CARD_DEFS }), HUMAN)
  const api: GameApi = { view: v, choices: buildChoiceSet(v, []), log: [], aiThinking: false, choose: (_c: Choice) => {}, restart: () => {} }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root!.render(createElement(Board, { game: api })) })
}
const toggle = (): HTMLButtonElement => document.querySelector<HTMLButtonElement>('.tools button[aria-haspopup="dialog"]')!
const click = (el: Element): void => { act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) }) }
const radio = (name: string, value: string): HTMLInputElement => document.querySelector<HTMLInputElement>(`[data-settings] input[name="${name}"][value="${value}"]`)!
const choose = (name: string, value: string): void => { act(() => { radio(name, value).click() }) }

describe('the settings popover', () => {
  it('opens a labelled non-modal dialog from a button that says so, and focuses its heading', () => {
    mount()
    const t = toggle()
    expect(t.getAttribute('aria-expanded')).toBe('false')
    click(t)
    const panel = document.querySelector('[data-settings]')!
    expect(panel.getAttribute('role')).toBe('dialog')
    expect(panel.getAttribute('aria-modal')).toBeNull()
    expect(document.getElementById(panel.getAttribute('aria-labelledby')!)?.textContent).toBe('Settings')
    expect(t.getAttribute('aria-controls')).toBe(panel.id)
    expect(document.activeElement?.textContent).toBe('Settings')
  })

  it('shows the four settings as radio groups with the stored values checked', () => {
    settingsStore.update({ speed: 'fast', reducedMotion: 'on', effects: 'reduced', skipOnClick: false })
    mount()
    click(toggle())
    expect(radio('speed', 'fast').checked).toBe(true)
    expect(radio('reducedMotion', 'on').checked).toBe(true)
    expect(radio('effects', 'reduced').checked).toBe(true)
    expect(radio('skipOnClick', 'off').checked).toBe(true)
    for (const fs of document.querySelectorAll('[data-settings] fieldset')) expect(fs.querySelector('legend')?.textContent, 'a group without a legend').toBeTruthy()
  })

  it('a change writes the store, storage and <html> at once', () => {
    mount()
    click(toggle())
    choose('speed', 'instant')
    expect(settingsStore.get().speed).toBe('instant')
    expect(document.documentElement.dataset['speed']).toBe('instant')
    expect(JSON.parse(store.data.get(SETTINGS_KEY)!).speed).toBe('instant')
    choose('skipOnClick', 'off')
    expect(settingsStore.get().skipOnClick).toBe(false)
  })

  it('under ?motion=instant the speed group is disabled and explains itself (Review Focus 2)', () => {
    initSettingsStore({ ...DEFAULT_SETTINGS }, { ...NO_FLAGS, motionInstant: true }, { root: document.documentElement, storage: store, systemPrefersReduced: false })
    mount()
    click(toggle())
    expect(radio('speed', 'instant').checked).toBe(true)
    expect(radio('speed', 'normal').disabled).toBe(true)
    expect(document.querySelector('[data-settings]')!.textContent).toContain('?motion=instant')
  })

  it('Escape closes it and returns focus to the button', () => {
    mount()
    click(toggle())
    act(() => { document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(document.querySelector('[data-settings]')).toBeNull()
    expect(document.activeElement).toBe(toggle())
  })
})
```

Run: `pnpm vitest run apps/web/test/settings-popover.test.tsx`
Expected: FAIL — `toggle()` is null.

- [ ] **Step 6: Write `SettingsPopover.tsx`**

```tsx
import { useEffect, useId, type JSX } from 'react'
import { useSettings } from '../../settingsStore.js'
import type { Effects, ReducedMotionPref, Speed } from '../../settings.js'
import { usePopover } from '../usePopover.js'

/**
 * The settings popover (rung U2c, spec section 8, D9): speed, reduced motion, effects, skip on click. Native radios in
 * labelled fieldsets — the most accessible control there is, and the values are small closed sets. A non-modal dialog:
 * the board stays usable behind it. Sound arrives with U8. The full-control toggle is NOT here (K4-D5): it is gameplay
 * input and lives with the actions.
 */
function Group<T extends string>({ name, legend, value, options, onChange, disabled = false }: {
  name: string
  legend: string
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (v: T) => void
  disabled?: boolean
}): JSX.Element {
  return (
    <fieldset className="settings__group" disabled={disabled}>
      <legend className="settings__legend">{legend}</legend>
      <div className="settings__options">
        {options.map((o) => (
          <label key={o.value} className="settings__option">
            <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

const SPEEDS: readonly { value: Speed; label: string }[] = [{ value: 'normal', label: 'Normal' }, { value: 'fast', label: 'Fast' }, { value: 'instant', label: 'Instant' }]
const REDUCED: readonly { value: ReducedMotionPref; label: string }[] = [{ value: 'system', label: 'System' }, { value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]
const EFFECTS: readonly { value: Effects; label: string }[] = [{ value: 'full', label: 'Full' }, { value: 'reduced', label: 'Reduced' }]
const SKIP: readonly { value: 'on' | 'off'; label: string }[] = [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]

export function SettingsPopover({ defaultOpen = false }: { defaultOpen?: boolean }): JSX.Element {
  const { settings, flags, update } = useSettings()
  const { open, setOpen, toggleRef, panelRef } = usePopover(defaultOpen)
  const id = useId()
  const titleId = useId()
  useEffect(() => {
    if (open) panelRef.current?.querySelector<HTMLElement>('[data-dialog-title]')?.focus()
  }, [open, panelRef])
  return (
    <div className="settings">
      <button
        ref={toggleRef} type="button" className="btn btn--ghost tools__btn" aria-haspopup="dialog" aria-expanded={open}
        aria-controls={id} onClick={() => setOpen(!open)}
      >
        <span className="tools__glyph" aria-hidden="true">⚙</span> Settings
      </button>
      {open && (
        <div ref={(el) => { panelRef.current = el }} id={id} role="dialog" aria-labelledby={titleId} className="popover settings__panel" data-settings>
          <h2 id={titleId} className="settings__title" data-dialog-title tabIndex={-1}>Settings</h2>
          <Group name="speed" legend="Animation speed" value={settings.speed} options={SPEEDS} onChange={(v) => update({ speed: v })} disabled={flags.motionInstant} />
          {flags.motionInstant && <p className="settings__note">Instant for this page: the address has ?motion=instant.</p>}
          <Group name="reducedMotion" legend="Reduced motion" value={settings.reducedMotion} options={REDUCED} onChange={(v) => update({ reducedMotion: v })} />
          <Group name="effects" legend="Effects" value={settings.effects} options={EFFECTS} onChange={(v) => update({ effects: v })} />
          <Group name="skipOnClick" legend="Skip on click" value={settings.skipOnClick ? 'on' : 'off'} options={SKIP} onChange={(v) => update({ skipOnClick: v === 'on' })} />
        </div>
      )}
    </div>
  )
}
```

In `Board.tsx`, import it and render `<SettingsPopover />` inside `<TopBar>` BEFORE `<Menu … />`.

- [ ] **Step 7: CSS**

Append after the `.menu__item--danger` rule:

```css
.settings { position: relative; }
.settings__panel { min-width: 260px; display: flex; flex-direction: column; gap: var(--s3); }
.settings__title { margin: 0; font-family: var(--font-condensed); font-size: var(--t-md); letter-spacing: 0.1em; text-transform: uppercase; }
.settings__group { margin: 0; padding: 0; border: 0; min-width: 0; }
.settings__legend { padding: 0; margin-bottom: var(--s1); font-size: var(--t-xs); letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-2); }
.settings__options { display: flex; gap: var(--s3); flex-wrap: wrap; }
.settings__option { display: inline-flex; align-items: center; gap: 6px; font-size: var(--t-sm); }
.settings__group:disabled .settings__option { color: var(--dim); }
.settings__note { margin: 0; font-size: var(--t-xs); color: var(--dim); }
```

- [ ] **Step 8: Append the persistence check to `chrome.spec.ts`**

```ts
test('a speed chosen in the settings popover applies at once and survives a reload (spec section 8)', async ({ page }) => {
  // The suite's storage state pins Instant; this test starts clean so Normal is the default it changes from.
  await page.context().clearCookies()
  await page.goto('/?seed=1&decks=vol2,vol2')
  await page.evaluate(() => { localStorage.removeItem('fftcg.settings'); localStorage.setItem('fftcg.howToPlay.seen', '1') })
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-speed', 'normal')
  await page.getByRole('button', { name: 'Settings' }).click()
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('Fast').check()
  await expect(page.locator('html')).toHaveAttribute('data-speed', 'fast')
  expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--motion-scale'))).toBe('0.6')
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('button', { name: 'Settings' })).toBeFocused()
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-speed', 'fast')
})

test('under ?motion=instant the speed group is disabled and nothing is written (harness.spec)', async ({ page }) => {
  await page.goto('/?seed=1&decks=vol2,vol2&motion=instant')
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByRole('dialog', { name: 'Settings' }).getByLabel('Normal')).toBeDisabled()
})
```

- [ ] **Step 9: Run the tests**

Run: `pnpm vitest run apps/web/test/settings-popover.test.tsx apps/web/test/settings-store.test.ts apps/web/test/bootstrap.test.ts apps/web/test/menu.test.tsx && pnpm test:browser chrome harness`
Expected: the settings cases PASS; in `chrome.spec.ts` the drawer test still FAILS (Task 3).

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/settingsStore.ts apps/web/src/bootstrap.ts apps/web/src/ui/board/SettingsPopover.tsx apps/web/src/ui/Board.tsx apps/web/src/styles.css apps/web/test/settings-store.test.ts apps/web/test/settings-popover.test.tsx apps/web/e2e/chrome.spec.ts
git commit -m "feat(web): live settings — the store and the popover (U2c)"
```

---

### Task 3: the log drawer and the ticker

**Files:**
- Create: `apps/web/src/ui/board/LogDrawer.tsx`
- Modify: `apps/web/src/ui/EventLog.tsx` (export `sentence`; a `focusable` prop)
- Modify: `apps/web/src/ui/PromptStrip.tsx` (a `ticker` prop; `.prompt__centre` wrapper)
- Modify: `apps/web/src/ui/Board.tsx` (the drawer replaces the rail's `EventLog`; the Log toggle in `TopBar`)
- Modify: `apps/web/src/styles.css` (`.drawer`, `.prompt__centre`, `.prompt__ticker`; `.prompt__text` loses `grid-area`)
- Create: `apps/web/e2e/log.ts`
- Modify: `apps/web/e2e/deck-picker.spec.ts`, `apps/web/e2e/announcements.spec.ts` (open the drawer before reading lines)
- Create: `apps/web/test/log-drawer.test.tsx`

**Interfaces:**
- Produces: `LogDrawer({ id: string; log: LogLine[]; silenced: boolean; open: boolean; onClose: () => void })`;
  `EventLog({ log, silenced?, focusable? })` — `focusable` sets `.log__lines`'s `tabIndex` (0 when true, -1 when false,
  absent when undefined); `sentence(s: string): string` exported from `EventLog.tsx`; `PromptStrip`'s new prop
  `ticker?: string | null`; `openLog(page: Page): Promise<void>` in `e2e/log.ts`.
- Consumes: `TopBar` (Task 1).

- [ ] **Step 1: Write the failing jsdom tests**

`apps/web/test/log-drawer.test.tsx`:

```tsx
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { createGame, viewFor } from '@fftcg/engine'
import { CARD_DEFS, DECKS } from '../src/deck.js'
import { Board } from '../src/ui/Board.js'
import { buildChoiceSet } from '../src/game/commands.js'
import { HUMAN, type Choice, type GameApi, type LogLine } from '../src/game/types.js'

/**
 * Rung U2c (D21, D37) — the log is a drawer. Closed, it is visually hidden with the clip pattern and NOTHING ELSE: the
 * `role="log"` node stays mounted, named and live, so the AI's moves are still announced. Open, the scroller takes focus
 * and Escape returns it to the toggle. The latest line is repeated as a ticker under the prompt, hidden from assistive
 * technology because the log already speaks it.
 */

Element.prototype.scrollIntoView = function scrollIntoView() {}

let root: Root | null = null
let host: HTMLDivElement | null = null
afterEach(() => { act(() => { root?.unmount() }); host?.remove(); root = null; host = null })

const LOG: LogLine[] = [{ kind: 'phase', text: 'Turn 1 — your turn' }, { kind: 'ai', text: "the AI's Luso attacks" }]

function mount(log: LogLine[] = LOG, result = false): void {
  const v = viewFor(createGame({ seed: 1, decks: DECKS, defs: CARD_DEFS }), HUMAN)
  const api: GameApi = { view: v, choices: buildChoiceSet(v, []), log, aiThinking: false, choose: (_c: Choice) => {}, restart: () => {} }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root!.render(createElement(Board, { game: api })) })
  void result
}
const toggle = (): HTMLButtonElement => [...document.querySelectorAll<HTMLButtonElement>('.tools button')].find((b) => b.textContent?.trim() === 'Log')!
const lines = (): HTMLElement => document.querySelector<HTMLElement>('.log__lines')!
const click = (el: Element): void => { act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) }) }

describe('the log drawer', () => {
  it('is closed by default, and the closed log is mounted, named, live, and not a tab stop', () => {
    mount()
    const t = toggle()
    expect(t.getAttribute('aria-expanded')).toBe('false')
    const drawer = document.getElementById(t.getAttribute('aria-controls')!)!
    expect(drawer.classList.contains('drawer')).toBe(true)
    expect(drawer.classList.contains('drawer--open')).toBe(false)
    const l = lines()
    expect(drawer.contains(l)).toBe(true)
    expect(l.getAttribute('role')).toBe('log')
    expect(l.getAttribute('aria-label')).toBe('Game log')
    expect(l.getAttribute('aria-live')).toBe('polite')
    expect(l.tabIndex).toBe(-1)
    for (const el of [l, drawer]) {
      expect(el.hidden).toBe(false)
      expect(el.getAttribute('aria-hidden')).toBeNull()
      expect(el.hasAttribute('inert')).toBe(false)
    }
    expect([...l.querySelectorAll('p')].map((p) => p.textContent)).toEqual(['Turn 1 — your turn', "The AI's Luso attacks"])
  })

  it('opens on the toggle, keeps the SAME log node, focuses the scroller, and Escape closes it back to the toggle', () => {
    mount()
    const before = lines()
    click(toggle())
    expect(toggle().getAttribute('aria-expanded')).toBe('true')
    expect(document.querySelector('.drawer--open')).not.toBeNull()
    expect(lines(), 'the log region was replaced').toBe(before)
    expect(lines().tabIndex).toBe(0)
    expect(document.activeElement).toBe(lines())
    act(() => { lines().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(toggle().getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(toggle())
    expect(lines(), 'closing replaced the log region').toBe(before)
  })

  it('shows the latest line as a ticker under the prompt, hidden from assistive technology (D41)', () => {
    mount()
    const ticker = document.querySelector('.prompt__ticker')!
    expect(ticker.getAttribute('aria-hidden')).toBe('true')
    expect(ticker.textContent).toBe("The AI's Luso attacks")
    expect(ticker.closest('.prompt__centre')?.contains(document.querySelector('.prompt__text'))).toBe(true)
  })

  it('shows no ticker for an empty log', () => {
    mount([])
    expect(document.querySelector('.prompt__ticker')).toBeNull()
  })
})
```

Run: `pnpm vitest run apps/web/test/log-drawer.test.tsx`
Expected: FAIL — `toggle()` is undefined.

- [ ] **Step 2: `EventLog.tsx` — export `sentence`, add `focusable`**

```ts
export const sentence = (s: string): string => `${s.charAt(0).toUpperCase()}${s.slice(1)}`

export function EventLog({ log, silenced = false, focusable }: { log: LogLine[]; silenced?: boolean; focusable?: boolean | undefined }): JSX.Element {
```

and on the `.log__lines` div add:

```tsx
        // Rung U2c: the drawer's scroller is a tab stop only while the drawer is open. Chromium makes a scroller with no
        // focusable children reachable by Tab, which would land a keyboard player inside a clipped, invisible panel.
        tabIndex={focusable === undefined ? undefined : focusable ? 0 : -1}
```

- [ ] **Step 3: Write `LogDrawer.tsx`**

```tsx
import { useEffect, useRef, type JSX } from 'react'
import type { LogLine } from '../../game/types.js'
import { EventLog } from '../EventLog.js'

/**
 * The log as a drawer (rung U2c, D21, D37). Open, it is a grid item over the right column — the stack and the preview,
 * never a card. Closed, it is the clip pattern: visually gone, but the `role="log"` region inside stays in the
 * accessibility tree and keeps announcing. Never `hidden`, `aria-hidden`, `inert` or `display: none` — any of those
 * silences the AI's moves for a screen-reader player, which is the whole reason the region exists.
 */
export function LogDrawer({ id, log, silenced, open, onClose }: {
  id: string
  log: LogLine[]
  silenced: boolean
  open: boolean
  onClose: () => void
}): JSX.Element {
  const ref = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (open) ref.current?.querySelector<HTMLElement>('.log__lines')?.focus()
  }, [open])
  return (
    <aside
      ref={ref} id={id} className={open ? 'drawer drawer--open' : 'drawer'} aria-label="Game log drawer"
      onKeyDown={(e) => { if (open && e.key === 'Escape') { e.stopPropagation(); onClose() } }}
    >
      <EventLog log={log} silenced={silenced} focusable={open} />
    </aside>
  )
}
```

- [ ] **Step 4: `PromptStrip.tsx` — the ticker**

Add the prop:

```ts
  /** Rung U2c (D41): the log's latest line, repeated under the prompt. Visual only: the log region announces it. */
  ticker?: string | null
```

(destructure `ticker = null`). Wrap the status span:

```tsx
      <div className="prompt__centre">
        <span className="prompt__text" role="status" aria-live={view.result ? 'off' : 'polite'} aria-atomic="true">
          {text}
          {aiThinking && <span className="thinking" aria-hidden="true"><span /><span /><span /></span>}
        </span>
        {ticker !== null && ticker !== '' && <div className="prompt__ticker" aria-hidden="true">{ticker}</div>}
      </div>
```

Keep the existing comments above the span. The span's attributes do not change.

- [ ] **Step 5: `Board.tsx`**

Imports: `import { LogDrawer } from './board/LogDrawer.js'`, `import { sentence } from './EventLog.js'` (drop the `EventLog`
import). State, next to `openPile`:

```ts
  // Rung U2c (D37): the log drawer. Closed by default (D22's question 2, accepted at the spec review).
  const [logOpen, setLogOpen] = useState(false)
  const drawerId = 'log-drawer'
```

Pass `ticker={log.length > 0 ? sentence(log[log.length - 1]!.text) : null}` to `<PromptStrip>`. Replace the rail's
`<EventLog …/>` line with nothing, and render the drawer right AFTER the `</aside>` of the rail (before `<TopBar>`):

```tsx
      <LogDrawer id={drawerId} log={log} silenced={view.result !== null} open={logOpen} onClose={() => { setLogOpen(false); logToggle.current?.focus() }} />
```

with `const logToggle = useRef<HTMLButtonElement | null>(null)` and, in `<TopBar>` as its FIRST child:

```tsx
        <button
          ref={logToggle} type="button" className="btn btn--ghost tools__btn" aria-expanded={logOpen} aria-controls={drawerId}
          onClick={() => setLogOpen((o) => !o)}
        >
          <span className="tools__glyph" aria-hidden="true">≡</span> Log
        </button>
```

- [ ] **Step 6: CSS**

Remove `grid-area: centre;` from `.prompt__text` and add, before `.prompt__text`:

```css
/* Rung U2c (D41): the centre column holds the status text and, under it, the log's latest line. */
.prompt__centre { grid-area: centre; z-index: 1; display: flex; flex-direction: column; justify-content: center; min-width: 0; }
.prompt__ticker {
  margin-top: 2px; padding: 0 var(--s3); font-size: var(--t-xs); color: var(--ink-3); text-align: center;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
```

Check `.prompt__text`'s own rule (line 430): if it has `align-self` or `z-index` for the grid, move those to `.prompt__centre`
and keep the text's padding and type. Add the drawer rules after the `.log__line--result` block:

```css
/* ============================ the log drawer (rung U2c, D21, D37) ============================ */

.drawer {
  grid-row: 2 / 6;
  grid-column: 4;
  z-index: var(--z-inspect);
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-left: 1px solid var(--line-strong);
  background: linear-gradient(180deg, rgb(8 11 15 / 96%), rgb(8 11 15 / 92%));
  box-shadow: -12px 0 32px -16px rgb(0 0 0 / 70%);
}

/* Closed: the clip pattern. Visually gone, in the accessibility tree, out of grid flow (absolute), no tab stop (the
   scroller's tabindex is -1 while closed). NOT display:none, hidden, aria-hidden or inert — see LogDrawer.tsx. */
.drawer:not(.drawer--open) {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
  box-shadow: none;
}

.drawer .log { flex: 1 1 auto; min-height: 0; }
```

- [ ] **Step 7: The e2e helper and the specs that read lines**

`apps/web/e2e/log.ts`:

```ts
import type { Page } from '@playwright/test'

/** Rung U2c: the log is a drawer, closed by default. A test that reads its lines opens it first (spec section 10). */
export async function openLog(page: Page): Promise<void> {
  const toggle = page.getByRole('button', { name: 'Log' })
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
}
```

`deck-picker.spec.ts`: after each `page.goto(…)` in the three tests that read `.log__line` (lines 20, 78, 93, 98), add
`await openLog(page)` (import from `./log`). In the tab-order test (line 37), do NOT open it. `announcements.spec.ts`: in
"the prompt and the log EXPOSE their content" (line 59) add `await openLog(page)` before line 81; in "the browser computes
the event log as a log region with a name" (line 110) do NOT open it — add a comment that the drawer is closed here on
purpose, and the closed-drawer exposure is the claim. `payment.spec.ts:63` and `pressable.spec.ts:63` read with
`toContainText`, which needs no visibility: unchanged.

- [ ] **Step 8: Run the tests**

Run: `pnpm vitest run apps/web/test/log-drawer.test.tsx apps/web/test/announcements.test.tsx apps/web/test/log-sentence.test.tsx apps/web/test/focus.test.tsx apps/web/test/stack-row.test.tsx apps/web/test/game-over.test.tsx && pnpm test:browser chrome announcements deck-picker layout`
Expected: PASS, except `layout.spec.ts`'s two U2c tests (Task 4: no `.table__preview` yet). The `layout.spec.ts` F1 test
(five more buttons) must still pass: if row 3 grew and a seat overflows, the ticker's `font-size` or `margin-top` is the
knob — measure with `page.locator('.prompt__centre').boundingBox()` at 1280×720 and record the height in the commit.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/ui/board/LogDrawer.tsx apps/web/src/ui/EventLog.tsx apps/web/src/ui/PromptStrip.tsx apps/web/src/ui/Board.tsx apps/web/src/styles.css apps/web/e2e/log.ts apps/web/e2e/deck-picker.spec.ts apps/web/e2e/announcements.spec.ts apps/web/test/log-drawer.test.tsx
git commit -m "feat(web): the log drawer — exposed when closed — and the ticker (U2c)"
```

---

### Task 4: the preview replaces the rail; the right column; the stack top-first

**Files:**
- Create: `apps/web/src/ui/board/CardPreview.tsx`
- Modify: `apps/web/src/ui/Board.tsx` (the `<aside className="table__rail">` goes; `<CardPreview>` in its place)
- Modify: `apps/web/src/styles.css` (grid areas; `.table__rail` block removed; `.table__preview`, `.preview__*`; `.details` in
  the preview; `.stack-row` column-reverse; `.rail__help` removed)
- Create: `apps/web/test/card-preview.test.tsx`

**Interfaces:**
- Produces: `CardPreview({ face: CardProps | null; def: CardDef | undefined; action: string | null })` rendering
  `<div className="table__preview preview">` with a `.preview__card` (a `large`, presentational `<Card>`) and `<CardDetails>`.
- Consumes: `CardDetails` (unchanged), `Card`.

- [ ] **Step 1: Write the failing test**

`apps/web/test/card-preview.test.tsx`:

```tsx
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { actingPlayer, apply, createGame, legalCommands, viewFor, type GameState } from '@fftcg/engine'
import { CARD_DEFS, DECKS } from '../src/deck.js'
import { Board } from '../src/ui/Board.js'
import { buildChoiceSet, paymentAlternatives, preferredChoices } from '../src/game/commands.js'
import { HUMAN, type Choice, type GameApi } from '../src/game/types.js'

/**
 * Rung U2c (D22, D34) — the hover preview: the looked-at card, large, beside its printed text. The `.details*` block is
 * `CardDetails` unchanged, so `card-details.test.tsx` and `details-stale.test.tsx` still read it; this file pins the card.
 */

Element.prototype.scrollIntoView = function scrollIntoView() {}

let root: Root | null = null
let host: HTMLDivElement | null = null
afterEach(() => { act(() => { root?.unmount() }); host?.remove(); root = null; host = null })

function render(s: GameState): void {
  const view = viewFor(s, HUMAN)
  const legal = legalCommands(s, HUMAN)
  const api: GameApi = { view, choices: buildChoiceSet(view, preferredChoices(view, legal), paymentAlternatives(legal)), log: [], aiThinking: false, choose: (_c: Choice) => {}, restart: () => {} }
  if (!host) { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) }
  act(() => { root!.render(createElement(Board, { game: api })) })
}
const previewCard = (): HTMLElement | null => document.querySelector<HTMLElement>('.table__preview .card--large')
const hover = (id: number): void => { act(() => { document.querySelector(`[data-card-id="${id}"]`)!.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true })) }) }

describe('the card preview', () => {
  it('is empty until a card is looked at, then shows that card large and presentational', () => {
    const s = createGame({ seed: 1, decks: DECKS, defs: CARD_DEFS })
    render(s)
    expect(document.querySelector('.table__preview')).not.toBeNull()
    expect(previewCard()).toBeNull()
    const view = viewFor(s, HUMAN)
    const id = view.hand[0]!
    hover(id)
    const card = previewCard()
    expect(card, 'no large card').not.toBeNull()
    expect(card!.getAttribute('aria-hidden')).toBe('true')
    expect(card!.querySelector('button')).toBeNull()
    expect(card!.textContent).toContain(view.defs[view.cards[id]!.code]!.name)
    expect(document.querySelector('.table__preview .details__text')?.textContent).toBe(view.defs[view.cards[id]!.code]!.text)
  })

  it('keeps the card after the instance leaves the model, built from its definition (Review Focus 4)', () => {
    let s = createGame({ seed: 1, decks: DECKS, defs: CARD_DEFS })
    render(s)
    const id = viewFor(s, HUMAN).hand[0]!
    const name = viewFor(s, HUMAN).defs[viewFor(s, HUMAN).cards[id]!.code]!.name
    hover(id)
    // Walk until the looked-at card is no longer anywhere the board draws it (it is in the Break Zone or the deck).
    for (let i = 0; i < 120 && viewFor(s, HUMAN).hand.includes(id); i++) {
      const p = actingPlayer(s)
      if (p === null) break
      const next = legalCommands(s, p).find((c) => c.type !== 'concede')
      if (!next) break
      s = apply(s, next).state
    }
    expect(viewFor(s, HUMAN).hand.includes(id), 'the card never left the hand, so nothing is proven').toBe(false)
    render(s)
    expect(previewCard()?.textContent).toContain(name)
  })

  it('empties for a new game', () => {
    const s = createGame({ seed: 1, decks: DECKS, defs: CARD_DEFS })
    render(s)
    hover(viewFor(s, HUMAN).hand[0]!)
    expect(previewCard()).not.toBeNull()
    render(createGame({ seed: 2, decks: DECKS, defs: CARD_DEFS }))
    expect(previewCard()).toBeNull()
  })
})
```

(`actingPlayer` is imported from `@fftcg/engine` with `apply`, as `details-stale.test.tsx` does.)

Run: `pnpm vitest run apps/web/test/card-preview.test.tsx`
Expected: FAIL — no `.table__preview`.

- [ ] **Step 2: Write `CardPreview.tsx`**

```tsx
import type { JSX } from 'react'
import type { CardDef } from '@fftcg/engine'
import { Card, type CardProps } from '../Card.js'
import { CardDetails } from '../CardDetails.js'

/**
 * The hover preview (rung U2c, spec sections 5 and 6, D22, D34): the card the player last pointed at or focused, drawn
 * large, with its printed text under it — in the right column, where the details rail was. A panel rather than a
 * floating card: it covers nothing (UO-A1), a keyboard player reads it by focusing a card (rung E3b), and it keeps the
 * last card when the pointer leaves, as the rail did. U7 adds the tilt and the foil to this card.
 *
 * `CardDetails` is the text block, unchanged: its `.details*` classes are what the reading tests pin.
 */
export function CardPreview({ face, def, action }: { face: CardProps | null; def: CardDef | undefined; action: string | null }): JSX.Element {
  return (
    <div className="table__preview preview">
      {face !== null && (
        <div className="preview__card">
          {/* Presentational: the details block speaks; a second announcement of the same card helps no one. */}
          <Card {...face} size="large" actionable={false} selected={false} presentational onClick={undefined} onInspect={undefined} tabIndex={undefined} />
        </div>
      )}
      <CardDetails def={def} action={action} />
    </div>
  )
}
```

Check `Card` renders `aria-hidden="true"` on its root when `presentational` (Card.tsx around line 306–330); if it does not,
wrap the card in `<div aria-hidden="true">` instead and adjust the test's `aria-hidden` assertion to that wrapper.

- [ ] **Step 3: `Board.tsx`**

Import `CardPreview`; drop the `CardDetails` import. Replace the whole `<aside className="table__rail">…</aside>` with:

```tsx
      {/* Rung U2c (D34): the preview panel where the rail was — the looked-at card, large, and its text. */}
      <CardPreview
        face={inspected === null ? null : previewFace(inspected)}
        def={inspected === null ? undefined : view.defs[inspected.code]}
        action={inspectedAction}
      />
```

and add, near `inspectedAction`:

```ts
  /**
   * The previewed card's face: live from the model while the instance is somewhere the board draws, else rebuilt from
   * the definition — the card the player was reading may have just been broken, and the preview keeps it (as the rail
   * kept its text).
   */
  const previewFace = ({ code, card }: { code: string; card: CardId }): CardProps | null => {
    const live = model.cards[card]
    if (live && live.face.code === code) return { ...live.face, actionable: false }
    const d = view.defs[code]
    if (!d) return null
    return { code: d.code, name: d.name, cost: d.cost, elements: [...d.elements], type: d.type, power: d.type === 'forward' ? d.power ?? 0 : null, text: d.text }
  }
```

`CardFace` (from `boardModel.ts`) spreads into `CardProps`; if a field name differs, map it here rather than changing the
model.

- [ ] **Step 4: CSS**

The grid:

```css
  grid-template-areas:
    'toolbar  toolbar  toolbar  toolbar'
    'opponent opponent opponent stack'
    'lead     centre   actions  preview'
    'player   player   player   preview'
    'hand     hand     hand     preview';
```

Delete the `.table__rail` block and `.rail__help`. Add after `.table__stack-title`:

```css
/* Rung U2c (D34, D35): the right column below the stack is the preview — the looked-at card, large, over its text. */
.table__preview {
  grid-area: preview;
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-left: 1px solid var(--line);
  background: linear-gradient(180deg, rgb(8 11 15 / 60%), rgb(8 11 15 / 25%));
}
.preview__card { flex: 0 0 auto; display: flex; justify-content: center; padding: var(--s3) var(--s3) var(--s2); }
/* Sized to the column: about 320px wide at 1440 and above (spec section 5), 206px at 720. */
.preview .card--large { --ch: min(40vh, 440px); }
.preview .details { flex: 1 1 auto; min-height: 0; max-height: none; overflow-y: auto; border-bottom: 0; }
```

`.stack-row`: add `flex-direction: column-reverse;` (replacing `column`) with the comment
`/* Rung U2c (D36): drawn top-first; the DOM stays bottom-first, which the tests and the reading order pin. */`.

- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run apps/web/test/card-preview.test.tsx apps/web/test/card-details.test.tsx apps/web/test/details-stale.test.tsx apps/web/test/stack-row.test.tsx apps/web/test/how-to-play.test.tsx && pnpm test:browser layout chrome how-to-play piles`
Expected: all PASS, including `layout.spec.ts`'s two U2c tests and H1-A4 (`.details__text` at 15px in `--ink`: the rule is
unchanged, only its container moved). If the U2c stress test finds the preview card cut off at 720, lower `40vh` and record
the measured values in the commit.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/ui/board/CardPreview.tsx apps/web/src/ui/Board.tsx apps/web/src/styles.css apps/web/test/card-preview.test.tsx
git commit -m "feat(web): the hover preview replaces the rail; the stack draws top-first (U2c)"
```

---

### Task 5: the AI's hand as fanned backs

**Files:**
- Create: `apps/web/src/ui/board/AiHand.tsx`
- Modify: `apps/web/src/ui/Board.tsx:605-611` (the opponent `.seat-row`)
- Modify: `apps/web/src/styles.css` (`.zone--backs`, `.backs__slot`; after the first `.zone__cards {` rule)
- Create: `apps/web/test/ai-hand.test.tsx`

**Interfaces:**
- Produces: `AiHand({ count: number })` — null for 0; otherwise `<div className="zone zone--backs" aria-hidden="true" data-ai-hand={count}>`.

- [ ] **Step 1: Write the failing test**

`apps/web/test/ai-hand.test.tsx`:

```tsx
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { createGame, viewFor } from '@fftcg/engine'
import { CARD_DEFS, DECKS } from '../src/deck.js'
import { Board } from '../src/ui/Board.js'
import { buildChoiceSet } from '../src/game/commands.js'
import { AI, HUMAN, type Choice, type GameApi } from '../src/game/types.js'

/** Rung U2c (D40): the AI's hand as fanned backs — decoration beside its Backups. The HUD's count stays the fact. */

Element.prototype.scrollIntoView = function scrollIntoView() {}
let root: Root | null = null
let host: HTMLDivElement | null = null
afterEach(() => { act(() => { root?.unmount() }); host?.remove(); root = null; host = null })

function mount(seed = 1): number {
  const s = createGame({ seed, decks: DECKS, defs: CARD_DEFS })
  const v = viewFor(s, HUMAN)
  const api: GameApi = { view: v, choices: buildChoiceSet(v, []), log: [], aiThinking: false, choose: (_c: Choice) => {}, restart: () => {} }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root!.render(createElement(Board, { game: api })) })
  return v.fields[AI].handCount
}

describe('the AI hand backs', () => {
  it('draws one back per unknown card, hidden from assistive technology, with no ids, buttons or text', () => {
    const n = mount()
    expect(n, 'the AI holds no cards, so nothing is proven').toBeGreaterThan(0)
    const zone = document.querySelector<HTMLElement>('.table__seat--opponent .zone--backs')!
    expect(zone).not.toBeNull()
    expect(zone.getAttribute('aria-hidden')).toBe('true')
    expect(zone.querySelectorAll('.card').length).toBe(n)
    expect(zone.querySelectorAll('[data-card-id], button, [role="grid"]').length).toBe(0)
    expect(zone.textContent?.trim()).toBe('')
    expect(zone.querySelector('.zone__label')).toBeNull()
    // The seat's stats still say the count, which is the accessible source.
    expect(document.querySelector('.table__seat--opponent .seat__stats')?.textContent).toContain(`Hand${n}`)
  })
})
```

If `v.fields[AI].handCount` is not the field's name, read it from `project(v).seats[AI].handCount` (import `project` from
`../src/game/presentation/boardModel.js`).

Run: `pnpm vitest run apps/web/test/ai-hand.test.tsx`
Expected: FAIL — no `.zone--backs`.

- [ ] **Step 2: Write `AiHand.tsx`**

```tsx
import type { CSSProperties, JSX } from 'react'
import { Card } from '../Card.js'

/**
 * The AI's unknown hand cards as a fan of backs (rung U2c, spec section 6, D40). Decoration: `aria-hidden`, no ids, no
 * buttons, no text. The seat's "Hand N" is the accessible count, and the cards you KNOW keep their own face-up grid
 * (rung V1-E) beside this. A hidden card has no id the view carries, so nothing here can leak one (D6).
 */
export function AiHand({ count }: { count: number }): JSX.Element | null {
  if (count <= 0) return null
  return (
    <div className="zone zone--backs" aria-hidden="true" data-ai-hand={count}>
      <div className="zone__cards zone__cards--compact">
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className="backs__slot" style={{ '--i': i, '--n': count } as CSSProperties}>
            <Card code="" name="A card in the AI's hand" cost={0} elements={[]} type="forward" power={null} faceDown presentational size="small" />
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: `Board.tsx`**

Import `AiHand` and make the opponent row:

```tsx
        <div className="seat-row">
          {/* Rung U2c (D40): the unknown cards as backs; the known ones keep their grid. */}
          <AiHand count={model.seats[AI].handCount - model.seats[AI].knownHand.length} />
          {model.seats[AI].knownHand.length > 0 && (
            <Zone label={`AI hand — ${model.seats[AI].knownHand.length} of ${model.seats[AI].handCount} known`} compact items={knownHandItems()} onLookAt={look} />
          )}
          <Zone label="AI Backups" compact square items={field(AI, 'backups')} onLookAt={look} />
        </div>
```

- [ ] **Step 4: CSS** (after the `.zone--fan` rules, which are after the first `.zone__cards {`):

```css
/* Rung U2c (D40): the AI's hand as backs — each slot shows two fifths of a small card, the last one whole, turned a
   little either side of the middle. Overflow is visible on purpose: later slots draw over earlier ones. */
.zone--backs .zone__cards { gap: 0; overflow: visible; padding-inline: var(--s2); }
.backs__slot { width: calc(clamp(56px, 7.5vh, 89px) * 0.716 * 0.4); }
.backs__slot:last-child { width: calc(clamp(56px, 7.5vh, 89px) * 0.716); }
.backs__slot .card { transform: rotate(calc((var(--i) - (var(--n) - 1) / 2) * 2.5deg)); transform-origin: 50% 130%; }
```

- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run apps/web/test/ai-hand.test.tsx apps/web/test/known-hand.test.tsx apps/web/test/pressable.test.tsx apps/web/test/card-details.test.tsx && pnpm test:browser layout`
Expected: PASS. `layout.spec.ts` at 1280×720: the opponent seat does not scroll with the backs in its row (the row's
height is the Backups' already).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/ui/board/AiHand.tsx apps/web/src/ui/Board.tsx apps/web/src/styles.css apps/web/test/ai-hand.test.tsx
git commit -m "feat(web): the AI hand as fanned backs (U2c)"
```

---

### Task 6: `Board.tsx` sheds its zone components

**Files:**
- Create: `apps/web/src/ui/board/Zone.tsx`, `apps/web/src/ui/board/Seat.tsx`
- Modify: `apps/web/src/ui/Board.tsx` (lines 42–144 move out; `PileKind` re-exported)
- Create then delete: `apps/web/test/zz-board-markup.test.tsx` (the proof; never committed)

**Interfaces:**
- Produces: `Zone` (same props as today), `Seat` (same props), `PileKind`, `PILE_LABEL`, `MAX_DAMAGE` from `board/Seat.tsx`;
  `Board.tsx` keeps `export type { PileKind }` and its `boardCardIds`, `orphanTargetIds`, `clickableChoices` exports.

- [ ] **Step 1: Pin the Board's markup before touching it**

`apps/web/test/zz-board-markup.test.tsx` (the U2a technique):

```tsx
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { actingPlayer, apply, createGame, legalCommands, viewFor, type GameState } from '@fftcg/engine'
import { CARD_DEFS, DECKS } from '../src/deck.js'
import { Board } from '../src/ui/Board.js'
import { buildChoiceSet, paymentAlternatives, preferredChoices } from '../src/game/commands.js'
import { HUMAN, type Choice, type GameApi } from '../src/game/types.js'

/** Scratch (rung U2c Task 6): every corpus position's markup, byte for byte, before and after the split. Not committed. */
const FILE = `${process.env['WS'] ?? '/tmp'}/board-markup-u2c.json`

function corpus(): GameState[] {
  const out: GameState[] = []
  for (let seed = 1; seed <= 4; seed++) {
    let s = createGame({ seed, decks: DECKS, defs: CARD_DEFS })
    for (let i = 0; i < 150 && !s.result; i++) {
      const p = actingPlayer(s)
      if (p === null) break
      if (p === HUMAN) out.push(s)
      const next = legalCommands(s, p).find((c) => c.type !== 'concede')
      if (!next) break
      s = apply(s, next).state
    }
  }
  return out
}

function markup(s: GameState): string {
  const view = viewFor(s, HUMAN)
  const legal = legalCommands(s, HUMAN)
  const api: GameApi = { view, choices: buildChoiceSet(view, preferredChoices(view, legal), paymentAlternatives(legal)), log: [{ kind: 'phase', text: 'a line' }], aiThinking: false, choose: (_c: Choice) => {}, restart: () => {}, decks: ['vol2', 'vol1'] }
  return renderToStaticMarkup(createElement(Board, { game: api, onHelp: () => {} }))
}

describe('board markup pin', () => {
  it('matches', () => {
    const got = corpus().map(markup)
    if (process.env['U2C_MARKUP'] === 'write') { writeFileSync(FILE, JSON.stringify(got)); return }
    const want = JSON.parse(readFileSync(FILE, 'utf8')) as string[]
    expect(got.length).toBe(want.length)
    got.forEach((html, i) => { expect(html, `position ${i}`).toBe(want[i]) })
  })
})
```

Run: `WS=$PWD/.superpowers/sdd/2026-09-30-rung-u2c-drawer-preview-settings U2C_MARKUP=write pnpm vitest run apps/web/test/zz-board-markup.test.tsx`
Expected: PASS; the JSON file exists and holds more than 200 entries (`node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1])).length)" <file>`).

- [ ] **Step 2: Move `Zone` to `board/Zone.tsx`**

Cut lines 42–70 of `Board.tsx` (the `Zone` function and its comment) into `apps/web/src/ui/board/Zone.tsx` with the imports it
needs (`type CardId` from `@fftcg/engine`, `type JSX` from react, `CardGrid, type GridItem` from `'../CardGrid.js'`) and
`export function Zone`. In `Board.tsx`, `import { Zone } from './board/Zone.js'`.

- [ ] **Step 3: Move `Seat`, `PileKind`, `PILE_LABEL`, `MAX_DAMAGE` to `board/Seat.tsx`**

Cut lines 35 (`MAX_DAMAGE`) and 72–144 into `apps/web/src/ui/board/Seat.tsx` with imports (`type PlayerId` from
`@fftcg/engine`, `type JSX`, `type SeatModel` from `'../../game/presentation/boardModel.js'`, `HUMAN` from
`'../../game/types.js'`). Export `Seat`, `PileKind`, `PILE_LABEL`. In `Board.tsx`:

```ts
import { PILE_LABEL, Seat, type PileKind } from './board/Seat.js'
export type { PileKind }
```

Also fix the stale comment at lines 271–272 (`openPile`): "One at a time: a sheet shows one pile, and a player is comparing
against one pile at a time anyway." (carried minor C7).

- [ ] **Step 4: Prove identical markup, then delete the proof**

Run: `WS=$PWD/.superpowers/sdd/2026-09-30-rung-u2c-drawer-preview-settings pnpm vitest run apps/web/test/zz-board-markup.test.tsx`
Expected: PASS — byte-identical at every position. Then `rm apps/web/test/zz-board-markup.test.tsx`.

- [ ] **Step 5: Typecheck, lint, the web tests**

Run: `pnpm typecheck && pnpm lint && pnpm vitest run apps/web`
Expected: PASS (bar the known game-over timeout under load; rerun it alone).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/ui/board/Zone.tsx apps/web/src/ui/board/Seat.tsx apps/web/src/ui/Board.tsx
git commit -m "refactor(web): Zone and Seat leave Board.tsx for ui/board (U2c, D33)"
```

---

### Task 7: the gallery, the spec, the gate

**Files:**
- Create: `apps/web/src/fixtures/pieceFixtures.tsx`
- Modify: `apps/web/src/fixtures/Gallery.tsx`, `apps/web/src/fixtures/fixtures.css`
- Modify: `apps/web/test/fixtures.test.tsx` (uniqueness across both lists)
- Modify: `apps/web/e2e/fixtures.spec.ts-snapshots/card-gallery-darwin.png` (re-recorded)
- Modify: `docs/superpowers/specs/2026-09-30-ui-overhaul-design.md` (`## Decisions` D34–D41; `## As built` U2c; the U2c ladder row)

- [ ] **Step 1: The piece fixtures**

`apps/web/src/fixtures/pieceFixtures.tsx`:

```tsx
import type { JSX } from 'react'
import type { CardDef } from '@fftcg/engine'
import { CARD_DEFS, DECK_CHOICES } from '../deck.js'
import { AiHand } from '../ui/board/AiHand.js'
import { CardPreview } from '../ui/board/CardPreview.js'
import { LogDrawer } from '../ui/board/LogDrawer.js'
import { Menu } from '../ui/board/Menu.js'
import { SettingsPopover } from '../ui/board/SettingsPopover.js'

/** The board pieces rung U2c added, each in a figure the gallery screenshot covers (spec section 10). */
export interface PieceFixture { name: string; render: () => JSX.Element }

const inPool = new Set([...DECK_CHOICES.vol1.main, ...DECK_CHOICES.vol2.main])
const longest = CARD_DEFS.filter((d) => inPool.has(d.code)).reduce((a, b) => (b.text.length > a.text.length ? b : a))
const face = (d: CardDef) => ({ code: d.code, name: d.name, cost: d.cost, elements: [...d.elements], type: d.type, power: d.type === 'forward' ? d.power ?? 0 : null, text: d.text })

export const PIECE_FIXTURES: readonly PieceFixture[] = [
  { name: 'preview, longest text', render: () => <div className="piece piece--column"><CardPreview face={face(longest)} def={longest} action="2 options" /></div> },
  { name: 'preview, empty', render: () => <div className="piece piece--column"><CardPreview face={null} def={undefined} action={null} /></div> },
  { name: 'AI hand, 5 backs', render: () => <AiHand count={5} /> },
  { name: 'log drawer, open', render: () => <div className="piece piece--column"><LogDrawer id="fixture-log" open log={[{ kind: 'phase', text: 'Turn 2 — the AI\'s turn' }, { kind: 'ai', text: 'the AI casts Luso' }, { kind: 'event', text: 'Luso\'s ability triggers' }, { kind: 'warning', text: 'a printed ability is not implemented' }]} silenced={false} onClose={() => {}} /></div> },
  { name: 'menu, open', render: () => <div className="piece piece--popover"><Menu defaultOpen onHelp={() => {}} concede={null} onConcede={() => {}} /></div> },
  { name: 'settings, open', render: () => <div className="piece piece--popover"><SettingsPopover defaultOpen /></div> },
]
```

`Gallery.tsx`: after the card groups, add:

```tsx
      <section className="gallery__group">
        <h2>Board pieces (U2c)</h2>
        <div className="gallery__row">
          {PIECE_FIXTURES.map((f) => (
            <figure key={f.name} className="gallery__item gallery__item--piece" data-fixture={f.name}>
              {f.render()}
              <figcaption>{f.name}</figcaption>
            </figure>
          ))}
        </div>
      </section>
```

`fixtures.css`:

```css
.gallery__item--piece { align-self: flex-start; }
.piece--column { width: 320px; height: 520px; display: grid; position: relative; }
.piece--column > .table__preview, .piece--column > .drawer { grid-area: 1 / 1; position: static; width: auto; height: auto; margin: 0; clip: auto; clip-path: none; }
.piece--popover { position: relative; min-height: 300px; width: 320px; display: flex; justify-content: flex-end; align-items: flex-start; }
```

The `.drawer` fixture renders with `drawer--open`, so the clip override is for safety only. The menu fixture's `concede`
is null (disabled) so the gallery shows the disabled state; the popover panels are `position: absolute` under the toggle.
The settings fixture reads the real store (`bootstrap()` runs in `fixtures/main.tsx`), at Instant under the suite's URL.

`fixtures.test.tsx`: extend "names every fixture uniquely" to `[...CARD_FIXTURES.map((f) => f.name), ...PIECE_FIXTURES.map((f) => f.name)]`,
and add:

```ts
  it('renders every board piece', () => {
    root = createRoot(document.body.appendChild(document.createElement('div')))
    act(() => { root!.render(createElement(Gallery)) })
    for (const f of PIECE_FIXTURES) expect(document.querySelector(`figure[data-fixture="${f.name}"]`), f.name).not.toBeNull()
    expect(document.querySelectorAll('figure[data-fixture="AI hand, 5 backs"] .card').length).toBe(5)
    expect(document.querySelector('figure[data-fixture="settings, open"] [data-settings]')).not.toBeNull()
  })
```

Run: `pnpm vitest run apps/web/test/fixtures.test.tsx`
Expected: PASS.

- [ ] **Step 2: Re-record the gallery baseline**

Run: `pnpm test:browser fixtures --update-snapshots`, then `pnpm test:browser fixtures` (the art guard runs before the
capture; it must still pass).
Expected: PASS; `git status` shows `card-gallery-darwin.png` modified. Open it and check the six new figures look right
(the preview's card whole, the drawer's four lines, both popovers open).

- [ ] **Step 3: The spec**

In `## Decisions`, append D34–D41 from this plan's header verbatim. In `## As built`, add a **U2c** entry: the branch and
plan paths; the right column's two areas and the measured preview card size at 720 and 1440; the drawer (grid item, clip
pattern closed, `tabindex` rule); the top bar's DOM order and why; the menu's confirmation; the settings store; the
ticker; the backs; the split; the e2e edits made under UO-A4 (which files, what changed); deviations (the preview is a
panel; the stack column is row 2; the 300 ms delay dropped; ≡ in the top bar rather than under the stack column) each
with its decision number; what is carried (piles as a top card with a badge; the square-slot fixture; C5, C6). Update the
U2c ladder row's "Touches" to the files touched. Keep the "no section sign plus a number" rule.

- [ ] **Step 4: Gate**

Run: `uptime` (wait while the 1-minute load is above 10), then
`pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm test && pnpm test:browser`
Expected: green, bar `game-over.test.tsx` under load (rerun alone: `pnpm vitest run apps/web/test/game-over.test.tsx`).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/fixtures/pieceFixtures.tsx apps/web/src/fixtures/Gallery.tsx apps/web/src/fixtures/fixtures.css apps/web/test/fixtures.test.tsx apps/web/e2e/fixtures.spec.ts-snapshots/card-gallery-darwin.png docs/superpowers/specs/2026-09-30-ui-overhaul-design.md
git commit -m "docs(web): the U2c gallery pieces, D34–D41 and U2c as built"
```

---

## Self-review

- **Spec coverage.** Section 6's top bar (menu with Concede and How to play, settings): Tasks 1–2. The log drawer with
  the clip pattern and the ticker: Task 3. The hover preview replacing the rail, the stack column's top-first order:
  Task 4. The AI hand as fanned backs: Task 5. `Board.tsx` split: Task 6. Section 8's four settings: Task 2 (Sound is
  U8). Section 10's allowed e2e edits: Tasks 1 and 3 name each one. Carried from U2b: the short rail (gone), C7 (Task 6);
  C5, C6, piles-as-top-card and the square-slot fixture stay carried (not assigned to U2c's row).
- **Not covered, on purpose:** the pointer-tracked tilt and foil (U7); the skip button (U3); the Deck as a pile (its cards
  are hidden; the HUD count stays, as the U2b review ruled).
- **Types.** `usePopover`'s `panelRef` is `RefObject<HTMLElement | null>` and both panels assign it through a callback ref
  (`ref={(el) => { panelRef.current = el }}`) because a `div` ref is `HTMLDivElement`. `Flags` moves to `settingsStore.ts`
  and is re-exported from `bootstrap.ts`, so `bootstrap.test.ts`'s imports hold. `CardPreview`'s `face` is `CardProps`;
  `previewFace` builds one from `CardFace` or a `CardDef`.
- **Review Focus** 1 → Task 1; 2 → Task 2; 3 → Task 0 and 3; 4 → Task 4; 5 → Task 0 and 4.
