# F5 measurement arms — the raw reports

A code review of rung F5 pointed out that its result table could not substantiate its own pairing: the CLI
strips `results` (the only field carrying game seeds) from the summary as terminal noise, and the raw outputs
lived in a scratch directory outside the repo. Two runs over *different* seed ranges both emit 60-element
`pairScores`, and subtracting them by index produces a plausible paired interval with nothing failing.

So the arms are committed here, and `mirror` now records its own `provenance` — seed, pairs, deck hash,
`strict`, bootstrap seed — so "these two runs are comparable" is checkable rather than asserted.

| file | comparator | agent | pairs |
|---|---|---|---|
| `floor8.json` | pre-F5 | `ismcts:8` | 60 |
| `tie8.json` | post-F5 | `ismcts:8` | 60 |
| `old64.json` | pre-F5 | `ismcts:64` | 60 |
| `tie64.json` | post-F5 | `ismcts:64` | 60 |
| `p-unboxed.json` | pre-F5 | `ismcts:200` | 60 |
| `tie200.json` | post-F5 | `ismcts:200` | 60 |
| `new16.json` | post-F5 | `ismcts:16` | 60 |

All against `greedy:1`, seed 1, the Starter Set 2025 Vol. 2 list on both sides.

**These predate the `provenance` field**, so they carry the gap that motivated it — their seed and deck are
recorded here in prose rather than in the file. That is exactly the weakness being fixed; later arms will
carry it themselves.
