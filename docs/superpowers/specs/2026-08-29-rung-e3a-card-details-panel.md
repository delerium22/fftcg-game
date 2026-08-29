# Rung E3a — the card details panel (pointer only)

> **STATUS: SPEC, ready to build.** Rewritten from [E3](2026-08-29-rung-e3-the-browser-shows-what-a-card-does.md)
> after that plan was refused. E3 has the defect, the evidence, and the full refusal.
>
> **This rung does NOT close that defect.** It ships the pointer path. A keyboard-only player is still blind
> at the mulligan, because mulligan is a subjectless command and hand cards are therefore unfocusable
> `role="img"` divs. **E3b** — roving tabindex per zone — is what closes it. Saying otherwise here would be
> the dishonest version, and the reviewer named it as such.

## What this rung is

A card details panel in the rail that already holds the game log, showing the full printed text of the card
the player last hovered or focused, plus an honest note when this build does not implement all of it.

## Design decisions

**One card at a time, persistent.** The reviewer ruled explicitly that a single last-inspected panel is
sufficient even for blocking, where two cards must be compared: the comparison can be serial, and the card
faces already show effective power, damage, grants and flags simultaneously. No two-panel comparator.

**Never clears on mouseout.** Reading a card and then moving to the button that acts on it must not blank
the thing you just read.

**Not click-to-inspect.** A hand card during a cast choice is already a `<button>` whose click plays it.

**The coverage rule is not reimplemented.** `warnUnimplemented` in `resolve.ts` already computes how many
printed clauses this build leaves unimplemented, `Math.max(0, …)` clamp and all, and it is the rule the game
log prints. A second copy in the browser would be two implementations of one rule that must agree — the
duplication rung E2 just removed — and the drift would be worse here, because the panel and the log would
tell the player two different stories about the same card. So: extract `unimplementedClauseCount(def)` into
the engine's pure module, have `warnUnimplemented` call it, and have the panel call it.

## Acceptance

The four CRITICALs against E3 all reduce to one thing: **every criterion must be anchored in a mounted, real
`Board`, driven by real events.** Component-level tests of `CardDetails` in isolation are permitted only
*in addition*, never *instead*. `jsdom` is already available in `apps/web`, and rendered-hook tests using
`createRoot` + `act` already exist in this package, so there is no new infrastructure to build.

- **E3a-A1** From a real mulligan view in a mounted `Board`, hovering a named hand card puts that card's
  complete printed `text` in the rail, asserted against a hand-written string.
- **E3a-A2** The same, driven by `focus` instead of hover, asserted separately — a handler wired to only one
  of the two satisfies any test that merely checks "the panel updated".
- **E3a-A3** Moving the pointer off the card leaves the text in place.
- **E3a-A4** A hand-built def whose printed `text` contains a clause its `abilities` do NOT implement shows
  the complete text **including that clause**, and the caveat. The fixture's `text` must be deliberately
  distinct from the concatenation of its implemented clause texts — see the mutation plan for why this is
  the single most important line in this spec.
- **E3a-A5** A hand-built `{ hasAbilities: false, text: 'Haste' }` def shows `Haste` and no caveat.
  `hasAbilities` deliberately excludes keyword-only lines during normalisation, so it is not a proxy for
  "has printed text". Separately, `text: ''` renders no empty block.
- **E3a-A6** `unimplementedClauseCount` is pinned on four cases: omitted `abilityClauses` + `hasAbilities`
  + no AST → 1; three printed, one implemented, one inert → 1; a complete def → 0; overcoverage → 0 after
  the clamp. `warnUnimplemented` and the panel both consume it, and neither restates the arithmetic.
- **E3a-A7** A pool invariant in the cards package: every card is fully implemented. Today it records a
  fact — all 18 are — and the day the pool gains an unimplemented clause it fires and A4's branch goes live.
- **E3a-A8** Click preservation, in the mounted Board: hover submits nothing, focus submits nothing, and one
  click on a single-choice selectable card submits exactly that `Choice`.
- **E3a-A9** Existing web tests pass with no expectation edited.
- **E3a-A10** Full typecheck / lint / test gates green. **No selfplay gate** — a pure UI rung gains nothing
  from 200 games beyond the ordinary gates, and asserting it would be habit, not evidence.

## Mutation plan

Every criterion above is worthless unless its mutation reddens it.

| # | mutation | must fail |
|---|---|---|
| 1 | `Board` never stores the inspected card | A1 |
| 2 | the panel is removed from the rail | A1 |
| 3 | panel renders `def.abilities.map(a => a.text).join('\n')` instead of `def.text` | **A4** |
| 4 | panel renders `def.abilities[0].text` | A4 |
| 5 | panel renders the card's existing `label` | A1 |
| 6 | hover handler removed | A1 |
| 7 | focus handler removed | A2 |
| 8 | clear-on-mouseout added | A3 |
| 9 | caveat hard-coded off | A4 |
| 10 | text rendered only when `hasAbilities` | A5 |
| 11 | the clamp dropped from `unimplementedClauseCount` | A6 |
| 12 | one clause removed from a card's `ABILITIES` entry | A7, naming that card |
| 13 | `onClick` swapped for inspection; `onMouseEnter` wired to submit | A8 |

**Mutation 3 is the reason this spec was rewritten.** For Cloud, joining the two implemented clause texts
reconstructs the printed text *exactly*. So a panel rendering the wrong field passes a test written against
a real named card — and the field it renders is the one that drops unimplemented printed clauses, which is
the whole purpose of the panel. A4's fixture exists specifically to make mutation 3 impossible to survive,
which is why its `text` must not equal its joined clause texts.

## Layout

The rail is a constrained flex column and the log currently claims full height. Check the longest card text
in the pool at the minimum supported desktop width, with both the details and a scrollable log reachable.
Not mobile — out of scope since B10.
