Reading additional input from stdin...
OpenAI Codex v0.146.0
--------
workdir: /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
model: gpt-5.6-sol
provider: openai
approval: never
sandbox: read-only
reasoning effort: xhigh
reasoning summaries: none
session id: 01a041ce-37f3-76d0-993f-2d59b6058934
--------
user
Adversarial CODE review of an implemented rung, against its own spec. TypeScript pnpm monorepo implementing
a subset of the Final Fantasy TCG. You plan-reviewed this spec already; this is the implementation.

READ FIRST:
- `docs/superpowers/specs/2026-08-27-rung-d2-search-worker.md` — the spec, INCLUDING the "Measurement" section
  appended after implementation.
- `docs/superpowers/plans/2026-08-27-rung-d2-search-worker.codex-review.md` — your own plan review.
- The implementation: `apps/web/src/game/search/protocol.ts`, `worker.ts`, `coordinator.ts`;
  `apps/web/src/game/useGame.ts` (how the coordinator is driven and how commands are committed).
- The tests: `apps/web/test/search-coordinator.test.ts`, `apps/web/test/search-protocol.test.ts`.
- For context: `packages/ai/src/ismcts/search.ts`, `keys.ts`, `agent.ts`.

Diff to review: the most recent commits on branch `worktree-rung-d2-worker` (`git log --oneline -3`).

WHAT I WANT, concrete, with `path:line`:

1. **The coordinator's race handling.** This is the whole point of the layer. Both of my own verifiers found
   one HIGH here already (the failure funnel could invalidate everything and then return without scheduling
   any move — a permanent silent hang). I fixed it: `fail()` now captures a recovery target before
   invalidating, refuses to cancel an already-scheduled fallback move, and a dropped stale result now
   releases its watchdog. **Assume there are more.** Enumerate every interleaving of {result, error,
   messageerror, watchdog fire, state change, restart, unmount, human concede mid-search} that ends with
   either (a) no move ever scheduled, (b) two moves scheduled for one decision, or (c) a move applied to a
   state it was not searched against.

2. **Seeds (D2-3).** `decisionIndex` advances before the handler runs and rolls back if the commit is
   rejected. Is that actually order-independent, and can any path consume the same seed twice or skip one in
   a way that matters?

3. **D2-4's four conditions.** Are they checked at the right moments, and is anything checked against a
   value that could have changed since capture? Note `concede` is legal for the human even when the AI is
   the acting player.

4. **Does the fallback really cover every enumerated failure mode** in D2-6, including a worker that is
   killed or simply never replies? Is one and only one warning guaranteed?

5. **The measurement section.** I claim the main thread was never blocked, on the strength of zero
   `longtask` entries and a 19-22 ms max rAF gap. Is that inference sound, and is any number there
   overstated or measuring the wrong thing? I already threw out one bogus figure (synthetic clicks).

6. **Anything over-built or missing** for the next rung (C3 abilities: deck search/reveal, and Cloud's
   attack-phase clause).

FORMAT: `## HIGH`, `## MEDIUM`, `## LOW`, then `## WHAT I WOULD DO DIFFERENTLY`. Each item: bold one-line
claim, evidence with `path:line`, concrete **Fix:**. Do not pad — if something is sound, one line and move on.
codex
I’ll treat this as a read-only adversarial review. I’m starting with the spec, prior plan review, target diff, and exact line-numbered implementation/tests; then I’ll model the coordinator as an event/state machine and verify each claimed failure interleaving.
exec
/bin/zsh -lc "pwd && rg --files -g 'AGENTS.md' -g '"'!node_modules'"' -g '"'!dist'"' && git status --short && git log --oneline -3" in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 exited 1 in 0ms:
/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai

exec
/bin/zsh -lc "rg --files | rg '("'^|/)AGENTS'"\\.md"'$'"' || true
git status --short
git log --oneline -3" in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-7JlXhX85' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-kNRjKbG7' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-Bv90OK2m' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-2RIpwN2p' (errno=Operation not permitted)
968d2da docs(web): record the D2 browser measurement — worker verified, budget unreduced
5ba59b0 feat(web): rung D2 — the ISMCTS search runs in a Web Worker
2b01a06 docs(ai): rung D2 spec — revised after Codex plan-review

exec
/bin/zsh -lc "wc -l 'apps/web/src/game/useGame.ts'" in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
exec
/bin/zsh -lc "wc -l 'apps/web/src/game/search/worker.ts'" in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
exec
/bin/zsh -lc "wc -l 'packages/ai/src/ismcts/keys.ts'" in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
     388 apps/web/src/game/useGame.ts

 succeeded in 0ms:
      42 apps/web/src/game/search/worker.ts

 succeeded in 0ms:
     517 packages/ai/src/ismcts/keys.ts

exec
/bin/zsh -lc "wc -l 'apps/web/src/game/search/coordinator.ts'" in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
     370 apps/web/src/game/search/coordinator.ts

exec
/bin/zsh -lc "wc -l 'apps/web/src/game/search/protocol.ts'" in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
      79 apps/web/src/game/search/protocol.ts

exec
/bin/zsh -lc "wc -l 'apps/web/test/search-coordinator.test.ts'" in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
     606 apps/web/test/search-coordinator.test.ts

exec
/bin/zsh -lc "wc -l 'packages/ai/src/agent.ts'" in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
      26 packages/ai/src/agent.ts

exec
/bin/zsh -lc "wc -l 'packages/ai/src/ismcts/search.ts'" in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
exec
/bin/zsh -lc "wc -l 'apps/web/test/search-protocol.test.ts'" in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
      89 apps/web/test/search-protocol.test.ts

 succeeded in 0ms:
     470 packages/ai/src/ismcts/search.ts

exec
/bin/zsh -lc "wc -l 'docs/superpowers/plans/2026-08-27-rung-d2-search-worker.codex-review.md'" in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
     103 docs/superpowers/plans/2026-08-27-rung-d2-search-worker.codex-review.md

exec
/bin/zsh -lc "wc -l 'docs/superpowers/specs/2026-08-27-rung-d2-search-worker.md'" in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
     142 docs/superpowers/specs/2026-08-27-rung-d2-search-worker.md

exec
/bin/zsh -lc 'nl -ba docs/superpowers/plans/2026-08-27-rung-d2-search-worker.codex-review.md' in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
exec
/bin/zsh -lc 'nl -ba docs/superpowers/specs/2026-08-27-rung-d2-search-worker.md' in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
     1	<!-- codex=codex-cli 0.146.0 model=gpt-5.6-sol effort=xhigh cwd=/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai exit=0 head=b22be0f -->
     2	
     3	## BLOCKER
     4	
     5	**Staleness is tested at the wrong boundary; `respond()` cannot prove that React drops stale results.**
     6	
     7	`respond(init, request)` is pure and synchronous, so it has no knowledge of the outstanding request or current game state (`docs/superpowers/specs/2026-08-27-rung-d2-search-worker.md:19`). Yet D2-A4 proposes testing staleness by driving `respond` out of order (`docs/superpowers/specs/2026-08-27-rung-d2-search-worker.md:35`). The vulnerable operation is `commit`, which unconditionally replaces `stateRef.current` and appends logs (`apps/web/src/game/useGame.ts:253`). A reply can race:
     8	
     9	- `restart()` replacing `stateRef.current` before React runs effect cleanup (`apps/web/src/game/useGame.ts:274`).
    10	- Any human `choose()` that commits another state (`apps/web/src/game/useGame.ts:262`); notably, concede remains legal even when the human is not acting (`packages/engine/src/legal.ts:19`).
    11	- StrictMode’s effect setup/cleanup/setup cycle (`apps/web/src/main.tsx:8`, `apps/web/src/game/useGame.ts:285`).
    12	- Unmount, after which the callback must not call `commit`.
    13	
    14	**Fix:** The minimum acceptance rule is:
    15	
    16	```ts
    17	mounted &&
    18	activeRequestId === result.requestId &&
    19	stateRef.current === requestedState &&
    20	actingPlayer(requestedState) === AI
    21	```
    22	
    23	Then clear the active request before applying, re-check the command against `legalCommands(requestedState, AI)`, and commit from that same state. Every restart, external commit, effect cleanup, and unmount must synchronously invalidate the active ID; unmount must also terminate the worker. Test the main-thread receiver/controller with deferred replies after restart, human commit, StrictMode cleanup, and unmount. Keep `respond` testing only deterministic translation.
    24	
    25	**Search seeds must be stable per game position, not consumed per effect/request attempt.**
    26	
    27	The protocol carries a seed but never defines its allocation (`docs/superpowers/specs/2026-08-27-rung-d2-search-worker.md:17`). The synchronous agent currently advances its RNG once per actual decision (`packages/ai/src/ismcts/agent.ts:64`). A naïve worker port that advances a ref when the effect posts will consume an extra seed during StrictMode, retries, stale requests, or worker replacement (`apps/web/src/game/useGame.ts:285`). Development and production can therefore choose different moves from the same game.
    28	
    29	**Fix:** Derive the search seed from `(gameSeed, committedAiDecisionIndex)`, or cache one seed against the captured state generation. Increment the decision index only when an AI command successfully commits; retries of the same position must resend the same seed. Do not derive it from `requestId`.
    30	
    31	## MAJOR
    32	
    33	**The Vite worker form and raw workspace TypeScript are sound, but production worker bundling is not an acceptance gate.**
    34	
    35	`new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })` is Vite’s supported static form, and Vite emits it as a separate production chunk. Linked monorepo packages are treated as source when they export ESM, which these do (`packages/ai/package.json:5`, `packages/engine/package.json:5`). `server.fs.allow: ['../..']` correctly covers them in development (`apps/web/vite.config.ts:4`), but that option is dev-only; production uses the separate bundler path. See the [Vite worker documentation](https://vite.dev/guide/features#web-workers), [linked-dependency behavior](https://vite.dev/guide/dep-pre-bundling.html#monorepos-and-linked-dependencies), and [`server.fs.allow`](https://vite.dev/config/server-options.html#server-fs-allow).
    36	
    37	The divergence hazard is therefore not a known incompatibility—it is that D2-A7 runs tests/typecheck/lint but no web build (`docs/superpowers/specs/2026-08-27-rung-d2-search-worker.md:40`). A dev probe cannot catch production chunk generation, hashed asset loading, or deployment MIME/base-path failures.
    38	
    39	**Fix:** Add `pnpm --filter @fftcg/web build` and a production-preview browser test. It must load the emitted worker asset, complete at least one real request through `postMessage`, assert the ISMCTS log/status rather than fallback, and ideally finish D2-A1’s game. Keep `respond` unit tests, but do not call them a worker-boundary test.
    40	
    41	**`GreedyAgent` is the correct fallback; D2-6 does not yet detect every failure it claims to survive.**
    42	
    43	Running reduced ISMCTS on the main thread still invokes a pure synchronous search (`packages/ai/src/ismcts/search.ts:467`) whose rollout cost is variable and only work-capped (`packages/ai/src/ismcts/search.ts:53`). That would weaken the central non-blocking guarantee. Greedy is already the browser-safe, sub-millisecond path (`apps/web/src/game/useGame.ts:11`, `apps/web/src/game/useGame.ts:235`).
    44	
    45	Detection must cover more than `Worker` absence and `error` events:
    46	
    47	- Missing `Worker`, constructor failure, and synchronous `postMessage` clone failure.
    48	- Module-load or uncaught worker failures via `error`.
    49	- Deserialization via `messageerror`.
    50	- Caught `searchIsmcts` exceptions via typed `WorkerError`.
    51	- A worker that is killed or hangs and simply never returns; this needs a deadline because no correlated result is guaranteed.
    52	
    53	**Fix:** Install listeners before init, catch construction/posting, handle `error`, `messageerror`, and typed errors, plus a generous per-request/startup watchdog. On failure: invalidate the request, terminate the worker, switch permanently to Greedy for that game, append one visible warning, and run Greedy against the current state under the same pacing deadline.
    54	
    55	**D2-A2 is not yet an honest measurement, and the board deliberately exposes no useful button during AI control.**
    56	
    57	The criterion asks for the longest task and a responsive click (`docs/superpowers/specs/2026-08-27-rung-d2-search-worker.md:30`), but `GameApi` describes the board as inert while thinking (`apps/web/src/game/types.ts:45`), and `PromptStrip` renders actions only when the human owns the decision (`apps/web/src/ui/PromptStrip.tsx:36`, `apps/web/src/ui/PromptStrip.tsx:62`).
    58	
    59	**Fix:** Measure a production preview in a foreground browser over multiple AI decisions:
    60	
    61	- Mark request-post, response, and commit times.
    62	- Observe `longtask` entries during those intervals; any reported entry is at least 50 ms by definition ([Long Tasks API](https://www.w3.org/TR/longtasks-1/)).
    63	- Record maximum `requestAnimationFrame` gap to catch visible jank.
    64	- Inject a harmless test button whose trusted click toggles a counter; record input-to-handler and input-to-next-paint while search is active.
    65	- Report browser, machine, iterations, sample count, max long task/frame gap/input delay, and worker round-trip p50/p95.
    66	
    67	“No main-thread task ≥50 ms during N AI searches” is a meaningful result; “well under 600 ms” is not.
    68	
    69	## MINOR
    70	
    71	**D2-1 names messages but does not completely specify the wire contract.**
    72	
    73	`SearchInput` also requires `rolloutCommandCap` and `explorationC` (`packages/ai/src/ismcts/keys.ts:491`), while D2’s request lists only seed and iterations (`docs/superpowers/specs/2026-08-27-rung-d2-search-worker.md:17`). `WorkerError` also needs correlation semantics.
    74	
    75	**Fix:** Use discriminated unions such as `type: 'init' | 'search' | 'result' | 'error'`. Put stable search configuration in init or explicitly state that `respond` supplies the exported defaults. Give request errors their `requestId`; initialization errors should use `requestId: null`. Post plain error strings, not raw `Error` objects.
    76	
    77	**D2-5 is correct, but “apply at `max(elapsed, AI_STEP_MS)`” should be written as a deadline calculation.**
    78	
    79	The existing loop performs one command, commits its new state, and only then reruns the effect (`apps/web/src/game/useGame.ts:285`). With one accepted request per state, steps do not overlap: if AI still acts, the next render starts the next search; otherwise the loop stops.
    80	
    81	**Fix:** Define `notBefore = startedAt + AI_STEP_MS`, then after the result arrives schedule for `Math.max(0, notBefore - performance.now())`. A cached result therefore waits 600 ms; a 750 ms search applies immediately after 750 ms of visible thinking. Avoid wording that could be implemented as an additional `max(elapsed, 600)` delay.
    82	
    83	**Keeping `defs` in each request is defensible; stripping them now would be over-built.**
    84	
    85	`PlayerView` intentionally carries definitions (`packages/engine/src/view.ts:6`), the UI needs them for names and ability prompts (`apps/web/src/game/useGame.ts:19`, `apps/web/src/game/commands.ts:73`), and all ability data is explicitly structured-cloneable (`packages/engine/src/abilities.ts:5`). The search already clones a state containing the same definitions once per determinisation (`packages/engine/src/determinise.ts:49`), so one extra request transfer of an 18-card catalogue is not the dominant cost.
    86	
    87	This adequately answers the prior D1 MEDIUM: the actual missing protocol and repeated decks are fixed, while the definitions optimization is consciously deferred.
    88	
    89	**Fix:** Keep the current `PlayerView` shape, but replace “measured as negligible” with the actual serialized size and main-thread posting duration from D2-A2. Revisit `Omit<PlayerView, 'defs'>` plus worker rehydration only when the card catalogue materially grows.
    90	
    91	## WHAT I WOULD DO DIFFERENTLY
    92	
    93	**Put a small testable coordinator between React and the worker instead of wiring message handlers directly into `useEffect`.**
    94	
    95	The hook currently combines state ownership, pacing, mutation, and the synchronous agent loop (`apps/web/src/game/useGame.ts:242`). D2 adds lifecycle, retries, watchdogs, fallback, and stale-result handling; keeping all of that in the effect will make the races hard to test.
    96	
    97	**Fix:** Use three layers:
    98	
    99	1. `protocol.ts` — discriminated messages and pure `respond`.
   100	2. `worker.ts` — init storage, try/catch, and `postMessage` only.
   101	3. `SearchCoordinator` — one worker per mounted hook, generation/request tracking, stable per-position seeds, pacing deadline, watchdog, termination, and Greedy fallback.
   102	
   103	Have `useGame` capture a state, ask the coordinator for a command, then perform the existing legality check and narration against that exact state. This preserves the D1 search core and makes every D2-specific race testable without React timing folklore.

 succeeded in 0ms:
     1	# Rung D2 — The search in a Web Worker: the browser gets the strong opponent
     2	
     3	> Revision 2 (2026-08-27), after a Codex plan-review that found two blockers and corrected two claims of
     4	> mine. The review is `docs/superpowers/plans/2026-08-27-rung-d2-search-worker.codex-review.md`.
     5	
     6	## Context
     7	
     8	D1 is merged (`b22be0f`): headless SO-ISMCTS beats `GreedyAgent` **90.0 %** over 120 mirrored games at
     9	~254 ms/decision. **The browser still plays `GreedyAgent`** — D1 was headless by design, because 254 ms of
    10	synchronous search would freeze the board mid-turn.
    11	
    12	D2 is the wiring only. The search core does not change: `searchIsmcts(input): SearchResult` is already
    13	pure, synchronous and structured-cloneable, which is what D1 was told to leave behind.
    14	
    15	## Architecture: three layers, because the races must be testable
    16	
    17	Revision 1 put worker lifecycle, pacing, retries, fallback and stale-result handling into `useGame`'s AI
    18	`useEffect`. That hook already owns state, pacing, mutation and the agent loop; adding this to it would make
    19	every D2-specific race a matter of React timing folklore rather than a test.
    20	
    21	1. **`protocol.ts`** — discriminated message types and the pure `respond(init, request)`. Deterministic
    22	   translation only; no lifecycle, no knowledge of what is outstanding.
    23	2. **`worker.ts`** — a thin shell: store init, `try`/`catch`, `postMessage`. Vitest cannot drive a real
    24	   `Worker`, so the shell deliberately contains nothing worth testing.
    25	3. **`SearchCoordinator`** — one worker per mounted hook. Owns generation/request tracking, stable
    26	   per-position seeds, the pacing deadline, the watchdog, termination, and the `GreedyAgent` fallback.
    27	   **This is the layer the D2 tests target**, because this is where every race lives.
    28	
    29	`useGame` then does what it already does: capture a state, ask for a command, re-check legality against that
    30	exact state, narrate, commit.
    31	
    32	## Decisions
    33	
    34	| # | Decision | Ruling (and why) |
    35	|---|---|---|
    36	| D2-1 | A **discriminated wire contract** | `type: 'init' \| 'search' \| 'result' \| 'error'`. Init carries the two declared deck lists **and the stable search configuration** (`rolloutCommandCap`, `explorationC` — `SearchInput` requires them and revision 1's request listed only seed and iterations). Errors carry their `requestId`, or `null` for an init failure, and post **plain strings, never `Error` objects**. |
    37	| D2-2 | **Decks and config at init; the view per request** | `PlayerView` carries `defs` by design and the UI needs them; the search already clones a state containing the same definitions once per determinisation, so one 18-card catalogue per request is not the dominant cost. Revision 1 called this "measured as negligible" — **it was not measured**; D2-A2 now reports the actual serialized size and posting duration, and `Omit<PlayerView,'defs'>` is revisited only if the catalogue materially grows. |
    38	| D2-3 | **Search seeds are stable per game POSITION** | Derived from `(gameSeed, committedAiDecisionIndex)`, incremented **only when an AI command successfully commits**. Never from `requestId`. A seed advanced when the effect *posts* is consumed again by StrictMode's double-invoke, by a retry, by a stale request and by worker replacement — so dev and prod would choose different moves from the same board, which is the worst kind of "works on my machine". |
    39	| D2-4 | **A result is accepted only under all four conditions** | `mounted && activeRequestId === result.requestId && stateRef.current === requestedState && actingPlayer(requestedState) === AI`. Then clear the active id *before* applying, re-check the command against `legalCommands(requestedState, AI)`, and commit from that same captured state. Restart, any external commit, effect cleanup and unmount must **synchronously** invalidate the active id; unmount must also terminate the worker. Note the non-obvious racer: **concede is legal even when the human is not the acting player**, so a human `choose()` really can commit mid-AI-turn. |
    40	| D2-5 | **Pacing is a deadline, not an added delay** | `notBefore = startedAt + AI_STEP_MS`; when the result arrives, schedule at `Math.max(0, notBefore - performance.now())`. A fast search still waits out the 600 ms; a 750 ms search applies immediately, having already shown 750 ms of thinking. Revision 1's "apply at `max(elapsed, AI_STEP_MS)`" was ambiguous enough to be implemented as an *extra* 600 ms. |
    41	| D2-6 | **Fall back to `GreedyAgent`, detect every way it can fail, and say so** | Greedy, not reduced-iteration main-thread ISMCTS: the latter is still a synchronous search with variable rollout cost, which gives up the one guarantee this rung exists for. Detection must cover **missing `Worker`, constructor failure, synchronous `postMessage` clone failure, `error`, `messageerror`, a typed `WorkerError`, and a worker that is killed or hangs and simply never replies** — the last needs a startup and per-request **watchdog**, because nothing correlated ever arrives. On failure: invalidate the request, terminate the worker, switch to Greedy **permanently for that game**, append **one** visible log warning, and play Greedy against the current state under the same pacing deadline. |
    42	| D2-7 | **The iteration budget is measured in the browser** | D1's 200 was an implementation default, never calibrated. Measure, choose, and record the number with the machine and browser it came from. If the browser budget lands well below 200, **the opponent a human faces is weaker than the one D1 measured**, and that gets said. |
    43	| D2-8 | Not in scope | Any change to the search, its keys or its evaluation; a worker pool or parallel search; C3's ability clauses. |
    44	
    45	## Build hazard: partly cleared, and the rest is an acceptance gate
    46	
    47	A throwaway worker importing `searchIsmcts` resolved the raw-TypeScript workspace packages in both modes:
    48	dev logged `worker sees searchIsmcts as: function`, and `vite build` emitted a **52 kB worker chunk**
    49	separate from the 275 kB app chunk. `new Worker(new URL(…, import.meta.url), { type: 'module' })` is Vite's
    50	supported static form, and linked monorepo packages exporting ESM are treated as source.
    51	
    52	**That proves the chunk is emitted, not that it loads and runs when served** — revision 1 claimed the hazard
    53	"cleared", which was too strong. `server.fs.allow` is dev-only; production takes a different bundler path,
    54	and hashed asset loading, MIME and base-path failures all live there. Hence D2-A7 below.
    55	
    56	## Acceptance criteria
    57	
    58	- **D2-A1** The browser plays a **full game to a result** against ISMCTS, end to end, no uncaught errors.
    59	- **D2-A2 (honest non-blocking measurement)** On a **production preview**, over N AI decisions: mark
    60	  request-post, response and commit; observe **`longtask` entries** (any reported entry is ≥ 50 ms by
    61	  definition); record the **maximum `requestAnimationFrame` gap**; inject a harmless test button and record
    62	  **input-to-handler** while a search is active. Report browser, machine, iterations, sample count, max long
    63	  task, max frame gap, max input delay, and worker round-trip p50/p95 — plus the request's serialized size
    64	  and posting duration (D2-2). *"No main-thread task ≥ 50 ms during N AI searches"* is a result;
    65	  *"well under 600 ms"* is not, and was revision 1's wording.
    66	- **D2-A3 (determinism across the boundary)** The same `(view, seed, iterations, caps)` through `respond`
    67	  returns exactly the command a direct `searchIsmcts` call returns.
    68	- **D2-A4 (staleness, at the right layer)** Tested against the **coordinator**, not `respond`: deferred
    69	  replies delivered after a restart, after a human commit (including concede), after StrictMode cleanup, and
    70	  after unmount must all be dropped, and the worker terminated on unmount.
    71	- **D2-A5 (fallback)** Each detectable failure — no `Worker`, constructor throw, clone failure, `error`,
    72	  `messageerror`, typed error, and a never-replying worker — switches to Greedy, logs **one** warning, and
    73	  still finishes a game.
    74	- **D2-A6** The chosen iteration budget is recorded with the measurement that produced it.
    75	- **D2-A7** `pnpm test`, `pnpm typecheck`, `pnpm lint` **and `pnpm --filter @fftcg/web build`** green, plus
    76	  a **production-preview** browser run that loads the emitted worker asset, completes a real `postMessage`
    77	  round trip, and asserts ISMCTS is actually playing rather than the fallback. Headless gates untouched
    78	  (462 tests, ISMCTS 90.0 % vs greedy, strict fuzzer 0 failures).
    79	
    80	## Risks
    81	
    82	- **Staleness is intermittent by nature**, and it is the reason for the coordinator layer. A late result
    83	  applied to a moved-on board corrupts a game rarely and unreproducibly.
    84	- **The fallback can hide itself.** If the worker silently fails the game keeps working and simply plays
    85	  worse — hence one visible warning, and hence D2-A7 asserting ISMCTS rather than merely "a game happened".
    86	- **Seed drift between dev and prod** (D2-3) would be diagnosed as a search bug and is not one.
    87	- **D1's caveats stand**: the iteration budget was never strength-calibrated, and rollouts are ~117× the
    88	  tree cost.
    89	
    90	## Changelog vs revision 1
    91	
    92	- **Three-layer architecture with a `SearchCoordinator`** — revision 1 put lifecycle, retries, watchdog and
    93	  fallback into a `useEffect`, where none of the races could be tested.
    94	- **Staleness moved to the coordinator** with the four-condition acceptance rule (D2-4); revision 1 tested
    95	  it against pure `respond`, which cannot see any of it.
    96	- **Stable per-position seeds** (D2-3) — new; revision 1 left seed allocation undefined.
    97	- **Fallback detection enumerated**, including the watchdog for a worker that never replies (D2-6).
    98	- **D2-A2 replaced with an actual measurement protocol**; the old criterion was unfalsifiable.
    99	- **Production build and preview added to D2-A7**; the dev probe proved emission, not execution.
   100	- **Wire contract completed** — discriminated union, config at init, `requestId` on errors, plain strings.
   101	- **Pacing restated as a deadline** (D2-5).
   102	
   103	## Measurement (D2-A2 / D2-A6), taken 2026-08-27
   104	
   105	Production preview (`vite build` + `vite preview`, port 5310), Chromium via Playwright, Apple Silicon
   106	(darwin 25.5.0), default budget **200 iterations**, `rolloutCommandCap` 24, `rolloutApplyCap` 2048.
   107	Three complete games driven end to end; the numbers below are the second and third, where a patched
   108	`Worker` constructor recorded every message.
   109	
   110	| Quantity | Result |
   111	|---|---|
   112	| Worker asset actually served | `GET /assets/worker-DkZKnaJU.js → 200` (hashed production chunk, 52.8 kB) |
   113	| Searches posted / results received / worker errors | **33 / 33 / 0**, then **34 / 34 / 0** |
   114	| Worker round trip | **p50 152 ms, p95 240 ms, max 288 ms** |
   115	| Main-thread `longtask` entries during those searches | **0** (any reported entry would be ≥ 50 ms) |
   116	| Maximum `requestAnimationFrame` gap | **22 ms**, then **19 ms** |
   117	| Input delay, real trusted clicks (Event Timing, n = 12) | **0–1 ms** (`processingStart − startTime`) |
   118	| Search request serialized size | median **14.2 kB**, max 15.4 kB |
   119	| `postMessage` duration (main-thread cost of posting) | max **0.20 ms** |
   120	| Fallback warnings logged | **none** |
   121	
   122	**Reading the numbers.** The frame gap is the load-bearing one: a 200-iteration search on the main thread
   123	would have shown a rAF gap of at least its own duration, so a max gap of 19–22 ms across whole games is
   124	direct evidence the search never ran there. Zero `longtask` entries says the same thing from the other side.
   125	
   126	The *first* pass at input delay used synthetic `.click()` and reported a flat 0 ms — worthless, because a
   127	programmatic click dispatches synchronously and measures nothing. The table's figure is from real Playwright
   128	input observed through `PerformanceEventTiming`.
   129	
   130	**D2-2 resolved.** Leaving `defs` in the per-request view costs 14.2 kB and **0.20 ms** of main-thread
   131	posting. Revision 1 called this "negligible" without measuring; measured, it is in fact negligible, and
   132	`Omit<PlayerView,'defs'>` stays unnecessary.
   133	
   134	**D2-6 / D2-A7 asserted positively.** Every AI decision in both instrumented games was a completed worker
   135	round trip (33/33, 34/34, zero errors, zero fallback warnings). This is the assertion the spec asked for —
   136	not "no warning appeared", which is only evidence of silence.
   137	
   138	**D2-A6: the budget does not need reducing.** Round trips of p50 152 ms / p95 240 ms bracket D1's headless
   139	~254 ms per decision, so the browser affords the **same 200 iterations D1 measured**. The risk the spec
   140	raised — that the human would face a weaker opponent than the 90.0 % one — did not materialise: the browser
   141	opponent is the D1 opponent. The budget still has not been *strength*-calibrated (D1's caveat stands); what
   142	is now known is that the browser is not the thing forcing it down.

exec
/bin/zsh -lc 'git diff 2b01a06''^..HEAD -- apps/web/src/game/search/protocol.ts apps/web/src/game/search/worker.ts apps/web/src/game/search/coordinator.ts apps/web/src/game/useGame.ts apps/web/test/search-coordinator.test.ts apps/web/test/search-protocol.test.ts packages/ai/src/ismcts/search.ts packages/ai/src/ismcts/keys.ts packages/ai/src/agent.ts docs/superpowers/specs/2026-08-27-rung-d2-search-worker.md' in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-FnGBDXYa' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-3UY3tRno' (errno=Operation not permitted)
diff --git a/apps/web/src/game/search/coordinator.ts b/apps/web/src/game/search/coordinator.ts
new file mode 100644
index 0000000..0fc3201
--- /dev/null
+++ b/apps/web/src/game/search/coordinator.ts
@@ -0,0 +1,370 @@
+import {
+  DEFAULT_EXPLORATION_C, DEFAULT_ITERATIONS, DEFAULT_ROLLOUT_COMMAND_CAP, GreedyAgent, type Agent,
+} from '@fftcg/ai'
+import { actingPlayer, legalCommands, viewFor, type Command, type GameState } from '@fftcg/engine'
+import { AI } from '../types.js'
+import {
+  describeFailure,
+  type WorkerRequestMessage, type WorkerResponseMessage,
+} from './protocol.js'
+
+/**
+ * The layer between React and the worker (spec D2 layer 3). Every race in the rung lives here — stale replies,
+ * seed allocation, the pacing deadline, worker death and the `GreedyAgent` fallback — precisely so each one is
+ * a unit test rather than a matter of React timing folklore.
+ *
+ * `useGame` keeps its existing shape: capture a state, ask for a command, re-check legality against that exact
+ * state, narrate, commit.
+ */
+
+// ---------------------------------------------------------------------------
+// Seams (so the tests need no real Worker and no real clock)
+// ---------------------------------------------------------------------------
+
+export interface SearchTransport {
+  post(message: WorkerRequestMessage): void
+  terminate(): void
+}
+
+export interface TransportHandlers {
+  message(message: WorkerResponseMessage): void
+  /** An uncorrelated failure — `error`, `messageerror`. There is no `requestId` to attach to either. */
+  failure(text: string): void
+}
+
+export type SearchTransportFactory = (handlers: TransportHandlers) => SearchTransport
+
+export interface Clock {
+  now(): number
+  /** Schedules `fn` and returns its canceller — a closure rather than a handle, so no timer type leaks out. */
+  after(ms: number, fn: () => void): () => void
+}
+
+export const realClock: Clock = {
+  now: () => performance.now(),
+  after: (ms, fn) => {
+    const timer = setTimeout(fn, ms)
+    return () => clearTimeout(timer)
+  },
+}
+
+/**
+ * Vite's supported static form — the URL must be a literal or the worker chunk is not emitted at all. Every
+ * listener is installed BEFORE the coordinator posts anything, so a module-load failure cannot arrive
+ * unobserved while the first request is already in flight.
+ */
+export const workerTransport: SearchTransportFactory = (handlers) => {
+  if (typeof Worker === 'undefined') throw new Error('this browser does not support Web Workers')
+  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
+  worker.addEventListener('message', (e: MessageEvent<WorkerResponseMessage>) => handlers.message(e.data))
+  worker.addEventListener('error', (e) => handlers.failure(e.message || 'the search worker failed to load'))
+  worker.addEventListener('messageerror', () => handlers.failure('the search worker sent a message that could not be read'))
+  return { post: (m) => worker.postMessage(m), terminate: () => worker.terminate() }
+}
+
+// ---------------------------------------------------------------------------
+// Seeds (spec D2-3)
+// ---------------------------------------------------------------------------
+
+/**
+ * The search seed for the n-th COMMITTED AI decision of a game. Derived from the position rather than the
+ * request, so StrictMode's double-invoke, a retry, a superseded request and a replaced worker all re-ask the
+ * same question and get the same answer. A seed advanced when a request is *posted* makes development and
+ * production choose different moves from the same board — which reads as a search bug and is not one.
+ *
+ * The avalanche is there so consecutive decisions do not start near-identical streams; `searchIsmcts` splits
+ * this one number into its three streams itself (spec D-8).
+ */
+export function searchSeed(gameSeed: number, decisionIndex: number): number {
+  let h = (gameSeed ^ Math.imul(decisionIndex + 1, 0x9e3779b1)) >>> 0
+  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0
+  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0
+  return (h ^ (h >>> 16)) >>> 0
+}
+
+// ---------------------------------------------------------------------------
+// Coordinator
+// ---------------------------------------------------------------------------
+
+export interface SearchRequestHandlers {
+  /**
+   * The chosen command, with the exact state it was chosen for. **Return `true` only if it was committed** —
+   * the per-position seed advances on that and nothing else (D2-3), so a rejected or dropped command must
+   * report `false` or the next search of the same position asks a different question.
+   */
+  onCommand(command: Command, forState: GameState): boolean
+  /** At most one per game (D2-6): the worker is gone and Greedy has taken over for good. */
+  onWarning(text: string): void
+}
+
+export interface SearchCoordinatorOptions {
+  readonly decks: readonly [readonly string[], readonly string[]]
+  /** The game's own seed. With the committed-decision index this is the whole of a search seed (D2-3). */
+  readonly gameSeed: number
+  /** `stateRef.current`. The fourth acceptance condition is identity against this, so it must be the live ref. */
+  readonly readState: () => GameState
+  /** The pacing DEADLINE from the moment a request is posted — `AI_STEP_MS`, never an added delay (D2-5). */
+  readonly stepMs: number
+  readonly iterations?: number | undefined
+  readonly rolloutCommandCap?: number | undefined
+  readonly explorationC?: number | undefined
+  /** Longer than a normal reply: a fresh worker also has to fetch and evaluate its module chunk. */
+  readonly startupWatchdogMs?: number | undefined
+  readonly watchdogMs?: number | undefined
+  readonly createTransport?: SearchTransportFactory | undefined
+  readonly clock?: Clock | undefined
+}
+
+export const DEFAULT_STARTUP_WATCHDOG_MS = 10_000
+export const DEFAULT_WATCHDOG_MS = 5_000
+
+export const FALLBACK_WARNING =
+  'The background search stopped working, so the AI is playing its faster, weaker opponent for the rest of this game'
+
+/** One request's claim on the caller: which state it was asked for, and when its answer may be shown. */
+interface Target {
+  readonly state: GameState
+  readonly handlers: SearchRequestHandlers
+  /** `startedAt + stepMs`. A fast search still waits this out; a slow one applies the moment it lands (D2-5). */
+  readonly notBefore: number
+}
+
+interface Outstanding extends Target {
+  readonly requestId: number
+  readonly cancelWatchdog: () => void
+}
+
+export class SearchCoordinator {
+  private readonly opts: SearchCoordinatorOptions
+  private readonly clock: Clock
+  private readonly createTransport: SearchTransportFactory
+
+  private transport: SearchTransport | null = null
+  private initialised = false
+  private disposed = false
+  /** Permanent for this game (D2-6): a worker that failed once is not retried mid-game. */
+  private fallback = false
+  private warned = false
+  private failureReason = ''
+
+  private nextRequestId = 0
+  /** Advances ONLY on a committed AI command. Never on a post, a retry or a worker replacement. */
+  private decisionIndex = 0
+
+  private active: Outstanding | null = null
+  private delivery: { readonly cancel: () => void; readonly target: Target } | null = null
+  private greedy: Agent | null = null
+
+  constructor(opts: SearchCoordinatorOptions) {
+    this.opts = opts
+    this.clock = opts.clock ?? realClock
+    this.createTransport = opts.createTransport ?? workerTransport
+  }
+
+  /** True once the worker has been given up on — the caller can say so in its status line. */
+  get usingFallback(): boolean {
+    return this.fallback
+  }
+
+  /** The seed the NEXT request for the current position will carry. Exposed so the races can be asserted. */
+  get nextSeed(): number {
+    return searchSeed(this.opts.gameSeed, this.decisionIndex)
+  }
+
+  /**
+   * Ask for the AI's command in `state`. Supersedes anything outstanding: the reply to the old request is
+   * dropped by id, not waited for.
+   */
+  request(state: GameState, handlers: SearchRequestHandlers): void {
+    if (this.disposed) return
+    this.invalidate()
+    this.emitWarning(handlers)
+
+    const notBefore = this.clock.now() + this.opts.stepMs
+    if (this.fallback) {
+      this.scheduleGreedy({ state, handlers, notBefore })
+      return
+    }
+
+    let transport = this.transport
+    const starting = transport === null
+    if (!transport) {
+      try {
+        transport = this.createTransport({
+          message: (m) => this.onMessage(m),
+          failure: (text) => this.onFailure(text),
+        })
+      } catch (e) {
+        // Missing `Worker`, or a constructor that threw. Nothing was posted, so nothing is outstanding.
+        this.fail(describeFailure(e), { state, handlers, notBefore })
+        return
+      }
+      this.transport = transport
+    }
+
+    const requestId = ++this.nextRequestId
+    try {
+      if (!this.initialised) {
+        transport.post({
+          type: 'init',
+          decks: this.opts.decks,
+          rolloutCommandCap: this.opts.rolloutCommandCap ?? DEFAULT_ROLLOUT_COMMAND_CAP,
+          explorationC: this.opts.explorationC ?? DEFAULT_EXPLORATION_C,
+        })
+        this.initialised = true
+      }
+      transport.post({
+        type: 'search',
+        requestId,
+        view: viewFor(state, AI),
+        seed: this.nextSeed,
+        iterations: this.opts.iterations ?? DEFAULT_ITERATIONS,
+      })
+    } catch (e) {
+      // `postMessage` throws synchronously when the payload will not structured-clone.
+      this.fail(describeFailure(e), { state, handlers, notBefore })
+      return
+    }
+    // A transport whose failure handler fired synchronously inside `post` has already been given up on; arming
+    // a watchdog for it would raise a second failure against a request nobody is waiting for.
+    if (this.fallback) return
+
+    // A worker that is killed or simply hangs produces no correlated event at all, so the only way to notice
+    // it is a deadline (D2-6).
+    const timeout = starting
+      ? this.opts.startupWatchdogMs ?? DEFAULT_STARTUP_WATCHDOG_MS
+      : this.opts.watchdogMs ?? DEFAULT_WATCHDOG_MS
+    const cancelWatchdog = this.clock.after(timeout, () => {
+      const outstanding = this.active
+      if (!outstanding || outstanding.requestId !== requestId) return
+      this.fail('the search worker did not respond', outstanding)
+    })
+    this.active = { requestId, state, handlers, notBefore, cancelWatchdog }
+  }
+
+  /**
+   * Synchronously drop whatever is outstanding. Called on every restart, every external commit (including a
+   * human `choose()` — **concede is legal even when the human is not the acting player**, so it really can
+   * commit mid-AI-turn) and on effect cleanup.
+   */
+  invalidate(): void {
+    if (this.active) {
+      this.active.cancelWatchdog()
+      this.active = null
+    }
+    if (this.delivery) {
+      this.delivery.cancel()
+      this.delivery = null
+    }
+  }
+
+  /** Unmount: invalidate, then terminate. A worker outliving its hook is a leak and a source of stale replies. */
+  dispose(): void {
+    this.invalidate()
+    this.disposed = true
+    this.killTransport()
+  }
+
+  // -------------------------------------------------------------------------
+
+  private onMessage(message: WorkerResponseMessage): void {
+    if (this.disposed) return
+    if (message.type === 'error') {
+      const outstanding = this.active
+      // A typed error means the search itself threw, so the worker is no more use for this game whether or
+      // not the error correlates with what is currently outstanding.
+      this.fail(message.message, outstanding && (message.requestId === null || message.requestId === outstanding.requestId) ? outstanding : null)
+      return
+    }
+    const outstanding = this.active
+    // The four-condition acceptance rule (D2-4). `readState()` identity is the one that catches a reply that
+    // raced a commit the coordinator was never told about.
+    if (!outstanding) return
+    if (outstanding.requestId !== message.requestId) return
+    // A reply that raced a commit the coordinator was never told about is correctly DROPPED — but dropping it
+    // must also release the request, or the watchdog later fires on a worker that answered perfectly well and
+    // condemns the rest of the game to Greedy with a warning that says the search "stopped working".
+    if (this.opts.readState() !== outstanding.state || actingPlayer(outstanding.state) !== AI) {
+      outstanding.cancelWatchdog()
+      this.active = null
+      return
+    }
+
+    // Clear the active id BEFORE applying, so anything the commit re-enters cannot see this request as live.
+    outstanding.cancelWatchdog()
+    this.active = null
+    const command = message.result.command
+    this.schedule(outstanding, () => command)
+  }
+
+  /** `error` / `messageerror` from the transport: uncorrelated by nature, so it is attributed to what is live. */
+  private onFailure(text: string): void {
+    if (this.disposed) return
+    this.fail(text, this.active)
+  }
+
+  /**
+   * The single funnel for every way the worker can fail (D2-6): invalidate, terminate, switch to Greedy for
+   * the rest of the game, warn ONCE, and still produce a command under the same pacing deadline.
+   */
+  private fail(text: string, target: Target | null): void {
+    // A SECOND failure while a fallback move is already scheduled must not touch it. `invalidate()` would
+    // cancel the very Greedy command the first failure queued, and nothing would ever reschedule it.
+    if (this.fallback && this.delivery) return
+
+    // Capture the recovery target BEFORE `invalidate()`, which clears `active` AND cancels any pending
+    // delivery — the two places a live turn can be hiding when the error does not correlate with what is
+    // outstanding. Returning early instead left the AI stalled forever with the spinner up and nothing in the
+    // log: the silent degradation D2-6 exists to forbid, inverted into a silent hang.
+    const recover = target ?? this.active ?? this.delivery?.target ?? null
+    this.invalidate()
+    if (!this.fallback) this.failureReason = text
+    this.fallback = true
+    this.killTransport()
+    if (!recover) return   // genuinely nothing in flight: no turn to rescue, and no handlers to warn through
+    this.emitWarning(recover.handlers)
+    this.scheduleGreedy(recover)
+  }
+
+  private killTransport(): void {
+    if (!this.transport) return
+    this.transport.terminate()
+    this.transport = null
+    this.initialised = false
+  }
+
+  private emitWarning(handlers: SearchRequestHandlers): void {
+    if (!this.fallback || this.warned) return
+    this.warned = true
+    handlers.onWarning(`${FALLBACK_WARNING} (${this.failureReason})`)
+  }
+
+  private scheduleGreedy(target: Target): void {
+    this.schedule(target, () => {
+      const agent = (this.greedy ??= new GreedyAgent({
+        seed: this.opts.gameSeed,
+        decks: [[...this.opts.decks[0]], [...this.opts.decks[1]]],
+        depth: 1,
+      }))
+      const legal = agent.needsLegalCommands === false ? [] : legalCommands(target.state, AI)
+      return agent.decide(viewFor(target.state, AI), legal)
+    })
+  }
+
+  /** D2-5: the deadline is `startedAt + stepMs`, so a 750 ms search applies at once — never 750 + 600. */
+  private schedule(target: Target, produce: () => Command): void {
+    const cancel = this.clock.after(Math.max(0, target.notBefore - this.clock.now()), () => {
+      this.delivery = null
+      if (this.disposed) return
+      // Re-checked here and not only at acceptance: the wait is itself a window in which a concede can land.
+      if (this.opts.readState() !== target.state) return
+      if (actingPlayer(target.state) !== AI) return
+      // Advance BEFORE the handler runs, and roll back if it rejects: a handler that commits and re-requests
+      // synchronously would otherwise reuse this decision's seed for the next position (D2-3).
+      const at = this.decisionIndex
+      this.decisionIndex++
+      if (!target.handlers.onCommand(produce(), target.state)) this.decisionIndex = at
+    })
+    this.delivery = { cancel, target }
+  }
+}
diff --git a/apps/web/src/game/search/protocol.ts b/apps/web/src/game/search/protocol.ts
new file mode 100644
index 0000000..1d1f775
--- /dev/null
+++ b/apps/web/src/game/search/protocol.ts
@@ -0,0 +1,79 @@
+import { searchIsmcts, type SearchInput, type SearchResult } from '@fftcg/ai'
+import type { PlayerView } from '@fftcg/engine'
+
+/**
+ * The wire contract between the main thread and the search worker (spec D2-1).
+ *
+ * Every message here is structured-cloneable by construction: `PlayerView`, `SearchResult` and the declared
+ * lists are plain data (spec D-7/D-9), and errors cross as **plain strings** — an `Error` clones as a bare
+ * `{}` in some engines and loses its message in others, which turns a worker failure into a silent one.
+ */
+
+/**
+ * Sent once per worker, before the first request. It carries the two declared lists AND the stable search
+ * configuration: `SearchInput` requires `rolloutCommandCap` and `explorationC`, and neither varies by position,
+ * so putting them on every request would be re-declaring a constant across the boundary 200 times a game.
+ */
+export interface WorkerInit {
+  readonly type: 'init'
+  /** Both players' publicly declared lists — the open-decklist assumption `determinise` documents. */
+  readonly decks: readonly [readonly string[], readonly string[]]
+  readonly rolloutCommandCap: number
+  readonly explorationC: number
+}
+
+/** One search. `seed` is allocated per game POSITION by the coordinator (D2-3), never from `requestId`. */
+export interface WorkerSearchRequest {
+  readonly type: 'search'
+  readonly requestId: number
+  readonly view: PlayerView
+  readonly seed: number
+  readonly iterations: number
+}
+
+export interface WorkerResultMessage {
+  readonly type: 'result'
+  readonly requestId: number
+  readonly result: SearchResult
+}
+
+/** `requestId` is `null` only for a failure that belongs to no request — init, or a message the worker cannot read. */
+export interface WorkerErrorMessage {
+  readonly type: 'error'
+  readonly requestId: number | null
+  readonly message: string
+}
+
+export type WorkerRequestMessage = WorkerInit | WorkerSearchRequest
+export type WorkerResponseMessage = WorkerResultMessage | WorkerErrorMessage
+
+/** Everything that crosses the boundary as a diagnostic is a string, so nothing depends on `Error` cloning. */
+export function describeFailure(e: unknown): string {
+  return e instanceof Error ? e.message : String(e)
+}
+
+export function searchInputFor(init: WorkerInit, request: WorkerSearchRequest): SearchInput {
+  return {
+    view: request.view,
+    decks: init.decks,
+    iterations: request.iterations,
+    seed: request.seed,
+    rolloutCommandCap: init.rolloutCommandCap,
+    explorationC: init.explorationC,
+  }
+}
+
+/**
+ * Deterministic translation, and nothing else (spec D2-A3): the same `(view, seed, iterations, caps)` returns
+ * exactly what a direct `searchIsmcts` call returns.
+ *
+ * It knows nothing about what is outstanding, which is the whole point — staleness is a property of the main
+ * thread's game state, so it is decided by `SearchCoordinator` and cannot be tested here.
+ */
+export function respond(init: WorkerInit, request: WorkerSearchRequest): WorkerResultMessage | WorkerErrorMessage {
+  try {
+    return { type: 'result', requestId: request.requestId, result: searchIsmcts(searchInputFor(init, request)) }
+  } catch (e) {
+    return { type: 'error', requestId: request.requestId, message: describeFailure(e) }
+  }
+}
diff --git a/apps/web/src/game/search/worker.ts b/apps/web/src/game/search/worker.ts
new file mode 100644
index 0000000..93850fb
--- /dev/null
+++ b/apps/web/src/game/search/worker.ts
@@ -0,0 +1,42 @@
+import { describeFailure, respond, type WorkerInit, type WorkerRequestMessage, type WorkerResponseMessage } from './protocol.js'
+
+/**
+ * The worker shell (spec D2 layer 2). Vitest cannot drive a real `Worker`, so there is deliberately nothing
+ * here worth testing: every decision lives in `respond` (pure) or `SearchCoordinator` (injectable transport).
+ *
+ * `self` is typed by hand rather than via `/// <reference lib="webworker" />`, because this file compiles in
+ * the same program as the DOM app and the two libs redeclare each other.
+ */
+const ctx = self as unknown as {
+  postMessage(message: WorkerResponseMessage): void
+  onmessage: ((event: MessageEvent<WorkerRequestMessage>) => void) | null
+}
+
+let init: WorkerInit | null = null
+
+const send = (message: WorkerResponseMessage): void => {
+  try {
+    ctx.postMessage(message)
+  } catch (e) {
+    // The only way this fires is a result that will not clone. Report it, so the coordinator falls back
+    // instead of waiting out its watchdog on a search that actually succeeded.
+    ctx.postMessage({ type: 'error', requestId: message.type === 'result' ? message.requestId : null, message: describeFailure(e) })
+  }
+}
+
+ctx.onmessage = (event: MessageEvent<WorkerRequestMessage>): void => {
+  const message = event.data
+  try {
+    if (message.type === 'init') {
+      init = message
+      return
+    }
+    if (!init) {
+      send({ type: 'error', requestId: message.requestId, message: 'search worker received a request before init' })
+      return
+    }
+    send(respond(init, message))
+  } catch (e) {
+    send({ type: 'error', requestId: message.type === 'search' ? message.requestId : null, message: describeFailure(e) })
+  }
+}
diff --git a/apps/web/src/game/useGame.ts b/apps/web/src/game/useGame.ts
index 540f722..c4cdc1f 100644
--- a/apps/web/src/game/useGame.ts
+++ b/apps/web/src/game/useGame.ts
@@ -1,11 +1,12 @@
 import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
 import {
   actingPlayer, apply, createGame, legalCommands, viewFor,
-  type AbilityTrigger, type CardId, type Event, type FieldFlag, type Frame, type GameState, type Keyword, type PlayerId, type PlayerView,
+  type AbilityTrigger, type CardId, type Command, type Event, type FieldFlag, type Frame, type GameState, type Keyword, type PlayerId, type PlayerView,
 } from '@fftcg/engine'
-import { GreedyAgent, type Agent } from '@fftcg/ai'
+import type { Agent } from '@fftcg/ai'
 import { CARD_DEFS, DECKS } from '../deck.js'
 import { buildChoiceSet, describeChoice, describeTriggerCause, preferredChoices, sameCommand, type TriggerCause } from './commands.js'
+import { SearchCoordinator, type SearchCoordinatorOptions, type SearchRequestHandlers } from './search/coordinator.js'
 import { AI, HUMAN, type Choice, type GameApi, type LogLine } from './types.js'
 
 /** Spec B7: the agent decides in ~0.27 ms, far too fast to watch — one move per this many ms instead. */
@@ -213,16 +214,14 @@ export function eventLines(v: PlayerView, events: readonly Event[], queued: read
 export const narrator = (before: PlayerView, after: PlayerView): PlayerView => ({ ...after, cards: { ...before.cards, ...after.cards } })
 
 /**
- * Apply exactly ONE command for whoever is currently acting, chosen by `agent`, and return the resulting state
- * with the lines it produced. Pure and React-free so the whole driver is testable headlessly (spec B-A7). The
- * membership check is spec B-A4 held to both seats: `apply` is never reached by a command outside `legalCommands`.
+ * Narrate and apply one already-chosen command. Split out of `stepAi` because the browser's opponent no longer
+ * comes from an `Agent` at all — it comes back from a worker (spec D2) — and both paths must produce the same
+ * log. The membership check is spec B-A4 held to both seats: `apply` is never reached by a command outside
+ * `legalCommands`.
  */
-export function stepAi(state: GameState, agent: Agent): { state: GameState; lines: LogLine[] } {
-  const p = actingPlayer(state)
-  if (p === null) return { state, lines: [] }
-  const actorView = viewFor(state, p)
-  const legal = legalCommands(state, p)
-  const command = agent.decide(actorView, legal)
+function narrateApply(
+  state: GameState, actorView: PlayerView, legal: readonly Command[], command: Command,
+): { state: GameState; lines: LogLine[] } {
   if (!legal.some((c) => sameCommand(c, command))) throw new Error(`agent chose an illegal command: ${command.type}`)
   const before = viewFor(state, HUMAN)
   const result = apply(state, command)
@@ -232,10 +231,89 @@ export function stepAi(state: GameState, agent: Agent): { state: GameState; line
   return { state: result.state, lines: [{ kind: 'ai', text: describeChoice(actorView, command) }, ...lines] }
 }
 
+/**
+ * Apply exactly ONE command for whoever is currently acting, chosen by `agent`, and return the resulting state
+ * with the lines it produced. Pure and React-free so the whole driver is testable headlessly (spec B-A7).
+ */
+export function stepAi(state: GameState, agent: Agent): { state: GameState; lines: LogLine[] } {
+  const p = actingPlayer(state)
+  if (p === null) return { state, lines: [] }
+  const actorView = viewFor(state, p)
+  const legal = legalCommands(state, p)
+  return narrateApply(state, actorView, legal, agent.decide(actorView, legal))
+}
+
+// --- the browser's opponent: SO-ISMCTS in a worker (spec D2) -----------------------------------------------
+
+/** Everything the AI wiring needs from React. Named so the wiring below is drivable without a DOM. */
+export interface AiSink {
+  commit(state: GameState, lines: LogLine[]): void
+  log(line: LogLine): void
+}
+
+/**
+ * The hook's side of the coordinator contract. Every race — staleness, pacing, worker death, the fallback — is
+ * the coordinator's, so what is left here is only the shape the hook already had: re-check the command against
+ * the exact state it was chosen for, narrate it, commit it.
+ */
+export function aiHandlers(sink: AiSink): SearchRequestHandlers {
+  return {
+    onCommand: (command, forState) => {
+      const legal = legalCommands(forState, AI)
+      // `false` is load-bearing beyond skipping the commit: it is what stops the per-position seed advancing,
+      // so the next search of this same board asks the identical question (D2-3). Refuse rather than throw —
+      // this runs from a timer, where an uncaught throw would take the page down instead of the move.
+      if (!legal.some((c) => sameCommand(c, command))) {
+        sink.log({ kind: 'warning', text: `The AI chose ${command.type}, which is not legal in this position — the move was discarded` })
+        return false
+      }
+      const stepped = narrateApply(forState, viewFor(forState, AI), legal, command)
+      sink.commit(stepped.state, stepped.lines)
+      return true
+    },
+    // D2-6, and the reason the rung has a visible warning at all: an opponent quietly a tenth as strong is
+    // exactly the degradation that survives a rung unnoticed. The coordinator emits this at most once a game.
+    onWarning: (text) => { sink.log({ kind: 'warning', text }) },
+  }
+}
+
+/** Test seams. The hook passes none of them; the browser gets a real worker and a real clock. */
+export type SearchSeams = Pick<SearchCoordinatorOptions, 'createTransport' | 'clock' | 'iterations'>
+
+export interface AiSearch {
+  request(state: GameState, handlers: SearchRequestHandlers): void
+  /** Effect cleanup, and any commit the coordinator did not itself make. Synchronous, per D2-4. */
+  invalidate(): void
+  /** A new game under `seed`. */
+  restart(seed: number): void
+  dispose(): void
+}
+
+/**
+ * One `SearchCoordinator` per GAME. Throwing it away is how a restart resets the two things that are per-game
+ * facts and would otherwise leak across one: the committed-decision index the search seed is derived from
+ * (D2-3), and the permanently-Greedy latch a dead worker sets (D2-6).
+ *
+ * Built lazily, and rebuilt after `dispose`, because StrictMode's mount→unmount→mount tears the coordinator
+ * down without re-rendering — a one-shot construction in the render body would leave the second mount holding
+ * a terminated worker and no AI at all.
+ */
+export function createAiSearch(readState: () => GameState, seed: number, seams: SearchSeams = {}): AiSearch {
+  let gameSeed = seed
+  let coordinator: SearchCoordinator | null = null
+  const drop = (): void => { coordinator?.dispose(); coordinator = null }
+  const live = (): SearchCoordinator => (coordinator ??= new SearchCoordinator({
+    decks: DECKS, gameSeed, readState, stepMs: AI_STEP_MS, ...seams,
+  }))
+  return {
+    request: (state, handlers) => { live().request(state, handlers) },
+    invalidate: () => { coordinator?.invalidate() },
+    restart: (next) => { gameSeed = next; drop() },
+    dispose: drop,
+  }
+}
+
 const newGame = (seed: number): GameState => createGame({ seed, decks: DECKS, defs: CARD_DEFS })
-/** Spec B4 + the B-risks open-deck-list note: `GreedyAgent` determinises with BOTH lists, and in a mirror starter
- *  matchup both are public — so passing `DECKS` twice leaks nothing a real opponent would not already know. */
-const newAgent = (seed: number): Agent => new GreedyAgent({ seed, decks: DECKS, depth: 1 })
 
 const openingLog = (): LogLine[] => [{ kind: 'phase', text: 'New game — you are P0, the AI is P1' }]
 
@@ -245,8 +323,9 @@ export function useGame(seed?: number): GameApi {
   // the authority `choose` reads, so two clicks inside one render can't both apply to the same stale state.
   const [state, setState] = useState<GameState>(() => newGame(seedRef.current))
   const stateRef = useRef<GameState>(state)
-  const agentRef = useRef<Agent | null>(null)
-  agentRef.current ??= newAgent(seedRef.current)   // lazy: `useRef(newAgent(...))` would build one every render
+  const searchRef = useRef<AiSearch | null>(null)
+  // Lazy for the same reason the game itself is: `useRef(createAiSearch(...))` would build one every render.
+  searchRef.current ??= createAiSearch(() => stateRef.current, seedRef.current)
   const [log, setLog] = useState<LogLine[]>(openingLog)
   const [aiThinking, setAiThinking] = useState(false)
 
@@ -256,11 +335,17 @@ export function useGame(seed?: number): GameApi {
     if (lines.length) setLog((prev) => [...prev, ...lines])
   }, [])
 
+  const appendLog = useCallback((line: LogLine) => { setLog((prev) => [...prev, line]) }, [])
+  const handlers = useMemo(() => aiHandlers({ commit, log: appendLog }), [commit, appendLog])
+
   const view = useMemo(() => viewFor(state, HUMAN), [state])
   const choices = useMemo(() => buildChoiceSet(view, preferredChoices(view, legalCommands(state, HUMAN))), [state, view])
 
   const choose = useCallback((choice: Choice): void => {
     const current = stateRef.current
+    // D2-4: an external commit synchronously drops whatever the AI has outstanding. `concede` is legal even
+    // when the human is NOT the acting player, so a click really can land in the middle of the AI's search.
+    searchRef.current?.invalidate()
     // Spec B-A4: prove the command is still legal before touching `apply`, so an illegal click is impossible
     // rather than merely rejected by the engine after the fact.
     const legal = legalCommands(current, HUMAN)
@@ -276,26 +361,28 @@ export function useGame(seed?: number): GameApi {
     const next = ++seedRef.current
     const game = newGame(next)
     stateRef.current = game
-    agentRef.current = newAgent(next)
+    // D2-3: a new coordinator, so the committed-decision index the search seed is derived from restarts at 0.
+    searchRef.current?.restart(next)
     setState(game)
     setLog(openingLog())
     setAiThinking(false)
   }, [])
 
-  // Spec B7: one AI move per tick until the human is on the clock again or the game ends. Re-running on every
-  // `state` change is what makes it a loop. The cleanup both clears the timer and latches `cancelled`, so
-  // StrictMode's mount→unmount→mount double-invoke discards the first timer instead of stepping the AI twice.
+  // Spec B7 + D2: one AI move per decision, searched off the main thread. Re-running on every `state` change is
+  // what makes it a loop, and one accepted request per state is what stops two AI moves overlapping. The
+  // cleanup invalidates synchronously, so StrictMode's mount→unmount→mount double-invoke discards the first
+  // request rather than stepping the AI twice.
   useEffect(() => {
     if (state.result || actingPlayer(state) !== AI) { setAiThinking(false); return }
     setAiThinking(true)
-    let cancelled = false
-    const timer = setTimeout(() => {
-      if (cancelled) return
-      const stepped = stepAi(stateRef.current, agentRef.current as Agent)
-      commit(stepped.state, stepped.lines)
-    }, AI_STEP_MS)
-    return () => { cancelled = true; clearTimeout(timer) }
-  }, [state, commit])
+    const search = searchRef.current as AiSearch
+    search.request(state, handlers)
+    return () => { search.invalidate() }
+  }, [state, handlers])
+
+  // Unmount only. A worker outliving its hook is both a leak and a source of replies for a game nobody is
+  // looking at any more (D2-4).
+  useEffect(() => () => { searchRef.current?.dispose() }, [])
 
   return { view, choices, log, aiThinking, choose, restart }
 }
diff --git a/apps/web/test/search-coordinator.test.ts b/apps/web/test/search-coordinator.test.ts
new file mode 100644
index 0000000..b3818a1
--- /dev/null
+++ b/apps/web/test/search-coordinator.test.ts
@@ -0,0 +1,606 @@
+import { describe, expect, it } from 'vitest'
+import { apply, createGame, legalCommands, viewFor, type Command, type GameState, type PlayerId } from '@fftcg/engine'
+import { GreedyAgent, type SearchDiagnostics, type SearchResult } from '@fftcg/ai'
+import { CARD_DEFS, DECKS } from '../src/deck.js'
+import { AI, HUMAN } from '../src/game/types.js'
+import type { WorkerRequestMessage, WorkerResponseMessage, WorkerSearchRequest } from '../src/game/search/protocol.js'
+import {
+  FALLBACK_WARNING, SearchCoordinator, searchSeed, workerTransport,
+  type Clock, type SearchRequestHandlers, type SearchTransport, type SearchTransportFactory, type TransportHandlers,
+} from '../src/game/search/coordinator.js'
+
+const GAME_SEED = 4242
+const STEP_MS = 600
+const WATCHDOG_MS = 5_000
+const STARTUP_WATCHDOG_MS = 10_000
+
+// ---------------------------------------------------------------------------
+// Fixtures
+// ---------------------------------------------------------------------------
+
+const actorOf = (state: GameState): PlayerId | null => (state.result ? null : (state.pending?.player ?? state.priority))
+
+/** Fast-forward a real game to a position the AI actually owns — the only kind the coordinator may be asked for. */
+function aiToAct(seed: number): GameState {
+  let state: GameState = createGame({ seed, decks: DECKS, defs: CARD_DEFS })
+  const agent = new GreedyAgent({ seed, decks: DECKS, depth: 1 })
+  for (let i = 0; i < 400; i++) {
+    const p = actorOf(state)
+    if (p === null) break
+    if (p === AI) return state
+    state = apply(state, agent.decide(viewFor(state, p), legalCommands(state, p))).state
+  }
+  throw new Error(`seed ${seed} never reached an AI decision`)
+}
+
+function humanToAct(seed: number): GameState {
+  let state: GameState = createGame({ seed, decks: DECKS, defs: CARD_DEFS })
+  const agent = new GreedyAgent({ seed, decks: DECKS, depth: 1 })
+  for (let i = 0; i < 400; i++) {
+    const p = actorOf(state)
+    if (p === null) break
+    if (p === HUMAN) return state
+    state = apply(state, agent.decide(viewFor(state, p), legalCommands(state, p))).state
+  }
+  throw new Error(`seed ${seed} never reached a human decision`)
+}
+
+const EMPTY_DIAGNOSTICS: SearchDiagnostics = {
+  determinisations: 1, treeApplies: 1, rolloutApplies: 1, evaluations: 1, nodes: 1, maxCommandDepth: 1, rootChildren: [],
+}
+
+/** A worker reply for `state`, carrying a command that really is legal there so nothing downstream is faked. */
+function resultFor(state: GameState, requestId: number): WorkerResponseMessage {
+  const command = legalCommands(state, AI)[0]
+  if (!command) throw new Error('no legal AI command')
+  const result: SearchResult = { command, diagnostics: EMPTY_DIAGNOSTICS }
+  return { type: 'result', requestId, result }
+}
+
+class FakeClock implements Clock {
+  private t = 0
+  private seq = 0
+  private readonly timers = new Map<number, { at: number; fn: () => void }>()
+
+  now(): number { return this.t }
+
+  after(ms: number, fn: () => void): () => void {
+    const id = ++this.seq
+    this.timers.set(id, { at: this.t + ms, fn })
+    return () => { this.timers.delete(id) }
+  }
+
+  get armed(): number { return this.timers.size }
+
+  advance(ms: number): void {
+    const target = this.t + ms
+    for (;;) {
+      let pickId = -1
+      let pickAt = Number.POSITIVE_INFINITY
+      for (const [id, timer] of this.timers) {
+        if (timer.at <= target && (timer.at < pickAt || (timer.at === pickAt && id < pickId))) { pickAt = timer.at; pickId = id }
+      }
+      const timer = pickId < 0 ? undefined : this.timers.get(pickId)
+      if (!timer) break
+      this.timers.delete(pickId)
+      this.t = timer.at
+      timer.fn()
+    }
+    this.t = target
+  }
+}
+
+class FakeTransport implements SearchTransport {
+  readonly sent: WorkerRequestMessage[] = []
+  terminations = 0
+  postThrows: string | null = null
+  constructor(readonly handlers: TransportHandlers) {}
+
+  post(message: WorkerRequestMessage): void {
+    if (this.postThrows !== null) throw new DOMException(this.postThrows, 'DataCloneError')
+    this.sent.push(message)
+  }
+
+  terminate(): void { this.terminations++ }
+
+  get searches(): WorkerSearchRequest[] {
+    return this.sent.filter((m): m is WorkerSearchRequest => m.type === 'search')
+  }
+}
+
+interface Harness {
+  readonly clock: FakeClock
+  readonly coordinator: SearchCoordinator
+  readonly transports: FakeTransport[]
+  readonly delivered: { command: Command; state: GameState }[]
+  readonly warnings: string[]
+  readonly handlers: SearchRequestHandlers
+  readonly transport: () => FakeTransport
+  readState(): GameState
+  setState(state: GameState): void
+  setCommit(v: boolean): void
+}
+
+function harness(opts: { seed?: number; factory?: SearchTransportFactory; onCreate?: (t: FakeTransport) => void } = {}): Harness {
+  const clock = new FakeClock()
+  const transports: FakeTransport[] = []
+  const delivered: { command: Command; state: GameState }[] = []
+  const warnings: string[] = []
+  let current = aiToAct(opts.seed ?? 11)
+  let commits = true
+
+  const handlers: SearchRequestHandlers = {
+    onCommand: (command, forState) => { delivered.push({ command, state: forState }); return commits },
+    onWarning: (text) => { warnings.push(text) },
+  }
+  const factory: SearchTransportFactory = opts.factory ?? ((h) => {
+    const t = new FakeTransport(h)
+    transports.push(t)
+    opts.onCreate?.(t)
+    return t
+  })
+  const coordinator = new SearchCoordinator({
+    decks: DECKS,
+    gameSeed: GAME_SEED,
+    readState: () => current,
+    stepMs: STEP_MS,
+    iterations: 25,
+    rolloutCommandCap: 8,
+    explorationC: 1,
+    watchdogMs: WATCHDOG_MS,
+    startupWatchdogMs: STARTUP_WATCHDOG_MS,
+    createTransport: factory,
+    clock,
+  })
+  return {
+    clock, coordinator, transports, delivered, warnings, handlers,
+    transport: () => { const t = transports[0]; if (!t) throw new Error('no transport was created'); return t },
+    readState: () => current,
+    setState: (s) => { current = s },
+    setCommit: (v) => { commits = v },
+  }
+}
+
+/** The whole point of the fallback: whatever went wrong, a command still arrives on the same deadline. */
+function expectOneWarningAndACommand(h: Harness): void {
+  expect(h.delivered).toHaveLength(0)
+  h.clock.advance(STEP_MS)
+  expect(h.delivered).toHaveLength(1)
+  expect(h.warnings).toHaveLength(1)
+  expect(h.warnings[0]).toContain(FALLBACK_WARNING)
+  expect(h.coordinator.usingFallback).toBe(true)
+  const only = h.delivered[0]
+  if (!only) throw new Error('unreachable')
+  expect(legalCommands(only.state, AI).some((c) => c.type === only.command.type)).toBe(true)
+}
+
+// ---------------------------------------------------------------------------
+
+describe('searchSeed (D2-3)', () => {
+  it('is a pure function of (gameSeed, decisionIndex)', () => {
+    expect(searchSeed(7, 3)).toBe(searchSeed(7, 3))
+    expect(searchSeed(7, 3)).not.toBe(searchSeed(7, 4))
+    expect(searchSeed(7, 3)).not.toBe(searchSeed(8, 3))
+  })
+
+  it('stays a non-negative 32-bit integer', () => {
+    for (const [seed, index] of [[0, 0], [-1, 5], [2_147_483_646, 199], [Date.now() % 2_147_483_647, 12]] as const) {
+      const s = searchSeed(seed, index)
+      expect(Number.isSafeInteger(s)).toBe(true)
+      expect(s).toBeGreaterThanOrEqual(0)
+      expect(s).toBeLessThanOrEqual(0xffff_ffff)
+    }
+  })
+})
+
+describe('SearchCoordinator: seeds are per POSITION (D2-3)', () => {
+  it('asks the same position twice with the same seed', () => {
+    const h = harness()
+    h.coordinator.request(h.readState(), h.handlers)
+    // StrictMode's cleanup+setup, a retry and a superseded request all look like this.
+    h.coordinator.invalidate()
+    h.coordinator.request(h.readState(), h.handlers)
+
+    const searches = h.transport().searches
+    expect(searches).toHaveLength(2)
+    expect(searches[0]?.seed).toBe(searches[1]?.seed)
+    expect(searches[0]?.seed).toBe(searchSeed(GAME_SEED, 0))
+    // The correlation ids must still differ, or a stale reply could not be told apart.
+    expect(searches[0]?.requestId).not.toBe(searches[1]?.requestId)
+  })
+
+  it('posts init exactly once, ahead of the first search', () => {
+    const h = harness()
+    h.coordinator.request(h.readState(), h.handlers)
+    h.coordinator.invalidate()
+    h.coordinator.request(h.readState(), h.handlers)
+    const t = h.transport()
+    expect(t.sent.filter((m) => m.type === 'init')).toHaveLength(1)
+    expect(t.sent[0]?.type).toBe('init')
+    const init = t.sent[0]
+    if (init?.type !== 'init') throw new Error('unreachable')
+    expect(init.rolloutCommandCap).toBe(8)
+    expect(init.explorationC).toBe(1)
+    expect(init.decks).toBe(DECKS)
+  })
+
+  it('advances the seed only when a command actually commits', () => {
+    const h = harness()
+    const first = h.readState()
+    h.coordinator.request(first, h.handlers)
+    const t = h.transport()
+
+    // A delivered-but-rejected command must NOT consume the position's seed.
+    h.setCommit(false)
+    t.handlers.message(resultFor(first, t.searches[0]?.requestId ?? 0))
+    h.clock.advance(STEP_MS)
+    expect(h.delivered).toHaveLength(1)
+
+    h.coordinator.request(first, h.handlers)
+    expect(t.searches[1]?.seed).toBe(searchSeed(GAME_SEED, 0))
+
+    // Now let it commit, and the next position is a different question.
+    h.setCommit(true)
+    t.handlers.message(resultFor(first, t.searches[1]?.requestId ?? 0))
+    h.clock.advance(STEP_MS)
+    expect(h.delivered).toHaveLength(2)
+
+    h.coordinator.request(first, h.handlers)
+    expect(t.searches[2]?.seed).toBe(searchSeed(GAME_SEED, 1))
+    expect(t.searches[2]?.seed).not.toBe(searchSeed(GAME_SEED, 0))
+  })
+})
+
+describe('SearchCoordinator: the four-condition acceptance rule (D2-4)', () => {
+  it('applies a correlated reply for the state it was asked about', () => {
+    const h = harness()
+    const state = h.readState()
+    h.coordinator.request(state, h.handlers)
+    const t = h.transport()
+    t.handlers.message(resultFor(state, t.searches[0]?.requestId ?? 0))
+    h.clock.advance(STEP_MS)
+    expect(h.delivered).toHaveLength(1)
+    expect(h.delivered[0]?.state).toBe(state)
+    expect(h.warnings).toHaveLength(0)
+  })
+
+  it('drops a reply whose requestId has been superseded', () => {
+    const h = harness()
+    const state = h.readState()
+    h.coordinator.request(state, h.handlers)
+    const staleId = h.transport().searches[0]?.requestId ?? 0
+    h.coordinator.request(state, h.handlers)
+
+    h.transport().handlers.message(resultFor(state, staleId))
+    h.clock.advance(STEP_MS * 4)
+    expect(h.delivered).toHaveLength(0)
+  })
+
+  it('drops a reply that arrives after restart', () => {
+    const h = harness()
+    const state = h.readState()
+    h.coordinator.request(state, h.handlers)
+    const t = h.transport()
+    const id = t.searches[0]?.requestId ?? 0
+
+    // `restart()` replaces `stateRef.current` and invalidates — but the reply is already on its way.
+    h.setState(aiToAct(12))
+    h.coordinator.invalidate()
+
+    t.handlers.message(resultFor(state, id))
+    h.clock.advance(STEP_MS * 4)
+    expect(h.delivered).toHaveLength(0)
+  })
+
+  // The non-obvious racer: concede is legal even when the human is not the acting player, so a human click
+  // really can commit a new state in the middle of the AI's turn.
+  it('drops a reply that arrives after a human concede', () => {
+    const h = harness()
+    const state = h.readState()
+    h.coordinator.request(state, h.handlers)
+    const t = h.transport()
+    const id = t.searches[0]?.requestId ?? 0
+
+    const concede: Command = { type: 'concede', player: HUMAN }
+    expect(legalCommands(state, HUMAN).some((c) => c.type === 'concede')).toBe(true)
+    const conceded = apply(state, concede).state
+    expect(conceded.result).not.toBeNull()
+    h.setState(conceded)
+    h.coordinator.invalidate()
+
+    t.handlers.message(resultFor(state, id))
+    h.clock.advance(STEP_MS * 4)
+    expect(h.delivered).toHaveLength(0)
+  })
+
+  // Defence in depth: the identity check must hold even when nobody remembered to invalidate.
+  it('drops a reply whose state is no longer stateRef.current even without an invalidate', () => {
+    const h = harness()
+    const state = h.readState()
+    h.coordinator.request(state, h.handlers)
+    const t = h.transport()
+
+    h.setState(apply(state, { type: 'concede', player: HUMAN }).state)
+    t.handlers.message(resultFor(state, t.searches[0]?.requestId ?? 0))
+    h.clock.advance(STEP_MS * 4)
+    expect(h.delivered).toHaveLength(0)
+  })
+
+  it('drops a reply that arrives after effect cleanup', () => {
+    const h = harness()
+    const state = h.readState()
+    h.coordinator.request(state, h.handlers)
+    const t = h.transport()
+    h.coordinator.invalidate()
+    t.handlers.message(resultFor(state, t.searches[0]?.requestId ?? 0))
+    h.clock.advance(STEP_MS * 4)
+    expect(h.delivered).toHaveLength(0)
+  })
+
+  it('drops a reply that arrives after unmount, and terminates the worker', () => {
+    const h = harness()
+    const state = h.readState()
+    h.coordinator.request(state, h.handlers)
+    const t = h.transport()
+    h.coordinator.dispose()
+    expect(t.terminations).toBe(1)
+
+    t.handlers.message(resultFor(state, t.searches[0]?.requestId ?? 0))
+    h.clock.advance(STEP_MS * 4)
+    expect(h.delivered).toHaveLength(0)
+    // A disposed coordinator is inert: a later request must not resurrect a worker.
+    h.coordinator.request(state, h.handlers)
+    expect(h.transports).toHaveLength(1)
+  })
+
+  it('cancels an accepted-but-unpaced delivery when cleanup lands inside the deadline', () => {
+    const h = harness()
+    const state = h.readState()
+    h.coordinator.request(state, h.handlers)
+    const t = h.transport()
+    t.handlers.message(resultFor(state, t.searches[0]?.requestId ?? 0))
+    h.clock.advance(STEP_MS / 2)
+    h.coordinator.invalidate()
+    h.clock.advance(STEP_MS * 4)
+    expect(h.delivered).toHaveLength(0)
+  })
+
+  it('never delivers for a state the AI does not own', () => {
+    const h = harness()
+    const humanState = humanToAct(11)
+    h.setState(humanState)
+    h.coordinator.request(humanState, h.handlers)
+    const t = h.transport()
+    const command = legalCommands(humanState, HUMAN)[0]
+    if (!command) throw new Error('no legal human command')
+    t.handlers.message({ type: 'result', requestId: t.searches[0]?.requestId ?? 0, result: { command, diagnostics: EMPTY_DIAGNOSTICS } })
+    h.clock.advance(STEP_MS * 4)
+    expect(h.delivered).toHaveLength(0)
+  })
+
+  it('leaves no timer armed once a game is disposed', () => {
+    const h = harness()
+    h.coordinator.request(h.readState(), h.handlers)
+    expect(h.clock.armed).toBeGreaterThan(0)
+    h.coordinator.dispose()
+    expect(h.clock.armed).toBe(0)
+  })
+})
+
+describe('SearchCoordinator: pacing is a deadline, not an added delay (D2-5)', () => {
+  it('holds a fast result until AI_STEP_MS has passed since the request', () => {
+    const h = harness()
+    const state = h.readState()
+    h.coordinator.request(state, h.handlers)
+    const t = h.transport()
+
+    h.clock.advance(50)
+    t.handlers.message(resultFor(state, t.searches[0]?.requestId ?? 0))
+    h.clock.advance(STEP_MS - 51)
+    expect(h.delivered).toHaveLength(0)
+    h.clock.advance(1)
+    expect(h.delivered).toHaveLength(1)
+  })
+
+  it('applies a slow result immediately rather than adding another AI_STEP_MS', () => {
+    const h = harness()
+    const state = h.readState()
+    h.coordinator.request(state, h.handlers)
+    const t = h.transport()
+
+    h.clock.advance(750)   // the search already showed 750 ms of thinking
+    t.handlers.message(resultFor(state, t.searches[0]?.requestId ?? 0))
+    h.clock.advance(0)
+    expect(h.delivered).toHaveLength(1)
+  })
+})
+
+describe('SearchCoordinator: fallback detection (D2-6)', () => {
+  it('falls back when the environment has no Worker at all', () => {
+    // The real factory, in an environment that genuinely has none — which is this test runner.
+    expect(typeof Worker).toBe('undefined')
+    const h = harness({ factory: workerTransport })
+    h.coordinator.request(h.readState(), h.handlers)
+    expectOneWarningAndACommand(h)
+  })
+
+  it('the real factory refuses to construct without Worker support', () => {
+    const noop: TransportHandlers = { message: () => {}, failure: () => {} }
+    expect(() => workerTransport(noop)).toThrow(/Web Worker/)
+  })
+
+  it('falls back when the transport constructor throws', () => {
+    const h = harness({ factory: () => { throw new Error('module chunk 404') } })
+    h.coordinator.request(h.readState(), h.handlers)
+    expectOneWarningAndACommand(h)
+    expect(h.warnings[0]).toContain('module chunk 404')
+  })
+
+  it('falls back on a synchronous postMessage clone failure', () => {
+    const h = harness({ onCreate: (t) => { t.postThrows = 'could not be cloned' } })
+    h.coordinator.request(h.readState(), h.handlers)
+    expectOneWarningAndACommand(h)
+    expect(h.transport().terminations).toBe(1)
+  })
+
+  it('falls back on an error event', () => {
+    const h = harness()
+    h.coordinator.request(h.readState(), h.handlers)
+    h.transport().handlers.failure('the search worker failed to load')
+    expectOneWarningAndACommand(h)
+    expect(h.transport().terminations).toBe(1)
+  })
+
+  it('falls back on a messageerror event', () => {
+    const h = harness()
+    h.coordinator.request(h.readState(), h.handlers)
+    h.transport().handlers.failure('the search worker sent a message that could not be read')
+    expectOneWarningAndACommand(h)
+  })
+
+  it('falls back on a typed error message', () => {
+    const h = harness()
+    h.coordinator.request(h.readState(), h.handlers)
+    const t = h.transport()
+    t.handlers.message({ type: 'error', requestId: t.searches[0]?.requestId ?? 0, message: 'searchIsmcts: the game is already over' })
+    expectOneWarningAndACommand(h)
+    expect(h.warnings[0]).toContain('searchIsmcts')
+  })
+
+  /**
+   * The failure funnel must RECOVER, never merely give up. `fail()` used to `invalidate()` — cancelling the
+   * outstanding request and any pending delivery — and then return early whenever the error did not correlate
+   * with what was live, scheduling no move and emitting no warning. The AI then never acted again: the effect
+   * keys on the committed state, which never changes, so nothing re-requests. Silent hang, spinner up, empty
+   * log — the inverse of the silent degradation D2-6 exists to forbid, and worse, because it stops the game.
+   */
+  it('recovers even when the error names a request that is no longer the live one', () => {
+    const h = harness()
+    h.coordinator.request(h.readState(), h.handlers)
+    const t = h.transport()
+    const superseded = t.searches[0]?.requestId ?? 0
+    h.coordinator.invalidate()
+    h.coordinator.request(h.readState(), h.handlers)   // a newer request is now outstanding
+    t.handlers.message({ type: 'error', requestId: superseded, message: 'worker blew up on the old request' })
+    expectOneWarningAndACommand(h)
+  })
+
+  it('does not cancel a fallback move that a previous failure already scheduled', () => {
+    const h = harness()
+    h.coordinator.request(h.readState(), h.handlers)
+    const t = h.transport()
+    t.handlers.failure('first failure')
+    // A second failure landing inside the fallback's own pacing window must leave the queued Greedy move alone.
+    t.handlers.failure('second failure')
+    expectOneWarningAndACommand(h)
+  })
+
+  it('falls back on an init failure, which carries no requestId', () => {
+    const h = harness()
+    h.coordinator.request(h.readState(), h.handlers)
+    h.transport().handlers.message({ type: 'error', requestId: null, message: 'search worker received a request before init' })
+    expectOneWarningAndACommand(h)
+  })
+
+  // The one failure with no correlated event of any kind: a worker that is killed or hangs.
+  it('falls back when the worker simply never replies', () => {
+    const h = harness()
+    h.coordinator.request(h.readState(), h.handlers)
+    expect(h.delivered).toHaveLength(0)
+
+    h.clock.advance(STARTUP_WATCHDOG_MS)
+    // The deadline is long past by now, so the Greedy command lands on the same tick.
+    expect(h.delivered).toHaveLength(1)
+    expect(h.warnings).toHaveLength(1)
+    expect(h.warnings[0]).toContain('did not respond')
+    expect(h.coordinator.usingFallback).toBe(true)
+    expect(h.transport().terminations).toBe(1)
+  })
+
+  it('uses the shorter watchdog once the worker has started', () => {
+    const h = harness()
+    const state = h.readState()
+    h.coordinator.request(state, h.handlers)
+    const t = h.transport()
+    t.handlers.message(resultFor(state, t.searches[0]?.requestId ?? 0))
+    h.clock.advance(STEP_MS)
+    expect(h.delivered).toHaveLength(1)
+
+    h.coordinator.request(state, h.handlers)
+    h.clock.advance(WATCHDOG_MS)
+    expect(h.coordinator.usingFallback).toBe(true)
+    expect(h.delivered).toHaveLength(2)
+  })
+
+  it('warns once per game, however many things go wrong', () => {
+    const h = harness()
+    const state = h.readState()
+    h.coordinator.request(state, h.handlers)
+    h.transport().handlers.failure('first failure')
+    h.clock.advance(STEP_MS)
+    h.transport().handlers.failure('second failure')
+
+    h.coordinator.request(state, h.handlers)
+    h.clock.advance(STEP_MS)
+    h.coordinator.request(state, h.handlers)
+    h.clock.advance(STEP_MS)
+
+    expect(h.warnings).toHaveLength(1)
+    expect(h.warnings[0]).toContain('first failure')
+    expect(h.delivered).toHaveLength(3)
+  })
+
+  // A worker can die between decisions, when there is no handler to warn through. The warning must not be lost.
+  it('defers the warning to the next request when nothing was outstanding', () => {
+    const h = harness()
+    const state = h.readState()
+    h.coordinator.request(state, h.handlers)
+    const t = h.transport()
+    t.handlers.message(resultFor(state, t.searches[0]?.requestId ?? 0))
+    h.clock.advance(STEP_MS)
+    expect(h.delivered).toHaveLength(1)
+
+    t.handlers.failure('the worker died between decisions')
+    expect(h.warnings).toHaveLength(0)
+    expect(h.coordinator.usingFallback).toBe(true)
+
+    h.coordinator.request(state, h.handlers)
+    h.clock.advance(STEP_MS)
+    expect(h.warnings).toHaveLength(1)
+    expect(h.warnings[0]).toContain('died between decisions')
+    expect(h.delivered).toHaveLength(2)
+  })
+
+  it('never builds another worker once it has fallen back', () => {
+    const h = harness()
+    h.coordinator.request(h.readState(), h.handlers)
+    h.transport().handlers.failure('gone')
+    h.clock.advance(STEP_MS)
+    h.coordinator.request(h.readState(), h.handlers)
+    h.clock.advance(STEP_MS)
+    expect(h.transports).toHaveLength(1)
+    expect(h.transport().searches).toHaveLength(1)
+  })
+
+  // The fallback carries the same staleness and pacing rules, or it would corrupt games the worker never touched.
+  it('drops a fallback command when the position moves on inside the deadline', () => {
+    const h = harness()
+    const state = h.readState()
+    h.coordinator.request(state, h.handlers)
+    h.transport().handlers.failure('gone')
+    h.setState(apply(state, { type: 'concede', player: HUMAN }).state)
+    h.clock.advance(STEP_MS * 4)
+    expect(h.delivered).toHaveLength(0)
+    expect(h.warnings).toHaveLength(1)
+  })
+
+  it('keeps advancing the per-position seed under the fallback', () => {
+    const h = harness()
+    const state = h.readState()
+    h.coordinator.request(state, h.handlers)
+    h.transport().handlers.failure('gone')
+    h.clock.advance(STEP_MS)
+    expect(h.delivered).toHaveLength(1)
+    expect(h.coordinator.nextSeed).toBe(searchSeed(GAME_SEED, 1))
+  })
+})
diff --git a/apps/web/test/search-protocol.test.ts b/apps/web/test/search-protocol.test.ts
new file mode 100644
index 0000000..ab7c70f
--- /dev/null
+++ b/apps/web/test/search-protocol.test.ts
@@ -0,0 +1,89 @@
+import { describe, expect, it } from 'vitest'
+import { apply, createGame, legalCommands, viewFor, type GameState, type PlayerId } from '@fftcg/engine'
+import { GreedyAgent, searchIsmcts, type SearchInput } from '@fftcg/ai'
+import { CARD_DEFS, DECKS } from '../src/deck.js'
+import { AI } from '../src/game/types.js'
+import { describeFailure, respond, searchInputFor, type WorkerInit, type WorkerSearchRequest } from '../src/game/search/protocol.js'
+
+const ROLLOUT_COMMAND_CAP = 8
+const EXPLORATION_C = 1
+
+const INIT: WorkerInit = { type: 'init', decks: DECKS, rolloutCommandCap: ROLLOUT_COMMAND_CAP, explorationC: EXPLORATION_C }
+
+/** Fast-forward a real game to the first position the AI actually owns; anything else is not a search input. */
+function aiToAct(seed: number): GameState {
+  let state: GameState = createGame({ seed, decks: DECKS, defs: CARD_DEFS })
+  const agent = new GreedyAgent({ seed, decks: DECKS, depth: 1 })
+  for (let i = 0; i < 400; i++) {
+    const p: PlayerId | null = state.result ? null : (state.pending?.player ?? state.priority)
+    if (p === null) break
+    if (p === AI) return state
+    state = apply(state, agent.decide(viewFor(state, p), legalCommands(state, p))).state
+  }
+  throw new Error(`seed ${seed} never reached an AI decision`)
+}
+
+const requestFor = (state: GameState, over: Partial<WorkerSearchRequest> = {}): WorkerSearchRequest =>
+  ({ type: 'search', requestId: 7, view: viewFor(state, AI), seed: 12345, iterations: 12, ...over })
+
+describe('search protocol', () => {
+  // D2-A3: the boundary must be a pure translation. A `respond` that quietly re-derived caps or a seed would
+  // make the browser play a different game from the headless gate that measured 90.0 %.
+  it('respond returns exactly what a direct searchIsmcts call returns (D2-A3)', () => {
+    const state = aiToAct(11)
+    const request = requestFor(state)
+    // Clone the request the way `postMessage` would, so the comparison is across a real serialization too.
+    const direct = searchIsmcts(searchInputFor(INIT, structuredClone(request)))
+    const viaProtocol = respond(INIT, request)
+    expect(viaProtocol.type).toBe('result')
+    expect(viaProtocol).toEqual({ type: 'result', requestId: 7, result: direct })
+  })
+
+  // The `requestId` is correlation only — it must never reach the search, or a retry of one position would
+  // pick a different move (D2-3).
+  it('the requestId does not influence the answer', () => {
+    const state = aiToAct(11)
+    const a = respond(INIT, requestFor(state, { requestId: 1 }))
+    const b = respond(INIT, requestFor(state, { requestId: 9999 }))
+    if (a.type !== 'result' || b.type !== 'result') throw new Error('expected results')
+    expect(a.result).toEqual(b.result)
+  })
+
+  it('searchInputFor takes the caps from init and the position from the request', () => {
+    const state = aiToAct(11)
+    const input: SearchInput = searchInputFor(INIT, requestFor(state, { seed: 99, iterations: 5 }))
+    expect(input.rolloutCommandCap).toBe(ROLLOUT_COMMAND_CAP)
+    expect(input.explorationC).toBe(EXPLORATION_C)
+    expect(input.decks).toBe(DECKS)
+    expect(input.seed).toBe(99)
+    expect(input.iterations).toBe(5)
+  })
+
+  it('a throwing search becomes an error message carrying its own requestId', () => {
+    const state = aiToAct(11)
+    const message = respond(INIT, requestFor(state, { requestId: 42, iterations: 0 }))
+    expect(message.type).toBe('error')
+    if (message.type !== 'error') throw new Error('unreachable')
+    expect(message.requestId).toBe(42)
+    expect(typeof message.message).toBe('string')
+    expect(message.message).toMatch(/iterations/)
+  })
+
+  it('errors cross as plain strings, never as Error objects', () => {
+    expect(describeFailure(new RangeError('boom'))).toBe('boom')
+    expect(describeFailure('boom')).toBe('boom')
+    expect(describeFailure(undefined)).toBe('undefined')
+  })
+
+  // Every message is posted, so every message must clone. `structuredClone` throws on anything that does not.
+  it('every message is structured-cloneable', () => {
+    const state = aiToAct(11)
+    const request = requestFor(state)
+    const result = respond(INIT, request)
+    expect(() => structuredClone(INIT)).not.toThrow()
+    expect(() => structuredClone(request)).not.toThrow()
+    expect(() => structuredClone(result)).not.toThrow()
+    expect(() => structuredClone({ type: 'error', requestId: null, message: 'init failed' })).not.toThrow()
+    expect(structuredClone(result)).toEqual(result)
+  })
+})
diff --git a/docs/superpowers/specs/2026-08-27-rung-d2-search-worker.md b/docs/superpowers/specs/2026-08-27-rung-d2-search-worker.md
index d70ec7c..316f098 100644
--- a/docs/superpowers/specs/2026-08-27-rung-d2-search-worker.md
+++ b/docs/superpowers/specs/2026-08-27-rung-d2-search-worker.md
@@ -1,69 +1,142 @@
 # Rung D2 — The search in a Web Worker: the browser gets the strong opponent
 
+> Revision 2 (2026-08-27), after a Codex plan-review that found two blockers and corrected two claims of
+> mine. The review is `docs/superpowers/plans/2026-08-27-rung-d2-search-worker.codex-review.md`.
+
 ## Context
 
 D1 is merged (`b22be0f`): headless SO-ISMCTS beats `GreedyAgent` **90.0 %** over 120 mirrored games at
 ~254 ms/decision. **The browser still plays `GreedyAgent`** — D1 was headless by design, because 254 ms of
-synchronous search would block the main thread and freeze the board mid-turn.
+synchronous search would freeze the board mid-turn.
+
+D2 is the wiring only. The search core does not change: `searchIsmcts(input): SearchResult` is already
+pure, synchronous and structured-cloneable, which is what D1 was told to leave behind.
+
+## Architecture: three layers, because the races must be testable
+
+Revision 1 put worker lifecycle, pacing, retries, fallback and stale-result handling into `useGame`'s AI
+`useEffect`. That hook already owns state, pacing, mutation and the agent loop; adding this to it would make
+every D2-specific race a matter of React timing folklore rather than a test.
 
-D2 is the wiring, and only the wiring. The search core does not change: `searchIsmcts(input): SearchResult`
-is already pure, synchronous and structured-cloneable, which is exactly what D1 was told to leave behind so
-this rung would not have to rewrite it.
+1. **`protocol.ts`** — discriminated message types and the pure `respond(init, request)`. Deterministic
+   translation only; no lifecycle, no knowledge of what is outstanding.
+2. **`worker.ts`** — a thin shell: store init, `try`/`catch`, `postMessage`. Vitest cannot drive a real
+   `Worker`, so the shell deliberately contains nothing worth testing.
+3. **`SearchCoordinator`** — one worker per mounted hook. Owns generation/request tracking, stable
+   per-position seeds, the pacing deadline, the watchdog, termination, and the `GreedyAgent` fallback.
+   **This is the layer the D2 tests target**, because this is where every race lives.
+
+`useGame` then does what it already does: capture a state, ask for a command, re-check legality against that
+exact state, narrate, commit.
 
 ## Decisions
 
 | # | Decision | Ruling (and why) |
 |---|---|---|
-| D2-1 | A **typed worker protocol**, not ad-hoc `postMessage` | `WorkerInit` (the two declared deck lists, sent once), `WorkerSearchRequest` (`requestId`, `view`, `seed`, `iterations`), `WorkerSearchResult` (`requestId`, `command`, `diagnostics`) and `WorkerError`. Every one structured-cloneable. Codex's D1 review flagged that the seam *promised* this and did not have it. |
-| D2-2 | **Decks at init; the view per request** | Decks are what the search needs and the view does not carry. `PlayerView` already carries `defs`, so a request re-sends the 18-card catalogue — measured as negligible against a 600 ms turn, so **it is left alone**. Stripping `defs` and rehydrating in the worker is available if measurement ever says otherwise; doing it now would be optimising a cost nobody has shown. |
-| D2-3 | **A pure `respond(init, request)` the worker merely wraps** | The same trick that made D1 testable: all protocol logic lives in a plain function, and `worker.ts` is a thin `onmessage` shell. Vitest cannot drive a real `Worker`, so anything inside the shell is untestable — the shell therefore contains nothing worth testing. |
-| D2-4 | **Requests are generation-checked; stale results are dropped** | `requestId` increases monotonically; the hook ignores any result that is not the one it is waiting for. Restarting a game, or the human acting while the AI thinks, must not have a late result applied to a board that has moved on. This is the defect most likely to be *intermittent* rather than reproducible, so it gets an explicit test rather than an inspection. |
-| D2-5 | **Search overlaps the pacing delay, never adds to it** | B7 paces the AI at 600 ms so its turn is watchable. Firing the request *then* waiting 600 ms would make every AI move 850 ms. Start the search immediately and apply the result at `max(elapsed, AI_STEP_MS)`, so the search is free until it exceeds the pacing budget. |
-| D2-6 | **Fall back to `GreedyAgent`, and say so** | If `Worker` is unavailable, the module fails to load, or the worker errors, the game continues with the heuristic agent rather than freezing or silently blocking the main thread. It must be **visible in the log** — an opponent quietly one-tenth as strong is exactly the kind of degradation that goes unnoticed for a rung. |
-| D2-7 | **The iteration budget is measured in the browser, not inherited** | D1's 200 was an implementation default chosen to be "clearly above greedy without being unusable headless", never calibrated. D2 measures ms/iteration in a real browser and picks a budget for a decision that comfortably fits the pacing window, then records the number and the machine it came from. |
-| D2-8 | Not in scope | Any change to the search itself, its keys or its evaluation; a worker pool or parallel search; C3's ability clauses. |
-
-## Build hazard: cleared before designing around it
+| D2-1 | A **discriminated wire contract** | `type: 'init' \| 'search' \| 'result' \| 'error'`. Init carries the two declared deck lists **and the stable search configuration** (`rolloutCommandCap`, `explorationC` — `SearchInput` requires them and revision 1's request listed only seed and iterations). Errors carry their `requestId`, or `null` for an init failure, and post **plain strings, never `Error` objects**. |
+| D2-2 | **Decks and config at init; the view per request** | `PlayerView` carries `defs` by design and the UI needs them; the search already clones a state containing the same definitions once per determinisation, so one 18-card catalogue per request is not the dominant cost. Revision 1 called this "measured as negligible" — **it was not measured**; D2-A2 now reports the actual serialized size and posting duration, and `Omit<PlayerView,'defs'>` is revisited only if the catalogue materially grows. |
+| D2-3 | **Search seeds are stable per game POSITION** | Derived from `(gameSeed, committedAiDecisionIndex)`, incremented **only when an AI command successfully commits**. Never from `requestId`. A seed advanced when the effect *posts* is consumed again by StrictMode's double-invoke, by a retry, by a stale request and by worker replacement — so dev and prod would choose different moves from the same board, which is the worst kind of "works on my machine". |
+| D2-4 | **A result is accepted only under all four conditions** | `mounted && activeRequestId === result.requestId && stateRef.current === requestedState && actingPlayer(requestedState) === AI`. Then clear the active id *before* applying, re-check the command against `legalCommands(requestedState, AI)`, and commit from that same captured state. Restart, any external commit, effect cleanup and unmount must **synchronously** invalidate the active id; unmount must also terminate the worker. Note the non-obvious racer: **concede is legal even when the human is not the acting player**, so a human `choose()` really can commit mid-AI-turn. |
+| D2-5 | **Pacing is a deadline, not an added delay** | `notBefore = startedAt + AI_STEP_MS`; when the result arrives, schedule at `Math.max(0, notBefore - performance.now())`. A fast search still waits out the 600 ms; a 750 ms search applies immediately, having already shown 750 ms of thinking. Revision 1's "apply at `max(elapsed, AI_STEP_MS)`" was ambiguous enough to be implemented as an *extra* 600 ms. |
+| D2-6 | **Fall back to `GreedyAgent`, detect every way it can fail, and say so** | Greedy, not reduced-iteration main-thread ISMCTS: the latter is still a synchronous search with variable rollout cost, which gives up the one guarantee this rung exists for. Detection must cover **missing `Worker`, constructor failure, synchronous `postMessage` clone failure, `error`, `messageerror`, a typed `WorkerError`, and a worker that is killed or hangs and simply never replies** — the last needs a startup and per-request **watchdog**, because nothing correlated ever arrives. On failure: invalidate the request, terminate the worker, switch to Greedy **permanently for that game**, append **one** visible log warning, and play Greedy against the current state under the same pacing deadline. |
+| D2-7 | **The iteration budget is measured in the browser** | D1's 200 was an implementation default, never calibrated. Measure, choose, and record the number with the machine and browser it came from. If the browser budget lands well below 200, **the opponent a human faces is weaker than the one D1 measured**, and that gets said. |
+| D2-8 | Not in scope | Any change to the search, its keys or its evaluation; a worker pool or parallel search; C3's ability clauses. |
 
-The spec's main unknown was whether a Vite worker resolves the workspace packages, which are published as
-**raw TypeScript** (`main: src/index.ts`) and reached out of the monorepo root via `server.fs.allow`. A
-throwaway worker importing `searchIsmcts` was built and run in both modes:
+## Build hazard: partly cleared, and the rest is an acceptance gate
 
-- **dev**: logged `worker sees searchIsmcts as: function`;
-- **production**: `vite build` emitted `dist/assets/probe.worker-*.js` at **52 kB** — the search bundled
-  into its own worker chunk, separate from the 275 kB app chunk.
+A throwaway worker importing `searchIsmcts` resolved the raw-TypeScript workspace packages in both modes:
+dev logged `worker sees searchIsmcts as: function`, and `vite build` emitted a **52 kB worker chunk**
+separate from the 275 kB app chunk. `new Worker(new URL(…, import.meta.url), { type: 'module' })` is Vite's
+supported static form, and linked monorepo packages exporting ESM are treated as source.
 
-So `new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })` works, and there is **no
-dev/prod divergence** on resolution. Recorded because a passing dev check alone would not have shown it,
-and because the failure mode this rung most fears is a worker that builds and then silently falls back.
+**That proves the chunk is emitted, not that it loads and runs when served** — revision 1 claimed the hazard
+"cleared", which was too strong. `server.fs.allow` is dev-only; production takes a different bundler path,
+and hashed asset loading, MIME and base-path failures all live there. Hence D2-A7 below.
 
 ## Acceptance criteria
 
-- **D2-A1** The browser plays a **full game to a result** against ISMCTS, driven end to end, with no
-  uncaught errors.
-- **D2-A2** **The main thread is not blocked.** Measured, not asserted: the longest task during an AI turn
-  stays well under the pacing window, and the board stays responsive to a click while the AI is thinking.
-- **D2-A3** **Determinism across the boundary**: the same `(view, seed, iterations)` through `respond`
-  returns exactly the command a direct `searchIsmcts` call returns. The worker must not be a second,
-  subtly different agent.
-- **D2-A4** **Staleness**: a result whose `requestId` is not the outstanding one is dropped. Tested by
-  driving `respond` out of order, not by hoping the race does not happen.
-- **D2-A5** **Fallback**: with `Worker` unavailable the game still plays a full game, using `GreedyAgent`,
-  and the log says which opponent is playing.
+- **D2-A1** The browser plays a **full game to a result** against ISMCTS, end to end, no uncaught errors.
+- **D2-A2 (honest non-blocking measurement)** On a **production preview**, over N AI decisions: mark
+  request-post, response and commit; observe **`longtask` entries** (any reported entry is ≥ 50 ms by
+  definition); record the **maximum `requestAnimationFrame` gap**; inject a harmless test button and record
+  **input-to-handler** while a search is active. Report browser, machine, iterations, sample count, max long
+  task, max frame gap, max input delay, and worker round-trip p50/p95 — plus the request's serialized size
+  and posting duration (D2-2). *"No main-thread task ≥ 50 ms during N AI searches"* is a result;
+  *"well under 600 ms"* is not, and was revision 1's wording.
+- **D2-A3 (determinism across the boundary)** The same `(view, seed, iterations, caps)` through `respond`
+  returns exactly the command a direct `searchIsmcts` call returns.
+- **D2-A4 (staleness, at the right layer)** Tested against the **coordinator**, not `respond`: deferred
+  replies delivered after a restart, after a human commit (including concede), after StrictMode cleanup, and
+  after unmount must all be dropped, and the worker terminated on unmount.
+- **D2-A5 (fallback)** Each detectable failure — no `Worker`, constructor throw, clone failure, `error`,
+  `messageerror`, typed error, and a never-replying worker — switches to Greedy, logs **one** warning, and
+  still finishes a game.
 - **D2-A6** The chosen iteration budget is recorded with the measurement that produced it.
-- **D2-A7** `pnpm test`, `pnpm typecheck`, `pnpm lint` green; the headless gates are untouched
+- **D2-A7** `pnpm test`, `pnpm typecheck`, `pnpm lint` **and `pnpm --filter @fftcg/web build`** green, plus
+  a **production-preview** browser run that loads the emitted worker asset, completes a real `postMessage`
+  round trip, and asserts ISMCTS is actually playing rather than the fallback. Headless gates untouched
   (462 tests, ISMCTS 90.0 % vs greedy, strict fuzzer 0 failures).
 
 ## Risks
 
-- **Staleness is intermittent by nature.** A late result applied to a moved-on board would corrupt the game
-  rarely and unreproducibly — the worst failure shape there is. D2-A4 is the mitigation and it must be a
-  test, not a code reading.
-- **The fallback can hide itself.** If the worker silently fails, the game keeps working and simply plays
-  worse. Hence D2-6's requirement that it be visible in the log.
-- **Vite worker bundling.** `new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })` is the
-  supported form; the workspace packages are raw TypeScript, so the worker bundle must resolve them the same
-  way the app does. A worker that fails to build is loud; one that builds but silently falls back is not.
-- **The search is unchanged, so its D1 caveats stand**: the iteration budget was never strength-calibrated,
-  and rollouts are ~117× the tree cost. If the browser budget lands well below 200 iterations, the opponent
-  the human faces is weaker than the one D1 measured — and that must be stated, not assumed away.
+- **Staleness is intermittent by nature**, and it is the reason for the coordinator layer. A late result
+  applied to a moved-on board corrupts a game rarely and unreproducibly.
+- **The fallback can hide itself.** If the worker silently fails the game keeps working and simply plays
+  worse — hence one visible warning, and hence D2-A7 asserting ISMCTS rather than merely "a game happened".
+- **Seed drift between dev and prod** (D2-3) would be diagnosed as a search bug and is not one.
+- **D1's caveats stand**: the iteration budget was never strength-calibrated, and rollouts are ~117× the
+  tree cost.
+
+## Changelog vs revision 1
+
+- **Three-layer architecture with a `SearchCoordinator`** — revision 1 put lifecycle, retries, watchdog and
+  fallback into a `useEffect`, where none of the races could be tested.
+- **Staleness moved to the coordinator** with the four-condition acceptance rule (D2-4); revision 1 tested
+  it against pure `respond`, which cannot see any of it.
+- **Stable per-position seeds** (D2-3) — new; revision 1 left seed allocation undefined.
+- **Fallback detection enumerated**, including the watchdog for a worker that never replies (D2-6).
+- **D2-A2 replaced with an actual measurement protocol**; the old criterion was unfalsifiable.
+- **Production build and preview added to D2-A7**; the dev probe proved emission, not execution.
+- **Wire contract completed** — discriminated union, config at init, `requestId` on errors, plain strings.
+- **Pacing restated as a deadline** (D2-5).
+
+## Measurement (D2-A2 / D2-A6), taken 2026-08-27
+
+Production preview (`vite build` + `vite preview`, port 5310), Chromium via Playwright, Apple Silicon
+(darwin 25.5.0), default budget **200 iterations**, `rolloutCommandCap` 24, `rolloutApplyCap` 2048.
+Three complete games driven end to end; the numbers below are the second and third, where a patched
+`Worker` constructor recorded every message.
+
+| Quantity | Result |
+|---|---|
+| Worker asset actually served | `GET /assets/worker-DkZKnaJU.js → 200` (hashed production chunk, 52.8 kB) |
+| Searches posted / results received / worker errors | **33 / 33 / 0**, then **34 / 34 / 0** |
+| Worker round trip | **p50 152 ms, p95 240 ms, max 288 ms** |
+| Main-thread `longtask` entries during those searches | **0** (any reported entry would be ≥ 50 ms) |
+| Maximum `requestAnimationFrame` gap | **22 ms**, then **19 ms** |
+| Input delay, real trusted clicks (Event Timing, n = 12) | **0–1 ms** (`processingStart − startTime`) |
+| Search request serialized size | median **14.2 kB**, max 15.4 kB |
+| `postMessage` duration (main-thread cost of posting) | max **0.20 ms** |
+| Fallback warnings logged | **none** |
+
+**Reading the numbers.** The frame gap is the load-bearing one: a 200-iteration search on the main thread
+would have shown a rAF gap of at least its own duration, so a max gap of 19–22 ms across whole games is
+direct evidence the search never ran there. Zero `longtask` entries says the same thing from the other side.
+
+The *first* pass at input delay used synthetic `.click()` and reported a flat 0 ms — worthless, because a
+programmatic click dispatches synchronously and measures nothing. The table's figure is from real Playwright
+input observed through `PerformanceEventTiming`.
+
+**D2-2 resolved.** Leaving `defs` in the per-request view costs 14.2 kB and **0.20 ms** of main-thread
+posting. Revision 1 called this "negligible" without measuring; measured, it is in fact negligible, and
+`Omit<PlayerView,'defs'>` stays unnecessary.
+
+**D2-6 / D2-A7 asserted positively.** Every AI decision in both instrumented games was a completed worker
+round trip (33/33, 34/34, zero errors, zero fallback warnings). This is the assertion the spec asked for —
+not "no warning appeared", which is only evidence of silence.
+
+**D2-A6: the budget does not need reducing.** Round trips of p50 152 ms / p95 240 ms bracket D1's headless
+~254 ms per decision, so the browser affords the **same 200 iterations D1 measured**. The risk the spec
+raised — that the human would face a weaker opponent than the 90.0 % one — did not materialise: the browser
+opponent is the D1 opponent. The budget still has not been *strength*-calibrated (D1's caveat stands); what
+is now known is that the browser is not the thing forcing it down.

exec
/bin/zsh -lc 'nl -ba apps/web/src/game/search/protocol.ts' in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
exec
/bin/zsh -lc 'nl -ba docs/superpowers/plans/2026-08-27-rung-d2-search-worker.codex-review.md' in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
exec
/bin/zsh -lc 'nl -ba apps/web/src/game/search/worker.ts' in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
     1	import { searchIsmcts, type SearchInput, type SearchResult } from '@fftcg/ai'
     2	import type { PlayerView } from '@fftcg/engine'
     3	
     4	/**
     5	 * The wire contract between the main thread and the search worker (spec D2-1).
     6	 *
     7	 * Every message here is structured-cloneable by construction: `PlayerView`, `SearchResult` and the declared
     8	 * lists are plain data (spec D-7/D-9), and errors cross as **plain strings** — an `Error` clones as a bare
     9	 * `{}` in some engines and loses its message in others, which turns a worker failure into a silent one.
    10	 */
    11	
    12	/**
    13	 * Sent once per worker, before the first request. It carries the two declared lists AND the stable search
    14	 * configuration: `SearchInput` requires `rolloutCommandCap` and `explorationC`, and neither varies by position,
    15	 * so putting them on every request would be re-declaring a constant across the boundary 200 times a game.
    16	 */
    17	export interface WorkerInit {
    18	  readonly type: 'init'
    19	  /** Both players' publicly declared lists — the open-decklist assumption `determinise` documents. */
    20	  readonly decks: readonly [readonly string[], readonly string[]]
    21	  readonly rolloutCommandCap: number
    22	  readonly explorationC: number
    23	}
    24	
    25	/** One search. `seed` is allocated per game POSITION by the coordinator (D2-3), never from `requestId`. */
    26	export interface WorkerSearchRequest {
    27	  readonly type: 'search'
    28	  readonly requestId: number
    29	  readonly view: PlayerView
    30	  readonly seed: number
    31	  readonly iterations: number
    32	}
    33	
    34	export interface WorkerResultMessage {
    35	  readonly type: 'result'
    36	  readonly requestId: number
    37	  readonly result: SearchResult
    38	}
    39	
    40	/** `requestId` is `null` only for a failure that belongs to no request — init, or a message the worker cannot read. */
    41	export interface WorkerErrorMessage {
    42	  readonly type: 'error'
    43	  readonly requestId: number | null
    44	  readonly message: string
    45	}
    46	
    47	export type WorkerRequestMessage = WorkerInit | WorkerSearchRequest
    48	export type WorkerResponseMessage = WorkerResultMessage | WorkerErrorMessage
    49	
    50	/** Everything that crosses the boundary as a diagnostic is a string, so nothing depends on `Error` cloning. */
    51	export function describeFailure(e: unknown): string {
    52	  return e instanceof Error ? e.message : String(e)
    53	}
    54	
    55	export function searchInputFor(init: WorkerInit, request: WorkerSearchRequest): SearchInput {
    56	  return {
    57	    view: request.view,
    58	    decks: init.decks,
    59	    iterations: request.iterations,
    60	    seed: request.seed,
    61	    rolloutCommandCap: init.rolloutCommandCap,
    62	    explorationC: init.explorationC,
    63	  }
    64	}
    65	
    66	/**
    67	 * Deterministic translation, and nothing else (spec D2-A3): the same `(view, seed, iterations, caps)` returns
    68	 * exactly what a direct `searchIsmcts` call returns.
    69	 *
    70	 * It knows nothing about what is outstanding, which is the whole point — staleness is a property of the main
    71	 * thread's game state, so it is decided by `SearchCoordinator` and cannot be tested here.
    72	 */
    73	export function respond(init: WorkerInit, request: WorkerSearchRequest): WorkerResultMessage | WorkerErrorMessage {
    74	  try {
    75	    return { type: 'result', requestId: request.requestId, result: searchIsmcts(searchInputFor(init, request)) }
    76	  } catch (e) {
    77	    return { type: 'error', requestId: request.requestId, message: describeFailure(e) }
    78	  }
    79	}

 succeeded in 0ms:
     1	<!-- codex=codex-cli 0.146.0 model=gpt-5.6-sol effort=xhigh cwd=/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai exit=0 head=b22be0f -->
     2	
     3	## BLOCKER
     4	
     5	**Staleness is tested at the wrong boundary; `respond()` cannot prove that React drops stale results.**
     6	
     7	`respond(init, request)` is pure and synchronous, so it has no knowledge of the outstanding request or current game state (`docs/superpowers/specs/2026-08-27-rung-d2-search-worker.md:19`). Yet D2-A4 proposes testing staleness by driving `respond` out of order (`docs/superpowers/specs/2026-08-27-rung-d2-search-worker.md:35`). The vulnerable operation is `commit`, which unconditionally replaces `stateRef.current` and appends logs (`apps/web/src/game/useGame.ts:253`). A reply can race:
     8	
     9	- `restart()` replacing `stateRef.current` before React runs effect cleanup (`apps/web/src/game/useGame.ts:274`).
    10	- Any human `choose()` that commits another state (`apps/web/src/game/useGame.ts:262`); notably, concede remains legal even when the human is not acting (`packages/engine/src/legal.ts:19`).
    11	- StrictMode’s effect setup/cleanup/setup cycle (`apps/web/src/main.tsx:8`, `apps/web/src/game/useGame.ts:285`).
    12	- Unmount, after which the callback must not call `commit`.
    13	
    14	**Fix:** The minimum acceptance rule is:
    15	
    16	```ts
    17	mounted &&
    18	activeRequestId === result.requestId &&
    19	stateRef.current === requestedState &&
    20	actingPlayer(requestedState) === AI
    21	```
    22	
    23	Then clear the active request before applying, re-check the command against `legalCommands(requestedState, AI)`, and commit from that same state. Every restart, external commit, effect cleanup, and unmount must synchronously invalidate the active ID; unmount must also terminate the worker. Test the main-thread receiver/controller with deferred replies after restart, human commit, StrictMode cleanup, and unmount. Keep `respond` testing only deterministic translation.
    24	
    25	**Search seeds must be stable per game position, not consumed per effect/request attempt.**
    26	
    27	The protocol carries a seed but never defines its allocation (`docs/superpowers/specs/2026-08-27-rung-d2-search-worker.md:17`). The synchronous agent currently advances its RNG once per actual decision (`packages/ai/src/ismcts/agent.ts:64`). A naïve worker port that advances a ref when the effect posts will consume an extra seed during StrictMode, retries, stale requests, or worker replacement (`apps/web/src/game/useGame.ts:285`). Development and production can therefore choose different moves from the same game.
    28	
    29	**Fix:** Derive the search seed from `(gameSeed, committedAiDecisionIndex)`, or cache one seed against the captured state generation. Increment the decision index only when an AI command successfully commits; retries of the same position must resend the same seed. Do not derive it from `requestId`.
    30	
    31	## MAJOR
    32	
    33	**The Vite worker form and raw workspace TypeScript are sound, but production worker bundling is not an acceptance gate.**
    34	
    35	`new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })` is Vite’s supported static form, and Vite emits it as a separate production chunk. Linked monorepo packages are treated as source when they export ESM, which these do (`packages/ai/package.json:5`, `packages/engine/package.json:5`). `server.fs.allow: ['../..']` correctly covers them in development (`apps/web/vite.config.ts:4`), but that option is dev-only; production uses the separate bundler path. See the [Vite worker documentation](https://vite.dev/guide/features#web-workers), [linked-dependency behavior](https://vite.dev/guide/dep-pre-bundling.html#monorepos-and-linked-dependencies), and [`server.fs.allow`](https://vite.dev/config/server-options.html#server-fs-allow).
    36	
    37	The divergence hazard is therefore not a known incompatibility—it is that D2-A7 runs tests/typecheck/lint but no web build (`docs/superpowers/specs/2026-08-27-rung-d2-search-worker.md:40`). A dev probe cannot catch production chunk generation, hashed asset loading, or deployment MIME/base-path failures.
    38	
    39	**Fix:** Add `pnpm --filter @fftcg/web build` and a production-preview browser test. It must load the emitted worker asset, complete at least one real request through `postMessage`, assert the ISMCTS log/status rather than fallback, and ideally finish D2-A1’s game. Keep `respond` unit tests, but do not call them a worker-boundary test.
    40	
    41	**`GreedyAgent` is the correct fallback; D2-6 does not yet detect every failure it claims to survive.**
    42	
    43	Running reduced ISMCTS on the main thread still invokes a pure synchronous search (`packages/ai/src/ismcts/search.ts:467`) whose rollout cost is variable and only work-capped (`packages/ai/src/ismcts/search.ts:53`). That would weaken the central non-blocking guarantee. Greedy is already the browser-safe, sub-millisecond path (`apps/web/src/game/useGame.ts:11`, `apps/web/src/game/useGame.ts:235`).
    44	
    45	Detection must cover more than `Worker` absence and `error` events:
    46	
    47	- Missing `Worker`, constructor failure, and synchronous `postMessage` clone failure.
    48	- Module-load or uncaught worker failures via `error`.
    49	- Deserialization via `messageerror`.
    50	- Caught `searchIsmcts` exceptions via typed `WorkerError`.
    51	- A worker that is killed or hangs and simply never returns; this needs a deadline because no correlated result is guaranteed.
    52	
    53	**Fix:** Install listeners before init, catch construction/posting, handle `error`, `messageerror`, and typed errors, plus a generous per-request/startup watchdog. On failure: invalidate the request, terminate the worker, switch permanently to Greedy for that game, append one visible warning, and run Greedy against the current state under the same pacing deadline.
    54	
    55	**D2-A2 is not yet an honest measurement, and the board deliberately exposes no useful button during AI control.**
    56	
    57	The criterion asks for the longest task and a responsive click (`docs/superpowers/specs/2026-08-27-rung-d2-search-worker.md:30`), but `GameApi` describes the board as inert while thinking (`apps/web/src/game/types.ts:45`), and `PromptStrip` renders actions only when the human owns the decision (`apps/web/src/ui/PromptStrip.tsx:36`, `apps/web/src/ui/PromptStrip.tsx:62`).
    58	
    59	**Fix:** Measure a production preview in a foreground browser over multiple AI decisions:
    60	
    61	- Mark request-post, response, and commit times.
    62	- Observe `longtask` entries during those intervals; any reported entry is at least 50 ms by definition ([Long Tasks API](https://www.w3.org/TR/longtasks-1/)).
    63	- Record maximum `requestAnimationFrame` gap to catch visible jank.
    64	- Inject a harmless test button whose trusted click toggles a counter; record input-to-handler and input-to-next-paint while search is active.
    65	- Report browser, machine, iterations, sample count, max long task/frame gap/input delay, and worker round-trip p50/p95.
    66	
    67	“No main-thread task ≥50 ms during N AI searches” is a meaningful result; “well under 600 ms” is not.
    68	
    69	## MINOR
    70	
    71	**D2-1 names messages but does not completely specify the wire contract.**
    72	
    73	`SearchInput` also requires `rolloutCommandCap` and `explorationC` (`packages/ai/src/ismcts/keys.ts:491`), while D2’s request lists only seed and iterations (`docs/superpowers/specs/2026-08-27-rung-d2-search-worker.md:17`). `WorkerError` also needs correlation semantics.
    74	
    75	**Fix:** Use discriminated unions such as `type: 'init' | 'search' | 'result' | 'error'`. Put stable search configuration in init or explicitly state that `respond` supplies the exported defaults. Give request errors their `requestId`; initialization errors should use `requestId: null`. Post plain error strings, not raw `Error` objects.
    76	
    77	**D2-5 is correct, but “apply at `max(elapsed, AI_STEP_MS)`” should be written as a deadline calculation.**
    78	
    79	The existing loop performs one command, commits its new state, and only then reruns the effect (`apps/web/src/game/useGame.ts:285`). With one accepted request per state, steps do not overlap: if AI still acts, the next render starts the next search; otherwise the loop stops.
    80	
    81	**Fix:** Define `notBefore = startedAt + AI_STEP_MS`, then after the result arrives schedule for `Math.max(0, notBefore - performance.now())`. A cached result therefore waits 600 ms; a 750 ms search applies immediately after 750 ms of visible thinking. Avoid wording that could be implemented as an additional `max(elapsed, 600)` delay.
    82	
    83	**Keeping `defs` in each request is defensible; stripping them now would be over-built.**
    84	
    85	`PlayerView` intentionally carries definitions (`packages/engine/src/view.ts:6`), the UI needs them for names and ability prompts (`apps/web/src/game/useGame.ts:19`, `apps/web/src/game/commands.ts:73`), and all ability data is explicitly structured-cloneable (`packages/engine/src/abilities.ts:5`). The search already clones a state containing the same definitions once per determinisation (`packages/engine/src/determinise.ts:49`), so one extra request transfer of an 18-card catalogue is not the dominant cost.
    86	
    87	This adequately answers the prior D1 MEDIUM: the actual missing protocol and repeated decks are fixed, while the definitions optimization is consciously deferred.
    88	
    89	**Fix:** Keep the current `PlayerView` shape, but replace “measured as negligible” with the actual serialized size and main-thread posting duration from D2-A2. Revisit `Omit<PlayerView, 'defs'>` plus worker rehydration only when the card catalogue materially grows.
    90	
    91	## WHAT I WOULD DO DIFFERENTLY
    92	
    93	**Put a small testable coordinator between React and the worker instead of wiring message handlers directly into `useEffect`.**
    94	
    95	The hook currently combines state ownership, pacing, mutation, and the synchronous agent loop (`apps/web/src/game/useGame.ts:242`). D2 adds lifecycle, retries, watchdogs, fallback, and stale-result handling; keeping all of that in the effect will make the races hard to test.
    96	
    97	**Fix:** Use three layers:
    98	
    99	1. `protocol.ts` — discriminated messages and pure `respond`.
   100	2. `worker.ts` — init storage, try/catch, and `postMessage` only.
   101	3. `SearchCoordinator` — one worker per mounted hook, generation/request tracking, stable per-position seeds, pacing deadline, watchdog, termination, and Greedy fallback.
   102	
   103	Have `useGame` capture a state, ask the coordinator for a command, then perform the existing legality check and narration against that exact state. This preserves the D1 search core and makes every D2-specific race testable without React timing folklore.

 succeeded in 0ms:
     1	import { describeFailure, respond, type WorkerInit, type WorkerRequestMessage, type WorkerResponseMessage } from './protocol.js'
     2	
     3	/**
     4	 * The worker shell (spec D2 layer 2). Vitest cannot drive a real `Worker`, so there is deliberately nothing
     5	 * here worth testing: every decision lives in `respond` (pure) or `SearchCoordinator` (injectable transport).
     6	 *
     7	 * `self` is typed by hand rather than via `/// <reference lib="webworker" />`, because this file compiles in
     8	 * the same program as the DOM app and the two libs redeclare each other.
     9	 */
    10	const ctx = self as unknown as {
    11	  postMessage(message: WorkerResponseMessage): void
    12	  onmessage: ((event: MessageEvent<WorkerRequestMessage>) => void) | null
    13	}
    14	
    15	let init: WorkerInit | null = null
    16	
    17	const send = (message: WorkerResponseMessage): void => {
    18	  try {
    19	    ctx.postMessage(message)
    20	  } catch (e) {
    21	    // The only way this fires is a result that will not clone. Report it, so the coordinator falls back
    22	    // instead of waiting out its watchdog on a search that actually succeeded.
    23	    ctx.postMessage({ type: 'error', requestId: message.type === 'result' ? message.requestId : null, message: describeFailure(e) })
    24	  }
    25	}
    26	
    27	ctx.onmessage = (event: MessageEvent<WorkerRequestMessage>): void => {
    28	  const message = event.data
    29	  try {
    30	    if (message.type === 'init') {
    31	      init = message
    32	      return
    33	    }
    34	    if (!init) {
    35	      send({ type: 'error', requestId: message.requestId, message: 'search worker received a request before init' })
    36	      return
    37	    }
    38	    send(respond(init, message))
    39	  } catch (e) {
    40	    send({ type: 'error', requestId: message.type === 'search' ? message.requestId : null, message: describeFailure(e) })
    41	  }
    42	}

exec
/bin/zsh -lc "nl -ba apps/web/src/game/search/coordinator.ts | sed -n '1,220p'" in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
     1	import {
     2	  DEFAULT_EXPLORATION_C, DEFAULT_ITERATIONS, DEFAULT_ROLLOUT_COMMAND_CAP, GreedyAgent, type Agent,
     3	} from '@fftcg/ai'
     4	import { actingPlayer, legalCommands, viewFor, type Command, type GameState } from '@fftcg/engine'
     5	import { AI } from '../types.js'
     6	import {
     7	  describeFailure,
     8	  type WorkerRequestMessage, type WorkerResponseMessage,
     9	} from './protocol.js'
    10	
    11	/**
    12	 * The layer between React and the worker (spec D2 layer 3). Every race in the rung lives here — stale replies,
    13	 * seed allocation, the pacing deadline, worker death and the `GreedyAgent` fallback — precisely so each one is
    14	 * a unit test rather than a matter of React timing folklore.
    15	 *
    16	 * `useGame` keeps its existing shape: capture a state, ask for a command, re-check legality against that exact
    17	 * state, narrate, commit.
    18	 */
    19	
    20	// ---------------------------------------------------------------------------
    21	// Seams (so the tests need no real Worker and no real clock)
    22	// ---------------------------------------------------------------------------
    23	
    24	export interface SearchTransport {
    25	  post(message: WorkerRequestMessage): void
    26	  terminate(): void
    27	}
    28	
    29	export interface TransportHandlers {
    30	  message(message: WorkerResponseMessage): void
    31	  /** An uncorrelated failure — `error`, `messageerror`. There is no `requestId` to attach to either. */
    32	  failure(text: string): void
    33	}
    34	
    35	export type SearchTransportFactory = (handlers: TransportHandlers) => SearchTransport
    36	
    37	export interface Clock {
    38	  now(): number
    39	  /** Schedules `fn` and returns its canceller — a closure rather than a handle, so no timer type leaks out. */
    40	  after(ms: number, fn: () => void): () => void
    41	}
    42	
    43	export const realClock: Clock = {
    44	  now: () => performance.now(),
    45	  after: (ms, fn) => {
    46	    const timer = setTimeout(fn, ms)
    47	    return () => clearTimeout(timer)
    48	  },
    49	}
    50	
    51	/**
    52	 * Vite's supported static form — the URL must be a literal or the worker chunk is not emitted at all. Every
    53	 * listener is installed BEFORE the coordinator posts anything, so a module-load failure cannot arrive
    54	 * unobserved while the first request is already in flight.
    55	 */
    56	export const workerTransport: SearchTransportFactory = (handlers) => {
    57	  if (typeof Worker === 'undefined') throw new Error('this browser does not support Web Workers')
    58	  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    59	  worker.addEventListener('message', (e: MessageEvent<WorkerResponseMessage>) => handlers.message(e.data))
    60	  worker.addEventListener('error', (e) => handlers.failure(e.message || 'the search worker failed to load'))
    61	  worker.addEventListener('messageerror', () => handlers.failure('the search worker sent a message that could not be read'))
    62	  return { post: (m) => worker.postMessage(m), terminate: () => worker.terminate() }
    63	}
    64	
    65	// ---------------------------------------------------------------------------
    66	// Seeds (spec D2-3)
    67	// ---------------------------------------------------------------------------
    68	
    69	/**
    70	 * The search seed for the n-th COMMITTED AI decision of a game. Derived from the position rather than the
    71	 * request, so StrictMode's double-invoke, a retry, a superseded request and a replaced worker all re-ask the
    72	 * same question and get the same answer. A seed advanced when a request is *posted* makes development and
    73	 * production choose different moves from the same board — which reads as a search bug and is not one.
    74	 *
    75	 * The avalanche is there so consecutive decisions do not start near-identical streams; `searchIsmcts` splits
    76	 * this one number into its three streams itself (spec D-8).
    77	 */
    78	export function searchSeed(gameSeed: number, decisionIndex: number): number {
    79	  let h = (gameSeed ^ Math.imul(decisionIndex + 1, 0x9e3779b1)) >>> 0
    80	  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0
    81	  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0
    82	  return (h ^ (h >>> 16)) >>> 0
    83	}
    84	
    85	// ---------------------------------------------------------------------------
    86	// Coordinator
    87	// ---------------------------------------------------------------------------
    88	
    89	export interface SearchRequestHandlers {
    90	  /**
    91	   * The chosen command, with the exact state it was chosen for. **Return `true` only if it was committed** —
    92	   * the per-position seed advances on that and nothing else (D2-3), so a rejected or dropped command must
    93	   * report `false` or the next search of the same position asks a different question.
    94	   */
    95	  onCommand(command: Command, forState: GameState): boolean
    96	  /** At most one per game (D2-6): the worker is gone and Greedy has taken over for good. */
    97	  onWarning(text: string): void
    98	}
    99	
   100	export interface SearchCoordinatorOptions {
   101	  readonly decks: readonly [readonly string[], readonly string[]]
   102	  /** The game's own seed. With the committed-decision index this is the whole of a search seed (D2-3). */
   103	  readonly gameSeed: number
   104	  /** `stateRef.current`. The fourth acceptance condition is identity against this, so it must be the live ref. */
   105	  readonly readState: () => GameState
   106	  /** The pacing DEADLINE from the moment a request is posted — `AI_STEP_MS`, never an added delay (D2-5). */
   107	  readonly stepMs: number
   108	  readonly iterations?: number | undefined
   109	  readonly rolloutCommandCap?: number | undefined
   110	  readonly explorationC?: number | undefined
   111	  /** Longer than a normal reply: a fresh worker also has to fetch and evaluate its module chunk. */
   112	  readonly startupWatchdogMs?: number | undefined
   113	  readonly watchdogMs?: number | undefined
   114	  readonly createTransport?: SearchTransportFactory | undefined
   115	  readonly clock?: Clock | undefined
   116	}
   117	
   118	export const DEFAULT_STARTUP_WATCHDOG_MS = 10_000
   119	export const DEFAULT_WATCHDOG_MS = 5_000
   120	
   121	export const FALLBACK_WARNING =
   122	  'The background search stopped working, so the AI is playing its faster, weaker opponent for the rest of this game'
   123	
   124	/** One request's claim on the caller: which state it was asked for, and when its answer may be shown. */
   125	interface Target {
   126	  readonly state: GameState
   127	  readonly handlers: SearchRequestHandlers
   128	  /** `startedAt + stepMs`. A fast search still waits this out; a slow one applies the moment it lands (D2-5). */
   129	  readonly notBefore: number
   130	}
   131	
   132	interface Outstanding extends Target {
   133	  readonly requestId: number
   134	  readonly cancelWatchdog: () => void
   135	}
   136	
   137	export class SearchCoordinator {
   138	  private readonly opts: SearchCoordinatorOptions
   139	  private readonly clock: Clock
   140	  private readonly createTransport: SearchTransportFactory
   141	
   142	  private transport: SearchTransport | null = null
   143	  private initialised = false
   144	  private disposed = false
   145	  /** Permanent for this game (D2-6): a worker that failed once is not retried mid-game. */
   146	  private fallback = false
   147	  private warned = false
   148	  private failureReason = ''
   149	
   150	  private nextRequestId = 0
   151	  /** Advances ONLY on a committed AI command. Never on a post, a retry or a worker replacement. */
   152	  private decisionIndex = 0
   153	
   154	  private active: Outstanding | null = null
   155	  private delivery: { readonly cancel: () => void; readonly target: Target } | null = null
   156	  private greedy: Agent | null = null
   157	
   158	  constructor(opts: SearchCoordinatorOptions) {
   159	    this.opts = opts
   160	    this.clock = opts.clock ?? realClock
   161	    this.createTransport = opts.createTransport ?? workerTransport
   162	  }
   163	
   164	  /** True once the worker has been given up on — the caller can say so in its status line. */
   165	  get usingFallback(): boolean {
   166	    return this.fallback
   167	  }
   168	
   169	  /** The seed the NEXT request for the current position will carry. Exposed so the races can be asserted. */
   170	  get nextSeed(): number {
   171	    return searchSeed(this.opts.gameSeed, this.decisionIndex)
   172	  }
   173	
   174	  /**
   175	   * Ask for the AI's command in `state`. Supersedes anything outstanding: the reply to the old request is
   176	   * dropped by id, not waited for.
   177	   */
   178	  request(state: GameState, handlers: SearchRequestHandlers): void {
   179	    if (this.disposed) return
   180	    this.invalidate()
   181	    this.emitWarning(handlers)
   182	
   183	    const notBefore = this.clock.now() + this.opts.stepMs
   184	    if (this.fallback) {
   185	      this.scheduleGreedy({ state, handlers, notBefore })
   186	      return
   187	    }
   188	
   189	    let transport = this.transport
   190	    const starting = transport === null
   191	    if (!transport) {
   192	      try {
   193	        transport = this.createTransport({
   194	          message: (m) => this.onMessage(m),
   195	          failure: (text) => this.onFailure(text),
   196	        })
   197	      } catch (e) {
   198	        // Missing `Worker`, or a constructor that threw. Nothing was posted, so nothing is outstanding.
   199	        this.fail(describeFailure(e), { state, handlers, notBefore })
   200	        return
   201	      }
   202	      this.transport = transport
   203	    }
   204	
   205	    const requestId = ++this.nextRequestId
   206	    try {
   207	      if (!this.initialised) {
   208	        transport.post({
   209	          type: 'init',
   210	          decks: this.opts.decks,
   211	          rolloutCommandCap: this.opts.rolloutCommandCap ?? DEFAULT_ROLLOUT_COMMAND_CAP,
   212	          explorationC: this.opts.explorationC ?? DEFAULT_EXPLORATION_C,
   213	        })
   214	        this.initialised = true
   215	      }
   216	      transport.post({
   217	        type: 'search',
   218	        requestId,
   219	        view: viewFor(state, AI),
   220	        seed: this.nextSeed,

exec
/bin/zsh -lc "nl -ba apps/web/src/game/search/coordinator.ts | sed -n '221,420p'" in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
   221	        iterations: this.opts.iterations ?? DEFAULT_ITERATIONS,
   222	      })
   223	    } catch (e) {
   224	      // `postMessage` throws synchronously when the payload will not structured-clone.
   225	      this.fail(describeFailure(e), { state, handlers, notBefore })
   226	      return
   227	    }
   228	    // A transport whose failure handler fired synchronously inside `post` has already been given up on; arming
   229	    // a watchdog for it would raise a second failure against a request nobody is waiting for.
   230	    if (this.fallback) return
   231	
   232	    // A worker that is killed or simply hangs produces no correlated event at all, so the only way to notice
   233	    // it is a deadline (D2-6).
   234	    const timeout = starting
   235	      ? this.opts.startupWatchdogMs ?? DEFAULT_STARTUP_WATCHDOG_MS
   236	      : this.opts.watchdogMs ?? DEFAULT_WATCHDOG_MS
   237	    const cancelWatchdog = this.clock.after(timeout, () => {
   238	      const outstanding = this.active
   239	      if (!outstanding || outstanding.requestId !== requestId) return
   240	      this.fail('the search worker did not respond', outstanding)
   241	    })
   242	    this.active = { requestId, state, handlers, notBefore, cancelWatchdog }
   243	  }
   244	
   245	  /**
   246	   * Synchronously drop whatever is outstanding. Called on every restart, every external commit (including a
   247	   * human `choose()` — **concede is legal even when the human is not the acting player**, so it really can
   248	   * commit mid-AI-turn) and on effect cleanup.
   249	   */
   250	  invalidate(): void {
   251	    if (this.active) {
   252	      this.active.cancelWatchdog()
   253	      this.active = null
   254	    }
   255	    if (this.delivery) {
   256	      this.delivery.cancel()
   257	      this.delivery = null
   258	    }
   259	  }
   260	
   261	  /** Unmount: invalidate, then terminate. A worker outliving its hook is a leak and a source of stale replies. */
   262	  dispose(): void {
   263	    this.invalidate()
   264	    this.disposed = true
   265	    this.killTransport()
   266	  }
   267	
   268	  // -------------------------------------------------------------------------
   269	
   270	  private onMessage(message: WorkerResponseMessage): void {
   271	    if (this.disposed) return
   272	    if (message.type === 'error') {
   273	      const outstanding = this.active
   274	      // A typed error means the search itself threw, so the worker is no more use for this game whether or
   275	      // not the error correlates with what is currently outstanding.
   276	      this.fail(message.message, outstanding && (message.requestId === null || message.requestId === outstanding.requestId) ? outstanding : null)
   277	      return
   278	    }
   279	    const outstanding = this.active
   280	    // The four-condition acceptance rule (D2-4). `readState()` identity is the one that catches a reply that
   281	    // raced a commit the coordinator was never told about.
   282	    if (!outstanding) return
   283	    if (outstanding.requestId !== message.requestId) return
   284	    // A reply that raced a commit the coordinator was never told about is correctly DROPPED — but dropping it
   285	    // must also release the request, or the watchdog later fires on a worker that answered perfectly well and
   286	    // condemns the rest of the game to Greedy with a warning that says the search "stopped working".
   287	    if (this.opts.readState() !== outstanding.state || actingPlayer(outstanding.state) !== AI) {
   288	      outstanding.cancelWatchdog()
   289	      this.active = null
   290	      return
   291	    }
   292	
   293	    // Clear the active id BEFORE applying, so anything the commit re-enters cannot see this request as live.
   294	    outstanding.cancelWatchdog()
   295	    this.active = null
   296	    const command = message.result.command
   297	    this.schedule(outstanding, () => command)
   298	  }
   299	
   300	  /** `error` / `messageerror` from the transport: uncorrelated by nature, so it is attributed to what is live. */
   301	  private onFailure(text: string): void {
   302	    if (this.disposed) return
   303	    this.fail(text, this.active)
   304	  }
   305	
   306	  /**
   307	   * The single funnel for every way the worker can fail (D2-6): invalidate, terminate, switch to Greedy for
   308	   * the rest of the game, warn ONCE, and still produce a command under the same pacing deadline.
   309	   */
   310	  private fail(text: string, target: Target | null): void {
   311	    // A SECOND failure while a fallback move is already scheduled must not touch it. `invalidate()` would
   312	    // cancel the very Greedy command the first failure queued, and nothing would ever reschedule it.
   313	    if (this.fallback && this.delivery) return
   314	
   315	    // Capture the recovery target BEFORE `invalidate()`, which clears `active` AND cancels any pending
   316	    // delivery — the two places a live turn can be hiding when the error does not correlate with what is
   317	    // outstanding. Returning early instead left the AI stalled forever with the spinner up and nothing in the
   318	    // log: the silent degradation D2-6 exists to forbid, inverted into a silent hang.
   319	    const recover = target ?? this.active ?? this.delivery?.target ?? null
   320	    this.invalidate()
   321	    if (!this.fallback) this.failureReason = text
   322	    this.fallback = true
   323	    this.killTransport()
   324	    if (!recover) return   // genuinely nothing in flight: no turn to rescue, and no handlers to warn through
   325	    this.emitWarning(recover.handlers)
   326	    this.scheduleGreedy(recover)
   327	  }
   328	
   329	  private killTransport(): void {
   330	    if (!this.transport) return
   331	    this.transport.terminate()
   332	    this.transport = null
   333	    this.initialised = false
   334	  }
   335	
   336	  private emitWarning(handlers: SearchRequestHandlers): void {
   337	    if (!this.fallback || this.warned) return
   338	    this.warned = true
   339	    handlers.onWarning(`${FALLBACK_WARNING} (${this.failureReason})`)
   340	  }
   341	
   342	  private scheduleGreedy(target: Target): void {
   343	    this.schedule(target, () => {
   344	      const agent = (this.greedy ??= new GreedyAgent({
   345	        seed: this.opts.gameSeed,
   346	        decks: [[...this.opts.decks[0]], [...this.opts.decks[1]]],
   347	        depth: 1,
   348	      }))
   349	      const legal = agent.needsLegalCommands === false ? [] : legalCommands(target.state, AI)
   350	      return agent.decide(viewFor(target.state, AI), legal)
   351	    })
   352	  }
   353	
   354	  /** D2-5: the deadline is `startedAt + stepMs`, so a 750 ms search applies at once — never 750 + 600. */
   355	  private schedule(target: Target, produce: () => Command): void {
   356	    const cancel = this.clock.after(Math.max(0, target.notBefore - this.clock.now()), () => {
   357	      this.delivery = null
   358	      if (this.disposed) return
   359	      // Re-checked here and not only at acceptance: the wait is itself a window in which a concede can land.
   360	      if (this.opts.readState() !== target.state) return
   361	      if (actingPlayer(target.state) !== AI) return
   362	      // Advance BEFORE the handler runs, and roll back if it rejects: a handler that commits and re-requests
   363	      // synchronously would otherwise reuse this decision's seed for the next position (D2-3).
   364	      const at = this.decisionIndex
   365	      this.decisionIndex++
   366	      if (!target.handlers.onCommand(produce(), target.state)) this.decisionIndex = at
   367	    })
   368	    this.delivery = { cancel, target }
   369	  }
   370	}

exec
/bin/zsh -lc "nl -ba apps/web/src/game/useGame.ts | sed -n '1,220p'" in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
     1	import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
     2	import {
     3	  actingPlayer, apply, createGame, legalCommands, viewFor,
     4	  type AbilityTrigger, type CardId, type Command, type Event, type FieldFlag, type Frame, type GameState, type Keyword, type PlayerId, type PlayerView,
     5	} from '@fftcg/engine'
     6	import type { Agent } from '@fftcg/ai'
     7	import { CARD_DEFS, DECKS } from '../deck.js'
     8	import { buildChoiceSet, describeChoice, describeTriggerCause, preferredChoices, sameCommand, type TriggerCause } from './commands.js'
     9	import { SearchCoordinator, type SearchCoordinatorOptions, type SearchRequestHandlers } from './search/coordinator.js'
    10	import { AI, HUMAN, type Choice, type GameApi, type LogLine } from './types.js'
    11	
    12	/** Spec B7: the agent decides in ~0.27 ms, far too fast to watch — one move per this many ms instead. */
    13	export const AI_STEP_MS = 600
    14	
    15	const PHASE_LABEL: Record<string, string> = {
    16	  setup: 'Setup', active: 'Active Phase', draw: 'Draw Phase',
    17	  main1: 'Main Phase 1', attack: 'Attack Phase', main2: 'Main Phase 2', end: 'End Phase',
    18	}
    19	
    20	function name(v: PlayerView, id: number): string {
    21	  const inst = v.cards[id]
    22	  if (!inst) return `#${id}`
    23	  return v.defs[inst.code]?.name ?? inst.code
    24	}
    25	const who = (v: PlayerView, p: PlayerId): string => (p === v.me ? 'You' : 'The AI')
    26	const whoDoes = (v: PlayerView, p: PlayerId, mine: string, theirs: string): string => (p === v.me ? mine : theirs)
    27	
    28	const KEYWORD_LABEL: Record<Keyword, string> = { haste: 'Haste', brave: 'Brave', firstStrike: 'First Strike', backAttack: 'Back Attack' }
    29	const FLAG_LABEL: Record<FieldFlag, string> = { cannotBeBroken: 'cannot be broken this turn' }
    30	
    31	/**
    32	 * The printed wording of the clause that is resolving, quoted from the AST on `CardDef` (spec C1-1). Printed
    33	 * text is multi-line — a modal clause prints one line per mode — and a log line is one line, so runs of
    34	 * whitespace collapse. Nothing else about the wording is touched: reviewers check the AST against THIS.
    35	 */
    36	function abilityText(v: PlayerView, card: number, abilityId: string): string | null {
    37	  const code = v.cards[card]?.code
    38	  const def = code === undefined ? undefined : v.defs[code]
    39	  const text = def?.abilities?.find((a) => a.id === abilityId)?.text
    40	  return text === undefined ? null : text.replace(/\s+/g, ' ').trim()
    41	}
    42	
    43	/**
    44	 * One log line per engine event, named from the HUMAN's *post-apply* view — by the time an event is narrated the
    45	 * card it names has moved somewhere public (field, damage zone, break zone), so nothing here can name a card the
    46	 * human may not see. `null` drops events the move line above them already states (`cast`, `attackDeclared`, the
    47	 * CP that paid for them), keeping the log a narrative rather than a trace.
    48	 *
    49	 * `cause` is what fired an `abilityTriggered` (spec C2-5) — `eventLines` supplies it; it is ignored everywhere
    50	 * else. Callers narrating a single event out of context can leave it off.
    51	 */
    52	export function describeEvent(v: PlayerView, e: Event, cause: TriggerCause | null = null): LogLine | null {
    53	  switch (e.type) {
    54	    case 'firstPlayerChosen': return { kind: 'phase', text: `${who(v, e.player)} take${e.player === v.me ? '' : 's'} the first turn` }
    55	    case 'mulligan': return { kind: 'event', text: `${who(v, e.player)} ${whoDoes(v, e.player, e.redraw ? 'mulligan' : 'keep your hand', e.redraw ? 'mulligans' : 'keeps its hand')}` }
    56	    case 'turnStarted': return { kind: 'phase', text: `Turn ${e.turn} — ${whoDoes(v, e.player, 'your turn', "the AI's turn")}` }
    57	    case 'phaseStarted': return { kind: 'phase', text: `${PHASE_LABEL[e.phase] ?? e.phase}${e.step ? ` — ${e.step}` : ''}` }
    58	    case 'drew': return { kind: 'event', text: `${who(v, e.player)} draw${e.player === v.me ? '' : 's'} ${e.count} card${e.count === 1 ? '' : 's'}` }
    59	    case 'discarded': return e.reason === 'cp' ? null : { kind: 'event', text: `${who(v, e.player)} discard${e.player === v.me ? '' : 's'} ${name(v, e.card)} to the hand limit` }
    60	    // B-A6 + C1-9: coverage is per CLAUSE. `clauses` counts the ones still missing on a card that DOES have an
    61	    // implemented clause; its absence means the whole text box is unimplemented and the card played as vanilla.
    62	    case 'unimplementedAbility': return e.clauses === undefined
    63	      ? { kind: 'warning', text: `${name(v, e.card)} (${e.code}) has abilities that are not implemented yet — played as vanilla` }
    64	      : { kind: 'warning', text: `${name(v, e.card)} (${e.code}) has ${e.clauses} more ability clause${e.clauses === 1 ? '' : 's'} that ${e.clauses === 1 ? 'is' : 'are'} not implemented yet` }
    65	    case 'exBurstSkipped': return { kind: 'warning', text: `EX Burst on ${name(v, e.card)} skipped (not implemented)` }
    66	    case 'battleDamage': return { kind: 'event', text: `${name(v, e.source)} deals ${e.amount} damage to ${name(v, e.target)}` }
    67	    case 'playerDamaged': return { kind: 'event', text: `${who(v, e.player)} take${e.player === v.me ? '' : 's'} 1 damage` }
    68	    case 'broken': return { kind: 'event', text: `${name(v, e.card)} is broken` }
    69	    case 'putIntoBreakZone': return { kind: 'event', text: `${name(v, e.card)} is put into the Break Zone (0 power)` }
    70	    // --- ability resolution (rung C1). The choice itself is already a move line — the human's from `choose`,
    71	    // the AI's from `stepAi` — so these narrate what triggered and what it DID, closing the loop between the
    72	    // printed text box and the board state the player is looking at.
    73	    // C2: an OBSERVER trigger fires because of something that happened to a DIFFERENT card, so the cause goes
    74	    // in front of the printed text. "Lightning's ability triggers — the AI's Prishe was broken" is the only
    75	    // thing tying the prompt that follows to the board; and for a clause with no prompt at all (Luso's "break
    76	    // it") the log is the ONLY evidence the trigger happened.
    77	    case 'abilityTriggered': {
    78	      const text = abilityText(v, e.card, e.abilityId)
    79	      const why = cause ? ` — ${describeTriggerCause(v, cause)}` : ''
    80	      return { kind: 'event', text: `${name(v, e.card)}'s ability triggers${why}${text ? `: "${text}"` : ''}` }
    81	    }
    82	    case 'abilityNoLegalTarget': return { kind: 'event', text: `${name(v, e.card)}'s ability finds no legal target — nothing happens` }
    83	    case 'dulled': return { kind: 'event', text: `${name(v, e.card)} is dulled` }
    84	    case 'abilityDamage': return { kind: 'event', text: `${name(v, e.source)} deals ${e.amount} damage to ${name(v, e.target)}` }
    85	    case 'powerModified': return { kind: 'event', text: `${name(v, e.card)} gets ${e.amount >= 0 ? '+' : ''}${e.amount} power until the end of the turn` }
    86	    case 'keywordGranted': return { kind: 'event', text: `${name(v, e.card)} gains ${KEYWORD_LABEL[e.keyword]} until the end of the turn` }
    87	    case 'flagGranted': return { kind: 'event', text: `${name(v, e.card)} ${FLAG_LABEL[e.flag]}` }
    88	    case 'returnedToHand': return { kind: 'event', text: `${name(v, e.card)} returns to ${whoDoes(v, e.player, 'your hand', "the AI's hand")}` }
    89	    case 'brokenByAbility': return { kind: 'event', text: `${name(v, e.card)} is broken by ${name(v, e.source)}` }
    90	    case 'breakPrevented': return { kind: 'event', text: `${name(v, e.card)} survives — it ${FLAG_LABEL[e.flag]}` }
    91	    case 'gameOver': return { kind: 'result', text: `Game over — ${e.result.winner === null ? 'a draw' : e.result.winner === v.me ? 'you win' : 'the AI wins'} (${e.result.reason})` }
    92	    // `cast`/`attackDeclared`/`blockDeclared`/`cpGenerated` restate the move line; `activated` and
    93	    // `summonResolvedNoEffect` are noise (the latter doubles up on `unimplementedAbility` for every summon in the pool).
    94	    default: return null
    95	  }
    96	}
    97	
    98	/** The clause an `abilityTriggered` names, from the AST on `CardDef` — its `trigger` says what fired it. */
    99	function triggerOf(v: PlayerView, card: CardId, abilityId: string): AbilityTrigger | null {
   100	  const code = v.cards[card]?.code
   101	  const def = code === undefined ? undefined : v.defs[code]
   102	  return def?.abilities?.find((a) => a.id === abilityId)?.trigger ?? null
   103	}
   104	
   105	/**
   106	 * §7.10 puts a broken card in its OWNER's Break Zone, which is where narration finds it once it has left the
   107	 * field. Owner and controller coincide for this pool — nothing in it changes control (rung C5) — so this is
   108	 * the controller the clause's `whose` is measured against.
   109	 */
   110	function holderOf(v: PlayerView, id: CardId): PlayerId {
   111	  for (const p of [0, 1] as const) if (v.fields[p].breakZone.includes(id)) return p
   112	  return v.cards[id]?.owner ?? v.me
   113	}
   114	
   115	interface Hit { readonly source: CardId; readonly target: CardId; readonly amount: number; used: boolean }
   116	interface PlayerHit { readonly victim: PlayerId; used: boolean }
   117	interface ZoneHit { readonly card: CardId; readonly controller: PlayerId; used: boolean }
   118	
   119	/**
   120	 * Pair one `abilityTriggered` with the event that fired it, consuming the candidate so the NEXT trigger of the
   121	 * same clause gets the next one (CR §11.8.6 / spec C2-A3: one Lightning watching two simultaneous breaks
   122	 * triggers twice, and the two lines must not both name the same Forward).
   123	 *
   124	 * `dealtDamage` is exact by construction: `enqueueDamageTriggers` hangs the clause off the DAMAGE SOURCE, so
   125	 * the watcher id IS the source to match on. `observesZoneChange` is matched on `whose` relative to the frame's
   126	 * own controller (`e.player`), never the turn player — spec C2-10, so the clause means the same from either
   127	 * seat. Anything unmatched returns null and the line simply loses its cause clause rather than gaining a
   128	 * wrong one.
   129	 */
   130	function causeOf(
   131	  v: PlayerView, e: Extract<Event, { type: 'abilityTriggered' }>,
   132	  hits: Hit[], playerHits: PlayerHit[], zoneHits: ZoneHit[],
   133	): TriggerCause | null {
   134	  const trigger = triggerOf(v, e.card, e.abilityId)
   135	  if (!trigger) return null
   136	  if (trigger.kind === 'dealtDamage') {
   137	    if (trigger.to === 'player') {
   138	      const hit = playerHits.find((h) => !h.used)
   139	      if (!hit) return null
   140	      hit.used = true
   141	      return { kind: 'damage', source: e.card, target: null, victim: hit.victim, amount: 1 }
   142	    }
   143	    const hit = hits.find((h) => !h.used && h.source === e.card)
   144	    if (!hit) return null
   145	    hit.used = true
   146	    return { kind: 'damage', source: hit.source, target: hit.target, victim: null, amount: hit.amount }
   147	  }
   148	  if (trigger.kind === 'observesZoneChange') {
   149	    const wants = (controller: PlayerId): boolean =>
   150	      trigger.whose === 'any' || (trigger.whose === 'self') === (controller === e.player)
   151	    const hit = zoneHits.find((h) => !h.used && wants(h.controller))
   152	    if (!hit) return null
   153	    hit.used = true
   154	    return { kind: 'zoneChange', card: hit.card, controller: hit.controller }
   155	  }
   156	  return null   // enterField/summonResolve are about the source itself — there is nothing to explain
   157	}
   158	
   159	/**
   160	 * Narrate one command's events, saying what each triggered clause was reacting to (spec C2-5).
   161	 *
   162	 * `queued` is the agenda queue as it stood BEFORE the command, and it is the exact answer wherever it reaches:
   163	 * those frames carry their own `triggerEvent`, `drainResolution` starts them FIFO, and starting a frame is what
   164	 * emits `abilityTriggered` — so the n-th trigger of the batch is `queued[n]`. That is what rescues a trigger
   165	 * whose cause happened in an EARLIER batch: a second Lightning occurrence sits in the queue across the prompt
   166	 * the first one raised, and by the time it starts, the break that fired it is long gone from the event stream.
   167	 *
   168	 * A frame both queued and drained inside THIS batch is in no queue anyone can see, so its cause is
   169	 * reconstructed from the events instead — `causeOf`. That is the common case (Luso's "break it" raises no
   170	 * prompt at all) and it is sound because the engine pushes a damage or break event before the trigger that
   171	 * event queues, transition-major (spec C2-11). Both routes are guarded: an unmatched trigger loses its cause
   172	 * clause rather than gaining a wrong one.
   173	 */
   174	export function eventLines(v: PlayerView, events: readonly Event[], queued: readonly Frame[] = []): LogLine[] {
   175	  const hits: Hit[] = []
   176	  const playerHits: PlayerHit[] = []
   177	  const zoneHits: ZoneHit[] = []
   178	  const lines: LogLine[] = []
   179	  let started = 0
   180	  for (const e of events) {
   181	    switch (e.type) {
   182	      // Combat and ability damage alike — the printed text says "deals damage" (spec C2-7).
   183	      case 'battleDamage':
   184	      case 'abilityDamage': hits.push({ source: e.source, target: e.target, amount: e.amount, used: false }); break
   185	      // `playerDamaged.card` is the card TAKEN as damage, not the dealer; the dealer is the watcher itself.
   186	      case 'playerDamaged': playerHits.push({ victim: e.player, used: false }); break
   187	      case 'broken':
   188	      case 'brokenByAbility':
   189	      case 'putIntoBreakZone': zoneHits.push({ card: e.card, controller: holderOf(v, e.card), used: false }); break
   190	      default: break
   191	    }
   192	    let cause: TriggerCause | null = null
   193	    if (e.type === 'abilityTriggered') {
   194	      const frame = queued[started++]
   195	      // The identity check is the guard on the FIFO assumption: mismatch means the queue is not what this
   196	      // trigger came from, so fall through to reconstruction rather than narrate another clause's subject.
   197	      cause = frame && frame.source === e.card && frame.abilityId === e.abilityId
   198	        ? frame.triggerEvent
   199	        : causeOf(v, e, hits, playerHits, zoneHits)
   200	    }
   201	    const line = describeEvent(v, e, cause)
   202	    if (line) lines.push(line)
   203	  }
   204	  return lines
   205	}
   206	
   207	/**
   208	 * The view a command's events are narrated from: the state AFTER it, plus the cards that were public BEFORE.
   209	 * An ability can move a card out of a public zone into a hidden one — Billy Bob returns a Forward from the
   210	 * Break Zone to its owner's HAND — and `#51 returns to the AI's hand` is a worse log line than naming a card
   211	 * whose identity the player could read off the table a moment ago. Nothing hidden before can enter this union,
   212	 * so B-A3 still holds: `before` is itself a human view.
   213	 */
   214	export const narrator = (before: PlayerView, after: PlayerView): PlayerView => ({ ...after, cards: { ...before.cards, ...after.cards } })
   215	
   216	/**
   217	 * Narrate and apply one already-chosen command. Split out of `stepAi` because the browser's opponent no longer
   218	 * comes from an `Agent` at all — it comes back from a worker (spec D2) — and both paths must produce the same
   219	 * log. The membership check is spec B-A4 held to both seats: `apply` is never reached by a command outside
   220	 * `legalCommands`.

exec
/bin/zsh -lc "nl -ba apps/web/src/game/useGame.ts | sed -n '221,430p'" in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
   221	 */
   222	function narrateApply(
   223	  state: GameState, actorView: PlayerView, legal: readonly Command[], command: Command,
   224	): { state: GameState; lines: LogLine[] } {
   225	  if (!legal.some((c) => sameCommand(c, command))) throw new Error(`agent chose an illegal command: ${command.type}`)
   226	  const before = viewFor(state, HUMAN)
   227	  const result = apply(state, command)
   228	  // Label the move from the actor's own view, so a card only it can see still reads sensibly; everything after
   229	  // is narrated from the human's view.
   230	  const lines = eventLines(narrator(before, viewFor(result.state, HUMAN)), result.events, state.resolution.queue)
   231	  return { state: result.state, lines: [{ kind: 'ai', text: describeChoice(actorView, command) }, ...lines] }
   232	}
   233	
   234	/**
   235	 * Apply exactly ONE command for whoever is currently acting, chosen by `agent`, and return the resulting state
   236	 * with the lines it produced. Pure and React-free so the whole driver is testable headlessly (spec B-A7).
   237	 */
   238	export function stepAi(state: GameState, agent: Agent): { state: GameState; lines: LogLine[] } {
   239	  const p = actingPlayer(state)
   240	  if (p === null) return { state, lines: [] }
   241	  const actorView = viewFor(state, p)
   242	  const legal = legalCommands(state, p)
   243	  return narrateApply(state, actorView, legal, agent.decide(actorView, legal))
   244	}
   245	
   246	// --- the browser's opponent: SO-ISMCTS in a worker (spec D2) -----------------------------------------------
   247	
   248	/** Everything the AI wiring needs from React. Named so the wiring below is drivable without a DOM. */
   249	export interface AiSink {
   250	  commit(state: GameState, lines: LogLine[]): void
   251	  log(line: LogLine): void
   252	}
   253	
   254	/**
   255	 * The hook's side of the coordinator contract. Every race — staleness, pacing, worker death, the fallback — is
   256	 * the coordinator's, so what is left here is only the shape the hook already had: re-check the command against
   257	 * the exact state it was chosen for, narrate it, commit it.
   258	 */
   259	export function aiHandlers(sink: AiSink): SearchRequestHandlers {
   260	  return {
   261	    onCommand: (command, forState) => {
   262	      const legal = legalCommands(forState, AI)
   263	      // `false` is load-bearing beyond skipping the commit: it is what stops the per-position seed advancing,
   264	      // so the next search of this same board asks the identical question (D2-3). Refuse rather than throw —
   265	      // this runs from a timer, where an uncaught throw would take the page down instead of the move.
   266	      if (!legal.some((c) => sameCommand(c, command))) {
   267	        sink.log({ kind: 'warning', text: `The AI chose ${command.type}, which is not legal in this position — the move was discarded` })
   268	        return false
   269	      }
   270	      const stepped = narrateApply(forState, viewFor(forState, AI), legal, command)
   271	      sink.commit(stepped.state, stepped.lines)
   272	      return true
   273	    },
   274	    // D2-6, and the reason the rung has a visible warning at all: an opponent quietly a tenth as strong is
   275	    // exactly the degradation that survives a rung unnoticed. The coordinator emits this at most once a game.
   276	    onWarning: (text) => { sink.log({ kind: 'warning', text }) },
   277	  }
   278	}
   279	
   280	/** Test seams. The hook passes none of them; the browser gets a real worker and a real clock. */
   281	export type SearchSeams = Pick<SearchCoordinatorOptions, 'createTransport' | 'clock' | 'iterations'>
   282	
   283	export interface AiSearch {
   284	  request(state: GameState, handlers: SearchRequestHandlers): void
   285	  /** Effect cleanup, and any commit the coordinator did not itself make. Synchronous, per D2-4. */
   286	  invalidate(): void
   287	  /** A new game under `seed`. */
   288	  restart(seed: number): void
   289	  dispose(): void
   290	}
   291	
   292	/**
   293	 * One `SearchCoordinator` per GAME. Throwing it away is how a restart resets the two things that are per-game
   294	 * facts and would otherwise leak across one: the committed-decision index the search seed is derived from
   295	 * (D2-3), and the permanently-Greedy latch a dead worker sets (D2-6).
   296	 *
   297	 * Built lazily, and rebuilt after `dispose`, because StrictMode's mount→unmount→mount tears the coordinator
   298	 * down without re-rendering — a one-shot construction in the render body would leave the second mount holding
   299	 * a terminated worker and no AI at all.
   300	 */
   301	export function createAiSearch(readState: () => GameState, seed: number, seams: SearchSeams = {}): AiSearch {
   302	  let gameSeed = seed
   303	  let coordinator: SearchCoordinator | null = null
   304	  const drop = (): void => { coordinator?.dispose(); coordinator = null }
   305	  const live = (): SearchCoordinator => (coordinator ??= new SearchCoordinator({
   306	    decks: DECKS, gameSeed, readState, stepMs: AI_STEP_MS, ...seams,
   307	  }))
   308	  return {
   309	    request: (state, handlers) => { live().request(state, handlers) },
   310	    invalidate: () => { coordinator?.invalidate() },
   311	    restart: (next) => { gameSeed = next; drop() },
   312	    dispose: drop,
   313	  }
   314	}
   315	
   316	const newGame = (seed: number): GameState => createGame({ seed, decks: DECKS, defs: CARD_DEFS })
   317	
   318	const openingLog = (): LogLine[] => [{ kind: 'phase', text: 'New game — you are P0, the AI is P1' }]
   319	
   320	export function useGame(seed?: number): GameApi {
   321	  const seedRef = useRef<number>(seed ?? Date.now() % 2_147_483_647)
   322	  // Spec B3: the ground truth lives here and only `viewFor(state, HUMAN)` ever leaves the hook. `stateRef` is
   323	  // the authority `choose` reads, so two clicks inside one render can't both apply to the same stale state.
   324	  const [state, setState] = useState<GameState>(() => newGame(seedRef.current))
   325	  const stateRef = useRef<GameState>(state)
   326	  const searchRef = useRef<AiSearch | null>(null)
   327	  // Lazy for the same reason the game itself is: `useRef(createAiSearch(...))` would build one every render.
   328	  searchRef.current ??= createAiSearch(() => stateRef.current, seedRef.current)
   329	  const [log, setLog] = useState<LogLine[]>(openingLog)
   330	  const [aiThinking, setAiThinking] = useState(false)
   331	
   332	  const commit = useCallback((next: GameState, lines: LogLine[]) => {
   333	    stateRef.current = next
   334	    setState(next)
   335	    if (lines.length) setLog((prev) => [...prev, ...lines])
   336	  }, [])
   337	
   338	  const appendLog = useCallback((line: LogLine) => { setLog((prev) => [...prev, line]) }, [])
   339	  const handlers = useMemo(() => aiHandlers({ commit, log: appendLog }), [commit, appendLog])
   340	
   341	  const view = useMemo(() => viewFor(state, HUMAN), [state])
   342	  const choices = useMemo(() => buildChoiceSet(view, preferredChoices(view, legalCommands(state, HUMAN))), [state, view])
   343	
   344	  const choose = useCallback((choice: Choice): void => {
   345	    const current = stateRef.current
   346	    // D2-4: an external commit synchronously drops whatever the AI has outstanding. `concede` is legal even
   347	    // when the human is NOT the acting player, so a click really can land in the middle of the AI's search.
   348	    searchRef.current?.invalidate()
   349	    // Spec B-A4: prove the command is still legal before touching `apply`, so an illegal click is impossible
   350	    // rather than merely rejected by the engine after the fact.
   351	    const legal = legalCommands(current, HUMAN)
   352	    if (!legal.some((c) => sameCommand(c, choice.command))) throw new Error(`illegal command: ${choice.label}`)
   353	    const before = viewFor(current, HUMAN)
   354	    const result = apply(current, choice.command)
   355	    const lines = eventLines(narrator(before, viewFor(result.state, HUMAN)), result.events, current.resolution.queue)
   356	    commit(result.state, [{ kind: 'human', text: describeChoice(before, choice.command) }, ...lines])
   357	  }, [commit])
   358	
   359	  const restart = useCallback((): void => {
   360	    // A fresh but reproducible seed: `useGame(seed)` stays deterministic across restarts, which tests rely on.
   361	    const next = ++seedRef.current
   362	    const game = newGame(next)
   363	    stateRef.current = game
   364	    // D2-3: a new coordinator, so the committed-decision index the search seed is derived from restarts at 0.
   365	    searchRef.current?.restart(next)
   366	    setState(game)
   367	    setLog(openingLog())
   368	    setAiThinking(false)
   369	  }, [])
   370	
   371	  // Spec B7 + D2: one AI move per decision, searched off the main thread. Re-running on every `state` change is
   372	  // what makes it a loop, and one accepted request per state is what stops two AI moves overlapping. The
   373	  // cleanup invalidates synchronously, so StrictMode's mount→unmount→mount double-invoke discards the first
   374	  // request rather than stepping the AI twice.
   375	  useEffect(() => {
   376	    if (state.result || actingPlayer(state) !== AI) { setAiThinking(false); return }
   377	    setAiThinking(true)
   378	    const search = searchRef.current as AiSearch
   379	    search.request(state, handlers)
   380	    return () => { search.invalidate() }
   381	  }, [state, handlers])
   382	
   383	  // Unmount only. A worker outliving its hook is both a leak and a source of replies for a game nobody is
   384	  // looking at any more (D2-4).
   385	  useEffect(() => () => { searchRef.current?.dispose() }, [])
   386	
   387	  return { view, choices, log, aiThinking, choose, restart }
   388	}

exec
/bin/zsh -lc "nl -ba apps/web/test/search-coordinator.test.ts | sed -n '1,220p'" in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
     1	import { describe, expect, it } from 'vitest'
     2	import { apply, createGame, legalCommands, viewFor, type Command, type GameState, type PlayerId } from '@fftcg/engine'
     3	import { GreedyAgent, type SearchDiagnostics, type SearchResult } from '@fftcg/ai'
     4	import { CARD_DEFS, DECKS } from '../src/deck.js'
     5	import { AI, HUMAN } from '../src/game/types.js'
     6	import type { WorkerRequestMessage, WorkerResponseMessage, WorkerSearchRequest } from '../src/game/search/protocol.js'
     7	import {
     8	  FALLBACK_WARNING, SearchCoordinator, searchSeed, workerTransport,
     9	  type Clock, type SearchRequestHandlers, type SearchTransport, type SearchTransportFactory, type TransportHandlers,
    10	} from '../src/game/search/coordinator.js'
    11	
    12	const GAME_SEED = 4242
    13	const STEP_MS = 600
    14	const WATCHDOG_MS = 5_000
    15	const STARTUP_WATCHDOG_MS = 10_000
    16	
    17	// ---------------------------------------------------------------------------
    18	// Fixtures
    19	// ---------------------------------------------------------------------------
    20	
    21	const actorOf = (state: GameState): PlayerId | null => (state.result ? null : (state.pending?.player ?? state.priority))
    22	
    23	/** Fast-forward a real game to a position the AI actually owns — the only kind the coordinator may be asked for. */
    24	function aiToAct(seed: number): GameState {
    25	  let state: GameState = createGame({ seed, decks: DECKS, defs: CARD_DEFS })
    26	  const agent = new GreedyAgent({ seed, decks: DECKS, depth: 1 })
    27	  for (let i = 0; i < 400; i++) {
    28	    const p = actorOf(state)
    29	    if (p === null) break
    30	    if (p === AI) return state
    31	    state = apply(state, agent.decide(viewFor(state, p), legalCommands(state, p))).state
    32	  }
    33	  throw new Error(`seed ${seed} never reached an AI decision`)
    34	}
    35	
    36	function humanToAct(seed: number): GameState {
    37	  let state: GameState = createGame({ seed, decks: DECKS, defs: CARD_DEFS })
    38	  const agent = new GreedyAgent({ seed, decks: DECKS, depth: 1 })
    39	  for (let i = 0; i < 400; i++) {
    40	    const p = actorOf(state)
    41	    if (p === null) break
    42	    if (p === HUMAN) return state
    43	    state = apply(state, agent.decide(viewFor(state, p), legalCommands(state, p))).state
    44	  }
    45	  throw new Error(`seed ${seed} never reached a human decision`)
    46	}
    47	
    48	const EMPTY_DIAGNOSTICS: SearchDiagnostics = {
    49	  determinisations: 1, treeApplies: 1, rolloutApplies: 1, evaluations: 1, nodes: 1, maxCommandDepth: 1, rootChildren: [],
    50	}
    51	
    52	/** A worker reply for `state`, carrying a command that really is legal there so nothing downstream is faked. */
    53	function resultFor(state: GameState, requestId: number): WorkerResponseMessage {
    54	  const command = legalCommands(state, AI)[0]
    55	  if (!command) throw new Error('no legal AI command')
    56	  const result: SearchResult = { command, diagnostics: EMPTY_DIAGNOSTICS }
    57	  return { type: 'result', requestId, result }
    58	}
    59	
    60	class FakeClock implements Clock {
    61	  private t = 0
    62	  private seq = 0
    63	  private readonly timers = new Map<number, { at: number; fn: () => void }>()
    64	
    65	  now(): number { return this.t }
    66	
    67	  after(ms: number, fn: () => void): () => void {
    68	    const id = ++this.seq
    69	    this.timers.set(id, { at: this.t + ms, fn })
    70	    return () => { this.timers.delete(id) }
    71	  }
    72	
    73	  get armed(): number { return this.timers.size }
    74	
    75	  advance(ms: number): void {
    76	    const target = this.t + ms
    77	    for (;;) {
    78	      let pickId = -1
    79	      let pickAt = Number.POSITIVE_INFINITY
    80	      for (const [id, timer] of this.timers) {
    81	        if (timer.at <= target && (timer.at < pickAt || (timer.at === pickAt && id < pickId))) { pickAt = timer.at; pickId = id }
    82	      }
    83	      const timer = pickId < 0 ? undefined : this.timers.get(pickId)
    84	      if (!timer) break
    85	      this.timers.delete(pickId)
    86	      this.t = timer.at
    87	      timer.fn()
    88	    }
    89	    this.t = target
    90	  }
    91	}
    92	
    93	class FakeTransport implements SearchTransport {
    94	  readonly sent: WorkerRequestMessage[] = []
    95	  terminations = 0
    96	  postThrows: string | null = null
    97	  constructor(readonly handlers: TransportHandlers) {}
    98	
    99	  post(message: WorkerRequestMessage): void {
   100	    if (this.postThrows !== null) throw new DOMException(this.postThrows, 'DataCloneError')
   101	    this.sent.push(message)
   102	  }
   103	
   104	  terminate(): void { this.terminations++ }
   105	
   106	  get searches(): WorkerSearchRequest[] {
   107	    return this.sent.filter((m): m is WorkerSearchRequest => m.type === 'search')
   108	  }
   109	}
   110	
   111	interface Harness {
   112	  readonly clock: FakeClock
   113	  readonly coordinator: SearchCoordinator
   114	  readonly transports: FakeTransport[]
   115	  readonly delivered: { command: Command; state: GameState }[]
   116	  readonly warnings: string[]
   117	  readonly handlers: SearchRequestHandlers
   118	  readonly transport: () => FakeTransport
   119	  readState(): GameState
   120	  setState(state: GameState): void
   121	  setCommit(v: boolean): void
   122	}
   123	
   124	function harness(opts: { seed?: number; factory?: SearchTransportFactory; onCreate?: (t: FakeTransport) => void } = {}): Harness {
   125	  const clock = new FakeClock()
   126	  const transports: FakeTransport[] = []
   127	  const delivered: { command: Command; state: GameState }[] = []
   128	  const warnings: string[] = []
   129	  let current = aiToAct(opts.seed ?? 11)
   130	  let commits = true
   131	
   132	  const handlers: SearchRequestHandlers = {
   133	    onCommand: (command, forState) => { delivered.push({ command, state: forState }); return commits },
   134	    onWarning: (text) => { warnings.push(text) },
   135	  }
   136	  const factory: SearchTransportFactory = opts.factory ?? ((h) => {
   137	    const t = new FakeTransport(h)
   138	    transports.push(t)
   139	    opts.onCreate?.(t)
   140	    return t
   141	  })
   142	  const coordinator = new SearchCoordinator({
   143	    decks: DECKS,
   144	    gameSeed: GAME_SEED,
   145	    readState: () => current,
   146	    stepMs: STEP_MS,
   147	    iterations: 25,
   148	    rolloutCommandCap: 8,
   149	    explorationC: 1,
   150	    watchdogMs: WATCHDOG_MS,
   151	    startupWatchdogMs: STARTUP_WATCHDOG_MS,
   152	    createTransport: factory,
   153	    clock,
   154	  })
   155	  return {
   156	    clock, coordinator, transports, delivered, warnings, handlers,
   157	    transport: () => { const t = transports[0]; if (!t) throw new Error('no transport was created'); return t },
   158	    readState: () => current,
   159	    setState: (s) => { current = s },
   160	    setCommit: (v) => { commits = v },
   161	  }
   162	}
   163	
   164	/** The whole point of the fallback: whatever went wrong, a command still arrives on the same deadline. */
   165	function expectOneWarningAndACommand(h: Harness): void {
   166	  expect(h.delivered).toHaveLength(0)
   167	  h.clock.advance(STEP_MS)
   168	  expect(h.delivered).toHaveLength(1)
   169	  expect(h.warnings).toHaveLength(1)
   170	  expect(h.warnings[0]).toContain(FALLBACK_WARNING)
   171	  expect(h.coordinator.usingFallback).toBe(true)
   172	  const only = h.delivered[0]
   173	  if (!only) throw new Error('unreachable')
   174	  expect(legalCommands(only.state, AI).some((c) => c.type === only.command.type)).toBe(true)
   175	}
   176	
   177	// ---------------------------------------------------------------------------
   178	
   179	describe('searchSeed (D2-3)', () => {
   180	  it('is a pure function of (gameSeed, decisionIndex)', () => {
   181	    expect(searchSeed(7, 3)).toBe(searchSeed(7, 3))
   182	    expect(searchSeed(7, 3)).not.toBe(searchSeed(7, 4))
   183	    expect(searchSeed(7, 3)).not.toBe(searchSeed(8, 3))
   184	  })
   185	
   186	  it('stays a non-negative 32-bit integer', () => {
   187	    for (const [seed, index] of [[0, 0], [-1, 5], [2_147_483_646, 199], [Date.now() % 2_147_483_647, 12]] as const) {
   188	      const s = searchSeed(seed, index)
   189	      expect(Number.isSafeInteger(s)).toBe(true)
   190	      expect(s).toBeGreaterThanOrEqual(0)
   191	      expect(s).toBeLessThanOrEqual(0xffff_ffff)
   192	    }
   193	  })
   194	})
   195	
   196	describe('SearchCoordinator: seeds are per POSITION (D2-3)', () => {
   197	  it('asks the same position twice with the same seed', () => {
   198	    const h = harness()
   199	    h.coordinator.request(h.readState(), h.handlers)
   200	    // StrictMode's cleanup+setup, a retry and a superseded request all look like this.
   201	    h.coordinator.invalidate()
   202	    h.coordinator.request(h.readState(), h.handlers)
   203	
   204	    const searches = h.transport().searches
   205	    expect(searches).toHaveLength(2)
   206	    expect(searches[0]?.seed).toBe(searches[1]?.seed)
   207	    expect(searches[0]?.seed).toBe(searchSeed(GAME_SEED, 0))
   208	    // The correlation ids must still differ, or a stale reply could not be told apart.
   209	    expect(searches[0]?.requestId).not.toBe(searches[1]?.requestId)
   210	  })
   211	
   212	  it('posts init exactly once, ahead of the first search', () => {
   213	    const h = harness()
   214	    h.coordinator.request(h.readState(), h.handlers)
   215	    h.coordinator.invalidate()
   216	    h.coordinator.request(h.readState(), h.handlers)
   217	    const t = h.transport()
   218	    expect(t.sent.filter((m) => m.type === 'init')).toHaveLength(1)
   219	    expect(t.sent[0]?.type).toBe('init')
   220	    const init = t.sent[0]

exec
/bin/zsh -lc "nl -ba apps/web/test/search-coordinator.test.ts | sed -n '221,440p'" in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
   221	    if (init?.type !== 'init') throw new Error('unreachable')
   222	    expect(init.rolloutCommandCap).toBe(8)
   223	    expect(init.explorationC).toBe(1)
   224	    expect(init.decks).toBe(DECKS)
   225	  })
   226	
   227	  it('advances the seed only when a command actually commits', () => {
   228	    const h = harness()
   229	    const first = h.readState()
   230	    h.coordinator.request(first, h.handlers)
   231	    const t = h.transport()
   232	
   233	    // A delivered-but-rejected command must NOT consume the position's seed.
   234	    h.setCommit(false)
   235	    t.handlers.message(resultFor(first, t.searches[0]?.requestId ?? 0))
   236	    h.clock.advance(STEP_MS)
   237	    expect(h.delivered).toHaveLength(1)
   238	
   239	    h.coordinator.request(first, h.handlers)
   240	    expect(t.searches[1]?.seed).toBe(searchSeed(GAME_SEED, 0))
   241	
   242	    // Now let it commit, and the next position is a different question.
   243	    h.setCommit(true)
   244	    t.handlers.message(resultFor(first, t.searches[1]?.requestId ?? 0))
   245	    h.clock.advance(STEP_MS)
   246	    expect(h.delivered).toHaveLength(2)
   247	
   248	    h.coordinator.request(first, h.handlers)
   249	    expect(t.searches[2]?.seed).toBe(searchSeed(GAME_SEED, 1))
   250	    expect(t.searches[2]?.seed).not.toBe(searchSeed(GAME_SEED, 0))
   251	  })
   252	})
   253	
   254	describe('SearchCoordinator: the four-condition acceptance rule (D2-4)', () => {
   255	  it('applies a correlated reply for the state it was asked about', () => {
   256	    const h = harness()
   257	    const state = h.readState()
   258	    h.coordinator.request(state, h.handlers)
   259	    const t = h.transport()
   260	    t.handlers.message(resultFor(state, t.searches[0]?.requestId ?? 0))
   261	    h.clock.advance(STEP_MS)
   262	    expect(h.delivered).toHaveLength(1)
   263	    expect(h.delivered[0]?.state).toBe(state)
   264	    expect(h.warnings).toHaveLength(0)
   265	  })
   266	
   267	  it('drops a reply whose requestId has been superseded', () => {
   268	    const h = harness()
   269	    const state = h.readState()
   270	    h.coordinator.request(state, h.handlers)
   271	    const staleId = h.transport().searches[0]?.requestId ?? 0
   272	    h.coordinator.request(state, h.handlers)
   273	
   274	    h.transport().handlers.message(resultFor(state, staleId))
   275	    h.clock.advance(STEP_MS * 4)
   276	    expect(h.delivered).toHaveLength(0)
   277	  })
   278	
   279	  it('drops a reply that arrives after restart', () => {
   280	    const h = harness()
   281	    const state = h.readState()
   282	    h.coordinator.request(state, h.handlers)
   283	    const t = h.transport()
   284	    const id = t.searches[0]?.requestId ?? 0
   285	
   286	    // `restart()` replaces `stateRef.current` and invalidates — but the reply is already on its way.
   287	    h.setState(aiToAct(12))
   288	    h.coordinator.invalidate()
   289	
   290	    t.handlers.message(resultFor(state, id))
   291	    h.clock.advance(STEP_MS * 4)
   292	    expect(h.delivered).toHaveLength(0)
   293	  })
   294	
   295	  // The non-obvious racer: concede is legal even when the human is not the acting player, so a human click
   296	  // really can commit a new state in the middle of the AI's turn.
   297	  it('drops a reply that arrives after a human concede', () => {
   298	    const h = harness()
   299	    const state = h.readState()
   300	    h.coordinator.request(state, h.handlers)
   301	    const t = h.transport()
   302	    const id = t.searches[0]?.requestId ?? 0
   303	
   304	    const concede: Command = { type: 'concede', player: HUMAN }
   305	    expect(legalCommands(state, HUMAN).some((c) => c.type === 'concede')).toBe(true)
   306	    const conceded = apply(state, concede).state
   307	    expect(conceded.result).not.toBeNull()
   308	    h.setState(conceded)
   309	    h.coordinator.invalidate()
   310	
   311	    t.handlers.message(resultFor(state, id))
   312	    h.clock.advance(STEP_MS * 4)
   313	    expect(h.delivered).toHaveLength(0)
   314	  })
   315	
   316	  // Defence in depth: the identity check must hold even when nobody remembered to invalidate.
   317	  it('drops a reply whose state is no longer stateRef.current even without an invalidate', () => {
   318	    const h = harness()
   319	    const state = h.readState()
   320	    h.coordinator.request(state, h.handlers)
   321	    const t = h.transport()
   322	
   323	    h.setState(apply(state, { type: 'concede', player: HUMAN }).state)
   324	    t.handlers.message(resultFor(state, t.searches[0]?.requestId ?? 0))
   325	    h.clock.advance(STEP_MS * 4)
   326	    expect(h.delivered).toHaveLength(0)
   327	  })
   328	
   329	  it('drops a reply that arrives after effect cleanup', () => {
   330	    const h = harness()
   331	    const state = h.readState()
   332	    h.coordinator.request(state, h.handlers)
   333	    const t = h.transport()
   334	    h.coordinator.invalidate()
   335	    t.handlers.message(resultFor(state, t.searches[0]?.requestId ?? 0))
   336	    h.clock.advance(STEP_MS * 4)
   337	    expect(h.delivered).toHaveLength(0)
   338	  })
   339	
   340	  it('drops a reply that arrives after unmount, and terminates the worker', () => {
   341	    const h = harness()
   342	    const state = h.readState()
   343	    h.coordinator.request(state, h.handlers)
   344	    const t = h.transport()
   345	    h.coordinator.dispose()
   346	    expect(t.terminations).toBe(1)
   347	
   348	    t.handlers.message(resultFor(state, t.searches[0]?.requestId ?? 0))
   349	    h.clock.advance(STEP_MS * 4)
   350	    expect(h.delivered).toHaveLength(0)
   351	    // A disposed coordinator is inert: a later request must not resurrect a worker.
   352	    h.coordinator.request(state, h.handlers)
   353	    expect(h.transports).toHaveLength(1)
   354	  })
   355	
   356	  it('cancels an accepted-but-unpaced delivery when cleanup lands inside the deadline', () => {
   357	    const h = harness()
   358	    const state = h.readState()
   359	    h.coordinator.request(state, h.handlers)
   360	    const t = h.transport()
   361	    t.handlers.message(resultFor(state, t.searches[0]?.requestId ?? 0))
   362	    h.clock.advance(STEP_MS / 2)
   363	    h.coordinator.invalidate()
   364	    h.clock.advance(STEP_MS * 4)
   365	    expect(h.delivered).toHaveLength(0)
   366	  })
   367	
   368	  it('never delivers for a state the AI does not own', () => {
   369	    const h = harness()
   370	    const humanState = humanToAct(11)
   371	    h.setState(humanState)
   372	    h.coordinator.request(humanState, h.handlers)
   373	    const t = h.transport()
   374	    const command = legalCommands(humanState, HUMAN)[0]
   375	    if (!command) throw new Error('no legal human command')
   376	    t.handlers.message({ type: 'result', requestId: t.searches[0]?.requestId ?? 0, result: { command, diagnostics: EMPTY_DIAGNOSTICS } })
   377	    h.clock.advance(STEP_MS * 4)
   378	    expect(h.delivered).toHaveLength(0)
   379	  })
   380	
   381	  it('leaves no timer armed once a game is disposed', () => {
   382	    const h = harness()
   383	    h.coordinator.request(h.readState(), h.handlers)
   384	    expect(h.clock.armed).toBeGreaterThan(0)
   385	    h.coordinator.dispose()
   386	    expect(h.clock.armed).toBe(0)
   387	  })
   388	})
   389	
   390	describe('SearchCoordinator: pacing is a deadline, not an added delay (D2-5)', () => {
   391	  it('holds a fast result until AI_STEP_MS has passed since the request', () => {
   392	    const h = harness()
   393	    const state = h.readState()
   394	    h.coordinator.request(state, h.handlers)
   395	    const t = h.transport()
   396	
   397	    h.clock.advance(50)
   398	    t.handlers.message(resultFor(state, t.searches[0]?.requestId ?? 0))
   399	    h.clock.advance(STEP_MS - 51)
   400	    expect(h.delivered).toHaveLength(0)
   401	    h.clock.advance(1)
   402	    expect(h.delivered).toHaveLength(1)
   403	  })
   404	
   405	  it('applies a slow result immediately rather than adding another AI_STEP_MS', () => {
   406	    const h = harness()
   407	    const state = h.readState()
   408	    h.coordinator.request(state, h.handlers)
   409	    const t = h.transport()
   410	
   411	    h.clock.advance(750)   // the search already showed 750 ms of thinking
   412	    t.handlers.message(resultFor(state, t.searches[0]?.requestId ?? 0))
   413	    h.clock.advance(0)
   414	    expect(h.delivered).toHaveLength(1)
   415	  })
   416	})
   417	
   418	describe('SearchCoordinator: fallback detection (D2-6)', () => {
   419	  it('falls back when the environment has no Worker at all', () => {
   420	    // The real factory, in an environment that genuinely has none — which is this test runner.
   421	    expect(typeof Worker).toBe('undefined')
   422	    const h = harness({ factory: workerTransport })
   423	    h.coordinator.request(h.readState(), h.handlers)
   424	    expectOneWarningAndACommand(h)
   425	  })
   426	
   427	  it('the real factory refuses to construct without Worker support', () => {
   428	    const noop: TransportHandlers = { message: () => {}, failure: () => {} }
   429	    expect(() => workerTransport(noop)).toThrow(/Web Worker/)
   430	  })
   431	
   432	  it('falls back when the transport constructor throws', () => {
   433	    const h = harness({ factory: () => { throw new Error('module chunk 404') } })
   434	    h.coordinator.request(h.readState(), h.handlers)
   435	    expectOneWarningAndACommand(h)
   436	    expect(h.warnings[0]).toContain('module chunk 404')
   437	  })
   438	
   439	  it('falls back on a synchronous postMessage clone failure', () => {
   440	    const h = harness({ onCreate: (t) => { t.postThrows = 'could not be cloned' } })

exec
/bin/zsh -lc "nl -ba apps/web/test/search-coordinator.test.ts | sed -n '441,680p'" in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
   441	    h.coordinator.request(h.readState(), h.handlers)
   442	    expectOneWarningAndACommand(h)
   443	    expect(h.transport().terminations).toBe(1)
   444	  })
   445	
   446	  it('falls back on an error event', () => {
   447	    const h = harness()
   448	    h.coordinator.request(h.readState(), h.handlers)
   449	    h.transport().handlers.failure('the search worker failed to load')
   450	    expectOneWarningAndACommand(h)
   451	    expect(h.transport().terminations).toBe(1)
   452	  })
   453	
   454	  it('falls back on a messageerror event', () => {
   455	    const h = harness()
   456	    h.coordinator.request(h.readState(), h.handlers)
   457	    h.transport().handlers.failure('the search worker sent a message that could not be read')
   458	    expectOneWarningAndACommand(h)
   459	  })
   460	
   461	  it('falls back on a typed error message', () => {
   462	    const h = harness()
   463	    h.coordinator.request(h.readState(), h.handlers)
   464	    const t = h.transport()
   465	    t.handlers.message({ type: 'error', requestId: t.searches[0]?.requestId ?? 0, message: 'searchIsmcts: the game is already over' })
   466	    expectOneWarningAndACommand(h)
   467	    expect(h.warnings[0]).toContain('searchIsmcts')
   468	  })
   469	
   470	  /**
   471	   * The failure funnel must RECOVER, never merely give up. `fail()` used to `invalidate()` — cancelling the
   472	   * outstanding request and any pending delivery — and then return early whenever the error did not correlate
   473	   * with what was live, scheduling no move and emitting no warning. The AI then never acted again: the effect
   474	   * keys on the committed state, which never changes, so nothing re-requests. Silent hang, spinner up, empty
   475	   * log — the inverse of the silent degradation D2-6 exists to forbid, and worse, because it stops the game.
   476	   */
   477	  it('recovers even when the error names a request that is no longer the live one', () => {
   478	    const h = harness()
   479	    h.coordinator.request(h.readState(), h.handlers)
   480	    const t = h.transport()
   481	    const superseded = t.searches[0]?.requestId ?? 0
   482	    h.coordinator.invalidate()
   483	    h.coordinator.request(h.readState(), h.handlers)   // a newer request is now outstanding
   484	    t.handlers.message({ type: 'error', requestId: superseded, message: 'worker blew up on the old request' })
   485	    expectOneWarningAndACommand(h)
   486	  })
   487	
   488	  it('does not cancel a fallback move that a previous failure already scheduled', () => {
   489	    const h = harness()
   490	    h.coordinator.request(h.readState(), h.handlers)
   491	    const t = h.transport()
   492	    t.handlers.failure('first failure')
   493	    // A second failure landing inside the fallback's own pacing window must leave the queued Greedy move alone.
   494	    t.handlers.failure('second failure')
   495	    expectOneWarningAndACommand(h)
   496	  })
   497	
   498	  it('falls back on an init failure, which carries no requestId', () => {
   499	    const h = harness()
   500	    h.coordinator.request(h.readState(), h.handlers)
   501	    h.transport().handlers.message({ type: 'error', requestId: null, message: 'search worker received a request before init' })
   502	    expectOneWarningAndACommand(h)
   503	  })
   504	
   505	  // The one failure with no correlated event of any kind: a worker that is killed or hangs.
   506	  it('falls back when the worker simply never replies', () => {
   507	    const h = harness()
   508	    h.coordinator.request(h.readState(), h.handlers)
   509	    expect(h.delivered).toHaveLength(0)
   510	
   511	    h.clock.advance(STARTUP_WATCHDOG_MS)
   512	    // The deadline is long past by now, so the Greedy command lands on the same tick.
   513	    expect(h.delivered).toHaveLength(1)
   514	    expect(h.warnings).toHaveLength(1)
   515	    expect(h.warnings[0]).toContain('did not respond')
   516	    expect(h.coordinator.usingFallback).toBe(true)
   517	    expect(h.transport().terminations).toBe(1)
   518	  })
   519	
   520	  it('uses the shorter watchdog once the worker has started', () => {
   521	    const h = harness()
   522	    const state = h.readState()
   523	    h.coordinator.request(state, h.handlers)
   524	    const t = h.transport()
   525	    t.handlers.message(resultFor(state, t.searches[0]?.requestId ?? 0))
   526	    h.clock.advance(STEP_MS)
   527	    expect(h.delivered).toHaveLength(1)
   528	
   529	    h.coordinator.request(state, h.handlers)
   530	    h.clock.advance(WATCHDOG_MS)
   531	    expect(h.coordinator.usingFallback).toBe(true)
   532	    expect(h.delivered).toHaveLength(2)
   533	  })
   534	
   535	  it('warns once per game, however many things go wrong', () => {
   536	    const h = harness()
   537	    const state = h.readState()
   538	    h.coordinator.request(state, h.handlers)
   539	    h.transport().handlers.failure('first failure')
   540	    h.clock.advance(STEP_MS)
   541	    h.transport().handlers.failure('second failure')
   542	
   543	    h.coordinator.request(state, h.handlers)
   544	    h.clock.advance(STEP_MS)
   545	    h.coordinator.request(state, h.handlers)
   546	    h.clock.advance(STEP_MS)
   547	
   548	    expect(h.warnings).toHaveLength(1)
   549	    expect(h.warnings[0]).toContain('first failure')
   550	    expect(h.delivered).toHaveLength(3)
   551	  })
   552	
   553	  // A worker can die between decisions, when there is no handler to warn through. The warning must not be lost.
   554	  it('defers the warning to the next request when nothing was outstanding', () => {
   555	    const h = harness()
   556	    const state = h.readState()
   557	    h.coordinator.request(state, h.handlers)
   558	    const t = h.transport()
   559	    t.handlers.message(resultFor(state, t.searches[0]?.requestId ?? 0))
   560	    h.clock.advance(STEP_MS)
   561	    expect(h.delivered).toHaveLength(1)
   562	
   563	    t.handlers.failure('the worker died between decisions')
   564	    expect(h.warnings).toHaveLength(0)
   565	    expect(h.coordinator.usingFallback).toBe(true)
   566	
   567	    h.coordinator.request(state, h.handlers)
   568	    h.clock.advance(STEP_MS)
   569	    expect(h.warnings).toHaveLength(1)
   570	    expect(h.warnings[0]).toContain('died between decisions')
   571	    expect(h.delivered).toHaveLength(2)
   572	  })
   573	
   574	  it('never builds another worker once it has fallen back', () => {
   575	    const h = harness()
   576	    h.coordinator.request(h.readState(), h.handlers)
   577	    h.transport().handlers.failure('gone')
   578	    h.clock.advance(STEP_MS)
   579	    h.coordinator.request(h.readState(), h.handlers)
   580	    h.clock.advance(STEP_MS)
   581	    expect(h.transports).toHaveLength(1)
   582	    expect(h.transport().searches).toHaveLength(1)
   583	  })
   584	
   585	  // The fallback carries the same staleness and pacing rules, or it would corrupt games the worker never touched.
   586	  it('drops a fallback command when the position moves on inside the deadline', () => {
   587	    const h = harness()
   588	    const state = h.readState()
   589	    h.coordinator.request(state, h.handlers)
   590	    h.transport().handlers.failure('gone')
   591	    h.setState(apply(state, { type: 'concede', player: HUMAN }).state)
   592	    h.clock.advance(STEP_MS * 4)
   593	    expect(h.delivered).toHaveLength(0)
   594	    expect(h.warnings).toHaveLength(1)
   595	  })
   596	
   597	  it('keeps advancing the per-position seed under the fallback', () => {
   598	    const h = harness()
   599	    const state = h.readState()
   600	    h.coordinator.request(state, h.handlers)
   601	    h.transport().handlers.failure('gone')
   602	    h.clock.advance(STEP_MS)
   603	    expect(h.delivered).toHaveLength(1)
   604	    expect(h.coordinator.nextSeed).toBe(searchSeed(GAME_SEED, 1))
   605	  })
   606	})

exec
/bin/zsh -lc 'nl -ba apps/web/test/search-protocol.test.ts' in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
     1	import { describe, expect, it } from 'vitest'
     2	import { apply, createGame, legalCommands, viewFor, type GameState, type PlayerId } from '@fftcg/engine'
     3	import { GreedyAgent, searchIsmcts, type SearchInput } from '@fftcg/ai'
     4	import { CARD_DEFS, DECKS } from '../src/deck.js'
     5	import { AI } from '../src/game/types.js'
     6	import { describeFailure, respond, searchInputFor, type WorkerInit, type WorkerSearchRequest } from '../src/game/search/protocol.js'
     7	
     8	const ROLLOUT_COMMAND_CAP = 8
     9	const EXPLORATION_C = 1
    10	
    11	const INIT: WorkerInit = { type: 'init', decks: DECKS, rolloutCommandCap: ROLLOUT_COMMAND_CAP, explorationC: EXPLORATION_C }
    12	
    13	/** Fast-forward a real game to the first position the AI actually owns; anything else is not a search input. */
    14	function aiToAct(seed: number): GameState {
    15	  let state: GameState = createGame({ seed, decks: DECKS, defs: CARD_DEFS })
    16	  const agent = new GreedyAgent({ seed, decks: DECKS, depth: 1 })
    17	  for (let i = 0; i < 400; i++) {
    18	    const p: PlayerId | null = state.result ? null : (state.pending?.player ?? state.priority)
    19	    if (p === null) break
    20	    if (p === AI) return state
    21	    state = apply(state, agent.decide(viewFor(state, p), legalCommands(state, p))).state
    22	  }
    23	  throw new Error(`seed ${seed} never reached an AI decision`)
    24	}
    25	
    26	const requestFor = (state: GameState, over: Partial<WorkerSearchRequest> = {}): WorkerSearchRequest =>
    27	  ({ type: 'search', requestId: 7, view: viewFor(state, AI), seed: 12345, iterations: 12, ...over })
    28	
    29	describe('search protocol', () => {
    30	  // D2-A3: the boundary must be a pure translation. A `respond` that quietly re-derived caps or a seed would
    31	  // make the browser play a different game from the headless gate that measured 90.0 %.
    32	  it('respond returns exactly what a direct searchIsmcts call returns (D2-A3)', () => {
    33	    const state = aiToAct(11)
    34	    const request = requestFor(state)
    35	    // Clone the request the way `postMessage` would, so the comparison is across a real serialization too.
    36	    const direct = searchIsmcts(searchInputFor(INIT, structuredClone(request)))
    37	    const viaProtocol = respond(INIT, request)
    38	    expect(viaProtocol.type).toBe('result')
    39	    expect(viaProtocol).toEqual({ type: 'result', requestId: 7, result: direct })
    40	  })
    41	
    42	  // The `requestId` is correlation only — it must never reach the search, or a retry of one position would
    43	  // pick a different move (D2-3).
    44	  it('the requestId does not influence the answer', () => {
    45	    const state = aiToAct(11)
    46	    const a = respond(INIT, requestFor(state, { requestId: 1 }))
    47	    const b = respond(INIT, requestFor(state, { requestId: 9999 }))
    48	    if (a.type !== 'result' || b.type !== 'result') throw new Error('expected results')
    49	    expect(a.result).toEqual(b.result)
    50	  })
    51	
    52	  it('searchInputFor takes the caps from init and the position from the request', () => {
    53	    const state = aiToAct(11)
    54	    const input: SearchInput = searchInputFor(INIT, requestFor(state, { seed: 99, iterations: 5 }))
    55	    expect(input.rolloutCommandCap).toBe(ROLLOUT_COMMAND_CAP)
    56	    expect(input.explorationC).toBe(EXPLORATION_C)
    57	    expect(input.decks).toBe(DECKS)
    58	    expect(input.seed).toBe(99)
    59	    expect(input.iterations).toBe(5)
    60	  })
    61	
    62	  it('a throwing search becomes an error message carrying its own requestId', () => {
    63	    const state = aiToAct(11)
    64	    const message = respond(INIT, requestFor(state, { requestId: 42, iterations: 0 }))
    65	    expect(message.type).toBe('error')
    66	    if (message.type !== 'error') throw new Error('unreachable')
    67	    expect(message.requestId).toBe(42)
    68	    expect(typeof message.message).toBe('string')
    69	    expect(message.message).toMatch(/iterations/)
    70	  })
    71	
    72	  it('errors cross as plain strings, never as Error objects', () => {
    73	    expect(describeFailure(new RangeError('boom'))).toBe('boom')
    74	    expect(describeFailure('boom')).toBe('boom')
    75	    expect(describeFailure(undefined)).toBe('undefined')
    76	  })
    77	
    78	  // Every message is posted, so every message must clone. `structuredClone` throws on anything that does not.
    79	  it('every message is structured-cloneable', () => {
    80	    const state = aiToAct(11)
    81	    const request = requestFor(state)
    82	    const result = respond(INIT, request)
    83	    expect(() => structuredClone(INIT)).not.toThrow()
    84	    expect(() => structuredClone(request)).not.toThrow()
    85	    expect(() => structuredClone(result)).not.toThrow()
    86	    expect(() => structuredClone({ type: 'error', requestId: null, message: 'init failed' })).not.toThrow()
    87	    expect(structuredClone(result)).toEqual(result)
    88	  })
    89	})

exec
/bin/zsh -lc "nl -ba apps/web/test/search-coordinator.test.ts | sed -n '211,390p'" in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
   211	
   212	  it('posts init exactly once, ahead of the first search', () => {
   213	    const h = harness()
   214	    h.coordinator.request(h.readState(), h.handlers)
   215	    h.coordinator.invalidate()
   216	    h.coordinator.request(h.readState(), h.handlers)
   217	    const t = h.transport()
   218	    expect(t.sent.filter((m) => m.type === 'init')).toHaveLength(1)
   219	    expect(t.sent[0]?.type).toBe('init')
   220	    const init = t.sent[0]
   221	    if (init?.type !== 'init') throw new Error('unreachable')
   222	    expect(init.rolloutCommandCap).toBe(8)
   223	    expect(init.explorationC).toBe(1)
   224	    expect(init.decks).toBe(DECKS)
   225	  })
   226	
   227	  it('advances the seed only when a command actually commits', () => {
   228	    const h = harness()
   229	    const first = h.readState()
   230	    h.coordinator.request(first, h.handlers)
   231	    const t = h.transport()
   232	
   233	    // A delivered-but-rejected command must NOT consume the position's seed.
   234	    h.setCommit(false)
   235	    t.handlers.message(resultFor(first, t.searches[0]?.requestId ?? 0))
   236	    h.clock.advance(STEP_MS)
   237	    expect(h.delivered).toHaveLength(1)
   238	
   239	    h.coordinator.request(first, h.handlers)
   240	    expect(t.searches[1]?.seed).toBe(searchSeed(GAME_SEED, 0))
   241	
   242	    // Now let it commit, and the next position is a different question.
   243	    h.setCommit(true)
   244	    t.handlers.message(resultFor(first, t.searches[1]?.requestId ?? 0))
   245	    h.clock.advance(STEP_MS)
   246	    expect(h.delivered).toHaveLength(2)
   247	
   248	    h.coordinator.request(first, h.handlers)
   249	    expect(t.searches[2]?.seed).toBe(searchSeed(GAME_SEED, 1))
   250	    expect(t.searches[2]?.seed).not.toBe(searchSeed(GAME_SEED, 0))
   251	  })
   252	})
   253	
   254	describe('SearchCoordinator: the four-condition acceptance rule (D2-4)', () => {
   255	  it('applies a correlated reply for the state it was asked about', () => {
   256	    const h = harness()
   257	    const state = h.readState()
   258	    h.coordinator.request(state, h.handlers)
   259	    const t = h.transport()
   260	    t.handlers.message(resultFor(state, t.searches[0]?.requestId ?? 0))
   261	    h.clock.advance(STEP_MS)
   262	    expect(h.delivered).toHaveLength(1)
   263	    expect(h.delivered[0]?.state).toBe(state)
   264	    expect(h.warnings).toHaveLength(0)
   265	  })
   266	
   267	  it('drops a reply whose requestId has been superseded', () => {
   268	    const h = harness()
   269	    const state = h.readState()
   270	    h.coordinator.request(state, h.handlers)
   271	    const staleId = h.transport().searches[0]?.requestId ?? 0
   272	    h.coordinator.request(state, h.handlers)
   273	
   274	    h.transport().handlers.message(resultFor(state, staleId))
   275	    h.clock.advance(STEP_MS * 4)
   276	    expect(h.delivered).toHaveLength(0)
   277	  })
   278	
   279	  it('drops a reply that arrives after restart', () => {
   280	    const h = harness()
   281	    const state = h.readState()
   282	    h.coordinator.request(state, h.handlers)
   283	    const t = h.transport()
   284	    const id = t.searches[0]?.requestId ?? 0
   285	
   286	    // `restart()` replaces `stateRef.current` and invalidates — but the reply is already on its way.
   287	    h.setState(aiToAct(12))
   288	    h.coordinator.invalidate()
   289	
   290	    t.handlers.message(resultFor(state, id))
   291	    h.clock.advance(STEP_MS * 4)
   292	    expect(h.delivered).toHaveLength(0)
   293	  })
   294	
   295	  // The non-obvious racer: concede is legal even when the human is not the acting player, so a human click
   296	  // really can commit a new state in the middle of the AI's turn.
   297	  it('drops a reply that arrives after a human concede', () => {
   298	    const h = harness()
   299	    const state = h.readState()
   300	    h.coordinator.request(state, h.handlers)
   301	    const t = h.transport()
   302	    const id = t.searches[0]?.requestId ?? 0
   303	
   304	    const concede: Command = { type: 'concede', player: HUMAN }
   305	    expect(legalCommands(state, HUMAN).some((c) => c.type === 'concede')).toBe(true)
   306	    const conceded = apply(state, concede).state
   307	    expect(conceded.result).not.toBeNull()
   308	    h.setState(conceded)
   309	    h.coordinator.invalidate()
   310	
   311	    t.handlers.message(resultFor(state, id))
   312	    h.clock.advance(STEP_MS * 4)
   313	    expect(h.delivered).toHaveLength(0)
   314	  })
   315	
   316	  // Defence in depth: the identity check must hold even when nobody remembered to invalidate.
   317	  it('drops a reply whose state is no longer stateRef.current even without an invalidate', () => {
   318	    const h = harness()
   319	    const state = h.readState()
   320	    h.coordinator.request(state, h.handlers)
   321	    const t = h.transport()
   322	
   323	    h.setState(apply(state, { type: 'concede', player: HUMAN }).state)
   324	    t.handlers.message(resultFor(state, t.searches[0]?.requestId ?? 0))
   325	    h.clock.advance(STEP_MS * 4)
   326	    expect(h.delivered).toHaveLength(0)
   327	  })
   328	
   329	  it('drops a reply that arrives after effect cleanup', () => {
   330	    const h = harness()
   331	    const state = h.readState()
   332	    h.coordinator.request(state, h.handlers)
   333	    const t = h.transport()
   334	    h.coordinator.invalidate()
   335	    t.handlers.message(resultFor(state, t.searches[0]?.requestId ?? 0))
   336	    h.clock.advance(STEP_MS * 4)
   337	    expect(h.delivered).toHaveLength(0)
   338	  })
   339	
   340	  it('drops a reply that arrives after unmount, and terminates the worker', () => {
   341	    const h = harness()
   342	    const state = h.readState()
   343	    h.coordinator.request(state, h.handlers)
   344	    const t = h.transport()
   345	    h.coordinator.dispose()
   346	    expect(t.terminations).toBe(1)
   347	
   348	    t.handlers.message(resultFor(state, t.searches[0]?.requestId ?? 0))
   349	    h.clock.advance(STEP_MS * 4)
   350	    expect(h.delivered).toHaveLength(0)
   351	    // A disposed coordinator is inert: a later request must not resurrect a worker.
   352	    h.coordinator.request(state, h.handlers)
   353	    expect(h.transports).toHaveLength(1)
   354	  })
   355	
   356	  it('cancels an accepted-but-unpaced delivery when cleanup lands inside the deadline', () => {
   357	    const h = harness()
   358	    const state = h.readState()
   359	    h.coordinator.request(state, h.handlers)
   360	    const t = h.transport()
   361	    t.handlers.message(resultFor(state, t.searches[0]?.requestId ?? 0))
   362	    h.clock.advance(STEP_MS / 2)
   363	    h.coordinator.invalidate()
   364	    h.clock.advance(STEP_MS * 4)
   365	    expect(h.delivered).toHaveLength(0)
   366	  })
   367	
   368	  it('never delivers for a state the AI does not own', () => {
   369	    const h = harness()
   370	    const humanState = humanToAct(11)
   371	    h.setState(humanState)
   372	    h.coordinator.request(humanState, h.handlers)
   373	    const t = h.transport()
   374	    const command = legalCommands(humanState, HUMAN)[0]
   375	    if (!command) throw new Error('no legal human command')
   376	    t.handlers.message({ type: 'result', requestId: t.searches[0]?.requestId ?? 0, result: { command, diagnostics: EMPTY_DIAGNOSTICS } })
   377	    h.clock.advance(STEP_MS * 4)
   378	    expect(h.delivered).toHaveLength(0)
   379	  })
   380	
   381	  it('leaves no timer armed once a game is disposed', () => {
   382	    const h = harness()
   383	    h.coordinator.request(h.readState(), h.handlers)
   384	    expect(h.clock.armed).toBeGreaterThan(0)
   385	    h.coordinator.dispose()
   386	    expect(h.clock.armed).toBe(0)
   387	  })
   388	})
   389	
   390	describe('SearchCoordinator: pacing is a deadline, not an added delay (D2-5)', () => {

exec
/bin/zsh -lc "nl -ba apps/web/src/game/useGame.ts | sed -n '280,410p'" in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
   280	/** Test seams. The hook passes none of them; the browser gets a real worker and a real clock. */
   281	export type SearchSeams = Pick<SearchCoordinatorOptions, 'createTransport' | 'clock' | 'iterations'>
   282	
   283	export interface AiSearch {
   284	  request(state: GameState, handlers: SearchRequestHandlers): void
   285	  /** Effect cleanup, and any commit the coordinator did not itself make. Synchronous, per D2-4. */
   286	  invalidate(): void
   287	  /** A new game under `seed`. */
   288	  restart(seed: number): void
   289	  dispose(): void
   290	}
   291	
   292	/**
   293	 * One `SearchCoordinator` per GAME. Throwing it away is how a restart resets the two things that are per-game
   294	 * facts and would otherwise leak across one: the committed-decision index the search seed is derived from
   295	 * (D2-3), and the permanently-Greedy latch a dead worker sets (D2-6).
   296	 *
   297	 * Built lazily, and rebuilt after `dispose`, because StrictMode's mount→unmount→mount tears the coordinator
   298	 * down without re-rendering — a one-shot construction in the render body would leave the second mount holding
   299	 * a terminated worker and no AI at all.
   300	 */
   301	export function createAiSearch(readState: () => GameState, seed: number, seams: SearchSeams = {}): AiSearch {
   302	  let gameSeed = seed
   303	  let coordinator: SearchCoordinator | null = null
   304	  const drop = (): void => { coordinator?.dispose(); coordinator = null }
   305	  const live = (): SearchCoordinator => (coordinator ??= new SearchCoordinator({
   306	    decks: DECKS, gameSeed, readState, stepMs: AI_STEP_MS, ...seams,
   307	  }))
   308	  return {
   309	    request: (state, handlers) => { live().request(state, handlers) },
   310	    invalidate: () => { coordinator?.invalidate() },
   311	    restart: (next) => { gameSeed = next; drop() },
   312	    dispose: drop,
   313	  }
   314	}
   315	
   316	const newGame = (seed: number): GameState => createGame({ seed, decks: DECKS, defs: CARD_DEFS })
   317	
   318	const openingLog = (): LogLine[] => [{ kind: 'phase', text: 'New game — you are P0, the AI is P1' }]
   319	
   320	export function useGame(seed?: number): GameApi {
   321	  const seedRef = useRef<number>(seed ?? Date.now() % 2_147_483_647)
   322	  // Spec B3: the ground truth lives here and only `viewFor(state, HUMAN)` ever leaves the hook. `stateRef` is
   323	  // the authority `choose` reads, so two clicks inside one render can't both apply to the same stale state.
   324	  const [state, setState] = useState<GameState>(() => newGame(seedRef.current))
   325	  const stateRef = useRef<GameState>(state)
   326	  const searchRef = useRef<AiSearch | null>(null)
   327	  // Lazy for the same reason the game itself is: `useRef(createAiSearch(...))` would build one every render.
   328	  searchRef.current ??= createAiSearch(() => stateRef.current, seedRef.current)
   329	  const [log, setLog] = useState<LogLine[]>(openingLog)
   330	  const [aiThinking, setAiThinking] = useState(false)
   331	
   332	  const commit = useCallback((next: GameState, lines: LogLine[]) => {
   333	    stateRef.current = next
   334	    setState(next)
   335	    if (lines.length) setLog((prev) => [...prev, ...lines])
   336	  }, [])
   337	
   338	  const appendLog = useCallback((line: LogLine) => { setLog((prev) => [...prev, line]) }, [])
   339	  const handlers = useMemo(() => aiHandlers({ commit, log: appendLog }), [commit, appendLog])
   340	
   341	  const view = useMemo(() => viewFor(state, HUMAN), [state])
   342	  const choices = useMemo(() => buildChoiceSet(view, preferredChoices(view, legalCommands(state, HUMAN))), [state, view])
   343	
   344	  const choose = useCallback((choice: Choice): void => {
   345	    const current = stateRef.current
   346	    // D2-4: an external commit synchronously drops whatever the AI has outstanding. `concede` is legal even
   347	    // when the human is NOT the acting player, so a click really can land in the middle of the AI's search.
   348	    searchRef.current?.invalidate()
   349	    // Spec B-A4: prove the command is still legal before touching `apply`, so an illegal click is impossible
   350	    // rather than merely rejected by the engine after the fact.
   351	    const legal = legalCommands(current, HUMAN)
   352	    if (!legal.some((c) => sameCommand(c, choice.command))) throw new Error(`illegal command: ${choice.label}`)
   353	    const before = viewFor(current, HUMAN)
   354	    const result = apply(current, choice.command)
   355	    const lines = eventLines(narrator(before, viewFor(result.state, HUMAN)), result.events, current.resolution.queue)
   356	    commit(result.state, [{ kind: 'human', text: describeChoice(before, choice.command) }, ...lines])
   357	  }, [commit])
   358	
   359	  const restart = useCallback((): void => {
   360	    // A fresh but reproducible seed: `useGame(seed)` stays deterministic across restarts, which tests rely on.
   361	    const next = ++seedRef.current
   362	    const game = newGame(next)
   363	    stateRef.current = game
   364	    // D2-3: a new coordinator, so the committed-decision index the search seed is derived from restarts at 0.
   365	    searchRef.current?.restart(next)
   366	    setState(game)
   367	    setLog(openingLog())
   368	    setAiThinking(false)
   369	  }, [])
   370	
   371	  // Spec B7 + D2: one AI move per decision, searched off the main thread. Re-running on every `state` change is
   372	  // what makes it a loop, and one accepted request per state is what stops two AI moves overlapping. The
   373	  // cleanup invalidates synchronously, so StrictMode's mount→unmount→mount double-invoke discards the first
   374	  // request rather than stepping the AI twice.
   375	  useEffect(() => {
   376	    if (state.result || actingPlayer(state) !== AI) { setAiThinking(false); return }
   377	    setAiThinking(true)
   378	    const search = searchRef.current as AiSearch
   379	    search.request(state, handlers)
   380	    return () => { search.invalidate() }
   381	  }, [state, handlers])
   382	
   383	  // Unmount only. A worker outliving its hook is both a leak and a source of replies for a game nobody is
   384	  // looking at any more (D2-4).
   385	  useEffect(() => () => { searchRef.current?.dispose() }, [])
   386	
   387	  return { view, choices, log, aiThinking, choose, restart }
   388	}

exec
/bin/zsh -lc "nl -ba apps/web/test/search-coordinator.test.ts | sed -n '1,210p'" in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
exec
/bin/zsh -lc "nl -ba packages/ai/src/ismcts/search.ts | sed -n '1,120p;420,490p'" in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
     1	import {
     2	  actingPlayer, apply, determinise, nextInt, seedRng,
     3	  type CardId, type CardInstance, type Command, type FieldView, type GameState, type PlayerId, type PlayerView, type Rng,
     4	} from '@fftcg/engine'
     5	import { candidateCommands } from '../candidates.js'
     6	import { DEFAULT_WEIGHTS, evaluate, type Weights } from '../evaluate.js'
     7	import { greedyStep, resolveForcedDecisions } from '../greedy.js'
     8	import {
     9	  actionKey, compareKeys, decodeAction, isOpaque, observationKey,
    10	  type ActionKey, type ObservationKey, type SearchDiagnostics, type SearchInput, type SearchResult,
    11	} from './keys.js'
    12	
    13	/**
    14	 * Single-Observer ISMCTS (spec D-1). The tree is over the ROOT player's information sets: nodes are
    15	 * `(parent history, ActionKey, ObservationKey)`, statistics live on the ACTION EDGES, and each edge fans out
    16	 * into one child per distinct observation the root could make afterwards (turn advancement draws cards, an
    17	 * ability reveals what it hit, so one action does not identify one resulting information set).
    18	 *
    19	 * The four things this rung gets wrong invisibly — each still plays legal, plausible moves that beat random,
    20	 * so only a unit test catches them (spec D-A2):
    21	 *   1. draining forced decisions before the search answers the question `decide` was asked (D-3);
    22	 *   2. availability used as a divisor instead of inside the logarithm (D-4);
    23	 *   3. a cooperative opponent node (D-5);
    24	 *   4. unbounded rewards, where one terminal rollout swamps every exploration term (D-5).
    25	 */
    26	
    27	// ---------------------------------------------------------------------------
    28	// Constants
    29	// ---------------------------------------------------------------------------
    30	
    31	/**
    32	 * `evaluate` is an unbounded material score (±100,000 at terminals); `tanh(x / REWARD_SCALE)` squashes it onto
    33	 * the same [0, 1] scale terminals use, so a heuristic leaf can never outrank a real win (D-5). 100 is about
    34	 * seven Forwards' worth of material on `DEFAULT_WEIGHTS`, which keeps the interesting range — a body or two of
    35	 * advantage — off tanh's flat tails, where every position would look identical to the search.
    36	 */
    37	export const REWARD_SCALE = 100
    38	
    39	/** `C ≈ 1` (D-5). Rewards are in [0, 1], so this is the usual UCT constant for a normalised reward. */
    40	export const DEFAULT_EXPLORATION_C = 1
    41	
    42	/**
    43	 * Measured on the starter matchup at the caps below: ~0.9 ms per iteration, i.e. ~185 ms per decision, of which
    44	 * the greedy rollout is ~95 % (`rolloutApplies` runs ~375 applies per iteration against `treeApplies`' ~4).
    45	 * Not calibrated for strength — that is the D-A1 lane's job on development seeds; this is a default that plays
    46	 * clearly above `GreedyAgent` (66 % over 24 mirrored games at a THIRD of it) without being unusable headless.
    47	 */
    48	export const DEFAULT_ITERATIONS = 200
    49	
    50	/** D-6: a cap on rollout COMMANDS, not depth — an ability cascade makes a single command arbitrarily deep. */
    51	export const DEFAULT_ROLLOUT_COMMAND_CAP = 24
    52	
    53	/**
    54	 * The hard WORK bound on one rollout, in `apply` calls, covering the settlement tail the command cap cannot.
    55	 * Measured at ~520 applies per iteration on the starter matchup at the command cap above, so this is roughly
    56	 * 4x a normal rollout: high enough never to bind in ordinary play, low enough that a pathological cascade
    57	 * cannot run away inside a Worker with no cancellation.
    58	 */
    59	export const DEFAULT_ROLLOUT_APPLY_CAP = 2048
    60	
    61	/** Rollouts price both sides symmetrically; `greedyStep` flips it for the non-perspective player itself. */
    62	const ROLLOUT_AGGRESSION = 0.5
    63	
    64	// ---------------------------------------------------------------------------
    65	// Tree
    66	// ---------------------------------------------------------------------------
    67	
    68	export interface SearchEdge {
    69	  readonly key: ActionKey
    70	  /** `N(s,a)` — times this edge was SELECTED. Incremented only along the path a simulation actually took. */
    71	  visits: number
    72	  /**
    73	   * `A(s,a)` — visits to `s` at which this canonical action was in `candidateCommands` (D-4). Incremented on
    74	   * backpropagation for EVERY available sibling, not just the selected one. This is the number that replaces
    75	   * the parent-visit count *inside the logarithm*; an action that is legal only in rare determinisations is
    76	   * then judged against how often it was actually offered, instead of being drowned by how often the node was
    77	   * visited at all.
    78	   */
    79	  availability: number
    80	  /** Σ of ROOT-perspective rewards backed up through this edge. Actor-awareness lives in selection, not here. */
    81	  reward: number
    82	  readonly children: Map<ObservationKey, SearchNode>
    83	}
    84	
    85	export interface SearchNode {
    86	  /**
    87	   * Who decides here. A function of the `ObservationKey` that created the node (it carries `priority` and the
    88	   * whole `pending`), so it cannot legitimately differ between visits — `descend` throws if it ever does,
    89	   * which is a direct check that the observation key is fine-grained enough to identify a decision point.
    90	   */
    91	  readonly actor: PlayerId
    92	  visits: number
    93	  readonly edges: Map<ActionKey, SearchEdge>
    94	}
    95	
    96	/** One selection step, kept so backpropagation knows which siblings were AVAILABLE at each node (D-4). */
    97	export interface PathStep {
    98	  readonly node: SearchNode
    99	  readonly edge: SearchEdge
   100	  readonly available: readonly ActionKey[]
   101	}
   102	
   103	export function createNode(actor: PlayerId): SearchNode {
   104	  return { actor, visits: 0, edges: new Map() }
   105	}
   106	
   107	/** The edge for `key`, minted on demand. Availability bookkeeping creates edges for actions never selected. */
   108	export function edgeFor(node: SearchNode, key: ActionKey): SearchEdge {
   109	  const hit = node.edges.get(key)
   110	  if (hit) return hit
   111	  const made: SearchEdge = { key, visits: 0, availability: 0, reward: 0, children: new Map() }
   112	  node.edges.set(key, made)
   113	  return made
   114	}
   115	
   116	export const meanReward = (edge: SearchEdge): number => (edge.visits === 0 ? 0 : edge.reward / edge.visits)
   117	
   118	/**
   119	 * What the ACTOR at this node is trying to maximise (D-5). Rewards are always stored from the root player's
   120	 * point of view, so an opponent node maximises `1 - mean`: the reflection of the root's reward on [0, 1].
   420	      node = child
   421	      if (expansion) break
   422	    }
   423	
   424	    const rollout = rolloutToCap(state, root, input.rolloutCommandCap, DEFAULT_WEIGHTS, counters)
   425	    counters.maxCommandDepth = Math.max(counters.maxCommandDepth, commands + rollout.commands)
   426	    backpropagate(path, rollout.reward)
   427	  }
   428	
   429	  if (rootCommands.size === 0) {
   430	    // Mirrors `GreedyAgent.decide`'s R2 policy: a gap in `candidateCommands` must fail loudly rather than fall
   431	    // through to a legal-but-catastrophic move.
   432	    throw new Error(`searchIsmcts: no candidate commands at the root in ${input.view.phase}/${input.view.pending?.kind ?? '-'}`)
   433	  }
   434	
   435	  const ranked = rankRootEdges([...rootNode.edges.values()])
   436	  const best = ranked[0]
   437	  if (!best) throw new Error('searchIsmcts: no root action was ever visited')
   438	  if (isOpaque(best.key)) throw new Error(`searchIsmcts: root action ${best.key} names a card the root player cannot identify`)
   439	
   440	  // Return the command the tree actually EVALUATED, not a fresh decode of its key. Keys sort their lists
   441	  // (order is not semantic to `apply`), but the engine preserves command order in places the search then
   442	  // reads back: Break-Zone order after a multi-card discard, and a resolution frame's `chosen` binding. So a
   443	  // decode could hand back `[V-F1,V-F7]` where the simulations had scored `[V-F7,V-F1]` — a different
   444	  // observation from the one the statistics were gathered on. `rootCommands` holds the real candidate that
   445	  // produced this key, and the root player's own cards keep their live ids through determinisation (only
   446	  // hidden cards are re-minted), so it is already a live command. Decoding stays as the fallback.
   447	  const command = rootCommands.get(best.key) ?? decodeAction(input.view, best.key)
   448	  if (!command) throw new Error(`searchIsmcts: root action ${best.key} does not decode against the live view`)
   449	
   450	  // What the counters mean (D-A4), because two of them are easy to misread: `rolloutApplies` includes the
   451	  // applies `greedyStep` spends scoring its own candidates — that is where ~95 % of the time goes, so counting
   452	  // only the commands it chose would report a cost an order of magnitude below the real one. `evaluations`
   453	  // counts the search's own leaf evaluations only (one per simulation that did not end in a terminal), not
   454	  // greedy's internal ones, which track its applies. `maxCommandDepth` is tree commands plus rollout commands.
   455	  const diagnostics: SearchDiagnostics = {
   456	    determinisations: counters.determinisations,
   457	    treeApplies: counters.treeApplies,
   458	    rolloutApplies: counters.rolloutApplies,
   459	    evaluations: counters.evaluations,
   460	    nodes: counters.nodes,
   461	    maxCommandDepth: counters.maxCommandDepth,
   462	    rootChildren: ranked.map((e) => [e.key, e.visits, meanReward(e)] as const),
   463	  }
   464	  return { root: rootNode, result: { command, diagnostics } }
   465	}
   466	
   467	/** The pure, synchronous, structured-cloneable search seam (D-7). `searchTree` is the same run with its tree. */
   468	export function searchIsmcts(input: SearchInput): SearchResult {
   469	  return searchTree(input).result
   470	}

 succeeded in 0ms:
     1	import { describe, expect, it } from 'vitest'
     2	import { apply, createGame, legalCommands, viewFor, type Command, type GameState, type PlayerId } from '@fftcg/engine'
     3	import { GreedyAgent, type SearchDiagnostics, type SearchResult } from '@fftcg/ai'
     4	import { CARD_DEFS, DECKS } from '../src/deck.js'
     5	import { AI, HUMAN } from '../src/game/types.js'
     6	import type { WorkerRequestMessage, WorkerResponseMessage, WorkerSearchRequest } from '../src/game/search/protocol.js'
     7	import {
     8	  FALLBACK_WARNING, SearchCoordinator, searchSeed, workerTransport,
     9	  type Clock, type SearchRequestHandlers, type SearchTransport, type SearchTransportFactory, type TransportHandlers,
    10	} from '../src/game/search/coordinator.js'
    11	
    12	const GAME_SEED = 4242
    13	const STEP_MS = 600
    14	const WATCHDOG_MS = 5_000
    15	const STARTUP_WATCHDOG_MS = 10_000
    16	
    17	// ---------------------------------------------------------------------------
    18	// Fixtures
    19	// ---------------------------------------------------------------------------
    20	
    21	const actorOf = (state: GameState): PlayerId | null => (state.result ? null : (state.pending?.player ?? state.priority))
    22	
    23	/** Fast-forward a real game to a position the AI actually owns — the only kind the coordinator may be asked for. */
    24	function aiToAct(seed: number): GameState {
    25	  let state: GameState = createGame({ seed, decks: DECKS, defs: CARD_DEFS })
    26	  const agent = new GreedyAgent({ seed, decks: DECKS, depth: 1 })
    27	  for (let i = 0; i < 400; i++) {
    28	    const p = actorOf(state)
    29	    if (p === null) break
    30	    if (p === AI) return state
    31	    state = apply(state, agent.decide(viewFor(state, p), legalCommands(state, p))).state
    32	  }
    33	  throw new Error(`seed ${seed} never reached an AI decision`)
    34	}
    35	
    36	function humanToAct(seed: number): GameState {
    37	  let state: GameState = createGame({ seed, decks: DECKS, defs: CARD_DEFS })
    38	  const agent = new GreedyAgent({ seed, decks: DECKS, depth: 1 })
    39	  for (let i = 0; i < 400; i++) {
    40	    const p = actorOf(state)
    41	    if (p === null) break
    42	    if (p === HUMAN) return state
    43	    state = apply(state, agent.decide(viewFor(state, p), legalCommands(state, p))).state
    44	  }
    45	  throw new Error(`seed ${seed} never reached a human decision`)
    46	}
    47	
    48	const EMPTY_DIAGNOSTICS: SearchDiagnostics = {
    49	  determinisations: 1, treeApplies: 1, rolloutApplies: 1, evaluations: 1, nodes: 1, maxCommandDepth: 1, rootChildren: [],
    50	}
    51	
    52	/** A worker reply for `state`, carrying a command that really is legal there so nothing downstream is faked. */
    53	function resultFor(state: GameState, requestId: number): WorkerResponseMessage {
    54	  const command = legalCommands(state, AI)[0]
    55	  if (!command) throw new Error('no legal AI command')
    56	  const result: SearchResult = { command, diagnostics: EMPTY_DIAGNOSTICS }
    57	  return { type: 'result', requestId, result }
    58	}
    59	
    60	class FakeClock implements Clock {
    61	  private t = 0
    62	  private seq = 0
    63	  private readonly timers = new Map<number, { at: number; fn: () => void }>()
    64	
    65	  now(): number { return this.t }
    66	
    67	  after(ms: number, fn: () => void): () => void {
    68	    const id = ++this.seq
    69	    this.timers.set(id, { at: this.t + ms, fn })
    70	    return () => { this.timers.delete(id) }
    71	  }
    72	
    73	  get armed(): number { return this.timers.size }
    74	
    75	  advance(ms: number): void {
    76	    const target = this.t + ms
    77	    for (;;) {
    78	      let pickId = -1
    79	      let pickAt = Number.POSITIVE_INFINITY
    80	      for (const [id, timer] of this.timers) {
    81	        if (timer.at <= target && (timer.at < pickAt || (timer.at === pickAt && id < pickId))) { pickAt = timer.at; pickId = id }
    82	      }
    83	      const timer = pickId < 0 ? undefined : this.timers.get(pickId)
    84	      if (!timer) break
    85	      this.timers.delete(pickId)
    86	      this.t = timer.at
    87	      timer.fn()
    88	    }
    89	    this.t = target
    90	  }
    91	}
    92	
    93	class FakeTransport implements SearchTransport {
    94	  readonly sent: WorkerRequestMessage[] = []
    95	  terminations = 0
    96	  postThrows: string | null = null
    97	  constructor(readonly handlers: TransportHandlers) {}
    98	
    99	  post(message: WorkerRequestMessage): void {
   100	    if (this.postThrows !== null) throw new DOMException(this.postThrows, 'DataCloneError')
   101	    this.sent.push(message)
   102	  }
   103	
   104	  terminate(): void { this.terminations++ }
   105	
   106	  get searches(): WorkerSearchRequest[] {
   107	    return this.sent.filter((m): m is WorkerSearchRequest => m.type === 'search')
   108	  }
   109	}
   110	
   111	interface Harness {
   112	  readonly clock: FakeClock
   113	  readonly coordinator: SearchCoordinator
   114	  readonly transports: FakeTransport[]
   115	  readonly delivered: { command: Command; state: GameState }[]
   116	  readonly warnings: string[]
   117	  readonly handlers: SearchRequestHandlers
   118	  readonly transport: () => FakeTransport
   119	  readState(): GameState
   120	  setState(state: GameState): void
   121	  setCommit(v: boolean): void
   122	}
   123	
   124	function harness(opts: { seed?: number; factory?: SearchTransportFactory; onCreate?: (t: FakeTransport) => void } = {}): Harness {
   125	  const clock = new FakeClock()
   126	  const transports: FakeTransport[] = []
   127	  const delivered: { command: Command; state: GameState }[] = []
   128	  const warnings: string[] = []
   129	  let current = aiToAct(opts.seed ?? 11)
   130	  let commits = true
   131	
   132	  const handlers: SearchRequestHandlers = {
   133	    onCommand: (command, forState) => { delivered.push({ command, state: forState }); return commits },
   134	    onWarning: (text) => { warnings.push(text) },
   135	  }
   136	  const factory: SearchTransportFactory = opts.factory ?? ((h) => {
   137	    const t = new FakeTransport(h)
   138	    transports.push(t)
   139	    opts.onCreate?.(t)
   140	    return t
   141	  })
   142	  const coordinator = new SearchCoordinator({
   143	    decks: DECKS,
   144	    gameSeed: GAME_SEED,
   145	    readState: () => current,
   146	    stepMs: STEP_MS,
   147	    iterations: 25,
   148	    rolloutCommandCap: 8,
   149	    explorationC: 1,
   150	    watchdogMs: WATCHDOG_MS,
   151	    startupWatchdogMs: STARTUP_WATCHDOG_MS,
   152	    createTransport: factory,
   153	    clock,
   154	  })
   155	  return {
   156	    clock, coordinator, transports, delivered, warnings, handlers,
   157	    transport: () => { const t = transports[0]; if (!t) throw new Error('no transport was created'); return t },
   158	    readState: () => current,
   159	    setState: (s) => { current = s },
   160	    setCommit: (v) => { commits = v },
   161	  }
   162	}
   163	
   164	/** The whole point of the fallback: whatever went wrong, a command still arrives on the same deadline. */
   165	function expectOneWarningAndACommand(h: Harness): void {
   166	  expect(h.delivered).toHaveLength(0)
   167	  h.clock.advance(STEP_MS)
   168	  expect(h.delivered).toHaveLength(1)
   169	  expect(h.warnings).toHaveLength(1)
   170	  expect(h.warnings[0]).toContain(FALLBACK_WARNING)
   171	  expect(h.coordinator.usingFallback).toBe(true)
   172	  const only = h.delivered[0]
   173	  if (!only) throw new Error('unreachable')
   174	  expect(legalCommands(only.state, AI).some((c) => c.type === only.command.type)).toBe(true)
   175	}
   176	
   177	// ---------------------------------------------------------------------------
   178	
   179	describe('searchSeed (D2-3)', () => {
   180	  it('is a pure function of (gameSeed, decisionIndex)', () => {
   181	    expect(searchSeed(7, 3)).toBe(searchSeed(7, 3))
   182	    expect(searchSeed(7, 3)).not.toBe(searchSeed(7, 4))
   183	    expect(searchSeed(7, 3)).not.toBe(searchSeed(8, 3))
   184	  })
   185	
   186	  it('stays a non-negative 32-bit integer', () => {
   187	    for (const [seed, index] of [[0, 0], [-1, 5], [2_147_483_646, 199], [Date.now() % 2_147_483_647, 12]] as const) {
   188	      const s = searchSeed(seed, index)
   189	      expect(Number.isSafeInteger(s)).toBe(true)
   190	      expect(s).toBeGreaterThanOrEqual(0)
   191	      expect(s).toBeLessThanOrEqual(0xffff_ffff)
   192	    }
   193	  })
   194	})
   195	
   196	describe('SearchCoordinator: seeds are per POSITION (D2-3)', () => {
   197	  it('asks the same position twice with the same seed', () => {
   198	    const h = harness()
   199	    h.coordinator.request(h.readState(), h.handlers)
   200	    // StrictMode's cleanup+setup, a retry and a superseded request all look like this.
   201	    h.coordinator.invalidate()
   202	    h.coordinator.request(h.readState(), h.handlers)
   203	
   204	    const searches = h.transport().searches
   205	    expect(searches).toHaveLength(2)
   206	    expect(searches[0]?.seed).toBe(searches[1]?.seed)
   207	    expect(searches[0]?.seed).toBe(searchSeed(GAME_SEED, 0))
   208	    // The correlation ids must still differ, or a stale reply could not be told apart.
   209	    expect(searches[0]?.requestId).not.toBe(searches[1]?.requestId)
   210	  })

exec
/bin/zsh -lc "nl -ba packages/ai/src/ismcts/keys.ts | sed -n '460,530p'" in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
   460	  const at = view.attack
   461	  // The root's own hand is a MULTISET of codes: hand position is not observable to anyone (`h:` refs are by
   462	  // code and occurrence), so two worlds that drew the same cards in a different order are the same information set.
   463	  const hand = view.hand.map((id) => view.cards[id]?.code ?? OPAQUE).sort(cmpStr).join(',')
   464	  return [
   465	    `me${view.me}`, `t${view.turn}`, `tp${view.turnPlayer}`, view.phase, `pr${view.priority}`,
   466	    `fp${view.firstPlayer}`, `mu${view.mulliganDecided.map((b) => (b ? 1 : 0)).join('')}`,
   467	    `end:${view.result === null ? '-' : `${view.result.winner ?? 'draw'}/${view.result.reason}`}`,
   468	    `hand[${hand}]`,
   469	    `F0:${fieldDigest(view, 0)}`,
   470	    `F1:${fieldDigest(view, 1)}`,
   471	    `atk:${at === null ? '-' : `${at.step}/${joinRefs(at.attackers.map(r))}/${at.blocker === null ? '-' : r(at.blocker)}`}`,
   472	    `pend:${pendingDigest(view, view.pending)}`,
   473	    `res:${resolutionDigest(view, view.resolution)}`,
   474	  ].join(FIELD)
   475	}
   476	
   477	/** Pins the implementations to the documented contract — a signature drift stops compiling here. */
   478	export const KEY_CONTRACT: KeyContract = { cardRef, actionKey, observationKey, decodeAction }
   479	
   480	// ---------------------------------------------------------------------------
   481	// The worker-safe search seam (spec D-7)
   482	// ---------------------------------------------------------------------------
   483	
   484	/**
   485	 * Everything the search needs, and nothing it must not have (spec D-9). There is deliberately no
   486	 * `GameState` here: the search derives every simulated world from a `PlayerView` plus the two publicly
   487	 * declared deck lists, so it cannot read the live game even by accident.
   488	 *
   489	 * Structured-cloneable by construction, so D2 can post it to a Web Worker unchanged.
   490	 */
   491	export interface SearchInput {
   492	  readonly view: PlayerView
   493	  /** Both players' publicly declared lists. Semantically a MULTISET — sort a copy before sampling. */
   494	  readonly decks: readonly [readonly string[], readonly string[]]
   495	  readonly iterations: number
   496	  /** Seeds the world sampling, expansion and tie-breaking streams — kept separate (spec D-8). */
   497	  readonly seed: number
   498	  readonly rolloutCommandCap: number
   499	  readonly explorationC: number
   500	}
   501	
   502	/** Counters that make cost measurable rather than guessed (spec D-A4). */
   503	export interface SearchDiagnostics {
   504	  readonly determinisations: number
   505	  readonly treeApplies: number
   506	  readonly rolloutApplies: number
   507	  readonly evaluations: number
   508	  readonly nodes: number
   509	  readonly maxCommandDepth: number
   510	  /** Root children as `[ActionKey, visits, meanReward]`, best first — the search's own explanation. */
   511	  readonly rootChildren: readonly (readonly [ActionKey, number, number])[]
   512	}
   513	
   514	export interface SearchResult {
   515	  readonly command: Command
   516	  readonly diagnostics: SearchDiagnostics
   517	}

exec
/bin/zsh -lc 'nl -ba packages/ai/src/agent.ts' in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
     1	import { nextInt, seedRng, type Command, type PlayerView, type Rng } from '@fftcg/engine'
     2	
     3	export interface Agent {
     4	  decide(view: PlayerView, legal: Command[]): Command
     5	  /**
     6	   * Whether `decide` needs the caller to pass a real `legal` array. `RandomAgent` picks uniformly among the
     7	   * legal commands, so it always needs them (`true`, the default when unset). `GreedyAgent` scores its own
     8	   * `candidateCommands` and computes `legalCommands` itself only in its fallback branch, so callers may pass
     9	   * `[]` and skip that generation cost on the hot path.
    10	   */
    11	  needsLegalCommands?: boolean
    12	}
    13	
    14	export class RandomAgent implements Agent {
    15	  private rng: Rng
    16	  readonly needsLegalCommands = true
    17	  constructor(seed: number) { this.rng = seedRng(seed) }
    18	  decide(_view: PlayerView, legal: Command[]): Command {
    19	    const options = legal.filter((c) => c.type !== 'concede')
    20	    const pool = options.length ? options : legal
    21	    if (!pool.length) throw new Error('no legal commands')
    22	    const [i, next] = nextInt(this.rng, pool.length)
    23	    this.rng = next
    24	    return pool[i] as Command
    25	  }
    26	}

exec
/bin/zsh -lc "nl -ba packages/engine/src/legal.ts | sed -n '1,100p'" in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
     1	import type { PlayerId } from './types.js'
     2	import type { GameState } from './state.js'
     3	import { defOf } from './state.js'
     4	import type { Command } from './commands.js'
     5	import { enumeratePayments } from './cp.js'
     6	import { castCheck } from './cast.js'
     7	import { legalAttackSets, legalBlockers, legalPartyDamageAssignments } from './attack.js'
     8	
     9	export function actingPlayer(state: GameState): PlayerId | null {
    10	  if (state.result) return null
    11	  return state.pending?.player ?? state.priority
    12	}
    13	
    14	function combinations<T>(items: T[], k: number): T[][] {
    15	  if (k === 0) return [[]]
    16	  return items.flatMap((x, i) => combinations(items.slice(i + 1), k - 1).map((rest) => [x, ...rest]))
    17	}
    18	
    19	export function legalCommands(state: GameState, player: PlayerId): Command[] {
    20	  if (state.result) return []
    21	  const out: Command[] = [{ type: 'concede', player }]   // §2.1: always allowed
    22	  if (actingPlayer(state) !== player) return out
    23	  const pending = state.pending
    24	  if (pending) {
    25	    switch (pending.kind) {
    26	      case 'chooseFirst':
    27	        out.push({ type: 'chooseFirst', player, goFirst: true }, { type: 'chooseFirst', player, goFirst: false }); break
    28	      case 'mulligan':
    29	        out.push({ type: 'mulligan', player, redraw: false }, { type: 'mulligan', player, redraw: true }); break
    30	      case 'discardToHandSize':
    31	        for (const cards of combinations(state.players[player].hand, pending.count)) out.push({ type: 'discardToHandSize', player, cards })
    32	        break
    33	      case 'declareBlock':
    34	        out.push({ type: 'declareBlock', player, blocker: null })
    35	        for (const blocker of legalBlockers(state, player)) out.push({ type: 'declareBlock', player, blocker })
    36	        break
    37	      case 'assignPartyDamage':
    38	        for (const assignments of legalPartyDamageAssignments(state)) out.push({ type: 'assignPartyDamage', player, assignments })
    39	        break
    40	      case 'chooseTargets':
    41	        // Σ C(N, k) for k in min..max. `max` is the printed "up to N" (≤ 2 everywhere in the C1 pool) and N is
    42	        // one zone of one or both fields, so the bound is ~C(20,2) = 190 commands. A clause printing "up to 4"
    43	        // over a large Break Zone would need a candidate cap here — spec C1-6 flagged the combinatorics.
    44	        for (let k = pending.min; k <= pending.max; k++) {
    45	          for (const targets of combinations([...pending.candidates], k)) out.push({ type: 'chooseTargets', player, targets })
    46	        }
    47	        break
    48	      case 'chooseMode':
    49	        // Σ C(modes, k). `modes` is a printed list of 2–3, so this is a handful of commands.
    50	        for (let k = pending.min; k <= pending.max; k++) {
    51	          for (const modes of combinations(pending.labels.map((_, i) => i), k)) out.push({ type: 'chooseMode', player, modes })
    52	        }
    53	        break
    54	    }
    55	    return out
    56	  }
    57	  switch (state.phase) {
    58	    case 'main1':
    59	    case 'main2': {
    60	      for (const card of state.players[player].hand) {
    61	        if (castCheck(state, player, card) !== null) continue
    62	        const type = defOf(state, card).type === 'summon' ? 'castSummon' : 'castCharacter'
    63	        for (const payment of enumeratePayments(state, player, card)) out.push({ type, player, card, payment })
    64	      }
    65	      out.push({ type: 'pass', player })
    66	      break
    67	    }
    68	    case 'attack': {
    69	      if (state.attack?.step === 'declaration') {
    70	        for (const attackers of legalAttackSets(state, player)) out.push({ type: 'declareAttack', player, attackers })
    71	        out.push({ type: 'pass', player })
    72	      }
    73	      break
    74	    }
    75	    default:
    76	      break   // setup/active/draw/end never wait for a non-pending command
    77	  }
    78	  return out
    79	}

codex
The first pass exposes an important invariant to challenge: a request is not marked active until after both posts return, while failure callbacks already exist. I’m checking whether any browser-observable event can exploit that window, and separately whether accepted results remain safe during their 600 ms delivery wait and through React’s cleanup ordering.
exec
/bin/zsh -lc 'cat package.json && cat apps/web/package.json' in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
{
  "name": "fftcg-game",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@11.20.0",
  "engines": { "node": ">=22" },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -b packages/engine packages/cards packages/ai apps/cli apps/web",
    "lint": "eslint ."
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "eslint": "^9.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "typescript-eslint": "^8.0.0",
    "vitest": "^3.0.0"
  }
}
{
  "name": "@fftcg/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "fetch-images": "tsx scripts/fetch-images.ts"
  },
  "dependencies": {
    "@fftcg/ai": "workspace:*",
    "@fftcg/cards": "workspace:*",
    "@fftcg/engine": "workspace:*",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^5.0.0",
    "vite": "^7.0.0"
  }
}

exec
/bin/zsh -lc "rg -n \"aiHandlers|createAiSearch|restart\\(|StrictMode|aiThinking\" apps/web/test apps/web/src -g '*.test.ts' -g '*.test.tsx' -g '*.ts' -g '*.tsx'" in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
apps/web/test/useGame.test.ts:20:  AI_STEP_MS, aiHandlers, createAiSearch, describeEvent, eventLines, narrator, stepAi,
apps/web/test/useGame.test.ts:642:  const game: GameApi = { view, choices, log: [], aiThinking: false, choose: () => undefined, restart: () => undefined }
apps/web/test/useGame.test.ts:710:// seam the effect installs — `createAiSearch` + `aiHandlers` — which is the whole of the hook's AI behaviour
apps/web/test/useGame.test.ts:787:  readonly handlers: ReturnType<typeof aiHandlers>
apps/web/test/useGame.test.ts:811:    handlers: aiHandlers(sink),
apps/web/test/useGame.test.ts:812:    search: createAiSearch(() => current, seed, { clock, createTransport }),
apps/web/test/useGame.test.ts:856:    h.search.restart(99)
apps/web/test/useGame.test.ts:876:    h.search.restart(99)
apps/web/src/game/useGame.ts:259:export function aiHandlers(sink: AiSink): SearchRequestHandlers {
apps/web/src/game/useGame.ts:288:  restart(seed: number): void
apps/web/src/game/useGame.ts:297: * Built lazily, and rebuilt after `dispose`, because StrictMode's mount→unmount→mount tears the coordinator
apps/web/src/game/useGame.ts:301:export function createAiSearch(readState: () => GameState, seed: number, seams: SearchSeams = {}): AiSearch {
apps/web/src/game/useGame.ts:327:  // Lazy for the same reason the game itself is: `useRef(createAiSearch(...))` would build one every render.
apps/web/src/game/useGame.ts:328:  searchRef.current ??= createAiSearch(() => stateRef.current, seedRef.current)
apps/web/src/game/useGame.ts:330:  const [aiThinking, setAiThinking] = useState(false)
apps/web/src/game/useGame.ts:339:  const handlers = useMemo(() => aiHandlers({ commit, log: appendLog }), [commit, appendLog])
apps/web/src/game/useGame.ts:365:    searchRef.current?.restart(next)
apps/web/src/game/useGame.ts:373:  // cleanup invalidates synchronously, so StrictMode's mount→unmount→mount double-invoke discards the first
apps/web/src/game/useGame.ts:387:  return { view, choices, log, aiThinking, choose, restart }
apps/web/src/game/types.ts:46:  aiThinking: boolean
apps/web/src/game/types.ts:50:  restart(): void
apps/web/test/search-coordinator.test.ts:200:    // StrictMode's cleanup+setup, a retry and a superseded request all look like this.
apps/web/test/search-coordinator.test.ts:286:    // `restart()` replaces `stateRef.current` and invalidates — but the reply is already on its way.
apps/web/src/ui/PromptStrip.tsx:29:export function PromptStrip({ view, choices, shown, aiThinking, onChoose }: {
apps/web/src/ui/PromptStrip.tsx:33:  aiThinking: boolean
apps/web/src/ui/PromptStrip.tsx:47:    : aiThinking ? 'The AI is thinking'
apps/web/src/ui/PromptStrip.tsx:59:        {aiThinking && <span className="thinking" aria-hidden="true"><span /><span /><span /></span>}
apps/web/src/main.tsx:1:import { StrictMode } from 'react'
apps/web/src/main.tsx:9:  <StrictMode>
apps/web/src/main.tsx:11:  </StrictMode>,
apps/web/src/game/search/coordinator.ts:71: * request, so StrictMode's double-invoke, a retry, a superseded request and a replaced worker all re-ask the
apps/web/src/ui/Board.tsx:109:  const { view, choices, log, aiThinking, choose, restart } = game
apps/web/src/ui/Board.tsx:169:      <PromptStrip view={view} choices={choices} shown={shown} aiThinking={aiThinking} onChoose={(c) => { setSelected(null); choose(c) }} />

exec
/bin/zsh -lc "rg -n \"class GreedyAgent|decide\\(\" packages/ai/src && nl -ba packages/ai/src/greedy.ts | sed -n '1,260p'" in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
packages/ai/src/greedy.ts:202:export class GreedyAgent implements Agent {
packages/ai/src/greedy.ts:219:  decide(view: PlayerView, legal: Command[]): Command {
packages/ai/src/agent.ts:4:  decide(view: PlayerView, legal: Command[]): Command
packages/ai/src/agent.ts:18:  decide(_view: PlayerView, legal: Command[]): Command {
packages/ai/src/ismcts/agent.ts:55:  decide(view: PlayerView, legal: Command[]): Command {
     1	import { SYNTHETIC_ID_BASE, actingPlayer, apply, determinise, hasResolutionWork, legalCommands, seedRng, type CardId, type Command, type GameState, type PlayerId, type PlayerView, type Rng } from '@fftcg/engine'
     2	import type { Agent } from './agent.js'
     3	import { candidateCommands } from './candidates.js'
     4	import { DEFAULT_WEIGHTS, evaluate, type Weights } from './evaluate.js'
     5	
     6	export interface GreedyOptions {
     7	  seed: number
     8	  decks: [string[], string[]]
     9	  depth?: 0 | 1 | 2 | undefined
    10	  weights?: Weights | undefined
    11	  aggression?: number | undefined
    12	  /**
    13	   * Soft cap on the number of `apply()` calls spent on the *rollout* portion of scoring one candidate. Each
    14	   * candidate gets its own fresh budget, `perCandidate = max(1, floor(maxSimulations / candidates))`, so scoring
    15	   * is invariant under candidate reordering (C1) — a shared budget would let early candidates starve later ones.
    16	   * The top-level apply and the forced-decision resolution that follows it (`resolveForcedDecisions` — combat and
    17	   * ability resolution alike) are exempt from the cap — they always run to completion (W1) — but their applies
    18	   * still count against the budget, so the rollout loop that follows may already be over cap before it starts.
    19	   * `lastSimulations` sums `used` across all per-candidate budgets.
    20	   *
    21	   * R3: this is a SOFT cap with no closed-form bound on `lastSimulations`. Budget-exempt combat resolution and
    22	   * `greedyStep`'s always-score-the-first-candidate floor both overrun it by an amount that depends on the
    23	   * position — a declareAttack at `maxSimulations: 50` was measured at 107 applies, so the bound this comment
    24	   * previously claimed (`<= maxSimulations + lastCandidates`) is false. What the cap does guarantee is EQUAL
    25	   * allocation across candidates (hence order-invariant scoring, C1) and proportionally more search as it rises.
    26	   * A tight bound would need the rollout and combat portions counted separately; not worth it while the A8
    27	   * budget (< 50 ms/decision) is met with ~200x headroom.
    28	   */
    29	  maxSimulations?: number | undefined
    30	}
    31	
    32	interface Budget { used: number; cap: number }
    33	const within = (b: Budget | undefined): boolean => !b || b.used < b.cap
    34	
    35	/**
    36	 * The decisions that are part of finishing something already started, rather than a move of one's own: the two
    37	 * combat steps, and (rung C1) the choices a resolving ability suspends on. `evaluate` may never see a state
    38	 * owing one of these — a half-resolved attack prices an attack that dealt no damage (R4), and a half-resolved
    39	 * ability prices an ability that did nothing (the same defect class, arriving by the new route).
    40	 *
    41	 * C2-6 opens a THIRD route to the same defect and it is the reason for the second clause. `drainResolution` now
    42	 * completes ONE frame and yields, so `settle` interleaves §12.3 rule processes between frames — and a rule
    43	 * process can enqueue an observer trigger (spec C2-4) BEHIND a decision that is already on the table. Settlement
    44	 * then stops on a pending that is not one of the four, with frames still queued, and `evaluate` would price a
    45	 * board whose queued clause has not done its work. So: the four kinds are forced unconditionally, and every
    46	 * OTHER kind is forced exactly while the agenda still owes something. Setup choices (`mulligan`, `chooseFirst`)
    47	 * are unaffected — nothing is ever queued during setup — so they stay the agent's own move to score.
    48	 */
    49	const isForcedDecision = (state: GameState): boolean => {
    50	  const kind = state.pending?.kind
    51	  if (kind === undefined) return false
    52	  if (kind === 'declareBlock' || kind === 'assignPartyDamage' || kind === 'chooseTargets' || kind === 'chooseMode') return true
    53	  return hasResolutionWork(state.resolution)
    54	}
    55	
    56	/**
    57	 * Fast-forward through every forced decision: while one is pending, the acting player `p` answers with
    58	 * `greedyStep`, scored from `p === perspective ? aggression : 1 - aggression` (C4 — keyed on the explicit
    59	 * `perspective` player, not `state.turnPlayer`, so the agent's own defensive decisions are scored from its own
    60	 * viewpoint even though the attacker holds `turnPlayer`/priority throughout the Attack Phase). Never exits early
    61	 * because the budget is exhausted (W1) — every apply here still counts against it, but a combat and an ability
    62	 * always run to completion.
    63	 *
    64	 * Terminates: the combat kinds strictly advance the attack (a block decision, then optionally a party-damage
    65	 * split, then neither), and an ability choice strictly advances its frame's program counter — `resolution.steps`
    66	 * persists across choices precisely so a clause that never finishes hits `MAX_RESOLUTION_STEPS` and throws
    67	 * (spec C1-5) rather than spinning here. The C2-6 clause of `isForcedDecision` adds no new way to spin: it only
    68	 * ever fires while the agenda is non-empty, and answering the pending lets `settle` drain a frame, so each pass
    69	 * either shrinks the agenda or hits the step cap.
    70	 */
    71	export function resolveForcedDecisions(state: GameState, weights: Weights, aggression: number, perspective: PlayerId, budget?: Budget): GameState {
    72	  let s = state
    73	  while (!s.result && isForcedDecision(s)) {
    74	    const p = actingPlayer(s)
    75	    if (p === null) break
    76	    const localAggression = p === perspective ? aggression : 1 - aggression
    77	    const c = greedyStep(s, p, weights, localAggression, budget)
    78	    if (!c) break
    79	    s = apply(s, c).state
    80	    if (budget) budget.used++
    81	  }
    82	  return s
    83	}
    84	
    85	/**
    86	 * Score every legal command for `player` and return the best one (ties keep the earlier candidate). Always
    87	 * guarantees at least the first candidate is applied and scored, even with an exhausted budget (W1) — only
    88	 * subsequent candidates are gated by `within(budget)`. Every candidate is scored on `resolveForcedDecisions(apply(state,
    89	 * c).state, weights, aggression, player, budget)` — `player` doubles as the perspective, so a nested call here
    90	 * (e.g. scoring a `declareBlock` candidate from inside `resolveForcedDecisions`'s own loop) resolves that candidate's
    91	 * combat all the way through (a party's damage split included, W2) before it is evaluated, not on the mid-combat
    92	 * snapshot taken the instant it is applied. The recursion this creates is bounded: each pending kind strictly
    93	 * advances the attack, so a block decision recurses into at most one further (party-damage) decision.
    94	 */
    95	export function greedyStep(state: GameState, player: PlayerId, weights: Weights, aggression: number, budget?: Budget): Command | null {
    96	  let best: Command | null = null
    97	  let bestScore = -Infinity
    98	  let i = 0
    99	  for (const c of candidateCommands(state, player)) {
   100	    if (i > 0 && !within(budget)) break
   101	    i++
   102	    const after = apply(state, c).state
   103	    if (budget) budget.used++
   104	    const scored = resolveForcedDecisions(after, weights, aggression, player, budget)
   105	    const score = evaluate(scored, player, weights, aggression)
   106	    if (score > bestScore) { best = c; bestScore = score }
   107	  }
   108	  return best
   109	}
   110	
   111	/** Deterministically keep only the first `max` candidates, but always keep `pass` (moved to the end) if it was present. */
   112	export function pruneCandidates(cands: Command[], max: number): Command[] {
   113	  if (cands.length <= max) return cands
   114	  const passIdx = cands.findIndex((c) => c.type === 'pass')
   115	  if (passIdx === -1 || passIdx < max) return cands.slice(0, max)
   116	  return [...cands.slice(0, max - 1), cands[passIdx] as Command]
   117	}
   118	
   119	export interface CandidateScoreOptions {
   120	  me: PlayerId
   121	  weights: Weights
   122	  aggression: number
   123	  depth: 0 | 1 | 2
   124	  owner: PlayerId
   125	  maxSimulations: number
   126	}
   127	
   128	export interface CandidateScore {
   129	  command: Command; score: number; turn: number; used: number
   130	  /** R4 diagnostic: the pending kind of the state that was actually scored. It must never be a FORCED decision
   131	   *  (`isForcedDecision`) — that would mean `evaluate` priced a mid-combat snapshot or a half-resolved ability,
   132	   *  which inverts the value of an attack. It is routinely non-null otherwise: `mulligan`, `chooseFirst` and
   133	   *  `discardToHandSize` show up on scored states in normal play (measured across 66,350 decisions) and are
   134	   *  priced correctly. Exposed so the real invariant is directly assertable rather than inferred from a score. */
   135	  pendingKind: string | null
   136	  /** The C1 half of the same diagnostic: work still on the resolution agenda (active + queued + continuation).
   137	   *  MUST be 0 — a scored state with an unfinished ability prices a clause that has not done its work yet.
   138	   *  C2-6 couples the two fields: the benign non-null `pendingKind`s above are benign ONLY at a zero agenda, and
   139	   *  `isForcedDecision`'s second clause is what keeps that true now that rule processes run between frames. */
   140	  resolutionQueued: number
   141	}
   142	
   143	/** Work the agenda still owes: the active frame, the queue, and a system continuation (which only
   144	 *  `drainResolution` consumes, so a state carrying nothing but one is NOT settled). Zero on a settled state. */
   145	const agendaSize = (s: GameState): number =>
   146	  (s.resolution.active ? 1 : 0) + s.resolution.queue.length + (s.resolution.continuation ? 1 : 0)
   147	
   148	/**
   149	 * Score every top-level candidate independently (C1): each gets its own fresh `Budget` sized
   150	 * `max(1, floor(maxSimulations / cands.length))`, so the result — and therefore the argmax `decide` picks — is
   151	 * invariant under the order `cands` is given in (a shared budget is not: early candidates would consume rollout
   152	 * work that later ones then lack). For each candidate: apply it and fully resolve every forced decision it opens
   153	 * — combat and ability resolution alike (both exempt from the budget cap, W1); then, per `depth`, roll out greedily to the end of the acting turn owner's
   154	 * turn (depth >= 1) and/or the following turn (depth >= 2), bounded by the budget. `turn` records the scored
   155	 * state's turn number (for asserting where a rollout stopped); `used` is that candidate's own budget spend.
   156	 */
   157	export function scoreCandidates(det: GameState, cands: Command[], opts: CandidateScoreOptions): CandidateScore[] {
   158	  const perCandidate = Math.max(1, Math.floor(opts.maxSimulations / cands.length))
   159	  return cands.map((cand) => {
   160	    const budget: Budget = { used: 0, cap: perCandidate }
   161	    let s = apply(det, cand).state
   162	    budget.used++   // floor: every candidate gets at least one apply regardless of budget
   163	    s = resolveForcedDecisions(s, opts.weights, opts.aggression, opts.me, budget)
   164	    const rollout = (until: (t: GameState) => boolean) => {
   165	      while (!s.result && until(s) && within(budget)) {
   166	        const p = actingPlayer(s)!
   167	        const c = greedyStep(s, p, opts.weights, p === opts.me ? opts.aggression : 1 - opts.aggression, budget)
   168	        if (!c) break
   169	        s = apply(s, c).state; budget.used++
   170	        // R4: resolve whatever this command opened BEFORE the loop can exit on an exhausted budget. Without
   171	        // this, a rollout that declares an attack and then runs out of budget leaves `pending: declareBlock`
   172	        // set, and `evaluate` prices a state where the attack was declared but no damage was dealt — which
   173	        // inverts an attack's value. C1 adds the same hazard by a second route: a cast that triggers an ETB
   174	        // clause leaves `pending: chooseMode`/`chooseTargets`, and the ability's effect is priced as nothing.
   175	        // Both are budget-exempt (W1) precisely so this always completes.
   176	        s = resolveForcedDecisions(s, opts.weights, opts.aggression, opts.me, budget)
   177	      }
   178	    }
   179	    if (opts.depth >= 1) rollout((t) => t.turnPlayer === opts.owner)   // finish the current turn (mine, or the opponent's when I am blocking)
   180	    if (opts.depth >= 2) rollout((t) => t.turnPlayer !== opts.owner)   // and the following turn
   181	    const score = evaluate(s, opts.me, opts.weights, opts.aggression)
   182	    return { command: cand, score, turn: s.turn, used: budget.used, pendingKind: s.pending?.kind ?? null, resolutionQueued: agendaSize(s) }
   183	  })
   184	}
   185	
   186	/** All `CardId`s a command references — used by `decide`'s W4 guard to reject a chosen command that leaked a synthetic id. */
   187	function commandCardIds(c: Command): CardId[] {
   188	  switch (c.type) {
   189	    case 'castCharacter': case 'castSummon': return [c.card, ...c.payment.dullBackups, ...c.payment.discards.map((d) => d.card)]
   190	    case 'declareAttack': return c.attackers
   191	    case 'declareBlock': return c.blocker === null ? [] : [c.blocker]
   192	    case 'assignPartyDamage': return c.assignments.map((a) => a.target)
   193	    case 'discardToHandSize': return c.cards
   194	    // C1: ability targets are card ids like any other. `chooseMode` answers are indices into the pending's
   195	    // printed labels, not ids, so it has none to check.
   196	    case 'chooseTargets': return [...c.targets]
   197	    case 'chooseFirst': case 'mulligan': case 'chooseMode': case 'pass': case 'concede': return []
   198	    default: { const _exhaustive: never = c; return _exhaustive }
   199	  }
   200	}
   201	
   202	export class GreedyAgent implements Agent {
   203	  private rng: Rng
   204	  private readonly decks: [string[], string[]]
   205	  private readonly depth: 0 | 1 | 2
   206	  private readonly weights: Weights
   207	  private readonly aggression: number
   208	  private readonly maxSimulations: number
   209	  lastSimulations = 0
   210	  lastCandidates = 0
   211	  lastDepth: 0 | 1 | 2 = 0
   212	  /** Test/diagnostic hook: each top-level candidate's final score, resolved-state turn number, and budget spend from the most recent `decide`. */
   213	  lastScores: CandidateScore[] = []
   214	  readonly needsLegalCommands = false
   215	  constructor(opts: GreedyOptions) {
   216	    this.rng = seedRng(opts.seed); this.decks = opts.decks; this.depth = opts.depth ?? 1
   217	    this.weights = opts.weights ?? DEFAULT_WEIGHTS; this.aggression = opts.aggression ?? 0.5; this.maxSimulations = opts.maxSimulations ?? 2000
   218	  }
   219	  decide(view: PlayerView, legal: Command[]): Command {
   220	    this.lastSimulations = 0; this.lastCandidates = 0; this.lastDepth = 0; this.lastScores = []
   221	    const me = view.me
   222	    const [det, rng] = determinise({ view, decks: this.decks, rng: this.rng })
   223	    this.rng = rng
   224	    let cands = candidateCommands(det, me)   // pass is last by contract
   225	    if (!cands.length) {
   226	      // R2: conceding is only ever the right answer when we are NOT the acting player — then [concede] genuinely
   227	      // is the whole legal set (§2.1). When we ARE acting and candidate generation produced nothing, that is a gap
   228	      // in `candidateCommands` (which mirrors `legalCommands`'s switch rather than deriving from it), and
   229	      // `legalCommands` puts concede first — so falling back to `pool[0]` would silently throw the game rather
   230	      // than surface the bug. Fail loudly instead, per 5e82a7e's "fail loudly on a dead end, don't silently
   231	      // concede" policy; a genuine engine dead end is caught by self-play's strict invariant check.
   232	      if (actingPlayer(det) === me) {
   233	        throw new Error(`GreedyAgent.decide: no candidate commands while acting in ${det.phase}/${det.attack?.step ?? '-'}/${det.pending?.kind ?? '-'}`)
   234	      }
   235	      // legal may be [] here (needsLegalCommands is false, so a caller may skip generating it on the hot
   236	      // path); compute it ourselves rather than relying on the argument, but reuse a non-empty one as-is.
   237	      const pool = legal.length ? legal : legalCommands(det, me)
   238	      const fallback = pool[0]
   239	      if (!fallback) throw new Error('GreedyAgent.decide: no legal command to choose or fall back to')
   240	      return fallback
   241	    }
   242	    cands = pruneCandidates(cands, Math.max(1, this.maxSimulations))
   243	    this.lastCandidates = cands.length
   244	    const atDeclaration = det.phase === 'attack' && det.attack?.step === 'declaration'
   245	    // F5: setup (chooseFirst/mulligan) is scored at depth 0 — evaluate() already prices hand quality directly.
   246	    const depth: 0 | 1 | 2 = det.phase === 'setup' ? 0 : atDeclaration ? (Math.max(this.depth, 2) as 2) : this.depth   // spec A2
   247	    const owner = det.turnPlayer
   248	    const scores = scoreCandidates(det, cands, { me, weights: this.weights, aggression: this.aggression, depth, owner, maxSimulations: this.maxSimulations })
   249	    let best = scores[0]!.command
   250	    let bestScore = -Infinity
   251	    for (const sc of scores) { if (sc.score > bestScore) { best = sc.command; bestScore = sc.score } }
   252	    this.lastSimulations = scores.reduce((n, sc) => n + sc.used, 0)
   253	    this.lastScores = scores
   254	    this.lastDepth = depth
   255	    // W4: candidates are built from `me`'s own resources in the determinised state, which are always real
   256	    // (visible) ids — a chosen command should never reference a hidden card's synthetic id.
   257	    for (const id of commandCardIds(best)) if (id >= SYNTHETIC_ID_BASE) throw new Error(`GreedyAgent.decide: chosen command ${best.type} references synthetic id ${id}`)
   258	    return best
   259	  }
   260	}

exec
/bin/zsh -lc "rg -n \"longtask|PerformanceEventTiming|requestAnimationFrame|postMessage duration|serialized size|patched.*Worker|5310|worker-DkZKnaJU|152 ms|240 ms\" . -g '"'!node_modules'"' -g '"'!dist'"'" in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
./docs/superpowers/specs/2026-08-27-rung-d2-search-worker.md:37:| D2-2 | **Decks and config at init; the view per request** | `PlayerView` carries `defs` by design and the UI needs them; the search already clones a state containing the same definitions once per determinisation, so one 18-card catalogue per request is not the dominant cost. Revision 1 called this "measured as negligible" — **it was not measured**; D2-A2 now reports the actual serialized size and posting duration, and `Omit<PlayerView,'defs'>` is revisited only if the catalogue materially grows. |
./docs/superpowers/specs/2026-08-27-rung-d2-search-worker.md:60:  request-post, response and commit; observe **`longtask` entries** (any reported entry is ≥ 50 ms by
./docs/superpowers/specs/2026-08-27-rung-d2-search-worker.md:61:  definition); record the **maximum `requestAnimationFrame` gap**; inject a harmless test button and record
./docs/superpowers/specs/2026-08-27-rung-d2-search-worker.md:63:  task, max frame gap, max input delay, and worker round-trip p50/p95 — plus the request's serialized size
./docs/superpowers/specs/2026-08-27-rung-d2-search-worker.md:105:Production preview (`vite build` + `vite preview`, port 5310), Chromium via Playwright, Apple Silicon
./docs/superpowers/specs/2026-08-27-rung-d2-search-worker.md:112:| Worker asset actually served | `GET /assets/worker-DkZKnaJU.js → 200` (hashed production chunk, 52.8 kB) |
./docs/superpowers/specs/2026-08-27-rung-d2-search-worker.md:114:| Worker round trip | **p50 152 ms, p95 240 ms, max 288 ms** |
./docs/superpowers/specs/2026-08-27-rung-d2-search-worker.md:115:| Main-thread `longtask` entries during those searches | **0** (any reported entry would be ≥ 50 ms) |
./docs/superpowers/specs/2026-08-27-rung-d2-search-worker.md:116:| Maximum `requestAnimationFrame` gap | **22 ms**, then **19 ms** |
./docs/superpowers/specs/2026-08-27-rung-d2-search-worker.md:118:| Search request serialized size | median **14.2 kB**, max 15.4 kB |
./docs/superpowers/specs/2026-08-27-rung-d2-search-worker.md:124:direct evidence the search never ran there. Zero `longtask` entries says the same thing from the other side.
./docs/superpowers/specs/2026-08-27-rung-d2-search-worker.md:128:input observed through `PerformanceEventTiming`.
./docs/superpowers/specs/2026-08-27-rung-d2-search-worker.md:138:**D2-A6: the budget does not need reducing.** Round trips of p50 152 ms / p95 240 ms bracket D1's headless
./docs/superpowers/plans/2026-08-27-rung-d2-search-worker.codex-review.md:62:- Observe `longtask` entries during those intervals; any reported entry is at least 50 ms by definition ([Long Tasks API](https://www.w3.org/TR/longtasks-1/)).
./docs/superpowers/plans/2026-08-27-rung-d2-search-worker.codex-review.md:63:- Record maximum `requestAnimationFrame` gap to catch visible jank.
./docs/superpowers/plans/2026-08-27-rung-d2-search-worker.codex-review.md:89:**Fix:** Keep the current `PlayerView` shape, but replace “measured as negligible” with the actual serialized size and main-thread posting duration from D2-A2. Revisit `Omit<PlayerView, 'defs'>` plus worker rehydration only when the card catalogue materially grows.

exec
/bin/zsh -lc 'git show --stat --oneline 5ba59b0 && git show --stat --oneline 968d2da' in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-0DWuroW8' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-iSUZ1nnu' (errno=Operation not permitted)
5ba59b0 feat(web): rung D2 — the ISMCTS search runs in a Web Worker
 apps/web/src/game/search/coordinator.ts  | 370 +++++++++++++++++++
 apps/web/src/game/search/protocol.ts     |  79 ++++
 apps/web/src/game/search/worker.ts       |  42 +++
 apps/web/src/game/useGame.ts             | 143 ++++++--
 apps/web/test/search-coordinator.test.ts | 606 +++++++++++++++++++++++++++++++
 apps/web/test/search-protocol.test.ts    |  89 +++++
 apps/web/test/useGame.test.ts            | 213 ++++++++++-
 7 files changed, 1512 insertions(+), 30 deletions(-)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-50O5OoCo' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-zPYFzqd0' (errno=Operation not permitted)
968d2da docs(web): record the D2 browser measurement — worker verified, budget unreduced
 .../specs/2026-08-27-rung-d2-search-worker.md      | 41 ++++++++++++++++++++++
 1 file changed, 41 insertions(+)

exec
/bin/zsh -lc "nl -ba apps/web/test/useGame.test.ts | sed -n '700,920p'" in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
   700	      const next = usable.find((c) => c.command.type !== 'concede')
   701	      if (!next) break
   702	      state = apply(state, next.command).state
   703	    }
   704	    expect(checked).toBeGreaterThan(20)
   705	  })
   706	})
   707	
   708	// -----------------------------------------------------------------------------------------------------------
   709	// Rung D2: the AI half of the hook. There is no DOM in this suite, so what is driven here is the React-FREE
   710	// seam the effect installs — `createAiSearch` + `aiHandlers` — which is the whole of the hook's AI behaviour
   711	// minus React's own scheduling. The races behind it are asserted against the coordinator itself in
   712	// search-coordinator.test.ts; what these cover is what the HOOK adds: narration, the legality re-check, the
   713	// seed reset a restart performs, and the fallback being visible in the log a player is actually reading.
   714	// -----------------------------------------------------------------------------------------------------------
   715	
   716	const EMPTY_DIAGNOSTICS: SearchDiagnostics = {
   717	  determinisations: 1, treeApplies: 1, rolloutApplies: 1, evaluations: 1, nodes: 1, maxCommandDepth: 1, rootChildren: [],
   718	}
   719	
   720	/** Fast-forward to a position the AI actually owns — the only kind the hook ever asks about. */
   721	function aiToAct(seed: number): GameState {
   722	  let state = newGame(seed)
   723	  const agent = new GreedyAgent({ seed, decks: DECKS, depth: 1 })
   724	  for (let i = 0; i < 400; i++) {
   725	    const p = actingPlayer(state)
   726	    if (p === null) break
   727	    if (p === AI) return state
   728	    state = apply(state, agent.decide(viewFor(state, p), legalCommands(state, p))).state
   729	  }
   730	  throw new Error(`seed ${seed} never reached an AI decision`)
   731	}
   732	
   733	class TestClock implements Clock {
   734	  private t = 0
   735	  private seq = 0
   736	  private readonly timers = new Map<number, { at: number; fn: () => void }>()
   737	
   738	  now(): number { return this.t }
   739	
   740	  after(ms: number, fn: () => void): () => void {
   741	    const id = ++this.seq
   742	    this.timers.set(id, { at: this.t + ms, fn })
   743	    return () => { this.timers.delete(id) }
   744	  }
   745	
   746	  advance(ms: number): void {
   747	    const target = this.t + ms
   748	    for (;;) {
   749	      let next: { id: number; at: number; fn: () => void } | null = null
   750	      for (const [id, timer] of this.timers) if (timer.at <= target && (!next || timer.at < next.at)) next = { id, ...timer }
   751	      if (!next) break
   752	      this.timers.delete(next.id)
   753	      this.t = next.at
   754	      next.fn()
   755	    }
   756	    this.t = target
   757	  }
   758	}
   759	
   760	class TestTransport implements SearchTransport {
   761	  readonly sent: WorkerRequestMessage[] = []
   762	  terminations = 0
   763	  constructor(readonly handlers: TransportHandlers) {}
   764	
   765	  post(message: WorkerRequestMessage): void { this.sent.push(message) }
   766	  terminate(): void { this.terminations++ }
   767	
   768	  get searches(): WorkerSearchRequest[] {
   769	    return this.sent.filter((m): m is WorkerSearchRequest => m.type === 'search')
   770	  }
   771	}
   772	
   773	/** A worker reply carrying a command that really is legal there, so nothing downstream of the wire is faked. */
   774	function resultMessage(state: GameState, requestId: number, command?: Command): WorkerResponseMessage {
   775	  const chosen = command ?? legalCommands(state, AI)[0]
   776	  if (!chosen) throw new Error('no legal AI command')
   777	  const result: SearchResult = { command: chosen, diagnostics: EMPTY_DIAGNOSTICS }
   778	  return { type: 'result', requestId, result }
   779	}
   780	
   781	interface AiHarness {
   782	  readonly clock: TestClock
   783	  readonly search: AiSearch
   784	  readonly transports: TestTransport[]
   785	  readonly lines: LogLine[]
   786	  readonly commits: GameState[]
   787	  readonly handlers: ReturnType<typeof aiHandlers>
   788	  state(): GameState
   789	  setState(next: GameState): void
   790	  /** The engine narrates `unimplementedAbility` as a warning too, so the fallback line is found by its text. */
   791	  fallbacks(): LogLine[]
   792	}
   793	
   794	function aiHarness(seed: number, factory?: SearchTransportFactory): AiHarness {
   795	  const clock = new TestClock()
   796	  const transports: TestTransport[] = []
   797	  const lines: LogLine[] = []
   798	  const commits: GameState[] = []
   799	  let current = aiToAct(seed)
   800	  const sink: AiSink = {
   801	    commit: (next, produced) => { current = next; commits.push(next); lines.push(...produced) },
   802	    log: (line) => { lines.push(line) },
   803	  }
   804	  const createTransport: SearchTransportFactory = factory ?? ((h) => {
   805	    const t = new TestTransport(h)
   806	    transports.push(t)
   807	    return t
   808	  })
   809	  return {
   810	    clock, transports, lines, commits,
   811	    handlers: aiHandlers(sink),
   812	    search: createAiSearch(() => current, seed, { clock, createTransport }),
   813	    state: () => current,
   814	    setState: (next) => { current = next },
   815	    fallbacks: () => lines.filter((l) => l.kind === 'warning' && l.text.includes(FALLBACK_WARNING)),
   816	  }
   817	}
   818	
   819	describe('the hook drives the search worker (rung D2)', () => {
   820	  it('narrates and commits a delivered result on the pacing deadline (D2-5)', () => {
   821	    const h = aiHarness(11)
   822	    const before = h.state()
   823	    h.search.request(before, h.handlers)
   824	    const transport = h.transports[0]!
   825	    h.clock.advance(50)
   826	    transport.handlers.message(resultMessage(before, transport.searches[0]!.requestId))
   827	    expect(h.commits).toHaveLength(0)   // the search was fast; the board is still showing 600 ms of thinking
   828	    h.clock.advance(AI_STEP_MS - 50)
   829	    expect(h.commits).toHaveLength(1)
   830	    expect(h.state()).not.toBe(before)
   831	    expect(h.lines[0]?.kind).toBe('ai')
   832	    expect(h.lines[0]?.text.length).toBeGreaterThan(0)
   833	  })
   834	
   835	  it('surfaces the fallback as exactly one warning and keeps playing (D2-6)', () => {
   836	    const h = aiHarness(11, () => { throw new Error('this browser does not support Web Workers') })
   837	    h.search.request(h.state(), h.handlers)
   838	    h.clock.advance(AI_STEP_MS)
   839	    expect(h.fallbacks()).toHaveLength(1)
   840	    expect(h.fallbacks()[0]!.text).toContain('this browser does not support Web Workers')
   841	    expect(h.commits).toHaveLength(1)   // a warning, not a stop: Greedy played on the same deadline
   842	    for (let i = 0; i < 6 && actingPlayer(h.state()) === AI; i++) {
   843	      h.search.request(h.state(), h.handlers)
   844	      h.clock.advance(AI_STEP_MS)
   845	    }
   846	    expect(h.commits.length).toBeGreaterThan(1)
   847	    expect(h.fallbacks()).toHaveLength(1)
   848	  })
   849	
   850	  it('does not apply an in-flight result once the game has restarted (D2-4)', () => {
   851	    const h = aiHarness(11)
   852	    const stale = h.state()
   853	    h.search.request(stale, h.handlers)
   854	    const transport = h.transports[0]!
   855	    const inFlight = transport.searches[0]!.requestId
   856	    h.search.restart(99)
   857	    h.setState(aiToAct(99))
   858	    transport.handlers.message(resultMessage(stale, inFlight))
   859	    h.clock.advance(10 * AI_STEP_MS)
   860	    expect(h.commits).toHaveLength(0)
   861	    expect(h.lines).toHaveLength(0)
   862	    expect(transport.terminations).toBe(1)
   863	  })
   864	
   865	  it('restarts the decision index the search seed comes from (D2-3)', () => {
   866	    const h = aiHarness(11)
   867	    const first = h.state()
   868	    h.search.request(first, h.handlers)
   869	    const transport = h.transports[0]!
   870	    transport.handlers.message(resultMessage(first, transport.searches[0]!.requestId))
   871	    h.clock.advance(AI_STEP_MS)
   872	    expect(h.commits).toHaveLength(1)
   873	    h.search.request(h.state(), h.handlers)
   874	    expect(transport.searches[0]!.seed).toBe(searchSeed(11, 0))
   875	    expect(transport.searches[1]!.seed).toBe(searchSeed(11, 1))
   876	    h.search.restart(99)
   877	    h.setState(aiToAct(99))
   878	    h.search.request(h.state(), h.handlers)
   879	    expect(h.transports[1]!.searches[0]!.seed).toBe(searchSeed(99, 0))
   880	  })
   881	
   882	  it('refuses a command that is not legal in the state it was chosen for (B-A4)', () => {
   883	    const h = aiHarness(11)
   884	    const before = h.state()
   885	    h.search.request(before, h.handlers)
   886	    const transport = h.transports[0]!
   887	    transport.handlers.message(resultMessage(before, transport.searches[0]!.requestId, { type: 'concede', player: HUMAN }))
   888	    h.clock.advance(AI_STEP_MS)
   889	    expect(h.commits).toHaveLength(0)
   890	    expect(h.state()).toBe(before)
   891	    expect(h.lines.some((l) => l.kind === 'warning' && l.text.includes('not legal'))).toBe(true)
   892	  })
   893	
   894	  it('drops the outstanding request when a human commit lands mid-search (D2-4)', () => {
   895	    const h = aiHarness(11)
   896	    const before = h.state()
   897	    h.search.request(before, h.handlers)
   898	    const transport = h.transports[0]!
   899	    // What `choose` does: invalidate, then apply. Concede is legal off-turn, so this really can happen.
   900	    h.search.invalidate()
   901	    h.setState(apply(before, { type: 'concede', player: HUMAN }).state)
   902	    transport.handlers.message(resultMessage(before, transport.searches[0]!.requestId))
   903	    h.clock.advance(10 * AI_STEP_MS)
   904	    expect(h.commits).toHaveLength(0)
   905	    expect(h.lines).toHaveLength(0)
   906	  })
   907	})

exec
/bin/zsh -lc "nl -ba packages/ai/src/ismcts/agent.ts
rg -n \"new IsmctsAgent|IsmctsAgent|DEFAULT_ITERATIONS|200 iterations|90\\.0|mirrored\" packages apps docs/superpowers -g '*.ts' -g '*.md'" in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
     1	import { SYNTHETIC_ID_BASE, nextInt, seedRng, type CardId, type Command, type PlayerView, type Rng } from '@fftcg/engine'
     2	import type { Agent } from '../agent.js'
     3	import { DEFAULT_EXPLORATION_C, DEFAULT_ITERATIONS, DEFAULT_ROLLOUT_COMMAND_CAP, searchIsmcts } from './search.js'
     4	import type { SearchDiagnostics, SearchInput } from './keys.js'
     5	
     6	export interface IsmctsOptions {
     7	  seed: number
     8	  /** Both players' publicly declared 50-card lists — the same open-decklist assumption `determinise` documents. */
     9	  decks: [string[], string[]]
    10	  iterations?: number | undefined
    11	  rolloutCommandCap?: number | undefined
    12	  explorationC?: number | undefined
    13	}
    14	
    15	/** Every `CardId` a command names — the W4 guard `GreedyAgent` carries, for the same reason. */
    16	function commandCardIds(c: Command): readonly CardId[] {
    17	  switch (c.type) {
    18	    case 'castCharacter': case 'castSummon': return [c.card, ...c.payment.dullBackups, ...c.payment.discards.map((d) => d.card)]
    19	    case 'declareAttack': return c.attackers
    20	    case 'declareBlock': return c.blocker === null ? [] : [c.blocker]
    21	    case 'assignPartyDamage': return c.assignments.map((a) => a.target)
    22	    case 'discardToHandSize': return c.cards
    23	    case 'chooseTargets': return c.targets
    24	    case 'chooseFirst': case 'mulligan': case 'chooseMode': case 'pass': case 'concede': return []
    25	    default: { const _exhaustive: never = c; return _exhaustive }
    26	  }
    27	}
    28	
    29	/**
    30	 * The thin stateful wrapper (D-7). Everything that decides anything lives in `searchIsmcts`, which is pure and
    31	 * takes only a `PlayerView` plus the two declared lists — so D2 can move the search into a Web Worker by
    32	 * posting a `SearchInput` and this class keeps working unchanged.
    33	 *
    34	 * The only state here is the seed stream: the tree is rebuilt from scratch every `decide` (D-8), so nothing
    35	 * carries over between decisions and a replayed view trace replays exactly.
    36	 */
    37	export class IsmctsAgent implements Agent {
    38	  private rng: Rng
    39	  private readonly decks: [string[], string[]]
    40	  private readonly iterations: number
    41	  private readonly rolloutCommandCap: number
    42	  private readonly explorationC: number
    43	  readonly needsLegalCommands = false
    44	  /** Last decision's counters (spec D-A4). `null` before the first `decide`, and on the non-acting fallback. */
    45	  lastDiagnostics: SearchDiagnostics | null = null
    46	
    47	  constructor(opts: IsmctsOptions) {
    48	    this.rng = seedRng(opts.seed)
    49	    this.decks = opts.decks
    50	    this.iterations = opts.iterations ?? DEFAULT_ITERATIONS
    51	    this.rolloutCommandCap = opts.rolloutCommandCap ?? DEFAULT_ROLLOUT_COMMAND_CAP
    52	    this.explorationC = opts.explorationC ?? DEFAULT_EXPLORATION_C
    53	  }
    54	
    55	  decide(view: PlayerView, legal: Command[]): Command {
    56	    this.lastDiagnostics = null
    57	    const me = view.me
    58	    // The engine never asks a non-acting player to move; `legalCommands` for one returns `[concede]` alone, so
    59	    // there is nothing to search and `GreedyAgent`'s fallback is the same command by a longer route.
    60	    if ((view.pending?.player ?? view.priority) !== me || view.result) {
    61	      const fallback = legal[0]
    62	      return fallback ?? { type: 'concede', player: me }
    63	    }
    64	    // A fresh stream per decision, so decision N's search is not a function of how much work decision N-1 did.
    65	    const [seed, next] = nextInt(this.rng, 0x4000_0000)
    66	    this.rng = next
    67	    const input: SearchInput = {
    68	      view,
    69	      decks: this.decks,
    70	      iterations: this.iterations,
    71	      seed,
    72	      rolloutCommandCap: this.rolloutCommandCap,
    73	      explorationC: this.explorationC,
    74	    }
    75	    const { command, diagnostics } = searchIsmcts(input)
    76	    this.lastDiagnostics = diagnostics
    77	    // W4: a command that escaped with a determinisation's synthetic id would be illegal in the live game and,
    78	    // worse, would sometimes be *legal* while naming a card the search only imagined.
    79	    for (const id of commandCardIds(command)) {
    80	      if (id >= SYNTHETIC_ID_BASE) throw new Error(`IsmctsAgent.decide: chosen command ${command.type} references synthetic id ${id}`)
    81	    }
    82	    return command
    83	  }
    84	}
apps/cli/src/mirror.ts:7: * The mirrored tournament (spec D-A1).
apps/cli/src/mirror.ts:75:   *  Near 0 means seats do not matter on this pool; large means an unmirrored result was worthless. */
docs/superpowers/specs/2026-08-27-rung-d1-ismcts.md:25:| D-7 | **A pure, serialisable search core** | `searchIsmcts(input): { command, diagnostics }` — synchronous, no callbacks, no timing dependencies, inputs and results structured-cloneable — plus a thin stateful `IsmctsAgent` wrapper implementing `Agent`. The D2 worker protocol is **defined now**: one-time init for decks and definitions, then `{ requestId, view, seed/decisionIndex, iterations }` requests with generation-checked results. D2 then owns cancellation and React changes only. |
docs/superpowers/specs/2026-08-27-rung-d1-ismcts.md:36:  whole run, and the existing "both seats" test uses *different seed ranges* rather than mirrored games.
docs/superpowers/specs/2026-08-27-rung-d1-ismcts.md:91:- **Gate is 200 mirrored seed pairs at ≥ 55 % with a confidence bound** (D-A1), not 60 % over 200 fixed-seat
docs/superpowers/specs/2026-08-27-rung-d1-ismcts.md:97:**ISMCTS at 200 iterations scores 90.0 % against `GreedyAgent`** over 120 mirrored games (60 seed pairs,
docs/superpowers/specs/2026-08-27-rung-d1-ismcts.md:108:scored 91.7 % (CI95 [0.85, 0.98]) and the 120-game post-fix run scored 90.0 %, i.e. indistinguishable. An
docs/superpowers/specs/2026-08-27-rung-d1-ismcts.md:116:**Re-measured at the merged HEAD**, after the code review's two HIGH fixes: **90.0 %** (108/120), CI95
docs/superpowers/specs/2026-08-27-rung-d2-search-worker.md:8:D1 is merged (`b22be0f`): headless SO-ISMCTS beats `GreedyAgent` **90.0 %** over 120 mirrored games at
docs/superpowers/specs/2026-08-27-rung-d2-search-worker.md:78:  (462 tests, ISMCTS 90.0 % vs greedy, strict fuzzer 0 failures).
docs/superpowers/specs/2026-08-27-rung-d2-search-worker.md:106:(darwin 25.5.0), default budget **200 iterations**, `rolloutCommandCap` 24, `rolloutApplyCap` 2048.
docs/superpowers/specs/2026-08-27-rung-d2-search-worker.md:139:~254 ms per decision, so the browser affords the **same 200 iterations D1 measured**. The risk the spec
docs/superpowers/specs/2026-08-27-rung-d2-search-worker.md:140:raised — that the human would face a weaker opponent than the 90.0 % one — did not materialise: the browser
apps/cli/src/agents.ts:1:import { GreedyAgent, IsmctsAgent, RandomAgent, type Agent } from '@fftcg/ai'
apps/cli/src/agents.ts:55: * legacy `seed * 2 + 1/2` random-vs-random scheme. The mirrored tournament seeds by AGENT instead of by
apps/cli/src/agents.ts:65:  return new IsmctsAgent(spec.iterations === undefined ? { seed, decks } : { seed, decks, iterations: spec.iterations })
docs/superpowers/specs/2026-08-26-heuristic-ai-design.md:166:(swap `--p0`/`--p1` for the mirrored seat order; drop `--depth 2` for depth 1, the default).
apps/cli/src/main.ts:4:import { DEFAULT_ITERATIONS } from '@fftcg/ai'
apps/cli/src/main.ts:28: * pair of a mirrored tournament collapsed onto the SAME game and reported a meaninglessly narrow confidence
apps/cli/src/main.ts:40: * iteration default is the SEARCH's `DEFAULT_ITERATIONS`, not a number this CLI invented — a bare `ismcts`
apps/cli/src/main.ts:71:  const iterations = parsed(() => parseIterations(flag('iterations', String(DEFAULT_ITERATIONS))))
docs/superpowers/plans/2026-08-27-rung-d1-ismcts.codex-review.md:53:The current harness fixes agents to seats for an entire run (`apps/cli/src/selfplay.ts:30-55`); the existing “both seats” test uses different seed ranges rather than mirrored games (`apps/cli/test/selfplay.test.ts:18-24`).
docs/superpowers/plans/2026-08-27-rung-d1-ismcts.codex-review.md:73:**Fix:** In D1, implement a pure synchronous `searchIsmcts(input): {command, diagnostics}` plus a thin stateful `IsmctsAgent` wrapper. Keep inputs/results structured-cloneable and avoid callbacks or timing dependencies. Define the future worker protocol now: one-time initialization for static decks/definitions, then `{requestId, view, seed/decisionIndex, iterations}` requests and generation-checked results. D2 can own cancellation and React changes without rewriting the search core.
docs/superpowers/plans/2026-08-27-rung-d1-ismcts.codex-review.md:95:5. Gate on 200 mirrored seed pairs with confidence reporting.
apps/cli/test/selfplay.test.ts:136:// D-A1: the mirrored tournament
apps/cli/test/selfplay.test.ts:233:    // also swaps which RNG stream each agent draws from — the two runs are different games, not one mirrored.)
apps/cli/test/agents.test.ts:3:import { GreedyAgent, IsmctsAgent, RandomAgent } from '@fftcg/ai'
apps/cli/test/agents.test.ts:88:  it('D1: builds an IsmctsAgent, with and without an explicit iteration count', () => {
apps/cli/test/agents.test.ts:89:    expect(makeAgent({ kind: 'ismcts' }, 1, [['A-1'], ['A-1']])).toBeInstanceOf(IsmctsAgent)
apps/cli/test/agents.test.ts:90:    expect(makeAgent({ kind: 'ismcts', iterations: 16 }, 1, [['A-1'], ['A-1']])).toBeInstanceOf(IsmctsAgent)
apps/web/src/game/search/coordinator.ts:2:  DEFAULT_EXPLORATION_C, DEFAULT_ITERATIONS, DEFAULT_ROLLOUT_COMMAND_CAP, GreedyAgent, type Agent,
apps/web/src/game/search/coordinator.ts:221:        iterations: this.opts.iterations ?? DEFAULT_ITERATIONS,
apps/web/test/search-protocol.test.ts:31:  // make the browser play a different game from the headless gate that measured 90.0 %.
packages/ai/src/ismcts/agent.ts:3:import { DEFAULT_EXPLORATION_C, DEFAULT_ITERATIONS, DEFAULT_ROLLOUT_COMMAND_CAP, searchIsmcts } from './search.js'
packages/ai/src/ismcts/agent.ts:37:export class IsmctsAgent implements Agent {
packages/ai/src/ismcts/agent.ts:50:    this.iterations = opts.iterations ?? DEFAULT_ITERATIONS
packages/ai/src/ismcts/agent.ts:80:      if (id >= SYNTHETIC_ID_BASE) throw new Error(`IsmctsAgent.decide: chosen command ${command.type} references synthetic id ${id}`)
packages/ai/src/ismcts/search.ts:46: * clearly above `GreedyAgent` (66 % over 24 mirrored games at a THIRD of it) without being unusable headless.
packages/ai/src/ismcts/search.ts:48:export const DEFAULT_ITERATIONS = 200
packages/ai/test/ismcts-search.test.ts:14:import { IsmctsAgent } from '../src/ismcts/agent.js'
packages/ai/test/ismcts-search.test.ts:346:    const agent = new IsmctsAgent({ seed: 1, decks: decksOf(s), iterations: 100 })
packages/ai/test/ismcts-search.test.ts:436:    const agents = [new IsmctsAgent({ seed: 4, decks, iterations: 60 }), new IsmctsAgent({ seed: 4, decks, iterations: 60 })]
packages/ai/test/ismcts-search.test.ts:486:    const a = new IsmctsAgent({ seed: 9, decks, iterations: 40 })
packages/ai/test/ismcts-search.test.ts:487:    const b = new IsmctsAgent({ seed: 9, decks, iterations: 40 })
packages/ai/test/ismcts-search.test.ts:595:describe('IsmctsAgent', () => {
packages/ai/test/ismcts-search.test.ts:599:    const a = new IsmctsAgent({ seed: 7, decks, iterations: 50 })
packages/ai/test/ismcts-search.test.ts:600:    const b = new IsmctsAgent({ seed: 7, decks, iterations: 50 })
packages/ai/test/ismcts-search.test.ts:618:    const agent = new IsmctsAgent({ seed: 1, decks: decksOf(s), iterations: 120 })
packages/ai/test/ismcts-search.test.ts:651:    const agent = new IsmctsAgent({ seed: 3, decks: decksOf(s), iterations: 40 })

exec
/bin/zsh -lc "rg -n \"C3|deck search|reveal|Cloud|attack-phase|attack phase\" docs/superpowers packages apps -g '*.md' -g '*.ts' -g '*.tsx'" in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
docs/superpowers/specs/2026-08-27-rung-d2-search-worker.md:43:| D2-8 | Not in scope | Any change to the search, its keys or its evaluation; a worker pool or parallel search; C3's ability clauses. |
docs/superpowers/specs/2026-08-25-fftcg-game-design.md:11:2025 Vol. 2, Earth/Lightning, Cloud) has ability text on every card — there is no "vanilla cards
docs/superpowers/specs/2026-08-25-fftcg-game-design.md:125:   dull for 1 CP; discard from hand for 2 CP of that element; max 5 backups) → attack phase
apps/cli/src/mirror.ts:133: * exactly the kind of error a passing gate does not reveal.
packages/cards/src/abilities.ts:40:  '20-074C': 2,   // ETB reveal 5 | [2][Dull], self-break: draw 1
packages/cards/src/abilities.ts:57: * itself is rung C3: this clause fires on a NORMAL cast, which is what `enterField` means. Noel's second
packages/cards/src/abilities.ts:58: * clause (the [Dull] action ability) is C3 and keeps warning — hence `ABILITY_CLAUSES['16-092C'] === 2`.
packages/cards/src/abilities.ts:112: * Cloud's ETB only. Untargeted and unconditional, so it raises no prompt: `forEach` binds each of your
packages/cards/src/abilities.ts:113: * Forwards in turn. Cloud is already on the field when its own ETB resolves, so it pumps itself too —
packages/cards/src/abilities.ts:116: * Cloud's second clause (at the beginning of the Attack Phase) needs a phase continuation and is C2; it
packages/cards/src/abilities.ts:122:  text: 'When Cloud enters the field, until the end of the turn, all the Forwards you control gain 3000 power and Brave.',
docs/superpowers/specs/2026-08-27-rung-c2-observer-triggers.md:35:| C2-13 | Not in scope | Prishe c1 ("when chosen by a Summon or an ability" — needs the agenda to **preempt an active frame**, which it cannot do; targets are chosen while a frame is already executing), Hugh Yurg / Miner / Reeve (deck search → C3), Cloud's Attack-Phase clause (C3), action abilities and EX Burst (C4), static/cost modification (C5). |
docs/superpowers/specs/2026-08-27-rung-c2-observer-triggers.md:96:## What C2 actually built, and what C3 inherits (from the C2 code review)
docs/superpowers/specs/2026-08-27-rung-c2-observer-triggers.md:98:Recorded so C3 does not start from a false assumption, the way C2 nearly did:
docs/superpowers/specs/2026-08-27-rung-c2-observer-triggers.md:103:  today — but **Cloud's "cannot be returned to its owner's hand by your opponent's Summons or abilities"
docs/superpowers/specs/2026-08-27-rung-c2-observer-triggers.md:104:  has no observer source until it exists**, and that is a C3 clause. Build the transition-producing
docs/superpowers/specs/2026-08-27-rung-c2-observer-triggers.md:105:  primitive before Cloud, and keep `breakCard` distinct from a plain "put into the Break Zone": the latter
docs/superpowers/specs/2026-08-27-rung-c2-observer-triggers.md:110:  leak private identifiers to the opponent. **Decide the private/revealed visibility model before adding
docs/superpowers/specs/2026-08-27-rung-c2-observer-triggers.md:112:- **The continuation slot alone cannot carry Cloud's Attack-Phase clause.** Passing Main Phase 1 enters
docs/superpowers/specs/2026-08-27-rung-c2-observer-triggers.md:114:  so queueing Cloud before it would resolve the clause while the state still says Main Phase 1. Attack
docs/superpowers/plans/2026-08-27-rung-c1-abilities.codex-review.md:15:`state.pending` is one overwriteable value (`packages/engine/src/state.ts:36`). Cloud’s phase trigger must interrupt the current `main1 → preparation → declaration` transition, which currently happens atomically (`packages/engine/src/phases.ts:50`). Lightning can produce one trigger per opponent Forward moved during simultaneous rule processing (`packages/cards/data/cards.json:272`), while `resolveDamage` runs those rule processes and then unconditionally writes `pending: null` (`packages/engine/src/attack.ts:164`, `packages/engine/src/attack.ts:166`). Multiple broken Forwards—or future multiple trigger sources—cannot be represented.
docs/superpowers/plans/2026-08-27-rung-c1-abilities.codex-review.md:23:Only Shantotto and Billy Bob are wholly within the stated slice. Noel also has EX Burst and an action ability (`packages/cards/data/cards.json:75`). Lightning has EX Burst plus the zone-change trigger that the spec assigns to C2 (`packages/cards/data/cards.json:272`, `docs/superpowers/specs/2026-08-27-rung-c1-abilities.md:26`). Cloud has a second attack-phase trigger with two protection effects (`packages/cards/data/cards.json:227`). Yet C1-A2 says no `unimplementedAbility` for any of the five (`docs/superpowers/specs/2026-08-27-rung-c1-abilities.md:48`), and C1-9 excludes actions, EX Burst, and zone-change triggers (`docs/superpowers/specs/2026-08-27-rung-c1-abilities.md:42`).
docs/superpowers/plans/2026-08-27-rung-c1-abilities.codex-review.md:25:**Fix:** Track coverage per ability clause, not per card code—e.g. stable `abilityId`s and `complete: boolean`. Remove the warning only for implemented clauses and continue warning that Noel’s action/EX, Lightning’s EX/second trigger, and Cloud’s deferred trigger are incomplete. If A2 genuinely means whole-card completion, C1 necessarily absorbs work currently assigned to C2/C3.
docs/superpowers/plans/2026-08-27-rung-c1-abilities.codex-review.md:31:None of the five effects needs a stack merely to calculate its result, so immediate resolution is a coherent MVP simplification. Cloud’s attack-phase trigger still needs an internal pause before attack declaration (`packages/cards/data/cards.json:227`; `packages/engine/src/phases.ts:50`). In real interaction, targeted ETBs also need a response window: for example, Lightning can target Undead Princess, but Undead Princess could put itself into the Break Zone as an action cost before Lightning resolves (`packages/cards/data/cards.json:136`, `packages/cards/data/cards.json:272`). Immediate resolution denies that response. Likewise, Ramuh could respond before Cloud’s pump or Shantotto’s protection resolves (`packages/cards/data/cards.json:45`, `packages/cards/data/cards.json:166`).
docs/superpowers/plans/2026-08-27-rung-c1-abilities.codex-review.md:67:**Shantotto and Cloud require protection state that `granted: Keyword[]` cannot express.**
docs/superpowers/plans/2026-08-27-rung-c1-abilities.codex-review.md:69:`Keyword` contains only Haste, Brave, First Strike, and Back Attack (`packages/engine/src/types.ts:5`). Shantotto grants “cannot be broken” (`packages/cards/data/cards.json:45`), while Cloud additionally grants protection from opponent-caused return-to-hand (`packages/cards/data/cards.json:227`). Rule processing currently breaks damaged Forwards unconditionally (`packages/engine/src/rules.ts:24`).
docs/superpowers/plans/2026-08-27-rung-c1-abilities.codex-review.md:71:**Fix:** Add explicit until-end-of-turn protection flags to `FieldCard`. `cannotBeBroken` must block both direct break effects and damage-based breaking, while still allowing the zero-power rule process. Cloud’s anti-return flag also requires zone-move primitives to carry cause/controller information so only opponent Summons and abilities are prevented.
docs/superpowers/plans/2026-08-27-rung-c1-abilities.codex-review.md:101:Class Tenth Moogle changes produced CP (`packages/cards/data/cards.json:29`), Odin has conditional cost reduction (`packages/cards/data/cards.json:60`), and Sphene has static Break Zone protection (`packages/cards/data/cards.json:257`). None fits the listed C1/C2/C3 groups cleanly.
docs/superpowers/plans/2026-08-27-rung-c1-abilities.codex-review.md:113:- Cloud ETB only: mass power bonus and Brave.
docs/superpowers/plans/2026-08-27-rung-c1-abilities.codex-review.md:117:Lightning belongs naturally in C2 with its zone-change trigger. Cloud’s attack-phase trigger should wait until phase continuations and source-aware protections are deliberately covered. Noel and Cloud should continue emitting partial-coverage warnings until their remaining printed clauses land.
apps/web/scripts/fetch-images.ts:6: * The Square Enix CDN sits behind a Cloudflare WAF that rate-limits hard — roughly a dozen rapid requests
docs/superpowers/specs/2026-08-27-rung-b-web-ui.md:29:| B8 | Card images | Real art from the SE CDN, fetched **once** by a script into `apps/web/public/cards/<code>.jpg` (git-ignored, never committed). **The CDN's Cloudflare WAF rate-limits hard — ~12 rapid requests got this machine IP-blocked.** The fetch script is therefore strictly serial at **≤ 1 request/second** with retry-after backoff. 18 distinct codes ≈ 20 seconds. |
docs/superpowers/specs/2026-08-27-rung-c1-abilities.md:22:| Until-end-of-turn modifiers (power, keywords, protection) | Cloud ETB: *+3000 and Brave to all your Forwards* | **C1** |
docs/superpowers/specs/2026-08-27-rung-c1-abilities.md:25:| Deck search / reveal top N | Hugh Yurg, Miner, Reeve | C2 |
docs/superpowers/specs/2026-08-27-rung-c1-abilities.md:27:| Phase-transition triggers | Cloud's Attack-Phase clause | C2 |
docs/superpowers/specs/2026-08-27-rung-c1-abilities.md:28:| Action abilities (`[Dull]:`, `[Earth], discard:`), costs, once-per-turn | Red Mage, Geomancer, Sphene, Miner | C3 |
docs/superpowers/specs/2026-08-27-rung-c1-abilities.md:29:| EX Burst on damage | Odin, Noel, Reeve, Lightning | C3 |
docs/superpowers/specs/2026-08-27-rung-c1-abilities.md:32:That last row was missing from revision 1 and has no home in C1–C3; it is now rung C4.
docs/superpowers/specs/2026-08-27-rung-c1-abilities.md:45:| C1-8 | Triggers are discovered from **transition records captured before removal** | `runRuleProcesses` removes affected Forwards simultaneously and only then emits `broken`; scanning the resulting field loses the trigger of a card that died at the same instant. Zone transitions are recorded with pre-transition snapshots and cause/controller, enqueued exactly once. Cause/controller is also what lets C2 implement Cloud's *"cannot be returned by your **opponent's** Summons or abilities"*. |
docs/superpowers/specs/2026-08-27-rung-c1-abilities.md:46:| C1-9 | Coverage is tracked **per clause** | Each clause gets a stable `abilityId`; a card warns `unimplementedAbility` for exactly the clauses that are not implemented. Noel and Cloud keep warning about their unimplemented clauses even in C1. (Ramuh prints exactly ONE clause — the modal 'select up to 2 of the 3 following actions' — so implementing it completes the card and it correctly warns about nothing. Revision 2 wrongly listed it here.) The log stays honest, which is what B-A6 promised the player. |
docs/superpowers/specs/2026-08-27-rung-c1-abilities.md:47:| C1-10 | The five C1 clauses | **Noel ETB** (0..2 opponent targets, dull) · **Shantotto ETB** (mode → nested target → Haste / cannot-be-broken) · **Cloud ETB only** (mass untargeted power + keyword) · **Billy Bob ETB** (Break-Zone targeting and zone movement) · **Ramuh Summon** (0..2 of 3 modes, damage, sequential target choices — and the only exercise of the Summon path, which is dead code today). |
docs/superpowers/specs/2026-08-27-rung-c1-abilities.md:48:| C1-11 | Not in scope | Everything in the C2/C3/C4 rows above, the stack and response windows, and Limit Break (skipped program-wide). |
docs/superpowers/specs/2026-08-27-rung-c1-abilities.md:85:  no longer for the five that are. Noel and Cloud still warn about their other clauses; Ramuh, Shantotto and
docs/superpowers/specs/2026-08-27-rung-c1-abilities.md:105:- **Card set changed.** Lightning is out (its EX Burst and zone-change trigger belong to C2/C3); **Ramuh
docs/superpowers/specs/2026-08-27-rung-c1-abilities.md:107:  Cloud is **ETB-only**; its Attack-Phase trigger needs phase continuations and moves to C2.
docs/superpowers/specs/2026-08-26-heuristic-ai-design.md:38:- **A4**: the built signature is `preferredPayment(state, player, card)` — it operates on a full (determinised) `GameState`, not a bare `PlayerView`, because it needs backup/hand card definitions and `canPay`/`generateCp` from the engine. It also resolves multi-element costs via `requiredElements(def)` (§11.2.1.1 Light/Dark exemption, C3) and bounded backtracking over the required elements (C2, final fix wave) — not simply "dull backups then discard" in element order, and not a single scarcity-first greedy pass either: a single pass, even scarcest-element-first, can still strand a later element when the cheapest per-element pick spends a source only that element's rescue depended on (Codex's 3-element counterexample). Backtracking explores every source-to-element assignment and keeps the cheapest complete one.
docs/superpowers/plans/2026-08-27-rung-c1-abilities.codex-code-review.md:21:Not safe to merge until the `settle()` resume ordering is fixed. The five AST declarations themselves match the printed target sets exactly: Noel is opponent-only 0..2; Shantotto’s Haste mode targets any non-source Forward while protection targets your Forward including herself; Cloud affects all your Forwards including itself; Billy Bob targets your Break Zone Forward while excluding every Billy Bob; and Ramuh selects 0..2 unrestricted Forward modes. The Noel EX/action and Cloud Attack-Phase deferrals and clause warnings are correct. Program-counter resumption, off-field sources, persistent step budgeting, current game-over cleanup, determinisation, and forced-decision draining otherwise checked out. Strict real-pool runs finished 200/200 at 197–3 and 199–1, with a 20-game greedy mirror completing; ESLint passed, while Vitest could not create its temporary directory in the read-only sandbox.
packages/cards/test/abilities.test.ts:94:  /** The EX BURST tag is C3; the trigger itself fires on a normal cast, which is what `enterField` means. */
packages/cards/test/abilities.test.ts:130:    // "[Dull], put Noel into the Break Zone: Dull all the Forwards opponent controls." is a C3 action ability.
packages/cards/test/abilities.test.ts:193:// 27-124S Cloud
packages/cards/test/abilities.test.ts:196:describe('27-124S Cloud — "When Cloud enters the field, until the end of the turn, all the Forwards you control gain 3000 power and Brave."', () => {
packages/cards/test/abilities.test.ts:206:  it('needs no choice at all: every Forward YOU control, Cloud included, gains 3000 power and Brave', () => {
packages/cards/test/abilities.test.ts:212:    expect(powerOfId(t, cloud)).toBe(10_000)           // Cloud is already on the field when its own ETB resolves
apps/web/test/useGame.test.ts:334:    expect(describeEvent(narrator(before, after), { type: 'returnedToHand', player: AI, card: gone })?.text).toContain('Cloud')
packages/cards/test/normalise.test.ts:59:    expect(db.get('27-124S')?.name).toBe('Cloud')
docs/superpowers/plans/2026-08-25-mvp0-bones.md:67:  src/attack.ts                  attack phase: declare, block, damage (§10, §15.2.1–3)
docs/superpowers/plans/2026-08-25-mvp0-bones.md:526:- Verified Vol. 2 main deck (50): Forwards 3×27-124S Cloud, 3×27-125S Luso, 3×27-126S Sphene, 3×27-127S Lightning, 2×19-052C Undead Princess, 3×22-068R Prishe, 3×24-063H Hugh Yurg, 2×16-092C Noel, 2×12-120C Shantotto (Earth/Lightning), 2×18-124C Billy Bob (Earth/Lightning); Backups 3×9-074C Class Tenth Moogle, 3×18-064C Geomancer, 3×20-074C Miner, 3×1-121C Red Mage, 3×18-069C Red Mage, 3×20-105C Reeve; Summons 3×13-072R Odin, 3×20-103H Ramuh. (LB deck of 8 is MVP5 — not in this file.)
docs/superpowers/plans/2026-08-25-mvp0-bones.md:711:# Starter Set 2025 Vol. 2 — Earth/Lightning (Cloud). Main deck only; LB deck is MVP5.
docs/superpowers/plans/2026-08-25-mvp0-bones.md:734:  { "code": "27-124S", "name": "Cloud", "type": "forward", "elements": ["earth"], "cost": 3, "power": 7000, "keywords": [], "generic": false, "exBurst": false, "hasAbilities": true,
docs/superpowers/plans/2026-08-25-mvp0-bones.md:735:    "text": "When Cloud enters the field, until the end of the turn, all the Forwards you control gain 3000 power and Brave.\nAt the beginning of the Attack Phase during each of your turns, choose 1 Forward you control. Until the end of the turn, it gains \"This Forward cannot be broken.\" and \"This Forward cannot be returned to its owner's hand by your opponent's Summons or abilities.\"" },
docs/superpowers/plans/2026-08-25-mvp0-bones.md:852:    expect(db.get('27-124S')?.name).toBe('Cloud')
docs/superpowers/plans/2026-08-25-mvp0-bones.md:1818:const NAMED = [...VANILLA_POOL, makeDef({ code: 'V-N1', name: 'Cloud', cost: 1, power: 3000 }), makeDef({ code: 'V-N2', name: 'Cloud', cost: 1, power: 3000 }), makeDef({ code: 'V-G1', name: 'Red Mage', generic: true, cost: 1, power: 3000 })]
docs/superpowers/plans/2026-08-25-mvp0-bones.md:1877:    ;[s] = withField(s, 0, 'forwards', 'V-N1')     // "Cloud"
docs/superpowers/plans/2026-08-25-mvp0-bones.md:1878:    ;[s, n2] = withHand(s, 0, 'V-N2')               // another "Cloud", different code
docs/superpowers/plans/2026-08-25-mvp0-bones.md:1883:    // an opponent's Cloud does not block yours
docs/superpowers/plans/2026-08-25-mvp0-bones.md:1903:  it('cannot be cast in the attack phase (MVP0 simplification of §9.3.1.6)', () => {
docs/superpowers/plans/2026-08-25-mvp0-bones.md:2323:git commit -m "feat(engine): attack phase with party attacks, blocking and battle damage (CR §10, §15.2.1-2)
docs/superpowers/plans/2026-08-25-mvp0-bones.md:2880:export function describeCommand(view: PlayerView, c: Command): string   // "Cast Cloud (27-124S) paying: dull Red Mage, discard Odin as Lightning"
docs/superpowers/plans/2026-08-25-mvp0-bones.md:2885:export function deckOrder(opts: { seed: number; decks: [string[], string[]]; defs: CardDef[] }): string   // both players' post-shuffle deck order, top first, as "1. Cloud (27-124S)" lines
docs/superpowers/plans/2026-08-25-mvp0-bones.md:3220:- **MVP0-SIMPLIFICATION markers (exhaustive):** priority never passes (state.ts); Summons main-phase-only (cast.ts); mulligan order (setup.ts); attack preparation auto-advance (phases.ts); damage step auto-advance and no First Strike (attack.ts); Summons resolve with no effect (cast.ts); EX Burst skipped (rules.ts); 6th Backup illegal rather than rule-processed (cast.ts); multi-element backups produce their first element (cp.ts); same-name cast refusal (§7.7.3/§12.4.6) (cast.ts); Monster-type cards unsupported (cast.ts). ~~Light/Dark CP exemption (cp.ts)~~ — implemented in the rung-A final fix wave (2026-08-26, C3): see `requiredElements(def)` in `cp.ts`; no longer a gap, marker removed.
packages/ai/src/ismcts/search.ts:17: * ability reveals what it hit, so one action does not identify one resulting information set).
packages/ai/src/ismcts/search.ts:373:      // effect — a cast reveals the card, a discard puts it face up in the Break Zone, attacks/blocks/targets
packages/ai/test/payment.test.ts:131:  it('C3: preferredPayment pays a Light card with two off-element (earth) backups, no same-element CP needed', () => {
docs/superpowers/plans/2026-08-27-rung-c2-observer-triggers.codex-code-review.md:15:`ZoneTransition` only represents field-to-Break-Zone movement at [rules.ts:37](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/rules.ts:37), while the revision-2 spec explicitly includes Break-Zone-to-hand transitions. `toHand` silently removes cards from either the field or Break Zone at [resolve.ts:167](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/resolve.ts:167), and `moveToHand` emits no transition at [resolve.ts:351](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/resolve.ts:351). This does not currently break the five implemented clauses, but leaves Cloud’s future return protection and non-“break” field-to-Break-Zone costs without a reliable observer source.
docs/superpowers/plans/2026-08-27-rung-c2-observer-triggers.codex-code-review.md:17:**Fix:** Centralize zone movement behind a transition-producing primitive supporting at least field→Break Zone and Break Zone→hand, with field→hand added before Cloud. Keep `breakCard` distinct from “put into Break Zone,” because the latter must bypass cannot-be-broken protection.
docs/superpowers/plans/2026-08-27-rung-c2-observer-triggers.codex-code-review.md:27:**C3 deck search cannot safely reuse the current target prompt representation.**
docs/superpowers/plans/2026-08-27-rung-c2-observer-triggers.codex-code-review.md:31:**Fix:** Define private/revealed choice visibility before adding deck targets. Preserve or rebind authorized candidate IDs in the acting player’s determinisation and redact them from unauthorized views.
docs/superpowers/plans/2026-08-27-rung-c2-observer-triggers.codex-code-review.md:33:**The continuation slot alone cannot implement Cloud’s beginning-of-Attack-Phase clause correctly.**
docs/superpowers/plans/2026-08-27-rung-c2-observer-triggers.codex-code-review.md:35:Passing Main Phase 1 immediately enters attack declaration at [phases.ts:50](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/phases.ts:50), and `enterAttackDeclaration` emits both preparation and declaration events together at [resolve.ts:386](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/resolve.ts:386). Simply queueing Cloud before the existing continuation would resolve it while the state still says Main Phase 1.
packages/engine/src/rules.ts:35: * `cause`/`causeController` is what C2 needs for Cloud's "cannot be returned by your OPPONENT's abilities".
packages/ai/test/greedy.test.ts:301:      // so the bug only shows when the ROLLOUT walks into the attack phase and declares an attack itself.
packages/engine/src/phases.ts:52:      // declaration. C2's Cloud clause instead enqueues its trigger and sets `resolution.continuation` to
apps/web/test/card.test.tsx:11:const cloud: CardProps = { code: '27-124S', name: 'Cloud', cost: 3, elements: ['earth'], type: 'forward', power: 7000 }
apps/web/test/card.test.tsx:21:    for (const fact of ['Cloud', '>3<', 'forward', '7000', 'pip--earth', '27-124S']) expect(out).toContain(fact)
apps/web/test/card.test.tsx:27:    expect(out).toContain('Cloud')
apps/web/test/card.test.tsx:59:    expect(out).not.toContain('Cloud')
packages/engine/src/determinise.ts:11: * a real opponent would not have revealed).
packages/ai/test/ismcts-search.test.ts:453:        // Player 1 answers with a command that names no hidden card, so nothing is revealed by the answer.
packages/ai/test/ismcts-search.test.ts:567:    // Every command in this pool has a public effect — a cast reveals the card — so naming it leaks nothing
docs/superpowers/plans/2026-08-26-rung-a-heuristic-ai.md:838:   `requiredElements(def)` (C3); `boundedAttackSets` adds legal pairs, deduplicated by sorted
docs/superpowers/plans/2026-08-26-rung-a-heuristic-ai.md:873:   bounded (each pending kind strictly advances the attack); C3's Light/Dark exemption is correct but
packages/engine/src/abilities.ts:93: * `enterField` covers casting AND being put onto the field by another ability (C3's Hugh Yurg), which is
packages/engine/src/abilities.ts:171:   * trigger interrupted. C1 has none; C2's Cloud Attack-Phase clause is the first.
docs/superpowers/plans/2026-08-27-rung-c2-observer-triggers.codex-review.md:96:If C2 keeps the universal source-aware transition investment, I would also reconsider deferring Cloud: the continuation already exists (`packages/engine/src/abilities.ts:122`), and C2 is otherwise paying for exactly the source-aware return protection Cloud needs. If Cloud remains deferred, universal transitions and generalized causes are over-built for this rung.
apps/web/test/commands.test.ts:318:    expect(describeChoice(v, targets([901, 902]))).toBe('Dull Cloud and Sphene')
apps/web/test/commands.test.ts:319:    expect(describeChoice(v, targets([901]))).toBe('Dull Cloud')
apps/web/test/commands.test.ts:321:    expect(describeChoice(breakZoneView(), targets([901]))).toBe('Return Cloud')
apps/web/test/commands.test.ts:331:    expect(set.byCard.get(901)?.map((ch) => ch.label)).toEqual(['Dull Cloud', 'Dull Cloud and Sphene'])
apps/web/test/commands.test.ts:383:    expect(describeChoice(nestedView(0), targets([901]))).toBe('Dull Cloud')
apps/web/test/commands.test.ts:384:    expect(describeChoice(nestedView(1), targets([901]))).toBe('Give Haste to Cloud')
apps/web/test/commands.test.ts:424:    expect(promptFor(watchView(mineBroken))).toBe(`Your Cloud was broken — ${ask}`)
apps/web/test/commands.test.ts:429:    expect(promptFor(watchView(onForward))).toBe(`Cloud dealt 3000 damage to Sphene — ${ask}`)
apps/web/test/commands.test.ts:431:    expect(promptFor(watchView(onPlayer))).toBe(`Cloud dealt damage to the AI — ${ask}`)
apps/web/test/commands.test.ts:445:    expect(describeChoice(v, targets([901]))).toBe('Target Cloud')
packages/engine/test/cr11.4-cast.test.ts:6:const NAMED = [...VANILLA_POOL, makeDef({ code: 'V-N1', name: 'Cloud', cost: 1, power: 3000 }), makeDef({ code: 'V-N2', name: 'Cloud', cost: 1, power: 3000 }), makeDef({ code: 'V-G1', name: 'Red Mage', generic: true, cost: 1, power: 3000 })]
packages/engine/test/cr11.4-cast.test.ts:70:    ;[s] = withField(s, 0, 'forwards', 'V-N1')     // "Cloud"
packages/engine/test/cr11.4-cast.test.ts:71:    ;[s, n2] = withHand(s, 0, 'V-N2')               // another "Cloud", different code
packages/engine/test/cr11.4-cast.test.ts:76:    // an opponent's Cloud does not block yours
packages/engine/test/cr11.4-cast.test.ts:96:  it('cannot be cast in the attack phase (MVP0 simplification of §9.3.1.6)', () => {
packages/engine/test/cr11.2-cp.test.ts:80:describe('C3: requiredElements — §11.2.1.1/§11.2.2 Light/Dark same-element exemption', () => {
apps/web/src/ui/Board.tsx:89:/** Targetable cards those zones do NOT draw — the Break Zone today, more hidden zones in C2/C3. */
apps/web/src/ui/Board.tsx:140:  // give it a row. That closes the class (C2/C3 target more hidden zones) instead of this one instance.

exec
/bin/zsh -lc "nl -ba docs/superpowers/specs/2026-08-27-rung-c2-observer-triggers.md | sed -n '90,125p'" in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
exec
/bin/zsh -lc "nl -ba docs/superpowers/plans/2026-08-27-rung-c2-observer-triggers.codex-code-review.md | sed -n '1,50p'" in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
    90	- **Party attribution by membership** (C2-8) — the array-position bug is real and silent.
    91	- **`TargetFilter.types`** (C2-9) for "Character".
    92	- **Total ordering key, AP-first labelled a deviation** (C2-11).
    93	- **The stale-candidate risk removed** — Codex traced it unreachable; replaced by C2-A9, which pins it.
    94	- **Work staged** (C2-12) so the machinery lands with the clauses that only need it.
    95	
    96	## What C2 actually built, and what C3 inherits (from the C2 code review)
    97	
    98	Recorded so C3 does not start from a false assumption, the way C2 nearly did:
    99	
   100	- **`ZoneTransition` covers field→Break Zone only.** C2-2 promised field→Break Zone *and* Break Zone→hand;
   101	  only the first was built. `toHand` removes from either the field or the Break Zone and emits no
   102	  transition, so `moveToHand` is invisible to observers. No C2 clause watches it, so nothing is wrong
   103	  today — but **Cloud's "cannot be returned to its owner's hand by your opponent's Summons or abilities"
   104	  has no observer source until it exists**, and that is a C3 clause. Build the transition-producing
   105	  primitive before Cloud, and keep `breakCard` distinct from a plain "put into the Break Zone": the latter
   106	  must bypass `cannotBeBroken`.
   107	- **Deck search cannot reuse the current target prompt as-is.** `Pending` carries raw `CardId`s and
   108	  `viewFor` copies them wholesale, while `determinise` mints replacement ids for hidden cards and then
   109	  copies the stale pending ids over. Deck-search candidates would be orphaned for the acting AI and could
   110	  leak private identifiers to the opponent. **Decide the private/revealed visibility model before adding
   111	  any deck target** — it is an information-model change, not a targeting change.
   112	- **The continuation slot alone cannot carry Cloud's Attack-Phase clause.** Passing Main Phase 1 enters
   113	  attack declaration in one step and `enterAttackDeclaration` emits preparation and declaration together,
   114	  so queueing Cloud before it would resolve the clause while the state still says Main Phase 1. Attack
   115	  entry has to split: preparation (set the phase, fire beginning-of-phase triggers) then a continuation
   116	  into declaration once they resolve.
   117	- **Haste targeting is power-blind to abilities.** `hasteUnlock` is `1 + power/1000`, so with an unblocked
   118	  9000 vanilla and a fresh 3000 Luso the AI hastes the 9000 — although both deal a single point of damage,
   119	  and Luso additionally breaks whatever it damages, so a blocker is *good* for it. Left unfixed
   120	  deliberately: the honest value is "what does this card do when it attacks", which is a bounded rollout,
   121	  and inventing a constant to out-weigh 9000 power would be tuning to one fixture. Needs the fixture
   122	  Codex gives (Lightning/Luso vs a higher-power vanilla) and a measured change, not a guess.

 succeeded in 0ms:
     1	<!-- codex=codex-cli 0.146.0 model=gpt-5.6-sol effort=xhigh cwd=/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai exit=0 head=8c25b41 -->
     2	
     3	## HIGH
     4	
     5	**Control-changed cards are sent to the controller’s Break Zone instead of the owner’s.**
     6	
     7	The rule-process path removes a card from player `p`’s field and appends it to `p.breakZone` at [rules.ts:94](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/rules.ts:94). Likewise, `breakCard` records `CardInstance.owner` but then appends using `loc.owner`, which is actually the field controller, at [resolve.ts:317](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/resolve.ts:317). This violates the spec’s explicit ownership requirement at [observer-triggers.md:24](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/docs/superpowers/specs/2026-08-27-rung-c2-observer-triggers.md:24) and [CR 3.3 §§12.4.4, 15.1.1.3](https://fftcg.cdn.sewest.net/2026-08/fftcg-comprules-v3.3.pdf). The earlier review’s MAJOR was not genuinely closed.
     8	
     9	**Fix:** Remove from the controller’s field but group and append cards by `CardInstance.owner`. Preserve the pre-transition controller solely for trigger matching. Test both ability breaks and rule-process breaks of a control-changed card.
    10	
    11	## MEDIUM
    12	
    13	**The promised zone-transition contract remains incomplete and movement is still split across silent paths.**
    14	
    15	`ZoneTransition` only represents field-to-Break-Zone movement at [rules.ts:37](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/rules.ts:37), while the revision-2 spec explicitly includes Break-Zone-to-hand transitions. `toHand` silently removes cards from either the field or Break Zone at [resolve.ts:167](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/resolve.ts:167), and `moveToHand` emits no transition at [resolve.ts:351](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/resolve.ts:351). This does not currently break the five implemented clauses, but leaves Cloud’s future return protection and non-“break” field-to-Break-Zone costs without a reliable observer source.
    16	
    17	**Fix:** Centralize zone movement behind a transition-producing primitive supporting at least field→Break Zone and Break Zone→hand, with field→hand added before Cloud. Keep `breakCard` distinct from “put into Break Zone,” because the latter must bypass cannot-be-broken protection.
    18	
    19	**The Haste target heuristic can choose a strictly dominated target for Lightning’s new clause.**
    20	
    21	Haste value is only `1 + power / 1000` at [evaluate.ts:46](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/ai/src/evaluate.ts:46), and target selection consumes that directly at [candidates.ts:166](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/ai/src/candidates.ts:166). With an unblocked 9000 vanilla Forward and fresh 3000 Luso, the AI chooses the 9000 even though both deal one point and Luso additionally triggers its damage/recovery clause at [abilities.ts:269](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/cards/src/abilities.ts:269).
    22	
    23	**Fix:** Add immediate `dealtDamage` trigger value to Haste scoring, or perform a bounded combat rollout for forced target choices. Add a real Lightning/Luso-versus-higher-power-vanilla fixture.
    24	
    25	## LOW
    26	
    27	**C3 deck search cannot safely reuse the current target prompt representation.**
    28	
    29	Pending targets contain raw `CardId`s at [state.ts:29](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/state.ts:29). Views copy pending resolution data wholesale at [view.ts:31](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/view.ts:31), while determinisation creates replacement hidden-card IDs and then copies those stale pending IDs at [determinise.ts:27](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/determinise.ts:27). Deck-search candidates would therefore be orphaned for the acting AI and potentially leak private identifiers to opponents.
    30	
    31	**Fix:** Define private/revealed choice visibility before adding deck targets. Preserve or rebind authorized candidate IDs in the acting player’s determinisation and redact them from unauthorized views.
    32	
    33	**The continuation slot alone cannot implement Cloud’s beginning-of-Attack-Phase clause correctly.**
    34	
    35	Passing Main Phase 1 immediately enters attack declaration at [phases.ts:50](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/phases.ts:50), and `enterAttackDeclaration` emits both preparation and declaration events together at [resolve.ts:386](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/resolve.ts:386). Simply queueing Cloud before the existing continuation would resolve it while the state still says Main Phase 1.
    36	
    37	**Fix:** Split attack entry into preparation—set Attack Phase and emit beginning-phase triggers—and a continuation that enters declaration only after those triggers resolve.
    38	
    39	## VERDICT
    40	
    41	Not safe to merge as revision-2 complete until Break Zone ownership and the missing movement-transition contract are fixed. The ten AST clauses do match their printed text; current trigger cardinality, dying-watcher snapshots, settlement ordering, AP-first determinism, and AI draining of queued work are otherwise sound. Focused tests could not start because the read-only sandbox blocked Vite’s `.vite-temp` write, so this verdict is based on static tracing.

exec
/bin/zsh -lc "nl -ba packages/engine/src/abilities.ts | sed -n '140,200p'" in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
   140	 * frame can resume inside `then`/`modes`/`do` after a player answers. `chosen` is the target binding the
   141	 * innermost `chooseTargets`/`forEach` established.
   142	 */
   143	export interface Frame {
   144	  readonly abilityId: string
   145	  /** The card whose ability this is — resolves `excludeSource`, and it may already have left the field. */
   146	  readonly source: CardId
   147	  /** The player who controls the ability and therefore answers its choices. */
   148	  readonly controller: PlayerId
   149	  readonly path: readonly number[]
   150	  readonly chosen: readonly CardId[]
   151	  /**
   152	   * What fired this clause, for `onSubject` and for narration. Null for `enterField`/`summonResolve`, which
   153	   * are about the source itself. It must survive prompts and the source leaving the field (spec C2-5).
   154	   */
   155	  readonly triggerEvent: TriggerEvent | null
   156	  /** Modes picked by an enclosing `chooseModes`, as indices into its `modes`. */
   157	  readonly modes: readonly number[]
   158	}
   159	
   160	/**
   161	 * Work the engine owes itself. `pending` stays exactly what it always was — the ONE decision a player
   162	 * currently owes — and is cleared before the agenda resumes; this is the queue behind it.
   163	 */
   164	export interface Resolution {
   165	  /** The frame currently executing, if any. Corresponds 1:1 with a non-null ability `pending`. */
   166	  readonly active: Frame | null
   167	  /** Triggered clauses waiting their turn, in trigger order. */
   168	  readonly queue: readonly Frame[]
   169	  /**
   170	   * A system continuation to run once the queue drains — e.g. finishing a phase transition that a
   171	   * trigger interrupted. C1 has none; C2's Cloud Attack-Phase clause is the first.
   172	   */
   173	  readonly continuation: 'enterAttackDeclaration' | null
   174	  /**
   175	   * Total effect steps spent, across the WHOLE agenda and PERSISTING across player choices (spec C1-5).
   176	   * A call-depth cap would not catch a trigger cycle that launders itself through a `chooseTargets`
   177	   * prompt. Exceeding `MAX_RESOLUTION_STEPS` throws loudly rather than hanging the browser.
   178	   */
   179	  readonly steps: number
   180	}
   181	
   182	export const MAX_RESOLUTION_STEPS = 512
   183	
   184	export const EMPTY_RESOLUTION: Resolution = { active: null, queue: [], continuation: null, steps: 0 }
   185	
   186	/**
   187	 * Does the agenda still owe the engine anything? A `continuation` counts: it is work only `drainResolution`
   188	 * consumes, so settlement, `checkInvariants` and the AI's diagnostics that looked at `active`/`queue` alone
   189	 * would call a state with nothing but a continuation "settled" and strand it there permanently.
   190	 */
   191	export function hasResolutionWork(r: Resolution): boolean {
   192	  return r.active !== null || r.queue.length > 0 || r.continuation !== null
   193	}

exec
/bin/zsh -lc "nl -ba packages/engine/src/state.ts | sed -n '1,130p'" in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
     1	import type { Rng } from './rng.js'
     2	import type { PlayerId, CardDef, Keyword } from './types.js'
     3	import type { FieldFlag, Resolution } from './abilities.js'
     4	
     5	export type CardId = number
     6	export interface CardInstance { id: CardId; code: string; owner: PlayerId }
     7	export type Status = 'active' | 'dull'
     8	export interface FieldCard {
     9	  id: CardId; status: Status; damage: number; enteredTurn: number; attackedThisTurn: boolean
    10	  granted: Keyword[]
    11	  /** Until-end-of-turn power modifier (spec C1-7). Cleared in the End Phase; only `effectivePower` reads it. */
    12	  powerBonus: number
    13	  /** Until-end-of-turn protection `granted` cannot express, e.g. `cannotBeBroken` (spec C1-7). */
    14	  flags: readonly FieldFlag[]
    15	}
    16	export interface PlayerState {
    17	  deck: CardId[]        // index 0 = top
    18	  hand: CardId[]
    19	  forwards: FieldCard[]
    20	  backups: FieldCard[]
    21	  damageZone: CardId[]
    22	  breakZone: CardId[]
    23	  mulliganDecided: boolean
    24	}
    25	export type Phase = 'setup' | 'active' | 'draw' | 'main1' | 'attack' | 'main2' | 'end'
    26	export type AttackStep = 'preparation' | 'declaration' | 'block' | 'damage'
    27	export interface AttackState { step: AttackStep; attackers: CardId[]; blocker: CardId | null }
    28	/** Decisions owed by a specific player that are NOT priority actions (§11.1): setup choices, the defender's step actions in the Attack Phase, and the choices an ability suspends on (spec C1-6). */
    29	export type Pending =
    30	  | { kind: 'chooseFirst'; player: PlayerId }
    31	  | { kind: 'mulligan'; player: PlayerId }
    32	  | { kind: 'discardToHandSize'; player: PlayerId; count: number }
    33	  | { kind: 'declareBlock'; player: PlayerId }          // §10.1.3.1
    34	  | { kind: 'assignPartyDamage'; player: PlayerId }     // §10.1.4.2.1
    35	  /** `candidates` is the exact legal set the executor computed; `apply` re-checks membership rather than trusting it. */
    36	  | { kind: 'chooseTargets'; player: PlayerId; min: number; max: number; candidates: readonly CardId[] }
    37	  /** `labels` are the printed mode wordings, in listed order; an answer is a set of indices into them. */
    38	  | { kind: 'chooseMode'; player: PlayerId; min: number; max: number; labels: readonly string[] }
    39	export interface GameResult { winner: PlayerId | null; reason: string }   // winner null = draw
    40	export interface GameState {
    41	  rng: Rng
    42	  turn: number                 // 1-based; 0 during setup
    43	  turnPlayer: PlayerId
    44	  firstPlayer: PlayerId
    45	  phase: Phase
    46	  attack: AttackState | null   // non-null only while phase === 'attack'
    47	  priority: PlayerId           // CR §11.1 priority holder. MVP0-SIMPLIFICATION: always the turn player (no stack, no passing)
    48	  pending: Pending | null      // a decision owed by `pending.player`; takes precedence over priority for who acts
    49	  /** Ability work the engine owes itself (spec C1-3). `pending` stays the ONE visible decision; this is the queue behind it. */
    50	  resolution: Resolution
    51	  players: [PlayerState, PlayerState]
    52	  cards: Record<CardId, CardInstance>
    53	  defs: Record<string, CardDef>
    54	  result: GameResult | null
    55	}
    56	export const HAND_SIZE_LIMIT = 5      // §9.5.1.2
    57	export const MAX_BACKUPS = 5          // §7.7.4
    58	export const DAMAGE_TO_LOSE = 7       // §3.1.1
    59	export function defOf(state: GameState, id: CardId): CardDef {
    60	  const inst = state.cards[id]
    61	  if (!inst) throw new Error(`unknown card id ${id}`)
    62	  const def = state.defs[inst.code]
    63	  if (!def) throw new Error(`unknown card code ${inst.code}`)
    64	  return def
    65	}
    66	
    67	export function findFieldCard(state: GameState, id: CardId) {
    68	  for (const owner of [0, 1] as const) {
    69	    for (const zone of ['forwards', 'backups'] as const) {
    70	      const card = state.players[owner][zone].find((c) => c.id === id)
    71	      if (card) return { owner, zone, card }
    72	    }
    73	  }
    74	  return null
    75	}
    76	
    77	/**
    78	 * THE single power authority (spec C1-7). Nothing may add `powerBonus` anywhere else — `powerOf` delegates here,
    79	 * and the web board imports it so a pumped Forward displays the power combat actually uses.
    80	 * Power floors at 0: a −9000 debuff on a 3000-power Forward deals no negative damage, it is put into the Break
    81	 * Zone by the §12.4.4 zero-power rule process instead.
    82	 */
    83	export function effectivePower(def: CardDef, card: FieldCard): number {
    84	  return Math.max(0, (def.power ?? 0) + card.powerBonus)
    85	}
    86	
    87	export function powerOf(state: GameState, card: FieldCard): number {
    88	  return effectivePower(defOf(state, card.id), card)
    89	}
    90	
    91	export function keywordsOf(state: GameState, card: FieldCard): Set<Keyword> {
    92	  return new Set([...defOf(state, card.id).keywords, ...card.granted])
    93	}
    94	
    95	export function updatePlayer(state: GameState, p: PlayerId, f: (ps: PlayerState) => PlayerState): GameState {
    96	  const players: [PlayerState, PlayerState] = [state.players[0], state.players[1]]
    97	  players[p] = f(state.players[p])
    98	  return { ...state, players }
    99	}

exec
/bin/zsh -lc "nl -ba packages/engine/src/view.ts | sed -n '1,180p'" in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
     1	import type { CardDef, PlayerId } from './types.js'
     2	import type { AttackState, CardId, CardInstance, FieldCard, GameResult, GameState, Pending, Phase } from './state.js'
     3	import type { Resolution } from './abilities.js'
     4	
     5	export interface FieldView { forwards: FieldCard[]; backups: FieldCard[]; damageZone: CardId[]; breakZone: CardId[]; deckCount: number; handCount: number }
     6	export interface PlayerView {
     7	  me: PlayerId; turn: number; turnPlayer: PlayerId; phase: Phase; attack: AttackState | null; priority: PlayerId
     8	  pending: Pending | null; result: GameResult | null; hand: CardId[]; fields: [FieldView, FieldView]
     9	  /** Carried so `determinise` can rebuild the SAME agenda: the AI must simulate the ability game it is playing (spec C1-2/C1-A6). Every id in it is already public. */
    10	  resolution: Resolution
    11	  cards: Record<CardId, CardInstance>; defs: Record<string, CardDef>
    12	  firstPlayer: PlayerId /* meaningful once chooseFirst has been decided; before that it is the setup default 0 */
    13	  mulliganDecided: [boolean, boolean]
    14	}
    15	
    16	export function viewFor(state: GameState, me: PlayerId): PlayerView {
    17	  const field = (p: PlayerId): FieldView => {
    18	    const ps = state.players[p]
    19	    return { forwards: ps.forwards, backups: ps.backups, damageZone: ps.damageZone, breakZone: ps.breakZone, deckCount: ps.deck.length, handCount: ps.hand.length }
    20	  }
    21	  const visibleIds = new Set<CardId>(state.players[me].hand)
    22	  for (const p of [0, 1] as const) {
    23	    const ps = state.players[p]
    24	    for (const c of ps.forwards) visibleIds.add(c.id)
    25	    for (const c of ps.backups) visibleIds.add(c.id)
    26	    for (const id of ps.damageZone) visibleIds.add(id)
    27	    for (const id of ps.breakZone) visibleIds.add(id)
    28	  }
    29	  const cards: Record<CardId, CardInstance> = {}
    30	  for (const id of visibleIds) { const inst = state.cards[id]; if (inst) cards[id] = inst }
    31	  return structuredClone({
    32	    me, turn: state.turn, turnPlayer: state.turnPlayer, phase: state.phase, attack: state.attack, priority: state.priority,
    33	    pending: state.pending, resolution: state.resolution, result: state.result, hand: state.players[me].hand, fields: [field(0), field(1)], cards, defs: state.defs,
    34	    firstPlayer: state.firstPlayer, mulliganDecided: [state.players[0].mulliganDecided, state.players[1].mulliganDecided],
    35	  })
    36	}

exec
/bin/zsh -lc "nl -ba packages/engine/src/phases.ts | sed -n '1,90p'" in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
     1	import type { PlayerId } from './types.js'
     2	import { opponentOf } from './types.js'
     3	import type { CardId, GameState } from './state.js'
     4	import { HAND_SIZE_LIMIT, updatePlayer } from './state.js'
     5	import type { Event } from './events.js'
     6	import { IllegalCommandError } from './errors.js'
     7	import { runRuleProcesses } from './rules.js'
     8	import { enterAttackDeclaration } from './resolve.js'
     9	
    10	export function drawCards(state: GameState, p: PlayerId, n: number): [GameState, Event[]] {
    11	  const ps = state.players[p]
    12	  if (ps.deck.length < n) {
    13	    // §3.1.2 — attempt to draw from an empty deck loses; the cards that could be drawn are still drawn
    14	    const s = updatePlayer(state, p, (q) => ({ ...q, deck: [], hand: [...q.hand, ...q.deck] }))
    15	    return [{ ...s, result: { winner: opponentOf(p), reason: `player ${p} could not draw a card (§3.1.2)` } }, [{ type: 'drew', player: p, count: ps.deck.length }]]
    16	  }
    17	  const s = updatePlayer(state, p, (q) => ({ ...q, deck: q.deck.slice(n), hand: [...q.hand, ...q.deck.slice(0, n)] }))
    18	  return [s, [{ type: 'drew', player: p, count: n }]]
    19	}
    20	
    21	export function startTurn(state: GameState, turn: number, player: PlayerId): [GameState, Event[]] {
    22	  const events: Event[] = [{ type: 'turnStarted', turn, player }]
    23	  let s: GameState = { ...state, turn, turnPlayer: player, priority: player, attack: null, pending: null }
    24	  // §9.1 Active Phase
    25	  s = { ...s, phase: 'active' }; events.push({ type: 'phaseStarted', phase: 'active' })
    26	  const dulled: CardId[] = []
    27	  s = updatePlayer(s, player, (ps) => ({
    28	    ...ps,
    29	    forwards: ps.forwards.map((c) => { if (c.status === 'dull') dulled.push(c.id); return { ...c, status: 'active' } }),
    30	    backups: ps.backups.map((c) => { if (c.status === 'dull') dulled.push(c.id); return { ...c, status: 'active' } }),
    31	  }))
    32	  if (dulled.length) events.push({ type: 'activated', player, cards: dulled })
    33	  // §9.2 Draw Phase
    34	  s = { ...s, phase: 'draw' }; events.push({ type: 'phaseStarted', phase: 'draw' })
    35	  const n = turn === 1 ? 1 : 2   // §9.2.1.3
    36	  const [drawn, drawEvents] = drawCards(s, player, n)
    37	  s = drawn; events.push(...drawEvents)
    38	  if (s.result) return [s, events]
    39	  // §9.3 Main Phase 1
    40	  s = { ...s, phase: 'main1' }; events.push({ type: 'phaseStarted', phase: 'main1' })
    41	  return [s, events]
    42	}
    43	
    44	export function applyPass(state: GameState, player: PlayerId): [GameState, Event[]] {
    45	  if (state.result) throw new IllegalCommandError('game is over')
    46	  if (state.pending) throw new IllegalCommandError('a decision is pending')
    47	  if (state.priority !== player) throw new IllegalCommandError('you do not hold priority')
    48	  if (state.phase === 'attack' && state.attack?.step !== 'declaration') throw new IllegalCommandError('cannot pass during this attack step')
    49	  switch (state.phase) {
    50	    case 'main1':
    51	      // §10.1.1 Attack Preparation Step — MVP0-SIMPLIFICATION: nothing triggers here in C1, so advance straight to
    52	      // declaration. C2's Cloud clause instead enqueues its trigger and sets `resolution.continuation` to
    53	      // 'enterAttackDeclaration', which drains to this exact transition.
    54	      return enterAttackDeclaration(state, player)
    55	    case 'attack':   // declaration step, checked above; §10.1.4.6
    56	      return [{ ...state, phase: 'main2', attack: null, priority: player }, [{ type: 'phaseStarted', phase: 'main2' }]]
    57	    case 'main2':
    58	      return beginEndPhase(state)
    59	    default:
    60	      throw new IllegalCommandError(`pass not applicable in phase ${state.phase}`)
    61	  }
    62	}
    63	
    64	function beginEndPhase(state: GameState): [GameState, Event[]] {
    65	  const p = state.turnPlayer
    66	  const events: Event[] = [{ type: 'phaseStarted', phase: 'end' }]
    67	  const s: GameState = { ...state, phase: 'end' }
    68	  const excess = s.players[p].hand.length - HAND_SIZE_LIMIT   // §9.5.1.2
    69	  if (excess > 0) return [{ ...s, pending: { kind: 'discardToHandSize', player: p, count: excess }, priority: p }, events]
    70	  const [t, more] = finishEndPhase(s)
    71	  return [t, [...events, ...more]]
    72	}
    73	
    74	export function applyDiscardToHandSize(state: GameState, player: PlayerId, cards: CardId[]): [GameState, Event[]] {
    75	  const pending = state.pending
    76	  if (pending?.kind !== 'discardToHandSize' || pending.player !== player) throw new IllegalCommandError('no discard decision owed by this player')
    77	  if (cards.length !== pending.count || new Set(cards).size !== cards.length) throw new IllegalCommandError(`discard exactly ${pending.count} distinct cards`)
    78	  for (const id of cards) if (!state.players[player].hand.includes(id)) throw new IllegalCommandError(`${id} is not in your hand`)
    79	  let s = updatePlayer(state, player, (ps) => ({ ...ps, hand: ps.hand.filter((id) => !cards.includes(id)), breakZone: [...ps.breakZone, ...cards] }))
    80	  const events: Event[] = cards.map((card) => ({ type: 'discarded', player, card, reason: 'handSize' }))
    81	  s = { ...s, pending: null }
    82	  const [t, more] = finishEndPhase(s)
    83	  return [t, [...events, ...more]]
    84	}
    85	
    86	export function finishEndPhase(state: GameState): [GameState, Event[]] {
    87	  // §9.5.1.3.1 remove damage; §9.5.1.3.2 end EVERY "until end of turn" effect — granted keywords, `powerBonus`
    88	  // and the protection `flags` (spec C1-7) all expire together; reset per-turn flags
    89	  let s = state
    90	  for (const p of [0, 1] as const) {

exec
/bin/zsh -lc "nl -ba packages/engine/src/determinise.ts | sed -n '1,180p'" in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
     1	import type { PlayerId } from './types.js'
     2	import type { CardId, CardInstance, GameState, PlayerState } from './state.js'
     3	import type { PlayerView } from './view.js'
     4	import { shuffle, type Rng } from './rng.js'
     5	
     6	export const SYNTHETIC_ID_BASE = 100_000
     7	/**
     8	 * `decks` must be the players' complete, publicly declared 50-card lists — the game-mode assumption that both
     9	 * decks are open/fixed information (e.g. a fixed starter matchup), not a general rules guarantee. Callers must
    10	 * supply only declared lists here, never lists reconstructed from hidden `GameState` (that would leak information
    11	 * a real opponent would not have revealed).
    12	 */
    13	export interface DeterminiseOptions { view: PlayerView; decks: [string[], string[]]; rng: Rng }
    14	
    15	function removeVisible(multiset: string[], codes: string[], p: PlayerId): string[] {
    16	  const left = [...multiset]
    17	  for (const code of codes) {
    18	    const i = left.indexOf(code)
    19	    if (i < 0) throw new Error(`deck list for player ${p} does not contain visible card ${code}`)
    20	    left.splice(i, 1)
    21	  }
    22	  return left
    23	}
    24	
    25	/** Rebuild a full GameState consistent with `view`: visible cards keep their ids; the opponent's hand and both decks are sampled from each player's unseen deck-list multiset. Returns the state and the advanced rng. */
    26	export function determinise({ view, decks, rng }: DeterminiseOptions): [GameState, Rng] {
    27	  const cards: Record<CardId, CardInstance> = { ...view.cards }
    28	  for (const p of [0, 1] as const) {
    29	    for (const code of decks[p]) if (!view.defs[code]) throw new Error(`deck list for player ${p} contains code ${code} which has no definition in view.defs`)
    30	  }
    31	  const maxVisibleId = Object.keys(cards).reduce((m, id) => Math.max(m, Number(id)), 0)
    32	  let nextId = Math.max(SYNTHETIC_ID_BASE, maxVisibleId + 1)
    33	  let r = rng
    34	  const players: PlayerState[] = []
    35	  for (const p of [0, 1] as const) {
    36	    const f = view.fields[p]
    37	    const visibleIds = [...f.forwards.map((c) => c.id), ...f.backups.map((c) => c.id), ...f.damageZone, ...f.breakZone, ...(p === view.me ? view.hand : [])]
    38	    const visibleCodes = visibleIds.map((id) => { const c = view.cards[id]; if (!c) throw new Error(`view lacks visible card ${id}`); return c.code })
    39	    const unseen = removeVisible(decks[p], visibleCodes, p)
    40	    const [order, r2] = shuffle(r, unseen); r = r2
    41	    const mint = (code: string): CardId => { const id = nextId++; cards[id] = { id, code, owner: p }; return id }
    42	    let hand: CardId[]
    43	    let deck: CardId[]
    44	    if (p === view.me) { hand = view.hand; deck = order.map(mint) }
    45	    else { hand = order.slice(0, f.handCount).map(mint); deck = order.slice(f.handCount).map(mint) }
    46	    if (deck.length !== f.deckCount || hand.length !== f.handCount) throw new Error(`deck list for player ${p} is inconsistent with the view (unseen ${unseen.length}, expected hand ${f.handCount} + deck ${f.deckCount})`)
    47	    players.push({ deck, hand, forwards: f.forwards, backups: f.backups, damageZone: f.damageZone, breakZone: f.breakZone, mulliganDecided: view.mulliganDecided[p] })
    48	  }
    49	  const state: GameState = {
    50	    rng: r, turn: view.turn, turnPlayer: view.turnPlayer, firstPlayer: view.firstPlayer, phase: view.phase, attack: view.attack,
    51	    priority: view.priority, pending: view.pending, resolution: view.resolution, players: [players[0]!, players[1]!], cards, defs: view.defs, result: view.result,
    52	  }
    53	  return [structuredClone(state), r]
    54	}

exec
/bin/zsh -lc "nl -ba packages/engine/src/resolve.ts | sed -n '350,410p'" in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
   350	        ctx.state = setFieldCard(ctx.state, id, (c) => ({ ...c, flags: [...c.flags, eff.flag] }))
   351	        ctx.events.push({ type: 'flagGranted', card: id, flag: eff.flag })
   352	      }
   353	      return
   354	    case 'moveToHand':
   355	      for (const id of ctx.chosen) {
   356	        const moved = toHand(ctx.state, id)
   357	        if (!moved) continue
   358	        ctx.state = moved
   359	        ctx.events.push({ type: 'returnedToHand', player: ctx.state.cards[id]?.owner ?? ctx.controller, card: id })
   360	      }
   361	      return
   362	    default: { const _exhaustive: never = eff; return _exhaustive }
   363	  }
   364	}
   365	
   366	interface FrameResult { state: GameState; events: Event[]; pending: Pending | null; frame: Frame; steps: number }
   367	
   368	function runFrame(state: GameState, frame: Frame): FrameResult {
   369	  const ability = abilityOf(state, frame)
   370	  const base: FrameResult = { state, events: [], pending: null, frame, steps: state.resolution.steps }
   371	  if (!ability) return base   // the clause vanished with its def; drop the frame rather than throw
   372	  const ctx: Ctx = {
   373	    state, events: [], source: frame.source, controller: frame.controller, abilityId: frame.abilityId,
   374	    path: [...frame.path], chosen: [...frame.chosen], modes: [...frame.modes],
   375	    triggerEvent: frame.triggerEvent,
   376	    resume: frame.path, suspend: null, steps: state.resolution.steps,
   377	  }
   378	  runEffects(ctx, ability.effects, 0, frame.path.length > 0)
   379	  return {
   380	    state: ctx.state, events: ctx.events, pending: ctx.suspend, steps: ctx.steps,
   381	    frame: { ...frame, path: ctx.path, chosen: ctx.chosen, modes: ctx.modes },
   382	  }
   383	}
   384	
   385	// ---------------------------------------------------------------------------
   386	// Draining
   387	// ---------------------------------------------------------------------------
   388	
   389	/** §10.1.1 Attack Preparation Step, then §10.1.2 Declaration. Shared by `pass` and by the agenda continuation. */
   390	export function enterAttackDeclaration(state: GameState, player: PlayerId): [GameState, Event[]] {
   391	  const s: GameState = { ...state, phase: 'attack', attack: { step: 'declaration', attackers: [], blocker: null }, priority: player }
   392	  return [s, [{ type: 'phaseStarted', phase: 'attack', step: 'preparation' }, { type: 'phaseStarted', phase: 'attack', step: 'declaration' }]]
   393	}
   394	
   395	/**
   396	 * Advance the agenda by exactly ONE frame: resume the active one, or start the next queued one, and run it until
   397	 * it finishes or a player must choose (the choice becomes `state.pending` and the frame stays `active`). Then
   398	 * YIELD — spec C2-6. `settle` in apply.ts owns the loop and runs §12.3 rule processes before the next frame
   399	 * starts, which is what puts §12.4.5's break ahead of the trigger that same damage queued. Draining the whole
   400	 * queue here instead would resolve Luso before the Forward it killed was broken.
   401	 *
   402	 * With the queue and the active frame both empty, the system continuation — if any — runs. Never touches an
   403	 * existing `pending`: the decision already on the table always comes first.
   404	 *
   405	 * `resolution.steps` is NOT reset here: `settle` in apply.ts resets it once the whole settlement is quiet, so a
   406	 * rule-process ⇄ trigger cycle keeps accumulating and hits the cap instead of restarting the count every pass.
   407	 */
   408	export function drainResolution(state: GameState): [GameState, Event[]] {
   409	  const events: Event[] = []
   410	  let s = state

exec
/bin/zsh -lc 'rg -n "function actionKey|function decodeAction|pendingDigest|chooseTargets|commandCardIds|SYNTHETIC" packages/ai/src/ismcts/keys.ts packages/ai/src/ismcts/search.ts packages/ai/src/candidates.ts apps/web/src/game/commands.ts' in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
packages/ai/src/candidates.ts:50: * `legalCommands` enumerates Σ C(N, k) answers for a `chooseTargets`/`chooseMode` pending — ~190 commands for
packages/ai/src/candidates.ts:66:  if (eff.kind === 'chooseTargets') return effectAt(eff.then, path, modes, depth + 1)
packages/ai/src/candidates.ts:177:      // chooseTargets / chooseModes / forEach: nested, deliberately unpriced. `onSubject` (C2-5) belongs here
packages/ai/src/candidates.ts:236:    if (eff.kind === 'chooseTargets') {
packages/ai/src/candidates.ts:253:function chooseTargetsCandidates(state: GameState, player: PlayerId, pending: Extract<Pending, { kind: 'chooseTargets' }>): Command[] {
packages/ai/src/candidates.ts:256:  if (!frame || node?.kind !== 'chooseTargets') return legalCommands(state, player).filter((c) => c.type === 'chooseTargets')
packages/ai/src/candidates.ts:263:  return picks.map((targets) => ({ type: 'chooseTargets', player, targets: [...targets].sort((a, b) => a - b) }))
packages/ai/src/candidates.ts:289:      case 'chooseTargets': return chooseTargetsCandidates(state, player, pending)
apps/web/src/game/commands.ts:113:  if (eff.kind === 'chooseTargets') return nodeAt(eff.then, path, modes, depth + 1)
apps/web/src/game/commands.ts:138:    // chooseTargets/chooseModes/forEach describe a choice of their own, not what THIS one does to its picks.
apps/web/src/game/commands.ts:144: * The verb for the `chooseTargets` node the pending projects. The program counter names it exactly; a whole-AST
apps/web/src/game/commands.ts:149:function targetVerb(v: PlayerView, pending: Extract<Pending, { kind: 'chooseTargets' }>): { imperative: string; purpose: string } | null {
apps/web/src/game/commands.ts:152:  const found: Extract<Effect, { kind: 'chooseTargets' }>[] = []
apps/web/src/game/commands.ts:155:      if (e.kind === 'chooseTargets') {
apps/web/src/game/commands.ts:164:  let node: Extract<Effect, { kind: 'chooseTargets' }> | null = exact?.kind === 'chooseTargets' ? exact : null
apps/web/src/game/commands.ts:241:    case 'chooseTargets': {
apps/web/src/game/commands.ts:243:      const verb = v.pending?.kind === 'chooseTargets' ? targetVerb(v, v.pending) : null
apps/web/src/game/commands.ts:276:      case 'chooseTargets': {
apps/web/src/game/commands.ts:306:    case 'chooseTargets': return [...c.targets]
apps/web/src/game/commands.ts:365:    case 'chooseTargets': return sameIds([...a.targets], [...(b as typeof a).targets])
packages/ai/src/ismcts/keys.ts:202:export function actionKey(view: PlayerView, command: Command): ActionKey {
packages/ai/src/ismcts/keys.ts:227:    case 'chooseTargets':
packages/ai/src/ismcts/keys.ts:310:  chooseTargets: ({ player, args, ids, pendingIs }) => {
packages/ai/src/ismcts/keys.ts:311:    const pending = pendingIs('chooseTargets')
packages/ai/src/ismcts/keys.ts:318:    return { type: 'chooseTargets', player, targets }
packages/ai/src/ismcts/keys.ts:351:export function decodeAction(view: PlayerView, key: ActionKey): Command | null {
packages/ai/src/ismcts/keys.ts:437:function pendingDigest(view: PlayerView, pending: Pending | null): string {
packages/ai/src/ismcts/keys.ts:449:    case 'chooseTargets':
packages/ai/src/ismcts/keys.ts:472:    `pend:${pendingDigest(view, view.pending)}`,

exec
/bin/zsh -lc "nl -ba packages/ai/src/ismcts/keys.ts | sed -n '175,370p;425,460p'
nl -ba packages/ai/src/candidates.ts | sed -n '225,305p'" in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
   175	      put(id, `h:${code}`)
   176	    }
   177	  }
   178	  return { byId, byRef }
   179	}
   180	
   181	function indexFor(view: PlayerView, root: PlayerId): RefIndex {
   182	  let slots = INDEX_CACHE.get(view)
   183	  if (!slots) {
   184	    slots = [undefined, undefined]
   185	    INDEX_CACHE.set(view, slots)
   186	  }
   187	  const hit = slots[root]
   188	  if (hit) return hit
   189	  const built = buildIndex(view, root)
   190	  slots[root] = built
   191	  return built
   192	}
   193	
   194	export function cardRef(view: PlayerView, id: CardId, root: PlayerId): CardRef {
   195	  return indexFor(view, root).byId.get(id) ?? OPAQUE
   196	}
   197	
   198	// ---------------------------------------------------------------------------
   199	// actionKey
   200	// ---------------------------------------------------------------------------
   201	
   202	export function actionKey(view: PlayerView, command: Command): ActionKey {
   203	  const r = (id: CardId): CardRef => cardRef(view, id, view.me)
   204	  const head = `${command.type}${FIELD}p${command.player}`
   205	  switch (command.type) {
   206	    case 'chooseFirst':
   207	      return `${head}${FIELD}${command.goFirst ? 'first' : 'second'}`
   208	    case 'mulligan':
   209	      return `${head}${FIELD}${command.redraw ? 'redraw' : 'keep'}`
   210	    case 'castCharacter':
   211	    case 'castSummon': {
   212	      // Payment sources are a SET: `generateCp` and `pay` are both order-insensitive, and `enumeratePayments`
   213	      // emits backups in field order but hand discards in hand order, which differs between worlds.
   214	      const dull = joinRefs(command.payment.dullBackups.map(r))
   215	      const discards = joinTagged(command.payment.discards.map((d) => [r(d.card), d.element] as const))
   216	      return `${head}${FIELD}${r(command.card)}${FIELD}${dull}${FIELD}${discards}`
   217	    }
   218	    case 'declareAttack':
   219	      // `applyDeclareAttack` sorts the party itself, so attacker order carries no meaning to normalise away.
   220	      return `${head}${FIELD}${joinRefs(command.attackers.map(r))}`
   221	    case 'declareBlock':
   222	      return `${head}${FIELD}${command.blocker === null ? '-' : r(command.blocker)}`
   223	    case 'assignPartyDamage':
   224	      return `${head}${FIELD}${joinTagged(command.assignments.map((a) => [r(a.target), String(a.amount)] as const))}`
   225	    case 'discardToHandSize':
   226	      return `${head}${FIELD}${joinRefs(command.cards.map(r))}`
   227	    case 'chooseTargets':
   228	      return `${head}${FIELD}${joinRefs(command.targets.map(r))}`
   229	    case 'chooseMode':
   230	      // Mode answers are indices into the pending's printed `labels`, not ids — already world-independent.
   231	      return `${head}${FIELD}${[...command.modes].sort((a, b) => a - b).join(',')}`
   232	    case 'pass':
   233	    case 'concede':
   234	      return head
   235	    // A new `Command` variant must fail to compile here rather than collapse into some other action's key.
   236	    default: { const _exhaustive: never = command; return _exhaustive }
   237	  }
   238	}
   239	
   240	// ---------------------------------------------------------------------------
   241	// decodeAction
   242	// ---------------------------------------------------------------------------
   243	
   244	interface DecodeCtx {
   245	  readonly view: PlayerView
   246	  readonly player: PlayerId
   247	  /** Key fields after `<type>|p<n>`, so `args[0]` is the first argument of every variant. */
   248	  readonly args: readonly string[]
   249	  /** The id this world gives a ref, or null when this world has no such card (an opaque ref included). */
   250	  id(ref: string | undefined): CardId | null
   251	  ids(field: string | undefined): CardId[] | null
   252	  /** Does this world owe exactly the decision the key answers? A world that diverged does not. */
   253	  pendingIs<K extends Pending['kind']>(kind: K): Extract<Pending, { kind: K }> | null
   254	}
   255	
   256	type Decoder = (ctx: DecodeCtx) => Command | null
   257	
   258	const isElement = (s: string): s is Element => (ELEMENTS as readonly string[]).includes(s)
   259	
   260	const distinct = (xs: readonly number[]): boolean => new Set(xs).size === xs.length
   261	
   262	/**
   263	 * One decoder per `Command` variant. A `Record` keyed on `Command['type']` rather than a switch with a `never`
   264	 * default: the switch subject here is an untrusted string off a key, so it cannot carry the exhaustiveness
   265	 * check itself — but a missing entry in this record does stop the file compiling.
   266	 */
   267	const DECODERS: Record<Command['type'], Decoder> = {
   268	  chooseFirst: ({ player, args, pendingIs }) => {
   269	    if (!pendingIs('chooseFirst')) return null
   270	    const v = args[0]
   271	    return v === 'first' || v === 'second' ? { type: 'chooseFirst', player, goFirst: v === 'first' } : null
   272	  },
   273	  mulligan: ({ player, args, pendingIs }) => {
   274	    if (!pendingIs('mulligan')) return null
   275	    const v = args[0]
   276	    return v === 'redraw' || v === 'keep' ? { type: 'mulligan', player, redraw: v === 'redraw' } : null
   277	  },
   278	  castCharacter: (ctx) => decodeCast(ctx, 'castCharacter'),
   279	  castSummon: (ctx) => decodeCast(ctx, 'castSummon'),
   280	  declareAttack: ({ view, player, args, ids }) => {
   281	    if (view.pending) return null
   282	    const attackers = ids(args[0])
   283	    return attackers && attackers.length > 0 ? { type: 'declareAttack', player, attackers } : null
   284	  },
   285	  declareBlock: ({ player, args, id, pendingIs }) => {
   286	    if (!pendingIs('declareBlock')) return null
   287	    if (args[0] === '-') return { type: 'declareBlock', player, blocker: null }
   288	    const blocker = id(args[0])
   289	    return blocker === null ? null : { type: 'declareBlock', player, blocker }
   290	  },
   291	  assignPartyDamage: ({ player, args, id, pendingIs }) => {
   292	    if (!pendingIs('assignPartyDamage')) return null
   293	    const items = splitTagged(args[0] ?? '')
   294	    if (!items) return null
   295	    const assignments: { target: CardId; amount: number }[] = []
   296	    for (const [ref, tag] of items) {
   297	      const target = id(ref)
   298	      const amount = Number(tag)
   299	      if (target === null || !/^\d+$/.test(tag) || !Number.isSafeInteger(amount)) return null
   300	      assignments.push({ target, amount })
   301	    }
   302	    return { type: 'assignPartyDamage', player, assignments }
   303	  },
   304	  discardToHandSize: ({ player, args, ids, pendingIs }) => {
   305	    const pending = pendingIs('discardToHandSize')
   306	    const cards = ids(args[0])
   307	    if (!pending || !cards || cards.length !== pending.count || !distinct(cards)) return null
   308	    return { type: 'discardToHandSize', player, cards }
   309	  },
   310	  chooseTargets: ({ player, args, ids, pendingIs }) => {
   311	    const pending = pendingIs('chooseTargets')
   312	    const targets = ids(args[0])
   313	    if (!pending || !targets || !distinct(targets)) return null
   314	    if (targets.length < pending.min || targets.length > pending.max) return null
   315	    // `apply` re-checks membership anyway (spec C1-6); checking it here is what makes a key naming a target
   316	    // this world does not offer decode to null instead of to a command that throws.
   317	    if (targets.some((t) => !pending.candidates.includes(t))) return null
   318	    return { type: 'chooseTargets', player, targets }
   319	  },
   320	  chooseMode: ({ player, args, pendingIs }) => {
   321	    const pending = pendingIs('chooseMode')
   322	    if (!pending) return null
   323	    const modes: number[] = []
   324	    for (const s of splitList(args[0] ?? '')) {
   325	      if (!/^\d+$/.test(s)) return null
   326	      modes.push(Number(s))
   327	    }
   328	    if (modes.length < pending.min || modes.length > pending.max || !distinct(modes)) return null
   329	    if (modes.some((m) => m >= pending.labels.length)) return null
   330	    return { type: 'chooseMode', player, modes }
   331	  },
   332	  pass: ({ view, player }) => (view.pending ? null : { type: 'pass', player }),
   333	  concede: ({ player }) => ({ type: 'concede', player }),   // §2.1: always legal
   334	}
   335	
   336	function decodeCast({ view, player, args, id, ids }: DecodeCtx, type: 'castCharacter' | 'castSummon'): Command | null {
   337	  if (view.pending) return null
   338	  const card = id(args[0])
   339	  const dullBackups = ids(args[1])
   340	  const items = splitTagged(args[2] ?? '')
   341	  if (card === null || !dullBackups || !items) return null
   342	  const discards: { card: CardId; element: Element }[] = []
   343	  for (const [ref, tag] of items) {
   344	    const src = id(ref)
   345	    if (src === null || !isElement(tag)) return null
   346	    discards.push({ card: src, element: tag })
   347	  }
   348	  return { type, player, card, payment: { dullBackups, discards } }
   349	}
   350	
   351	export function decodeAction(view: PlayerView, key: ActionKey): Command | null {
   352	  const parts = key.split(FIELD)
   353	  const decoder = (DECODERS as Record<string, Decoder | undefined>)[parts[0] ?? '']
   354	  const player: PlayerId | null = parts[1] === 'p0' ? 0 : parts[1] === 'p1' ? 1 : null
   355	  if (!decoder || player === null) return null
   356	  const idx = indexFor(view, view.me)
   357	  // Consumption spans the WHOLE command, not one list: interchangeable copies share a ref, so a cast whose
   358	  // payment discards another copy of the card being cast would otherwise decode both to the same id and be
   359	  // rejected as "cannot discard the card you are casting". Decoding in field order hands out distinct copies.
   360	  const taken = new Map<CardRef, number>()
   361	  const take = (ref: CardRef): CardId | null => {
   362	    const n = taken.get(ref) ?? 0
   363	    const v = idx.byRef.get(ref)?.[n]
   364	    if (v === undefined) return null
   365	    taken.set(ref, n + 1)
   366	    return v
   367	  }
   368	  const ctx: DecodeCtx = {
   369	    view,
   370	    player,
   425	  const r = (id: CardId): CardRef => cardRef(view, id, view.me)
   426	  // `path` and `modes` are program-counter indices, already world-independent. `chosen` is a binding whose
   427	  // order no effect depends on, so it normalises like every other set.
   428	  return [f.abilityId, r(f.source), f.controller, f.path.join('.'), joinRefs(f.chosen.map(r)), triggerDigest(view, f.triggerEvent), f.modes.join('.')].join('/')
   429	}
   430	
   431	function resolutionDigest(view: PlayerView, res: Resolution): string {
   432	  // `steps` is real, observable resource state (it is what `MAX_RESOLUTION_STEPS` bounds), so two positions
   433	  // that differ only in how much agenda budget is left are genuinely different positions.
   434	  return `${frameDigest(view, res.active)}~[${res.queue.map((f) => frameDigest(view, f)).join(',')}]~${res.continuation ?? '-'}~${res.steps}`
   435	}
   436	
   437	function pendingDigest(view: PlayerView, pending: Pending | null): string {
   438	  if (pending === null) return '-'
   439	  const r = (id: CardId): CardRef => cardRef(view, id, view.me)
   440	  const head = `${pending.kind}/${pending.player}`
   441	  switch (pending.kind) {
   442	    case 'chooseFirst':
   443	    case 'mulligan':
   444	    case 'declareBlock':
   445	    case 'assignPartyDamage':
   446	      return head
   447	    case 'discardToHandSize':
   448	      return `${head}/${pending.count}`
   449	    case 'chooseTargets':
   450	      return `${head}/${pending.min}-${pending.max}/${joinRefs(pending.candidates.map(r))}`
   451	    case 'chooseMode':
   452	      // Labels are printed wording, and JSON-quoted so a label containing a separator cannot forge one.
   453	      return `${head}/${pending.min}-${pending.max}/${pending.labels.map((l) => JSON.stringify(l)).join(',')}`
   454	    default: { const _exhaustive: never = pending; return _exhaustive }
   455	  }
   456	}
   457	
   458	export function observationKey(view: PlayerView): ObservationKey {
   459	  const r = (id: CardId): CardRef => cardRef(view, id, view.me)
   460	  const at = view.attack
   225	  return out
   226	}
   227	
   228	/**
   229	 * One-ply value of running `effects` for `me` — the same units as `targetDelta`, used to rank the MODES of a
   230	 * `chooseModes` (they are only distinguishable by what their branches would do). A chooser inside a mode is
   231	 * priced as the policy's own best answer to it.
   232	 */
   233	function effectsValue(state: GameState, me: PlayerId, source: CardId, controller: PlayerId, effects: readonly Effect[]): number {
   234	  let v = 0
   235	  for (const eff of effects) {
   236	    if (eff.kind === 'chooseTargets') {
   237	      const { scores } = rankBy(targetCandidates(state, source, controller, eff.from), (id) => targetScore(state, me, source, eff.then, id))
   238	      const max = Math.min(eff.max, scores.length)
   239	      if (eff.min > scores.length) continue   // cannot legally resolve: the executor no-ops it
   240	      for (let k = 0; k < bestSize(scores, Math.min(eff.min, max), max); k++) v += scores[k] as number
   241	    } else if (eff.kind === 'forEach') {
   242	      for (const id of targetCandidates(state, source, controller, eff.from)) v += targetScore(state, me, source, eff.do, id)
   243	    } else if (eff.kind === 'chooseModes') {
   244	      const { scores } = rankBy(eff.modes.map((_, i) => i), (i) => effectsValue(state, me, source, controller, eff.modes[i]?.effects ?? []))
   245	      const max = Math.min(eff.max, scores.length)
   246	      for (let k = 0; k < bestSize(scores, Math.min(eff.min, max), max); k++) v += scores[k] as number
   247	    }
   248	    // Everything else needs a `chosen` binding it does not have at this level, so it contributes nothing.
   249	  }
   250	  return v
   251	}
   252	
   253	function chooseTargetsCandidates(state: GameState, player: PlayerId, pending: Extract<Pending, { kind: 'chooseTargets' }>): Command[] {
   254	  const frame = state.resolution.active
   255	  const node = suspendedEffect(state)
   256	  if (!frame || node?.kind !== 'chooseTargets') return legalCommands(state, player).filter((c) => c.type === 'chooseTargets')
   257	  const { ranked, scores } = rankBy(pending.candidates, (id) => targetScore(state, player, frame.source, node.then, id))
   258	  const picks = policyChoices(ranked, scores, pending.min, Math.min(pending.max, ranked.length))
   259	  // Sorted so the emitted command is structurally identical to the one `legalCommands` lists for the same set.
   260	  // Target order is semantically irrelevant (`applyChooseTargets` is order-insensitive), but any consumer that
   261	  // matches an AI command against `legalCommands` by deep equality — the web's `sameCommand` is the obvious one —
   262	  // would otherwise fail to find a perfectly legal answer, because the policy emits best-first.
   263	  return picks.map((targets) => ({ type: 'chooseTargets', player, targets: [...targets].sort((a, b) => a - b) }))
   264	}
   265	
   266	function chooseModeCandidates(state: GameState, player: PlayerId, pending: Extract<Pending, { kind: 'chooseMode' }>): Command[] {
   267	  const frame = state.resolution.active
   268	  const node = suspendedEffect(state)
   269	  if (!frame || node?.kind !== 'chooseModes') return legalCommands(state, player).filter((c) => c.type === 'chooseMode')
   270	  const { ranked, scores } = rankBy(node.modes.map((_, i) => i), (i) => effectsValue(state, player, frame.source, frame.controller, node.modes[i]?.effects ?? []))
   271	  const picks = policyChoices(ranked, scores, pending.min, Math.min(pending.max, ranked.length))
   272	  return picks.map((modes) => ({ type: 'chooseMode', player, modes: [...modes].sort((a, b) => a - b) }))
   273	}
   274	
   275	export function candidateCommands(state: GameState, player: PlayerId): Command[] {
   276	  if (state.result || actingPlayer(state) !== player) return []
   277	  const out: Command[] = []
   278	  const pending = state.pending
   279	  if (pending) {
   280	    switch (pending.kind) {
   281	      case 'chooseFirst': return [{ type: 'chooseFirst', player, goFirst: true }, { type: 'chooseFirst', player, goFirst: false }]
   282	      case 'mulligan': return [{ type: 'mulligan', player, redraw: false }, { type: 'mulligan', player, redraw: true }]
   283	      case 'discardToHandSize': {
   284	        const byValue = [...state.players[player].hand].sort((a, b) => cardValue(defOf(state, a)) - cardValue(defOf(state, b)))
   285	        return [{ type: 'discardToHandSize', player, cards: byValue.slice(0, pending.count) }]
   286	      }
   287	      case 'declareBlock': return [{ type: 'declareBlock', player, blocker: null }, ...legalBlockers(state, player).map((blocker) => ({ type: 'declareBlock' as const, player, blocker }))]
   288	      case 'assignPartyDamage': return legalPartyDamageAssignments(state).map((assignments) => ({ type: 'assignPartyDamage' as const, player, assignments }))
   289	      case 'chooseTargets': return chooseTargetsCandidates(state, player, pending)
   290	      case 'chooseMode': return chooseModeCandidates(state, player, pending)
   291	      // W3: exhaustive — a new Pending kind must fail to compile here rather than silently falling through to phase generation.
   292	      default: { const _exhaustive: never = pending; return _exhaustive }
   293	    }
   294	  }
   295	  if (state.phase === 'main1' || state.phase === 'main2') {
   296	    for (const card of state.players[player].hand) {
   297	      if (castCheck(state, player, card) !== null) continue
   298	      const payment = preferredPayment(state, player, card)
   299	      if (!payment) continue
   300	      out.push({ type: defOf(state, card).type === 'summon' ? 'castSummon' : 'castCharacter', player, card, payment })
   301	    }
   302	    out.push({ type: 'pass', player })
   303	  } else if (state.phase === 'attack' && state.attack?.step === 'declaration') {
   304	    for (const attackers of boundedAttackSets(state, player)) out.push({ type: 'declareAttack', player, attackers })
   305	    out.push({ type: 'pass', player })

exec
/bin/zsh -lc "rg -n \"usingFallback|nextSeed|FALLBACK_WARNING|startupWatchdog\" apps packages -g '*.ts' -g '*.tsx'" in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
apps/web/test/useGame.test.ts:15:  FALLBACK_WARNING, searchSeed,
apps/web/test/useGame.test.ts:815:    fallbacks: () => lines.filter((l) => l.kind === 'warning' && l.text.includes(FALLBACK_WARNING)),
apps/web/src/game/search/coordinator.ts:112:  readonly startupWatchdogMs?: number | undefined
apps/web/src/game/search/coordinator.ts:121:export const FALLBACK_WARNING =
apps/web/src/game/search/coordinator.ts:165:  get usingFallback(): boolean {
apps/web/src/game/search/coordinator.ts:170:  get nextSeed(): number {
apps/web/src/game/search/coordinator.ts:220:        seed: this.nextSeed,
apps/web/src/game/search/coordinator.ts:235:      ? this.opts.startupWatchdogMs ?? DEFAULT_STARTUP_WATCHDOG_MS
apps/web/src/game/search/coordinator.ts:339:    handlers.onWarning(`${FALLBACK_WARNING} (${this.failureReason})`)
apps/web/test/search-coordinator.test.ts:8:  FALLBACK_WARNING, SearchCoordinator, searchSeed, workerTransport,
apps/web/test/search-coordinator.test.ts:151:    startupWatchdogMs: STARTUP_WATCHDOG_MS,
apps/web/test/search-coordinator.test.ts:170:  expect(h.warnings[0]).toContain(FALLBACK_WARNING)
apps/web/test/search-coordinator.test.ts:171:  expect(h.coordinator.usingFallback).toBe(true)
apps/web/test/search-coordinator.test.ts:516:    expect(h.coordinator.usingFallback).toBe(true)
apps/web/test/search-coordinator.test.ts:531:    expect(h.coordinator.usingFallback).toBe(true)
apps/web/test/search-coordinator.test.ts:565:    expect(h.coordinator.usingFallback).toBe(true)
apps/web/test/search-coordinator.test.ts:604:    expect(h.coordinator.nextSeed).toBe(searchSeed(GAME_SEED, 1))

exec
/bin/zsh -lc "nl -ba apps/web/package.json
nl -ba package.json
nl -ba apps/web/test/search-coordinator.test.ts | sed -n '124,180p;470,610p'" in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
     1	{
     2	  "name": "@fftcg/web",
     3	  "version": "0.0.0",
     4	  "private": true,
     5	  "type": "module",
     6	  "scripts": {
     7	    "dev": "vite",
     8	    "build": "vite build",
     9	    "preview": "vite preview",
    10	    "fetch-images": "tsx scripts/fetch-images.ts"
    11	  },
    12	  "dependencies": {
    13	    "@fftcg/ai": "workspace:*",
    14	    "@fftcg/cards": "workspace:*",
    15	    "@fftcg/engine": "workspace:*",
    16	    "react": "^19.0.0",
    17	    "react-dom": "^19.0.0"
    18	  },
    19	  "devDependencies": {
    20	    "@types/react": "^19.0.0",
    21	    "@types/react-dom": "^19.0.0",
    22	    "@vitejs/plugin-react": "^5.0.0",
    23	    "vite": "^7.0.0"
    24	  }
    25	}
     1	{
     2	  "name": "fftcg-game",
     3	  "private": true,
     4	  "type": "module",
     5	  "packageManager": "pnpm@11.20.0",
     6	  "engines": { "node": ">=22" },
     7	  "scripts": {
     8	    "test": "vitest run",
     9	    "test:watch": "vitest",
    10	    "typecheck": "tsc -b packages/engine packages/cards packages/ai apps/cli apps/web",
    11	    "lint": "eslint ."
    12	  },
    13	  "devDependencies": {
    14	    "@types/node": "^24.0.0",
    15	    "eslint": "^9.0.0",
    16	    "tsx": "^4.19.0",
    17	    "typescript": "^5.6.0",
    18	    "typescript-eslint": "^8.0.0",
    19	    "vitest": "^3.0.0"
    20	  }
    21	}
   124	function harness(opts: { seed?: number; factory?: SearchTransportFactory; onCreate?: (t: FakeTransport) => void } = {}): Harness {
   125	  const clock = new FakeClock()
   126	  const transports: FakeTransport[] = []
   127	  const delivered: { command: Command; state: GameState }[] = []
   128	  const warnings: string[] = []
   129	  let current = aiToAct(opts.seed ?? 11)
   130	  let commits = true
   131	
   132	  const handlers: SearchRequestHandlers = {
   133	    onCommand: (command, forState) => { delivered.push({ command, state: forState }); return commits },
   134	    onWarning: (text) => { warnings.push(text) },
   135	  }
   136	  const factory: SearchTransportFactory = opts.factory ?? ((h) => {
   137	    const t = new FakeTransport(h)
   138	    transports.push(t)
   139	    opts.onCreate?.(t)
   140	    return t
   141	  })
   142	  const coordinator = new SearchCoordinator({
   143	    decks: DECKS,
   144	    gameSeed: GAME_SEED,
   145	    readState: () => current,
   146	    stepMs: STEP_MS,
   147	    iterations: 25,
   148	    rolloutCommandCap: 8,
   149	    explorationC: 1,
   150	    watchdogMs: WATCHDOG_MS,
   151	    startupWatchdogMs: STARTUP_WATCHDOG_MS,
   152	    createTransport: factory,
   153	    clock,
   154	  })
   155	  return {
   156	    clock, coordinator, transports, delivered, warnings, handlers,
   157	    transport: () => { const t = transports[0]; if (!t) throw new Error('no transport was created'); return t },
   158	    readState: () => current,
   159	    setState: (s) => { current = s },
   160	    setCommit: (v) => { commits = v },
   161	  }
   162	}
   163	
   164	/** The whole point of the fallback: whatever went wrong, a command still arrives on the same deadline. */
   165	function expectOneWarningAndACommand(h: Harness): void {
   166	  expect(h.delivered).toHaveLength(0)
   167	  h.clock.advance(STEP_MS)
   168	  expect(h.delivered).toHaveLength(1)
   169	  expect(h.warnings).toHaveLength(1)
   170	  expect(h.warnings[0]).toContain(FALLBACK_WARNING)
   171	  expect(h.coordinator.usingFallback).toBe(true)
   172	  const only = h.delivered[0]
   173	  if (!only) throw new Error('unreachable')
   174	  expect(legalCommands(only.state, AI).some((c) => c.type === only.command.type)).toBe(true)
   175	}
   176	
   177	// ---------------------------------------------------------------------------
   178	
   179	describe('searchSeed (D2-3)', () => {
   180	  it('is a pure function of (gameSeed, decisionIndex)', () => {
   470	  /**
   471	   * The failure funnel must RECOVER, never merely give up. `fail()` used to `invalidate()` — cancelling the
   472	   * outstanding request and any pending delivery — and then return early whenever the error did not correlate
   473	   * with what was live, scheduling no move and emitting no warning. The AI then never acted again: the effect
   474	   * keys on the committed state, which never changes, so nothing re-requests. Silent hang, spinner up, empty
   475	   * log — the inverse of the silent degradation D2-6 exists to forbid, and worse, because it stops the game.
   476	   */
   477	  it('recovers even when the error names a request that is no longer the live one', () => {
   478	    const h = harness()
   479	    h.coordinator.request(h.readState(), h.handlers)
   480	    const t = h.transport()
   481	    const superseded = t.searches[0]?.requestId ?? 0
   482	    h.coordinator.invalidate()
   483	    h.coordinator.request(h.readState(), h.handlers)   // a newer request is now outstanding
   484	    t.handlers.message({ type: 'error', requestId: superseded, message: 'worker blew up on the old request' })
   485	    expectOneWarningAndACommand(h)
   486	  })
   487	
   488	  it('does not cancel a fallback move that a previous failure already scheduled', () => {
   489	    const h = harness()
   490	    h.coordinator.request(h.readState(), h.handlers)
   491	    const t = h.transport()
   492	    t.handlers.failure('first failure')
   493	    // A second failure landing inside the fallback's own pacing window must leave the queued Greedy move alone.
   494	    t.handlers.failure('second failure')
   495	    expectOneWarningAndACommand(h)
   496	  })
   497	
   498	  it('falls back on an init failure, which carries no requestId', () => {
   499	    const h = harness()
   500	    h.coordinator.request(h.readState(), h.handlers)
   501	    h.transport().handlers.message({ type: 'error', requestId: null, message: 'search worker received a request before init' })
   502	    expectOneWarningAndACommand(h)
   503	  })
   504	
   505	  // The one failure with no correlated event of any kind: a worker that is killed or hangs.
   506	  it('falls back when the worker simply never replies', () => {
   507	    const h = harness()
   508	    h.coordinator.request(h.readState(), h.handlers)
   509	    expect(h.delivered).toHaveLength(0)
   510	
   511	    h.clock.advance(STARTUP_WATCHDOG_MS)
   512	    // The deadline is long past by now, so the Greedy command lands on the same tick.
   513	    expect(h.delivered).toHaveLength(1)
   514	    expect(h.warnings).toHaveLength(1)
   515	    expect(h.warnings[0]).toContain('did not respond')
   516	    expect(h.coordinator.usingFallback).toBe(true)
   517	    expect(h.transport().terminations).toBe(1)
   518	  })
   519	
   520	  it('uses the shorter watchdog once the worker has started', () => {
   521	    const h = harness()
   522	    const state = h.readState()
   523	    h.coordinator.request(state, h.handlers)
   524	    const t = h.transport()
   525	    t.handlers.message(resultFor(state, t.searches[0]?.requestId ?? 0))
   526	    h.clock.advance(STEP_MS)
   527	    expect(h.delivered).toHaveLength(1)
   528	
   529	    h.coordinator.request(state, h.handlers)
   530	    h.clock.advance(WATCHDOG_MS)
   531	    expect(h.coordinator.usingFallback).toBe(true)
   532	    expect(h.delivered).toHaveLength(2)
   533	  })
   534	
   535	  it('warns once per game, however many things go wrong', () => {
   536	    const h = harness()
   537	    const state = h.readState()
   538	    h.coordinator.request(state, h.handlers)
   539	    h.transport().handlers.failure('first failure')
   540	    h.clock.advance(STEP_MS)
   541	    h.transport().handlers.failure('second failure')
   542	
   543	    h.coordinator.request(state, h.handlers)
   544	    h.clock.advance(STEP_MS)
   545	    h.coordinator.request(state, h.handlers)
   546	    h.clock.advance(STEP_MS)
   547	
   548	    expect(h.warnings).toHaveLength(1)
   549	    expect(h.warnings[0]).toContain('first failure')
   550	    expect(h.delivered).toHaveLength(3)
   551	  })
   552	
   553	  // A worker can die between decisions, when there is no handler to warn through. The warning must not be lost.
   554	  it('defers the warning to the next request when nothing was outstanding', () => {
   555	    const h = harness()
   556	    const state = h.readState()
   557	    h.coordinator.request(state, h.handlers)
   558	    const t = h.transport()
   559	    t.handlers.message(resultFor(state, t.searches[0]?.requestId ?? 0))
   560	    h.clock.advance(STEP_MS)
   561	    expect(h.delivered).toHaveLength(1)
   562	
   563	    t.handlers.failure('the worker died between decisions')
   564	    expect(h.warnings).toHaveLength(0)
   565	    expect(h.coordinator.usingFallback).toBe(true)
   566	
   567	    h.coordinator.request(state, h.handlers)
   568	    h.clock.advance(STEP_MS)
   569	    expect(h.warnings).toHaveLength(1)
   570	    expect(h.warnings[0]).toContain('died between decisions')
   571	    expect(h.delivered).toHaveLength(2)
   572	  })
   573	
   574	  it('never builds another worker once it has fallen back', () => {
   575	    const h = harness()
   576	    h.coordinator.request(h.readState(), h.handlers)
   577	    h.transport().handlers.failure('gone')
   578	    h.clock.advance(STEP_MS)
   579	    h.coordinator.request(h.readState(), h.handlers)
   580	    h.clock.advance(STEP_MS)
   581	    expect(h.transports).toHaveLength(1)
   582	    expect(h.transport().searches).toHaveLength(1)
   583	  })
   584	
   585	  // The fallback carries the same staleness and pacing rules, or it would corrupt games the worker never touched.
   586	  it('drops a fallback command when the position moves on inside the deadline', () => {
   587	    const h = harness()
   588	    const state = h.readState()
   589	    h.coordinator.request(state, h.handlers)
   590	    h.transport().handlers.failure('gone')
   591	    h.setState(apply(state, { type: 'concede', player: HUMAN }).state)
   592	    h.clock.advance(STEP_MS * 4)
   593	    expect(h.delivered).toHaveLength(0)
   594	    expect(h.warnings).toHaveLength(1)
   595	  })
   596	
   597	  it('keeps advancing the per-position seed under the fallback', () => {
   598	    const h = harness()
   599	    const state = h.readState()
   600	    h.coordinator.request(state, h.handlers)
   601	    h.transport().handlers.failure('gone')
   602	    h.clock.advance(STEP_MS)
   603	    expect(h.delivered).toHaveLength(1)
   604	    expect(h.coordinator.nextSeed).toBe(searchSeed(GAME_SEED, 1))
   605	  })
   606	})

exec
/bin/zsh -lc "nl -ba apps/web/src/ui/PromptStrip.tsx | sed -n '1,100p'
nl -ba apps/web/src/ui/Board.tsx | sed -n '145,180p'
nl -ba apps/web/src/game/commands.ts | sed -n '250,335p'" in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
     1	import type { CSSProperties, JSX } from 'react'
     2	import type { PlayerView } from '@fftcg/engine'
     3	import type { Choice, ChoiceSet } from '../game/types.js'
     4	import { HUMAN } from '../game/types.js'
     5	
     6	const PHASE_LABEL: Record<string, string> = {
     7	  setup: 'Setup', active: 'Active Phase', draw: 'Draw Phase', main1: 'Main Phase 1',
     8	  attack: 'Attack Phase', main2: 'Main Phase 2', end: 'End Phase',
     9	}
    10	
    11	/*
    12	 * A mode button carries the card's PRINTED wording verbatim — a whole sentence, not a two-word verb like the
    13	 * rest of the strip. So ability buttons drop `.btn`'s uppercase/tracking, wrap, and cap their width, and the
    14	 * row wraps under them instead of pushing the strip off the side. Inline because this rung owns PromptStrip.tsx
    15	 * and not styles.css; every value below is a token the sheet already defines.
    16	 */
    17	const ACTIONS_WRAP: CSSProperties = { flexWrap: 'wrap', justifyContent: 'flex-end' }
    18	const ABILITY_BTN: CSSProperties = {
    19	  textTransform: 'none', letterSpacing: '0.01em', fontWeight: 500,
    20	  maxWidth: '26rem', whiteSpace: 'normal', textAlign: 'left',
    21	}
    22	const isAbility = (c: Choice): boolean => c.command.type === 'chooseMode' || c.command.type === 'chooseTargets'
    23	
    24	/**
    25	 * The strip is the app's answer to "what am I supposed to do?" — spec B5 requires it to always say whose turn
    26	 * it is and what the game is waiting for. Every command with no card subject (pass, mulligan, concede, the
    27	 * no-block option) is a button here, plus whatever the currently selected card can do.
    28	 */
    29	export function PromptStrip({ view, choices, shown, aiThinking, onChoose }: {
    30	  view: PlayerView
    31	  choices: ChoiceSet
    32	  shown: Choice[]
    33	  aiThinking: boolean
    34	  onChoose: (c: Choice) => void
    35	}): JSX.Element {
    36	  const yours = !view.result && (view.pending?.player ?? view.priority) === HUMAN
    37	  const phase = `Turn ${view.turn} · ${PHASE_LABEL[view.phase] ?? view.phase}`
    38	  // Some decisions have no button of their own because every one of their commands names a card — discarding to
    39	  // hand size is the clearest case: the strip would otherwise offer nothing but Concede and read as a dead end
    40	  // until the player guesses that hand cards are clickable. Say it instead.
    41	  // `chooseTargets` is the same case wearing a disguise: the "choose no targets" answer IS a strip button, so
    42	  // the strip is not empty — but every actual target still has to be clicked on the board, and saying so is the
    43	  // only thing that tells the player the highlighted Forwards are the point (spec B-A4).
    44	  const picking = yours && view.pending?.kind === 'chooseTargets'
    45	  const cardOnly = yours && choices.byCard.size > 0 && (picking || !shown.some((c) => c.command.type !== 'concede'))
    46	  const text = view.result ? 'Game over'
    47	    : aiThinking ? 'The AI is thinking'
    48	    : !yours ? 'Waiting for the AI'
    49	    // "·", not the em-dash the rest of the strip uses: rung C2 spends the dash on the trigger's CAUSE ("The
    50	    // AI's Luso was broken — Lightning: choose 1 Forward…"), and a second one would read as a third clause of
    51	    // the same sentence rather than as the standing instruction it is.
    52	    : cardOnly ? `${choices.prompt} · click a highlighted card`
    53	    : choices.prompt
    54	  return (
    55	    <div className="prompt table__prompt">
    56	      <span className={yours ? 'prompt__phase prompt__phase--yours' : 'prompt__phase'}>{phase}</span>
    57	      <span className="prompt__text">
    58	        {text}
    59	        {aiThinking && <span className="thinking" aria-hidden="true"><span /><span /><span /></span>}
    60	      </span>
    61	      <div className="prompt__actions" style={ACTIONS_WRAP}>
    62	        {yours && shown.map((c, i) => (
    63	          <button
    64	            key={i}
    65	            className={c.command.type === 'concede' ? 'btn btn--danger' : c.command.type === 'pass' ? 'btn btn--ghost' : 'btn btn--primary'}
    66	            style={isAbility(c) ? ABILITY_BTN : undefined}
    67	            onClick={() => onChoose(c)}
    68	          >
    69	            {c.label}
    70	          </button>
    71	        ))}
    72	      </div>
    73	    </div>
    74	  )
    75	}
   145	      <Card
   146	        key={id}
   147	        code={d?.code ?? '?'}
   148	        name={d?.name ?? 'Unknown'}
   149	        cost={d?.cost ?? 0}
   150	        elements={d?.elements ?? []}
   151	        type={d?.type ?? 'forward'}
   152	        power={d?.power ?? null}
   153	        selectable
   154	        selected={selected === id}
   155	        size="small"
   156	        onClick={() => pick(id)}
   157	      />
   158	    )
   159	  })
   160	
   161	  return (
   162	    <div className="table">
   163	      <section className="table__seat table__seat--opponent">
   164	        <Seat v={view} p={AI} active={view.priority === AI || view.pending?.player === AI} />
   165	        <Zone label="AI Backups" compact empty={!view.fields[AI].backups.length}>{field(AI, 'backups')}</Zone>
   166	        <Zone label="AI Forwards" empty={!view.fields[AI].forwards.length}>{field(AI, 'forwards')}</Zone>
   167	      </section>
   168	
   169	      <PromptStrip view={view} choices={choices} shown={shown} aiThinking={aiThinking} onChoose={(c) => { setSelected(null); choose(c) }} />
   170	
   171	      {/* `.table__seat--player` is column-reverse, so this list reads bottom-up on screen: the status bar sits
   172	          at the outer edge and forwards end up nearest the prompt strip, meeting the AI's across it. */}
   173	      <section className="table__seat table__seat--player">
   174	        <Seat v={view} p={HUMAN} active={view.priority === HUMAN || view.pending?.player === HUMAN} />
   175	        <Zone label="Your Backups" compact empty={!view.fields[HUMAN].backups.length}>{field(HUMAN, 'backups')}</Zone>
   176	        <Zone label="Your Forwards" empty={!view.fields[HUMAN].forwards.length}>{field(HUMAN, 'forwards')}</Zone>
   177	      </section>
   178	
   179	      <section className="table__hand">
   180	        {orphanCards.length > 0 && <Zone label="Choose a card" compact empty={false}>{orphanCards}</Zone>}
   250	    case 'assignPartyDamage': return `Assign damage: ${c.assignments.map((a) => `${a.amount} → ${name(v, a.target)}`).join(', ')}`
   251	    case 'discardToHandSize': return `Discard ${c.cards.map((id) => name(v, id)).join(', ')}`
   252	    case 'pass': return 'Pass'
   253	    case 'concede': return 'Concede'
   254	  }
   255	}
   256	
   257	/** Mirrors `legalCommands`/`actingPlayer` against the view: `pending` outranks `priority` (see engine `legal.ts`). */
   258	function actingIn(v: PlayerView): PlayerId | null {
   259	  if (v.result) return null
   260	  return v.pending?.player ?? v.priority
   261	}
   262	
   263	/** One line stating what the game is waiting for, derived from `pending` first, then `phase`/`attack.step`. */
   264	export function promptFor(v: PlayerView): string {
   265	  if (v.result) return v.result.winner === null ? 'Game over — a draw' : v.result.winner === v.me ? 'Game over — you win' : 'Game over — the AI wins'
   266	  if (actingIn(v) !== v.me) return 'Waiting for the opponent…'
   267	  if (v.pending) {
   268	    switch (v.pending.kind) {
   269	      case 'chooseFirst': return 'Choose who goes first'
   270	      case 'mulligan': return 'Keep your hand or mulligan'
   271	      case 'discardToHandSize': return `Discard down to ${HAND_SIZE_LIMIT} cards`
   272	      case 'declareBlock': return 'Choose a blocker'
   273	      case 'assignPartyDamage': return 'Assign combat damage'
   274	      // Both ability prompts name the card that is asking and what the choice is FOR — "choose 2 targets" tells
   275	      // the player nothing they can act on. The wording is derived from the clause's own AST, never hard-coded.
   276	      case 'chooseTargets': {
   277	        const { min, max, candidates } = v.pending
   278	        const purpose = targetVerb(v, v.pending)?.purpose
   279	        return caused(v, sourced(v, `Choose ${countPhrase(min, max)} ${candidateNoun(v, candidates, max !== 1)}${purpose ? ` ${purpose}` : ''}`))
   280	      }
   281	      case 'chooseMode': {
   282	        const { min, max, labels } = v.pending
   283	        return caused(v, sourced(v, `Choose ${countPhrase(min, max)} of the ${labels.length} following effect${labels.length === 1 ? '' : 's'}`))
   284	      }
   285	    }
   286	  }
   287	  switch (v.phase) {
   288	    case 'main1': return 'Main Phase 1 — cast, attack, or pass'
   289	    case 'main2': return 'Main Phase 2 — cast or pass'
   290	    case 'attack': return v.attack?.step === 'declaration' ? 'Attack Phase — declare an attack or pass' : `Attack Phase — ${v.attack?.step ?? 'resolving'}`
   291	    default: return `${PHASE_LABEL[v.phase] ?? v.phase} — nothing to do`
   292	  }
   293	}
   294	
   295	/** Every card a command acts on. Order matters: the first is the click-target `Choice.card` hangs off. */
   296	function subjectsOf(c: Command): CardId[] {
   297	  switch (c.type) {
   298	    case 'castCharacter':
   299	    case 'castSummon': return [c.card]
   300	    case 'declareAttack': return c.attackers
   301	    case 'declareBlock': return c.blocker === null ? [] : [c.blocker]
   302	    case 'assignPartyDamage': return c.assignments.map((a) => a.target)
   303	    case 'discardToHandSize': return c.cards
   304	    // Spec B-A4 + C1-6: the subjects of a target answer are exactly its targets, so the board lights up the
   305	    // legal candidates and nothing else — clicking one is how the set gets picked.
   306	    case 'chooseTargets': return [...c.targets]
   307	    // `chooseMode` has no card subject at all: its options are printed wordings, so they are strip buttons.
   308	    case 'chooseFirst': case 'mulligan': case 'chooseMode': case 'pass': case 'concede': return []
   309	    default: { const _exhaustive: never = c; return _exhaustive }
   310	  }
   311	}
   312	
   313	/**
   314	 * Group `legal` into the click map the board renders from. Spec B-A4: a card is clickable IFF it is a key of
   315	 * `byCard`, so an illegal click is unrepresentable rather than rejected after the fact. A command with several
   316	 * subjects (a multi-forward attack party, a damage split, a multi-card discard) is listed under *every* one of
   317	 * them — clicking any member of a party has to offer that party — while `Choice.card`, which is singular, keeps
   318	 * the first as the label's anchor.
   319	 */
   320	export function buildChoiceSet(v: PlayerView, legal: Command[]): ChoiceSet {
   321	  const all: Choice[] = []
   322	  const byCard = new Map<CardId, Choice[]>()
   323	  const loose: Choice[] = []
   324	  for (const command of legal) {
   325	    const subjects = subjectsOf(command)
   326	    const choice: Choice = { command, label: describeChoice(v, command), card: subjects[0] ?? null }
   327	    all.push(choice)
   328	    if (!subjects.length) { loose.push(choice); continue }
   329	    for (const id of subjects) byCard.set(id, [...(byCard.get(id) ?? []), choice])
   330	  }
   331	  return { all, byCard, loose, prompt: promptFor(v) }
   332	}
   333	
   334	function sameIds(a: readonly CardId[], b: readonly CardId[]): boolean {
   335	  if (a.length !== b.length) return false

exec
/bin/zsh -lc "nl -ba apps/web/src/game/commands.ts | sed -n '334,375p'
nl -ba packages/ai/src/ismcts/search.ts | sed -n '360,420p'" in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
   334	function sameIds(a: readonly CardId[], b: readonly CardId[]): boolean {
   335	  if (a.length !== b.length) return false
   336	  const sortedB = [...b].sort((x, y) => x - y)
   337	  return [...a].sort((x, y) => x - y).every((id, i) => id === sortedB[i])
   338	}
   339	
   340	/** Payments are sets of sources, not sequences — `legalCommands` and `preferredPayment` build them in different orders. */
   341	export function samePayment(a: Payment, b: Payment): boolean {
   342	  if (!sameIds(a.dullBackups, b.dullBackups)) return false
   343	  if (a.discards.length !== b.discards.length) return false
   344	  const key = (d: Payment['discards'][number]) => `${d.card}:${d.element}`
   345	  const bKeys = b.discards.map(key).sort()
   346	  return a.discards.map(key).sort().every((k, i) => k === bKeys[i])
   347	}
   348	
   349	/** Structural equality, used by `useGame.choose` to prove a command is in the current legal set before applying. */
   350	export function sameCommand(a: Command, b: Command): boolean {
   351	  if (a.type !== b.type || a.player !== b.player) return false
   352	  switch (a.type) {
   353	    case 'chooseFirst': return a.goFirst === (b as typeof a).goFirst
   354	    case 'mulligan': return a.redraw === (b as typeof a).redraw
   355	    case 'castCharacter':
   356	    case 'castSummon': return a.card === (b as typeof a).card && samePayment(a.payment, (b as typeof a).payment)
   357	    case 'declareAttack': return sameIds(a.attackers, (b as typeof a).attackers)
   358	    case 'declareBlock': return a.blocker === (b as typeof a).blocker
   359	    case 'assignPartyDamage': {
   360	      const key = (x: { target: CardId; amount: number }) => `${x.target}:${x.amount}`
   361	      const other = (b as typeof a).assignments.map(key).sort()
   362	      return a.assignments.length === other.length && a.assignments.map(key).sort().every((k, i) => k === other[i])
   363	    }
   364	    case 'discardToHandSize': return sameIds(a.cards, (b as typeof a).cards)
   365	    case 'chooseTargets': return sameIds([...a.targets], [...(b as typeof a).targets])
   366	    case 'chooseMode': return sameIds([...a.modes], [...(b as typeof a).modes])
   367	    case 'pass': case 'concede': return true
   368	    default: { const _exhaustive: never = a; return _exhaustive }
   369	  }
   370	}
   371	
   372	type CastCommand = Extract<Command, { type: 'castCharacter' | 'castSummon' }>
   373	const isCast = (c: Command): c is CastCommand => c.type === 'castCharacter' || c.type === 'castSummon'
   374	
   375	/**
   360	    let commands = 0
   361	
   362	    for (;;) {
   363	      // No `resolveForcedDecisions` anywhere in this loop (D-3). `apply` already settled the state to the next
   364	      // decision boundary, whoever owns it — a block, a party-damage split and an ability prompt are all
   365	      // genuine plies. Draining here would, at the root, have the rollout policy answer the very question the
   366	      // caller asked `decide` to answer.
   367	      if (state.result) break
   368	      const actor = actorOf(view)
   369	      const cands = candidateCommands(state, actor)
   370	      if (cands.length === 0) break
   371	
   372	      // Action keys are built from the ACTOR's view, not the root's. Every command in this pool has a public
   373	      // effect — a cast reveals the card, a discard puts it face up in the Break Zone, attacks/blocks/targets
   374	      // are all open — so naming the card leaks nothing the root will not observe a moment later.
   375	      //
   376	      // Keying an opponent cast from the ROOT's view instead collapses every hand cast onto one opaque
   377	      // `castCharacter|p1|?|…` edge. Measured, that pooled a 1-cost Backup with an 8000 Forward, and which one
   378	      // the world played was then drawn from the tie stream — so the modelled opponent chose among materially
   379	      // different cards UNIFORMLY AT RANDOM at the commonest decision in the game, and the availability
   380	      // counter went inert exactly where it exists to work (A tracked node visits, because the pooled edge was
   381	      // available in every world). Conditioning on the determinisation is what ISMCTS already does; pricing an
   382	      // action that only some worlds offer is precisely what `availability` is for.
   383	      //
   384	      // The OBSERVATION key stays root-only — that is where single-observer fairness actually lives.
   385	      const keyView = actor === null || actor === root ? view : searchView(state, actor)
   386	      const byKey = new Map<ActionKey, Command[]>()
   387	      const available: ActionKey[] = []
   388	      for (const c of cands) {
   389	        const key = actionKey(keyView, c)
   390	        const group = byKey.get(key)
   391	        if (group) group.push(c)
   392	        else { byKey.set(key, [c]); available.push(key) }
   393	      }
   394	      if (node === rootNode) for (const key of available) if (!rootCommands.has(key)) rootCommands.set(key, (byKey.get(key) as Command[])[0] as Command)
   395	
   396	      const { key, expansion } = selectKey(node, available, root, input.explorationC, streams)
   397	      const group = byKey.get(key) as Command[]
   398	      const command = group.length === 1 ? (group[0] as Command) : draw(group, streams, 'tie')
   399	      const edge = edgeFor(node, key)
   400	      path.push({ node, edge, available })
   401	
   402	      state = apply(state, command).state
   403	      counters.treeApplies++
   404	      commands++
   405	      view = searchView(state, root)
   406	
   407	      if (state.result) break
   408	      const nextActor = actorOf(view)
   409	      const obs = observationKey(view)
   410	      let child = edge.children.get(obs)
   411	      if (!child) {
   412	        child = createNode(nextActor)
   413	        counters.nodes++
   414	        edge.children.set(obs, child)
   415	      } else if (child.actor !== nextActor) {
   416	        // Unreachable unless `observationKey` stopped identifying a decision point: the key carries `priority`
   417	        // and the entire `pending`, which is exactly what `actorOf` reads.
   418	        throw new Error(`ISMCTS: node actor ${child.actor} != ${nextActor} for one observation key`)
   419	      }
   420	      node = child

exec
/bin/zsh -lc "rg -n -C 2 '24-063H|20-074C|20-105C' packages/cards/data/cards.json packages/cards/src/abilities.ts" in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
packages/cards/data/cards.json-138-  },
packages/cards/data/cards.json-139-  {
packages/cards/data/cards.json:140:    "code": "20-074C",
packages/cards/data/cards.json-141-    "name": "Miner",
packages/cards/data/cards.json-142-    "type": "backup",
--
packages/cards/data/cards.json-168-  },
packages/cards/data/cards.json-169-  {
packages/cards/data/cards.json:170:    "code": "20-105C",
packages/cards/data/cards.json-171-    "name": "Reeve",
packages/cards/data/cards.json-172-    "type": "backup",
--
packages/cards/data/cards.json-198-  },
packages/cards/data/cards.json-199-  {
packages/cards/data/cards.json:200:    "code": "24-063H",
packages/cards/data/cards.json-201-    "name": "Hugh Yurg",
packages/cards/data/cards.json-202-    "type": "forward",
--
packages/cards/src/abilities.ts-38-  '18-124C': 1,   // ETB return a Forward from the Break Zone
packages/cards/src/abilities.ts-39-  '19-052C': 2,   // self-break: +4000 | remove from game: +2000
packages/cards/src/abilities.ts:40:  '20-074C': 2,   // ETB reveal 5 | [2][Dull], self-break: draw 1
packages/cards/src/abilities.ts-41-  '20-103H': 1,   // Summon, modal — the three quoted actions are one clause
packages/cards/src/abilities.ts:42:  '20-105C': 1,   // EX BURST ETB look at top 3
packages/cards/src/abilities.ts-43-  '22-068R': 2,   // when chosen: +2000 (deferred, spec C2-13) | on damaging the opponent: Break Zone retrieval
packages/cards/src/abilities.ts:44:  '24-063H': 2,   // ETB search | when a cost-1 Forward enters your field
packages/cards/src/abilities.ts-45-  '27-124S': 2,   // ETB mass pump | at the beginning of the Attack Phase
packages/cards/src/abilities.ts-46-  '27-125S': 2,   // on damaging a Forward: break it | on damaging the opponent: modal — both C2, so 0 warnings

exec
/bin/zsh -lc "nl -ba packages/cards/data/cards.json | sed -n '136,218p'" in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
   136	    "text": "Put Undead Princess into the Break Zone: Choose 1 Forward. It gains +4000 power until the end of the turn.\nRemove Undead Princess in the Break Zone from the game: Choose 1 Earth Forward. It gains +2000 power until the end of the turn. You can only use this ability during your Main Phase and if Undead Princess is in the Break Zone.",
   137	    "hasAbilities": true
   138	  },
   139	  {
   140	    "code": "20-074C",
   141	    "name": "Miner",
   142	    "type": "backup",
   143	    "elements": [
   144	      "earth"
   145	    ],
   146	    "cost": 3,
   147	    "power": null,
   148	    "keywords": [],
   149	    "generic": true,
   150	    "exBurst": false,
   151	    "text": "When Miner enters the field, reveal the top 5 cards of your deck. Add 1 Backup among them to your hand and return the other cards to the bottom of your deck in any order.\n[2][Dull], put Miner into the Break Zone: Draw 1 card.",
   152	    "hasAbilities": true
   153	  },
   154	  {
   155	    "code": "20-103H",
   156	    "name": "Ramuh",
   157	    "type": "summon",
   158	    "elements": [
   159	      "lightning"
   160	    ],
   161	    "cost": 2,
   162	    "power": null,
   163	    "keywords": [],
   164	    "generic": false,
   165	    "exBurst": false,
   166	    "text": "Select up to 2 of the 3 following actions.\n\"Choose 1 Forward. Dull it.\"\n\"Choose 1 Forward. Deal it 5000 damage.\"\n\"Choose 1 Forward. It gains Haste until the end of the turn.\"",
   167	    "hasAbilities": true
   168	  },
   169	  {
   170	    "code": "20-105C",
   171	    "name": "Reeve",
   172	    "type": "backup",
   173	    "elements": [
   174	      "lightning"
   175	    ],
   176	    "cost": 4,
   177	    "power": null,
   178	    "keywords": [],
   179	    "generic": false,
   180	    "exBurst": true,
   181	    "text": "EX BURST When Reeve enters the field, look at the top 3 cards of your deck. Add 1 card among them to your hand and return the other cards to the bottom of your deck in any order.",
   182	    "hasAbilities": true
   183	  },
   184	  {
   185	    "code": "22-068R",
   186	    "name": "Prishe",
   187	    "type": "forward",
   188	    "elements": [
   189	      "earth"
   190	    ],
   191	    "cost": 2,
   192	    "power": 5000,
   193	    "keywords": [],
   194	    "generic": false,
   195	    "exBurst": false,
   196	    "text": "When Prishe is chosen by a Summon or an ability, Prishe gains +2000 power until the end of the turn.\nWhen Prishe deals damage to your opponent, choose 1 Character in your Break Zone. Add it to your hand.",
   197	    "hasAbilities": true
   198	  },
   199	  {
   200	    "code": "24-063H",
   201	    "name": "Hugh Yurg",
   202	    "type": "forward",
   203	    "elements": [
   204	      "earth"
   205	    ],
   206	    "cost": 4,
   207	    "power": 8000,
   208	    "keywords": [],
   209	    "generic": false,
   210	    "exBurst": false,
   211	    "text": "When Hugh Yurg enters the field, you may search for 1 Earth Forward of cost 1 and play it onto the field.\nWhen a Forward of cost 1 enters your field, choose 1 Forward. Until the end of the turn, it gains +2000 power and Brave.",
   212	    "hasAbilities": true
   213	  },
   214	  {
   215	    "code": "27-124S",
   216	    "name": "Cloud",
   217	    "type": "forward",
   218	    "elements": [

exec
/bin/zsh -lc "rg -n \"export type FieldFlag|cannotBeReturned|moveToHand|ZoneTransition|toHand\" packages/engine/src packages/cards/src -g '*.ts'" in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
packages/engine/src/abilities.ts:66:  | { readonly kind: 'moveToHand' }
packages/engine/src/abilities.ts:77:export type FieldFlag = (typeof FIELD_FLAGS)[number]
packages/engine/src/rules.ts:37:export interface ZoneTransition {
packages/engine/src/rules.ts:60:export function pendingBreakTransitions(state: GameState): ZoneTransition[] {
packages/engine/src/rules.ts:61:  const out: ZoneTransition[] = []
packages/engine/src/resolve.ts:3:import type { ZoneTransition } from './rules.js'
packages/engine/src/resolve.ts:167:function toHand(state: GameState, id: CardId): GameState | null {
packages/engine/src/resolve.ts:312:      const moved: ZoneTransition[] = []
packages/engine/src/resolve.ts:354:    case 'moveToHand':
packages/engine/src/resolve.ts:356:        const moved = toHand(ctx.state, id)
packages/engine/src/resolve.ts:512:  readonly transition: ZoneTransition
packages/engine/src/resolve.ts:519:function watches(state: GameState, trigger: AbilityTrigger, watcher: PlayerId, t: ZoneTransition): boolean {
packages/engine/src/resolve.ts:547:function collectWatchers(state: GameState, transitions: readonly ZoneTransition[]): WatcherOccurrence[] {
packages/engine/src/resolve.ts:593:export function enqueueZoneChangeTriggers(pre: GameState, post: GameState, transitions: readonly ZoneTransition[]): GameState {
packages/cards/src/abilities.ts:145:    then: [{ kind: 'moveToHand' }],
packages/cards/src/abilities.ts:283:        effects: [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'breakZone', controller: 'self', filter: { types: CHARACTER } }, then: [{ kind: 'moveToHand' }] }],
packages/cards/src/abilities.ts:304:    then: [{ kind: 'moveToHand' }],

exec
/bin/zsh -lc "nl -ba packages/engine/src/abilities.ts | sed -n '55,85p'
nl -ba packages/engine/src/resolve.ts | sed -n '150,180p'
nl -ba packages/engine/src/rules.ts | sed -n '30,50p'" in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
    55	  | { readonly kind: 'chooseTargets'; readonly min: number; readonly max: number; readonly from: TargetSpec; readonly then: readonly Effect[] }
    56	  /** Choose `min..max` of `modes` ("select up to 2 of the 3 following"); chosen modes run in listed order. */
    57	  | { readonly kind: 'chooseModes'; readonly min: number; readonly max: number; readonly modes: readonly AbilityMode[] }
    58	  /** Run `do` once per card matching `from`, with `chosen` bound to that one card. Untargeted — no choice. */
    59	  | { readonly kind: 'forEach'; readonly from: TargetSpec; readonly do: readonly Effect[] }
    60	  | { readonly kind: 'dull' }
    61	  | { readonly kind: 'damage'; readonly amount: number }
    62	  | { readonly kind: 'breakCard' }
    63	  | { readonly kind: 'addPower'; readonly amount: number }
    64	  | { readonly kind: 'grantKeyword'; readonly keyword: Keyword }
    65	  | { readonly kind: 'grantFlag'; readonly flag: FieldFlag }
    66	  | { readonly kind: 'moveToHand' }
    67	  /**
    68	   * Act on the card the TRIGGER EVENT is about — Luso's "break **it**" (spec C2-5). Binds `chosen` to the
    69	   * event's subject and runs `do`, so every existing effect works on it unchanged. Deliberately NOT a target
    70	   * choice: "it" is named by the printed text, and offering it as a choice would let the player retarget a
    71	   * printed effect. A no-op when the frame has no trigger event, or the subject is not a card.
    72	   */
    73	  | { readonly kind: 'onSubject'; readonly do: readonly Effect[] }
    74	
    75	/** Until-end-of-turn protection that `granted: Keyword[]` cannot express (spec C1-7). */
    76	export const FIELD_FLAGS = ['cannotBeBroken'] as const
    77	export type FieldFlag = (typeof FIELD_FLAGS)[number]
    78	
    79	export interface AbilityMode {
    80	  /** Stable identifier, and the text the UI shows on the button. Quote the printed wording. */
    81	  readonly label: string
    82	  readonly effects: readonly Effect[]
    83	}
    84	
    85	/** Which side of the watcher a moved/damaged card must be on, relative to the WATCHER's controller. */
   150	function setFieldCard(state: GameState, id: CardId, f: (c: FieldCard) => FieldCard): GameState {
   151	  const loc = findFieldCard(state, id)
   152	  if (!loc) return state
   153	  return updatePlayer(state, loc.owner, (ps) => (loc.zone === 'forwards'
   154	    ? { ...ps, forwards: ps.forwards.map((c) => (c.id === id ? f(c) : c)) }
   155	    : { ...ps, backups: ps.backups.map((c) => (c.id === id ? f(c) : c))}))
   156	}
   157	
   158	function removeFromField(state: GameState, id: CardId): GameState {
   159	  const loc = findFieldCard(state, id)
   160	  if (!loc) return state
   161	  return updatePlayer(state, loc.owner, (ps) => (loc.zone === 'forwards'
   162	    ? { ...ps, forwards: ps.forwards.filter((c) => c.id !== id) }
   163	    : { ...ps, backups: ps.backups.filter((c) => c.id !== id) }))
   164	}
   165	
   166	/** §7.10: a card always goes to its OWNER's zone, not its controller's. Returns null if the card is nowhere movable. */
   167	function toHand(state: GameState, id: CardId): GameState | null {
   168	  const owner = state.cards[id]?.owner
   169	  if (owner === undefined) return null
   170	  let s = state
   171	  if (findFieldCard(state, id)) s = removeFromField(s, id)
   172	  else {
   173	    const holder = ([0, 1] as const).find((p) => state.players[p].breakZone.includes(id))
   174	    if (holder === undefined) return null
   175	    s = updatePlayer(s, holder, (ps) => ({ ...ps, breakZone: ps.breakZone.filter((x) => x !== id) }))
   176	  }
   177	  return updatePlayer(s, owner, (ps) => ({ ...ps, hand: [...ps.hand, id] }))
   178	}
   179	
   180	// ---------------------------------------------------------------------------
    30	
    31	/**
    32	 * A card leaving a zone, recorded with a PRE-transition snapshot (spec C1-8). Rule processing removes every
    33	 * affected Forward simultaneously and only then emits events; scanning the resulting field would lose the
    34	 * trigger of a card that died at the same instant, so triggers must be discovered from these records instead.
    35	 * `cause`/`causeController` is what C2 needs for Cloud's "cannot be returned by your OPPONENT's abilities".
    36	 */
    37	export interface ZoneTransition {
    38	  readonly card: CardId
    39	  /**
    40	   * The player whose field the card was on — the CONTROLLER. C1 called this field `owner`, which it never was:
    41	   * "a Forward OPPONENT CONTROLS" is a statement about the field array the card sat in (spec C2-2).
    42	   */
    43	  readonly controller: PlayerId
    44	  /** Real ownership, `CardInstance.owner` (§7.10) — where the card belongs, not who was playing it. */
    45	  readonly owner: PlayerId
    46	  readonly from: 'forwards' | 'backups'
    47	  readonly to: 'breakZone'
    48	  /** `ability` is a direct `breakCard`; the other two are the §12.4.4/§12.4.5 rule processes. */
    49	  readonly reason: 'zeroPower' | 'damage' | 'ability'
    50	  /** The card whose ability caused the transition; null for a rule process, which has no source. */

codex
## HIGH

**A rejected or throwing delivery permanently stalls the AI and can also skip a seed.**

`SearchCoordinator` clears `delivery`, advances `decisionIndex`, and calls the handler, but a `false` return only rolls the index back; it schedules no retry or fallback (`apps/web/src/game/search/coordinator.ts:357`, `apps/web/src/game/search/coordinator.ts:364`). `aiHandlers` returns `false` for an illegal worker command without changing state (`apps/web/src/game/useGame.ts:266`), so the state-keyed effect never reruns (`apps/web/src/game/useGame.ts:375`). If `produce()` or `onCommand()` throws, even the rollback is skipped. This is exactly the permanent spinner/no-state-change hang the repaired failure funnel was meant to eliminate.

**Fix:** Treat rejection as a worker failure and schedule Greedy for the same target. Wrap production and delivery in `try/finally`, always restore the provisional index on failure, and provide a last-resort legal-command policy if Greedy itself rejects or throws.

**A synchronous transport callback still enters fallback with no recovery target and returns without scheduling anything.**

Handlers are exposed during construction and posting, but `active` is not assigned until after both posts return (`apps/web/src/game/search/coordinator.ts:193`, `apps/web/src/game/search/coordinator.ts:207`, `apps/web/src/game/search/coordinator.ts:242`). If an injected transport synchronously invokes `failure()` or sends a typed error, `fail()` finds no target, active request, or delivery and returns at `apps/web/src/game/search/coordinator.ts:324`. `request()` then sees `fallback` and returns without arming a watchdog (`apps/web/src/game/search/coordinator.ts:228`). Native Worker events are asynchronous, but the transport contract does not require that—and the comment explicitly anticipates synchronous failure.

**Fix:** Establish a pending target before creating/exposing the transport and before posting. Let `fail()` recover from that target, and check for fallback immediately after factory return. Alternatively, explicitly require asynchronous callbacks in `SearchTransportFactory` and enforce that in adapters/tests.

## MEDIUM

**The seed transaction is not order-independent when a rejecting handler re-enters the coordinator.**

The provisional increment lets a successful handler synchronously request the next position with seed N+1 (`apps/web/src/game/search/coordinator.ts:362`). But if that reentrant handler requests and then returns `false`, the new request was posted with N+1 before the counter rolls back to N (`apps/web/src/game/search/coordinator.ts:365`). If that request commits, the following position reuses N+1. Normal React delivery does not re-enter synchronously, so ordinary production commits are sound; the coordinator’s stated generality is not.

**Fix:** Queue requests made during `onCommand` until its outcome is known, then release them using the committed index. Do not expose a provisional seed through `request()`.

**Exactly one fallback warning is not guaranteed when failure arrives with nothing currently recoverable.**

An idle failure sets permanent fallback but returns without warning when there is no active request or delivery (`apps/web/src/game/search/coordinator.ts:319`, `apps/web/src/game/search/coordinator.ts:324`). The test explicitly blesses deferral until another request (`apps/web/test/search-coordinator.test.ts:553`). If the preceding AI move ended the game, or the human concedes before another AI decision, that request never occurs and the visible warning count remains zero.

**Fix:** Give the coordinator a game-lifetime warning sink instead of storing `onWarning` only on per-request targets. Ignore failures only after `dispose()`; otherwise log the first failure immediately.

**The hook’s “mounted” condition depends on passive cleanup rather than synchronous unmount invalidation.**

The coordinator’s disposed check is sound once `dispose()` runs (`apps/web/src/game/search/coordinator.ts:271`), but the hook invokes it from a passive `useEffect` cleanup (`apps/web/src/game/useGame.ts:383`). The tests call `dispose()` directly and explicitly exclude React scheduling (`apps/web/test/useGame.test.ts:708`). A queued worker result can therefore be processed after DOM removal but before passive cleanup; a slow result can even schedule a zero-delay delivery.

**Fix:** Dispose from a `useLayoutEffect` cleanup, and add a mounted React test that delivers a result during unmount rather than testing only the coordinator directly.

**The measurement supports “no search-sized stall was observed,” not “the main thread was never blocked,” and “bracket” is numerically wrong.**

Zero Long Task entries only rules out observed tasks at least 50 ms, while the 19–22 ms rAF gaps bound visible stalls in those two runs (`docs/superpowers/specs/2026-08-27-rung-d2-search-worker.md:115`). Given that this search is synchronous and round trips took 152–288 ms, the rAF result is good evidence that search itself did not execute on the main thread during the sample (`docs/superpowers/specs/2026-08-27-rung-d2-search-worker.md:122`). It does not prove zero blocking. Also, p50 152 ms and p95 240 ms are both below 254 ms, so they do not “bracket” D1’s figure (`docs/superpowers/specs/2026-08-27-rung-d2-search-worker.md:114`, `docs/superpowers/specs/2026-08-27-rung-d2-search-worker.md:138`); only the 288 ms maximum crosses it.

**Fix:** Say: “Across 67 observed searches, no ≥50 ms main-thread task occurred, max rAF gap was 22 ms, and no search-duration main-thread stall was observed.” Replace “bracket” with “were below, with a 288 ms maximum.”

**The positive “every AI decision came from a worker result” assertion lacks commit correlation.**

The acceptance protocol requires marking commits (`docs/superpowers/specs/2026-08-27-rung-d2-search-worker.md:59`), but the table reports only posts and received results (`docs/superpowers/specs/2026-08-27-rung-d2-search-worker.md:113`) before asserting every decision was a completed worker round trip (`docs/superpowers/specs/2026-08-27-rung-d2-search-worker.md:134`). A stale or rejected result still counts as received. No measurement harness or raw observations are committed; the web package has no browser-measurement script (`apps/web/package.json:6`). Also, 14.2 kB is the whole request, not the incremental size of `defs`, despite the attribution at `docs/superpowers/specs/2026-08-27-rung-d2-search-worker.md:130`.

**Fix:** Record `requestId → accepted result → committed command`, report all three counts, and commit the production-preview harness plus raw summary. Label 14.2 kB as total request size, or measure with/without `defs`.

## LOW

**The startup watchdog becomes the short watchdog after supersession, not after proof that the worker started.**

`starting` means only “transport did not exist before this request” (`apps/web/src/game/search/coordinator.ts:189`). If StrictMode or another cleanup supersedes the first request before any response, the replacement receives the 5-second watchdog even though the module may still be fetching/evaluating (`apps/web/src/game/search/coordinator.ts:234`). The test switches to the short watchdog only after a result, so it misses this distinction (`apps/web/test/search-coordinator.test.ts:520`).

**Fix:** Track `ready` after the first valid worker response or add an init acknowledgement; use the startup deadline until then.

**The fallback tests do not prove D2-A5’s “still finishes a game” condition.**

Most failure tests assert one warning and one delivered command (`apps/web/test/search-coordinator.test.ts:164`). The hook-level fallback test stops after a handful of commits rather than reaching `state.result` (`apps/web/test/useGame.test.ts:835`). Its coordinator harness also accepts every command without updating live state and checks only command type, not structural legality (`apps/web/test/search-coordinator.test.ts:132`, `apps/web/test/search-coordinator.test.ts:174`).

**Fix:** Drive one complete game for each failure class, using the production legality check and updating `readState` on every accepted command.

**A stale illegal human event can cancel the only AI request before legality is established.**

`choose()` invalidates first and checks whether the captured choice is still legal afterward (`apps/web/src/game/useGame.ts:344`). A stale non-concede event that lands during AI control cancels the search, throws, leaves state unchanged, and gives the effect no reason to request again. The intended off-turn concede path is legal and safe.

**Fix:** Check legality first, then invalidate immediately before `apply`; there is no asynchronous gap between those operations.

**The actual asynchronous result/error/watchdog/state-change matrix is otherwise single-delivery and state-safe.**

A winning result clears active and cancels its watchdog before scheduling (`apps/web/src/game/search/coordinator.ts:293`); a later failure cancels and replaces that delivery (`apps/web/src/game/search/coordinator.ts:319`); a winning failure invalidates everything and guards its fallback (`apps/web/src/game/search/coordinator.ts:310`); state change, restart, cleanup, and concede cancel both states (`apps/web/src/game/search/coordinator.ts:250`); delivery rechecks identity and actor (`apps/web/src/game/search/coordinator.ts:359`). Thus, after excluding the synchronous-callback and rejected-delivery holes above, I found no ordering that double-commits or applies a command to a different state.

**Fix:** Preserve these checks and add permutation tests for result→error, error→result, result/watchdog at the same deadline, and accepted-result→concede.

## WHAT I WOULD DO DIFFERENTLY

**Make the coordinator an explicit transactional state machine.**

The current `active`/`delivery`/`fallback` combination encodes states indirectly, which created both liveness holes.

**Fix:** Model `idle | posting | searching | delivering | fallback | disposed`, with one decision token owning the target, seed, watchdog, and exactly one terminal outcome: committed, superseded, or recovered.

**Design C3 deck choices as private/revealed information, not raw target IDs.**

`Pending.chooseTargets` stores live `CardId`s (`packages/engine/src/state.ts:36`), `viewFor` copies pending wholesale (`packages/engine/src/view.ts:33`), and determinisation copies those IDs after minting replacements for hidden cards (`packages/engine/src/determinise.ts:41`, `packages/engine/src/determinise.ts:51`). Reeve’s private “look” also invalidates the search’s current assumption that every action becomes public (`packages/ai/src/ismcts/search.ts:372`).

**Fix:** Define authorized candidate visibility and stable card references before adding deck selection. Rebind candidates in determinisations, redact them from unauthorized views, and decide how private opponent actions are keyed without leaking them into root observations. The D2 protocol can continue carrying `PlayerView`; it does not need a separate deck-search message.

**Split Cloud’s Attack-Phase entry and add source-aware return protection before implementing the clause.**

Main1 currently jumps atomically to attack declaration (`packages/engine/src/phases.ts:50`), while `enterAttackDeclaration` emits preparation and declaration together (`packages/engine/src/resolve.ts:389`). The only flag is `cannotBeBroken` (`packages/engine/src/abilities.ts:75`), and `toHand` carries no cause/controller transition (`packages/engine/src/resolve.ts:166`).

**Fix:** Enter Attack Phase preparation first, enqueue beginning-phase triggers, then continue into declaration. Add a source-aware field→hand transition and an opponent-Summon/ability return-protection flag.

**Trim only the test-facing fallback seed bookkeeping, not the coordinator layer itself.**

Fallback is permanent (`apps/web/src/game/search/coordinator.ts:145`) and Greedy uses its own stateful RNG (`apps/web/src/game/search/coordinator.ts:342`), so advancing/exposing the worker’s next search seed after fallback has no behavioral consumer; the test at `apps/web/test/search-coordinator.test.ts:597` proves an inert value.

**Fix:** Stop asserting search-seed advancement under permanent fallback, and rerun the browser timing measurement after C3 changes branching and request visibility.
tokens used
178,766
## HIGH

**A rejected or throwing delivery permanently stalls the AI and can also skip a seed.**

`SearchCoordinator` clears `delivery`, advances `decisionIndex`, and calls the handler, but a `false` return only rolls the index back; it schedules no retry or fallback (`apps/web/src/game/search/coordinator.ts:357`, `apps/web/src/game/search/coordinator.ts:364`). `aiHandlers` returns `false` for an illegal worker command without changing state (`apps/web/src/game/useGame.ts:266`), so the state-keyed effect never reruns (`apps/web/src/game/useGame.ts:375`). If `produce()` or `onCommand()` throws, even the rollback is skipped. This is exactly the permanent spinner/no-state-change hang the repaired failure funnel was meant to eliminate.

**Fix:** Treat rejection as a worker failure and schedule Greedy for the same target. Wrap production and delivery in `try/finally`, always restore the provisional index on failure, and provide a last-resort legal-command policy if Greedy itself rejects or throws.

**A synchronous transport callback still enters fallback with no recovery target and returns without scheduling anything.**

Handlers are exposed during construction and posting, but `active` is not assigned until after both posts return (`apps/web/src/game/search/coordinator.ts:193`, `apps/web/src/game/search/coordinator.ts:207`, `apps/web/src/game/search/coordinator.ts:242`). If an injected transport synchronously invokes `failure()` or sends a typed error, `fail()` finds no target, active request, or delivery and returns at `apps/web/src/game/search/coordinator.ts:324`. `request()` then sees `fallback` and returns without arming a watchdog (`apps/web/src/game/search/coordinator.ts:228`). Native Worker events are asynchronous, but the transport contract does not require that—and the comment explicitly anticipates synchronous failure.

**Fix:** Establish a pending target before creating/exposing the transport and before posting. Let `fail()` recover from that target, and check for fallback immediately after factory return. Alternatively, explicitly require asynchronous callbacks in `SearchTransportFactory` and enforce that in adapters/tests.

## MEDIUM

**The seed transaction is not order-independent when a rejecting handler re-enters the coordinator.**

The provisional increment lets a successful handler synchronously request the next position with seed N+1 (`apps/web/src/game/search/coordinator.ts:362`). But if that reentrant handler requests and then returns `false`, the new request was posted with N+1 before the counter rolls back to N (`apps/web/src/game/search/coordinator.ts:365`). If that request commits, the following position reuses N+1. Normal React delivery does not re-enter synchronously, so ordinary production commits are sound; the coordinator’s stated generality is not.

**Fix:** Queue requests made during `onCommand` until its outcome is known, then release them using the committed index. Do not expose a provisional seed through `request()`.

**Exactly one fallback warning is not guaranteed when failure arrives with nothing currently recoverable.**

An idle failure sets permanent fallback but returns without warning when there is no active request or delivery (`apps/web/src/game/search/coordinator.ts:319`, `apps/web/src/game/search/coordinator.ts:324`). The test explicitly blesses deferral until another request (`apps/web/test/search-coordinator.test.ts:553`). If the preceding AI move ended the game, or the human concedes before another AI decision, that request never occurs and the visible warning count remains zero.

**Fix:** Give the coordinator a game-lifetime warning sink instead of storing `onWarning` only on per-request targets. Ignore failures only after `dispose()`; otherwise log the first failure immediately.

**The hook’s “mounted” condition depends on passive cleanup rather than synchronous unmount invalidation.**

The coordinator’s disposed check is sound once `dispose()` runs (`apps/web/src/game/search/coordinator.ts:271`), but the hook invokes it from a passive `useEffect` cleanup (`apps/web/src/game/useGame.ts:383`). The tests call `dispose()` directly and explicitly exclude React scheduling (`apps/web/test/useGame.test.ts:708`). A queued worker result can therefore be processed after DOM removal but before passive cleanup; a slow result can even schedule a zero-delay delivery.

**Fix:** Dispose from a `useLayoutEffect` cleanup, and add a mounted React test that delivers a result during unmount rather than testing only the coordinator directly.

**The measurement supports “no search-sized stall was observed,” not “the main thread was never blocked,” and “bracket” is numerically wrong.**

Zero Long Task entries only rules out observed tasks at least 50 ms, while the 19–22 ms rAF gaps bound visible stalls in those two runs (`docs/superpowers/specs/2026-08-27-rung-d2-search-worker.md:115`). Given that this search is synchronous and round trips took 152–288 ms, the rAF result is good evidence that search itself did not execute on the main thread during the sample (`docs/superpowers/specs/2026-08-27-rung-d2-search-worker.md:122`). It does not prove zero blocking. Also, p50 152 ms and p95 240 ms are both below 254 ms, so they do not “bracket” D1’s figure (`docs/superpowers/specs/2026-08-27-rung-d2-search-worker.md:114`, `docs/superpowers/specs/2026-08-27-rung-d2-search-worker.md:138`); only the 288 ms maximum crosses it.

**Fix:** Say: “Across 67 observed searches, no ≥50 ms main-thread task occurred, max rAF gap was 22 ms, and no search-duration main-thread stall was observed.” Replace “bracket” with “were below, with a 288 ms maximum.”

**The positive “every AI decision came from a worker result” assertion lacks commit correlation.**

The acceptance protocol requires marking commits (`docs/superpowers/specs/2026-08-27-rung-d2-search-worker.md:59`), but the table reports only posts and received results (`docs/superpowers/specs/2026-08-27-rung-d2-search-worker.md:113`) before asserting every decision was a completed worker round trip (`docs/superpowers/specs/2026-08-27-rung-d2-search-worker.md:134`). A stale or rejected result still counts as received. No measurement harness or raw observations are committed; the web package has no browser-measurement script (`apps/web/package.json:6`). Also, 14.2 kB is the whole request, not the incremental size of `defs`, despite the attribution at `docs/superpowers/specs/2026-08-27-rung-d2-search-worker.md:130`.

**Fix:** Record `requestId → accepted result → committed command`, report all three counts, and commit the production-preview harness plus raw summary. Label 14.2 kB as total request size, or measure with/without `defs`.

## LOW

**The startup watchdog becomes the short watchdog after supersession, not after proof that the worker started.**

`starting` means only “transport did not exist before this request” (`apps/web/src/game/search/coordinator.ts:189`). If StrictMode or another cleanup supersedes the first request before any response, the replacement receives the 5-second watchdog even though the module may still be fetching/evaluating (`apps/web/src/game/search/coordinator.ts:234`). The test switches to the short watchdog only after a result, so it misses this distinction (`apps/web/test/search-coordinator.test.ts:520`).

**Fix:** Track `ready` after the first valid worker response or add an init acknowledgement; use the startup deadline until then.

**The fallback tests do not prove D2-A5’s “still finishes a game” condition.**

Most failure tests assert one warning and one delivered command (`apps/web/test/search-coordinator.test.ts:164`). The hook-level fallback test stops after a handful of commits rather than reaching `state.result` (`apps/web/test/useGame.test.ts:835`). Its coordinator harness also accepts every command without updating live state and checks only command type, not structural legality (`apps/web/test/search-coordinator.test.ts:132`, `apps/web/test/search-coordinator.test.ts:174`).

**Fix:** Drive one complete game for each failure class, using the production legality check and updating `readState` on every accepted command.

**A stale illegal human event can cancel the only AI request before legality is established.**

`choose()` invalidates first and checks whether the captured choice is still legal afterward (`apps/web/src/game/useGame.ts:344`). A stale non-concede event that lands during AI control cancels the search, throws, leaves state unchanged, and gives the effect no reason to request again. The intended off-turn concede path is legal and safe.

**Fix:** Check legality first, then invalidate immediately before `apply`; there is no asynchronous gap between those operations.

**The actual asynchronous result/error/watchdog/state-change matrix is otherwise single-delivery and state-safe.**

A winning result clears active and cancels its watchdog before scheduling (`apps/web/src/game/search/coordinator.ts:293`); a later failure cancels and replaces that delivery (`apps/web/src/game/search/coordinator.ts:319`); a winning failure invalidates everything and guards its fallback (`apps/web/src/game/search/coordinator.ts:310`); state change, restart, cleanup, and concede cancel both states (`apps/web/src/game/search/coordinator.ts:250`); delivery rechecks identity and actor (`apps/web/src/game/search/coordinator.ts:359`). Thus, after excluding the synchronous-callback and rejected-delivery holes above, I found no ordering that double-commits or applies a command to a different state.

**Fix:** Preserve these checks and add permutation tests for result→error, error→result, result/watchdog at the same deadline, and accepted-result→concede.

## WHAT I WOULD DO DIFFERENTLY

**Make the coordinator an explicit transactional state machine.**

The current `active`/`delivery`/`fallback` combination encodes states indirectly, which created both liveness holes.

**Fix:** Model `idle | posting | searching | delivering | fallback | disposed`, with one decision token owning the target, seed, watchdog, and exactly one terminal outcome: committed, superseded, or recovered.

**Design C3 deck choices as private/revealed information, not raw target IDs.**

`Pending.chooseTargets` stores live `CardId`s (`packages/engine/src/state.ts:36`), `viewFor` copies pending wholesale (`packages/engine/src/view.ts:33`), and determinisation copies those IDs after minting replacements for hidden cards (`packages/engine/src/determinise.ts:41`, `packages/engine/src/determinise.ts:51`). Reeve’s private “look” also invalidates the search’s current assumption that every action becomes public (`packages/ai/src/ismcts/search.ts:372`).

**Fix:** Define authorized candidate visibility and stable card references before adding deck selection. Rebind candidates in determinisations, redact them from unauthorized views, and decide how private opponent actions are keyed without leaking them into root observations. The D2 protocol can continue carrying `PlayerView`; it does not need a separate deck-search message.

**Split Cloud’s Attack-Phase entry and add source-aware return protection before implementing the clause.**

Main1 currently jumps atomically to attack declaration (`packages/engine/src/phases.ts:50`), while `enterAttackDeclaration` emits preparation and declaration together (`packages/engine/src/resolve.ts:389`). The only flag is `cannotBeBroken` (`packages/engine/src/abilities.ts:75`), and `toHand` carries no cause/controller transition (`packages/engine/src/resolve.ts:166`).

**Fix:** Enter Attack Phase preparation first, enqueue beginning-phase triggers, then continue into declaration. Add a source-aware field→hand transition and an opponent-Summon/ability return-protection flag.

**Trim only the test-facing fallback seed bookkeeping, not the coordinator layer itself.**

Fallback is permanent (`apps/web/src/game/search/coordinator.ts:145`) and Greedy uses its own stateful RNG (`apps/web/src/game/search/coordinator.ts:342`), so advancing/exposing the worker’s next search seed after fallback has no behavioral consumer; the test at `apps/web/test/search-coordinator.test.ts:597` proves an inert value.

**Fix:** Stop asserting search-seed advancement under permanent fallback, and rerun the browser timing measurement after C3 changes branching and request visibility.
exit=0
