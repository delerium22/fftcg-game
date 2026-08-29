# Rung E10 — choosing between cards you cannot see

> **STATUS: BUILT** — all four cases, commits `930fcea` and `b9d5970`. See *Built* at the end.
>
> The first draft's premise was factually wrong and is preserved below the rule, because the mistake is the
> useful part. The plan review that caught it also caught this spec's predecessor claiming "same-code" after
> the code had changed; a status line left saying "nothing built" is the same defect, so it is updated here.

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

---

## Built

All four cases, in the order the revised spec set.

**1 — the orphan row lost E9's marker.** It passed the raw definition name, so a Break Zone choice rendered
three cards all reading "Luso" while their buttons read "Luso (1)".."Luso (3)". The fix is a THIRD namer,
because both existing ones are wrong for a card: `qualifiedName` omits the off-board zones, and `choiceName`
carries the possessive — "your Hugh Yurg (1)" on a card the player is looking at, beside their own Break Zone,
states the one thing never in doubt. `displayName` is name-plus-marker, and all three card rows now go through
it. The hand and field rows had been right only by writing the marker out longhand in two places, which is
precisely how the orphan row came to lack it.

**3 — Sphene.** `legalCommands` pre-enumerates an activation's targets INTO the command, so unlike a
`chooseTargets` pending there is no later step at which those cards become subjects. `subjectsOf` returned
only the source, so Sphene's Break Zone candidates attached to no card, appeared in no row, and could not be
clicked: E9 named them on a button while nothing on screen was them. Targets are subjects now; payment is
still excluded, on the distinction the file already drew — a target is chosen BY the player, a payment FOR
them.

**2 — the deck search, where nothing was rendered at all.** A `chooseFromDeck` names deck INDICES, so
`subjectsOf` — pure on the command — could not turn one into a card and every search fell into `loose`. One
function, `subjectsIn`, resolves the picks through the view, and the rest is free: they become ordinary
`byCard` keys, so the existing orphan row draws them, `pick` clicks them and `displayName` numbers them. No
new UI. `pickedDeckCards` returns null for any slot hidden from the viewer, which is what makes it impossible
to show a card the player is not entitled to see, and only the picks `legalCommands` already computed are
resolved — the eligible SET stays the engine's rule.

### What playing it looks like now

`?seed=5`, two clicks — "Keep hand", "Cast Hugh Yurg" — and the whole-deck search offers **Luso (1)**,
**Luso (2)**, **Luso (3)** as pressable cards, each announcing "cost 1, earth, forward, power 3000 of 3000".
Before this rung it was three prompt-strip buttons all reading "Play Luso onto the field", for cards the
player had never seen.

## An existing test was asserting the wrong thing, and half of it was vacuous

Making targets subjects broke `leaves no clickable choice off the board across a real game`. The test read
`usable.map(c => c.card)` — only the FIRST subject — which held while every subject led some command (true of
discard combinations and attack sets, false of an activation, whose source leads all and whose targets lead
none). Rewritten to assert what it names: every targetable card reaches the DOM as something pressable.

Set algebra could not replace it — `orphanTargetIds` is DEFINED as the byCard keys the named zones do not
draw, so "every key is drawn or an orphan" is true by construction and asserts nothing.

Then its new guard found something worse: **over 2000 steps of seed 3 the walk had never once reached an
off-board candidate**, so in its original form it only ever asserted the easy half. It now walks seeds until
it has seen both an off-board candidate and a targeted activation, and fails loudly if it has not. In that
form it catches the orphan row being deleted; before, it did not.

## `?seed=` — a production surface added for a test, said plainly

E10-A6 needs a REPRODUCIBLE browser route: a check that plays randomly until it stumbles into a search is
vacuous when it misses and flaky when it hits. `?seed=5` reaches Hugh Yurg's search in two clicks, and because
the human takes the first turn that route contains no AI decision, so no worker timing can move it.

It earns its place independently — a player who hits a bug can now say which game it was. Parsing is
digits-only, because `Number` reads `""` as 0, `"0x10"` as 16, `" 5"` as 5 and `"1e3"` as 1000: four ways to
hand back a different game from the one asked for, which defeats the point of asking by seed. A bad seed
still starts a game and says so, though — the CLI's lesson was about unknown FLAGS, and a typo in an address
bar is not that.

## Mutation table

| # | Mutation | Result |
|---|---|---|
| 13 | orphan row passes the raw name again | 2 fail — the marker and the no-two-alike checks |
| 14 | `orphanTargetIds` returns `[]` | the rewritten walk test fails ("card 18 … rendered nowhere"), plus 4 others |
| 15 | activation targets stop being subjects | 2 fail — Sphene's targets rendered nowhere, and no choice filed under them |
| 16 | deck picks lose their card subjects | 5 jsdom fail, AND the browser check fails at 0 candidates |
| 17 | render every VISIBLE deck card, not the eligible ones | 4 fail — Reeve shows 7 for a top-3 look |

Mutation 17 is why all three deck paths are covered: Hugh Yurg alone cannot distinguish "eligible" from
"visible", and Reeve is the case that can.

**22 E10 tests. Gates green:** 938 jsdom, 7 Playwright, typecheck, lint, 200/200 selfplay seed 1.
