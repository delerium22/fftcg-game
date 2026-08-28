# Rung D6 — a cheap rollout policy

> **STATUS: NOT BUILT — the plan review returned DO NOT BUILD, and it was right.** The spec is kept whole,
> mistakes included, because the reasoning is the useful part (the same treatment `rung-d3-time-boxed-search`
> got). What survives is the goal — a cheaper rollout — and what dies is this way of getting there. Read
> *Plan review outcome* at the bottom before reading anything above it as fact: the central attribution
> claim in "Why" is NOT established, and the design in "What this rung is" would not have worked.

## Why

The search spends essentially all of its engine work in rollouts, and essentially all of THAT on a rollout
policy that is far more expensive than a rollout policy should be.

Measured at HEAD (`4777051`), `mirror --a ismcts --b greedy --pairs 2 --iterations 200`:

| | applies |
|---|---|
| rollout | 12,737,210 |
| tree | 179,897 |

**98.6 % of engine work is rollout**, ~59,500 `apply` calls per decision. That reproduces the figure rung D3
recorded (99.4 %) on a different sample, so it is a property of the design and not of one run.

### Where inside the rollout it goes

`rolloutToCap` walks up to `cap` (12) commands. Each step is:

```
const c = greedyStep(s, p, weights, ROLLOUT_AGGRESSION, budget)   // applies EVERY candidate to score it
s = apply(s, c).state                                             // one more to advance
```

So one rollout step costs `candidates + 1` applies. `greedyStep`'s docblock says so plainly — *"Score every
legal command for `player` and return the best one"* — and `search.ts` already names the consequence:
*"Every `apply` the rollout spent, `greedyStep`'s own candidate scoring included. The real cost number."*

`pruneCandidates` exists in `greedy.ts` and would bound this, but it is applied only in `GreedyAgent.decide`
— the TOP-LEVEL agent. Rollouts are unbounded.

Sampled directly (25 rollouts per position, real game, seed 5):

| position | applies per rollout | applies per rollout COMMAND |
|---|---|---|
| turn 7 | 116 | 9.7 |
| turn 9 | **1,292** | **129.2** |

A single decision at the turn-9 width costs ~258,000 applies at 200 iterations. This is the same shape as
the browser tail D3 measured — p50 454 ms against p95 1351 ms — and it explains it: the p95 states are the
wide ones, where every one of ~130 candidates is applied, scored and thrown away, twelve times per rollout,
two hundred times per decision.

**A rollout is supposed to be cheap.** This is the one-ply search a rollout exists to avoid, run at every
step of it. Forge and the Hearthstone simulators use lightweight playout policies for exactly this reason.

## What this rung is

Give the ROLLOUT policy a candidate cap. `greedyStep` gains an optional bound on how many candidates it
scores; `rolloutToCap` passes it; nothing else changes.

```ts
export function greedyStep(
  state: GameState, player: PlayerId, weights: Weights, aggression: number,
  budget?: Budget, sample?: number,     // NEW: score at most `sample` candidates
): Command | null
```

Candidate order is already deterministic (`candidateCommands`), so taking the first `sample` keeps the search
reproducible for a seed — no RNG is introduced, and the existing seed-pinned tests keep their meaning.

`pruneCandidates` is reused rather than reimplemented: it already keeps `pass` when it truncates, which
matters because `pass` is often the correct rollout move and sorts late.

### Why this beats a time box (which D3 rejected)

A budget trades latency against strength. This buys BOTH: the same wall-clock affords more iterations, and
each iteration is unchanged in kind. No worker-protocol change, no determinism cost, no new CLI surface.

## What this is NOT

- Not a change to the tree policy. Only play past the frontier gets cheaper.
- Not a claim that a smaller sample is free. A rollout that considers 4 of 130 candidates plays worse, and
  the whole question is whether the extra iterations it buys are worth more than the fidelity it loses.
  **That is an empirical question and this spec does not pre-judge it.**
- Not a fix for the uncancelled stale search D3 found (a superseded request still runs to completion). That
  remains open.

## How it is decided

One knob, measured, at a FIXED iteration count first (isolating fidelity from budget) and then at a fixed
time (which is what a player experiences).

| run | what it answers |
|---|---|
| `sample ∈ {2, 4, 8, 16, ∞}` vs greedy, 60 pairs, 200 iterations | what fidelity costs, budget held constant |
| the same, ms/decision | what fidelity buys back |
| best two, re-run at matched wall-clock | the honest comparison |

Ship the `sample` that wins at matched wall-clock. If none beats `∞`, **ship nothing and record it** — the
same discipline that deferred D3.

## Acceptance

- **D6-A1** `greedyStep` with `sample` scores at most that many candidates, verified by counting applies —
  not by trusting the parameter.
- **D6-A2** `pass` survives truncation (via `pruneCandidates`), asserted on a position where `pass` sorts
  outside the sample.
- **D6-A3** The top-level `GreedyAgent` is unchanged: same command for the same seed and state as at HEAD.
- **D6-A4** Determinism holds: the same seed and root produce the same search result, sample or not.
- **D6-A5** The full gates stay green, and `selfplay --games 200 --seed 1` still completes 200/200.
- **D6-A6** The measurement table above is filled in with real numbers, including the losing rows.

---

## Plan review outcome — why this is not built

A Codex plan review found three CRITICALs. Each is checkable and each is correct.

**1. The attribution is asserted, not measured.** The 98.6 % figure is arithmetic on real counters and holds
up. What does NOT hold up is the inference from it. `RolloutResult.applies` is `budget.used`, which lumps
together candidate scoring, the recursive scoring of forced block / party-damage / mode / target choices, the
advancement of chosen commands, and the final settlement tail. So "98.6 % is rollout" does not establish
"most of the rollout is candidate scoring", which is the thing this rung is built on.

Worse, the formula in *Where inside the rollout it goes* — `candidates + 1` applies per step — **is false**.
`greedyStep` resolves any forced decision a candidate opens BEFORE evaluating it, so one candidate can cost
many applies. And the turn-9 row conflates an apply count with a candidate width: `1,292 / 129.2 = 10`, so
that sample averaged ten rollout commands, not the twelve the cap allows. It does not show ~130 candidates
being scored twelve times. **The spec presented an arithmetic identity as a profile.**

**2. The design would not have capped what it claimed to.** `rolloutToCap` passes `sample` to its own
`greedyStep` call — but `greedyStep` calls `resolveForcedDecisions`, which calls `greedyStep` again with no
such parameter, and the final forced-resolution tail is a second uncapped entry point. A literal
implementation would cap the outer decision and leave the nested block, party-damage, target and mode
scoring — precisely the paths that make one nominal candidate cost several applies — untouched.

**3. Taking the first K candidates is biased, not merely lower-fidelity.** `candidateCommands` orders by
construction, not by strength: main phase is legal casts in HAND order, then every activation, then `pass`;
attack declaration is field/bit-mask order, so with more than six eligible Forwards every single attack sorts
before every party; blocking is no-block first, then blockers in field order. At K = 2 the policy compares
the first legal cast against passing and never sees an activation or a party attack. Only target and mode
choices are genuinely best-first ranked.

The spec also claimed the order is deterministic in a way that makes truncation safe. It is reproducible for
a fixed seed, but it is **not stable across determinisations**: the opponent's hand and deck are rebuilt on
every determinisation, so its cast prefix changes with the sampled world.

### And the experiment could not have answered its own question

Sixty pairs gave CI95 [66.7, 82.5] — a ~16-point interval. That can catch a collapse; it cannot separate the
2–5 point differences the five arms would plausibly show. Distinguishing a 5-point difference needs roughly
600 pairs per arm. Picking the best of five noisy point estimates is winner's curse, not a result.

`D6-A6` — "the measurement table is filled in with real numbers" — **cannot fail**, which is the same defect
this project treats as a defect in a test. An acceptance criterion has to name the threshold before the run.

## What to do instead

Do the attribution properly first, because nothing above can be decided without it:

- Split the rollout counter into candidates GENERATED, candidates SCORED, applies spent on direct scoring,
  applies spent inside forced resolution, and applies spent advancing.
- Record where the apply cap first binds, and how often it binds at all.
- Replay a fixed corpus of wide states rather than averaging over whatever positions each policy reaches.

Only then choose a policy, and if a cap is still the answer, make it "K substantive candidates PLUS pass",
stratified by move class so activations and party attacks stay reachable — not a prefix.
