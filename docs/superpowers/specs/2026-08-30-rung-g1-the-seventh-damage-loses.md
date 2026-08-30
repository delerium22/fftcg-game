# Rung G1 — the seventh damage loses the game, and the AI prices it like the first

> **STATUS: SPEC, awaiting plan review.** Nothing built. Margins and sample size are predeclared below,
> before any run, because F5's were not and its own review could not substantiate them.

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
