<!-- codex=codex-cli 0.146.0 model=gpt-5.6-sol effort=xhigh cwd=/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai exit=0 head=8e7233b -->

The spec is not implementation-ready: three design decisions need tightening first.

## BLOCKER

**C1-2 silently drops the script registry from every Greedy simulation.**

`GameState` has no registry (`packages/engine/src/state.ts:28`), `viewFor` constructs an explicit object without one and clones it (`packages/engine/src/view.ts:28`), and `determinise` explicitly reconstructs another registry-free state (`packages/engine/src/determinise.ts:49`). `GreedyAgent` then generates candidates and calls `apply` on that state (`packages/ai/src/greedy.ts:178`, `packages/ai/src/greedy.ts:204`). The simulated game would therefore be vanilla while the live game has abilities. Also, the acceptance runner and web app currently never pass scripts (`apps/cli/src/selfplay.ts:56`, `apps/web/src/game/useGame.ts:77`).

**Fix:** Make `CardScript` strictly readonly, JSON-shaped data and add `scripts?: Record<string, CardScript>` to `GameState` and `PlayerView`; explicitly preserve it in `viewFor` and `determinise`. With the current `apply(state, command)` API, `GameState` is the simplest correct home. If scripts contain functions, closures, or generators, they cannot live there: `structuredClone` will throw, and an explicit immutable `GameDefinition` context must instead be passed through `apply`, `legalCommands`, `determinise`, and `GreedyAgent`. Add a test proving a live scripted state and its determinisation resolve the same command identically.

**A single `pending` slot cannot represent an ability continuation plus queued triggers.**

`state.pending` is one overwriteable value (`packages/engine/src/state.ts:36`). Cloud’s phase trigger must interrupt the current `main1 → preparation → declaration` transition, which currently happens atomically (`packages/engine/src/phases.ts:50`). Lightning can produce one trigger per opponent Forward moved during simultaneous rule processing (`packages/cards/data/cards.json:272`), while `resolveDamage` runs those rule processes and then unconditionally writes `pending: null` (`packages/engine/src/attack.ts:164`, `packages/engine/src/attack.ts:166`). Multiple broken Forwards—or future multiple trigger sources—cannot be represented.

Today an ETB cannot literally occur during combat because casting is prohibited there and combat handlers clear their pending before damage (`packages/engine/src/attack.ts:92`, `packages/engine/src/attack.ts:132`). But ability-driven field entry in C2 can occur while resolving an earlier choice, and answering Shantotto’s mode already needs to suspend one effect and create a target choice.

**Fix:** Keep `pending` as the one visible decision, but add a serializable resolution agenda: active frame/program counter, queued triggered frames, system continuation such as `enterAttackDeclaration`, recorded answers, and a persistent total-step count. Clear the consumed pending before resuming; drain frames deterministically until the next choice or the queue is empty. Cap total resolution work, not merely call-stack depth, and persist the count across player choices.

**The spec cannot simultaneously implement only C1 clauses and stop warning for all five cards.**

Only Shantotto and Billy Bob are wholly within the stated slice. Noel also has EX Burst and an action ability (`packages/cards/data/cards.json:75`). Lightning has EX Burst plus the zone-change trigger that the spec assigns to C2 (`packages/cards/data/cards.json:272`, `docs/superpowers/specs/2026-08-27-rung-c1-abilities.md:26`). Cloud has a second attack-phase trigger with two protection effects (`packages/cards/data/cards.json:227`). Yet C1-A2 says no `unimplementedAbility` for any of the five (`docs/superpowers/specs/2026-08-27-rung-c1-abilities.md:48`), and C1-9 excludes actions, EX Burst, and zone-change triggers (`docs/superpowers/specs/2026-08-27-rung-c1-abilities.md:42`).

**Fix:** Track coverage per ability clause, not per card code—e.g. stable `abilityId`s and `complete: boolean`. Remove the warning only for implemented clauses and continue warning that Noel’s action/EX, Lightning’s EX/second trigger, and Cloud’s deferred trigger are incomplete. If A2 genuinely means whole-card completion, C1 necessarily absorbs work currently assigned to C2/C3.

## MAJOR

**Immediate resolution is workable for these effects, but it is observably rules-wrong once responses exist.**

None of the five effects needs a stack merely to calculate its result, so immediate resolution is a coherent MVP simplification. Cloud’s attack-phase trigger still needs an internal pause before attack declaration (`packages/cards/data/cards.json:227`; `packages/engine/src/phases.ts:50`). In real interaction, targeted ETBs also need a response window: for example, Lightning can target Undead Princess, but Undead Princess could put itself into the Break Zone as an action cost before Lightning resolves (`packages/cards/data/cards.json:136`, `packages/cards/data/cards.json:272`). Immediate resolution denies that response. Likewise, Ramuh could respond before Cloud’s pump or Shantotto’s protection resolves (`packages/cards/data/cards.json:45`, `packages/cards/data/cards.json:166`).

**Fix:** Retain C1-3 as an explicit deviation, but split phase transitions at trigger points and state plainly that target selection/resolution has no opponent response window. Do not describe A1 as fully rules-correct; test the documented immediate-resolution result.

**`powerBonus` belongs on `FieldCard`, but C1-6 is false until the UI uses the same authority.**

Combat damage, party assignment, rule processes, and evaluation already call `powerOf` (`packages/engine/src/attack.ts:114`, `packages/engine/src/attack.ts:152`, `packages/engine/src/rules.ts:29`, `packages/ai/src/evaluate.ts:34`). Once `powerOf` adds `powerBonus`, those consumers are correct. `cardValue` uses printed power (`packages/ai/src/cardValue.ts:5`), but only for hand/discard valuation, not field combat, so that is sound.

The web field instead passes printed `CardDef.power` (`apps/web/src/ui/Board.tsx:28`). `Card` then computes remaining power, damage percentage, accessibility text, and display from that printed value (`apps/web/src/ui/Card.tsx:37`, `apps/web/src/ui/Card.tsx:44`, `apps/web/src/ui/Card.tsx:49`). A pumped Forward will visibly show the wrong power and damage ratio.

**Fix:** Initialize `powerBonus: 0`, clear it with other end-of-turn state, and make `powerOf` usable with the public card catalogue present in `PlayerView`—or expose a single shared `effectivePower(def, fieldCard)` helper that `powerOf` delegates to. Pass effective power to `Card`.

**`chooseTargets` requires changes in every command consumer; `buildChoiceSet` alone does not make it work.**

An unhandled pending in `legalCommands` returns only concede (`packages/engine/src/legal.ts:23`). `apply` needs new command handlers (`packages/engine/src/apply.ts:21`). `candidateCommands` has an exhaustive pending switch and will fail compilation (`packages/ai/src/candidates.ts:48`). The web separately switches over command types in `describeChoice`, `subjectsOf`, and `sameCommand`, and over pending kinds in `promptFor` (`apps/web/src/game/commands.ts:21`, `apps/web/src/game/commands.ts:49`, `apps/web/src/game/commands.ts:67`, `apps/web/src/game/commands.ts:117`). Greedy’s synthetic-ID guard also needs target IDs (`packages/ai/src/greedy.ts:145`).

Once those are updated, `buildChoiceSet` itself is adequate: a multi-target command can be mapped under every target (`apps/web/src/game/commands.ts:87`). Noel will, however, appear as pre-enumerated target-set buttons rather than an incremental “select up to two” interaction.

**Fix:** Add `chooseTargets`/`chooseMode` command variants and update all exhaustive switches. Validate player, uniqueness, min/max, and exact membership again in `apply`. Consider shared command-subject and structural-equality helpers so engine, AI, and UI do not keep drifting.

**Greedy must score all meaningful target choices and fully drain chained ability decisions.**

Current candidate generation makes one heuristic discard but enumerates combat choices (`packages/ai/src/candidates.ts:52`). New targeting must not return only the first candidate. More subtly, `resolveCombat` only drains `declareBlock` and `assignPartyDamage` (`packages/ai/src/greedy.ts:44`); a `chooseMode → chooseTargets` chain can reach `evaluate` with the effect unresolved, especially under a one-apply candidate budget (`packages/ai/src/greedy.ts:118`, `packages/ai/src/greedy.ts:140`).

The evaluator will correctly see dulling, breaking, returning a card, and power bonuses, but it ignores Haste, Brave, protection, `enteredTurn`, and `attackedThisTurn` (`packages/ai/src/evaluate.ts:30`). Haste/protection targets will therefore tie and fall back to first-in-order.

**Fix:** Replace combat-only draining with a bounded `resolveForcedDecisions` that completes the ability-resolution agenda before evaluation. For C1, a cheap one-ply target policy is enough:

- Noel: prefer active, highest-effective-power targets and normally select `max`.
- Lightning ETB: enumerate legal targets; material evaluation already selects the most valuable one.
- Billy Bob: use `cardValue` to prefer the best Break Zone Forward.
- Haste: value only a fresh, active, unattacked Forward that Haste makes attack-eligible.
- Cannot-be-broken: give a small value based on effective power/current damage or immediate combat exposure.

This avoids a full rollout search while preventing first-target behavior.

**Shantotto and Cloud require protection state that `granted: Keyword[]` cannot express.**

`Keyword` contains only Haste, Brave, First Strike, and Back Attack (`packages/engine/src/types.ts:5`). Shantotto grants “cannot be broken” (`packages/cards/data/cards.json:45`), while Cloud additionally grants protection from opponent-caused return-to-hand (`packages/cards/data/cards.json:227`). Rule processing currently breaks damaged Forwards unconditionally (`packages/engine/src/rules.ts:24`).

**Fix:** Add explicit until-end-of-turn protection flags to `FieldCard`. `cannotBeBroken` must block both direct break effects and damage-based breaking, while still allowing the zero-power rule process. Cloud’s anti-return flag also requires zone-move primitives to carry cause/controller information so only opponent Summons and abilities are prevented.

**Trigger discovery needs transition-time snapshots, not a scan of the post-rule state.**

`runRuleProcesses` removes all affected Forwards simultaneously and only then emits `broken` events (`packages/engine/src/rules.ts:34`). If Lightning is removed simultaneously with an opponent Forward, scanning the resulting field loses Lightning’s trigger. ETB discovery also cannot rely on `cast`: the only current event is `cast` (`packages/engine/src/events.ts:13`), but C2’s Hugh Yurg plays a Forward without casting it (`packages/cards/data/cards.json:211`). Rule processes are currently invoked both inside combat/end-phase code and by the outer reducer (`packages/engine/src/attack.ts:164`, `packages/engine/src/phases.ts:95`, `packages/engine/src/apply.ts:38`), making exact-once trigger dispatch easy to get wrong.

**Fix:** Introduce explicit internal zone-transition/entered-field records carrying pre-transition snapshots. Capture matching triggers before removing cards, enqueue them once, and centralize rule-process-plus-trigger settlement sufficiently that emitted transitions cannot be scanned twice.

## MINOR

**`checkInvariants` currently cannot detect malformed modifier or resolution state.**

It checks card placement, negative damage, field definitions, attack/phase consistency, and pending-after-game-over only (`packages/engine/src/invariants.ts:4`).

**Fix:** Validate finite integral `powerBonus`, valid protection/keyword values, unique target candidates, `min <= max <= candidates.length`, pending-to-active-frame correspondence, valid source IDs/program counters, resolution step bounds, and no queued resolution after game over.

**Strict immutability and cloning require boring data structures.**

Self-play detects input mutation via `JSON.stringify` (`apps/cli/src/selfplay.ts:60`, `apps/cli/src/selfplay.ts:70`), while views and determinizations use `structuredClone` (`packages/engine/src/view.ts:28`, `packages/engine/src/determinise.ts:53`). Functions cannot be cloned; mutations inside `Map`, `Set`, or function-valued registries are not meaningfully covered by the JSON assertion. Session persistence also serializes `CreateGameOptions` (`packages/engine/src/session.ts:32`).

**Fix:** Use only records, arrays, strings, numbers, and booleans for scripts, frames, answers, and flags; mark them readonly and never consume effect arrays with mutating operations such as `shift`.

**C1-A5 cannot literally keep every existing test unchanged if `FieldCard` gains a required property.**

Casting currently has an exact-object assertion without `powerBonus` (`packages/engine/test/cr11.4-cast.test.ts:22`), matching the current `FieldCard` shape (`packages/engine/src/state.ts:7`).

**Fix:** Change A5 to “existing behavior tests remain semantically valid; schema expectations are updated,” or make the modifier optional and interpret absence as zero. A required `powerBonus: 0` and “217 tests unchanged” are incompatible.

**The 18-card census omits static/cost-modifying machinery from the C roadmap.**

Class Tenth Moogle changes produced CP (`packages/cards/data/cards.json:29`), Odin has conditional cost reduction (`packages/cards/data/cards.json:60`), and Sphene has static Break Zone protection (`packages/cards/data/cards.json:257`). None fits the listed C1/C2/C3 groups cleanly.

**Fix:** Add a static/continuous and cost-modification row and explicitly assign these clauses to a rung.

## WHAT I WOULD DO DIFFERENTLY

I would cut C by ability clause, not pretend partially scripted cards are complete.

For C1, I would build the serializable resolution agenda first, then implement:

- Noel ETB: `0..2` field targets and dull.
- Shantotto ETB: mode, nested target, Haste, and cannot-be-broken.
- Cloud ETB only: mass power bonus and Brave.
- Billy Bob ETB: Break Zone targeting and zone movement.
- Ramuh’s Summon effect instead of Lightning: it proves the currently untested Summon path, damage, `chooseModes 0..2`, and multiple sequential target choices (`packages/cards/data/cards.json:166`).

Lightning belongs naturally in C2 with its zone-change trigger. Cloud’s attack-phase trigger should wait until phase continuations and source-aware protections are deliberately covered. Noel and Cloud should continue emitting partial-coverage warnings until their remaining printed clauses land.
