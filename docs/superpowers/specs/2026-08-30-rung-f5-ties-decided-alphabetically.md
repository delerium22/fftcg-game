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
