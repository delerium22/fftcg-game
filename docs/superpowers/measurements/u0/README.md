# U0 baseline — today's UI, before the overhaul

Recorded 2026-09-30 on an Apple M4 Pro (24 GB), Playwright 1.62.1 Chromium, from branch `feat/u0-harness`. Later rungs
re-run the same spec and compare against these files.

```bash
FFTCG_BASELINE=1 pnpm test:browser baseline --workers=1
```

The spec is `apps/web/e2e/baseline.spec.ts`. It is skipped unless `FFTCG_BASELINE=1` is set, because it records
rather than asserts: the AI's search is time-boxed, so positions and timings differ from run to run. Its tests run
serially, so the performance games never share the machine with the screenshot games. Every image uses `?art=off`,
and an art guard checks before each screenshot that no card art was shown or requested.

## Performance: three full games at 4× CPU throttling

Route `/?seed=1&decks=vol2,vol2&art=off`, viewport 1440×900, Instant speed (the suite's storage state), each game
driven to the game-over dialog by `playToTheEnd`. Raw numbers per game are in `perf-baseline.json`.

| Measure | Game 1 | Game 2 | Game 3 | **Median** |
|---|---|---|---|---|
| Game length (wall clock) | 27.4 s | 27.4 s | 25.0 s | **27.4 s** |
| Animation frames | 1,512 | 1,526 | 1,407 | — |
| Frame gap, 95th percentile | 33.3 ms | 16.8 ms | 16.8 ms | **16.8 ms** |
| Frame gap, 99th percentile | 50.1 ms | 50.0 ms | 50.0 ms | **50.0 ms** |
| Worst frame gap | 133.3 ms | 100.0 ms | 83.4 ms | **100.0 ms** |
| Long tasks (≥ 50 ms) | 41 | 32 | 18 | **32** |
| Worst long task | 106 ms | 111 ms | 102 ms | — |

Today's UI already produces frames over 50 ms at 4× throttling, all from React re-rendering the board, since nothing
animates yet. The long-task count varies from 18 to 41 between games because each game is different. A budget of
"within 2" would be inside that noise, so the budget (spec section 9) compares medians over this same three-game
protocol. The median long-task count stays at or below 40 (32 × 1.25). The median 99th-percentile frame gap stays at
or below 67 ms (50 ms plus one frame at 60 Hz).

## Screenshots: the board at turn 3

The same route, played until the prompt reads "Turn 3", at three desktop sizes.

| File | What today's layout gets wrong at this size |
|---|---|
| `board-1280x720.png` | Neither Forward row is on screen. Each seat's half scrolls on its own, and the two LB-deck rows and the empty Backup rows take the visible space. |
| `board-1440x900.png` | The Forward rows are still cut off at the prompt strip. Field and LB cards are about 50–75 px wide. |
| `board-1920x1080.png` | The AI's Forward row is still cut off at the prompt strip, and yours is below the fold. Field cards stay small, and the rail still holds the card details and log. |

These are the facts the overhaul's acceptance criterion UO-A1 is measured against: from 1280×720 to 2560×1440 the page
has no scroll, and no control or panel covers a card.
