# Rung C3 — Activated abilities: giving the player something to *do* with the board

> Revision 1 (2026-08-27). This rung replaced a planned deck-knowledge rung after that one's Codex
> plan-review found four blockers for two clauses; the reasoning is recorded at the top of
> `2026-08-27-rung-c6-deck-knowledge.md`.

## Context

Ten of the starter deck's 28 printed clauses work. Every one of them is **triggered** — something happens to
a card and the ability fires. The player never chooses to use an ability, because there is no way to: the
`Command` union has `castCharacter`, `castSummon`, `declareAttack`, `declareBlock` and the answer commands,
and **nothing for activating an ability** (`packages/engine/src/commands.ts:5`).

That single gap blocks **eight** of the eighteen remaining clauses:

| Card | Clause | Cost | Source zone |
|---|---|---|---|
| Red Mage (1-121C) | Choose 1 Forward, it gains Haste | `[Lightning]` + `[Dull]` | field |
| Noel (16-092C) | Dull all Forwards opponent controls | `[Dull]` + put into Break Zone | field |
| Miner (20-074C) | Draw 1 | `[2]` + `[Dull]` + put into Break Zone | field |
| Undead Princess (19-052C) | Choose 1 Forward, +4000 | put into Break Zone | field |
| Undead Princess (19-052C) | Choose 1 Earth Forward, +2000 | remove from game | **Break Zone** |
| Geomancer (18-064C) | Draw 1 | `[Earth]` + discard itself | **hand** |
| Red Mage (18-069C) | Draw 1 | `[Lightning]` + discard itself | **hand** |
| Sphene (27-126S) | Return a Forward broken this turn to hand | `[0]`, once per turn | field |

They also reuse almost everything that already exists: the `Effect` AST for the effect half, and `Payment`
(`commands.ts:4`) — dulled Backups and discards — for the CP half, which is the same machinery casting
already uses.

**This is the rung a human notices.** Ten triggered clauses make a board that happens to you; activated
abilities are the first thing that makes it a board you *use*.

## Scope: the first four, all from the field

Building all eight at once would drag in three new capabilities at once (a hand-sourced ability, a
Break-Zone-sourced ability with a removed-from-game zone, and this-turn/once-per-turn tracking). The rung
stays small by taking only clauses whose source card is **on the field** and whose costs are CP, dulling, and
self-break:

**In:** Red Mage 1-121C, Noel's second clause, Miner's second clause, Undead Princess's first clause.
**Out (C4):** the two hand-sourced `discard itself` Backups; Undead Princess's second clause and the
removed-from-game zone; Sphene's `[0]` (needs "put into the Break Zone from the field during this turn" and
once-per-turn state).

Four clauses, one new command, no new zones. It also happens to cover every cost shape in the "in" list
exactly once, which is the point of choosing these four.

## Decisions

| # | Decision | Ruling (and why) |
|---|---|---|
| C3-1 | **One new command: `activateAbility { player, card, clause, payment }`** | `clause` indexes into the card's ability list, so a card with two activated abilities is unambiguous. `payment` is the **existing** `Payment`, validated by the **existing** CP machinery — an activated ability's CP cost is not a different kind of cost from a cast's, and giving it its own path would be the beginning of two payment systems. |
| C3-2 | **Costs are a declared list on the ability, paid atomically before any effect runs** | `cost: { cp?: {amount, element?}, dull?: true, selfBreak?: true }`. All of it is paid, or none of it is and the command is not legal. CR §1.3.3: an ability's cost is paid on activation, and the effect resolves afterwards — so a Noel that dulls and breaks itself has already left the field when "dull all opponent Forwards" resolves, and must still resolve. This is exactly the frame/agenda separation C1 built, so the effect half needs no new machinery. |
| C3-3 | **`[Dull]` requires the card to be active, and is not payable by a card that entered this turn** | CR §9.3.2 — a Character cannot use a `[Dull]` ability the turn it enters unless it has Haste. The engine already tracks `enteredTurn` for attack legality; this reuses it rather than inventing a second notion of summoning sickness. |
| C3-4 | **Self-break as a cost bypasses `cannotBeBroken`** | C2 already recorded this distinction and it is now load-bearing: "put into the Break Zone" as a *cost* is not the *break* action, so Cloud's future "cannot be broken" must not make Noel's ability unusable. The primitive is a plain zone move that produces a `ZoneTransition` (so C2's watchers still see it), distinct from `breakCard`. |
| C3-5 | **MVP0-SIMPLIFICATION: activation is restricted to the turn player during Main Phase 1 or 2** | The real rules let action abilities be used whenever a player has priority. MVP0 has no stack and `priority` is always the turn player (`state.ts:47`), so there is no window in which a non-turn player could act anyway. Restricting to the Main Phases is therefore not a further loss of fidelity — it is the honest statement of what the existing priority model can already express. Marked at the site, and listed in the README's deviations. |
| C3-6 | **`legalCommands` enumerates activations, and the AI gets them for free** | `candidateCommands` and the browser choice set are both built from `legalCommands`, so an activation that is legal is automatically searchable and clickable. The AI needs no special casing — but see the risk below about whether it will *use* them. |
| C3-7 | Not in scope | The four deferred clauses above; EX Burst; static abilities (Class Tenth Moogle's Lightning CP, Odin's cost reduction, Sphene's Break-Zone protection); deck knowledge (rung C6). |

## What could go wrong, in the order it will bite

- **The AI will under-use these, and the win-rate gate will not notice.** `evaluate` scores material and
  tempo. Dulling all the opponent's Forwards has no material term at all, and self-breaking a Forward to pump
  another looks like a *loss* of material to a function that counts bodies. Four clauses is far below the
  noise floor of a mirrored run either way, so **the strength gate here is a regression guard, not evidence
  the AI plays them well** — the same statement the last three rungs have had to make, and the reason the
  acceptance criteria below test reachability and correctness directly rather than through win rate.
- **Cost/effect atomicity is the subtle one.** An ability whose cost removes its own source is the normal
  case here, not the exotic one: three of the four break or dull the source. Any implementation that reads the
  source card while resolving the effect will work for Red Mage and break for Noel.
- **A dulled Backup is both a CP source and a cost.** `[Lightning][Dull]` on Red Mage means *pay one Lightning
  CP* (by dulling some other Backup or discarding) *and* dull Red Mage itself. Paying the CP by dulling Red
  Mage would be paying the same cost twice; the payment validator must exclude the source.
- **Once the AI can dull its own Backups for abilities, it can strand itself** with no CP for its main phase.
  That is a legitimate strategic mistake, not a bug — worth watching in the fuzzer, not worth guarding.

## Acceptance criteria

- **C3-A1** Each of the four clauses is reachable from `legalCommands` alone in a real game, and resolving it
  produces its printed effect. (The B-A2-style sweep: drive seeded games and assert every new command shape
  is offered, rather than constructing the position by hand.)
- **C3-A2 (atomicity)** Noel's ability resolves "dull all the Forwards opponent controls" **in full** even
  though its own cost has already put Noel into the Break Zone; Undead Princess's +4000 applies to a chosen
  Forward after Undead Princess has left the field.
- **C3-A3 (cost validation)** An activation is illegal when: the source is dulled, the source entered this
  turn without Haste, the CP payment is short, the payment dulls the source itself, or it is not the
  activating player's Main Phase. Each is a separate test, and each asserts the command is absent from
  `legalCommands` rather than merely rejected by `apply`.
- **C3-A4 (self-break is not a break)** A source with `cannotBeBroken` can still pay a self-break cost, and
  the resulting zone change is visible to C2's observers (a watcher on "an opponent's Forward is broken" must
  **not** fire, because this is not a break — assert both halves).
- **C3-A5** The browser offers activations as ordinary choices, with the printed cost in the label, and a
  human can use all four in a driven game.
- **C3-A6** `ABILITY_CLAUSES` drops by four; the amber "not implemented" warnings stop naming them; the
  marker audit passes.
- **C3-A7** `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm --filter @fftcg/web build` green; fuzzer 200/200
  zero failures; ISMCTS still beats greedy over a mirrored run (regression guard only — see above).

## Open question for the plan review

Whether `[Dull]` as a cost should be expressible on a card in **hand** or the **Break Zone** now, rather than
after C4 discovers it needs to be. The four clauses in scope are all field-sourced, so the narrow version is
sufficient today — but the deferred four are split across hand and Break Zone, and a source-zone-agnostic
design may cost nothing extra if decided now instead of retrofitted.
