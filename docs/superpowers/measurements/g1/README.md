# G1 — how many leaves could a damage weight actually reprice?

The gate the G1 plan review demanded before any curve was written: a weight can only move a leaf that reaches
`material`, and terminal leaves bypass it entirely, so the population had to be sized rather than assumed.

## How to reproduce

```bash
pnpm --filter @fftcg/cli run profile --games 8  --seed 1   --iterations 200   # pilot
pnpm --filter @fftcg/cli run profile --games 40 --seed 101 --iterations 200   # confirmation
```

Note `run` — plain `pnpm --filter … profile` is intercepted by pnpm's own builtin and does nothing.

The harness plays **ISMCTS (seat 0, profiled) against greedy depth 1 (seat 1)**, one search per pair of moves.
That opponent shapes the distribution and is stated here because it has to be: the root sits at 0–2 damage in
71 % of leaves, which is the profile of a matchup the search is winning.

## What the files hold

| file | seeds | games | decisions | leaves |
|---|---|---|---|---|
| `leaf-profile-seeds1-8.json` | 1–8 | 8 | 373 | 74,600 |
| `leaf-profile-seeds101-140.json` | 101–140 | 40 | 2,031 | 406,200 |

The seed sets are disjoint, and the second run was launched before the first was interpreted — so it is a
confirmation, not a second look at the same data. The pilot reproduces byte-identically on re-run.

## The finding

**26.6 % of repriceable leaves have a player at five or six damage** (pilot: 28.2 %). The predeclared
abandonment threshold was 10 %, so G1b proceeds.

Terminal leaves — which no weight can move — are **14.5 %** (pilot: 12.6 %). The plan review independently
computed 13.7 % from F5's shipping measurement, by different code on a different run.

## What these numbers are not

Leaves within one game are heavily correlated, so 406,200 leaves are nowhere near 406,200 independent
observations; the right unit is closer to the 2,031 decisions, or the 40 games. The gate was therefore decided
on the *agreement of two disjoint seed sets*, not on either run's leaf count.

`byRootDamage[7]` and `byOpponentDamage[7]` are zero in both runs and must stay zero: seven damage is
terminal, and terminals are counted apart. That is a standing check on the recorder which the numbers
themselves cannot fake.
