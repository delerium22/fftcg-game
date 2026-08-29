# Rung E10 — choosing between cards you cannot see

> **STATUS: REVISED after plan review. The first draft's premise was factually wrong** and is preserved below
> the rule, because the mistake is the useful part. Nothing built.

## What I wrote first, and why it was wrong

I claimed the board shows the Break Zone "as a count" and therefore renders nothing for a Break Zone choice.
**That is false.** `Board.tsx` already has:

- an **orphan row** (`orphanTargetIds`, `Board.tsx:156`) that gathers any `choices.byCard` id the named zones
  do not draw and renders it as a selectable `Card` — built for exactly this reason, with a comment saying so;
- a **public-pile browser** for both Break Zones, damage zones and removed piles (`Board.tsx:93`).

So two of my three cases were already solved, and my "out of scope: a general Break Zone browser" was
describing a feature that shipped. I specced a rung against a baseline I had not read.

I had the file open during E9 and still asserted its behaviour from memory. That is the same error as E9's
"verified at three layers", and this time a review caught it before any code was written rather than after.

## What is actually broken

| # | Case | Status |
|---|---|---|
| 1 | Break Zone `chooseTargets` (Billy Bob, Prishe) | **Rendered**, but the orphan row passes the raw def name (`Board.tsx:341`), so no occurrence marker — the very thing E9 added |
| 2 | Activation SOURCE in the Break Zone (Undead Princess) | **Rendered** through the same row, same missing marker |
| 3 | Activation TARGETS in the Break Zone (**Sphene**) | **Not rendered and not clickable** — missed entirely by my first draft |
| 4 | `chooseFromDeck` (Hugh Yurg, Reeve, Miner) | **Not rendered** — `chooseFromDeck` is `loose`, so no card id reaches `byCard` at all |

Case 3 is the one I missed. `legalCommands` pre-enumerates an activation's targets INTO the command
(`legal.ts:102`, `activationTargetSets`), and `subjectsOf(activateAbility)` returns only `[c.source]`
(`commands.ts:686`). So Sphene's Break Zone candidates are attached to no card, appear in no row, and cannot be
clicked. E9's fix made the *label* name them; this rung has to make them *reachable*.

## Scope, as ruled

Render every actionable card association the hand and field rows do not already draw, and give all of them the
occurrence marker through one shared path rather than three:

1. Orphan row uses `choiceName`, not the bare def name.
2. `activateAbility` targets that are not otherwise drawn become associations, so Sphene's candidates reach a
   row and a click.
3. `chooseFromDeck` picks project through the **visible deck slots** into rendered candidates.
4. One off-board card-props path, so a fourth case cannot land without the marker.

**Design question for the plan, with my recommendation.** Making activation targets subjects changes which
board cards highlight, not only which off-board ones render — with Sphene active, every eligible Break Zone
Forward becomes clickable. I think that is right (it is how every other target choice already behaves), but it
is a behaviour change beyond rendering and the plan must state it rather than let it arrive as a side effect.

**Baseline, not deliverable:** the public-pile browser exists; keep it unchanged.

**Out of scope:** any engine, legality or `PlayerView` change. The review confirmed none is needed.

## The deck filter, and where it must come from

`viewFor` exposes every deck identity the viewer knows — during Hugh Yurg's whole-deck search, that is the
whole deck (`resolve.ts:329` teaches the controller before raising the pending; `view.ts:126` exposes what is
known). **So the view is not the eligible set and the UI must filter.**

It must filter by projecting the legal `chooseFromDeck.picks` through the visible slots — the picks
`legalCommands` already computed from `deckPickCandidates` (`legal.ts:50`). It must NOT call
`deckPickCandidates`, rebuild a `GameState`, or reimplement the filter: a second copy of that rule is exactly
how C7's zone silently diverged. Tests may compare the projection against `deckPickCandidates` on the real
state, because a test re-deriving the answer independently is the point.

This keeps E10 a rendering rung.

## Acceptance (revised to the review's audit)

Every criterion below names the guard that stops it passing vacuously — the failure mode that has now bitten
this work five times.

- **E10-A1** At a Break Zone `chooseTargets` with **at least two eligible cards sharing a printed name**
  (guard: assert that count, and use the two different Red Mages where possible), each rendered candidate's
  displayed name is exactly `choiceName(view, id)`, and its full accessible name equals
  `cardAccessibleName(expectedProps)`. NOT "equals the choice label" — a card's accessible name is
  deliberately richer than an action phrase, and equating them would delete the detail this rung exists to add.
- **E10-A2** All three deck paths, each as a real reached pending: **Hugh Yurg** (whole deck, filtered,
  `to: 'field'`), **Reeve** (top three, unfiltered, `to: 'hand'`), **Miner** (top five, filtered,
  `to: 'hand'`). Guard: assert eligible count > 0 AND, for the filtered ones, that the view exposes at least
  one INELIGIBLE card — otherwise "renders only eligible cards" is trivially true. Compare rendered ids to
  `deckPickCandidates` on the real state.
- **E10-A3** Clicking a candidate submits the command for **that** card: for Break Zone and activation cases
  the `CardId` subject/source/target is that id; for a deck case the submitted pick INDEX resolves through
  `pickedDeckCards` back to that id. Guard: at least two candidates, so "always picks the first" fails.
- **E10-A4** No ineligible card enters the **candidate grid** (scoped to that grid, not the whole board — an
  opened public pile may legitimately have cards in the DOM). Guard: the fixture must contain visible
  ineligible deck cards and a non-empty opponent Break Zone, or this asserts nothing.
- **E10-A5** After the choice is applied, those exact candidate ids are gone from the grid. Asserted as
  before/after on named ids, not as "the row is absent" — a row that never existed would pass that. The row
  itself may legitimately persist if another orphan choice remains.
- **E10-A6** A browser check over a **deterministic route** — a fixed seed and scripted clicks that reach a
  candidate grid holding at least two known cards, failing loudly if the route does not reach it. Random play
  is vacuous and flaky; the existing suite has no state injection, so the route must be pinned.
- **E10-A7** Mutations, each against a guarded fixture: render the wrong zone; render all visible deck cards
  instead of the eligible ones; map every candidate to the first id; drop the occurrence marker from the
  orphan row; leave stale ids in the grid after the pending clears. Each must fail.
- **E10-A8** Existing tests pass unedited; full gates green. **Noted as a regression gate only** — it passes
  today, so it is not evidence for anything E10 adds.

## Corrections carried from the review

- The Break Zone is **public**, not a hidden face-down pile (`view.ts:50` exposes both unredacted). A4 is
  about interaction design — not offering an unpickable card — not about secrecy.
- The rest of the deck during Hugh Yurg's search is **legitimately known** to the searcher. Same point.
- My claim that using the shared `Card` component brings the occurrence marker "for free" was **false**:
  `Card` receives an already-built `name`, and the hand and field callers add the marker themselves while the
  orphan and pile callers do not. Hence deliverable 4 — one shared path — rather than an assumption.
- `chooseMode` is **not** a gap. Its answer is label indices, the UI prints the wording verbatim, and Luso's
  mode is exactly why the pile browser was built.
- An opened pile and the candidate row can render the same card twice. Not a bug; the plan should decide
  whether to leave it, and tests must scope their queries to the candidate grid.
