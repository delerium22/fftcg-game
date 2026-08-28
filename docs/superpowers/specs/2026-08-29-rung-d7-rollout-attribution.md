# Rung D7 — rollout attribution counters

> **STATUS: BUILT AND MEASURED.** Diagnostic only — no policy change, no behaviour change, nothing
> shipped to the player. The result is at the bottom, and it redirects the next rung.

## Why

Rung D6 proposed a cheaper rollout policy and its plan review returned DO NOT BUILD, because the premise was
**inferred rather than measured**. The exact charge:

> `RolloutResult.applies` is `budget.used`, which includes candidate applications inside `greedyStep`,
> applications used while recursively scoring forced block, party-damage, mode and target choices,
> applications of the chosen rollout commands, and applications in the final forced-resolution tail.
> … distinguishing these requires split counters or profiling.

That is correct, and it is the blocker for every candidate policy change. We know rollouts are 98.6 % of the
search's engine work; we do not know how that 98.6 % divides. Until we do, any policy choice is a guess.

This rung buys exactly one thing: **the division**.

## What is measured

Every `apply` a rollout spends lands in exactly one of four buckets:

| bucket | where | what it is |
|---|---|---|
| `loopScoringApplies` | `greedyStep` called from the rollout loop | the loop weighing its next command |
| `resolverScoringApplies` | `greedyStep` reached through `resolveForcedDecisions` while scoring a candidate | settling a candidate enough to price it |
| `tailScoringApplies` | `greedyStep` inside the settlement call after the command cap | finishing the leaf |
| `loopAdvanceApplies` | `rolloutToCap`'s own `apply` | playing the chosen command |
| `resolverAdvanceApplies` | `resolveForcedDecisions`'s own `apply`, while scoring | answering a forced decision inside an evaluation |
| `tailAdvanceApplies` | the same, inside the settlement tail | answering one to finish the leaf |

The names are the CALL SITE, deliberately, and the first version of this got that wrong: it called them
`policy` and `forced`, which claimed more than the counters know. When a chosen command leaves a pending, the
next turn of the rollout LOOP answers that forced decision — so "policy" was never "the policy's own move".
The tail is split out for the same reason: it was folded into `forced`, which made evaluation and trajectory
impossible to separate, because the tail ADVANCES the real rollout.

Alongside, per scope: candidates GENERATED versus candidates SCORED. They differ because `within(budget)`
stops scoring after the first candidate once the apply cap binds — so "generated but not scored" is the size
of the work the existing cap already refuses.

And: how often the cap refused, and at which policy command it first did.

## Design — through `Budget`, so no signature changes

`Budget` is already threaded to every apply site that matters, so the profile rides on it:

```ts
export interface Budget { used: number; cap: number; profile?: RolloutProfile }
```

No parameter is added to `greedyStep` or `resolveForcedDecisions`. Absent by default: when `profile` is
undefined every site does one `undefined` check and nothing else, so play is unaffected.

Scope (policy versus forced) is not threaded either. `resolveForcedDecisions` increments a depth on entry and
decrements on exit; a bucket is chosen by whether the depth is zero. That keeps the whole change to the two
functions that already own those loops.

## The invariant that makes this self-checking

```
policyScoringApplies + forcedScoringApplies + policyAdvanceApplies + forcedAdvanceApplies === budget.used
```

Every apply is counted once and attributed once. This is the acceptance criterion that cannot be satisfied by
accident — a miscounted or double-counted site breaks the sum — and it is asserted on real rollouts, not on a
fixture built to satisfy it.

## What this rung is NOT

- **Not a policy change.** Nothing about which command a rollout picks changes. Asserted, not assumed.
- **Not a claim about where TIME goes.** These are `apply` counts. An apply on a wide board costs more than
  one on an empty board, so a bucket holding 60 % of applies does not necessarily hold 60 % of milliseconds.
  Any later spec must say "applies", not "cost", unless it has timed them.
- **Not a fixed-corpus replay.** The review also asked for that; it is a separate step, and this rung is the
  counters it would report.

## Acceptance

- **D7-A1** The four buckets sum exactly to `budget.used`, asserted over real rollouts from several
  positions — including at least one where the apply cap binds and one where it does not.
- **D7-A2** `generated >= scored` in both scopes, and they are UNEQUAL somewhere in the sample (otherwise the
  distinction is untested).
- **D7-A3** With no profile attached, the search returns the identical command for the same seed and root as
  at HEAD — the instrumentation is inert.
- **D7-A4** With a profile attached, the search returns the identical command too: measuring must not move
  the thing being measured.
- **D7-A5** The counters are reachable from the CLI on a normal run, so the measurement is reproducible by
  someone who did not write it. **This was CLAIMED and not met.** The subcommand was added to `main.ts`'s
  dispatch and nowhere else, so `pnpm --filter @fftcg/cli run profile` failed for want of a package script
  and the bare form collided with pnpm's own built-in `profile`. The only thing that worked was the ad-hoc
  `pnpm exec tsx src/main.ts profile` — which is precisely the someone-who-wrote-it path the criterion
  exists to rule out. Fixed 2026-08-29, with a wiring test that fails if any dispatched subcommand lacks a
  script, runs the wrong one, or is missing from the README.
- **D7-A6** Full gates green; `selfplay --games 200 --seed 1` still completes 200/200.

---

## Result

`pnpm --filter @fftcg/cli run profile --games N --seed S --iterations 200`:

| share of rollout applies | 3 games, seed 1 | 6 games, seed 11 |
|---|---|---|
| loop scoring | 7.6 % | 6.4 % |
| resolver scoring | 70.2 % | 72.4 % |
| resolver advance | 19.0 % | 18.7 % |
| loop advance | 3.0 % | 2.4 % |
| tail (scoring + advance) | 0.1 % | 0.1 % |
| **all scoring** | **77.8 %** | **78.8 %** |
| decisions | 156 | 280 |
| applies | 11,536,028 | 26,357,190 |
| mismatched decisions | 0 | 0 |

Two seeds, two run lengths, the same picture.

### What is established without inference

**Scoring candidates is 77.8–78.8 % of every apply a rollout spends.** That is a sum of measured buckets and
needs no argument.

### What follows, with the reasoning shown

Separating the settlement tail is what makes the next step defensible, and it is the reason this rung was
revised: with the tail folded in, `resolverAdvance` mixed per-candidate settling with finishing the leaf, so
"evaluation" could not be told from "trajectory". Measured apart, the tail is **0.1 %** — so essentially all
resolver work is per-candidate settling, and:

- **evaluation** (loop scoring + resolver scoring + resolver advance) = **96.8 % / 97.5 %**
- **trajectory** (loop advance + the tail) = **3.1 % / 2.5 %**

Actually playing the twelve commands of a rollout is ~3 % of its cost. Everything else is deciding what to
play.

### The per-candidate ratio, stated as what it is

Dividing totals: for each candidate the loop scored, the run spent **11.7 (seed 1) / 11.8 (seed 11) further
applies** settling it, or 12.7 / 12.8 including the candidate's own apply. Both numbers are quoted on the same
convention, which an earlier draft did not do — it mixed an inclusive figure for one seed with an exclusive
figure for the other.

This is an **aggregate ratio, not a causal measurement**. Nothing here shows that each individual candidate
caused ~12 descendants; the numerator also contains settling done for candidates scored inside the resolver.
Establishing causation needs a per-outer-candidate counter, and that is not built.

### What is still NOT known

- **Time.** These are `apply` COUNTS. An apply on a wide board with a full agenda costs more than one on an
  empty board, and settling runs on exactly the busier states — so 97 % is an upper bound on the share of
  time, not a measurement of it.
- **Causation per candidate**, as above.
- **Whether the answer is fewer candidates or cheaper settling.** Both attack the same 97 %, and this rung
  deliberately does not choose. It does settle one thing: D6's "one apply per candidate" model was false by
  more than a factor of twelve.

## Code review outcome

A Codex code review found three MAJORs and one MINOR, and all four are fixed here rather than recorded as
regrets:

1. The scopes were named for a causal story the counters did not support (`policy`/`forced`), and the
   settlement tail was mixed into per-candidate work. Renamed to the call site, tail split out.
2. The per-candidate arithmetic mixed inclusive and exclusive conventions across the two seeds, and was
   narrated causally. Restated above, on one convention, as an aggregate ratio.
3. Two tests admitted mutants: `loopAdvanceApplies === r.commands` passed with the actual state transition
   DELETED (both counters sit next to each other), and no test pinned the loop-answers-a-forced-pending
   convention — a scope check of `depth > 0 || isForcedDecision(state)` survived everything. Both now fail.
4. `firstRefusalAtCommand` was stale across rollouts sharing one profile, dating a refusal by the previous
   rollout's length. The per-rollout working state is reset at entry, with a test.
