# Rung D4 — profile the rollout, then stop cloning the card database

D3 was deferred in favour of finding out where the search's time actually goes. This is that measurement,
and the one change it clearly justifies.

## Method

`node --cpu-prof` over `selfplay --games 2 --seed 1 --p0 ismcts:200 --p1 greedy --fast`, 14,728 samples
over 20.9 s, self-time aggregated per function. Then a targeted micro-benchmark of `determinise` and
`structuredClone` on a real mid-game state, 300 iterations each after a warm-up.

**Caveat on the profile:** it runs under `tsx`, so a few frames (`__name`, `set MIMEParams`, ~4 % together)
are transform artefacts that do not exist in the Vite production build the browser runs. The engine frames
below are real; the exact percentages are indicative.

## What the profile says

| self time | % | function |
|---|---|---|
| 2513.8 ms | **12.02 %** | `structuredClone` |
| 1205.9 ms | 5.77 % | `defOf` |
| 802.3 ms | 3.84 % | `runEffect` |
| 729.8 ms | 3.49 % | `applyChooseTargets` |
| 721.4 ms | 3.45 % | `settle` |
| 637.4 ms | 3.05 % | `runFrame` |
| 573.0 ms | 2.74 % | `pendingBreakTransitions` |
| 565.9 ms | 2.71 % | `runEffects` |

Two things stand out.

**1. There is exactly one dominant hotspot, and it is not game logic.** `structuredClone` is 12 % of all CPU
— more than double the next entry. There are only two call sites in the engine; `searchView` already exists
to dodge the one in `viewFor` ("the clone is ~all of a `viewFor` call"), which leaves `determinise.ts:84`,
called once per iteration, 200 times per decision.

**2. Nothing else is a hotspot.** After `defOf`, cost is spread thinly across the resolution machinery.
There is no second easy win here: the engine is not doing anything stupid, it is just doing it 124,000 times
per decision (770,764,747 rollout applies against 4,869,498 tree applies over the 120-game tournament —
99.4 % of engine work is rollout).

## The change this justifies

`determinise` ends `return [structuredClone(state), r]`, and `state.defs` is the whole card database.
Measured on a real mid-game state:

| | |
|---|---|
| `defs`, serialised | **17.9 KiB** |
| the entire rest of the state | 4.9 KiB |
| `structuredClone(defs)` alone | 62.3 % of the whole-state clone |
| the clone | 80.4 % of a `determinise()` call |
| **so dropping `defs` from the clone** | **~50 % of `determinise()`** |

The card database is 3.6x the size of the game state, it is immutable reference data, and the search
deep-copies it 200 times per decision — roughly **3.6 MB of garbage per decision** for a value that never
changes. (`(garbage collector)` is another 1.96 % of the profile.)

The fix is to clone everything except `defs` and carry the same reference through.

## The question that makes this a rung and not a patch

**Is `defs` isolation load-bearing anywhere?** `viewFor` deep-clones it too, and `cr7.6-view.test.ts:29`
deliberately mutates `v.defs['V-F1'].cost = 99` to prove a view cannot corrupt the state it came from. So
the codebase treats view/state def isolation as a property worth asserting — for `viewFor`.

The claim to test is narrower: nothing MUTATES `defs` in production, so `determinise` need not defend
against it. That has to be established rather than assumed, and the honest form is a test that would catch
a future mutation, not a comment saying there isn't one.

## Acceptance

Revised after the Codex plan review, which confirmed the change is safe for every current production caller
— no write, freeze, or identity comparison on `defs` anywhere outside test fixtures — and then found four of
these five criteria too weak to prove it.

- **D4-A1** No aliasing beyond `defs`. Asserted by walking BOTH object graphs: the set of object identities
  reachable from the view and from the returned state must be disjoint, **except** `defs` and everything
  beneath it. Array-level checks are not enough — a wrong implementation that copies every zone array while
  sharing the `FieldCard` objects, `pending.candidates`, and `resolution.active.path` inside them would pass
  those and still alias. Nested leaves are mutated explicitly to prove it.
- **D4-A2** Value-identical to the OLD semantics, against a real baseline. The existing determinism test
  compares two runs of the SAME implementation, so after a bad change both copies are identically wrong.
  The test therefore keeps a reference implementation of the old whole-state clone and asserts the new
  `determinise` deep-equals it for the same view and RNG — on `CARD_DEFS` positions with real ability-
  bearing definitions, not just `VANILLA_POOL`.
- **D4-A3** The immutability the change relies on is ENFORCED in a test, not asserted in a comment: a
  RECURSIVE freeze of the actual `defs` handed to a search, which then runs a full search over
  ability-bearing cards. A shallow `Object.freeze` would miss `defs[code].cost = …` and every nested
  ability/effect write, and freezing in production would be pointless — `viewFor` and `postMessage` both
  hand out unfrozen clones.
- **D4-A4** Measured with spread, not a single number: `determinise()` on EARLY, MID and LATE states,
  alternating old/new order, reporting median and range. JSON byte size is a proxy for allocation, not a
  measurement of it, so the "MB of garbage" figure stays labelled as the proxy it is.
- **D4-A5** EXACT replay, not "within noise". The search has fixed iterations and explicit RNG streams, so a
  reference-only change must produce an identical command trace on identical seeds — "within noise" could
  bless a real regression. The 78.3 % tournament figure stays as a sanity check on top, not as the gate.

Verified by mutation.

## Deliberately not doing: removing the rest of the clone

The remaining non-`defs` clone (4.9 KiB, ~0.038 ms) is probably unnecessary for the search — `apply` is
immutable and the search only reads. But `determinise` returns a mutable, exported `GameState`, and without
that clone the returned state aliases the view's own hand, field arrays, `FieldCard` objects, `attack`,
`pending`, `resolution` and visible `CardInstance`s. The clone is an API-isolation boundary even where it is
not computationally required. It would save a few more percent end-to-end for a much larger maintenance
surface, so it stays.

## Measured result

| | |
|---|---|
| `determinise()` — EARLY / MID / LATE, median of 12 alternating runs each | **3.24x / 3.24x / 3.30x** faster |
| end to end, `selfplay --p0 ismcts:200` | 392.0 -> **304.5 ms/decision** (~22 %) |
| exact replay, 20 mirrored pairs on identical seeds | **32/40 both before and after** — identical, not "within noise" |

Better than the ~2x predicted; the extra is most likely the allocation that is no longer happening.
The end-to-end figure compares a 6-game run against the 120-game tournament's number, so the sample sizes
differ and it is indicative rather than exact — but 22 % is far outside the spread of either.

## Explicitly NOT in this rung

The 124,000 applies per decision. That is the real structural cost and no micro-optimisation touches it —
it is a question about rollout depth and what a rollout is allowed to skip, which needs its own spec and
its own strength measurements. Recording it here so the next rung has a starting point rather than a
rediscovery.
