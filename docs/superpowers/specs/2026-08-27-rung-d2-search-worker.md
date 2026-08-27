# Rung D2 — The search in a Web Worker: the browser gets the strong opponent

> Revision 2 (2026-08-27), after a Codex plan-review that found two blockers and corrected two claims of
> mine. The review is `docs/superpowers/plans/2026-08-27-rung-d2-search-worker.codex-review.md`.

## Context

D1 is merged (`b22be0f`): headless SO-ISMCTS beats `GreedyAgent` **90.0 %** over 120 mirrored games at
~254 ms/decision. **The browser still plays `GreedyAgent`** — D1 was headless by design, because 254 ms of
synchronous search would freeze the board mid-turn.

D2 is the wiring only. The search core does not change: `searchIsmcts(input): SearchResult` is already
pure, synchronous and structured-cloneable, which is what D1 was told to leave behind.

## Architecture: three layers, because the races must be testable

Revision 1 put worker lifecycle, pacing, retries, fallback and stale-result handling into `useGame`'s AI
`useEffect`. That hook already owns state, pacing, mutation and the agent loop; adding this to it would make
every D2-specific race a matter of React timing folklore rather than a test.

1. **`protocol.ts`** — discriminated message types and the pure `respond(init, request)`. Deterministic
   translation only; no lifecycle, no knowledge of what is outstanding.
2. **`worker.ts`** — a thin shell: store init, `try`/`catch`, `postMessage`. Vitest cannot drive a real
   `Worker`, so the shell deliberately contains nothing worth testing.
3. **`SearchCoordinator`** — one worker per mounted hook. Owns generation/request tracking, stable
   per-position seeds, the pacing deadline, the watchdog, termination, and the `GreedyAgent` fallback.
   **This is the layer the D2 tests target**, because this is where every race lives.

`useGame` then does what it already does: capture a state, ask for a command, re-check legality against that
exact state, narrate, commit.

## Decisions

| # | Decision | Ruling (and why) |
|---|---|---|
| D2-1 | A **discriminated wire contract** | `type: 'init' \| 'search' \| 'result' \| 'error'`. Init carries the two declared deck lists **and the stable search configuration** (`rolloutCommandCap`, `explorationC` — `SearchInput` requires them and revision 1's request listed only seed and iterations). Errors carry their `requestId`, or `null` for an init failure, and post **plain strings, never `Error` objects**. |
| D2-2 | **Decks and config at init; the view per request** | `PlayerView` carries `defs` by design and the UI needs them; the search already clones a state containing the same definitions once per determinisation, so one 18-card catalogue per request is not the dominant cost. Revision 1 called this "measured as negligible" — **it was not measured**; D2-A2 now reports the actual serialized size and posting duration, and `Omit<PlayerView,'defs'>` is revisited only if the catalogue materially grows. |
| D2-3 | **Search seeds are stable per game POSITION** | Derived from `(gameSeed, committedAiDecisionIndex)`, incremented **only when an AI command successfully commits**. Never from `requestId`. A seed advanced when the effect *posts* is consumed again by StrictMode's double-invoke, by a retry, by a stale request and by worker replacement — so dev and prod would choose different moves from the same board, which is the worst kind of "works on my machine". |
| D2-4 | **A result is accepted only under all four conditions** | `mounted && activeRequestId === result.requestId && stateRef.current === requestedState && actingPlayer(requestedState) === AI`. Then clear the active id *before* applying, re-check the command against `legalCommands(requestedState, AI)`, and commit from that same captured state. Restart, any external commit, effect cleanup and unmount must **synchronously** invalidate the active id; unmount must also terminate the worker. Note the non-obvious racer: **concede is legal even when the human is not the acting player**, so a human `choose()` really can commit mid-AI-turn. |
| D2-5 | **Pacing is a deadline, not an added delay** | `notBefore = startedAt + AI_STEP_MS`; when the result arrives, schedule at `Math.max(0, notBefore - performance.now())`. A fast search still waits out the 600 ms; a 750 ms search applies immediately, having already shown 750 ms of thinking. Revision 1's "apply at `max(elapsed, AI_STEP_MS)`" was ambiguous enough to be implemented as an *extra* 600 ms. |
| D2-6 | **Fall back to `GreedyAgent`, detect every way it can fail, and say so** | Greedy, not reduced-iteration main-thread ISMCTS: the latter is still a synchronous search with variable rollout cost, which gives up the one guarantee this rung exists for. Detection must cover **missing `Worker`, constructor failure, synchronous `postMessage` clone failure, `error`, `messageerror`, a typed `WorkerError`, and a worker that is killed or hangs and simply never replies** — the last needs a startup and per-request **watchdog**, because nothing correlated ever arrives. On failure: invalidate the request, terminate the worker, switch to Greedy **permanently for that game**, append **one** visible log warning, and play Greedy against the current state under the same pacing deadline. |
| D2-7 | **The iteration budget is measured in the browser** | D1's 200 was an implementation default, never calibrated. Measure, choose, and record the number with the machine and browser it came from. If the browser budget lands well below 200, **the opponent a human faces is weaker than the one D1 measured**, and that gets said. |
| D2-8 | Not in scope | Any change to the search, its keys or its evaluation; a worker pool or parallel search; C3's ability clauses. |

## Build hazard: partly cleared, and the rest is an acceptance gate

A throwaway worker importing `searchIsmcts` resolved the raw-TypeScript workspace packages in both modes:
dev logged `worker sees searchIsmcts as: function`, and `vite build` emitted a **52 kB worker chunk**
separate from the 275 kB app chunk. `new Worker(new URL(…, import.meta.url), { type: 'module' })` is Vite's
supported static form, and linked monorepo packages exporting ESM are treated as source.

**That proves the chunk is emitted, not that it loads and runs when served** — revision 1 claimed the hazard
"cleared", which was too strong. `server.fs.allow` is dev-only; production takes a different bundler path,
and hashed asset loading, MIME and base-path failures all live there. Hence D2-A7 below.

## Acceptance criteria

- **D2-A1** The browser plays a **full game to a result** against ISMCTS, end to end, no uncaught errors.
- **D2-A2 (honest non-blocking measurement)** On a **production preview**, over N AI decisions: mark
  request-post, response and commit; observe **`longtask` entries** (any reported entry is ≥ 50 ms by
  definition); record the **maximum `requestAnimationFrame` gap**; inject a harmless test button and record
  **input-to-handler** while a search is active. Report browser, machine, iterations, sample count, max long
  task, max frame gap, max input delay, and worker round-trip p50/p95 — plus the request's serialized size
  and posting duration (D2-2). *"No main-thread task ≥ 50 ms during N AI searches"* is a result;
  *"well under 600 ms"* is not, and was revision 1's wording.
- **D2-A3 (determinism across the boundary)** The same `(view, seed, iterations, caps)` through `respond`
  returns exactly the command a direct `searchIsmcts` call returns.
- **D2-A4 (staleness, at the right layer)** Tested against the **coordinator**, not `respond`: deferred
  replies delivered after a restart, after a human commit (including concede), after StrictMode cleanup, and
  after unmount must all be dropped, and the worker terminated on unmount.
- **D2-A5 (fallback)** Each detectable failure — no `Worker`, constructor throw, clone failure, `error`,
  `messageerror`, typed error, and a never-replying worker — switches to Greedy, logs **one** warning, and
  still finishes a game.
- **D2-A6** The chosen iteration budget is recorded with the measurement that produced it.
- **D2-A7** `pnpm test`, `pnpm typecheck`, `pnpm lint` **and `pnpm --filter @fftcg/web build`** green, plus
  a **production-preview** browser run that loads the emitted worker asset, completes a real `postMessage`
  round trip, and asserts ISMCTS is actually playing rather than the fallback. Headless gates untouched
  (462 tests, ISMCTS 90.0 % vs greedy, strict fuzzer 0 failures).

## Risks

- **Staleness is intermittent by nature**, and it is the reason for the coordinator layer. A late result
  applied to a moved-on board corrupts a game rarely and unreproducibly.
- **The fallback can hide itself.** If the worker silently fails the game keeps working and simply plays
  worse — hence one visible warning, and hence D2-A7 asserting ISMCTS rather than merely "a game happened".
- **Seed drift between dev and prod** (D2-3) would be diagnosed as a search bug and is not one.
- **D1's caveats stand**: the iteration budget was never strength-calibrated, and rollouts are ~117× the
  tree cost.

## Changelog vs revision 1

- **Three-layer architecture with a `SearchCoordinator`** — revision 1 put lifecycle, retries, watchdog and
  fallback into a `useEffect`, where none of the races could be tested.
- **Staleness moved to the coordinator** with the four-condition acceptance rule (D2-4); revision 1 tested
  it against pure `respond`, which cannot see any of it.
- **Stable per-position seeds** (D2-3) — new; revision 1 left seed allocation undefined.
- **Fallback detection enumerated**, including the watchdog for a worker that never replies (D2-6).
- **D2-A2 replaced with an actual measurement protocol**; the old criterion was unfalsifiable.
- **Production build and preview added to D2-A7**; the dev probe proved emission, not execution.
- **Wire contract completed** — discriminated union, config at init, `requestId` on errors, plain strings.
- **Pacing restated as a deadline** (D2-5).

## Measurement (D2-A2 / D2-A6 / D2-A7), taken 2026-08-27

Revised after a Codex code review that found four claims here overstated. The corrections are kept visible
rather than silently applied, because each one is a way this measurement could have flattered itself.

Harness: `apps/web/scripts/measure-worker.js`, committed so the run is reproducible. Production preview
(`vite build` + `vite preview --port 5310`), Chromium, Apple Silicon (darwin 25.5.0), **200 iterations**,
`rolloutCommandCap` 24, `rolloutApplyCap` 2048. Two complete games, driven to a result.

| Quantity | Run A (page driver only) | Run B (+ real trusted clicks) |
|---|---|---|
| Searches posted / results received / **AI commands committed** | **36 / 36 / 36** | **40 / 40 / 40** |
| Worker errors, search fallback warnings | 0, none | 0, none |
| Worker round trip, p50 / p95 / max | **110 / 187 / 241 ms** | 265 / 541 / 577 ms |
| `longtask` entries (each would be ≥ 50 ms) | **0** | **0** |
| Max `requestAnimationFrame` gap | **22 ms** | 387 ms |
| Input delay, real trusted clicks | not sampled | **max 1 ms**, n = 10 |
| Search request serialized size, median / max | 14.6 / 15.7 kB | 14.7 / 15.9 kB |
| `postMessage` main-thread cost, max | 0.20 ms | 0.20 ms |

The worker asset is served and executed: `GET /assets/worker-DkZKnaJU.js → 200`, the hashed 52.8 kB
production chunk, one `Worker` constructed per game.

**Why the two runs disagree, which matters more than either number.** Run B's driver clicks the page through
CDP while the game plays; that external automation is itself main-thread work, and it inflates both the round
trips and the frame gap. Run A is the app measured undisturbed. The frame-gap metric is therefore only
trustworthy when nothing outside the page is touching it — worth knowing before anyone reads a future 387 ms
as a regression.

**What the numbers support, stated no more strongly than that.** Zero `longtask` entries across **76 searches**
means *no main-thread task of 50 ms or more was observed* — not that the main thread was never blocked. Since
the search is synchronous and each one took 110–577 ms, running it on the main thread would certainly have
registered long tasks and stretched the frame gap past its own duration; neither happened. That is strong
evidence the search executed off-thread, and it is the claim being made.

**D2-A7 asserted positively, with commit correlation.** Posts and results alone cannot carry "ISMCTS played
this game" — a result dropped as stale or refused as illegal still counts as received. Counting committed AI
commands from the log closes that: **posted = received = committed** in both runs, with zero worker errors and
zero fallback warnings. Every AI move in both games came from the search.

**D2-2 measured, and correctly attributed.** 14.6 kB is the size of the **whole search request**, not the
incremental cost of `defs`; attributing it to `defs` alone (as the previous revision did) overstates that
field's cost. What is directly measured is the main-thread price of sending it: **0.20 ms**. That is
negligible, so `Omit<PlayerView,'defs'>` stays unnecessary — and if the catalogue ever grows, the honest
experiment is to measure again with the field removed.

**D2-A6: the budget does not need reducing.** At 200 iterations a decision costs p50 110 ms undisturbed,
comfortably inside the 600 ms pacing deadline. The risk the spec raised — that the browser would force a
smaller budget and hand the human a weaker opponent than the 90.0 % one D1 measured — did not materialise.
Note these round trips are **below** D1's headless ~254 ms/decision rather than bracketing it, with only Run
B's contended maximum crossing that figure. The budget still has not been *strength*-calibrated (D1's caveat
stands); what is now known is that the browser is not what would force it down.

**Post-fix re-verification (after the D2 code-review fixes).** A further production-preview game on the fixed
build: **34 posted / 34 received / 34 committed**, zero worker errors, zero fallback warnings, zero `longtask`
entries, max rAF gap 20 ms. Round trips were slower in that run (p50 455 ms) because the machine was running
the test suite and fuzzer at the same time — recorded rather than re-run until the number looked better, and
it also shows the pacing deadline absorbing a loaded machine without tripping the fallback.

**A trap the harness now refuses to fall into.** The app builds its worker lazily on the first AI decision, so
instrumentation installed after page load loses a race whenever the AI moves first — and then reports
`0 posted / 0 received` beside a completed game with no fallback warning, which reads exactly like a worker
that never ran. Two of three runs hit this. `summarise` now returns `instrumentationValid: false` and refuses
the run. Any future D2 measurement showing zeros must be checked against that flag before it is believed.

**Corrections made to this section after review:**
- "the main thread was never blocked" → no task ≥ 50 ms was *observed*.
- "bracket D1's ~254 ms" → the round trips are *below* it; only a contended maximum crosses it.
- 14.2 kB attributed to `defs` → it is the whole request; the measured `defs`-related cost is the 0.20 ms post.
- posts + results offered as proof ISMCTS played → replaced with posts = results = **commits**.
- An earlier input-delay figure came from synthetic `.click()`, which dispatches synchronously and measures
  nothing. It was discarded; the figure above is real input read through `PerformanceEventTiming`.
