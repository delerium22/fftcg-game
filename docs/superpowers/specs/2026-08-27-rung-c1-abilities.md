# Rung C1 — Card abilities: the resolution engine, proved on five ability clauses

> Revision 2 (2026-08-27), after a Codex plan-review. The changelog is at the end; the review itself is
> `scratchpad/codex-review-c1.md`. Revision 1's card set and its per-card coverage model were both wrong.

## Context

Rungs A and B are merged (`8e7233b`): a headless engine, a `GreedyAgent` that beats random 200/0, and a
browser board you can play a full game on. The one thing that makes the game feel *wrong* is that **every
card plays as if its text box were blank**. A 200-game random fuzzer logs `unimplementedAbilities: 5161`.

**All 18 cards in the pool have abilities, and most have two or three separate clauses.** So rung C is
sliced — and sliced **by ability clause, not by card**, because no card in this pool is wholly inside one
slice. This spec is C1: the resolution engine, proved on five clauses it can carry end to end.

### What the pool actually demands

| Group | Example | Rung |
|---|---|---|
| ETB triggers with targeting | Noel: *dull up to 2 opponent Forwards* | **C1** |
| Summon resolution (the path is currently dead code) | Ramuh: *select up to 2 of 3 modes* | **C1** |
| Until-end-of-turn modifiers (power, keywords, protection) | Cloud ETB: *+3000 and Brave to all your Forwards* | **C1** |
| Modal choice, including a nested target | Shantotto, Ramuh | **C1** |
| Break-zone targeting and zone movement | Billy Bob: *return a Forward from your Break Zone* | **C1** |
| Deck search / reveal top N | Hugh Yurg, Miner, Reeve | C2 |
| Zone-change and damage triggers | Luso, Prishe, Lightning's second clause | C2 |
| Phase-transition triggers | Cloud's Attack-Phase clause | C2 |
| Action abilities (`[Dull]:`, `[Earth], discard:`), costs, once-per-turn | Red Mage, Geomancer, Sphene, Miner | C3 |
| EX Burst on damage | Odin, Noel, Reeve, Lightning | C3 |
| **Static / continuous and cost modification** | Class Tenth Moogle (*produces Lightning CP*), Odin (*cost −3*), Sphene (*Break Zone cannot be removed from game*) | **C4** |

That last row was missing from revision 1 and has no home in C1–C3; it is now rung C4.

## Decisions

| # | Decision | Ruling (and why) |
|---|---|---|
| C1-1 | Abilities are **data, not parsed text** | Each implemented clause is a hand-written AST of typed effect primitives. Nobody parses `def.text` at runtime — it stays the human-readable source of truth the AST is checked against in review, and each test quotes it. |
| C1-2 | The AST lives on **`CardDef`** | `CardDef` gains `abilities?: Ability[]`. `packages/cards` owns and populates it; the engine imports no card-specific code. **Not** an injected function registry — see the box below. |
| C1-3 | A **serialisable resolution agenda** on `GameState` | `state.resolution`: the active frame (source card, ability id, program counter), a queue of pending triggered frames, an optional system continuation (e.g. `enterAttackDeclaration`), the answers recorded so far, and a persistent `steps` counter. `pending` stays exactly what it is — the one decision a player currently owes — and is cleared before the agenda resumes. |
| C1-4 | **No stack, no responses** — the agenda drains immediately | Triggers resolve in trigger order with no opponent response window. This is a real deviation, not a rules-correct model: Lightning targeting Undead Princess should let it sacrifice itself in response, and Ramuh should be answerable. C1 denies that. Marked `MVP0-SIMPLIFICATION` at the resolution site; tests assert the documented immediate-resolution result and never claim CR correctness. |
| C1-5 | Resolution work is **capped by total steps, not call depth** | The cap counts every frame step across the whole agenda and **persists across player choices**, so a trigger cycle cannot launder itself through a `chooseTargets` prompt. Exceeding it throws loudly rather than hanging the browser. |
| C1-6 | Choices are new **`Pending` kinds + command variants** | `chooseTargets { min, max, candidates }` and `chooseMode { modes }`. Every exhaustive switch must be updated — `legal.ts`, `apply.ts`, `candidates.ts`, and the web's `describeChoice`/`subjectsOf`/`sameCommand`/`promptFor`. `apply` re-validates player, uniqueness, min/max and exact candidate membership; it never trusts the pending. |
| C1-7 | Until-end-of-turn state on **`FieldCard`**, and `powerOf` is the **only** power authority | `FieldCard` gains `powerBonus: number` and explicit protection flags (`cannotBeBroken`), alongside its existing `granted: Keyword[]`; all are cleared in the End Phase. `cannotBeBroken` blocks both direct break effects and damage-based breaking, but **not** the zero-power rule process. A shared `effectivePower(def, fieldCard)` is what `powerOf` delegates to, and **the web board must use it too** — `Board.tsx` currently passes printed `CardDef.power`, so a pumped Forward would display the wrong power and damage ratio. |
| C1-8 | Triggers are discovered from **transition records captured before removal** | `runRuleProcesses` removes affected Forwards simultaneously and only then emits `broken`; scanning the resulting field loses the trigger of a card that died at the same instant. Zone transitions are recorded with pre-transition snapshots and cause/controller, enqueued exactly once. Cause/controller is also what lets C2 implement Cloud's *"cannot be returned by your **opponent's** Summons or abilities"*. |
| C1-9 | Coverage is tracked **per clause** | Each clause gets a stable `abilityId`; a card warns `unimplementedAbility` for exactly the clauses that are not implemented. Noel and Cloud keep warning about their unimplemented clauses even in C1. (Ramuh prints exactly ONE clause — the modal 'select up to 2 of the 3 following actions' — so implementing it completes the card and it correctly warns about nothing. Revision 2 wrongly listed it here.) The log stays honest, which is what B-A6 promised the player. |
| C1-10 | The five C1 clauses | **Noel ETB** (0..2 opponent targets, dull) · **Shantotto ETB** (mode → nested target → Haste / cannot-be-broken) · **Cloud ETB only** (mass untargeted power + keyword) · **Billy Bob ETB** (Break-Zone targeting and zone movement) · **Ramuh Summon** (0..2 of 3 modes, damage, sequential target choices — and the only exercise of the Summon path, which is dead code today). |
| C1-11 | Not in scope | Everything in the C2/C3/C4 rows above, the stack and response windows, and Limit Break (skipped program-wide). |

**Why the AST is on `CardDef` and not an injected registry.** Revision 1 specced
`createGame({ scripts })`. Two independent blockers, both verified in code:

1. `viewFor` returns `structuredClone({ … })` (`view.ts:28`) and `determinise` returns
   `structuredClone(state)` (`determinise.ts:53`). **Functions do not survive `structuredClone`.**
2. `determinise` rebuilds `GameState` from a `PlayerView` alone, and its only card-definition channel is
   `defs: view.defs` (`determinise.ts:51`). An injected registry has no route through it, so **the AI
   would roll out a vanilla game while playing an ability game** — every scripted card wrong in
   simulation, with no failing test to show for it.

Codex proposed adding `scripts` to both `GameState` and `PlayerView` and preserving it explicitly in
`viewFor` and `determinise`. Putting the AST on `CardDef` is strictly simpler and achieves the same
thing: `defs` is *already* carried by both, so **neither function changes at all**. Everything in the
agenda, the AST, the answers and the flags must be plain records/arrays/strings/numbers/booleans —
readonly, never `Map`/`Set`/closures — because self-play's strict mode detects mutation with
`JSON.stringify` and `session.ts` serialises `CreateGameOptions`.

## The AI (this is where the ≥ 80 % gate is at risk)

- `resolveCombat` currently drains only `declareBlock` and `assignPartyDamage` (`greedy.ts:44`). A
  `chooseMode → chooseTargets` chain would reach `evaluate` **with the ability unresolved** — the same
  defect class as R4, arriving by a new route. It is generalised to `resolveForcedDecisions`, which
  drains the whole agenda before scoring.
- `evaluate` ignores Haste, Brave, protection, `enteredTurn` and `attackedThisTurn`, so Haste and
  protection targets would all tie and fall back to first-in-order. C1 adds a **cheap one-ply target
  policy** rather than a search: prefer active, highest-effective-power targets for dull; use `cardValue`
  for Break-Zone retrieval; value Haste only on a fresh, active, unattacked Forward it actually makes
  attack-eligible; value cannot-be-broken by current combat exposure.
- `GreedyAgent`'s synthetic-id guard must cover target ids too.

## Acceptance criteria

- **C1-A1** Each of the five clauses produces its printed effect, asserted against the card's own `text`
  quoted in the test — as the documented *immediate-resolution* result, not a claim of CR correctness.
- **C1-A2** `unimplementedAbility` is emitted for exactly the **clauses** that remain unimplemented, and
  no longer for the five that are. Noel and Cloud still warn about their other clauses; Ramuh, Shantotto and
  Billy Bob print only the clause C1 implements, so they correctly warn about nothing.
- **C1-A3** Every choice routes through `legalCommands`, so the AI plays it and the UI can click it with
  no new decision channel. Proved by a headless full game with abilities on.
- **C1-A4** The AI still beats random ≥ 80 % on the seed-1 200-game gate **with abilities enabled**, and
  the greedy mirror still terminates.
- **C1-A5** A card with no `abilities` behaves exactly as today. Existing behaviour tests stay
  semantically valid; the one exact-object `FieldCard` assertion (`cr11.4-cast.test.ts:22`) is updated
  for the new fields. A seeded vanilla self-play run stays identical to `8e7233b`'s.
- **C1-A6** **Determinisation equivalence**: a live scripted state and its determinisation resolve the
  same command to the same result. This is the test that would have caught the registry blocker.
- **C1-A7** The random-walk fuzzer passes with abilities on: no illegal state, no trigger loop, no dead
  end. `checkInvariants` gains agenda checks — finite integral `powerBonus`, valid flags, unique
  candidates, `min <= max <= candidates.length`, pending↔active-frame correspondence, step bound, and no
  queued resolution after game over.
- **C1-A8** `pnpm test`, `pnpm typecheck`, `pnpm lint` green; the browser board plays a full game with
  abilities on, showing **effective** power.

## Changelog vs revision 1

- **Card set changed.** Lightning is out (its EX Burst and zone-change trigger belong to C2/C3); **Ramuh
  is in**, because it proves the untested Summon path plus `0..2` modal selection and sequential targets.
  Cloud is **ETB-only**; its Attack-Phase trigger needs phase continuations and moves to C2.
- **Coverage is per clause, not per card** (C1-9). Revision 1's C1-A2 and C1-9 directly contradicted each
  other: three of its five cards have clauses it explicitly excluded.
- **The resolution agenda (C1-3) is new.** Revision 1 assumed one `pending` slot was enough; answering
  Shantotto's mode alone has to suspend an effect and raise a target choice.
- **Step budget, not call depth** (C1-5), persisting across player choices.
- **Protection flags added** (C1-7) — `granted: Keyword[]` cannot express "cannot be broken".
- **Trigger discovery via pre-removal snapshots** (C1-8) — a post-hoc field scan loses the trigger of a
  card that died simultaneously.
- **The UI is named as a `powerOf` consumer** (C1-7); it currently reads printed power.
- **Rung C4 added** for static/continuous and cost-modifying clauses, which had no home.
- **C1-A5 reworded** — a required new `FieldCard` field cannot leave every existing assertion untouched.

## Known deferrals into C2 (from the C1 code review)

Recorded here rather than left implicit, because C1-8 claimed to build the trigger-discovery machinery
*for* C2 and it is not yet right:

- **`enqueueZoneTriggers` watches the card that MOVED, not the cards observing the move**
  (`packages/engine/src/rules.ts:61`). Lightning's second clause belongs to a Forward watching an
  *opponent's* card enter the Break Zone, so the current shape cannot express it — and it still loses
  Lightning if both cards leave simultaneously, which is the exact hazard the plan-review raised. Direct
  `breakCard` bypasses transitions entirely, and every transition currently records a null cause. C2 must
  snapshot all pre-transition trigger SOURCES, match them against the whole transition batch, and route
  direct breaks/returns and damage-caused moves through one source-aware pipeline. C1 has no zone-change
  triggers, so nothing today depends on this being right.
- **The budget-starved Ramuh mode policy can pick a provably redundant pair.** Modes are valued
  independently and summed (`packages/ai/src/candidates.ts`), so against a lone strong Forward it ranks
  damage+dull first even though both hit the same card, where damage+Haste kills it *and* unlocks an
  attacker. Ramuh has at most seven mode subsets; ranking each jointly, with its nested target policy
  applied in printed order, would make the interaction visible. Quality, not correctness.
- **`evaluate` has no per-card `damage` term**, so chip damage is worth exactly 0 to the search while the
  target policy prices it. The policy's factor is deliberately conservative to limit the disagreement; the
  real fix is a damage term in `material()`.
