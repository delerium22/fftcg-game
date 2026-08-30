# G1 — how many leaves could a damage weight actually reprice?

The gate the G1 plan review demanded before any curve was written: a weight can only move a leaf that reaches
`material`, and terminal leaves bypass it entirely, so the population had to be sized rather than assumed.

## How to reproduce

```bash
pnpm --filter @fftcg/cli run profile --games 8  --seed 1   --iterations 200   # pilot
pnpm --filter @fftcg/cli run profile --games 40 --seed 101 --iterations 200   # confirmation
pnpm --filter @fftcg/cli run profile --games 20 --seed 201 --iterations 200 --opponent ismcts:200   # A0
```

Note `run` — plain `pnpm --filter … profile` is intercepted by pnpm's own builtin and does nothing.

Seat 0 searches and is profiled; **seat 1's policy is `--opponent`**, and it is named in every report because
the leaf distribution is a property of the *matchup*, not of the searching agent alone. The first two runs use
the default greedy depth 1; the third mirrors ISMCTS on both seats.

## What the files hold

| file | opponent | seeds | games | decisions | leaves |
|---|---|---|---|---|---|
| `leaf-profile-seeds1-8.json` | greedy:1 | 1–8 | 8 | 373 | 74,600 |
| `leaf-profile-seeds101-140.json` | greedy:1 | 101–140 | 40 | 2,031 | 406,200 |
| `leaf-profile-mirrored-ismcts.json` | ismcts:200 | 201–220 | 20 | 1,001 | 200,200 |

The seed sets are disjoint, and the second run was launched before the first was interpreted — so it is a
confirmation, not a second look at the same data. The pilot reproduces byte-identically on re-run.

## The finding

**30.4 % of repriceable leaves have a player at five or six damage** in the matchup G1b actually proposes to
change — ISMCTS against ISMCTS. Against greedy it is 26.6 % (pilot: 28.2 %). The predeclared abandonment
threshold was 10 %, so G1b proceeds.

The opponent matters more than the total suggests, which is why the third run exists at all:

| at five or six | vs greedy | vs ISMCTS |
|---|---|---|
| root | 8.1 % | 22.5 % |
| opponent | 20.9 % | 13.4 % |

Against greedy the union mostly means *greedy is close to losing*. In a mirror the two sides are comparable and
both spend real time across 3–6 damage, because equal opponents grind — and those are exactly the positions a
curve exists to tell apart.

Terminal leaves — which no weight can move — are **14.0 %**, **14.5 %** and **12.6 %** across the three runs.
The plan review independently computed 13.7 % from F5's shipping measurement, by different code again.

## What these numbers are not

Leaves within one game are heavily correlated, so 406,200 leaves are nowhere near 406,200 independent
observations; the right unit is closer to the 2,031 decisions, or the 40 games. The gate was therefore decided
on the *agreement of two disjoint seed sets*, not on either run's leaf count.

`byRootDamage[7]` and `byOpponentDamage[7]` are zero in both runs and must stay zero: seven damage is
terminal, and terminals are counted apart. That is a standing check on the recorder which the numbers
themselves cannot fake.
