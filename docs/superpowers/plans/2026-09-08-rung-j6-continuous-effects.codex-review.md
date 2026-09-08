<!-- codex=codex-cli 0.146.0 model=gpt-5.6-sol effort=high cwd=/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai -->

# CRITICAL

- **CRITICAL — Static flags would bypass the proposed authority.** Plan D1 (`:30–37`) claims every flag reader already uses `flagsOf`, but no such function exists (`packages/engine/src/state.ts:211–220`). Enforcement reads `card.flags` directly in `rules.ts:115`, `resolve.ts:497`, `packages/ai/src/candidates.ts:121,141,159`, `packages/ai/src/evaluate.ts:158`, and `apps/web/src/game/commands.ts:503–504`. **Suggested change:** explicitly add `flagsOf(state, card)` and migrate every enforcement, AI, and UI consumer; add acceptance tests for layer-granted protection against both damage and direct break.

- **CRITICAL — `TargetFilter` makes the proposed additive layer recursive and dependency-sensitive.** Plan D1 allows any `TargetFilter`; that includes effective-power and effective-keyword predicates (`abilities.ts:55–61`). Existing matching already calls `powerOf`/`keywordsOf` (`resolve.ts:147–168`). Evaluating a power layer whose scope filters on effective power therefore re-enters the layer, potentially infinitely; two additive effects can also change one another’s applicability, disproving D3’s claim that dependency is unobservable (`:41–46`). **Suggested change:** restrict `StaticScope.filter` to axes independent of continuous results, or implement dependency ordering, cycle detection, and fixed-point semantics now.

# HIGH

- **HIGH — The `effectivePower` signature migration is incomplete.** D2 (`:38–40`) mentions only the web board, which does not call it directly. Actual callers are `state.ts:215–216`, `packages/ai/src/candidates.ts:106`, `apps/web/src/game/commands.ts:501`, and `packages/engine/test/abilities-engine.test.ts:61,63`. **Suggested change:** enumerate and migrate all four sites; use `powerOf(state, loc.card)` in AI where the card is on-field.

- **HIGH — The WeakMap correctness premise is false for the exported API.** D4 calls states immutable, while `determinise.ts:96–99` explicitly documents `GameState` as exported and mutable; its arrays, field cards, cards, and defs are not readonly. In-place mutation after `layerOf(state)` would return a stale index. **Suggested change:** enforce immutability through readonly types/freezing, or key/invalidate the cache from immutable field/definition identities instead of assuming the whole state cannot mutate.

- **HIGH — The WeakMap provides no reuse across the named clone-heavy paths.** `viewFor` uses `structuredClone` (`view.ts:83–87`), every determinisation clones a fresh state (`determinise.ts:84–101`), every `apply` returns another state, and a literal `effectivePower(stateShim(v), c)` creates a fresh shim per `fieldCardDisplay` call (`commands.ts:498–501`; `Board.tsx:43–48`). All are WeakMap misses. **Suggested change:** construct one shim/index per view or render, pass it through display helpers, and profile the actual determinise/apply workload before claiming the performance gate.

- **HIGH — D5 cannot be implemented through the existing condition API.** New layer effects in D1 have no `when` member, so `controlsForward`/`sourceIs` have nowhere to attach. Existing `staticApplies(state, when, player)` (`cp.ts:133–145`) also lacks the source needed to evaluate `sourceIs`. **Suggested change:** specify which effects carry conditions and move condition evaluation to a shared source-aware context such as `{state, source, controller}`.

- **HIGH — Slice 1 omits several mandatory constructors/projections.** Adding required `GameState.seq` and `FieldCard.enteredSeq` affects `setup.ts:49–54`, `resolve.ts:1063–1079`, `view.ts:29–50,83–87`, `packages/ai/src/ismcts/search.ts:222–254`, `determinise.ts:84–101`, and `commands.ts:1046–1058`, plus the central test helper at `packages/engine/test/helpers.ts:72–76` and many direct fixtures. **Suggested change:** enumerate these migration sites and introduce a shared FieldCard constructor before making the fields required.

- **HIGH — The observation-key reasoning is internally inconsistent.** Field order is stored separately for Forwards and Backups (`keys.ts:493–515`), so it cannot recover global entry order across zones. Also, `defs`/the `StaticEffect` AST are not digested; therefore A6’s “effect differs, fixed field” test produces the same key when the same code has a changed static definition. **Suggested change:** digest `enteredSeq` explicitly; either declare definitions immutable within a tree and test a real dynamic input, or include a normalized static-definition digest.

- **HIGH — “The AI sees it for free” is false for qualities.** `abilityTerms` returns early using raw stamped/printed arrays before calling `keywordsOf` (`evaluate.ts:149–158`), and protection is read directly from `c.flags`. A layer-only Haste or flag therefore receives no value. **Suggested change:** gate and score using effective keyword/flag readers, with tests for layer-only Haste and protection.

- **HIGH — The web only receives effective power, not effective keywords or flags.** `fieldCardDisplay` returns raw `c.granted` and `c.flags` (`commands.ts:498–505`), and `Board` forwards those raw values (`Board.tsx:48–58`). D1’s claim that all three layer products reach the board is therefore false. **Suggested change:** derive display qualities from the effective readers while avoiding duplicate badges for printed keywords.

# MEDIUM

- **MEDIUM — `StaticScope` duplicates and contradicts existing targeting abstractions.** `who: 'self' | 'controller' | ...` plus `self: 'include' | 'exclude' | 'only'` admits unclear combinations such as `who:'opponent', self:'only'`. Existing `TargetController` and `TargetFilter.excludeSource` already model these axes (`abilities.ts:22–39`). **Suggested change:** reuse those concepts or define a discriminated union that makes invalid combinations unrepresentable.

- **MEDIUM — Reusing existing filtering from the proposed location creates an import-cycle problem.** The full matcher is private in `resolve.ts:171–189`, while `resolve.ts` already imports state readers (`:8`). A layer implemented in `state.ts` cannot import it safely, and reimplementing it would duplicate the J5 authority. **Suggested change:** extract shared filter matching into a lower-level module, subject to the recursion restriction above.

- **MEDIUM — “Every field static” is not a coherent LayerIndex input.** Existing `costReduction` is an own-card, off-field effect, while `produceElement` is field-scoped and consumed only by CP generation (`abilities.ts:248–261`; `cp.ts:121–130,218–232`). Neither has the proposed `to` scope. **Suggested change:** explicitly index only a `fieldContinuous` subunion, or normalize each existing static kind without changing its established consumer semantics.

- **MEDIUM — Timestamp handling does not model simultaneous entry as stated.** Incrementing `seq` for every card gives simultaneous entrants different timestamps, while a single `enteredSeq` carries no separate tie order. D3 then admits ordering is currently unobservable and A4 tests only a marker. **Suggested change:** define batch timestamp plus tie ordinal, or defer persistent timestamp plumbing until a non-commutative effect can verify it behaviorally.

- **MEDIUM — The promised sheet format targets the wrong file set.** The sheet’s metadata renders printed power in `apps/web/src/ui/CardSheet.tsx:70–78`; changing `Board.tsx` and `commands.ts` alone does not produce `8000 (7000)`. **Suggested change:** include `CardSheet.tsx` and its component tests in slice 3.

- **MEDIUM — New static data has no runtime validation.** `modifyPower.amount`, condition thresholds, and scope combinations come from cloneable data, but current invariants validate only stamped `powerBonus`, granted keywords, and flags (`invariants.ts:7–24`). `NaN` or an invalid scope can poison every reader. **Suggested change:** validate static definitions during game/card loading and add exhaustive scope/condition checks.

# LOW

- **LOW — A5 specifies implementation instrumentation rather than behavior.** “A spy counts” is underspecified if `layerOf` remains internal, and an “early exit” still requires inspecting field definitions. **Suggested change:** define an explicit test seam/counter or make the acceptance criterion a measured call/scan bound.

- **LOW — Several authority comments will become false after the signature change.** Examples include `state.ts:206–207`, `packages/ai/src/evaluate.ts:145–147`, `apps/web/src/ui/Card.tsx:30–32`, and `Board.tsx:45–47`. **Suggested change:** include comment/API-documentation updates in the migration checklist.