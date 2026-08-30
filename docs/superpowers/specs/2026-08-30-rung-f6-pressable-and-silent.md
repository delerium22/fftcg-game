# Rung F6 — a card you can press that will not say what pressing it does

> **STATUS: SPEC, awaiting plan review.** Nothing built. Found by playing, then measured. The margin was
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
