<!-- codex=codex-cli 0.146.0 model=gpt-5.6-sol effort=xhigh cwd=/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai exit=0 head=8c25b41 -->

## HIGH

**Control-changed cards are sent to the controller’s Break Zone instead of the owner’s.**

The rule-process path removes a card from player `p`’s field and appends it to `p.breakZone` at [rules.ts:94](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/rules.ts:94). Likewise, `breakCard` records `CardInstance.owner` but then appends using `loc.owner`, which is actually the field controller, at [resolve.ts:317](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/resolve.ts:317). This violates the spec’s explicit ownership requirement at [observer-triggers.md:24](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/docs/superpowers/specs/2026-08-27-rung-c2-observer-triggers.md:24) and [CR 3.3 §§12.4.4, 15.1.1.3](https://fftcg.cdn.sewest.net/2026-08/fftcg-comprules-v3.3.pdf). The earlier review’s MAJOR was not genuinely closed.

**Fix:** Remove from the controller’s field but group and append cards by `CardInstance.owner`. Preserve the pre-transition controller solely for trigger matching. Test both ability breaks and rule-process breaks of a control-changed card.

## MEDIUM

**The promised zone-transition contract remains incomplete and movement is still split across silent paths.**

`ZoneTransition` only represents field-to-Break-Zone movement at [rules.ts:37](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/rules.ts:37), while the revision-2 spec explicitly includes Break-Zone-to-hand transitions. `toHand` silently removes cards from either the field or Break Zone at [resolve.ts:167](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/resolve.ts:167), and `moveToHand` emits no transition at [resolve.ts:351](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/resolve.ts:351). This does not currently break the five implemented clauses, but leaves Cloud’s future return protection and non-“break” field-to-Break-Zone costs without a reliable observer source.

**Fix:** Centralize zone movement behind a transition-producing primitive supporting at least field→Break Zone and Break Zone→hand, with field→hand added before Cloud. Keep `breakCard` distinct from “put into Break Zone,” because the latter must bypass cannot-be-broken protection.

**The Haste target heuristic can choose a strictly dominated target for Lightning’s new clause.**

Haste value is only `1 + power / 1000` at [evaluate.ts:46](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/ai/src/evaluate.ts:46), and target selection consumes that directly at [candidates.ts:166](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/ai/src/candidates.ts:166). With an unblocked 9000 vanilla Forward and fresh 3000 Luso, the AI chooses the 9000 even though both deal one point and Luso additionally triggers its damage/recovery clause at [abilities.ts:269](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/cards/src/abilities.ts:269).

**Fix:** Add immediate `dealtDamage` trigger value to Haste scoring, or perform a bounded combat rollout for forced target choices. Add a real Lightning/Luso-versus-higher-power-vanilla fixture.

## LOW

**C3 deck search cannot safely reuse the current target prompt representation.**

Pending targets contain raw `CardId`s at [state.ts:29](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/state.ts:29). Views copy pending resolution data wholesale at [view.ts:31](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/view.ts:31), while determinisation creates replacement hidden-card IDs and then copies those stale pending IDs at [determinise.ts:27](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/determinise.ts:27). Deck-search candidates would therefore be orphaned for the acting AI and potentially leak private identifiers to opponents.

**Fix:** Define private/revealed choice visibility before adding deck targets. Preserve or rebind authorized candidate IDs in the acting player’s determinisation and redact them from unauthorized views.

**The continuation slot alone cannot implement Cloud’s beginning-of-Attack-Phase clause correctly.**

Passing Main Phase 1 immediately enters attack declaration at [phases.ts:50](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/phases.ts:50), and `enterAttackDeclaration` emits both preparation and declaration events together at [resolve.ts:386](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/resolve.ts:386). Simply queueing Cloud before the existing continuation would resolve it while the state still says Main Phase 1.

**Fix:** Split attack entry into preparation—set Attack Phase and emit beginning-phase triggers—and a continuation that enters declaration only after those triggers resolve.

## VERDICT

Not safe to merge as revision-2 complete until Break Zone ownership and the missing movement-transition contract are fixed. The ten AST clauses do match their printed text; current trigger cardinality, dying-watcher snapshots, settlement ordering, AP-first determinism, and AI draining of queued work are otherwise sound. Focused tests could not start because the read-only sandbox blocked Vite’s `.vite-temp` write, so this verdict is based on static tracing.
