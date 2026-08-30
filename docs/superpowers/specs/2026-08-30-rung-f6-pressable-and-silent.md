# Rung F6 — a card you can press that will not say what pressing it does

> **STATUS: PLAN REVIEWED — revise, then build.** The fix is right and the wording is ruled on, but my
> measurement was an UNDERCOUNT and this is not the one-string change I claimed. Nothing built. Found by playing, then measured. The margin was
> predeclared before any run in F5's review, so it is stated here too — see *Acceptance*.

## Found by playing

Seed 21, turn 1, Main Phase 1. Six hand cards, all pressable, and the prompt says "cast, attack, or pass".
Every one of them announces its stats and **no action at all**:

```
Lightning (1), cost 7, lightning, forward, power 9000 of 9000
Billy Bob, cost 3, earth and lightning, forward, power 8000 of 8000
Luso, cost 1, earth, forward, power 3000 of 3000
…
```

Compare a card that commits on click, which says exactly what it will do:

```
Class Tenth Moogle, cost 2, earth, backup, Cast Class Tenth Moogle paying: discard Geomancer as earth
```

So the interface tells you *most* about the cards where least is at stake, and *nothing* about the ones that
open a decision.

## Measured

Over six seeded games, every position where the human has a clickable card:

| | |
|---|---|
| clickable cards | 443 |
| **announcing no action** | **171 (38.6 %)** |
| — because the card has several choices | 69 |
| — because it has ONE choice with hidden payments | 102 |
| positions where clickable cards exist | 176 |
| **positions where EVERY clickable card is silent** | **38 (21.6 %)** |

**One position in five** offers a board of pressable cards and says nothing about any of them.

## My own rung caused most of it

102 of the 171 silent cards are silent because of **rung E11**, which made a card with several ways to pay
select rather than commit. That was right — it handed back a decision the UI had been making — but
`actionFor` names an action only when the click commits, so E11 converted "commits silently" into "says
nothing", and enlarged this gap by roughly 2.5×.

The F4 plan review put this rung second, after E11, for exactly that reason. It is now first in the queue and
reproduced by playing.

## Why the current behaviour is not simply a bug

`actionFor` is deliberate and its reasoning is sound:

> What clicking this card will do, but ONLY when it does exactly one thing. […] A card offering several
> options does not commit on click — it opens the prompt strip, which lists every option with this same
> label — so disclosing one of them here would name a payment the click is not about to make.

Naming one of several options would be E4's defect again: stating an action the click will not take. **The
fix is not to name an option. It is to say what the click actually does** — open a choice, and how large a
choice it is.

## Proposed shape, with the question I want ruled on

- commits on click → unchanged: the action, as today.
- opens a choice → say so, with the count: `3 options`, `2 ways to pay`.

The open question is whether the count is enough, or whether the richer form — `Cast Cloud, 4 ways to pay` —
is better. It is more useful and it names the action; but the click does NOT cast, it selects, so it risks
re-introducing exactly the "states an action it will not take" defect in a subtler form. **I lean to the bare
count** and want that ruled on rather than decided by my taste.

Also open: whether a card whose only choice is a cast with alternatives should be treated as the same case as
one with several genuinely different actions. They read the same to `actionFor` today and they are not the
same thing to a player.

## Acceptance

Margins and thresholds stated HERE, before any measurement, because F5's were not and its own review could
not substantiate them.

- **F6-A1** Every clickable card announces something about what pressing it does — asserted over a driven
  corpus, not one fixture. Threshold: **zero** clickable cards with no action component, in every position of
  a six-seed walk. Falsifier: the count above must go to 0 and a mutation that reverts `actionFor` must push
  it back over 100.
- **F6-A2** A card that COMMITS still names its exact action, unchanged. Falsifier: the E4 test suite passes
  untouched, and a card with one payment still reads `Cast X paying: …`.
- **F6-A3** No card ever names an action the click will not take. Falsifier: for every clickable card whose
  click does not commit, its announced text must not contain a payment or a target — asserted as a property
  over the corpus, not by reading examples.
- **F6-A4** The count is correct: a card with N choices says N, verified against `byCard` rather than against
  the rendering.
- **F6-A5** Browser check: the announcement is in the accessible name Chromium computes, via `getByRole`, on
  a pinned route. Not `textContent`, which is the mistake F4's review caught.
- **F6-A6** Existing tests pass unedited, or any that must change are named in this spec BEFORE the run.
  `actionFor`'s current tests and the E4 suite are the ones to watch.

## Not in scope

Changing what the prompt strip says, the click model itself, or which cards are clickable. This rung changes
one string.

---

## Plan review: not cleared. My measurement was wrong in the direction I did not check.

> **Wording ruled on:** bare differentiated forms — `3 options` for several moves, `4 ways to pay` (preferred
> plus alternatives) for one move funded several ways, and the exact `Choice.label` when the click commits.
> **`Cast Cloud, 4 ways to pay` is REJECTED**: the repo defines E4's invariant as "the stated action is what
> pressing immediately does", and that click selects Cloud, it does not cast it. The richer form reintroduces
> E4's defect. A bare count does not — and it stays true when pressing an already-selected card CLOSES the
> options, since `pick` toggles and the noun phrase holds either way.

### CRITICAL 1 — `actionFor` never reaches two of the three card rows

I measured the predicate. I did not check where its result goes. It is passed to the card button **for hand
cards only** (`Board.tsx:442`). Selectable FIELD cards get no `action` (`361`), and orphan-row cards get none
(`377`). So:

- a field Forward whose sole choice is `Block with Luso` **commits on press and announces only its stats** —
  my predicate scored it as non-silent, wrongly;
- a Hugh Yurg deck-search candidate in the orphan row commits `Play X onto the field` and announces only the
  card — **my corpus omitted that row entirely**.

**So 171/443 and 38/176 are UNDERCOUNTS, not overcounts.** I had worried the cell might rescue the number;
it does not — `CardGrid` deliberately withholds `cellName` from a selectable card because the button is the
focus target, and the button's name comes only from `cardAccessibleName`.

And it disproves my closing line: **this is not a one-string change.** The disclosure has to be threaded
through the hand, field and orphan render paths.

### CRITICAL 2 — F6-A3 cannot prove its own invariant

A3 forbade payment or target text on a non-committing card. Plenty of false actions contain neither: a
Forward with several attacks would leak `Attack with Cloud`, pressing selects rather than attacks, and the
property passes. Replaced with an exact structural oracle, which also removes the string-matching problem:

| the card | its announced suffix | pressing it |
|---|---|---|
| commits | exactly the sole `Choice.label` | submits that choice |
| one move, several payments | exactly `K+1 ways to pay` | submits nothing |
| several moves | exactly `N options` | submits nothing |

Leaking any `Choice.label` into a non-commit case then fails structurally rather than by guessing at strings.

### MAJOR — A4 counted the wrong thing

For one move funded several ways, `byCard` holds ONE choice and its `alternatives` hold the rest. Seed 11's
Class Tenth Moogle is `byCard.length === 1`, `alternatives.length === 2`, **three** ways to pay. "N choices
from `byCard`" cannot validate `3 ways to pay`. Split: `forCard.length > 1` → that many *options*;
`forCard.length === 1 && alternatives.length > 0` → `alternatives.length + 1` *ways to pay*.

### MAJOR — the corpus is not reproducible, and one omission would change the answer

I recorded no seeds, human policy, opponent config, step cap, or how the `ChoiceSet` was built. That last one
matters most: **the walk must pass `paymentAlternatives(rawLegal)`**, or every E11 alternative disappears and
the classification changes. I did pass it; the spec does not say so, so neither "171 must become zero" nor
"reversion must exceed 100" is currently repeatable. Method to be recorded as precisely as E11's test header
does.

### MAJOR — "the E4 suite passes untouched" is false

`look` feeds `actionFor` into `CardDetails` for every card, so the panel will start showing `2 options`. And
`card-details.test.tsx:1137` explicitly requires the details action to be **absent** for a multi-choice
Geomancer. That expectation must change, and A6 has to name it in advance — which is the whole reason A6
exists. The E11 browser test also carries prose asserting the card "no longer announces an action"
(`payment.spec.ts:22`), now stale.

### Recorded, not fixed here: two more surfaces violate the same principle

Not silent, so out of F6's scope, but they state an action the press does not perform:

- **`Pay differently`** embeds the exact preferred cast and payment in its accessible name, while pressing it
  only opens the chooser. That is mine, from E11.
- **`Concede`** says "Concede", but the first press only arms a confirmation.

The pile-browser buttons are fine — they name the pile and count, with `aria-expanded` carrying open/closed.
Ordinary strip choices are fine: they are exact committing labels.

### Acceptance, as re-ruled

- **A1** must mount `Board`, enumerate every `byCard` id, and inspect the ACTUAL button across hand, field
  and orphan paths — not the predicate.
- **A2** intent stands; the "untouched" claim does not.
- **A3** replaced by the structural oracle above, with click-result assertions.
- **A4** split into the two counts.
- **A5** predeclare exact routes and exact suffixes: seed 11 for multi-payment, seed 21 for several options.
- **A6** names `card-details.test.tsx:1137` and `payment.spec.ts:22` as the expectations that must change.
