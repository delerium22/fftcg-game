# Rung J1 — the stack, and priority that passes

> **STATUS: designed 2026-09-08, awaiting plan review.** The root deviation in the
> [rules-conformance audit](2026-09-08-rules-conformance-audit.md): CR 3.3 §7.12 (the stack), §11.1
> (priority), §11.3 (casting a Summon), §11.6 (action abilities), §11.8.7 (placing auto-abilities), §11.11
> (resolving), and the four Attack Phase windows §10.1.1.2, §10.1.2.6, §10.1.3.6, §10.1.4.4. Seven of the
> engine's 26 `MVP0-SIMPLIFICATION` markers are consequences of its absence. The user was away; the design
> calls are mine and are recorded so they can be overturned rather than rediscovered.

## What the engine does today, and what the rules say

Today `priority` is a field that always names the turn player, `applyPass` advances the PHASE, and a Summon
or ability resolves the instant it is created (`resolution.queue` is drained inside the same `apply`). The
non-turn player acts only when a `pending` is owed to them (block, party split, EX Burst, an ability choice).

CR 3.3: a player with priority may cast a card or use an ability; if they forfeit, the opponent gains
priority; when both forfeit consecutively, the top of the stack resolves (then the turn player gains priority
again), or, with an empty stack, the step or phase ends (§11.1.6–7, §11.11.1). Summons and action abilities go
onto the stack and can be responded to (§11.3.2, §11.6.4); Characters do not use the stack and need it empty
(§11.4.1, §9.3.1.5). Auto-abilities do nothing when they trigger; the next time a player would gain priority,
rule processes run, then the turn player places all their triggered auto-abilities, then the non-turn player
places theirs on top (§11.8.7, §12.3). EX Bursts cannot be responded to (§11.10.2).

## Design

**J1-D1 — `GameState.stack` and `GameState.passes`.** `stack: readonly StackItem[]`, top last. A `StackItem`
is `{ kind: 'summon'; card; frame }` or `{ kind: 'ability'; frame }` where `frame` is the existing `Frame`
(source, controller, path `[]`, `origin: 'activated' | 'triggered'`). `passes` counts consecutive forfeits
(0, 1, 2). Both are public (§7.12.2) and ride on `PlayerView` verbatim, so `determinise` rebuilds the same
stack and the ISMCTS simulates the game it is playing (the C1-2 argument, again).

**J1-D2 — `resolution.queue` becomes the TRIGGERED holding list; the stack is where things resolve.** An
auto-ability that triggers is enqueued exactly as today. What changes is when it runs: `settle` no longer
drains the queue. Instead, `grantPriority(state, to)` — the one function every "X gains priority" line in the
CR maps to — runs rule processes (§11.1.3), then moves the queue onto the stack: the turn player's frames
first (in queue order), then the non-turn player's on top (§11.8.7), repeats until quiet (§11.1.4), then sets
`priority = to`, `passes = 0`. `drainResolution` keeps its job for the frame that is ACTUALLY resolving
(`resolution.active`), which is now only ever the top of the stack after a double pass, or an EX Burst.

**J1-D3 — `pass` is a forfeit.** `applyPass`: if `passes === 0` → `passes = 1`, priority to the opponent
(§11.1.6). If `passes === 1` (both forfeited): stack non-empty → pop the top, run it as `resolution.active`
through the agenda (a Summon moves to its owner's Break Zone when done, §11.11.10; an ability ceases), then
`grantPriority(turnPlayer)` (§11.1.5); stack empty → the current step or phase ends exactly as `applyPass`
ends it today (§11.1.7). A frame that suspends on a `pending` stays `active` until answered, then continues;
priority is granted only once it finishes.

**J1-D4 — what each player may do with priority.**
- Cast a Character: turn player, Main Phase, stack empty, no pending (§11.4.1 + §9.3.1.5). `castBlocker`
  gains `'stackNotEmpty'` and `'notTurnPlayer'`.
- Cast a Summon: the priority holder, Main Phase or any Attack Phase step where priority is held (§9.3.1.6).
  Retires the `cast.ts:12` marker.
- Use an action ability: the priority holder, Main or Attack Phase (§9.3.1.7). Retires the `activate.ts:102`
  marker: Undead Princess becomes a combat trick.
- End Phase: nothing may be cast or used (§9.5.1.1); the End Phase keeps auto-advancing, with a note that
  "at the end of the turn" triggers (none in the pool) would need a window there.

**J1-D5 — casting a Summon puts it on the stack; its costs are paid now; its choices are made at
resolution.** The card leaves the hand for the stack (a zone, §7.12.1; it is in no player's array while
there), and its `summonResolve` frame runs when it resolves. Choices stay at resolution (§11.11.5.1 permits a
choice not declared at casting to be made then, and the pool's modal Ramuh chooses a mode and then a target).
**Deviation, marked:** §11.3.3 says a Summon that "chooses" needs a legal target to be CAST; here a Summon
with no target is castable and fizzles at resolution (§11.3.9 / §11.11.2 already cancel it). Declaring at
cast is a later rung, because it needs mode × target enumeration at cast time and the sheet to offer it.

**J1-D6 — activating an action ability puts its frame on the stack.** Targets are still declared at
activation (spec C3-1, unchanged) and re-validated at resolution (§11.11.2): a target that left is dropped,
and if none remain the effect is cancelled. Costs are paid at activation, as now. `usedThisTurn` marks at
activation.

**J1-D7 — the Attack Phase gets its windows.** After the preparation triggers are placed → priority to the
turn player (§10.1.1.2); both pass, empty stack → declaration. Declaration is a special action; after its
triggers are placed → priority (§10.1.2.6); both pass → the defender's `declareBlock` pending. Block declared →
its triggers → priority (§10.1.3.6); both pass → damage resolution (with the party split pending first, as
now); damage dealt → its triggers → priority (§10.1.4.4); both pass → back to declaration, where the turn
player declares another attack or passes to Main Phase 2 (§10.1.4.6). `AttackStep` gains the two states that
distinguish "declaration open" from "window after damage": `'declaration' | 'declared' | 'block' | 'blocked'
| 'damage'`; `attack.attackers` and `blocker` persist through a window so a trick can read them.

**J1-D8 — the End Phase, EX Burst and pendings are untouched.** EX Bursts go to the FRONT of the resolving
work and resolve without a window (§11.10.2), as G3 built. `pending` still outranks priority in `actingPlayer`.

**J1-D9 — the AI.** `legalCommands` already enumerates for whichever player acts, so ISMCTS and the greedy
agent handle response windows without a model change; `pass` is a candidate in every window. Two additions:
`SearchCoordinator` (browser) and `stepAi` answer a window whose only non-concede command is `pass`
immediately, without a search and without the 600 ms pacing — a game of windows the AI visibly "thinks"
about would feel broken. The rollout policy passes in windows (it already keeps `pass` last).

**J1-D10 — the browser.** `useGame` auto-passes for the human when `actingPlayer` is the human, the only
non-concede legal command is `pass`, AND it is a response window (the stack is non-empty, or the human is
not the turn player, or the attack step is a window). It never auto-passes the turn player's own empty-stack
phase end — that is the "Pass" that ends your Main Phase, and it stays a button. The strip's prompt names
the window ("The AI cast Ramuh — respond, or pass"); a `Stack` row renders the items (card sheet on press)
between the two fields, above the strip, only while non-empty. The log narrates "put on the stack" and
"resolves" as two lines.

**J1-D11 — invariants and undo.** `checkInvariants`: `passes ∈ {0,1,2}`; a stack item's `source` exists;
a Summon on the stack is in no player zone; `priority` is a player; after game over the stack is empty.
`GameSession.undo` replays, so nothing new is needed.

## Rejected

- **Declaring Summon targets at cast in this rung.** Right per §11.3.3, but it multiplies `legalCommands`
  (modes × targets × payments for Ramuh) and needs the sheet to offer the choice before the tray. Recorded as
  the J1 deviation; a follow-up rung.
- **Letting the triggering player order simultaneous triggers.** Still queue order within a player; the
  §11.8.7 AP-below-NAP placement is done, the within-player ordering choice is not (no pool clause is
  order-sensitive). The marker narrows rather than goes.
- **Auto-passing the AI's own phase ends.** Only windows are short-circuited; ending a phase is a decision.

## Acceptance

- **J1-A1 (§11.1.6–7)** From the turn player's Main Phase with an empty stack: `pass` hands priority to the
  opponent with `passes = 1`; the opponent's `pass` ends the phase. A cast Summon in between resets `passes`.
- **J1-A2 (§11.3, §11.11.10)** Casting Ramuh puts it on the stack (in no player zone; `stack[0].card` is it),
  pays now, resolves after both pass, then it is in the Break Zone. Before both pass the opponent may cast
  Odin in response; Odin resolves first (LIFO).
- **J1-A3 (§11.6)** Undead Princess's pump can be activated in the Attack Phase after blockers, by either
  player with priority; the pump lands before damage.
- **J1-A4 (§11.8.7)** Two simultaneous zone-change triggers, one per player: the non-turn player's resolves
  first. A cast Character's ETB is on the stack when the opponent gains priority, so Ramuh can answer it
  before it resolves.
- **J1-A5 (§11.4.1)** With a Summon on the stack, no Character can be cast; `castBlocker` says
  `stackNotEmpty`; the non-turn player can never cast a Character (`notTurnPlayer`).
- **J1-A6 (§10.1.x)** Each of the four Attack Phase windows exists and passes through to the next step on a
  double pass; a trick cast in the §10.1.3.6 window sees `attack.attackers` and `attack.blocker`.
- **J1-A7 (§11.11.2)** An activation whose declared target has left the field by resolution is cancelled
  (`abilityNoLegalTarget`); one with a surviving target still applies to it.
- **J1-A8 (§11.10.2)** An EX Burst offered during the damage step resolves before any window opens.
- **J1-A9** `viewFor` carries `stack`/`passes`; `determinise` round-trips them; ISMCTS at a window with only
  `pass` returns `pass`; a full self-play run (200 games, both agents) is 200/200 legal with the invariants on.
- **J1-A10 (browser)** The human is never shown a window whose only answer is pass; a window with a real
  answer shows the stack row and the prompt names the item; the AI answers a pass-only window without the
  pacing delay (measured under 50 ms in a headless test of the coordinator).
- **J1-A11** The seven markers named in the audit are retired or narrowed, the README's "Deliberate
  shortcuts" is rewritten, the How-to-play sheet stops saying "only in your own Main Phases".
- **Gates** typecheck, lint, all unit tests, browser tests; `selfplay --games 200 --seed 1` 200/200;
  `mirror --pairs 30 --a ismcts --b greedy --fast` still comfortably above 50 % (the AI must not get worse
  than random at responding — a regression here is a bug in the windows, not a strength question).

## Mutation plan

| mutation | must fail |
|---|---|
| `pass` still advances the phase on the first forfeit | A1 |
| a Summon resolves at cast | A2 |
| triggers drain inside `settle` without a window | A4 |
| the NAP's triggers are placed below the AP's | A4 |
| a Character is castable with a non-empty stack | A5 |
| a window is skipped after block declaration | A6, A3 |
| resolution does not re-validate declared targets | A7 |
| `stack` missing from the view | A9 |
| the browser offers a pass-only window as a button | A10 |
