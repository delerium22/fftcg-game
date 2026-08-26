<!-- codex=codex-cli 0.146.0 model=gpt-5.6-sol effort=xhigh cwd=/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai exit=0 head=8b27b88 -->

## BLOCKER

**C2-3 has the correct snapshot boundary, but “once per watcher/clause/batch” is wrong.**

Combat applies every hit before calling rule processing (`packages/engine/src/attack.ts:149`, `packages/engine/src/attack.ts:164`). Inside `runRuleProcesses`, `transitions` is the complete simultaneous batch while `s` still contains every pre-removal field card (`packages/engine/src/rules.ts:79`); removal begins at `packages/engine/src/rules.ts:81`. Therefore all watchers and transitions can be captured together immediately after line 79. The existing enqueue at `packages/engine/src/rules.ts:95` is too late to discover watchers.

That does make a simultaneously dying Lightning trigger: capture it before line 81, then enqueue after movement; off-field sources remain resolvable through `state.cards`/`defs` (`packages/engine/src/resolve.ts:34`). But C2 explicitly deduplicates per batch (`docs/superpowers/specs/2026-08-27-rung-c2-observer-triggers.md:26`, `docs/superpowers/specs/2026-08-27-rung-c2-observer-triggers.md:57`). Lightning must trigger once for every matching Forward moved, so two opponent Forwards in one batch produce two triggers, per [CR 3.3 §11.8.6](https://fftcg.cdn.sewest.net/2026-08/fftcg-comprules-v3.3.pdf).

**Fix:** Before removal, collect immutable watcher snapshots and create one trigger occurrence per `(watcher, clause, matching transition)`. Deduplicate only duplicate discovery of that same occurrence. Add a test where one Lightning watches two simultaneous opponent moves and triggers twice, in addition to C2-A2.

**The agenda has no event payload with which Luso can implement “break it.”**

Luso’s clause identifies the damaged Forward without choosing it (`packages/cards/data/cards.json:242`). C2’s proposed trigger records only `to: 'forward'` (`docs/superpowers/specs/2026-08-27-rung-c2-observer-triggers.md:24`). `Frame` carries source/controller plus choice bindings (`packages/engine/src/abilities.ts:101`), `enqueueTrigger` initializes `chosen: []` (`packages/engine/src/resolve.ts:29`), and `breakCard` only acts on `ctx.chosen` (`packages/engine/src/resolve.ts:220`). As specified, Luso’s frame has nothing to break.

**Fix:** Persist serialisable trigger context on the frame, e.g. `triggerEvent: { kind: 'damage'; source; sourceController; target; amount }`, and add an effect that consumes the event subject. Do not turn “it” into a new target choice. The context must survive prompts and source movement.

**Ability damage will resolve Luso before §12.4.5 unless the frame-draining boundary changes.**

Combat damage explicitly runs rule processes after applying the complete damage batch (`packages/engine/src/attack.ts:156`, `packages/engine/src/attack.ts:164`). Ability damage merely adds damage (`packages/engine/src/resolve.ts:211`) and relies on `settle()` later (`packages/engine/src/resolve.ts:218`). If C2 enqueues Luso when that damage occurs, `drainResolution` finishes the current frame and immediately starts the queued Luso frame without returning to `settle()` (`packages/engine/src/resolve.ts:304`, `packages/engine/src/resolve.ts:321`). Rule processing only happens outside an active frame (`packages/engine/src/apply.ts:39`).

Under [CR 3.3 §§12.3–12.4.5](https://fftcg.cdn.sewest.net/2026-08/fftcg-comprules-v3.3.pdf), the lethal-damage rule process breaks the Forward before Luso’s triggered ability resolves. There is no double-break: afterward `breakCard` sees no field card and no-ops (`packages/engine/src/resolve.ts:222`). On nonlethal damage, the rule process does nothing and Luso subsequently breaks it. Draining Luso first produces the wrong transition cause and narration even if the final zones happen to match.

**Fix:** Make `drainResolution` yield after one completed frame whenever queued trigger work remains. `settle()` must then run rule processes before starting the next frame. Preserve the existing atomicity only within the same active frame across its prompts.

**Unblocked party damage currently has an arbitrary single source, so Luso or Prishe can fail to trigger.**

`dealPlayerDamage` accepts one source (`packages/engine/src/rules.ts:9`), and an unblocked party supplies only `attackers[0]` (`packages/engine/src/attack.ts:143`). Attackers were sorted by card ID (`packages/engine/src/attack.ts:54`), so source attribution depends on allocation order, not party semantics. A Luso or Prishe elsewhere in the party may therefore miss its printed opponent-damage trigger (`packages/cards/data/cards.json:196`, `packages/cards/data/cards.json:242`).

**Fix:** Represent the combat damage source as the attacking Forward or party membership, not the first ID. Define and test how per-card “deals damage” triggers match an unblocked party, including Luso/Prishe both first and non-first in field order.

## MAJOR

**Two of the five clauses require “Character” targeting, which the AST cannot express.**

Prishe retrieves one Character (`packages/cards/data/cards.json:196`), as does Luso’s second mode (`packages/cards/data/cards.json:242`). `TargetFilter` permits exactly one `CardType` (`packages/engine/src/abilities.ts:24`), while Character means Forward, Backup, or Monster—not Summon.

**Fix:** Add a first-class Character predicate or `types: readonly CardType[]`. Test that both Forward and Backup are candidates and a Summon in the same Break Zone is not. Luso’s second clause is consequently the hardest clause: modal choice, Character retrieval, ability damage, and a self-cascade into its first clause.

**C2-2 promises a universal transition pipeline but does not enumerate most existing zone movers.**

“Every card leaving or entering a zone” (`docs/superpowers/specs/2026-08-27-rung-c2-observer-triggers.md:25`) also includes draws (`packages/engine/src/phases.ts:17`), CP discards (`packages/engine/src/cp.ts:99`), Character casts (`packages/engine/src/cast.ts:68`), Summon casts (`packages/engine/src/cast.ts:87`), hand-size discards (`packages/engine/src/phases.ts:79`), and player damage (`packages/engine/src/rules.ts:16`). The decision only names rule breaks, `breakCard`, and `moveToHand`.

The current transition also calls the containing player `owner` (`packages/engine/src/rules.ts:46`) even though actual ownership lives on `CardInstance` (`packages/engine/src/state.ts:6`), then places cards into that controller’s Break Zone (`packages/engine/src/rules.ts:82`). This will fail as soon as control-changing effects arrive.

**Fix:** Either narrow C2-2 explicitly to the movements needed by these five clauses—especially field→Break Zone and Break Zone→hand—or audit every zone mutation and centralize them all. Capture pre-move controller from the field array and owner from `state.cards[id].owner`.

**C2-6 needs a complete ordering key and must label AP-first FIFO as another rules deviation.**

The field arrays are deterministic (`packages/engine/src/state.ts:16`) and are preserved by determinisation (`packages/engine/src/determinise.ts:47`), so watcher collection is deterministic if it traverses only those arrays. But “both fields, plus moving cards” introduces duplicate sources, while the proposed ordering omits zone order, ability/printed order, and an ordering for movers not present in a post-state field (`docs/superpowers/specs/2026-08-27-rung-c2-observer-triggers.md:26`, `docs/superpowers/specs/2026-08-27-rung-c2-observer-triggers.md:29`).

Also, AP-first FIFO is deterministic but not “§12.3-ish”: CR 3.3 §11.8.7 lets each controller order their simultaneous triggers and places the non-turn player’s triggers on top. The current five have no outcome-sensitive AP/NAP conflict, so the simplification is acceptable if stated honestly.

**Fix:** Specify a total key such as `(occurrence index, AP/NAP controller, source zone, pre-event field index, ability index, source ID fallback)`. Collect from arrays, never `state.cards`/`defs`; deduplicate by `(source, ability, occurrence)`. Mark fixed AP-first FIFO `MVP0-SIMPLIFICATION` and test live versus determinised event/queue order.

## MINOR

**The “new trigger resolves between a prompt and its answer” stale-candidate hazard is not reachable in the current reducer.**

`drainResolution` refuses to run while any pending decision exists (`packages/engine/src/resolve.ts:305`) and returns immediately upon raising one (`packages/engine/src/resolve.ts:322`). `settle()` also stops on pending (`packages/engine/src/apply.ts:48`). When the answer clears the prompt, the frame remains active (`packages/engine/src/resolve.ts:367`), so `settle()` skips rule processing and resumes that frame first (`packages/engine/src/apply.ts:40`). There is no reducer path for another trigger to resolve between those commands.

**Fix:** Replace the speculative risk at `docs/superpowers/specs/2026-08-27-rung-c2-observer-triggers.md:62` with a regression invariant: queued triggers and rule processes may not preempt an active frame, including after the new one-frame drain change.

**C2-8 otherwise matches the printed clauses, and deferring Prishe c1 is correct.**

Lightning’s ETB and observer text match the proposed effects (`packages/cards/data/cards.json:272`), including cost ≤4, opponent-only, and Haste for your Forward. Treating the EX Burst icon separately is consistent with the clause count (`packages/cards/src/abilities.ts:48`). Luso’s two clauses and Prishe c2 are correctly identified (`packages/cards/data/cards.json:196`, `packages/cards/data/cards.json:242`).

Prishe c1 is not nearly free: targets are currently selected while a frame is already executing (`packages/engine/src/resolve.ts:169`), and answering resumes that same frame before queued work (`packages/engine/src/resolve.ts:367`). Prishe must trigger on target declaration and gain +2000 before the targeting Summon/ability resolves; the current agenda cannot preempt its active parent without another scheduling model.

**Fix:** Keep Prishe c1 deferred until target declaration is separated from effect resolution or the agenda supports preemption.

**The real C2 cascade is finite, and the existing step budget is sufficient for this pool.**

Luso’s damage trigger only breaks; Lightning’s break observer only grants Haste; retrieval only moves a card to hand. None recreates its own trigger event. Frame starts and effects both consume the persistent budget (`packages/engine/src/resolve.ts:140`, `packages/engine/src/resolve.ts:311`), and it resets only when the entire settlement is quiet (`packages/engine/src/apply.ts:50`). It therefore survives choices as claimed.

**Fix:** Keep the cap. Add the full Luso player-damage → modal 3000 damage → Luso break → Lightning Haste cascade, including prompts, and assert that `steps` never resets mid-cascade. The 512-step exception remains a safety fuse, not CR §13’s rules-correct infinite-loop draw.

**The `JSON.stringify` rationale conflates immutability with determinism.**

Self-play compares the same input before and after `apply` solely to detect mutation (`apps/cli/src/selfplay.ts:60`, `apps/cli/src/selfplay.ts:70`). Actual rollout equivalence is the live-versus-determinised application test shape (`packages/engine/test/abilities-engine.test.ts:282`).

**Fix:** Reword C2-6 accordingly and make C2-A7 compare resulting states, events, pending choices, and resolution queues—not merely JSON stability.

## WHAT I WOULD DO DIFFERENTLY

I would split the work into two internal occurrence types, not one universal pipeline:

1. `DamageOccurrence`, with source/controller, target, amount, simultaneous-batch index, and party membership.
2. `ZoneTransition`, initially scoped to field→Break Zone plus the direct moves these clauses perform.

Settlement would execute one complete frame, run rule processes, then execute the next frame; a suspended active frame would remain atomic across its own answers.

I would land Lightning’s two clauses and Luso’s Forward-damage clause with the watcher/event-context machinery first, including simultaneous-death and two-victim cardinality tests. Then add player-damage/party attribution, Character filtering, Luso’s modal clause, and Prishe c2.

If C2 keeps the universal source-aware transition investment, I would also reconsider deferring Cloud: the continuation already exists (`packages/engine/src/abilities.ts:122`), and C2 is otherwise paying for exactly the source-aware return protection Cloud needs. If Cloud remains deferred, universal transitions and generalized causes are over-built for this rung.
