# U0 baseline — today's UI, before the overhaul

Recorded 2026-09-30 on an Apple M4 Pro (24 GB), Playwright 1.62.1 Chromium, from branch `feat/u0-harness`. Later rungs
re-run the same spec and compare against these files.

```bash
FFTCG_BASELINE=1 pnpm test:browser baseline
```

The spec is `apps/web/e2e/baseline.spec.ts`. It is skipped unless `FFTCG_BASELINE=1` is set, because it records
rather than asserts: the AI's search is time-boxed, so positions and timings differ from run to run. Every image uses
`?art=off`, so no card art reaches the repository.

## Performance: a full game at 4× CPU throttling

Route `/?seed=1&decks=vol2,vol2&art=off`, viewport 1440×900, Instant speed (the suite's storage state), driven to the
game-over dialog by `playToTheEnd`. Raw numbers are in `perf-baseline.json`.

| Measure | Value |
|---|---|
| Game length (wall clock) | 25.7 s |
| Animation frames observed | 1,409 |
| Frame gap, median | 16.7 ms |
| Frame gap, 95th percentile | 33.3 ms |
| Frame gap, 99th percentile | 66.7 ms |
| Worst frame gap | 116.7 ms |
| Long tasks (≥ 50 ms) | 37, worst 103 ms, 2,532 ms in total |

Today's UI already produces frames over 50 ms at 4× throttling, all from React re-rendering the board, since nothing
animates yet. The overhaul's budget (spec section 9) is therefore relative. The presentation layer must add no frame
over 50 ms of its own, and the long-task count must stay within 2 of the 37 recorded here.

## Screenshots: the board at turn 3

The same route, played until the prompt reads "Turn 3", at three desktop sizes.

| File | What today's layout gets wrong at this size |
|---|---|
| `board-1280x720.png` | Neither Forward row is on screen. Each seat's half scrolls on its own, and the two LB-deck rows and the empty Backup rows take the visible space. |
| `board-1440x900.png` | The Forward rows are still cut off at the prompt strip. Field and LB cards are about 50–75 px wide. |
| `board-1920x1080.png` | The AI's Forward row is still cut off at the prompt strip, and yours is below the fold. Field cards stay small, and the rail still holds the card details and log. |

These are the facts the overhaul's acceptance criterion UO-A1 is measured against: from 1280×720 to 2560×1440 the page
has no scroll, and no control or panel covers a card.
