# Rung F3 — the latency the player actually feels

> **STATUS: MEASURED.** Five finished, valid games. The instrument itself turned out to be broken, which is
> the more important finding — see *The instrument was broken*.

## Why this, after two rungs were stopped

F1 was deferred and F2 was rejected, the latter because I re-proposed what D8 had already killed. Reading D8
to the end — which is what I should have done first — found this, sitting unclaimed since D8 was written:

> Step 2 is worth doing on its own account and immediately: the README's browser latency figures are both
> stale and internally inconsistent, and the harness to settle them already exists.

It has never been done. It is small, it is concrete, the instrument is already committed
(`apps/web/scripts/measure-worker.js`), and it is the only number here a player actually experiences.

It is also the prerequisite the whole D-series keeps lacking. D3 (time-box) was deferred in favour of "make
the rollout cheaper"; D6, D8 and F2 each tried to choose HOW and were each rejected for the same reason. A
current, trustworthy browser p95 is the baseline any of that work would have to beat.

## What the README claims today, and why it cannot all be true

| where | claim |
|---|---|
| strength table | ISMCTS in the browser: p50 **77–215 ms**, p95 **127–1021 ms**, over 5 games |
| D5 budget table | rollout cap 12 (what ships): browser p95 **604 ms** |
| D4 paragraph | median 454 → 283 ms; p95 1351 → 1385 ms |

The first two describe the same shipping configuration and were measured at different times, and the README
itself says of the single-number style: *"Quoting one game's p95, as this table used to, describes that game
and nothing else."* The D5 row is exactly that, in the same document. **The README criticises its own table
and leaves it standing.**

Both were also taken before rungs C5–C10 widened the card pool and before E9–E11 changed the interface. The
README's own diagnosis is that these numbers "rotted silently as cards were added".

## Method

The harness's documented recipe, followed exactly, because it says a shortcut silently produces a blind run:

1. `pnpm --filter @fftcg/web build`, copy `dist/index.html` to `dist/measure.html`.
2. Write the harness to `dist/harness-boot.js` with `export` stripped, appending
   `window.__harness = {...}; instrument()`.
3. Reference it as a **classic** script at the END of `<body>` — `<head>` is too early (`instrument()` needs
   `document.body`), and a module is too late (it runs after the deferred bundle).
4. Serve with `preview`, never the dev server: the dev server takes a different bundler path, and the point is
   that the emitted worker chunk loads when actually served.

`dist/` is git-ignored, so none of it is committed; this section is the artifact, as the harness intends.

## The trap this rung found, before it reported anything

The first run came back **valid but `finished: false`** — the driver exhausted its step budget mid-game. Its
numbers (p50 99 ms, p95 149 ms) are therefore **not reportable**: the expensive decisions are the wide boards
of the late game, so a truncated game biases p95 DOWNWARD, and quoting it would have replaced one stale figure
with a flattering one.

The cause is this rung's own predecessors: E11 made a card that hides a payment choice select rather than
commit, so the driver needs an extra click per such move, and the harness's default `maxSteps` no longer
covers a full game.

## Acceptance

Written to reject the "fill in the table" mutant that four consecutive reviews caught in my reporting
criteria. Each names its falsifier.

- **F3-A1** A result is quoted ONLY from a run where `instrumentationValid` is true, `searchesPosted ===
  resultsReceived === aiCommitsCommitted`, `workerErrors === 0`, AND `finished` is true. Falsifier: any run
  failing one of these is reported as discarded, with which condition failed — not silently re-run until one
  passes.
- **F3-A2** Per game, never pooled: five finished games, each row its own p50/p95/max, plus the range across
  them. Falsifier: a single pooled mean is a criterion violation, not a formatting choice.
- **F3-A3** The README's stale figures are corrected in place, and the D5 table's single-number p95 either
  gets the same range treatment or is explicitly labelled as a historical measurement of one game. Falsifier:
  leaving two live figures that describe the same configuration differently.
- **F3-A4** The harness's own overhead is stated as a caveat, as the README already does for the D5 table —
  these numbers are taken under a scripted driver on one machine, and are indicative.
- **F3-A5** No production code changes. This rung measures and documents; if the measurement argues for an
  optimisation, that is the NEXT rung and its own spec.
- **F3-A6** Full gates stay green, and the measurement is not run concurrently with anything CPU-heavy —
  a timing run sharing a machine with a test suite measures the test suite.

## The instrument was broken, and it flattered every number it ever produced

Before any figure could be quoted, the driver had to be fixed — and the bug it had is the reason the old
numbers looked calm.

`drive()` picked a card with `document.querySelector('.hand button.card, …')`, which returns the **first** hand
card. In this deck that is very often **Lightning at cost 7**, uncastable for most of a game. So the driver
clicked it, found no action, and passed — every turn. The human seat essentially never played.

The consequence is not subtle. A game where one player never casts keeps both boards narrow, and the wide
boards are precisely the expensive decisions. **Every browser latency figure this harness has produced was
measured on a game the human sat out.**

Fixed to try each card in turn, deselecting and moving on when one offers no action:

| | old driver | fixed driver |
|---|---|---|
| a full game | never finished — 166 s, 5000 steps, still going | **finished in 27 s** |
| AI moves | 24 (in 166 s) | 42 |
| p95 | 745 (on a truncated game, so biased low) | 727 — on a game that ended |

## Result

Five games, each finished, each `instrumentationValid`, each with
`searchesPosted === resultsReceived === aiCommitsCommitted` and zero worker errors:

| game | AI moves | p50 | p95 | max |
|---:|---:|---:|---:|---:|
| 1 | 42 | 281 ms | 727 ms | 961 ms |
| 2 | 54 | 429 ms | **1347 ms** | **2088 ms** |
| 3 | 38 | 288 ms | 729 ms | 852 ms |
| 4 | 31 | 145 ms | 714 ms | 741 ms |
| 5 | 33 | 133 ms | 192 ms | 194 ms |

**p50 133–429 ms, p95 192–1347 ms**, worst single decision 2088 ms. Median p95 across the five is 727 ms.

The longest game (54 AI moves) has the worst tail, which is what the wide-board explanation predicts.

### Against what the README says

| | README | measured |
|---|---|---|
| p50 | 77–215 ms | **133–429 ms** |
| p95 | 127–1021 ms | **192–1347 ms** |
| D5 table, cap 12 | 604 ms | median of games **727 ms**, worst **1347 ms** |

Both ranges were understated at the top, and the D5 single number is below every game but one. That is
consistent with all of them having been measured through a driver that never played.

### What did NOT change, and matters

**Zero long tasks in all five runs**, worst frame gap **11–19 ms**. The search runs in a worker and the main
thread is never blocked — a slow decision is a wait with a "thinking" indicator, not a frozen page. That was
the load-bearing claim and it survives the corrected measurement intact.

### Caveats, stated rather than buried

- One machine, one browser, under a scripted driver, with the harness's own instrumentation running. Indicative.
- The fixed driver plays greedily-ish (first castable card) — better than never playing, still not a player.
  It is a floor on realistic board width, not a model of one.
- `AI_STEP_MS` is 600 ms, so decisions under that are paced and invisible. What a player feels is the excess:
  on these numbers roughly one decision in twenty runs past the pacing floor, and the worst ran 1.5 s past it.
