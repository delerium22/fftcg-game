# Rung F2 — what the rollout actually spends

> **STATUS: SPEC, awaiting plan review.** Nothing built.
>
> Chosen by the F1 plan review, which deferred F1 (0.7% opportunity, no demonstrated win-rate effect) and
> pointed here instead: search depth improves every decision, a payment fix improves one in a hundred.

## What D7 established, and what it deliberately did not

D7 attributed every `apply` a rollout spends to one of six buckets, and the answer was stark:

| | seed 1 | seed 11 |
|---|---|---|
| evaluation (scoring + per-candidate settling) | **96.8 %** | **97.5 %** |
| trajectory (actually playing the rollout) | 3.1 % | 2.5 % |

Playing the twelve commands of a rollout is ~3% of its cost. Everything else is deciding what to play.

D7 then wrote down two things it had NOT settled, and they are this rung's whole reason:

1. **"These are apply COUNTS. An apply on a wide board with a full agenda costs more than one on an empty
   board, and settling runs on exactly the busier states — so 97% is an upper bound on the share of TIME, not
   a measurement of it."**
2. **"Whether the answer is fewer candidates or cheaper settling. Both attack the same 97%, and this rung
   deliberately does not choose."**

I have confirmed the first by reading: nothing in `apps/cli/src/profile.ts`, `packages/ai/src/greedy.ts` or
`ismcts/search.ts` calls a clock. Every number in D7 is a count.

## What this rung is

**A measurement, not an optimisation.** Its deliverable is the number that decides the next rung, and it ships
no speed-up at all. Saying that up front is deliberate: the temptation is to optimise the thing that is 70% of
applies and report the speed-up as the result, which would be optimising a proxy I have already been told is
an upper bound.

The question to answer: **is the winner fewer candidates, or cheaper settling?**

## Design, and the question I cannot settle

The six buckets come from `scopeOf(profile)` — `depth > 0 ? 'resolver' : inTail ? 'tail' : 'loop'` — computed
from working state at each apply (`greedy.ts:92`). Time can hang off the same seam. Where to put the clock is
the real decision:

- **Per apply.** Directly comparable to D7's counts, one bucket each. But seed 11 ran **26.4 million applies**,
  so this is ~53 million `performance.now()` calls — plausibly a second of pure instrumentation, and worse, the
  overhead lands proportionally on the bucket with the most applies, biasing the very comparison being made.
- **Per `greedyStep`.** Roughly a twelfth of the timer calls, still attributable by scope.
- **Per candidate scored.** `loopScored` / `resolverScored` / `tailScored` already count these; one timer per
  candidate is the coarsest that still answers "scoring versus settling".

**I lean to per-candidate**, on the grounds that the question is about candidates and the observer effect
scales with timer count. But this is exactly the kind of judgement the last four plan reviews have overturned,
and there is a real argument that only per-apply is comparable with D7 at all.

**The observer effect has to be bounded, not assumed.** Whatever the seam, the same corpus must be run with
instrumentation off and on, and the difference reported. A measurement whose own cost is unmeasured is not
evidence — which is the F1 lesson restated: I quoted "mean 5.1, max 40" as a performance argument when it
counted results rather than work.

## Corpus

The same as D7 — 3 games seed 1, 6 games seed 11, `--iterations 200` — so the time shares can be set beside
D7's apply shares directly rather than being a second, incomparable experiment.

## Acceptance

Each names the guard that stops it passing vacuously.

- **F2-A1** Time is attributed to the same six scopes as the applies, and the six times sum to the measured
  total within a stated tolerance. Guard: assert the identity, as D7 asserts `profiledApplies === rolloutApplies`
  — an attribution that does not sum is not an attribution.
- **F2-A2** Instrumentation overhead is measured, not assumed: the same corpus with timing off and on, both
  numbers in the spec. Guard: if the overhead exceeds the difference between the two hypotheses being
  distinguished, the measurement does not settle anything and the spec must say so rather than report a winner.
- **F2-A3** The result explicitly compares time share against D7's apply share per bucket, and states whether
  D7's upper-bound caveat was material. Guard: report it whichever way it comes out — including the outcome
  where time share ≈ apply share and D7's proxy was fine all along, which is a real result and not a failure.
- **F2-A4** A stated answer to "fewer candidates or cheaper settling", with the number that supports it, or an
  explicit statement that the measurement does not separate them. **No optimisation is in scope**, so this
  rung cannot be judged by a speed-up.
- **F2-A5** Mutations: attribute every time to one bucket; time the wrong side of the call; drop the tail
  bucket. Each must fail a test.
- **F2-A6** Existing tests pass unedited, and the existing apply-count identity keeps holding — the timing must
  not perturb the counts D7 pinned.

## Explicitly not in scope

- Any speed-up. The next rung optimises what this one measures.
- Changing candidate generation, rollout policy, or the command cap.
- Browser p95. It is the right eventual gate, but a browser measurement on top of an unvalidated instrument
  measures two unknowns at once.
