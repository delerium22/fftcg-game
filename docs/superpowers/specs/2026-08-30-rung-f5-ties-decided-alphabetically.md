# Rung F5 — 7% of decisions are settled alphabetically

> **STATUS: SPEC, awaiting plan review.** Nothing built. Measured first, because the last rung shipped a value
> its own review had told me to measure.

## The finding

`rankRootEdges` picks the root action with the most visits, and breaks ties on the canonical key:

```ts
edges.filter((e) => e.visits > 0).sort((a, b) => b.visits - a.visits || compareKeys(a.key, b.key))
```

`compareKeys` is a total order over action keys — it exists for determinism (D-8) and is arbitrary with
respect to quality. So whenever the top group ties on visits, the answer is whichever tied action sorts first,
and the mean reward each of them accumulated is discarded.

**Measured over 230 real decisions across three seeded games, per iteration count:**

| iterations | top group ties | every edge at 1 visit | a value tie-break would choose DIFFERENTLY |
|---:|---:|---:|---:|
| 8 | 90.9 % | 1.7 % | **52.2 %** |
| 16 | 43.5 % | 0.0 % | 27.4 % |
| 32 | 47.8 % | 0.0 % | 23.5 % |
| 64 | 20.9 % | 0.0 % | 11.7 % |
| **200** (ships) | **11.7 %** | 0.0 % | **7.0 %** |

### This corrects what I wrote in F4

Closing F4 I described the failure as "every root edge has one visit, so all rewards are discarded". That case
is real but **rare — 1.7 % even at 8 iterations**. The actual finding is broader and worse: the top group ties
at *every* iteration count, including the one that ships, and **7 % of live decisions are currently settled by
key order** with reward information sitting unused.

## Why this is not obviously a win

D1 specified the final root choice as **highest visit count**, deliberately, and `rankRootEdges` carries the
reasoning:

> most VISITS, never best mean. The visit count is the robust statistic — an edge with three visits and a mean
> of 0.99 was lucky, not good, and picking by mean makes the search's answer a hostage to whichever rollout
> happened to find a win first.

That argument is correct and this rung must not overturn it. The proposal is narrower: **among edges with
EQUAL visits**, prefer the higher mean, then fall back to the key. Where visit counts differ, nothing changes —
so the "lucky three-visit edge" it warns about still loses to a better-sampled one.

Equal visits means equally sampled, so the luck objection does not apply to the comparison being added. But
that is an argument, and arguments have lost to measurement repeatedly here, so it is measured.

## Design

```ts
edges.filter((e) => e.visits > 0)
  .sort((a, b) => b.visits - a.visits || meanOf(b) - meanOf(a) || compareKeys(a.key, b.key))
```

Determinism is preserved: the key remains the final tie-break, so equal visits AND equal means still resolve
totally and identically across machines. Nothing about the wire, the worker or the budget is touched.

**Open: whose mean?** Root edges are scored from the root player's perspective, but `evaluate` is
actor-aware (D-5 negates at opponent-controlled nodes). The plan review should confirm that the value stored
on a ROOT edge is already root-relative, because if it is not, this change would prefer the action that is
worst for the searcher — a sign-error that a win-rate measurement would catch only as "it got worse", with no
indication why.

## Acceptance

- **F5-A1** Where visit counts DIFFER, the chosen action is unchanged — asserted against a hand-built tree,
  not inferred from a tournament. Falsifier: a tree whose highest-mean edge is not its most-visited one.
- **F5-A2** Where visits tie, the higher mean wins. Falsifier: swap the means and the answer must swap.
- **F5-A3** Where visits AND means tie, the key still decides, and the result is identical across repeated
  runs. Determinism is the one thing that must not regress.
- **F5-A4** Strength, measured the way F4 was: mirrored seed pairs against greedy at **8, 32, 64 and 200**
  iterations, paired against the same seeds unchanged. The effect should be largest where ties are commonest,
  so a result that improves 200 but not 8 is evidence something is wrong rather than a partial win.
  Predeclared: this ships only if 200 is non-inferior AND at least one low count improves materially.
- **F5-A5** The value on a root edge is root-relative — asserted directly, because A4 cannot tell a sign error
  from a bad idea.
- **F5-A6** Existing tests pass unedited, or any that must change are reported as findings first. `d1`'s
  determinism assertions are the ones to watch.

## Not in scope

Changing what `evaluate` returns, the exploration constant, or the visit-count primary criterion. This rung
touches one comparator.

---

## Plan review: sound comparator, sound sign, but A4 could have shipped a regression

> **Verdict: revise A4 and the measurement procedure, then build.** The comparator and the reward direction are
> both confirmed correct.

### The sign question is settled, and it was the one I could not test

The review traced it rather than asserting it: `leafReward` builds a ROOT-player reward (win 1 / loss 0 /
draw ½, or `evaluate` squashed into [0,1]), the rollout returns it unchanged, and backpropagation adds **the
same root-relative reward to every selected edge including the root edge**. Opponent awareness lives only in
selection, where opponent nodes use `1 - mean`; stored rewards are never negated.

**So a higher root-edge mean is better for the searcher. There is no sign trap.** That was the thing a win-rate
measurement could only have reported as "it got worse", so having it settled by reading is worth more than the
tournament it saves.

### CRITICAL — A4 would have approved a regression in the policy that actually ships

I wrote "200 non-inferior AND at least one low count improves materially". The browser's worst-platform policy
is specifically **64** — F4's floor — not "any low count". So this passes:

| iterations | change |
|---|---|
| 8 | **+15 points** |
| 32 | unchanged |
| 64 | **−8 points** |
| 200 | −1 point, inside a 5-point margin |

…while every move on a slow machine gets the 64-iteration regression. My rule would have shipped it.

"Non-inferior" and "materially" were also undefined — no margin, no CI direction, no confidence level, no
power, and testing "at least one of 8/32/64" at α=.05 carries up to a **14.3 % family-wise false-positive
rate**.

**A4 replaced:**

- **64 and 200 are both SAFETY endpoints**, each with a predeclared non-inferiority margin and a paired lower
  confidence bound. 64 is also the **primary efficacy endpoint**, because it is what ships.
- 8 and 32 are diagnostic, or Holm-corrected if either is allowed to satisfy the efficacy gate.
- **128 as a further diagnostic**: the box can finish anywhere between 64 and 200, and endpoint success does
  not guarantee the interval between them.
- "Material" is defined: **paired improvement ≥ 5 percentage points with a CI excluding zero**.
- Compare `new pairScore − old pairScore` **by identical seed index**. `mirror`'s `ci95` is an interval for one
  arm, NOT for the cross-arm difference, and using it as one would be the same error as comparing two
  intervals for overlap.

### MAJOR — my 7% counts changed choices, not advantage

At 200: 27 of 230 decisions had a top-visit tie, and 16 of those would change — so the mean leader differs from
the key leader in **59 % of tied decisions**. That is a real mechanism rather than the rare all-one-visit case.

But exactly-equal means do not inflate it (the key still decides), while **near-equal means do**, and I
reported no mean-gap distribution. The 230 decisions are also clustered inside only three games, so a naïve
Wilson interval of 4.3–11.0 % is optimistic.

**The 7 % justifies testing the comparator. It is not evidence of a 7 % strength opportunity**, and the spec
above should not be read as claiming otherwise.

### MINOR, all accepted

- *"Equal visits means the luck objection does not apply"* is too strong. Equal visits equalise the
  **sample-count** objection; two edges with three samples each can still have noisy means. The comparator is
  still right, because when a choice must be made between equal-visit edges the mean is the only
  quality-bearing statistic and the key has none.
- **Cross-machine determinism was overstated.** The new comparator observes floating means produced through
  `tanh`, division, logs and square roots; the key tie-break only settles EXACTLY equal means and does not
  protect a near-tie that rounds differently on another engine. The existing test proves same-runtime
  reproducibility, not cross-engine identity. The claim is narrowed accordingly.
- **F5-A6 already has a known casualty**, and naming it now is the point: `ismcts-search.test.ts:278` asserts
  that key order beats mean when visits tie — `aaa` at mean .1 is expected to beat `bbb` at .9. That test
  encodes the behaviour this rung changes and must be updated, with its insertion-order-independence and
  equal-mean-key-fallback assertions preserved separately.

### Sample sizes, which change what is practical

| comparison | games per arm |
|---|---|
| 75 % → 80 % | ~1,094 |
| non-inferiority near 71.7 % (the 64 baseline) | ~1,004 |
| 12.5 % → 17.5 % | ~800 |
| 12.5 % → 22.5 % | ~226 |
| 12.5 % → 27.5 % | ~111 |

Pairing may reduce these materially, but only a pilot's variance of the per-seed differences can say by how
much. **Procedure: pilot on separate seeds to size the variance, then freeze the confirmatory sample and use
held-out seeds.** Reusing the pilot's seeds for the confirmation is how a pilot becomes a fishing expedition.
