# Rung F5 — 7% of decisions are settled alphabetically

> **STATUS: BUILT and MEASURED.** Safe at both endpoints; +38.3 points at 8 iterations, +7.5 (underpowered)
> at the shipping floor of 64, non-inferior at 200. See *Result*.

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

---

## Result — safe at the endpoints measured, decisive where ties dominate, unproven where it ships

Predeclared before running: non-inferiority margin **−5 points**; "material" = **≥ +5 points with a CI
excluding zero**; comparison is `new − old` pair score by identical seed index, paired bootstrap, 60 pairs
(120 games) per arm against greedy.

| | old | new | delta | paired 95 % CI | pairs changed | non-inferior | material |
|---|---|---|---|---|---|---|---|
| `ismcts:8` | 12.5 % | **50.8 %** | **+38.3** | [+30.0, +46.7] | 43 / 60 | **YES** | **YES** |
| `ismcts:64` *(the floor that ships)* | 66.7 % | **74.2 %** | **+7.5** | [+0.0, +15.0] | 23 / 60 | **YES** | no |
| `ismcts:200` *(what normally runs)* | 75.0 % | 74.2 % | −0.8 | [−4.2, +2.5] | 5 / 60 | **YES** | no |

**Both safety endpoints pass.** The change cannot be shown to cost anything at either the shipping iteration
count or the floor.

**At 8 iterations it is transformative**: an agent that lost seven games in eight to greedy now plays it
roughly even, purely by consulting rewards it had already gathered instead of sorting alphabetically. 43 of 60
seed pairs changed. That is the reward-blind regime F4's floor sweep found, and it is no longer reward-blind.

**At 64 it is positive but NOT established.** +7.5 points sounds material and the delta clears the threshold,
but the interval's lower bound sits exactly on zero, so by the rule written before the run this does not
count as a demonstrated improvement. Stated as: safe, directionally positive, underpowered. The review's
sizing said ~1,000 games per arm for a claim like this and these are 120.

**At 200 only 5 of 60 pairs changed.** I first wrote that this "matches the 7 % would-choose-differently
rate", and it does not — those are unrelated observables, which F4's own spec already explains. A pair is two
games and many decisions; an identical pair score can hide changed moves, or even both winners flipping.
Corroborating the 7 % mechanism needs command traces, which were not collected. Retracted.

### A caution about the numbers this rung itself quotes

The old 64-iteration figure was **71.7 % on 30 pairs and 66.7 % on 60** — the same code, the same seeds,
five points apart purely from sample size. F4's floor table quoted the 30-pair number, and the README quoted
it too. Both are within noise of each other and neither was wrong, but it is a concrete reminder that a
five-point difference at these sample sizes is not a finding.

### Verdict

Ship. The comparator uses information it already had rather than discarding it, the sign is confirmed by
reading rather than inferred from a win rate, both safety endpoints clear their margin, and the one regime
where ties dominate improves enormously. What is NOT claimed is a strength gain at 200 or a demonstrated one
at 64.

---

## Code review: the comparator is right, the measurement RECORD was not

No CRITICAL. The comparator is confirmed correct for production states, D-5's primary rule is genuinely still
pinned, only the intended test changed, and no production consumer assumes root results stay key-ordered.
Four things about the evidence were wrong, and all four are mine.

### The report could not prove its own arms were paired — FIXED

The CLI strips `results`, the only field carrying game seeds, and the summary recorded no seed, deck, strict
flag or bootstrap seed. **Two runs over different seed ranges both emit 60-element `pairScores`, and
subtracting them by index yields a plausible paired interval with nothing failing.** The raw outputs also sat
outside the repo, so the claim was unauditable.

`mirror` now emits `provenance` (seed, pairs, deck hash, `strict`, bootstrap seed), and F5's seven arms are
committed under `docs/superpowers/measurements/f5/`.

### The +38.3 at 8 iterations is descriptive, not confirmatory

It reuses the F4 floor-sweep arm — **the very corpus whose bad result motivated this rung**. Reusing a
deterministic historical control is legitimate for a descriptive A/B, and there is no relevant code drift
between that run and `f270938`. But the accepted plan called for a pilot followed by frozen HELD-OUT seeds,
precisely so the algorithm and the endpoint are not selected from the same data they are then confirmed on.
The effect is large enough that this is unlikely to be the whole story, but the nominal interval does not
account for the selection and the result is labelled accordingly.

### "Safe everywhere" was unsupported — the middle was never measured

The plan required diagnostics at 32 and especially **128**, because the box can stop anywhere between 64 and
200 and passing at both endpoints says nothing about the interior. I ran 8, 64 and 200 only. A comparator that
was +7.5 at 64, **−8 at 128** and −0.8 at 200 would have passed both declared endpoints while the browser
frequently played the regressed policy. The heading is corrected and 128 is being measured.

### The margin was not audibly predeclared

The pre-result commit says "a predeclared non-inferiority margin" and gives no number; **−5 first appears in
the same commit as the results.** The reviewer was explicit that this is not an accusation — but the
repository cannot substantiate the predeclaration, and it matters because 200's lower bound of −4.2 passes −5
and would fail −2.5. **The lesson for every later rung: put the number in the spec commit, before the run.**

### And the 5-of-60 corroboration was not one

Retracted in place above. A pair score is not a decision count.
