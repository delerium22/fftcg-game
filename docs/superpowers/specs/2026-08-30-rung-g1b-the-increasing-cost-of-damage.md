# Rung G1b — does the cost of damage *increase* as you approach seven?

> **STATUS: SPEC. Nothing built.** Every value, seed partition and margin below is predeclared, before any
> arm has been run. G1's first spec was refused partly for the opposite — see
> [the G1 review](./2026-08-30-rung-g1-the-seventh-damage-loses.md).

## The question, narrowed to one hypothesis

`material` prices damage linearly: `(DAMAGE_TO_LOSE − taken) × w.damage`, so the first damage and the sixth
cost the same 30.1 points (30 for the damage, 0.1 for the deck card it consumes).

G1's first spec proposed an `n²` penalty. The review killed that basis, correctly: **`n² = n + n(n−1)`**, so
raising the coefficient also raises the price of the *first* damage. A win would then be ambiguous — it could
mean "approaching seven needs curvature" or merely "the linear `damage: 30` is too small", and those call for
different fixes.

So the basis is the **centred** one:

```
penalty = taken × (taken − 1) × w.damageCurve
```

`taken = 0` and `taken = 1` both give zero, so **0 → 1 costs exactly what it costs today**. Only the
*increasing marginal* varies. That is the hypothesis, alone.

`taken = 7` never arises: a seven-damage state is terminal and returns before `material` runs.

### What this is NOT about

The review established that the search *already* prices an immediately reachable seventh damage. Terminal
states bypass `material` and take the exact `±terminal` value; ISMCTS assigns exact 1 / 0 / ½ terminal
rewards; and a regression already proves it takes an unblocked lethal attack against six damage.

G1b is about the leaves that stay heuristic — longer-horizon preparation, not lethal recognition.

## The gate that had to clear first

Predeclared before the run: **if fewer than 10 % of repriceable leaves sat at five or six damage, G1b would
be abandoned**, because a curve would then be tuning a corner the search rarely reaches.

Measured — `profile --games 8 --seed 1 --iterations 200`, 373 searched decisions, 74,600 leaves:

| | |
|---|---|
| terminal leaves (a curve cannot move these) | 9,376 — **12.6 %** |
| repriceable (heuristic) leaves | 65,224 |
| …with either player at **five or six** damage | **28.2 %** |
| …with either player at **six** | 12.1 % |
| …both players under five | 71.8 % |

**The gate clears with room to spare.** The terminal share independently corroborates the review's own
13.7 % figure from F5's shipping measurement, taken by different code on a different run.

Two things worth recording about the shape. The root player (ISMCTS) sits at 0–2 damage in 74 % of leaves
while the opponent (greedy) is spread across 0–6 — the profile harness plays ISMCTS against greedy, so the
distribution is that of a matchup the search is winning. Against a stronger opponent the root's own damage
would be higher, which if anything *understates* the opportunity. And damage 7 is empty in both marginals,
exactly as it must be, since seven is terminal and terminals are counted apart.

## Design

One new weight, `damageCurve`, defaulting to **0** — a no-op, matching the repo's existing `expiredThreat: 0`
pattern. Shipping a non-zero default is a separate decision this spec gates on the measurement below.

```ts
// in material(), after the linear damage term
const taken = ps.damageZone.length
v -= taken * (taken - 1) * w.damageCurve
```

## The instrument

**`mirror`, not `weights-ab`.** The review disqualified `weights-ab` on two independent grounds: it plays
depth-1 greedy while the shipping opponent is ISMCTS, and it cannot produce a paired interval at all — it
reports aggregate wins only, scores draws as **zero rather than a half**, keeps no per-seed pair scores, and
drops incomplete games silently, so "400 pairs requested" does not establish that 800 games were scored.

`mirror` already has every one of those semantics right: agent-keyed seeds, each seed played twice with seats
swapped, pair scores retained, failure charged as a loss, paired bootstrap intervals.

G1a made the arms expressible: `ismcts:200+damageCurve=X` against `ismcts:200`. Each search models both of
*its own* rollout players with its own evaluator — the normal arrangement — and the two match agents differ,
which is what the comparison needs.

### Why the candidate values stop where they do

ISMCTS pushes every leaf through `tanh(score / 100)`. At six damage, `n(n−1) = 30`, so `damageCurve = c` adds
`30c` points — and `tanh` saturates well before `damageCurve = 8`, which would add 240 points and flatten the
distinction between every position on that side of the board. That is the review's saturation warning, and it
is why the sweep is small rather than logarithmic:

**Predeclared values: `damageCurve ∈ {0.25, 0.5, 1.0}`.** At `1.0`, standing at six damage costs an extra 30
points — one whole additional damage — which is already an aggressive claim about the shape of the game.

## Acceptance, predeclared

**G1b-A1 — the default is exactly neutral.** With `damageCurve: 0`, `evaluate` returns bitwise-identical
scores to the pre-change function on a corpus that contains non-terminal states with *unequal, non-zero*
damage on both sides. Exact floating-point equality: subtracting a finite `+0` is exactly neutral. Compared
against **frozen pre-change scores**, not against the new evaluator called twice.

**G1b-A2 — a positive curve makes the marginal increase.** For a positive `damageCurve`, the score drop from
`n` to `n+1` damage is strictly greater than the drop from `n−1` to `n`, for every transition **0 → 1 through
5 → 6**. `6 → 7` is deliberately excluded: it is terminal, so it would pass regardless of whether the curve
works, and including it would make A2 vacuous.

**G1b-A3 — the sweep runs on development seeds only.** Seeds **1–60** (120 games per arm). Each of the three
values is run against the `damageCurve=0` control. This selects a candidate; it confirms nothing.

**G1b-A4 — confirmation runs on untouched holdout seeds.** Seeds **1001–1120** (240 games), used **once**,
for the single value A3 selected. Sweeping three values and then applying a nominal 95 % interval to the
winner selects and confirms on the same data — the review's "garden of forking paths". The holdout is the
correction.

**G1b-A5 — the shipping bar.** Ship only if, on the **holdout**, the paired point-score lift over the control
is **≥ +2.0 points with a 95 % paired-bootstrap interval strictly excluding zero**. Draws score ½. A failed
or incomplete game is charged as a loss to the arm that failed, never dropped. The report must state the
number of games **completed and scored**, not the number of pairs requested.

**G1b-A6 — the shipping default is what gets tested.** If a non-zero `damageCurve` ships, the existing suite
runs against that value, not against the `0` staging default. Green tests under a no-op weight are a
regression gate, not evidence that the curve is active.

**G1b-A7 — abandonment is a real outcome.** If no value clears A5, `damageCurve` stays at `0` and this rung
is recorded as measured-and-rejected. The weight and its plumbing remain, because the measurement is worth
more than the result: the next weight question costs an hour instead of a rung.
