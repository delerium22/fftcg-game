# Rung C5 — The Attack Phase gets a beginning, and Cloud gets its second clause

> Revision 1 (2026-08-27). Follows C4 (static abilities), complete and reviewed.

## Context

Eighteen of the starter deck's 28 printed clauses work, across 14 of its 19 cards. Ten remain, and they no
longer group: after C4 every one needs *different* machinery, so the "largest group" arithmetic that chose
C3 and C4 has run out. This rung is chosen on two other grounds.

**It is the one C2 already built the seam for.** `phases.ts:44` says, in a comment written a rung and a half
ago: *"C2's Cloud clause instead enqueues its trigger and sets `resolution.continuation` to
`enterAttackDeclaration`, which drains to this exact transition."* The continuation field exists
(`abilities.ts:266`), `drainResolution` already honours it (`resolve.ts:445`), and `hasResolutionWork` already
counts it. Nothing needs inventing; the hole was left deliberately, shaped, and labelled.

**It is the most visible clause left.** Cloud's clause fires at the beginning of **every one of your Attack
Phases** — a recurring effect the player sees each turn, not a one-shot. And it completes Cloud, which is the
same property that made C4 worth doing: a whole card working end to end.

## The clause

> **Cloud (27-124S), clause 2** — "At the beginning of the Attack Phase during each of your turns, choose 1
> Forward you control. Until the end of the turn, it gains *'This Forward cannot be broken.'* and *'This
> Forward cannot be returned to its owner's hand by your opponent's Summons or abilities.'*"

## Decisions

| # | Decision | Ruling (and why) |
|---|---|---|
| C5-1 | **Attack entry splits into preparation and a continuation** | Today `pass` in Main Phase 1 calls `enterAttackDeclaration`, which emits *both* phase events and lands in declaration in one step (`resolve.ts:398`). A trigger queued before that would resolve while the state still said Main Phase 1 — the clause would fire at the wrong time and could not see the Attack Phase it names. Passing now sets `phase: 'attack'` with `step: 'preparation'`, dispatches the beginning-of-phase triggers, and sets `continuation: 'enterAttackDeclaration'`. The agenda drains, then the continuation completes the transition. |
| C5-2 | **A new trigger: `{ kind: 'attackPhaseBegins' }`** | It fires only on its controller's own turn ("during each of **your** turns"), so the restriction lives in the dispatch, not in the card. Every existing dispatch site switches on `kind` and will ignore it; the compiler finds any switch that forgot it, exactly as `activated` and `static` did. |
| C5-3 | **A second `FieldFlag`: `cannotBeReturnedByOpponent`** | `FIELD_FLAGS` currently holds only `cannotBeBroken` (`abilities.ts:81`). The printed text grants two protections and the AST must encode both. |
| C5-4 | **The return-protection flag is INERT today, and this rung says so plainly** | Nothing in the pool returns a Forward from the **field** to hand: `moveToHand` is used by Billy Bob, Prishe and Luso, and every one of them targets the **Break Zone**. So the flag is granted, rendered and tested, but no code path can currently consult it. That is honest to build — it is half of a printed clause, not speculative generality — and it must not be described as protecting anything until a return effect exists. When one does, it gets its check and its test then. |
| C5-5 | **Cloud's own ETB stays untouched** | Clause 1 already works. This rung adds clause 2 only, and `ABILITY_CLAUSES['27-124S']` stays at 2 because it counts PRINTED clauses; what changes is that the implemented count reaches it and Cloud stops warning. |
| C5-6 | Not in scope | Every other remaining clause. In particular **not** Sphene's Break-Zone static, for the same reason C4 excluded it: no effect removes a card from the game, so it cannot be observed to work. Building an unobservable rule is how a codebase acquires code nobody can check. |

## What could go wrong, in the order it will bite

- **The trigger fires on the wrong turn.** "During each of *your* turns" — a dispatch that ignores whose turn
  it is gives the opponent's Cloud a free protection every turn. A symmetric fixture cannot catch this, so it
  gets a test with a Cloud on each side.
- **The continuation strands the game.** If the triggers are dispatched but the continuation is not set — or
  is set and then cleared by something else — the turn stops in a phase with no legal command. The fuzzer
  would catch a hard dead-end; a *silent* one that merely skips declaration would not, so declaration must be
  asserted to arrive.
- **Double phase events.** `enterAttackDeclaration` currently emits the preparation *and* declaration events
  together. Split carelessly and the log announces preparation twice, or never.
- **A choice suspends the transition.** Cloud's clause raises a `chooseTargets`. The player answers it while
  the phase is `attack`/`preparation`, and only then does declaration arrive. That is the whole point of the
  continuation, and it is what the "no pending" guard in `drainResolution` already handles — but it means
  `legalCommands` must be sane in that intermediate state.

## Acceptance criteria

- **C5-A1** Passing in Main Phase 1 with a Cloud on the field raises Cloud's target choice **while the phase
  is `attack`/`preparation`**, and answering it lands in `attack`/`declaration`.
- **C5-A2** Without any beginning-of-phase trigger, passing still goes straight to declaration and emits the
  preparation and declaration events exactly once each, in that order.
- **C5-A3 (whose turn)** With a Cloud on **each** side, only the turn player's fires. Asserted separately
  from A1, because one Cloud cannot tell the two apart.
- **C5-A4** The chosen Forward gains **both** flags, they are visible on the board, and `cannotBeBroken`
  actually prevents a break — while `cannotBeReturnedByOpponent` is asserted only to be *present*, because
  nothing yet consults it (C5-4).
- **C5-A5** `ABILITY_CLAUSES['27-124S']` is unchanged at 2; the implemented count rises by 1; Cloud stops
  warning entirely.
- **C5-A6** `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm --filter @fftcg/web build` green; fuzzer 200/200
  zero failures — the fuzzer matters more than usual here, since this rung changes a transition every single
  game goes through.

## What this rung will NOT claim

That the AI uses the protection well. It gets a free `cannotBeBroken` each turn and `evaluate` already scores
`protection`, so it will not *waste* it — but nothing teaches it to pick the Forward that most needs saving.
One clause is far below the noise floor of a mirrored run, and the acceptance criteria test the rule.
