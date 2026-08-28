# Rung D3 — a time-boxed search budget

## Why

Two documented numbers rotted silently between rung D1 and now, and both had the same cause.

| | at D1 | at HEAD |
|---|---|---|
| ISMCTS vs greedy, 120 mirrored games | 90.0 % | **78.3 %**, CI95 [70.8, 85.0] |
| Browser latency per decision (production preview) | p50 152 ms, p95 240 ms | **p50 454 ms, p95 1351 ms** |

Nothing regressed in the search. Rungs C5–C10 widened the card pool — removal, a deck search, a Break-Zone
retrieve, combat tricks — so each of a **fixed 200 iterations** does more work than it used to. Confirmed by
holding everything but the budget constant: over the same 20 seed pairs, `ismcts:200` scores 80.0 % and
`ismcts:600` scores 90.0 %, landing back on the pre-C5 figure.

**A fixed iteration count is the wrong control variable.** It holds WORK constant and lets responsiveness
drift. For an opponent a human sits waiting on, the invariant should be the other way round — and because
nothing re-measures these numbers, the drift is silent. That is not a one-off: every future card widens the
tree again.

## What this is NOT

It is not a strength win, and the spec should not pretend otherwise. At the measured ~2.3 ms/iteration, a
250 ms box buys ~110 iterations — **fewer** than today's 200, so it would make the AI weaker. The honest
value is:

- **The TAIL collapses.** p95 is 1351 ms because expensive states run slow iterations; a box caps them.
- **It stops rotting.** Responsiveness becomes a constant the pool cannot move.
- **Strength becomes the variable that degrades gracefully** instead of latency degrading invisibly.

So the deadline must be chosen from measurement, not taste: pick the box that keeps median strength while
cutting the tail. The likely answer is ~400–500 ms, not 250 ms.

## Design — a dual budget, not a replacement

`SearchInput` gains an OPTIONAL time box beside the existing iteration count:

```ts
readonly iterations: number            // unchanged: the hard cap, and the deterministic bound
readonly budget?: {
  readonly ms: number                  // stop starting new iterations once this elapses
  readonly now: () => number           // injected: no ambient clock inside the search
  readonly minIterations: number       // a floor, so a slow machine cannot answer from 3 iterations
}
```

Loop condition becomes `i < iterations && (i < minIterations || now() < end)`, with `end` fixed once at
entry. The deadline is checked at the TOP of an iteration, so an iteration that starts always completes —
abandoning one mid-flight would leave the tree half-updated.

### Determinism is preserved by omission

The suite pins search output for a given seed, and a wall-clock budget cannot be deterministic across
machines. Which is exactly why `budget` is **optional and absent by default**:

- Tests, the CLI, and every existing call site pass no `budget` → byte-identical behaviour to today.
- Only the browser coordinator passes one.
- `now` is injected rather than read from an ambient `performance.now()`, so a test that WANTS to exercise
  the box drives a fake clock and stays deterministic.

That is the whole determinism story: the non-deterministic path is opt-in, and nothing that asserts
determinism opts in.

### `minIterations` is not decoration

A tight box on a slow machine is the failure mode that matters: 3 iterations produces a move barely better
than random, and it would show up as "the AI plays badly on my laptop" — invisible to every gate here. The
floor is the guard, and it is deliberately checked BEFORE the clock.

## Open questions for the plan review

1. Does the box belong in `searchIsmcts`, or in the worker around it? Inside means one implementation and
   the CLI can use it too; outside keeps the search pure. I lean inside, because the worker cannot stop a
   synchronous loop it has already entered.
2. The coordinator already paces AI moves (`AI_STEP_MS`) and has a staleness/fallback path. Does a shorter,
   more variable search interact badly with either — e.g. does a fast search now finish inside the pacing
   delay and change the felt rhythm?
3. Is `performance.now()` the right clock in the worker, and is a per-iteration call cheap enough at
   ~2.3 ms/iteration? (Expected: yes, ~0.1 % overhead, but it should be stated rather than assumed.)
4. Should the CLI expose `--budget-ms` so the measurement below can be run without a code edit?

## Acceptance

- **D3-A1** With no `budget`, output is IDENTICAL to today for a fixed seed — asserted by comparing the
  chosen command across the existing seeds, not by inspection.
- **D3-A2** With a budget and a FAKE clock, the search stops at the expected iteration: a clock that jumps
  past the deadline after N iterations yields exactly N (never N±1), and the result is deterministic.
- **D3-A3** `minIterations` wins over the clock: a clock already past the deadline still runs the floor.
- **D3-A4** An iteration that has started always completes — the tree is never left half-updated.
- **D3-A5** `iterations` still caps: a budget that never expires yields exactly `iterations`.
- **D3-A6** Measured in the browser on a production preview, with the harness: p95 falls from ~1351 ms to
  within ~1.2x of the chosen box, and p50 does not rise.
- **D3-A7** Measured in the CLI: win rate against greedy is not WORSE than the current 78.3 % at the chosen
  box. If it is, the box is too small and the rung reports that rather than shipping it.

Every criterion verified by mutation.

## What would make this rung fail honestly

If D3-A7 shows the box costs strength at every latency worth having, then the finding is "the search needs
to be cheaper per iteration, not budgeted differently" — and that is a different rung (profile the rollout,
which is ~95 % of the cost). Shipping a slower-and-weaker AI to satisfy a design preference would be worse
than shipping nothing.
