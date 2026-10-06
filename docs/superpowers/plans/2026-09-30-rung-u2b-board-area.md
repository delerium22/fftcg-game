# Rung U2b — the board area — Implementation Plan (revised after plan review)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the board fits the screen from 1280×720 to 2560×1440 with no scroll and nothing covering a card (UO-A1):
piles open a sheet instead of growing rows, the LB decks leave the board's rows, the centre line carries the phase
tracker, the prompt and the actions, the stack gets its own column, the seat HUD moves to the side, the hand fans, and
dulling never reflows a row.

**Architecture:** relocation by CSS grid, not by rewriting markup. `.table` gets named areas; the prompt strip's root
becomes `display: contents`, so its children are placed into different areas while DOM order — the reading and tab order
the accessibility rungs fixed — stays as it is. Every class and accessible name the tests read survives. New markup: a
`ZoneSheet` dialog (the piles), a phase tracker inside a `.prompt__lead` wrapper, a stack panel, and a `cellStyle` hook
on grid cells for the hand fan.

**Tech Stack:** React 19, CSS grid, Vitest (jsdom), Playwright.

**Spec:** `docs/superpowers/specs/2026-09-30-ui-overhaul-design.md` — section 6, section 9, UO-A1, D28, D29, D32.
**Plan review:** `docs/superpowers/plans/2026-09-30-rung-u2b-board-area.review.md` (Fable; measured the vertical budget in
Chromium). **Ruling D33 (recorded in Task 5):** piles, the `ZoneSheet` and the LB fan/pile join the layout here (without
them no row model fits 1280×720); the actions stay in the centre line rather than a bottom-right dock (a dock sets the
hand row's height, and the payment tray needs the width); U2c keeps the rail's replacement (log drawer, hover preview —
and the stack column becomes full height when the rail goes), the top-bar menu (Concede, How to play), the settings
popover, the AI hand as fanned backs, and splitting `Board.tsx` into zone components.

## The vertical budget at 1280×720 (measured in the review, then planned)

| Row | Today | Plan |
|---|---|---|
| Toolbar (V1-C picker) | 47 | 36 (tighter padding) |
| Centre line (tracker + pill + prompt + actions) | strip ~50 | ~44 (one line; grows only with the payment tray) |
| Hand row (fixed track) | 149 | 136 (112px cards + 24px headroom; the fan lifts into the headroom) |
| Each seat (the two `1fr` rows) | 224 available, 281 needed | 252 available; need 16 padding + 66 Backups + 8 gap + 94 Forwards = **184** |

What buys the room: zone labels become visually hidden (−22px per row; the grids keep their `aria-label`, the tests read
the label text from the DOM); the seat HUD becomes a side column (−41px per seat); the LB rows and the pile rows leave the
seats; the AI's known-hand row sits beside its Backups instead of above them; the orphan row and your LB deck sit beside
the hand instead of above it.

## Global Constraints

- DOM order is the reading and tab order and must not change for existing content; place with `grid-area`. The only
  markup moves are named in a task (your LB deck into `.table__hand`; the AI's LB deck into a pile).
- Keep every class the tests read: `.hand`, `.prompt__text`, `.prompt__actions`, `.prompt__phase`, `.table__seat`,
  `.table__seat--opponent|player`, `.table__hand`, `.table__prompt`, `.table__rail`, `.table__toolbar`, `.seat`,
  `.damage-track`, `.zone__cards`, `.zone__label` (text stays in the DOM), `.rail__help`, `.stat__open`, `[data-stack-row]`;
  the pile openers' names and `aria-expanded`; the opened pile's grid label and `zone__cards` class.
- `role="status"` (`.prompt__text`) stays one stable element, never keyed or conditionally rendered.
- Animate only transform and opacity. Dull = `rotate(90deg)` in a square slot (Backups) or `rotate(90deg) scale(0.716)`
  in the portrait slot (Forwards); the large sheet card shows a dull card upright (it is for reading).
- `.zone__cards`'s own rule keeps `overflow-x: auto` and `justify-content: safe center` (pinned by `card-details.test.tsx`,
  which slices the stylesheet from the FIRST `.zone__cards {` — new rules that contain that text go after it).
- No section sign followed by a number in code, tests or specs; `git add` named paths; commit trailers as before.
- Verify: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:browser`.

## Review Focus

1. **A pile that empties while its sheet is open**: the sheet closes; the opener is not left `aria-expanded="true"`; it
   does not reopen when the pile fills again (existing `card-details.test.tsx` pile tests, unchanged).
2. **A card pressed inside a pile sheet**: its card sheet opens on top; Escape closes only it; focus returns to the pile
   card that opened it (Task 1's `piles.spec`, with an `activeElement` assertion).
3. **A mid-game board at three sizes**, with the orphan row or the AI's known hand present or not: nothing scrolls (page,
   seats, hand), both Forward rows on screen, nothing over a card (Task 0's `layout.spec`).
4. **Keyboard traversal** (existing `focus.test.tsx`, `how-to-play.spec.ts`, `card-details.test.tsx` DOM-order test).
5. **Dulling moves no other card** (Task 0's gallery check; the large sheet card stays upright).

---

### Task 0: the acceptance test (RED)

**Files:** Create `apps/web/e2e/layout.spec.ts`.

- [ ] **Step 1: Write it**

```ts
import { expect, test, type Page } from '@playwright/test'
import { playToTheEnd } from './drive'

/**
 * UI overhaul UO-A1 — the board fits the screen: no page, seat or hand scroll, both Forward rows fully on screen, and the
 * prompt text and the actions over no card. A real mid-game position (turn 3 of seed 1), at three desktop sizes.
 */
type Box = { x: number; y: number; width: number; height: number }
const overlaps = (a: Box, b: Box): boolean => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

async function turn3(page: Page): Promise<void> {
  await page.goto('/?seed=1&decks=vol2,vol2&art=off')
  await playToTheEnd(page, 90_000, async () => /Turn 3\b/.test((await page.locator('.prompt__phase').textContent().catch(() => '')) ?? ''))
}

for (const [w, h] of [[1280, 720], [1440, 900], [1920, 1080]] as const) {
  test(`the board fits ${w}×${h} with nothing scrolled or covered (UO-A1)`, async ({ page }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width: w, height: h })
    await turn3(page)
    const fit = await page.evaluate(() => ({
      pageScrollsY: document.documentElement.scrollHeight > innerHeight + 1,
      pageScrollsX: document.documentElement.scrollWidth > innerWidth + 1,
      seatScrolls: [...document.querySelectorAll<HTMLElement>('.table__seat')].some((s) => s.scrollHeight > s.clientHeight + 1),
      handScrollsY: [...document.querySelectorAll<HTMLElement>('.hand')].some((s) => s.scrollHeight > s.clientHeight + 1),
    }))
    expect(fit).toEqual({ pageScrollsY: false, pageScrollsX: false, seatScrolls: false, handScrollsY: false })
    for (const label of ['AI Forwards', 'Your Forwards']) {
      const row = page.locator('.zone').filter({ has: page.locator('.zone__label', { hasText: label }) })
      const box = await row.boundingBox()
      expect(box, `${label} is not rendered`).not.toBeNull()
      expect(box!.y, `${label} starts above the viewport`).toBeGreaterThanOrEqual(0)
      expect(box!.y + box!.height, `${label} ends below the viewport`).toBeLessThanOrEqual(h)
    }
    const cards = await page.locator('.card').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON() as Box))
    for (const sel of ['.prompt__text', '.prompt__actions']) {
      const box = await page.locator(sel).boundingBox()
      if (!box) continue
      expect(cards.filter((c) => overlaps(box, c)), `${sel} covers a card`).toEqual([])
    }
  })
}

test('dulling a card moves no other card (D29)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/fixtures.html?art=off&motion=instant')
  const active = await page.locator('figure[data-fixture="forward, field"] .card').boundingBox()
  const dull = await page.locator('figure[data-fixture="forward, dull"] .card').boundingBox()
  expect(dull!.width).toBeCloseTo(active!.width, 0)
  expect(dull!.height).toBeCloseTo(active!.height, 0)
})
```

- [ ] **Step 2: Run it** — `pnpm test:browser layout` → FAIL (at 1280×720 seats scroll and the AI Forwards row ends
  below the viewport; the dull card's box is wider than its active twin).
- [ ] **Step 3: Commit** — `git add apps/web/e2e/layout.spec.ts && git commit -m "test(web): the board fits the screen — the U2b acceptance test (red)"`

---

### Task 1: piles open a sheet; the LB decks leave the rows; focus returns from a sheet

**Files:** Create `apps/web/src/ui/ZoneSheet.tsx`, `apps/web/src/ui/useReturnFocus.ts`; modify `apps/web/src/ui/Board.tsx`,
`apps/web/src/ui/CardSheet.tsx`, `apps/web/src/styles.css`. Test: `apps/web/e2e/piles.spec.ts`; the existing pile tests
pass unchanged.

**Interfaces:** `ZoneSheet({ title, onClose, children })` — native modal `<dialog data-zone-sheet>`. `useReturnFocus()` —
records `document.activeElement` on mount and, on unmount, refocuses it if it is still connected. `PileKind` gains
`'lbDeck'` (the AI's LB deck as a pile).

- [ ] **Step 1: Write the failing browser test** — `apps/web/e2e/piles.spec.ts`

```ts
import { expect, test } from '@playwright/test'
import { playToTheEnd } from './drive'

/** UI overhaul U2b — a pile opens a modal sheet over the board instead of a row inside it (spec section 6). */
test('a pile opens as a sheet; a card inside opens its own sheet on top; Escape backs out one at a time', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/?seed=1&decks=vol2,vol2&art=off')
  const opener = page.locator('button.stat__open[aria-label*="Break Zone"]').first()
  // Stop only with no card sheet open, or the opener is behind a modal.
  await playToTheEnd(page, 90_000, async () => (await opener.count()) > 0 && (await page.locator('dialog[data-card-sheet]').count()) === 0)
  await opener.click()
  const sheet = page.locator('dialog[data-zone-sheet]')
  await expect(sheet).toBeVisible()
  await expect(opener).toHaveAttribute('aria-expanded', 'true')
  await expect(sheet.locator('[role="grid"][aria-label*="Break Zone"]')).toBeVisible()
  await expect(page.locator('.table__seat .zone__label', { hasText: 'Break Zone' })).toHaveCount(0)
  const pileCard = sheet.locator('[role="gridcell"] button').first()
  await pileCard.click()
  await expect(page.locator('dialog[data-card-sheet]')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('dialog[data-card-sheet]')).toHaveCount(0)
  await expect(sheet).toBeVisible()
  await expect(pileCard, 'focus did not come back to the pile card').toBeFocused()
  await page.keyboard.press('Escape')
  await expect(sheet).toHaveCount(0)
  await expect(opener).toHaveAttribute('aria-expanded', 'false')
  await expect(opener, 'focus did not come back to the pile opener').toBeFocused()
})

test("the AI's LB deck is a pile; yours sits beside your hand", async ({ page }) => {
  await page.goto('/?seed=1&decks=vol2,vol2&art=off')
  await expect(page.locator('.table__hand [role="grid"][aria-label="Your LB deck"]')).toBeVisible()
  await expect(page.locator('.table__seat [role="grid"][aria-label="AI LB deck"]')).toHaveCount(0)
  await page.locator('button.stat__open[aria-label^="the AI\'s LB deck"]').click()
  await expect(page.locator('dialog[data-zone-sheet] [role="grid"][aria-label="AI LB deck"]')).toBeVisible()
})
```

- [ ] **Step 2: Run it** — `pnpm test:browser piles` → FAIL (no `dialog[data-zone-sheet]`; the LB grids sit in the seats).

- [ ] **Step 3: Implement**

`apps/web/src/ui/useReturnFocus.ts`:

```ts
import { useEffect } from 'react'

/**
 * Put focus back where it was when a modal opened, once it closes (U2b plan review). A sheet is removed from the DOM on
 * close, which drops focus to `document.body`; with a card sheet opened from a pile sheet, that stranded a keyboard
 * player inside an open dialog with nothing focused. Only if the element is still in the document.
 */
export function useReturnFocus(): void {
  useEffect(() => {
    const before = document.activeElement
    return () => { if (before instanceof HTMLElement && before.isConnected) before.focus() }
  }, [])
}
```

Call `useReturnFocus()` at the top of `CardSheet` and `ZoneSheet`.

`apps/web/src/ui/ZoneSheet.tsx`:

```tsx
import { useEffect, useId, useRef, type JSX, type ReactNode } from 'react'
import { useReturnFocus } from './useReturnFocus.js'

/**
 * A public pile, opened (UI overhaul spec section 6): the Break Zone, the Damage Zone, Removed from game, or the AI's
 * LB deck, shown over the board instead of as a row inside it — a Break Zone grows all game and a row of it pushed the
 * Forwards off the screen. The same native modal `<dialog>` contract as the card sheet: `showModal()` so the board
 * behind is inert, focus on the heading, Escape closes, focus returns to the opener.
 */
export function ZoneSheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }): JSX.Element {
  useReturnFocus()
  const ref = useRef<HTMLDialogElement | null>(null)
  const titleId = useId()
  useEffect(() => {
    const el = ref.current
    if (!el) return
    // Absent in this jsdom — guard rather than throw; modality is proved in a real browser.
    if (typeof el.showModal === 'function' && !el.open) el.showModal()
    el.querySelector<HTMLHeadingElement>('[data-dialog-title]')?.focus()
  }, [])
  return (
    <dialog
      ref={ref} className="sheet zone-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} data-zone-sheet
      onCancel={(e) => { e.preventDefault(); onClose() }}
    >
      <div className="zone-sheet__body">
        <h2 id={titleId} className="sheet__name" data-dialog-title tabIndex={-1}>{title}</h2>
        {children}
        <div className="sheet__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </dialog>
  )
}
```

`Board.tsx`:
1. `export type PileKind = 'breakZone' | 'damageZone' | 'removedFromGame' | 'lbDeck'`; `PILE_LABEL.lbDeck = 'LB deck'`.
2. `pileItems(p, kind)`: `kind === 'lbDeck' ? lbItems(p) : …as today`.
3. `Seat`: the pile openers get `aria-haspopup="dialog"`; after Removed, for the AI only and when `seat.lbDeck.length > 0`,
   `pile('lbDeck', seat.lbDeck.length, …)` with the visible label `LB`.
4. Replace `pileRow` and its two calls with one sheet after the card sheet:
   `{openPile !== null && pileItems(openPile.p, openPile.kind).length > 0 && (<ZoneSheet title={pileTitle(openPile)} onClose={() => setOpenPile(null)}><Zone label={pileTitle(openPile)} compact items={pileItems(openPile.p, openPile.kind)} onLookAt={look} /></ZoneSheet>)}`,
   where `pileTitle` returns `AI LB deck` for the AI's LB pile (its old grid label) and `${Your|The AI's} ${PILE_LABEL[kind]}`
   otherwise. The `openPile` reset effect reads `model.seats[p][kind]`.
5. Remove the AI LB `Zone` from the AI seat. Move `Your LB deck` out of the player seat into `.table__hand`, between the
   orphan row and the hand grid (DOM order in the hand section: orphans, your LB deck, your hand).
6. `boardCardIds`: include only the HUMAN's LB deck (the AI's is no longer drawn on the board).
7. Carried from U2a: the AI hand row's label and guard read `model.seats[AI].knownHand.length` / `.handCount`.

`styles.css` — append AFTER the `.zone__cards {` rule (the pile test slices from its first occurrence):

```css
/* A pile's sheet (spec section 6): the card sheet's surface, wide enough for a row of small cards that wraps. */
.zone-sheet { width: min(92vw, 960px); }
.zone-sheet__body { padding: var(--s5); display: flex; flex-direction: column; gap: var(--s4); }
.zone-sheet .zone__cards { justify-content: flex-start; flex-wrap: wrap; overflow-x: visible; max-height: 60vh; overflow-y: auto; margin-top: 0; }
```

- [ ] **Step 4: Run the tests** — `pnpm test:browser piles` → PASS (2). `pnpm vitest run apps/web/test/card-details.test.tsx apps/web/test/limit-break.test.tsx apps/web/test/focus.test.tsx apps/web/test/known-hand.test.tsx` → PASS unchanged.
- [ ] **Step 5: Commit** — `git add apps/web/src/ui/ZoneSheet.tsx apps/web/src/ui/useReturnFocus.ts apps/web/src/ui/CardSheet.tsx apps/web/src/ui/Board.tsx apps/web/src/styles.css apps/web/e2e/piles.spec.ts && git commit -m "feat(web): piles open a sheet; the LB decks leave the rows; focus returns from sheets (U2b)"`

---

### Task 2: the grid, the centre line and the stack column

**Files:** Modify `apps/web/src/styles.css`, `apps/web/src/ui/PromptStrip.tsx`, `apps/web/src/ui/Board.tsx`. Test:
`apps/web/test/phase-track.test.tsx`.

- [ ] **Step 1: Write the failing unit test** — `apps/web/test/phase-track.test.tsx`

```tsx
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { PhaseTrack } from '../src/ui/PromptStrip'

describe('the phase tracker (spec section 6)', () => {
  it('lists the six phases and marks the current one, hidden from assistive technology', () => {
    const html = renderToStaticMarkup(createElement(PhaseTrack, { phase: 'attack' }))
    for (const label of ['Active', 'Draw', 'Main 1', 'Attack', 'Main 2', 'End']) expect(html).toContain(`>${label}<`)
    expect(html).toContain('aria-hidden="true"')
    expect(html.match(/phase-track__step--now/g)).toHaveLength(1)
    expect(html).toMatch(/phase-track__step--now[^>]*>Attack</)
  })

  it('marks nothing during setup', () => {
    expect(renderToStaticMarkup(createElement(PhaseTrack, { phase: 'setup' }))).not.toContain('phase-track__step--now')
  })
})
```

- [ ] **Step 2: Run it** → FAIL (`PhaseTrack` not exported).

- [ ] **Step 3: Implement**

`PromptStrip.tsx`: export `PhaseTrack` (the six phases, current one marked, `aria-hidden`), and wrap the existing
`.prompt__phase` span with it in one element — `<div className="prompt__lead"><PhaseTrack phase={view.phase} />{/* the existing .prompt__phase span */}</div>` —
as the first child of `.prompt` (the `.prompt__phase` span stays first in reading order; the tracker is hidden from
assistive technology).

```tsx
const TRACK: { phase: string; label: string }[] = [
  { phase: 'active', label: 'Active' }, { phase: 'draw', label: 'Draw' }, { phase: 'main1', label: 'Main 1' },
  { phase: 'attack', label: 'Attack' }, { phase: 'main2', label: 'Main 2' }, { phase: 'end', label: 'End' },
]

/** The turn's six phases with the current one lit (spec section 6). Visual only: `.prompt__phase` already says it. */
export function PhaseTrack({ phase }: { phase: string }): JSX.Element {
  return (
    <ol className="phase-track" aria-hidden="true">
      {TRACK.map((t) => (
        <li key={t.phase} className={t.phase === phase ? 'phase-track__step phase-track__step--now' : 'phase-track__step'}>{t.label}</li>
      ))}
    </ol>
  )
}
```

`Board.tsx`: add `<div className="table__stack" aria-hidden="true"><span className="table__stack-title">Stack</span></div>`
as the first child of `.table`.

`styles.css`: replace the `.table` block and the area rules with:

```css
/* The board (UI overhaul spec section 6): named areas, so pieces are PLACED rather than moved — DOM order is the reading
 * and tab order the accessibility rungs fixed. Columns: the lead (tracker + phase pill), the board, the actions (as wide as
 * its buttons, or the payment tray), the rail. The hand row is a fixed track: the fan lifts into its headroom. */
.table {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto var(--rail-w);
  grid-template-rows: auto minmax(0, 1fr) auto minmax(0, 1fr) calc(clamp(112px, 16vh, 179px) + 24px);
  grid-template-areas:
    'toolbar  toolbar  toolbar  toolbar'
    'opponent opponent opponent stack'
    'lead     centre   actions  rail'
    'player   player   player   rail'
    'hand     hand     hand     rail';
  height: 100%;
  gap: 0;
  background:
    radial-gradient(60% 50% at 50% 50%, color-mix(in oklab, var(--stage-3) 55%, transparent), transparent 75%),
    linear-gradient(180deg, var(--stage-1), var(--stage-0));
}

/* The centre line: a band across the board's middle, drawn by the grid container itself (a pseudo-element is a grid item). */
.table::before {
  content: '';
  grid-row: 3;
  grid-column: 1 / 4;
  border-block: 1px solid color-mix(in oklab, var(--accent-act) 30%, transparent);
  background: linear-gradient(90deg, transparent, color-mix(in oklab, var(--accent-act) 9%, transparent), transparent);
}

.table__prompt.prompt { display: contents; }
.prompt__lead { grid-area: lead; display: flex; flex-direction: column; justify-content: center; gap: 2px; padding: var(--s1) var(--s4); z-index: 1; }
.prompt__text { grid-area: centre; align-self: center; justify-self: center; z-index: 1; max-width: 70ch; padding: var(--s2) var(--s4); font-family: var(--font-body); font-weight: 600; font-size: 15px; text-align: center; }
.prompt__actions { grid-area: actions; align-self: center; display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--s2); padding: var(--s2) var(--s4); z-index: 1; }
.stack-row { grid-area: stack; z-index: 1; align-self: start; margin: calc(var(--s3) + 18px) var(--s3) var(--s3); max-height: calc(100% - 48px); overflow-y: auto; }
.table__stack { grid-area: stack; display: flex; flex-direction: column; padding: var(--s3); border-left: 1px solid var(--line); background: color-mix(in oklab, var(--stage-0) 80%, transparent); }
.table__stack-title { font-family: var(--font-display); font-weight: 800; font-size: 11px; letter-spacing: 0.14em; color: var(--ink-3); }
.table__seat--opponent { grid-area: opponent; }
.table__seat--player { grid-area: player; }
.table__hand { grid-area: hand; }
.table__rail { grid-area: rail; }
.table__toolbar { grid-area: toolbar; padding-block: var(--s1); }

.phase-track { display: flex; gap: 2px; margin: 0; padding: 0; list-style: none; }
.phase-track__step { padding: 1px 7px; border-radius: 999px; font-family: var(--font-display); font-weight: 600; font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-3); }
.phase-track__step--now { background: var(--accent-act); color: var(--stage-0); font-weight: 800; }
.prompt__actions .btn--primary {
  font-family: var(--font-display); font-weight: 900; font-style: italic; letter-spacing: 0.06em; color: #1a1200;
  background: linear-gradient(180deg, #ffe08a, var(--accent-gold) 55%, #d99a12); box-shadow: 0 0 0 2px rgb(255 255 255 / 30%) inset, 0 0 18px var(--accent-gold-glow);
}
```

Delete the old `.prompt { … }` box rules (the root has no box). The payment and selection trays render inside
`.prompt__actions` and stay there: the `actions` column is `auto`, so it widens for a tray and the centre row grows only
while a tray is open (UO-A1 is measured with no tray open).

- [ ] **Step 4: Run the tests** — `pnpm vitest run apps/web/test/phase-track.test.tsx` → PASS; `pnpm vitest run --project @fftcg/web` → only the known load timeout; `pnpm test:browser` → every older spec passes.
- [ ] **Step 5: Commit** — `git add apps/web/src/styles.css apps/web/src/ui/PromptStrip.tsx apps/web/src/ui/Board.tsx apps/web/test/phase-track.test.tsx && git commit -m "feat(web): the board grid, the centre line and the stack column (U2b)"`

---

### Task 3: the seats — side HUD, hidden labels, square Backups, dull without reflow, the hand fan

**Files:** Modify `apps/web/src/styles.css`, `apps/web/src/ui/Card.css`, `apps/web/src/ui/CardGrid.tsx`,
`apps/web/src/ui/Board.tsx`. Test: `layout.spec.ts` goes green; `apps/web/test/card-grid-style.test.tsx`.

**Interfaces:** `GridItem` gains `readonly cellStyle?: CSSProperties`, applied to the `role="gridcell"` element.

- [ ] **Step 1: Write the failing unit test** — `apps/web/test/card-grid-style.test.tsx` (read `CardGrid.tsx`'s real
  props first and match them; record any difference in the ledger):

```tsx
import { act, createElement, type CSSProperties } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { CardGrid } from '../src/ui/CardGrid'

describe('CardGrid cell style (the hand fan, U2b)', () => {
  it("puts an item's cellStyle on its gridcell", () => {
    const host = document.body.appendChild(document.createElement('div'))
    const root = createRoot(host)
    act(() => root.render(createElement(CardGrid, {
      label: 'Test', onLookAt: () => {},
      items: [{ id: 1, selectable: false, cellName: 'one', cellStyle: { '--i': 0, '--n': 1 } as CSSProperties, render: () => createElement('span') }],
    })))
    const cell = host.querySelector('[role="gridcell"]') as HTMLElement
    expect(cell.style.getPropertyValue('--i')).toBe('0')
    expect(cell.style.getPropertyValue('--n')).toBe('1')
    act(() => root.unmount())
  })
})
```

- [ ] **Step 2: Run it** → FAIL.

- [ ] **Step 3: Implement**

`CardGrid.tsx`: `cellStyle` on `GridItem`, spread as `style` on the gridcell. `Board.tsx`: the hand's i-th item gets
`cellStyle: { '--i': i, '--n': model.hand.length }`. `Zone` gets a `square?: boolean` prop adding `zone--square` to
`.zone`; both Backup rows pass it. The AI seat renders its known-hand row and its Backups row inside one
`<div className="seat-row">` (known hand first, as today's DOM order), so they share a line.

`styles.css`:

```css
/* A seat (spec section 6): the HUD is a side column, the rows are the rest. The AI's rows read top-down, yours bottom-up,
 * so both Forward rows meet across the centre line. */
.table__seat { display: grid; grid-template-columns: auto minmax(0, 1fr); column-gap: var(--s4); align-items: center; padding: var(--s2) var(--s5); overflow: hidden; }
.table__seat > .seat { grid-column: 1; grid-row: 1 / span 3; flex-direction: column; align-items: stretch; margin: 0; }
.table__seat > .zone, .table__seat > .seat-row { grid-column: 2; }
.seat-row { display: flex; gap: var(--s5); align-items: flex-end; justify-content: center; }
/* The rows speak for themselves on the board; their labels stay in the DOM for assistive technology and the tests. */
.zone__label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
/* Empty rows keep exactly a filled row's height (the review measured empty rows 28px and 6px short). */
.zone__cards { min-height: calc(clamp(84px, 11.5vh, 134px) + 4px + 3px); }
.zone__cards--compact { min-height: calc(clamp(56px, 7.5vh, 89px) + 4px + 3px); }

/* The hand row: the orphan row and your LB deck beside the hand, not above it. */
.table__hand { display: flex; align-items: flex-end; justify-content: center; gap: var(--s5); }

/* The hand fan (spec section 6): cards overlap and arc about the middle — the CENTRE lifts into the row's headroom
 * (the ends stay put, so nothing leaves the row's box and nothing scrolls). The hovered or focused card rises further. */
.hand [role='gridcell'] {
  --o: calc(var(--i, 0) - (var(--n, 1) - 1) / 2);
  --m: calc((var(--n, 1) - 1) / 2);
  margin-inline-start: calc(clamp(112px, 16vh, 179px) * 0.716 * -0.2);
  transform: translateY(calc((var(--o) * var(--o) - var(--m) * var(--m)) * 2px)) rotate(calc(var(--o) * 2.5deg));
  transform-origin: 50% 120%;
  transition: transform var(--dur-fast) var(--ease-out);
}
.hand [role='gridcell']:first-child { margin-inline-start: 0; }
.hand [role='gridcell']:hover, .hand [role='gridcell']:focus-within { z-index: 5; transform: translateY(-10px); }

/* Damage as seven crystals, cracked red when filled. */
.damage-pip { width: 11px; height: 15px; border: 0; border-radius: 0; clip-path: polygon(50% 0, 100% 35%, 50% 100%, 0 35%); background: linear-gradient(160deg, rgb(255 255 255 / 18%), rgb(255 255 255 / 6%)); }
.damage-pip.is-filled { background: linear-gradient(115deg, #ffd1da 0 12%, var(--danger-hot) 12% 46%, #fff 46% 50%, #a3122e 50%); }

/* Backups sit in square slots, so rotating to dull never pushes a neighbour (D29). */
.zone--square .card { width: var(--ch); }
.zone--square .card:not(.is-dull) .card__face { inset: auto; top: 0; left: 50%; width: var(--cw); height: var(--ch); transform: translateX(-50%); }
```

(Replace the existing `.table__seat`, `.table__seat--player`, `.table__seat > .seat`, `.table__hand`, `.zone__label`
display rules, `.damage-pip` rules and the two `min-height` lines; keep `.zone__cards`'s other properties.)

`Card.css` — replace the `.card.is-dull` and `.card.is-dull .card__face` rules:

```css
/* Dull (CR: a dull card is turned sideways) WITHOUT reflow (D29): a Forward keeps its portrait slot and its face turns and
 * shrinks to fit the slot's width (0.716 is the card's aspect ratio); a Backup's slot is square so it turns at full size;
 * the sheet's large card stays upright, because it is there to be read. */
.card.is-dull:not(.card--large) .card__face { inset: auto; top: 50%; left: 50%; width: var(--cw); height: var(--ch); transform: translate(-50%, -50%) rotate(90deg) scale(0.716); }
.zone--square .card.is-dull .card__face { transform: translate(-50%, -50%) rotate(90deg); }
```

Then tune only the seat padding, the HUD's gap and the toolbar padding until `layout.spec.ts` passes at all three sizes;
record the final values in the ledger.

- [ ] **Step 4: Run the tests** — `pnpm vitest run apps/web/test/card-grid-style.test.tsx` → PASS; `pnpm test:browser layout` → PASS (4); `pnpm test:browser` → all pass; re-baseline the gallery (`--update-snapshots=all`) and look at the dull fixtures.
- [ ] **Step 5: Commit** — `git add apps/web/src/styles.css apps/web/src/ui/Card.css apps/web/src/ui/CardGrid.tsx apps/web/src/ui/Board.tsx apps/web/test/card-grid-style.test.tsx apps/web/e2e/fixtures.spec.ts-snapshots && git commit -m "feat(web): side HUD, square Backups, dull without reflow, the hand fan (U2b)"`

---

### Task 4: carried U2a minors

- [ ] `apps/web/test/board-model.test.ts`: assert `m.cards[id].side` and `.index` for every listed id; add a hand-built
  case with the same ability twice on the stack (keys `a:…` and `a:…#1`); tally `removedFromGame` only if the corpus
  reaches it, else a hand-built removed card.
- [ ] `apps/web/test/card-details.test.tsx`: fix the stale comment naming the deleted `fieldCardProps`.
- [ ] Run both files → PASS; commit.

---

### Task 5: D33, as built, gate

- [ ] Spec: add **D33** (from this plan's header) to `## Decisions`; update the U2b and U2c ladder rows; add a **U2b**
  entry to `## As built` with the final layout values from the ledger.
- [ ] Gate: `pnpm typecheck && pnpm lint && pnpm test && pnpm test:browser` → green bar the known load timeout. Commit.
