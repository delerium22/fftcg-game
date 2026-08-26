<!-- codex=codex-cli 0.146.0 model=gpt-5.6-sol effort=xhigh cwd=/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai exit=0 head=1e64405 -->

## HIGH

- **Shared budget makes candidate scoring order-dependent.** `budget` is created once before the candidate loop, so early candidates consume rollout/combat work while later attacks may be evaluated in unresolved mid-combat states. This contradicts the plan’s per-candidate budget. `packages/ai/src/greedy.ts:112-129`, `docs/superpowers/plans/2026-08-26-rung-a-heuristic-ai.md:575-578`. **Fix:** allocate an equal budget inside each candidate iteration, count all nested `apply` calls, and enforce `lastSimulations <= maxSimulations` after pruning.

- **Affordable multi-element casts can be omitted.** Scarcity-first greedy assignment is not complete. For a three-element target and sources `{Earth}`, `{Earth, Lightning}`, `{Lightning, Fire}`, it can spend the second source on Earth after reserving the third for Fire, then fail Lightning although a legal matching exists. `preferredPayment` returns `null`, and `candidateCommands` silently drops the cast. `packages/ai/src/payment.ts:29-39`, `packages/ai/src/candidates.ts:44-48`. **Fix:** use bounded backtracking or minimum-cost bipartite matching for required elements, then greedily fill generic CP.

- **Light/Dark casting violates CR §11.2.** `preferredPayment` requires a matching Light/Dark source, while CR §11.2.1.1/§11.2.2 exempts Light/Dark cards from the same-element requirement. Engine `canPay` also explicitly leaves the exemption unimplemented, so two off-element Backups cannot cast a cost-2 Light card. `packages/ai/src/payment.ts:29-36`, `packages/engine/src/cp.ts:37-42`. **Fix:** centralize required-element calculation in the engine, exempt single-element Light/Dark costs, and have both `canPay` and `preferredPayment` use it.

## MEDIUM

- **Party-block continuation uses the wrong aggression.** `resolveCombat` assumes `aggression` belongs to `state.turnPlayer`. When the agent is defending a party, its own pending damage assignment has `p !== turnPlayer`, so it is evaluated with `1 - aggression`. `packages/ai/src/greedy.ts:31-41`, `packages/ai/src/greedy.ts:118`. **Fix:** pass an explicit perspective player and choose `aggression` when `p === perspective`, not when `p === turnPlayer`.

- **Determinisation conserves by controller rather than card owner.** Visible cards are attributed to the player whose field contains them, ignoring `CardInstance.owner`; a transferred permanent therefore subtracts from the wrong declared deck list and either corrupts conservation or throws. `packages/engine/src/determinise.ts:35-46`. **Fix:** collect visible codes by `view.cards[id].owner`, independently of which player controls the visible zone.

- **The bounded attack set omits strategically significant parties.** With more than six eligible forwards, only singletons and the full party for each element are considered; every intermediate party size is lost. A two-card trading party can be optimal when the full party is wasteful. `packages/ai/src/candidates.ts:14-24`. **Fix:** retain a bounded deterministic selection of prefixes/trade-sized/lethal-sized parties or lazily generate parties up to the simulation cap.

## LOW

- **“Deduplicated” attack parties are not deduplicated.** Eight identical dual-element forwards emit the same full party once per shared element, wasting simulations and potentially displacing another candidate during pruning. `packages/ai/src/candidates.ts:18-23`. **Fix:** deduplicate canonical sorted attacker-ID signatures before appending.

- **Rollout tests assert diagnostics, not rollout behaviour.** The depth test only checks `lastDepth`; the budget test accepts the defective shared-budget bound; neither verifies turn-owner stopping or equal work per candidate. `packages/ai/test/greedy.test.ts:75-82`, `packages/ai/test/greedy.test.ts:113-120`. **Fix:** assert resulting rollout traces/turn boundaries and invariance under candidate reordering.

- **The fallback test labels an illegal command as legal.** It calls the agent for player 1 while player 0 is acting, then supplies player 1 `pass`; only concede is legal in that state. This makes the test pass without validating real fallback behaviour. `packages/ai/test/greedy.test.ts:130-139`. **Fix:** construct a genuine acting-player state whose semantic candidates are absent, or remove the unreachable fallback contract.

- **Candidate legality is duplicated rather than derived.** `candidateCommands` mirrors the engine’s pending/phase switch, making every future command or pending kind require synchronized edits and enabling silent omissions. `packages/ai/src/candidates.ts:27-55`, `packages/engine/src/legal.ts:19-64`. **Fix:** expose engine semantic commands with injectable canonical-payment and bounded-attack strategies.

- **Active forward power is represented twice.** `dullFactor` already differentiates active and dull power, then `threat` adds the same active-power signal again. This over-parameterizes two states and complicates tuning. `packages/ai/src/evaluate.ts:33-36`. **Fix:** replace the three interacting weights with explicit active-power and dull-power coefficients, or remove `threat`.

- **`--depth` bypasses runtime validation.** A cast converts any number or `NaN` to `0 | 1 | 2`; invalid values reach `GreedyAgent`, can disable rollouts, and make `lastDepth` violate its declared type. `apps/cli/src/main.ts:33-38`. **Fix:** parse and range-check `--depth` with the same validation used by `greedy:N`.