# Rung D3 — a time-boxed search budget

> **STATUS: DEFERRED after its plan review, in favour of making the rollout cheaper.** Not implemented.
> The review found a blocker, and then found that the rung's premise does not hold. Both are recorded
> below, under *Plan review outcome*, because the reasoning is the useful part — the design here is still
> the right shape if this is revisited once the per-iteration cost is understood.

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

## Plan review outcome — why this is deferred

A Codex plan review returned sixteen findings. Three of them, together, say the rung should not be built yet.

**1. A blocker, and a nasty one.** `SearchInput` crosses the worker boundary by `structuredClone`, and
functions are not cloneable — so `budget.now` as designed would THROW at `postMessage`. The coordinator
treats a post failure as worker death and permanently falls back to the heuristic agent. The design as
written would have silently downgraded the opponent for the whole game. Fixable (send `{ ms, minIterations }`
as data, let the worker inject its own clock after deserialisation), but it is the kind of thing that only
a reader who knows the worker boundary catches.

**2. The premise does not hold: the median is ALREADY paced.** `AI_STEP_MS` is 600 ms and the coordinator
holds an early result until `startedAt + stepMs`, so today's 454 ms median decision is already presented to
the player at 600 ms. A smaller box therefore buys nothing at the median — it only removes decisions that
exceed 600 ms. Verified in the code, not taken on trust.

**3. And the tail it would fix is not reliably bounded anyway.** Superseding a request does not cancel its
search: the worker handles messages serially and stays inside the old synchronous call until it finishes,
so a replacement waits out the stale budget plus its own. A box makes that better but not bounded, and real
cancellation means chunking the search — a much bigger change than this rung.

The review also showed the framing overclaimed. It is a SOFT deadline (`minIterations` overrides the clock,
and the final iteration overruns by its own duration), so "caps the tail" and "responsiveness becomes a
constant" were both wrong. And the arithmetic only held at the median: at p95 states an iteration costs
~6.8 ms, not ~2.3 ms, so a 250 ms box buys ~37 iterations there — not 110. Those are exactly the complex
positions where iterations matter most.

## What to do instead

**Make the rollout cheaper.** Measured over the 120-game tournament, the split of engine work is:

| | applies |
|---|---|
| rollout | 770,764,747 |
| tree | 4,869,498 |

**99.4 % of the engine work in a search is rollout**, at ~124,000 `apply` calls per decision. That is the
number to attack, and attacking it beats budgeting it on every axis: it improves latency AND strength
together, needs no worker-protocol change, costs no determinism, and adds no CLI surface. A budget only
ever trades one against the other.

That makes the next rung a measurement rung, not a feature: profile where rollout time actually goes
(`settle`, `evaluate`, `candidateCommands`, allocation), and only then decide whether the answer is a
cheaper rollout, a shallower one, or — still — a budget.

This is the failure mode the section below predicted, arriving from a review rather than from a benchmark:
shipping a slower AND weaker opponent to satisfy a design preference would be worse than shipping nothing.

## What would make this rung fail honestly

If D3-A7 shows the box costs strength at every latency worth having, then the finding is "the search needs
to be cheaper per iteration, not budgeted differently" — and that is a different rung (profile the rollout,
which is ~95 % of the cost). Shipping a slower-and-weaker AI to satisfy a design preference would be worse
than shipping nothing.
