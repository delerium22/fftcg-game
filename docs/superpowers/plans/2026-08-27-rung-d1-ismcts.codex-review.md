<!-- codex=codex-cli 0.146.0 model=gpt-5.6-sol effort=xhigh cwd=/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai exit=0 head=13369ea -->

## BLOCKER

**SO-ISMCTS is a reasonable fit, but raw `Command` or move-sequence keys are unsound; this is the crux.**

`Command` embeds `CardId` throughout (`packages/engine/src/commands.ts:4-17`). Each determinisation shuffles unseen codes and then assigns sequential synthetic IDs (`packages/engine/src/determinise.ts:31-45`). Numeric IDs may repeat between worlds while referring to different card codes, and the same semantic card/action may receive different IDs. Raw object identity never matches; structural equality produces both false matches and false splits. Move sequence alone also merges distinct observations because drawing happens automatically during turn advancement (`packages/engine/src/phases.ts:33-41`). SO-ISMCTS requires root-player information sets, not determinised state identities ([Cowling et al.](https://eprints.whiterose.ac.uk/id/eprint/75048/1/CowlingPowleyWhitehouse2012.pdf)).

**Fix:** Make a node `(parent history, ActionKey, ObservationKey)`, with no state transpositions initially. `ActionKey` must encode card semantics: public zone/position references for field and break-zone cards; card code plus occurrence for private-hand casts/discards; normalized sets for attackers, payments, targets, and assignments. After `apply`, append a canonical root-player observation derived from `PlayerView`, replacing all IDs—including `attack`, `pending`, and `resolution` references—with canonical references. Decode keys against the current determinisation, but retain the real root `Command` for return. Add cross-world tests covering “same ID/different code” and “same action/different ID.”

**D-2 mistakes mandatory-to-answer prompts for non-decisions and would hard-code Greedy’s choice.**

`actingPlayer` explicitly delegates to `pending.player` (`packages/engine/src/legal.ts:9-12`). Declaring an attack creates an opponent block decision (`packages/engine/src/attack.ts:53-64`); a party block creates a damage-allocation decision (`packages/engine/src/attack.ts:89-94`); ability mode and target prompts belong to the ability controller (`packages/engine/src/resolve.ts:235-255`). `resolveForcedDecisions` chooses those commands with `greedyStep` and applies them (`packages/ai/src/greedy.ts:49-80`). At the search root, that would consume the very command `decide` was called to choose. D-A5’s requirement that every node have `pending === null` directly excludes all these genuine player decisions (`docs/superpowers/specs/2026-08-27-rung-d1-ismcts.md:60-61`).

**Fix:** After every `apply`, use the returned state as the next decision boundary. `settle` already executes all system-only work until idle or a prompt (`packages/engine/src/apply.ts:44-54`). Every `Pending` kind is a tree decision during selection/expansion, regardless of owner. Determinisation chooses only hidden cards/deck order—never player actions. After the expansion frontier, the rollout policy may greedily answer all subsequent prompts. Replace D-A5 with: no-pending nodes have an empty agenda; ability-prompt nodes have the expected active frame/controller and may have queued frames.

**The availability-UCB wording is mathematically wrong and omits the essential update rule.**

The spec says UCB should “divide by” availability (`docs/superpowers/specs/2026-08-27-rung-d1-ismcts.md:28-30`). Availability replaces the parent-visit count inside the logarithm; selected-action visits remain the denominator. Availability must also be incremented for every compatible sibling, not merely the selected action. That is the subset-armed-bandit algorithm described by [Cowling et al.](https://eprints.whiterose.ac.uk/id/eprint/75048/1/CowlingPowleyWhitehouse2012.pdf).

**Fix:** Specify exactly:

`UCB(s,a) = mean(s,a) + C × sqrt(log A(s,a) / N(s,a))`

where `N` is times selected and `A` is visits to `s` on which the canonical action was present in `candidateCommands`. On backpropagation, increment `A` for every existing compatible child and `N/W` only along the selected path. Add a deterministic toy test with one always-available and one rarely-available action; a win-rate gate cannot prove these counters are correct.

**Opponent-node selection and reward scaling are unspecified; the obvious implementation creates a cooperative opponent or a collapsed bandit.**

D-1 says the tree includes opponent hidden actions, but never states whose utility UCB maximizes (`docs/superpowers/specs/2026-08-27-rung-d1-ismcts.md:41-48`). `evaluate` returns nonterminal scores on an arbitrary material scale and terminal values of ±100,000 (`packages/ai/src/evaluate.ts:103-109`). With an exploration constant near one, a single terminal rollout overwhelms exploration. Always maximizing root reward at opponent nodes makes the opponent cooperate.

**Fix:** Backpropagate a bounded root reward, for example terminal `±1/0` and `tanh(evaluate / configuredScale)` at the cap. At root-controlled nodes maximize the mean; at opponent-controlled nodes maximize its negation, while keeping the exploration bonus positive. Specify the exploration constant, expansion rule, final root choice—normally highest visit count—and deterministic tie-breaking.

## MAJOR

**A fixed iteration count is reproducible, but it is not a useful work bound with the proposed rollout policy.**

`determinise` ends with a full `structuredClone` (`packages/engine/src/determinise.ts:49-53`). Contrary to the premise, `apply` does not whole-state clone: it performs immutable structural updates and settlement (`packages/engine/src/apply.ts:60-87`, `packages/engine/src/state.ts:95-98`). `evaluate` only scans the small board and hands (`packages/ai/src/evaluate.ts:87-100`). However, each `greedyStep` applies and evaluates every candidate (`packages/ai/src/greedy.ts:95-107`), and ability settlement can cascade.

A local representative probe measured roughly 107 μs per determinisation, of which 103 μs was `structuredClone`; isolated `apply` and `evaluate` were below 1 μs. Thus shallow iterations are determinisation-bound—about a 107 ms floor for 1,000 iterations—but deep greedy rollouts can become dominated by repeated candidate generation and `apply`, with `evaluate` usually cheapest.

**Fix:** Add counters for determinisations, tree applies, rollout applies, evaluations, nodes, and maximum command depth; profile those before changing sampling. Give each iteration a rollout-command/apply cap, not only a depth description. First remove or narrow the redundant final clone by constructing alias-free arrays while sharing readonly definitions. Only then test world reuse.

**Reusing a small fixed pool of worlds is legal but changes the search target and can materially weaken play.**

The fallback at `docs/superpowers/specs/2026-08-27-rung-d1-ismcts.md:77-79` searches the empirical distribution of those few worlds. With one world it degenerates toward perfect-information UCT; with small `K`, hidden-hand coverage and availability estimates remain biased no matter how many iterations run.

**Fix:** Do not make reuse the default. If needed, sample `K` worlds and visit them round-robin, with `K` growing with the total iteration budget so coverage still increases. Benchmark `K={1,8,32,iterations}` at equal wall time and report both strength and action-availability coverage.

**The 60%/200 gate is statistically meaningful, but it is neither a bandit-correctness test nor clearly attainable against this baseline.**

Under an IID no-draw binomial, 120/200 has a two-sided 95% Wilson interval of approximately 53.0–66.6% and one-sided `p≈0.00284` against 50%. So it is not statistically weak. But this Greedy baseline is stronger than “one ply”: it finishes turns and forces depth two at attack declaration (`packages/ai/src/greedy.ts:179-180`, `packages/ai/src/greedy.ts:244-248`). In this small no-response game, a correct search may produce a smaller advantage. Conversely, a broken availability counter can still clear 60% if the affected situations are rare.

The current harness fixes agents to seats for an entire run (`apps/cli/src/selfplay.ts:30-55`); the existing “both seats” test uses different seed ranges rather than mirrored games (`apps/cli/test/selfplay.test.ts:18-24`).

**Fix:** Use 200 held-out seed pairs—400 games—with roles swapped on each identical game seed. Score draws as half, count failures as losses, report per-seat results, and require point score ≥55% with a paired-bootstrap 95% lower bound above 50%. Keep algorithm correctness in targeted unit tests, not the tournament gate. Calibrate the final iteration budget on separate development seeds.

**Determinism is most likely to leak through action bookkeeping and tie-breaking, not the engine RNG.**

The RNG itself is explicit and deterministic (`packages/engine/src/rng.ts:7-27`), and Greedy correctly threads it (`packages/ai/src/greedy.ts:219-223`). Risk lies in child insertion order depending on the first determinisation, object-reference command keys, synthetic-ID ordering, incomplete sort comparators such as equal-cost payments (`packages/ai/src/payment.ts:75`, `packages/ai/src/payment.ts:103`), floating UCB ties, or accidental `Math.random`.

**Fix:** Rebuild the tree per `decide`; use canonical string/tuple keys with a total comparator; route expansion, rollout, and tie randomness through explicit RNG streams separate from world sampling; never depend on `Map` insertion order for final ties. Test two fresh agents over an identical full view trace, comparing commands and all non-timing diagnostics.

**D-A4 needs a non-interference contract, not a claim that simulations never inspect hidden cards.**

The safe input boundary exists: `viewFor` includes the acting player’s hand and public zones only (`packages/engine/src/view.ts:16-35`), while `determinise` documents public declared lists as its other input (`packages/engine/src/determinise.ts:8-13`). Simulations necessarily inspect sampled hidden cards; the requirement should be that every full state is derived from those inputs, never from the live `GameState`. Deck-list array order is currently preserved before shuffling (`packages/engine/src/determinise.ts:15-22`), even though a declared list is semantically a multiset.

**Fix:** Copy and sort each declared deck list before sampling, ignore the caller’s `legal` argument with `needsLegalCommands=false`, and expose no search entry point accepting `GameState`. Test two live states with identical `PlayerView` and deck multisets but different hidden hands, deck order, and live RNG; fresh same-seed agents must produce identical traces. Retain Greedy’s synthetic-ID output guard (`packages/ai/src/greedy.ts:186-200`, `packages/ai/src/greedy.ts:255-257`).

**Deferring browser wiring is right, but the worker-safe seam must be defined in D1.**

The current web driver is synchronous (`apps/web/src/game/useGame.ts:220-232`) and invokes the agent inside a timer (`apps/web/src/game/useGame.ts:285-298`). Meanwhile D-6 claims harnesses need no changes, although CLI agent parsing only supports random/greedy (`apps/cli/src/agents.ts:3-19`) and self-play reports no iteration diagnostics (`apps/cli/src/selfplay.ts:15-25`).

**Fix:** In D1, implement a pure synchronous `searchIsmcts(input): {command, diagnostics}` plus a thin stateful `IsmctsAgent` wrapper. Keep inputs/results structured-cloneable and avoid callbacks or timing dependencies. Define the future worker protocol now: one-time initialization for static decks/definitions, then `{requestId, view, seed/decisionIndex, iterations}` requests and generation-checked results. D2 can own cancellation and React changes without rewriting the search core.

## MINOR

**D-A3’s live-versus-determinised “search identically” check is redundant and incorrectly framed.**

The agent accepts `PlayerView`, not a live state (`packages/ai/src/agent.ts:3-11`). The meaningful equivalence is already tested by applying the same command to live and determinised ability states (`packages/engine/test/abilities-engine.test.ts:264-294`).

**Fix:** Keep engine transition equivalence there. For ISMCTS, test identical normalized observations/action keys across determinisations and identical searches from equal views.

**The 200-game random gate and `resolutionQueued`-style node diagnostic are over-built.**

Greedy already wins 200/0 against Random, while the new search reuses its policy and evaluation. D-A2 adds little beyond a small regression smoke test; D-A5 asserts the wrong node boundary (`docs/superpowers/specs/2026-08-27-rung-d1-ismcts.md:55-61`).

**Fix:** Reduce random opposition to a smaller smoke run. Spend that budget on canonical-key, availability-count, opponent-minimization, pending-owner, bounded-rollout, and fairness tests.

## WHAT I WOULD DO DIFFERENTLY

1. First land canonical `ActionKey`/`ObservationKey` contracts and adversarial fixtures proving cross-determinisation equality.
2. Implement root-per-decision SO-ISMCTS with every engine `Command` as a tree ply; use Greedy only after the expansion frontier.
3. Normalize rewards, specify actor-aware UCB exactly, and add hard rollout-command bounds plus cost counters.
4. Profile fresh-world sampling before introducing reuse.
5. Gate on 200 mirrored seed pairs with confidence reporting.
6. Keep D2 separate, but establish the pure serializable search boundary in D1.
