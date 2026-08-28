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

- **D4-A1** `determinise` no longer deep-clones `defs`: the returned state's `defs` is reference-identical
  to the view's, and every OTHER part is still a copy — mutating a returned player array must not touch the
  view (asserted per field, not spot-checked).
- **D4-A2** Search output is unchanged: same seed, same view, same chosen command AND same diagnostics as
  before the change, over the existing seed set.
- **D4-A3** The immutability the change relies on is asserted, not assumed: a guard that fails if the engine
  ever writes to `defs` (freeze in strict/test mode, or an equality check across a full self-play run).
- **D4-A4** Measured: `determinise()` gets materially faster on the same fixture (expect ~2x from the
  numbers above), and a `selfplay --p0 ismcts:200` run is faster end to end. Report both, and report the
  win-rate check below even if the timing improves.
- **D4-A5** Strength is unchanged: the search does the same work, so the mirror tournament must land within
  noise of 78.3 %. A change in win rate means the search is no longer doing what it did, which would be a
  defect and not a bonus.

Verified by mutation.

## Explicitly NOT in this rung

The 124,000 applies per decision. That is the real structural cost and no micro-optimisation touches it —
it is a question about rollout depth and what a rollout is allowed to skip, which needs its own spec and
its own strength measurements. Recording it here so the next rung has a starting point rather than a
rediscovery.
