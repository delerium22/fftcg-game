# Rung F4 — bounding the tail (D3 revived)

> **STATUS: SPEC, awaiting plan review.** Nothing built.
>
> This is not a new design. **D3 already specified it correctly** — a dual budget, iterations plus an optional
> time box. It was deferred, and this spec exists to say what has changed, fix the blocker its review found,
> and be honest about the one objection that still stands. Read
> `2026-08-28-rung-d3-time-boxed-search.md` first; its design section is the design.

## What changed since D3 was deferred

D3's review gave three reasons. One is now answered by measurement, one is fixable, one still stands.

**1. "The median is already paced" — still true, and no longer the point.** `AI_STEP_MS` is 600 ms and the
coordinator holds an early result until then, so a box buys nothing at the median. D3 was deferred partly on
that. But the median was never the complaint; the tail was, and it was unmeasured.

**F3 has now measured it, on a corrected instrument** — the harness had been driving the human seat with the
first hand card, usually an uncastable 7-cost, so every previous figure came from a game where one side never
played:

| | |
|---|---|
| p95, five finished games | **192–1347 ms** |
| worst single decision | **2088 ms** |
| pacing floor (`AI_STEP_MS`) | 600 ms |

So roughly one decision in twenty is visibly past the beat, and the worst ran **1.5 seconds past it**. That is
the case D3 lacked.

**2. The blocker is real and the fix is already the house pattern.** `budget.now` as a function would throw at
`postMessage` — `SearchInput` crosses the worker boundary by `structuredClone` — and the coordinator treats a
post failure as worker death, permanently downgrading the opponent to the heuristic agent for the rest of the
game. Silent, and invisible to every gate.

`SearchInput` already solved this once. `profile?: boolean` carries the comment:

> A plain boolean because `SearchInput` crosses the worker boundary by `structuredClone`, which cannot carry a
> function.

So: **`budget?: { ms: number; minIterations: number }` — plain data on the wire — and the clock as a separate
parameter of `searchIsmcts`, defaulted, never part of the message.** Tests drive a fake clock through the
parameter and stay deterministic; nothing cloneable changes.

**3. Superseding does not cancel, and this rung does NOT fix that.** The worker handles messages serially and
stays inside a synchronous search until it returns, so a replacement request waits out the stale search plus
its own. A box makes that shorter but not bounded. **Real cancellation needs the search chunked across turns
of the event loop, which is a much larger rung.** This one must not claim a bound it does not deliver.

## The trade this makes, stated before it is measured

A box does not make the AI faster; it makes it **weaker on exactly the positions it was slowest on**. Today
every decision gets 200 iterations however long that takes. Under a box, a wide board gets however many fit.

D3 estimated ~6.8 ms/iteration at p95 states, so a 250 ms box buys ~37 iterations there against today's 200 —
a five-fold cut on the hardest positions. That estimate predates D5 halving the rollout command cap, so it
must be re-measured rather than reused.

**This is why the rung ships nothing until both numbers are in.** Latency alone would make a 50 ms box look
like a triumph.

## Design

D3's, unchanged, with the blocker fix:

```ts
readonly iterations: number                              // unchanged: the hard cap
readonly budget?: { ms: number; minIterations: number }  // DATA only — cloneable
```

`searchIsmcts(input, now = () => performance.now())`. Loop condition
`i < iterations && (i < minIterations || now() < end)`, `end` fixed once at entry, deadline checked at the TOP
of an iteration so a started iteration always completes — abandoning one mid-flight leaves the tree
half-updated.

Absent by default, so the CLI, the tests and every existing call site are byte-identical to today. Only the
browser coordinator passes one. `minIterations` is the floor that stops a slow machine answering from three
iterations — the failure that would show up as "the AI plays badly on my laptop" and appear in no gate here.

## Acceptance

D3-A1 … D3-A7 carry over verbatim; they are good criteria and were never the reason it was deferred. Added:

- **F4-A1** *(the blocker, pinned)* A `SearchInput` carrying a budget survives `structuredClone` — asserted by
  cloning it, not by inspection. Falsifier: put a function on the budget and this test must fail.
- **F4-A2** *(the trade, measured both ways)* The chosen box is reported with BOTH its browser p95 and its win
  rate against greedy over the standard 120 mirrored games. Falsifier: quoting the latency without the strength
  number is a criterion violation, not an omission — and if strength drops outside its CI, the rung reports the
  box as too small rather than shipping it.
- **F4-A3** *(what it does not do)* The spec and the README state that a box shortens but does not bound the
  tail, because superseding does not cancel. Falsifier: any claim of a hard bound.
- **F4-A4** Re-measure ms/iteration at wide states before choosing the box. D3's ~6.8 ms predates D5.

## Open questions for the plan review

1. **Is the box even the right lever, given the pacing floor?** An alternative: leave the search alone and
   raise `AI_STEP_MS` to swallow the tail. That is worse for the median (every move waits longer) but costs no
   strength at all. I have not costed it and it may be the better trade.
2. Where does the deadline live — inside `searchIsmcts` (one implementation, CLI can use it) or in the worker
   around it? D3 leaned inside because the worker cannot stop a synchronous loop it has entered. I agree, but
   it means the search is no longer a pure function of its input.
3. Does a faster search interact badly with the coordinator's staleness and fallback paths — in particular,
   can a search that now finishes INSIDE the pacing delay change the felt rhythm, or race the fallback?
4. Should the CLI expose `--budget-ms`, so F4-A2's two measurements can be run without a code edit?
5. Is `minIterations` the right floor, or should it be a floor on the ROOT's visit count, which is what
   actually determines whether the answer is better than random?
