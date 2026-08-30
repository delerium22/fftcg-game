# Rung G1 — the seventh damage loses the game, and the AI prices it like the first

> **STATUS: NOT SOUND — restructured into G1a and G1b, and gated on a profile that has not been run.**
> Nothing built. The premise holds; the experiment tested the wrong agent and the basis tested two hypotheses.

## The finding

`material` prices the damage race linearly:

```ts
let v = (DAMAGE_TO_LOSE - ps.damageZone.length) * w.damage
```

Every point of damage is worth exactly `w.damage` (30), whichever point it is. But the seventh **ends the
game**. Going 6 → 7 is not the same event as going 0 → 1, and the evaluation cannot tell them apart.

The terminal state itself is priced (`±weights.terminal` when `state.result` is set), so the AI knows losing
is bad once it has lost. What it lacks is any sense of *approaching* the cliff: at six damage it defends with
exactly the urgency it had at one, and it races for the opponent's seventh with exactly the appetite it had
for their first.

This is untried rather than rejected. The original design spec lists the term as "`damage`: … (the race)" and
never considers a curve.

## Why this is the highest-leverage AI change available

`evaluate` is used by the greedy agent AND inside every ISMCTS rollout, so it prices every decision the
opponent makes. Rungs F1–F5 have taken the plateau: F1 was deferred at a 0.7 % opportunity, F5 gave a real
gain but only where root ties dominate. This is a change to *what the search is trying to achieve*.

## Design — a weight that is a no-op by default

The repo already has the right pattern and says why: `expiredThreat: 0` exists so a behaviour can be turned
on and off as a weight, because **"a change that can only be made by editing code cannot be A/B'd"**. Same
here. A new weight, defaulting to `0`, which reproduces today's behaviour EXACTLY:

```ts
damageCurve: 0        // 0 = today: the race is linear
```

```ts
const taken = ps.damageZone.length
let v = (DAMAGE_TO_LOSE - taken) * w.damage
      - (taken * taken / DAMAGE_TO_LOSE) * w.damageCurve
```

At `damageCurve: 0` every term is byte-identical to today. Above zero the penalty accelerates: at one damage
it is `1/7 × curve`, at six `36/7 × curve`, at seven `7 × curve`. Antisymmetric in `mine − theirs` exactly as
the linear term already is, so it makes the AI both defend harder near its own seventh and push harder for
the opponent's.

**Open, and for the review:** is quadratic the right shape, or should it be a threshold ("panic at 5+")? I
lean quadratic because it has one parameter and no cliff to tune, but I hold that loosely.

## The instrument, and its warning

`apps/cli/src/weights-ab.ts` exists for exactly this and is the right tool: it plays greedy-vs-greedy with the
two weightings, seats swapped per seed. Its header carries the lesson this rung must respect:

> READ THE SAMPLE SIZE BEFORE BELIEVING THE NUMBER. Measuring `temporaryPower` gave 53.3 % over 120 games and
> 50.5 % over 800 — the first was noise.

An ismcts-vs-greedy mirror **cannot** answer a weights question, because ISMCTS uses `evaluate` in its own
rollouts: changing a weight moves both sides of that matchup at once.

## Acceptance

Predeclared here, before any run.

- **G1-A1** `damageCurve: 0` reproduces today's evaluation exactly — asserted as identical scores over a
  corpus of states, not by inspection. Falsifier: any non-zero difference at 0.
- **G1-A2** The curve is monotonic and correctly signed: more of my own damage strictly lowers my score, and
  the marginal cost of the n-th damage strictly increases with n. Asserted on hand-built states.
- **G1-A3** Strength measured with `weights-ab`, greedy vs greedy, seats swapped, **at least 800 games** —
  the number its own header says is needed for a difference this size. Fewer is reported as inconclusive
  rather than as a result.
- **G1-A4** Predeclared decision rule: ship only if the curve wins by **≥ 2 points with a paired 95 %
  interval excluding zero**. A point estimate above 50 % with an interval spanning it is NOT a result — that
  is the `temporaryPower` mistake the harness header records.
- **G1-A5** If it ships, the chosen `damageCurve` value is justified by a sweep over at least three values,
  not by the first number tried.
- **G1-A6** Existing tests pass unedited. `evaluate`'s monotonicity tests are the ones to watch; any that
  must change are named here BEFORE the run.

## Not in scope

`cardValue` (F1's review named it as its own rung with a harder measurement problem), the rollout policy, and
`aggression`. This rung adds one weight.

---

## Plan review: not sound. The experiment tests the wrong agent, and the basis tests two hypotheses.

### CRITICAL — `weights-ab` measures greedy, and the shipping opponent is ISMCTS

`weights-ab` plays depth-1 greedy against depth-1 greedy. The search is materially different: it runs
12-command greedy rollouts, converts every leaf through **`tanh(score / 100)`**, and backs the result through
a minimising/maximising tree. A `damageCurve` of 30 adds ~154 points of penalty at six damage — enough to
**saturate that `tanh`** and erase distinctions between positions the search needs to tell apart. A curve can
help greedy and hurt the search.

And my stated reason for using greedy was **wrong**. I quoted the harness header — "an ismcts-vs-greedy mirror
cannot answer a weights question, because ISMCTS uses `evaluate` in its own rollouts" — which is true of
`ismcts vs greedy` and says nothing about `ismcts vs ismcts`. That comparison is impossible today only because
**weights are hardcoded**: `search.ts:525` passes `DEFAULT_WEIGHTS`, and neither `SearchInput` nor
`IsmctsOptions` accepts any. Per-instance weights would make a direct mirrored ISMCTS(curve) vs ISMCTS(0)
tournament straightforward — each search modelling both rollout players with its own evaluator is normal, and
the two match agents still differ.

So configurable search weights are part of this work, and greedy A/B is at most a cheap development sweep.

### HIGH — my basis tests two hypotheses at once

`n² = n + n(n−1)`. So raising `damageCurve` also raises the price of the **first** damage by `curve / 7`. A
win would not show that approaching seven needs curvature; it could equally show that the linear
`damage: 30` is simply too small. The fix is a centred basis — **`n(n−1)`** — which leaves 0 → 1 at today's
price and varies only the *increasing marginal*. That is the hypothesis I actually mean.

### HIGH — `weights-ab` cannot produce the interval G1-A4 demands

It reports aggregate wins only, scores draws as **zero rather than a half**, keeps no per-seed pair scores,
and silently drops incomplete games — so "400 pairs" does not establish that 800 games were scored, and no
paired interval can be reconstructed. `mirror` already has every one of those semantics right: agent-keyed
seeds, pair scores, failure-charged-as-loss, paired bootstrap. G1 should reuse them rather than re-derive them.

### HIGH — G1-A5 was a garden of forking paths

Sweeping three values and then applying an ordinary 95 % interval to the winner selects and confirms on the
same data. Predeclare the values and the selection rule, then confirm the chosen one on **untouched holdout
seeds**, or apply a multiplicity correction.

### The premise is true but I overstated it

Confirmed linear, and `damageZone.length` is the right quantity (nothing removes damage cards). Two
corrections:

- the static marginal is **30.1**, not 30 — taking damage also removes a card from the deck at `w.deck` 0.1;
- `7 × curve` never applies, because a seven-damage state returns terminal before `material` runs.

**And the cliff is already partly priced.** Terminal states bypass `material` entirely, ISMCTS assigns exact
1/0/½ terminal rewards, and there is already a regression proving it takes an unblocked lethal against six
damage. From F5's own shipping measurement: **169,297 of 1,232,000 leaves (13.7 %) ended terminal**, so 86.3 %
stayed heuristic. G1 is not unnecessary — but it improves *capped non-terminal leaves and longer-horizon
preparation*, not "teaching the AI that a reachable seventh damage matters". It already knows that.

**Before implementing: profile non-terminal leaf damage pairs**, especially states with either player at five
or six, to establish the actual opportunity size. That is the measurement that says whether this is worth
building at all.

### Restructured, because this is no longer one small rung

- **G1a — configurable search weights.** Thread `weights` through `IsmctsOptions` and `SearchInput` (data, as
  the budget was), default `DEFAULT_WEIGHTS` so nothing changes, and add the ISMCTS-vs-ISMCTS mirror arm.
  Infrastructure only, no behaviour change.
- **G1b — the curve itself**, on the `n(n−1)` basis, measured through `mirror` semantics with predeclared
  values and holdout confirmation — and only if the leaf profile says the opportunity is real.

### Acceptance, re-ruled

A1 is sound only against frozen pre-change scores, and vacuous if both sides call the new evaluator or the
corpus is all-terminal/zero-damage. A2 must use a positive curve and test 0→1 through 5→6 — **including 6→7
makes it pass regardless**, because terminal handling dominates there. A3 needs *completed scored games*, not
requested pairs. A4 is impossible with the current harness. A5 is invalid as written. A6 passes vacuously
while the curve is zero everywhere — it must run against the chosen shipping default.
