# Rung J1 — the stack, priority that passes, and choices declared when a thing is put on it

> **STATUS: BUILT, 2026-09-08 — slices 1–7 landed** (929b01f, 2185d98, 57010a0, 338981c, 3dcead4, and the
> slice 6/7 commit that follows). The strength gate (A11's `mirror --pairs 30 --seed 1 --a ismcts:200 --b greedy
> --fast`) is recorded under "Slice 6 gate" at the end of this file once the run finishes.
> Revision 2 was the design cleared to build; revision 1 went to a Codex plan review
> ([the review](../plans/2026-09-08-rung-j1-the-stack.codex-review.md)); every finding was checked against
> the code and the adjudication is at the end. The root deviation in the
> [rules-conformance audit](2026-09-08-rules-conformance-audit.md): CR 3.3 §7.12, §11.1, §11.3, §11.6,
> §11.8, §11.11, and the Attack Phase windows §10.1.1.2, §10.1.2.6, §10.1.3.6, §10.1.4.4. The user was away;
> the design calls are mine, recorded so they can be overturned rather than rediscovered.

## What the engine does today, and what the rules say

Today `priority` always names the turn player, `applyPass` advances the PHASE, and a Summon or ability
resolves the instant it is created: `settle` drains `resolution.queue` inside the same `apply`, and every
choice a clause makes is made while it resolves. The non-turn player acts only when a `pending` is owed.

CR 3.3: a player with priority may cast a card or use an ability; forfeiting hands priority to the opponent;
when both forfeit consecutively, the top of the stack resolves and the turn player regains priority, or with
an empty stack the step or phase ends (§11.1.5–7, §11.11.1). Summons and action abilities go onto the stack
and can be responded to (§11.3.2, §11.6.4); Characters do not use the stack and need it empty (§11.4.1,
§9.3.1.5). Auto-abilities do nothing when they trigger; the next time a player would gain priority, rule
processes run, then the turn player places all their triggered auto-abilities and the non-turn player places
theirs on top (§11.8.7, §12.3). **A Summon or ability that "chooses" makes that choice when it is put on
the stack** — modes at casting (§11.3.4, §11.6.6, §11.8.10), targets at casting or placement (§11.3.3,
§11.6.5, §11.8.9), and an auto-ability with no legal target still triggers but is removed at once (§11.8.4).
At resolution, targets that have become illegal are dropped; if none remain the effect is cancelled
(§11.11.2). EX Bursts cannot be responded to (§11.10.2).

## Design

**J1-D1 — state.** `GameState.stack: readonly StackItem[]` (top last) and `GameState.passes: 0 | 1`.
```
StackItem = { kind: 'summon'; card: CardId; controller: PlayerId; frames: readonly Frame[] }   // 0..n clauses
          | { kind: 'ability'; frame: Frame }                                                  // action or auto
```
The item on top is NOT popped when it starts resolving: it stays until every frame of it has completed
(prompts included), so a Summon suspended on a choice is still somewhere — on the stack — and its move to the
Break Zone (§11.11.10) happens at completion. Both fields are public (§7.12.2), ride on `PlayerView` and the
ISMCTS `searchView` verbatim, and are digested into `observationKey` (the ordered items' kind/card/ability
and `passes`). A Summon on the stack is in `view.cards`, is removed from its owner's unseen multiset by
`determinise`, and counts as a zone in `checkInvariants` (every card in exactly one place). `createGame`,
`startTurn`, `stateShim` and the search's view rebuild all carry the two fields.
Game over empties the stack (slice 4, `clearStackAtGameOver`): a Summon still on it goes to its owner's Break
Zone so conservation holds, an ability item is dropped, and `checkInvariants` rejects a result with items
waiting — the same rule the resolution lists already had. This is the review's "documented cleanup that keeps
every card's location" alternative, chosen over preserving the terminal stack because the AI's rollout proxy
(`agendaSize`, C2-A11) and the browser's response-window logic both read a non-empty stack as unfinished work.

**J1-D2 — three lists, three predicates.** `resolution.queue` becomes the TRIGGERED holding list (frames
that have triggered and are not yet placed); `stack` holds placed items; `resolution.active` is the one
frame executing, whether declaring or resolving. `hasResolutionWork` is split: `hasTriggeredWork` (queue
non-empty), `isResolving` (active non-null), `hasStackWork` (stack non-empty). `settle` runs rule processes,
then PLACEMENT (below), and stops on a pending; it never resolves a stack item — only a double pass does.
`resolution.continuation` is retired: the preparation → declaration move becomes the double-pass exit of
the §10.1.1.2 window.

**J1-D3 — declaration is a stage of a frame.** `Frame.stage: 'declare' | 'resolve'` and
`Frame.declared: readonly { path: readonly number[]; targets: readonly CardId[] }[]`. In the DECLARE stage
`runFrame` walks only through choice nodes reachable from the head via other choice nodes — a `chooseTargets`
declares targets; a `chooseModes` declares modes and then each chosen mode's head `chooseTargets` — raising
the same `chooseTargets` / `chooseMode` pendings the resolve stage raises today, answered by the same
commands, and records the answers in `modes` and `declared`. A `chooseTargets` with fewer candidates than
`min` at declaration REMOVES the item (§11.8.4 for auto-abilities; for a Summon or activation the cast is not
offered in the first place, see D5/D6). Reaching a non-choice effect ends declaration. In the RESOLVE stage a
declared `chooseTargets` does not prompt: its declared targets are re-validated against the current
candidates; illegal ones are dropped; if none remain the whole item is cancelled (`abilityNoLegalTarget`,
§11.11.2); a choice node NOT declared (e.g. after an effect) still prompts at resolution (§11.11.5.1).
`lookAtDeck` is not a choice and always happens at resolution.

**J1-D4 — placement, and gaining priority.** `beginPriority(state, to)`: run rule processes (§11.1.3);
while the triggered list is non-empty, take the turn player's frames first (in trigger order, placed so the
FIRST-triggered ends on TOP within the group, preserving today's resolution order), then the non-turn
player's on top of those (§11.8.7); each frame goes through its declare stage — a prompt suspends
placement, and it resumes after the answer; repeat while rule processes or new triggers arise (§11.1.4);
then set `priority = to`. The pass counter is set by the CALLER: an action (cast, activation) and a
completed resolution reset `passes = 0` before granting priority to the actor / the turn player
(§11.3.8, §11.6.11, §11.1.5); a forfeit sets `passes = 1` and grants priority to the opponent without reset.

**J1-D5 — a Summon goes on the stack; it declares at cast.** `castSummon` pays, moves the card from hand
to the stack (a zone, §7.12.1), builds one frame per `summonResolve` clause (zero for a vanilla Summon) and
runs their declare stages; the item is pushed when they finish. `legalCommands` offers a Summon only if its
declaration can succeed (every head choice has ≥ min candidates, §11.3.3) — checked by a dry declare that
raises no prompt. Modes and targets are chosen by the CASTER through the prompts, so `castSummon` itself
carries only the payment (no mode × target enumeration); the browser's tray flow is unchanged and the
prompts follow it. At resolution the frames run in printed order; then the card goes to its owner's Break
Zone (§11.11.10) — or, for a cancelled Summon, the same place.

**J1-D6 — an action ability goes on the stack; it declares at activation.** Unchanged in what is declared
(the head `chooseTargets`, spec C3-1) — the command still carries `targets` — but the frame is built in the
resolve stage with `declared` set, so §11.11.2 re-validation applies at resolution (this is new: today an
activated frame silently skips a departed target). Costs are paid and `usedThisTurn` marked at activation.
`activationCheck` allows either player with priority in a Main Phase or an Attack Phase window
(§9.3.1.7). A `chooseModes` head on an activated ability is now supported through the declare stage (the
C3-1 throw is retired).

**J1-D7 — `observesChosen` becomes a triggered frame.** A card "chosen by a Summon or an ability" triggers
when the choice is DECLARED; the frame joins the triggered list and is placed at the next priority grant —
ABOVE the choosing item, so it resolves first (LIFO). That is exactly the C11 ordering Prishe needs, without
the inline preemption; the C11 marker in `resolve.ts` retires. `dispatchChosenTriggers` becomes an enqueue.

**J1-D8 — what each player may do with priority, in one place.** `priorityActions(state, player)` in the
engine enumerates casts, activations and pass for the priority holder given the phase and step; `legalCommands`
and the AI's `candidateCommands` both call it (the AI prunes payments and target sets as it does now, but
never re-implements the phase switch). Rules: Character — turn player, Main Phase, stack empty
(`castBlocker` gains `'stackNotEmpty'` and `'notTurnPlayer'`). Summon — priority holder, Main Phase or an
Attack Phase window (§9.3.1.6). Action ability — likewise (§9.3.1.7). End Phase — nothing (§9.5.1.1); the End
Phase keeps auto-advancing, recorded as a deviation (§9.5.1.4's re-check window) since the pool has no
end-of-turn trigger.

**J1-D9 — `pass` is a forfeit.** `passes === 0` → `passes = 1`, priority to the opponent (§11.1.6).
`passes === 1` → both forfeited: stack non-empty → the top item resolves (D3 resolve stage; a suspended frame
holds the item on top until answered), then `passes = 0` and `beginPriority(turnPlayer)` (§11.1.5); stack
empty → the step or phase ends (§11.1.7). Passing with a `pending` is illegal, as now.

**J1-D10 — the Attack Phase as six states.** `AttackStep = 'preparation' | 'declaration' | 'declared' |
'block' | 'blocked' | 'damage'`:
- `preparation` — a window (§10.1.1.2); double pass → `declaration`.
- `declaration` — the turn player declares an attack (special action) or passes to Main Phase 2 (§10.1.4.6).
- `declared` — a window (§10.1.2.6); double pass → `block` (defender's `declareBlock` pending, §10.1.3.1).
- `block` — pending, no priority.
- `blocked` — a window (§10.1.3.6); double pass → `damage`.
- `damage` — damage resolution: party split pending if needed; damage dealt; EX Burst resolved in full
  (D11); then a window (§10.1.4.4); double pass → `declaration`.
At every window exit the COMBATANTS are recomputed from the field: attackers that left are dropped (none left
→ skip to the post-damage exit), a blocker that left means the attack is unblocked, a party reduced to one
needs no split. Declaration and block have no trigger vocabulary in the pool ("when attacks/blocks"); the
windows exist without them and the vocabulary is deferred. `finishDamageStep` clears combat exactly as now.

Slice 5 notes (built 2026-09-08): `AttackState.attackers`/`blocker` are recomputed only at a window's EXIT
(`survivors`), so a trick cast inside the window still reads the declared combatants; the six-state
`phaseStarted` events name `declared`/`blocked`, and the browser labels them "combat declared" / "defence
declared" (never the words attack/block, which the prompt reserves for moves it offers). Greedy rollouts pass
through every combat window (`combatWindow` in greedy.ts) so `evaluate` never prices a half-fought attack; the
ISMCTS tree and rollouts collapse pass-only windows (`settleForcedPasses`), so the block stays the attack
edge's child. The browser narrates what an auto-passed window CAUSED (`settleForcedWindows` returns events):
without that, a game ending on a blocked window's exit logged no result line — found by B-A6.

**J1-D11 — EX Burst.** An offered burst that is used runs as `resolution.active` immediately, declare then
resolve, with the attack held in `damage` until it (and any prompt it raises, and anything it triggers being
placed) completes; only then does the §10.1.4.4 window open. Declining opens the window at once. A burst that
ends the game ends it.

**J1-D12 — `resolution.steps` epoch.** Reset when the stack, the triggered list and the active frame are all
empty and no pending is owed — the end of a whole settlement — never between stack items.

**J1-D13 — events.** New: `stackPushed { item, cause? }`, `stackResolved { item }`, `stackCancelled { item }`.
`abilityTriggered` keeps firing when a frame is PLACED (with its cause on the event, from `triggerEvent`),
so the browser's cause pairing reads the event and stops reconstructing from queue position.

**J1-D14 — the AI.** Both agents enumerate windows through `priorityActions`. Greedy's forced-decision tail:
while the stack, the triggered list or the active frame owe work and no pending is on the table, apply `pass`
(bounded by the existing apply budget); pendings are answered as now; `agendaSize` counts stack items.
The rollout policy keeps `pass` last. The `SearchCoordinator` and `stepAi` answer a window whose only
non-concede command is `pass` immediately, through the same delivery bookkeeping, with no pacing delay.

**J1-D15 — the browser.** Engine exports `isResponseWindow(state)` (priority held with a non-empty stack, or
by the non-turn player, or in an Attack Phase window). `useGame` derives `choices` with a pass-only response
window collapsed: it applies the pass synchronously in the same reducer step as the AI's command lands, never
after paint, guarded by state identity. The turn player's own empty-stack phase end stays a button. The
strip's prompt names the window ("The AI cast Ramuh — respond, or pass"); a stack row renders the items above
the strip while non-empty; the log narrates placement and resolution from the new events.

**J1-D16 — last-known information (§11.11.4) is deferred and marked.** `Frame` carries no source snapshot; a
source leaving before its item resolves reads nothing of its former self. No pool clause reads its source's
characteristics at resolution, so this is unobservable today; a `MVP0-SIMPLIFICATION` marker records it.

## Slices (each commits green)

1. **State plumbing**: D1's fields and types, view/searchView/determinise/keys/invariants/stateShim/createGame;
   the stack always empty; no behaviour change. Negative key tests for `passes`/stack.
2. **Priority passing with an empty stack**: D9 forfeit semantics, `priorityActions` (D8) used by both
   `legalCommands` and `candidateCommands`, `isResponseWindow`, browser auto-pass, AI short-circuit.
3. **Declaration + placement + resolution** (D2, D3, D4, D7, D12, D13): triggered frames declare and are
   placed at priority grant, resolve on double pass, re-validate. The card tests move from "immediate" to
   "after both pass" via one helper.
4. **Summons on the stack** (D5) and activations re-validated (D6); Character cast needs an empty stack;
   instant speed for Summons and abilities in windows.
5. **Attack Phase windows** (D10, D11): six states, survivors, EX Burst held in the damage step.
6. **AI tail** (D14) and the strength gate.
7. **Browser** (D15), README, How-to-play, markers retired or narrowed.

## Acceptance

- **J1-A1 (§11.1.6–7)** Main Phase, empty stack: the turn player's `pass` sets `passes = 1` and hands priority
  to the opponent; the opponent's `pass` ends the phase; a cast in between resets the count.
- **J1-A2 (§11.3, §11.11.10)** Casting Ramuh declares its modes and targets through prompts, pays, pushes it
  (in no player zone; on the stack; in `view.cards` for both seats), resolves after both pass, and puts it in
  the Break Zone. Odin cast in response resolves first. A vanilla Summon resolves to nothing and reaches the
  Break Zone. A Summon whose every head choice has no candidate is not offered.
- **J1-A3 (§11.6)** Undead Princess's pump is activatable in the `blocked` window by either player; the pump
  lands before damage.
- **J1-A4 (§11.8.7, §11.8.4)** Two simultaneous zone-change triggers, one per player: the non-turn player's
  resolves first; two of one player's resolve in trigger order. A Character's ETB is on the stack when the
  opponent gains priority, so Ramuh answers it before it resolves; an ETB with no legal target is removed at
  placement (`abilityNoLegalTarget`), never placed.
- **J1-A5 (§11.4.1)** With anything on the stack no Character is castable (`stackNotEmpty`); the non-turn
  player never is (`notTurnPlayer`).
- **J1-A6 (§10.1.x)** Each of the four windows exists; a trick in `blocked` sees `attack.attackers` and
  `attack.blocker`; an attacker removed in `declared` is dropped from combat; a blocker removed in `blocked`
  makes the attack unblocked; a party reduced to one raises no split.
- **J1-A7 (§11.11.2)** An activation whose declared target left is cancelled; with one of two targets left
  it applies to the survivor; a target still present but no longer matching the filter is dropped.
- **J1-A8 (§11.10.2)** Used burst: resolves (prompts included) before the §10.1.4.4 window, and its own
  triggers are placed before the window; declined: the window opens at once; a burst that deals lethal damage
  ends the game (the stack is emptied at game over, D1).
- **J1-A9 (D1)** `viewFor`/`searchView` carry stack and passes; `determinise` round-trips a stacked Summon
  without dealing its code twice (conservation asserted); `observationKey` differs when `passes` differs and
  when the stack differs, and is equal for equal stacks.
- **J1-A10 (D7)** Prishe chosen by an opponent's Odin: the pump is placed above Odin and resolves first; Odin
  then deals its damage to the pumped Prishe.
- **J1-A11 (D14)** Greedy and ISMCTS at a pass-only window return `pass`; at a window with Ramuh in hand and
  an opposing Forward on the stack's target list, greedy considers the response; `selfplay --games 200 --seed 1`
  is 200/200 with invariants; `mirror --pairs 30 --seed 1 --a ismcts:200 --b greedy --fast` ≥ 60 % for
  ISMCTS (draws half; the pre-J1 figure is 75 %, CI [66.7, 82.5]).
- **J1-A12 (D15)** In a mounted Board a pass-only response window is never rendered as a strip with only Pass
  (the state advances within the same commit); a window with a real answer shows the stack row and the
  prompt names the item; the coordinator answers a pass-only window in under 50 ms in a headless test.
- **J1-A13** Markers retired: `cast.ts` Summon-in-Main-only, `activate.ts` sorcery-speed, `resolve.ts` C11
  inline chosen, `attack.ts` damage-step auto-advance, `state.ts` priority-always-turn-player, `resolve.ts`
  no-stack (C1-4). Narrowed: §11.8.7 within-player order. Added: §11.11.4 last-known, §9.5.1.4 End Phase
  window. README's "Deliberate shortcuts" and the How-to-play sheet rewritten.
- **Gates** typecheck, lint, unit, browser; plus A11's runs.

## Mutation plan

| mutation | must fail |
|---|---|
| `pass` advances the phase on the first forfeit | A1 |
| a Summon resolves at cast | A2 |
| triggered frames drain in `settle` without placement | A4 |
| the NAP's frames placed below the AP's | A4 |
| an auto-ability with no target is placed anyway | A4 |
| declared targets not re-validated at resolution | A7 |
| `observesChosen` still applied inline | A10 |
| a Character castable with a non-empty stack | A5 |
| the `blocked` window skipped | A6, A3 |
| combatants not recomputed at a window exit | A6 |
| EX Burst placed on the stack, or the window opened before it resolves | A8 |
| `passes` or the stack missing from `observationKey` | A9 |
| a stacked Summon dealt twice by `determinise` | A9 |
| a stacked Summon dropped from `view.cards` | A2, A9 |
| greedy prices a leaf with an unresolved stack | A11 |
| the browser renders a pass-only window | A12 |

---

## Plan review outcome (revision 1 → 2)

Codex (GPT-5.6-Sol, xhigh) reviewed revision 1 against the code: 8 CRITICAL, 10 HIGH, 8 MEDIUM, 5 LOW.
Every finding was verified in the source before being adjudicated. **All 31 accepted**, none rejected, no
disagreement — the review was right on every point it made, and the largest correction reshaped the rung.

**Accepted (CRITICAL, 8):** choices must be declared at placement (§11.8.4/9/10) → D3's declare stage, the
biggest change; the `Resolution` contract (`hasResolutionWork`, `settle`, `continuation`) → D2's three
predicates and the continuation retired; a popped Summon lost during a suspension → D1 keeps the top item on
the stack until complete; EX Burst → D11; `candidateCommands` duplicating the phase switch → D8's
`priorityActions`; a stacked Summon absent from `view.cards`/dealt twice by `determinise` → D1; `observationKey`
missing `passes`/stack → D1 + A9; `observesChosen` inline → D7.

**Accepted (HIGH, 10):** Summon item with 0..n frames; Ramuh's modes at cast (§11.3.4) — now declared at cast
by prompts, and the §11.3.3 "no target → not castable" rule implemented as a dry declare in `legalCommands`,
so the revision-1 deviation is gone; activated-frame re-validation (D6); `beginPriority` vs the pass counter
(D4: caller sets `passes`); `AttackStep` keeps `preparation` (D10 has six states); stale combatants (D10);
terminal stack: emptied at game over with Summons to the Break Zone, cards on the stack counted as a zone (D1); greedy tail over stack work (D14); stack
lifecycle events with cause (D13); the test-migration list (slice 3's helper; slices name their suites).

**Accepted (MEDIUM, 8):** End Phase deviation recorded (D8); within-controller placement reversed so
resolution order stays first-triggered-first (D4); last-known information deferred and marked (D16);
synchronous auto-pass with identity guard and an engine `isResponseWindow` (D15); coordinator short-circuit
through the same delivery path (D14); declaration/block trigger vocabulary deferred, windows kept (D10);
`steps` epoch (D12); the structural projection list (D1).

**Accepted (LOW, 5):** `passes: 0 | 1`; A8's branches; the mutation table extended; the strength gate made
numeric (A11); stale references corrected.
