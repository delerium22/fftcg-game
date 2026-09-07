# Rung G6 — the only button is "Concede" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** At a decision whose every answer is on a card, the prompt strip offers no buttons instead of offering Concede alone.

**Architecture:** `PromptStrip` already computes the state (`cardOnly`) and uses it only to reword the prompt. Split out the narrower `concedeOnly` predicate (the `chooseTargets` case keeps its "no targets" button, so `cardOnly` is too wide) and gate the button list on it. A new corpus test measures the before-figure from the choices, asserts the rendered strip never shows Concede alone (A1), never hides a non-concede button (A2), and that every card the prompt points at is pressable at exactly those decisions (A4). A3 is covered by the untouched `focus.test.tsx`; A5 is a comment.

**Tech Stack:** React 19, vitest + jsdom (`apps/web`), `@fftcg/engine` + `GreedyAgent` for the corpus.

**Spec:** `docs/superpowers/specs/2026-08-31-rung-g6-the-only-button-is-concede.md`

**Review:** the user chose to SKIP the Codex plan review for this rung (2026-09-08). Record that in the spec's status line.

## Global Constraints

- Corpus method must be the spec's: 40 seeds, `GreedyAgent({ seed, decks: DECKS, depth: 1 })` both seats, sampled at every `actingPlayer === HUMAN` state, choice set built as `buildChoiceSet(view, preferredChoices(view, legal), paymentAlternatives(legal))`. Step cap 600 per seed (the repo's standard; the spec does not name one — record the resulting corpus size).
- "On arrival" means `Board`'s strip with nothing selected and no payment open: `choices.loose`, Concede sorted last.
- Counting nouns: the figures are DECISIONS (human decision points), not verb-instances or positions with cards.
- Every acceptance criterion must be able to FAIL. A1's test must fail on the current build before Task 2. After Task 2, mutate the fix (widen the predicate to `cardOnly`) and confirm A2 catches it. Record both results in the test's comments, as `pressable.test.tsx` does.
- The `MVP0-SIMPLIFICATION` marker must name the rule deviated from (CR §2.1) so `grep MVP0-SIMPLIFICATION` finds it.
- No change to Concede's ordering or arming (A3). `focus.test.tsx` must pass unchanged.
- Never regenerate `packages/ai/test/fixtures/frozen-scores.json`.

---

### Task 1: The corpus test — A1, A2, A4 (fails on the current build)

**Files:**
- Create: `apps/web/test/concede-only.test.tsx`

**Interfaces:**
- Consumes: `PromptStrip` props `{ view, choices, shown, aiThinking, onChoose }` (`apps/web/src/ui/PromptStrip.tsx`), `Board` prop `{ game: GameApi }`, `buildChoiceSet`/`preferredChoices`/`paymentAlternatives` from `apps/web/src/game/commands.ts`.
- Produces: nothing other tasks import. Task 2 makes it pass.

- [ ] **Step 1: Write the test file**

```tsx
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import {
  actingPlayer, apply, createGame, legalCommands, viewFor,
  type GameState,
} from '@fftcg/engine'
import { GreedyAgent } from '@fftcg/ai'
import { CARD_DEFS, DECKS } from '../src/deck.js'
import { Board } from '../src/ui/Board.js'
import { PromptStrip } from '../src/ui/PromptStrip.js'
import { buildChoiceSet, paymentAlternatives, preferredChoices } from '../src/game/commands.js'
import { HUMAN, type Choice, type ChoiceSet, type GameApi } from '../src/game/types.js'

/**
 * Rung G6 — for one decision in seven, the only button is "Concede".
 *
 * METHOD, so the counts are reproducible (the spec's corpus):
 *   seeds        1..40, `createGame({ seed, decks: DECKS, defs: CARD_DEFS })`
 *   both seats   `GreedyAgent({ seed, decks: DECKS, depth: 1 })` drives the game forward
 *   sampled at   every state where `actingPlayer === HUMAN` — a DECISION, whether or not a card is clickable
 *   choice set   `buildChoiceSet(view, preferredChoices(view, legal), paymentAlternatives(legal))`
 *   on arrival   `choices.loose` with Concede sorted last — what `Board` hands the strip before any click
 *   step cap     600 commands per seed
 *
 * The before-figure is read off the CHOICES, which the fix does not touch, so it holds before and after and
 * proves the corpus visited the hazard. The after-figure is read off the RENDERED strip, which is the thing
 * the player meets. Counting the predicate instead of the buttons is how F6 first under-counted by 108.
 */

Element.prototype.scrollIntoView = function scrollIntoView() {}

interface Decision { readonly state: GameState; readonly choices: ChoiceSet; readonly arrival: Choice[] }

const last = (c: Choice): number => (c.command.type === 'concede' ? 1 : 0)
const isConcede = (c: Choice): boolean => c.command.type === 'concede'

function* decisions(): Generator<Decision> {
  for (let seed = 1; seed <= 40; seed++) {
    const greedy = new GreedyAgent({ seed, decks: DECKS, depth: 1 })
    let s: GameState = createGame({ seed, decks: DECKS, defs: CARD_DEFS })
    for (let i = 0; i < 600 && !s.result; i++) {
      const p = actingPlayer(s)
      if (p === null) break
      if (p === HUMAN) {
        const view = viewFor(s, HUMAN)
        const legal = legalCommands(s, HUMAN)
        const choices = buildChoiceSet(view, preferredChoices(view, legal), paymentAlternatives(legal))
        const arrival = choices.loose.slice().sort((a, b) => last(a) - last(b))
        yield { state: s, choices, arrival }
      }
      s = apply(s, greedy.decide(viewFor(s, p), legalCommands(s, p))).state
    }
  }
}

/** The spec's predicate, on the choices: every answer is on a card and the strip would hold only Concede. */
const concedeWouldBeAlone = (d: Decision): boolean =>
  d.choices.byCard.size > 0 && d.arrival.length > 0 && d.arrival.every(isConcede)

let root: Root | null = null
let host: HTMLDivElement | null = null
function unmount(): void { act(() => { root?.unmount() }); host?.remove(); root = null; host = null }
afterEach(unmount)

/** Renders the strip exactly as `Board` would on arrival and returns the `data-command` of every button. */
function stripButtons(d: Decision): string[] {
  if (!root) { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) }
  const el = createElement(PromptStrip, {
    view: viewFor(d.state, HUMAN), choices: d.choices, shown: d.arrival, aiThinking: false,
    onChoose: () => {},
  })
  act(() => { root!.render(el) })
  return [...document.querySelectorAll<HTMLButtonElement>('.prompt__actions button')]
    .map((b) => b.getAttribute('data-command') ?? '')
}

/** Mounts the whole board at this decision and returns the byCard keys that rendered NO button. */
function unpressable(d: Decision): string[] {
  unmount()
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  const api: GameApi = {
    view: viewFor(d.state, HUMAN), choices: d.choices, log: [], aiThinking: false,
    choose: () => {}, restart: () => {},
  }
  act(() => { root!.render(createElement(Board, { game: api })) })
  const out: string[] = []
  for (const id of d.choices.byCard.keys()) {
    if (!document.querySelector(`[data-card-id="${id}"] button`)) out.push(String(id))
  }
  unmount()
  return out
}

describe('G6 — the strip never offers Concede alone', () => {
  it('renders no button where every answer is on a card (G6-A1), and every other strip intact (G6-A2)', () => {
    let seen = 0
    let hazard = 0          // decisions where the CHOICES would put Concede alone — the before-figure
    let concedeAlone = 0    // decisions where the RENDERED strip's only button is Concede — must be 0
    let withOthers = 0      // decisions with a non-concede loose choice — A2's population
    const silenced: string[] = []
    const kinds = new Map<string, number>()
    for (const d of decisions()) {
      seen++
      const buttons = stripButtons(d)
      if (concedeWouldBeAlone(d)) {
        hazard++
        const kind = d.state.pending?.kind ?? d.state.phase
        kinds.set(kind, (kinds.get(kind) ?? 0) + 1)
      }
      if (buttons.length === 1 && buttons[0] === 'concede') concedeAlone++
      const others = d.arrival.filter((c) => !isConcede(c))
      if (others.length > 0) {
        withOthers++
        // Every non-concede choice is a button, and Concede is still alongside it — as a COUNT, because a fix
        // that hid the strip whenever it felt like it would pass A1 perfectly.
        const missing = others.filter((c) => !buttons.includes(c.command.type))
        if (missing.length > 0 || !buttons.includes('concede')) {
          if (silenced.length < 4) silenced.push(`${d.state.pending?.kind ?? d.state.phase}: [${buttons.join(', ')}] lacks ${missing.map((c) => c.label).join('/') || 'Concede'}`)
          else silenced.push('…')
        }
      }
    }
    // The corpus is the spec's: 2,288 decisions, 345 of them the hazard (15.1 %), at chooseTargets /
    // chooseFromDeck / discardToHandSize. Floors rather than exact pins, so an engine change that moves the
    // count by a few does not read as a G6 regression — but a corpus that never reaches the hazard must fail.
    expect(seen, 'corpus is far smaller than the 2,288 decisions the spec measured').toBeGreaterThan(2000)
    expect(hazard, `the corpus never reached the hazard (kinds: ${JSON.stringify([...kinds])})`).toBeGreaterThan(300)
    expect(withOthers, 'A2 has nothing to assert over').toBeGreaterThan(1500)
    expect(silenced, 'a strip with a real choice on it lost a button (G6-A2)').toEqual([])
    expect(concedeAlone, `${concedeAlone} of ${seen} decisions still render Concede as the only button (G6-A1)`).toBe(0)
  })

  it('leaves the card the prompt points at pressable, at exactly those decisions (G6-A4)', () => {
    let checked = 0
    const stranded: string[] = []
    for (const d of decisions()) {
      if (!concedeWouldBeAlone(d)) continue
      checked++
      const missing = unpressable(d)
      if (missing.length > 0 && stranded.length < 4) {
        stranded.push(`${d.state.pending?.kind ?? d.state.phase}: byCard ${missing.join(',')} rendered no button`)
      }
    }
    expect(checked, 'no hazard decision was examined, so nothing was proved').toBeGreaterThan(300)
    expect(stranded, 'the strip offers nothing AND the card is not pressable — the player is stranded').toEqual([])
  })
})
```

- [ ] **Step 2: Run it and confirm A1 fails on the current build**

Run: `pnpm --filter @fftcg/web exec vitest run test/concede-only.test.tsx`
Expected: the first test FAILS on the LAST assertion with a message like `345 of 2288 decisions still render Concede as the only button (G6-A1)`. The floors (`seen > 2000`, `hazard > 300`, `withOthers > 1500`) and A2 (`silenced` empty) must already PASS — if a floor fails, the corpus is not the spec's; stop and reconcile before changing the predicate. The A4 test should PASS already (the cards are pressable today; the strip is the problem).

Write down the exact `seen` and `hazard` numbers from the failure message — Task 3 puts them in the spec.

- [ ] **Step 3: Commit the failing test**

```bash
git add apps/web/test/concede-only.test.tsx docs/superpowers/plans/2026-09-08-rung-g6-the-only-button-is-concede.md
git commit -m "test(web): count the decisions where the strip's only button is Concede (G6-A1/A2/A4, red)"
```

---

### Task 2: The fix in `PromptStrip` — offer nothing, and mark the §2.1 deviation

**Files:**
- Modify: `apps/web/src/ui/PromptStrip.tsx` (the `cardOnly` line, and the `shown.map` render)
- Test: `apps/web/test/concede-only.test.tsx` (from Task 1), `apps/web/test/focus.test.tsx` (unchanged, must stay green — A3)

**Interfaces:**
- Consumes: `cardOnly`, `picking`, `yours`, `shown`, `choices` already in scope in `PromptStrip`.
- Produces: no new exports. `cardOnly` keeps its exact truth table (so the prompt wording is unchanged); `concedeOnly` is new and gates the buttons.

- [ ] **Step 1: Replace the `cardOnly` line**

Find this line in `PromptStrip.tsx`:

```ts
  const cardOnly = yours && choices.byCard.size > 0 && (picking || !shown.some((c) => c.command.type !== 'concede'))
```

Replace it with:

```ts
  const answersOnCards = yours && choices.byCard.size > 0
  // MVP0-SIMPLIFICATION (rung G6, CR §2.1 — a player may concede at any time): when every answer is on a card
  // the strip would hold exactly one button, Concede — the only tab stop, two Enters from game over, at 345 of
  // 2,288 human decisions (15.1 %) in the spec's corpus. So at those decisions the strip offers NOTHING, and the
  // player cannot concede until the next strip, which is one decision away. A strip whose sole affordance ends
  // the game is the worse restriction; `hotseat.test.ts` made the same call for the terminal ("offered LAST,
  // never as option 0"). Concede's ordering and arming are untouched everywhere else.
  const concedeOnly = answersOnCards && !shown.some((c) => c.command.type !== 'concede')
  // `chooseTargets` keeps its "no targets" button, so it is NOT concede-only — but the targets themselves are
  // still on the board, and the prompt has to say so. Same wording as before; only the buttons changed.
  const cardOnly = concedeOnly || (answersOnCards && picking)
```

- [ ] **Step 2: Gate the buttons**

Find:

```tsx
        {yours && shown.map((c, i) => (
```

Replace with:

```tsx
        {yours && !concedeOnly && shown.map((c, i) => (
```

- [ ] **Step 3: Run the G6 test and the strip's existing tests**

Run: `pnpm --filter @fftcg/web exec vitest run test/concede-only.test.tsx test/focus.test.tsx test/pressable.test.tsx test/prompt-verbs.test.tsx`
Expected: all PASS. `concede-only` now reports `concedeAlone` 0 with the same `seen`/`hazard` as Step 2 of Task 1.

- [ ] **Step 4: Mutate, so A2 is known to bite**

Temporarily change the gate to the wide predicate:

```tsx
        {yours && !cardOnly && shown.map((c, i) => (
```

Run: `pnpm --filter @fftcg/web exec vitest run test/concede-only.test.tsx`
Expected: FAIL on `silenced` with a `chooseTargets: [] lacks …` entry — the "no targets" button vanished. Note the count of silenced decisions. Then revert to `!concedeOnly` and re-run to green. Add one line to the test file's header comment recording both mutations:

```
 * Mutations (2026-09-08): before the fix, A1 reported <hazard> of <seen>; gating on `cardOnly` instead of
 * `concedeOnly` silenced <n> chooseTargets strips and A2 caught it.
```

- [ ] **Step 5: Full verification**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: all green. Unit count rises by 2 (1037 → 1039).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/ui/PromptStrip.tsx apps/web/test/concede-only.test.tsx
git commit -m "fix(web): the strip offers nothing, not Concede alone, when every answer is on a card (G6)"
```

---

### Task 3: Mark the spec built, with the measured after-figures

**Files:**
- Modify: `docs/superpowers/specs/2026-08-31-rung-g6-the-only-button-is-concede.md` (the STATUS blockquote only)
- Check: `README.md` — `grep -n -i 'concede' README.md`; if it describes the strip's Concede behaviour, add one sentence; if not, leave it.

- [ ] **Step 1: Update the status line**

Replace the blockquote at the top of the spec:

```markdown
> **STATUS: SPEC. Nothing built.** Found by driving the PRODUCTION build, which is how it surfaced at all: a
> script clicking the first strip button conceded a game it was winning.
```

with (fill in the numbers from Task 1 Step 2 and Task 2 Step 4):

```markdown
> **STATUS: BUILT 2026-09-08** (`apps/web/test/concede-only.test.tsx`, `PromptStrip.tsx`). Codex plan review
> skipped by decision. Measured over the same corpus: <seen> decisions, <hazard> where the choices would put
> Concede alone; after the fix 0 render it alone (A1), 0 strips with a real choice lost a button (A2), and every
> `byCard` key at those <hazard> decisions renders a pressable control (A4). Mutation: gating on `cardOnly`
> silenced <n> `chooseTargets` strips and A2 caught it.
>
> Found by driving the PRODUCTION build, which is how it surfaced at all: a script clicking the first strip
> button conceded a game it was winning.
```

- [ ] **Step 2: Check the README and the docs test**

Run: `grep -n -i 'concede' README.md; pnpm --filter @fftcg/web exec vitest run test/readme.test.ts`
Expected: readme test PASS. If the README describes the strip's Concede affordance, add one sentence stating that at card-only prompts the strip offers no buttons and the deviation from §2.1 is marked.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-08-31-rung-g6-the-only-button-is-concede.md README.md
git commit -m "docs(specs): G6 built — the strip offers nothing where every answer is on a card"
```

---

## Self-review

- **Spec coverage:** A1 → Task 1 `concedeAlone === 0`. A2 → Task 1 `silenced` empty over `withOthers`. A3 → `focus.test.tsx` unchanged and run in Task 2 Step 3. A4 → Task 1 second test, at exactly the hazard decisions. A5 → Task 2 Step 1 comment. The rejected alternative (a second button) is not proposed.
- **Placeholders:** the `<seen>`/`<hazard>`/`<n>` slots in Task 2 Step 4 and Task 3 Step 1 are measurements the executor takes in Task 1 Step 2 and Task 2 Step 4, not TBDs.
- **Type consistency:** `Decision`, `concedeWouldBeAlone`, `stripButtons`, `unpressable` are defined and used only inside the one test file. `concedeOnly`/`answersOnCards`/`cardOnly` are consistent between Task 2 Steps 1–2 and Step 4.
