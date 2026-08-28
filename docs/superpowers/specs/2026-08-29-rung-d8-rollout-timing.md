# Rung D8 — time the rollout, don't just count it

> **STATUS: NOT BUILT — the plan review returned DO NOT BUILD, and it was right.** Kept whole, mistakes
> included, like D3 and D6 before it. The design measures a real thing; it just cannot answer the question
> it was written to answer. Read *Plan review outcome* before treating anything above it as a plan.

## Why

Rung D7 established, over two seeds, that **scoring candidates is 77.8–78.8 % of every `apply` a rollout
spends**, and that with the settlement tail separated, evaluation is ~97 % and playing the rollout's twelve
commands is ~3 %.

D7 also said plainly what it could not say:

> These are `apply` COUNTS. An apply on a wide board with a full agenda costs more than one on an empty
> board, and settling runs on exactly the busier states — so 97 % is an upper bound on the share of time, not
> a measurement of it.

That caveat is load-bearing, and it is the reason no policy has been chosen. The two candidate levers —
score fewer candidates (rung D6's idea) versus settle each candidate more cheaply — both attack the same
applies, so counts alone cannot rank them. **A millisecond is the unit a player experiences.**

## What is measured

Three timers, at the rollout's own seams, NOT per apply:

| timer | wraps | question it answers |
|---|---|---|
| `evalNs` | each `greedyStep` call from the rollout loop | how long deciding the next command takes |
| `advanceNs` | the loop's own `apply` of the chosen command | how long playing it takes |
| `tailNs` | the settlement call after the command cap | how long finishing the leaf takes |

Three timers per rollout COMMAND, not per apply. At a measured ~3 µs per apply and ~25 ns per
`performance.now()`, per-apply timing would add ~1.7 % overhead and thousands of call sites; per-command
timing adds ~0.15 % and three. Since `greedyStep` contains the whole per-candidate settling recursion,
`evalNs` is exactly the evaluation time D7 could only bound.

**The remainder is reported, not hidden.** `evalNs + advanceNs + tailNs` will not equal the wall time of
`rolloutToCap`, because loop overhead and `leafReward` sit outside all three. The gap is measured and printed
as `unattributedNs`; a large one invalidates the split and must be visible rather than silently absorbed.

## A fixed corpus, because averaging over a game is not a measurement

D7 averaged over whatever positions the search reached. Wide states are both the expensive ones and the rare
ones, so an average hides exactly the case that matters. D8 captures a **fixed corpus**: states pulled from a
seeded game at chosen turn boundaries, replayed identically for every measurement, and reported per state —
never pooled into one mean.

Each state is measured over repeated rollouts with a warm-up discarded, and reported as median and p95, not
mean: this is a JIT with a garbage collector, and a mean over a bimodal distribution is a number that
describes nothing.

## What this rung is NOT

- **Not a policy change.** Nothing about which command a rollout picks changes. Asserted, not assumed.
- **Not a browser measurement.** These are Node timings on one machine. They rank the two levers against
  each other; they do not predict the browser's p95, which has its own harness (`measure-worker.js`).
- **Not a claim that time and applies are proportional.** If they turn out proportional, that is a RESULT,
  and D7's 97 % becomes a time figure rather than a bound. If they do not, that is a more interesting result.

## Acceptance

- **D8-A1** With timing off, the search returns the identical command for the same seed and root, and
  `evalNs`/`advanceNs`/`tailNs` are absent — the instrumentation is inert.
- **D8-A2** With timing on, the command is identical too: measuring must not move what is measured.
- **D8-A3** `unattributedNs` is reported for every run and is a stated fraction of the whole, so the split
  can be judged rather than trusted. If it exceeds 10 % the rung says so instead of quoting shares.
- **D8-A4** Each timer is non-zero on a state that exercises it, and `tailNs` is zero on a rollout that ends
  settled — pinned by a fixture, not assumed.
- **D8-A5** The corpus is reproducible: the same seed and turn boundaries yield the same states, asserted by
  a digest, so a later run measures the same thing.
- **D8-A6** Results are reported per corpus state as median and p95 over repeats, with the repeat count and
  the discarded warm-up stated. No pooled mean.
- **D8-A7** Full gates green; `selfplay --games 200 --seed 1` still completes 200/200.

## What decides the next rung

If evaluation dominates TIME as it dominates applies, the lever is candidate count or settling cost, and the
per-state numbers say which — a state where settling is a large multiple of the candidate's own apply argues
for cheaper settling; one where the candidate count is the whole story argues for D6's direction, with its
bias problems still to solve. If evaluation does NOT dominate time, both levers are wrong and this rung has
saved building the wrong one, which is the same service D6's plan review performed.

---

## Plan review outcome — why this is not built

**One CRITICAL, and it is fatal to the purpose.** The two levers this rung exists to rank — score fewer
candidates, versus settle each candidate more cheaply — both live INSIDE `greedyStep`. Wrapping it measures
candidate generation, every candidate's `apply`, `apply`'s internal `settle`, the recursive forced
resolution and every heuristic `evaluate`, all in one number. Cutting candidate count and cutting settlement
cost both reduce `evalNs` by the same mechanism, and nothing observes which. As the review put it: a mutant
that makes settlement ten times slower and one that generates ten times more candidates can produce the same
`evalNs`. The experiment cannot tell them apart.

The spec's own closing section — "the per-state numbers say which" — then falls back on D7's apply ratios to
break the tie, which reinstates exactly the caveat D8 was written to remove. Per-state correlation is not
causation.

**And a deeper objection that outlives the design.** "Cheaper settlement" is not yet a concrete lever — it is
a hope that one exists. No timing table can rank an unspecified optimisation against a specified one, so this
measurement could not have produced a decision no matter how it was instrumented.

Three MAJORs beyond that, each true:

- `evalNs` is named too strongly: it is `decisionNs`, how long choosing a command takes. Meanwhile
  `leafReward` calls `evaluate` OUTSIDE all three timers, so the design excludes a real evaluation while
  claiming to measure evaluation.
- D8-A4 contradicts the code: `rolloutToCap` calls `resolveForcedDecisions` for every non-terminal leaf, so
  a timer around it is positive even when it returns immediately. "tailNs is zero when settled" is not a
  property the code has.
- The corpus was underspecified, and worse, wrong in kind: replaying turn-boundary states bypasses the
  determinised frontier states, combat prompts and ability prompts that rollouts actually start from.

**And, for the fourth review running, my acceptance criteria admitted the "fill in the table" mutant.**
D8-A3 passes if `unattributedNs` is hard-coded to zero; D8-A5 passes with a constant digest compared against
itself; D8-A6 passes if median and p95 are copied from the same number. A criterion that a stub satisfies is
not a criterion. This keeps happening in the same place — the reporting criteria — and the fix is the same
each time: name the threshold and the falsifier before the run.

One thing the review CONFIRMED, worth keeping: Node's clock is adequate here — ~15–19 ns per
`performance.now()` and a minimum positive tick around 41 ns, against ~100 µs decision phases. The clock was
never the problem. The seams were.

## What to do instead

Not another rung of my own devising. Two things the review named, in order:

1. **Time mutually exclusive INTERNAL seams, or CPU-profile a fixed corpus** — `candidateCommands`, the
   candidate `apply`, `settle`, `evaluate`, the advance, the tail, `leafReward`. Those nest without
   overlapping, so they decompose the cost instead of pooling it. This is the only shape that could identify
   a concrete settlement optimisation, which is the missing prerequisite for ranking anything.
2. **Confirm any winner in the browser**, with the committed `apps/web/scripts/measure-worker.js` harness
   against a production preview — because the number a player feels is a browser p95, not a Node median.

Step 2 is worth doing on its own account and immediately: the README's browser latency figures are both
stale and internally inconsistent, and the harness to settle them already exists.
