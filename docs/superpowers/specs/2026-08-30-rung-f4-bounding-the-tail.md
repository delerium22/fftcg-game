# Rung F4 — bounding the tail (D3 revived)

> **STATUS: PLAN REVIEWED — revise before building.** The time box is confirmed as the right lever, but two
> CRITICALs must be fixed first; the budget as specified would never have reached the worker. Nothing built.
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

---

## Plan review: the lever is right, the plan is not. Two CRITICALs.

> **Verdict: keep the time box — do NOT replace it with a pace-only change — but do not implement this plan
> until the wire test and the strength measurement are repaired.**

### CRITICAL 1 — my blocker fix targets an object that never crosses the boundary

I proposed putting `budget` on `SearchInput` because `SearchInput` carries the "cannot carry a function"
comment. **The coordinator does not post a `SearchInput`.** It posts a bespoke `WorkerSearchRequest`
(`protocol.ts:26`), which is `{ type, requestId, view, seed, iterations }` and nothing else, and the worker
rebuilds a `SearchInput` field by field in `searchInputFor` (`protocol.ts:55`).

So a budget added to `SearchInput` is **silently dropped at the boundary**, and my F4-A1 — clone a
budget-bearing `SearchInput` — would have passed while the browser went on running all 200 iterations. Verified
by reading both, not taken on trust.

The budget has to be threaded through `SearchCoordinatorOptions`, `WorkerSearchRequest`, the coordinator's
payload, and `searchInputFor`, and **F4-A1 must clone the actual request and assert the end-to-end
translation**, not a locally constructed input.

That is the fifth spec I have written against something I had not read, and the lesson is now narrower than
"read first": I *did* read `SearchInput` and its structuredClone comment. What I did not read was the wire
itself. **The type that looks like the wire format is not the wire format.**

### CRITICAL 2 — the two measurements could describe different policies

A 500 ms budget in Node completes far more iterations than 500 ms in the emitted browser worker — especially on
the slow laptop `minIterations` exists to protect. So F4 could report good browser latency AND good CLI
strength with **neither environment having exhibited both**: the CLI runs 150 iterations and keeps 75%, while
wide browser states bottom out at the floor.

The browser already returns `diagnostics.determinisations` and the harness throws it away. Required:

- record and report the browser's per-decision ITERATION COUNT distribution beside the latency;
- and gate the deterministic `iterations = minIterations` policy against greedy as the **worst-platform
  strength floor**, which is a Node-measurable proxy for what the slowest machine actually plays.

### MAJOR — 750 ms pacing is a real competitor and must be a control arm

Pace-only is not the better *tail* lever: it does not reduce search time, worker occupation, supersession
backlog or watchdog exposure. Hiding the worst observed p95 would need ~1350 ms pacing — 23–41 extra seconds
per game across 31–54 AI moves; hiding the 2088 ms max needs 47–81 seconds.

**But a 750 ms pace costs only 4.7–8.1 seconds per game and already puts four of the five observed per-game
p95s under the beat.** So an aggressive 250–500 ms box must not be assumed better than simply pacing at 750.
F4 compares four arms: unboxed/600, unboxed/750, boxed/600, and a mild hybrid.

### MAJOR — my statistics were not decision rules

"Not worse" and "outside its CI" are not tests of a difference, and the README already says 120 games could
not distinguish a 3.3-point change. Comparing whether two intervals overlap is not a hypothesis test.

Required: a **predeclared non-inferiority margin** and a **paired** confidence interval on boxed-minus-unboxed
over identical seed pairs. As a planning guide, five points near 75% needs ~1200 games per arm unpaired;
pairing reduces that by an amount only a pilot can establish. Exact "no loss" is not provable with a finite
tournament and the spec must stop implying it is.

### MAJOR — D3-A6 is both unachievable and vacuous, and its baselines are stale

The five per-game p95s have a sample SD of ~409 ms, so five games cannot support "p95 within 1.2× of the box":
distinguishing 742 from 600 ms needs ~130 games per arm; a 400 ms box needs ~40. And a box of ≥1123 ms would
let the *unchanged* 1347 ms p95 satisfy the criterion outright.

Both carried-over baselines are also stale: D3-A6's 1351 ms was the pre-F3 broken-driver figure, and D3-A7's
78.3% is not what ships — cap 12 measures **75.0%, CI [66.7, 82.5]**. Both need a fresh same-commit same-seed
unboxed control.

Replacement: a predefined seed set, a matched unboxed control, a material *relative* reduction, and preferably
the **rate of decisions exceeding 600/750 ms** with a confidence interval — a rate is far more stable than a
per-game p95.

### MAJOR — the budget values need validating, and one of them bricks the opponent

`minIterations: 0` with an already-expired deadline runs zero iterations and throws *"no root action was ever
visited"*. In the browser that is a post failure, which the coordinator treats as worker death — **permanent
Greedy fallback for the rest of the game**, silently. `NaN`, infinities, fractions, negatives and a floor above
`iterations` are all unspecified. Require finite positive `ms`, integer `minIterations >= 1`, normally
`minIterations <= iterations`, with rejection tests.

### MAJOR — the CLI needs both fields

`--budget-ms` alone cannot reproduce F4-A2. Expose the floor too, validate both, and include both in
`describeAgentSpec`, or the report cannot name the policy that produced it.

### Confirmed sound

- The defaulted clock parameter breaks no caller; Node ≥22 has global `performance.now()`. With no budget the
  implementation should never invoke the clock at all — assert that with a throwing clock.
- `performance.now()` IS available in the emitted dedicated worker; `globalThis.performance.now()` makes it
  explicit.
- **A search finishing inside the pacing delay is safe** — it is already the common path (F3's p50 is
  133–429 ms). A result clears its watchdog then waits for `notBefore`; delivery is singular and state identity
  is re-checked, so it cannot race the fallback into two commands. The serial-worker limitation stands: a
  superseded search still delays the next one before its own budget begins.
- `minIterations` is the right primitive — each iteration backpropagates exactly one root visit, so a
  root-visit floor is equivalent. After one iteration the result is well-defined and legal (the seeded randomly
  expanded root action), just barely informed. Its VALUE is unjustified and must be calibrated by the
  floor-only strength gate above.
