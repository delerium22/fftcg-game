<!-- codex=codex-cli 0.146.0 model=gpt-5.6-sol effort=xhigh cwd=/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai exit=0 head=b22be0f -->

## BLOCKER

**Staleness is tested at the wrong boundary; `respond()` cannot prove that React drops stale results.**

`respond(init, request)` is pure and synchronous, so it has no knowledge of the outstanding request or current game state (`docs/superpowers/specs/2026-08-27-rung-d2-search-worker.md:19`). Yet D2-A4 proposes testing staleness by driving `respond` out of order (`docs/superpowers/specs/2026-08-27-rung-d2-search-worker.md:35`). The vulnerable operation is `commit`, which unconditionally replaces `stateRef.current` and appends logs (`apps/web/src/game/useGame.ts:253`). A reply can race:

- `restart()` replacing `stateRef.current` before React runs effect cleanup (`apps/web/src/game/useGame.ts:274`).
- Any human `choose()` that commits another state (`apps/web/src/game/useGame.ts:262`); notably, concede remains legal even when the human is not acting (`packages/engine/src/legal.ts:19`).
- StrictMode’s effect setup/cleanup/setup cycle (`apps/web/src/main.tsx:8`, `apps/web/src/game/useGame.ts:285`).
- Unmount, after which the callback must not call `commit`.

**Fix:** The minimum acceptance rule is:

```ts
mounted &&
activeRequestId === result.requestId &&
stateRef.current === requestedState &&
actingPlayer(requestedState) === AI
```

Then clear the active request before applying, re-check the command against `legalCommands(requestedState, AI)`, and commit from that same state. Every restart, external commit, effect cleanup, and unmount must synchronously invalidate the active ID; unmount must also terminate the worker. Test the main-thread receiver/controller with deferred replies after restart, human commit, StrictMode cleanup, and unmount. Keep `respond` testing only deterministic translation.

**Search seeds must be stable per game position, not consumed per effect/request attempt.**

The protocol carries a seed but never defines its allocation (`docs/superpowers/specs/2026-08-27-rung-d2-search-worker.md:17`). The synchronous agent currently advances its RNG once per actual decision (`packages/ai/src/ismcts/agent.ts:64`). A naïve worker port that advances a ref when the effect posts will consume an extra seed during StrictMode, retries, stale requests, or worker replacement (`apps/web/src/game/useGame.ts:285`). Development and production can therefore choose different moves from the same game.

**Fix:** Derive the search seed from `(gameSeed, committedAiDecisionIndex)`, or cache one seed against the captured state generation. Increment the decision index only when an AI command successfully commits; retries of the same position must resend the same seed. Do not derive it from `requestId`.

## MAJOR

**The Vite worker form and raw workspace TypeScript are sound, but production worker bundling is not an acceptance gate.**

`new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })` is Vite’s supported static form, and Vite emits it as a separate production chunk. Linked monorepo packages are treated as source when they export ESM, which these do (`packages/ai/package.json:5`, `packages/engine/package.json:5`). `server.fs.allow: ['../..']` correctly covers them in development (`apps/web/vite.config.ts:4`), but that option is dev-only; production uses the separate bundler path. See the [Vite worker documentation](https://vite.dev/guide/features#web-workers), [linked-dependency behavior](https://vite.dev/guide/dep-pre-bundling.html#monorepos-and-linked-dependencies), and [`server.fs.allow`](https://vite.dev/config/server-options.html#server-fs-allow).

The divergence hazard is therefore not a known incompatibility—it is that D2-A7 runs tests/typecheck/lint but no web build (`docs/superpowers/specs/2026-08-27-rung-d2-search-worker.md:40`). A dev probe cannot catch production chunk generation, hashed asset loading, or deployment MIME/base-path failures.

**Fix:** Add `pnpm --filter @fftcg/web build` and a production-preview browser test. It must load the emitted worker asset, complete at least one real request through `postMessage`, assert the ISMCTS log/status rather than fallback, and ideally finish D2-A1’s game. Keep `respond` unit tests, but do not call them a worker-boundary test.

**`GreedyAgent` is the correct fallback; D2-6 does not yet detect every failure it claims to survive.**

Running reduced ISMCTS on the main thread still invokes a pure synchronous search (`packages/ai/src/ismcts/search.ts:467`) whose rollout cost is variable and only work-capped (`packages/ai/src/ismcts/search.ts:53`). That would weaken the central non-blocking guarantee. Greedy is already the browser-safe, sub-millisecond path (`apps/web/src/game/useGame.ts:11`, `apps/web/src/game/useGame.ts:235`).

Detection must cover more than `Worker` absence and `error` events:

- Missing `Worker`, constructor failure, and synchronous `postMessage` clone failure.
- Module-load or uncaught worker failures via `error`.
- Deserialization via `messageerror`.
- Caught `searchIsmcts` exceptions via typed `WorkerError`.
- A worker that is killed or hangs and simply never returns; this needs a deadline because no correlated result is guaranteed.

**Fix:** Install listeners before init, catch construction/posting, handle `error`, `messageerror`, and typed errors, plus a generous per-request/startup watchdog. On failure: invalidate the request, terminate the worker, switch permanently to Greedy for that game, append one visible warning, and run Greedy against the current state under the same pacing deadline.

**D2-A2 is not yet an honest measurement, and the board deliberately exposes no useful button during AI control.**

The criterion asks for the longest task and a responsive click (`docs/superpowers/specs/2026-08-27-rung-d2-search-worker.md:30`), but `GameApi` describes the board as inert while thinking (`apps/web/src/game/types.ts:45`), and `PromptStrip` renders actions only when the human owns the decision (`apps/web/src/ui/PromptStrip.tsx:36`, `apps/web/src/ui/PromptStrip.tsx:62`).

**Fix:** Measure a production preview in a foreground browser over multiple AI decisions:

- Mark request-post, response, and commit times.
- Observe `longtask` entries during those intervals; any reported entry is at least 50 ms by definition ([Long Tasks API](https://www.w3.org/TR/longtasks-1/)).
- Record maximum `requestAnimationFrame` gap to catch visible jank.
- Inject a harmless test button whose trusted click toggles a counter; record input-to-handler and input-to-next-paint while search is active.
- Report browser, machine, iterations, sample count, max long task/frame gap/input delay, and worker round-trip p50/p95.

“No main-thread task ≥50 ms during N AI searches” is a meaningful result; “well under 600 ms” is not.

## MINOR

**D2-1 names messages but does not completely specify the wire contract.**

`SearchInput` also requires `rolloutCommandCap` and `explorationC` (`packages/ai/src/ismcts/keys.ts:491`), while D2’s request lists only seed and iterations (`docs/superpowers/specs/2026-08-27-rung-d2-search-worker.md:17`). `WorkerError` also needs correlation semantics.

**Fix:** Use discriminated unions such as `type: 'init' | 'search' | 'result' | 'error'`. Put stable search configuration in init or explicitly state that `respond` supplies the exported defaults. Give request errors their `requestId`; initialization errors should use `requestId: null`. Post plain error strings, not raw `Error` objects.

**D2-5 is correct, but “apply at `max(elapsed, AI_STEP_MS)`” should be written as a deadline calculation.**

The existing loop performs one command, commits its new state, and only then reruns the effect (`apps/web/src/game/useGame.ts:285`). With one accepted request per state, steps do not overlap: if AI still acts, the next render starts the next search; otherwise the loop stops.

**Fix:** Define `notBefore = startedAt + AI_STEP_MS`, then after the result arrives schedule for `Math.max(0, notBefore - performance.now())`. A cached result therefore waits 600 ms; a 750 ms search applies immediately after 750 ms of visible thinking. Avoid wording that could be implemented as an additional `max(elapsed, 600)` delay.

**Keeping `defs` in each request is defensible; stripping them now would be over-built.**

`PlayerView` intentionally carries definitions (`packages/engine/src/view.ts:6`), the UI needs them for names and ability prompts (`apps/web/src/game/useGame.ts:19`, `apps/web/src/game/commands.ts:73`), and all ability data is explicitly structured-cloneable (`packages/engine/src/abilities.ts:5`). The search already clones a state containing the same definitions once per determinisation (`packages/engine/src/determinise.ts:49`), so one extra request transfer of an 18-card catalogue is not the dominant cost.

This adequately answers the prior D1 MEDIUM: the actual missing protocol and repeated decks are fixed, while the definitions optimization is consciously deferred.

**Fix:** Keep the current `PlayerView` shape, but replace “measured as negligible” with the actual serialized size and main-thread posting duration from D2-A2. Revisit `Omit<PlayerView, 'defs'>` plus worker rehydration only when the card catalogue materially grows.

## WHAT I WOULD DO DIFFERENTLY

**Put a small testable coordinator between React and the worker instead of wiring message handlers directly into `useEffect`.**

The hook currently combines state ownership, pacing, mutation, and the synchronous agent loop (`apps/web/src/game/useGame.ts:242`). D2 adds lifecycle, retries, watchdogs, fallback, and stale-result handling; keeping all of that in the effect will make the races hard to test.

**Fix:** Use three layers:

1. `protocol.ts` — discriminated messages and pure `respond`.
2. `worker.ts` — init storage, try/catch, and `postMessage` only.
3. `SearchCoordinator` — one worker per mounted hook, generation/request tracking, stable per-position seeds, pacing deadline, watchdog, termination, and Greedy fallback.

Have `useGame` capture a state, ask the coordinator for a command, then perform the existing legality check and narration against that exact state. This preserves the D1 search core and makes every D2-specific race testable without React timing folklore.
