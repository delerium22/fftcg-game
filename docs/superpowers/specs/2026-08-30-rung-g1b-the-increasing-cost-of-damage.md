# Rung G1b — does the cost of damage *increase* as you approach seven?

> **STATUS: SPEC, revised after plan review. Nothing built.** Every value, seed partition and margin is
> predeclared before any arm has been run. The first draft of this spec was itself found unsound: its
> experiment could not have detected the effect it demanded (~10 % power), its acceptance criteria would have
> accepted the basis the previous review rejected, and its confidence interval was compared against the wrong
> null. See [the G1 review](./2026-08-30-rung-g1-the-seventh-damage-loses.md) for the round before this one.

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

Measured twice, at shipping iterations, on **disjoint seed sets** — the second run was launched before the
first was interpreted, so it is a confirmation rather than a second look at the same data:

| | pilot, seeds 1–8 | confirmation, seeds 101–140 |
|---|---|---|
| games / searched decisions | 8 / 373 | 40 / 2,031 |
| leaves | 74,600 | 406,200 |
| terminal (a curve cannot move these) | 12.6 % | **14.5 %** |
| repriceable (heuristic) leaves | 65,224 | **347,446** |
| …either player at **five or six** damage | 28.2 % | **26.6 %** |
| …either player at **six** | 12.1 % | 14.9 % |
| …both under five | 71.8 % | 73.4 % |

**The gate clears with room to spare, and the estimate is stable across seed sets** — 26.6 % against 28.2 %
on data that shares no seeds. The terminal share now has three independent estimates: 12.6 %, 14.5 %, and the
13.7 % the plan review computed from F5's shipping measurement, by different code on a different run.

The apply attribution reconciled on all 2,031 decisions of the confirmation run (`mismatchedDecisions: 0`),
so the same profile object that carried the histogram was not drifting.

Damage 7 is empty in both marginals, exactly as it must be, since seven is terminal and terminals are
counted apart — a standing check on the recorder that the numbers themselves cannot fake.

**Retracted, and the correction matters.** I first wrote that a stronger opponent would raise the root's own
damage and so this figure "if anything understates the opportunity". That does not follow, and the review was
right to say so. Split the 26.6 % by who is near the cliff:

| in the confirmation run, at five or six damage | share of repriceable leaves |
|---|---|
| the **root** (ISMCTS) | 8.1 % |
| the **opponent** (greedy depth 1) | 20.9 % |

So the union is predominantly *greedy is close to losing*. Replacing greedy with ISMCTS should raise the first
row and would likely **lower** the second, and the net is genuinely unknown — it could go either way. The
figure is therefore sound for "leaves reached by seat-0 ISMCTS while beating greedy" and is **not** established
for the ISMCTS-vs-ISMCTS matchup G1b actually proposes to measure.

**G1b-A0 (new, and it gates everything below): profile a mirrored ISMCTS-vs-ISMCTS baseline** and re-read the
five-or-six share there. The 10 % abandonment threshold applies to *that* number, not to this one.

The honest caveat: leaves within one game are heavily correlated, so 406,200 leaves are nowhere near 406,200
independent observations, and the right unit is closer to the 2,031 decisions or the 40 games. That is why
the gate was decided on the agreement of two disjoint seed sets rather than on either run's leaf count.

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

`mirror` has almost all of those semantics right, verified in the code rather than assumed: draws score ½,
each seed is played twice with the seats swapped, agent seeds stay fixed across the swap, pair scores are
retained, and the bootstrap resamples **pairs**.

One claim I made about it was false. Failures are **not** charged to the arm that failed — the catch block
cannot tell which agent threw, so it always scores the game as a loss for A, even when B is what broke. So
G1b requires **zero failures** for any efficacy claim, rather than relying on attribution the harness cannot
perform.

G1a made the arms expressible: `ismcts:200+damageCurve=X` against `ismcts:200`. Each search models both of
*its own* rollout players with its own evaluator — the normal arrangement — and the two match agents differ,
which is what the comparison needs.

### Why the candidate values stop where they do

My first cut of this argument was wrong in a way worth recording, because it would have made the sweep too
narrow to find anything.

I reasoned that at six damage `n(n−1) = 30`, so `damageCurve = c` adds `30c` points, and `tanh(score/100)`
would saturate well before `c = 8`. But `30c` is a *cumulative, one-sided* quantity. What the search sees is
the **difference**, and at rollout aggression 0.5 the curve's contribution to `evaluate` is exactly
`c × [f(theirs) − f(mine)]`. So:

- both players at six → the curve **cancels entirely**;
- six against five → the difference is `10c`, not `30c`;
- six against zero → the *linear* damage term is already ~180 points, deep in the `tanh` tail before the curve
  contributes anything at all.

In the close races where a curve is supposed to matter, `c = 4` adds only 40 points of differential. The
saturation argument rules out very large values; it does not put the ceiling at 1.0.

**Predeclared values: `damageCurve ∈ {0.5, 1.0, 2.0, 4.0}`.** At `4.0` the 5→6 marginal roughly doubles, which
is the largest claim about the shape of the game worth entertaining.

## What this program can actually measure

The review's most consequential finding, and I checked its arithmetic against the committed F5 data rather
than taking it: **the experiment I predeclared could not have detected the effect it predeclared.**

Pair scores are `{0, ½, 1}`, and every near-50 % mirror in `docs/superpowers/measurements/f5` has a pair-score
standard deviation around 0.30–0.34 (`tie8.json`, the closest to even at 0.508, gives **0.335**). At one
measured **62.6 s per pair** for `ismcts:200` on both seats, that fixes the whole frontier:

| pairs | 95 % half-width | effect detectable at 80 % power | wall clock, per arm |
|---:|---:|---:|---:|
| 60 | ± 8.6 pts | 12.2 pts | 1.0 h |
| 120 | ± 6.1 pts | 8.6 pts | 2.1 h |
| 300 | ± 3.8 pts | 5.5 pts | 5.2 h |
| **500** | **± 3.0 pts** | **4.2 pts** | **8.7 h** |
| 1000 | ± 2.1 pts | 3.0 pts | 17.4 h |
| 2500 | ± 1.3 pts | 1.9 pts | 43.5 h |

My "≥ +2.0 points on 120 holdout pairs" therefore had roughly **10 % power**. It would have failed almost
regardless of whether the curve works — and had it passed, it would most likely have been noise. Reaching
+2 points honestly needs ~2,500 pairs, or **43 hours for a single arm**, which this program does not have.

So the margin is set by what is measurable, not by what would be nice:

> **This program can resolve a ~4-point effect overnight and cannot resolve a 2-point one at all.** An effect
> smaller than the frontier will be reported as **undetermined**, never as zero and never as a win.

That distinction is the point. "We could not detect it" is not "it is not there", and a rung that conflates
the two has learned nothing while sounding like it learned something.

## Acceptance, predeclared

**G1b-A0 — the gate is re-read on the right matchup.** Profile leaf damage for a mirrored
**ISMCTS-vs-ISMCTS** game, not ISMCTS-vs-greedy. The existing 26.6 % is 8.1 % root plus 20.9 % opponent, so it
mostly measures *greedy* approaching the cliff, and swapping the opponent moves both terms in unknown
directions. **If under 10 % of repriceable leaves in that matchup have a player at five or six, G1b is
abandoned here** and nothing below is run.

**G1b-A1 — the default is exactly neutral.** With `damageCurve: 0`, `evaluate` returns bitwise-identical
scores to **frozen pre-change scores** — not to the new evaluator called twice — on a corpus containing
non-terminal states with *unequal, non-zero* damage on both sides. Exact floating-point equality: subtracting
a finite `+0` is exactly neutral.

**G1b-A2 — the basis is `n(n−1)` and nothing else.** A criterion that only asks for "an increasing marginal"
would be satisfied by the `n²` basis the previous review rejected, so A2 asserts the *exact* values:

- for `damageCurve = c`, the penalty at `n` damage is exactly `n(n−1)c` for `n` in 0…6;
- **0 → 1 still costs exactly 30.1** — the linear damage weight plus the deck card it consumes — for every
  value of `c`. This is the criterion that distinguishes the centred basis from `n²`, and the one an
  implementation of the rejected basis fails;
- each later marginal exceeds the one before it by exactly `2c`, across 1 → 2 through 5 → 6;
- **the opponent's sign is asserted too.** At aggression 0.5 the curve contributes `c × [f(theirs) − f(mine)]`,
  so it must *cancel* when both players hold equal damage. An own-side-only implementation passes every other
  clause here and fails this one.

`6 → 7` is excluded throughout: it is terminal, so it would pass regardless of whether the curve works.

**G1b-A3 — the sweep estimates variance and ranks values. It confirms nothing.** Seeds 1–60, one tournament
per value, `ismcts:200+damageCurve=c` against `ismcts:200`. Its ±8.6-point half-width is stated here so that
no result from it is ever read as evidence. It exists to (a) measure the **actual** pair-score SD for this
matchup, which resizes A4, and (b) rank the four candidates.

**Selection rule, predeclared:** the value with the highest point score; ties broken by the **smaller** `c`,
on the grounds that a smaller distortion of the evaluation is the safer thing to ship. Exactly one value goes
forward.

**G1b-A4 — confirmation, on untouched holdout seeds, used once.** Seeds 1001–1500 — **500 pairs, 1,000
games** — for the single value A3 selected. Sized from the table above, and **resized upward if A3's measured
SD exceeds 0.34**. One overnight run.

**G1b-A5 — the shipping bar, against the right null.** `mirror`'s `ci95` is an interval on the raw point
score, whose null is **0.5, not 0** — my earlier "interval strictly excluding zero" would have passed almost
any arm ever run. The bar is:

```
pointScore >= 0.54  AND  ci95[0] > 0.50  AND  failures == 0
```

Draws score ½. Failures must be zero because `mirror` charges every harness exception to arm A regardless of
which agent threw, so a nonzero count makes the comparison unattributable. The report states games
**completed and scored**, not pairs requested.

**G1b-A6 — the shipping default is what gets tested, in both places it runs.** If a non-zero `damageCurve`
ships, the suite runs against that value rather than the `0` staging default. And because a shipped default
reaches the browser through `DEFAULT_WEIGHTS` while a *configured* override would have to cross
`WorkerInit → searchInputFor`, A6 covers whichever route actually carries it — green tests under a no-op
weight are a regression gate, not evidence that the curve is live.

**G1b-A7 — three outcomes, not two.** *Ship* if A5 clears. *Reject* if the holdout interval excludes a
4-point effect. *Undetermined* if the estimate sits inside the noise floor — recorded as undetermined, with
the number of pairs that would have settled it. The weight and its plumbing stay in all three cases: the
measurement apparatus is worth more than this particular result, because it makes the next weight question
cost an hour instead of a rung.
