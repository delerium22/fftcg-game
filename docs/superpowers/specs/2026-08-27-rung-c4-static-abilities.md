# Rung C4 — Static abilities: the first ability that is never *resolved*

> Revision 1 (2026-08-27). Follows C3 (activated abilities), which is complete and reviewed.

## Context

Sixteen of the starter deck's 28 printed clauses work, across 13 of its 19 cards. Every one of them
**resolves**: it goes on the agenda, runs its effects, and finishes. That covers triggered abilities (C1/C2)
and activated ones (C3), and it cannot express the twelve that remain — three of which do not resolve at all.
They are simply *true*, continuously, and the rules consult them.

Grouping the remaining twelve by the machinery they need:

| Needs | Clauses |
|---|---|
| **Static (continuous) abilities** | **3** — Moogle's CP production, Odin's cost reduction, Sphene's Break-Zone protection |
| Deck knowledge (rung C9) | 2 — Miner's and Reeve's ETBs (Hugh Yurg's search is a third) |
| Deck search + put into play + observer | 2 — Hugh Yurg |
| Removed-from-game zone | 1 — Undead Princess's second clause |
| Field→Break-Zone history + once-per-turn | 1 — Sphene's `[0]` |
| "When chosen by a Summon or ability" trigger | 1 — Prishe |
| Attack-Phase entry split | 1 — Cloud |
| — (an AST, no new machinery) | 1 — Odin's break clause |

Statics are the largest single group, and one of the twelve needs nothing new at all.

## Scope: two clauses, both on Odin

**In:**

1. **Odin (13-072R), clause 1** — *"If you have received 5 points of damage or more, the cost required to cast
   Odin is reduced by 3."* The static primitive, and a real comeback mechanic: a 5-cost Summon for 2 when you
   are one hit from losing.
2. **Odin (13-072R), clause 2** — *"EX BURST Choose 1 Forward of cost 5 or less. Break it."* Needs **no new
   machinery**: it is a `summonResolve` clause with a `maxCost` filter and `breakCard`, which is what Ramuh
   and Lightning already do. Free, and it completes the card.

Doing both clauses of one card is deliberate: Odin stops warning entirely, which is the only way to see the
whole card work.

**Out, with reasons:**

- **Moogle's "can produce Lightning CP"** is a static, and it is the tempting third clause — but it makes a
  Backup's element a *choice*, and `Payment.dullBackups` is a bare `CardId[]` with no element on it
  (`commands.ts:4`). Adding one is surgery across `cp.ts`, `payment.ts`, the ISMCTS codec and the browser's
  payment collapsing. It also retires a standing `MVP0-SIMPLIFICATION` ("multi-element backups produce their
  first element; none in the MVP0 pool" — `cp.ts:26`), which deserves its own rung rather than a corner of
  this one.

  > **Corrected in C6.** This estimate was wrong: `Payment` never needed to record which Element a Backup
  > produced, because nothing needs to know. See `2026-08-27-rung-c6-flexible-cp.md`, which did it by giving a
  > CP source a SET of Elements and touching one file.
- **Sphene's Break-Zone protection** is a static whose subject is *removal from the game*, and there is no
  removed-from-game zone yet. It cannot be observed to work, so building it now would be untestable.
- EX Burst itself; everything else in the table above.

## Decisions

| # | Decision | Ruling (and why) |
|---|---|---|
| C4-1 | **A static ability is QUERIED, never queued** | It joins `AbilityTrigger` as `{ kind: 'static'; effect: StaticEffect }` for exactly the reason `activated` did: every dispatch site already switches on `kind`, so a static is inertly ignored by trigger dispatch, and the compiler finds any switch that forgot it. Nothing about it ever reaches the resolution agenda. |
| C4-2 | **`StaticEffect` starts as exactly one shape** | `{ kind: 'costReduction'; amount: number; when: StaticCondition }`. No speculative generality: a second shape arrives when a second card needs one, and the union makes adding it a compile-time exercise. |
| C4-3 | **The condition is explicit data, not a predicate function** | `{ kind: 'damageReceived'; atLeast: number }`. Card definitions travel through `structuredClone` (into the search, into the worker), which strips functions — the same constraint that made the whole ability system an AST. |
| C4-4 | **It applies in `castRequirement`, so everything sees it at once** | `castCheck`, `enumeratePayments`, `preferredPayment`, `legalCommands`, the AI's candidates and the browser's labels all derive from that one function (`cp.ts`). Reducing the cost anywhere else would give two answers to "what does Odin cost". Clamped at 0 — a reduction cannot make a card pay negative CP, and `canPay` already treats 0 as "no CP may be generated" (§11.2.2.4). |
| C4-5 | **A static may modify its OWN card's cost from hand** | Unusual and worth stating: Odin's static is on the card being cast, which is in hand, not on the field. `StaticEffect` therefore carries where it applies — here, to its own cost — rather than assuming statics radiate from the field. Sphene's (a field static affecting a zone) will need a different scope, which is precisely why the field is explicit now. |
| C4-6 | **"Received 5 points of damage" is the CASTER's damage zone** | `state.players[caster].damageZone.length >= 5` (§9.4 damage is received by a player). Getting this backwards would make Odin cheap exactly when you are winning, which no test that only checks "the reduction happens" would catch — so it gets its own test with both players damaged differently. |
| C4-7 | **Odin's `EX BURST` tag is quoted, not implemented** | Exactly as C1 did for Noel and Lightning: the clause fires on a normal cast, which is what `summonResolve` means. EX Burst as a mechanism (revealing off damage) stays out of scope, and `ABILITY_CLAUSES` is unchanged so nothing pretends otherwise. |
| C4-8 | Not in scope | Moogle, Sphene, EX Burst, and the eight clauses in the table needing other machinery. |

## What could go wrong, in the order it will bite

- **Two answers to "what does Odin cost".** The reduction must live in one place. If `castCheck` reduces but
  `enumeratePayments` does not, `legalCommands` offers payments that `apply` rejects — and the AI proposes
  moves the engine refuses, which C3's review showed is how an agent wedges.
- **The AI valuing Odin at its printed cost.** `cardValue` scores hand cards by their definition, which has
  no idea about the reduction. Odin held at 5 damage is worth more than `cardValue` says. Worth checking, not
  worth inventing a term for without a measurement — the last two evaluation corrections both measured
  neutral over 800 games.
- **The condition evaluated for the wrong player** — see C4-6.
- **A "static" that is really a trigger.** Statics must not emit `abilityTriggered`, must not appear in the
  log as an event, and must not consume resolution steps. If any of that happens the primitive is wrong.

## Acceptance criteria

- **C4-A1** Odin costs 5 with fewer than 5 damage and **2** with 5 or more, and the change is visible in
  `legalCommands` (the enumerated payments total 2 CP, not 5), in `castCheck`, and in the browser's cast label.
- **C4-A2 (the condition is the caster's)** With the OPPONENT on 5+ damage and the caster on 0, Odin still
  costs 5. Asserted separately from A1, because a symmetric fixture cannot tell the two apart.
- **C4-A3 (clamped)** A reduction larger than the printed cost floors at 0, and a 0-cost cast admits only the
  empty payment (§11.2.2.4) rather than generating CP that cannot be spent.
- **C4-A4 (statics never resolve)** Casting Odin emits no `abilityTriggered` for the static clause, adds
  nothing to the resolution queue, and consumes no resolution steps.
- **C4-A5** Odin's break clause targets **only** Forwards of printed cost ≤ 5, on either side, and breaks the
  chosen one — through `legalCommands` and `apply`, on the real definition.
- **C4-A6** `ABILITY_CLAUSES` is unchanged (it counts PRINTED clauses); the implemented AST count rises by 2,
  the derived missing-warning count falls by 2, and Odin stops warning entirely.
- **C4-A7** `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm --filter @fftcg/web build` green; fuzzer 200/200
  zero failures; ISMCTS still beats greedy over a mirrored run — **as a regression guard only**.

## What this rung will NOT claim

That the AI plays Odin's reduction well. It will cast Odin more cheaply because the engine says so, but
nothing teaches it to *hold* Odin until the discount applies. Two clauses are far below the noise floor of an
80-game mirror; the acceptance criteria test the rule, not the judgement.
