# Rung D2 — The search in a Web Worker: the browser gets the strong opponent

## Context

D1 is merged (`b22be0f`): headless SO-ISMCTS beats `GreedyAgent` **90.0 %** over 120 mirrored games at
~254 ms/decision. **The browser still plays `GreedyAgent`** — D1 was headless by design, because 254 ms of
synchronous search would block the main thread and freeze the board mid-turn.

D2 is the wiring, and only the wiring. The search core does not change: `searchIsmcts(input): SearchResult`
is already pure, synchronous and structured-cloneable, which is exactly what D1 was told to leave behind so
this rung would not have to rewrite it.

## Decisions

| # | Decision | Ruling (and why) |
|---|---|---|
| D2-1 | A **typed worker protocol**, not ad-hoc `postMessage` | `WorkerInit` (the two declared deck lists, sent once), `WorkerSearchRequest` (`requestId`, `view`, `seed`, `iterations`), `WorkerSearchResult` (`requestId`, `command`, `diagnostics`) and `WorkerError`. Every one structured-cloneable. Codex's D1 review flagged that the seam *promised* this and did not have it. |
| D2-2 | **Decks at init; the view per request** | Decks are what the search needs and the view does not carry. `PlayerView` already carries `defs`, so a request re-sends the 18-card catalogue — measured as negligible against a 600 ms turn, so **it is left alone**. Stripping `defs` and rehydrating in the worker is available if measurement ever says otherwise; doing it now would be optimising a cost nobody has shown. |
| D2-3 | **A pure `respond(init, request)` the worker merely wraps** | The same trick that made D1 testable: all protocol logic lives in a plain function, and `worker.ts` is a thin `onmessage` shell. Vitest cannot drive a real `Worker`, so anything inside the shell is untestable — the shell therefore contains nothing worth testing. |
| D2-4 | **Requests are generation-checked; stale results are dropped** | `requestId` increases monotonically; the hook ignores any result that is not the one it is waiting for. Restarting a game, or the human acting while the AI thinks, must not have a late result applied to a board that has moved on. This is the defect most likely to be *intermittent* rather than reproducible, so it gets an explicit test rather than an inspection. |
| D2-5 | **Search overlaps the pacing delay, never adds to it** | B7 paces the AI at 600 ms so its turn is watchable. Firing the request *then* waiting 600 ms would make every AI move 850 ms. Start the search immediately and apply the result at `max(elapsed, AI_STEP_MS)`, so the search is free until it exceeds the pacing budget. |
| D2-6 | **Fall back to `GreedyAgent`, and say so** | If `Worker` is unavailable, the module fails to load, or the worker errors, the game continues with the heuristic agent rather than freezing or silently blocking the main thread. It must be **visible in the log** — an opponent quietly one-tenth as strong is exactly the kind of degradation that goes unnoticed for a rung. |
| D2-7 | **The iteration budget is measured in the browser, not inherited** | D1's 200 was an implementation default chosen to be "clearly above greedy without being unusable headless", never calibrated. D2 measures ms/iteration in a real browser and picks a budget for a decision that comfortably fits the pacing window, then records the number and the machine it came from. |
| D2-8 | Not in scope | Any change to the search itself, its keys or its evaluation; a worker pool or parallel search; C3's ability clauses. |

## Build hazard: cleared before designing around it

The spec's main unknown was whether a Vite worker resolves the workspace packages, which are published as
**raw TypeScript** (`main: src/index.ts`) and reached out of the monorepo root via `server.fs.allow`. A
throwaway worker importing `searchIsmcts` was built and run in both modes:

- **dev**: logged `worker sees searchIsmcts as: function`;
- **production**: `vite build` emitted `dist/assets/probe.worker-*.js` at **52 kB** — the search bundled
  into its own worker chunk, separate from the 275 kB app chunk.

So `new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })` works, and there is **no
dev/prod divergence** on resolution. Recorded because a passing dev check alone would not have shown it,
and because the failure mode this rung most fears is a worker that builds and then silently falls back.

## Acceptance criteria

- **D2-A1** The browser plays a **full game to a result** against ISMCTS, driven end to end, with no
  uncaught errors.
- **D2-A2** **The main thread is not blocked.** Measured, not asserted: the longest task during an AI turn
  stays well under the pacing window, and the board stays responsive to a click while the AI is thinking.
- **D2-A3** **Determinism across the boundary**: the same `(view, seed, iterations)` through `respond`
  returns exactly the command a direct `searchIsmcts` call returns. The worker must not be a second,
  subtly different agent.
- **D2-A4** **Staleness**: a result whose `requestId` is not the outstanding one is dropped. Tested by
  driving `respond` out of order, not by hoping the race does not happen.
- **D2-A5** **Fallback**: with `Worker` unavailable the game still plays a full game, using `GreedyAgent`,
  and the log says which opponent is playing.
- **D2-A6** The chosen iteration budget is recorded with the measurement that produced it.
- **D2-A7** `pnpm test`, `pnpm typecheck`, `pnpm lint` green; the headless gates are untouched
  (462 tests, ISMCTS 90.0 % vs greedy, strict fuzzer 0 failures).

## Risks

- **Staleness is intermittent by nature.** A late result applied to a moved-on board would corrupt the game
  rarely and unreproducibly — the worst failure shape there is. D2-A4 is the mitigation and it must be a
  test, not a code reading.
- **The fallback can hide itself.** If the worker silently fails, the game keeps working and simply plays
  worse. Hence D2-6's requirement that it be visible in the log.
- **Vite worker bundling.** `new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })` is the
  supported form; the workspace packages are raw TypeScript, so the worker bundle must resolve them the same
  way the app does. A worker that fails to build is loud; one that builds but silently falls back is not.
- **The search is unchanged, so its D1 caveats stand**: the iteration budget was never strength-calibrated,
  and rollouts are ~117× the tree cost. If the browser budget lands well below 200 iterations, the opponent
  the human faces is weaker than the one D1 measured — and that must be stated, not assumed away.
