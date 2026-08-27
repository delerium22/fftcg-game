# Rung C2 — Observer triggers: damage, and cards watching other cards move

> Revision 2 (2026-08-27), after a Codex plan-review that found four blockers. Changelog at the end; the
> review is `docs/superpowers/plans/2026-08-27-rung-c2-observer-triggers.codex-review.md`.

## Context

Rung C1 is merged (`8b27b88`): a serialisable resolution agenda, five ability clauses, per-clause coverage.
Every C1 trigger fires on the card that *owns* it — `enterField` and `summonResolve` are both "this card
just did something".

**C2 is the other half: a card watching something happen to a different card.** Luso breaks whatever it
damages. Lightning gives one of your Forwards Haste when an *opponent's* Forward is broken.

That is a correction, not a refinement. C1's `enqueueZoneTriggers` looks up abilities on the card that
MOVED (`rules.ts:61`), so Lightning's clause — which belongs to a *different* Forward — cannot be expressed
by it at all. C1 had no zone-change trigger, so nothing depended on it being right. C2 does.

## Decisions

| # | Decision | Ruling (and why) |
|---|---|---|
| C2-1 | `AbilityTrigger` becomes a **discriminated object** | `{ kind: 'enterField' }`, `{ kind: 'summonResolve' }`, `{ kind: 'dealtDamage', to: 'forward' \| 'player' }`, `{ kind: 'observesZoneChange', from, to, whose }`. The two C1 string triggers migrate; their five ASTs are the only callers. |
| C2-2 | A **narrow** transition record, not a universal pipeline | Only `field → breakZone` and `breakZone → hand`. Revision 1 said "every card leaving or entering a zone", which silently includes draws, CP discards, casts, hand-size discards and player damage (`phases.ts`, `cp.ts`, `cast.ts`) — none of which any C2 clause watches. A universal pipeline is over-built for this rung, and the honest cure for that is scope, not ambition. Also: the existing record calls the containing player `owner` when it is really the **controller** (`rules.ts:46`); real ownership is `CardInstance.owner`. Capture controller from the field array and owner from `state.cards[id].owner`. |
| C2-3 | One trigger occurrence per **(watcher, clause, matching transition)** | **Not** once per batch. CR §11.8.6: Lightning watching two opponent Forwards broken simultaneously triggers **twice**. Revision 1's "exactly once per batch" was rules-wrong. Deduplicate only the *same* occurrence being discovered twice. |
| C2-4 | Watchers are snapshotted **before** the batch is applied | `runRuleProcesses` computes `pendingBreakTransitions(s)` while `s` still holds every pre-removal field card (`rules.ts:79`); removal starts at `:81`. Collect immutable watcher snapshots there, enqueue after movement. That is what makes a Lightning that dies **in the same batch as its own victim** still trigger — `Frame.source` already tolerates an off-field source (C1). |
| C2-5 | A frame carries its **trigger event** | Luso's *"break **it**"* names the damaged Forward without choosing it, and a triggered frame starts with `chosen: []` — so as specced in revision 1 Luso's frame had **nothing to break**. `Frame` gains a serialisable `triggerEvent` (`{ kind: 'damage', source, sourceController, target, amount }` / `{ kind: 'zoneChange', card, from, to, controller, owner }`), and a `subject` binding lets effects act on it. "It" must never become a target *choice* — that would let the player retarget a printed effect. |
| C2-6 | Settlement **yields between frames** | `drainResolution` currently starts the next queued frame without returning to `settle()`, so rule processes never run between frames — ability damage would resolve Luso *before* §12.4.5 broke the Forward, which is backwards under CR §§12.3–12.4.5. It now completes **one** frame and yields while queued work remains. C1's atomicity rule is refined, not replaced: **atomic within a frame across its own prompts; rule processes between frames.** |
| C2-7 | Damage triggers fire for **combat and ability damage alike** | Both paths already emit compatible records (`battleDamage` and `abilityDamage`, each `{source,target,amount}`). The printed text says "deals damage", not "deals combat damage". |
| C2-8 | Party attribution is by **membership, not array position** | `resolveDamage` passes `at.attackers[0]` into `dealPlayerDamage`, which discards it (`void source`, commented "reserved for … triggers"). Attackers are sorted by card id (`attack.ts:54`), so **a Luso attacking in a party would trigger or not depending on allocation order**. Every unblocked attacker is dealing that damage and each triggers; the party still causes a single point of damage. |
| C2-9 | `TargetFilter` gains **`types: readonly CardType[]`** | "Character" means Forward, Backup **or** Monster — not Summon — and both Prishe c2 and Luso's second mode retrieve one. A single `type` cannot say it. |
| C2-10 | "Opponent controls" is relative to the **ability's controller** | `whose: 'opponent' \| 'self' \| 'any'` resolves against the watcher's controller, never the turn player. Lightning must mean the same thing from either seat. |
| C2-11 | Trigger order is a **total key**, and AP-first is a deviation | `(occurrence index, AP/NAP controller, source zone, pre-event field index, ability index, source id)`. Collect from the field arrays only — never `state.cards` — so determinisation reproduces it (`determinise.ts:47` preserves array order). CR §11.8.7 actually lets **each controller order their own** simultaneous triggers with the non-turn player's on top; fixed AP-first FIFO is a `MVP0-SIMPLIFICATION`. None of the five clauses has an outcome-sensitive AP/NAP conflict, so it is safe — but it is a deviation and is labelled one. |
| C2-12 | The five C2 clauses, **staged** | Stage 1 (machinery + the clauses that need only it): **Lightning ×2** (`27-127S` ETB break cost ≤ 4; Haste when an opponent's Forward is broken) and **Luso c1** (`27-125S` break what it damages). Stage 2: party/player-damage attribution, `types` filtering, **Luso c2** (modal; Character retrieval; cascades into its own c1) and **Prishe c2** (`22-068R`). Luso c2 is the hardest clause in the rung — modal choice, Character retrieval, ability damage, and a self-cascade. |
| C2-13 | Not in scope | Prishe c1 ("when chosen by a Summon or an ability" — needs the agenda to **preempt an active frame**, which it cannot do; targets are chosen while a frame is already executing), Hugh Yurg / Miner / Reeve (deck search → C3), Cloud's Attack-Phase clause (C3), action abilities and EX Burst (C4), static/cost modification (C5). |

**Lightning's EX BURST tag** governs what happens when the card is taken as *damage*; the ETB clause fires
on a normal cast, which is what C2 implements. Lightning reaches 2/2 clauses and stops warning — EX Burst
is a mechanic, not a clause.

## Acceptance criteria

- **C2-A1** Each clause produces its printed effect, asserted against the card's own `text` quoted in the
  test, as the documented immediate-resolution result (C1-4 holds: no stack, no responses).
- **C2-A2** **Lightning triggers when it is broken in the same batch as its own victim.** Named test.
- **C2-A3** **Cardinality**: one Lightning watching *two* opponent Forwards broken simultaneously triggers
  **twice** (CR §11.8.6) — the case revision 1's dedup rule got wrong.
- **C2-A4** Luso breaks a Forward it damages in combat *and* one it damages with an ability.
- **C2-A5** **Ordering**: on lethal ability damage the §12.4.5 rule process breaks the Forward *before*
  Luso's trigger resolves (Luso's `breakCard` then no-ops on an absent card); on non-lethal damage the rule
  process does nothing and Luso's trigger does the breaking. Assert the transition cause and the narration,
  not just the final zones — they coincide either way, which is exactly why this needs asserting.
- **C2-A6** A Luso in an unblocked **party** triggers regardless of its position in field order.
- **C2-A7** `types` filtering: a Forward and a Backup in the Break Zone are both Character candidates; a
  Summon there is not.
- **C2-A8** The full cascade — Luso player-damage → modal 3000 damage → Luso's own break trigger →
  Lightning's Haste — resolves through its prompts, terminates, is narrated, and `resolution.steps` never
  resets mid-cascade.
- **C2-A9** Queued triggers and rule processes **never preempt an active frame**, including after the
  one-frame-yield change. (Revision 1 listed the opposite as a risk; Codex traced that it is not reachable —
  `drainResolution` refuses to run while a decision is pending. This pins that.)
- **C2-A10** `unimplementedAbility` fires for exactly the unimplemented clauses; Luso and Lightning drop to
  zero, Prishe keeps one.
- **C2-A11** The AI still beats random ≥ 80 % on the seed-1 200-game gate; the greedy mirror terminates.
- **C2-A12** Determinisation equivalence for a damage-triggered *and* a zone-change-triggered clause,
  comparing resulting **states, events, pending choices and resolution queues** — not merely that
  `JSON.stringify` is stable, which only proves the input was not mutated.
- **C2-A13** The strict fuzzer passes with the cascade reachable; every command the UI can reach stays
  reachable (the C1 click-surface assertion). `pnpm test`, `pnpm typecheck`, `pnpm lint` green; a full game
  plays in the browser.

## Risks

- **Double-triggering, and its opposite.** The pipeline is invoked from `attack.ts`, `phases.ts` and
  `apply.ts`; "exactly one occurrence per (watcher, clause, transition)" is easy to lose across three call
  sites in either direction — and C2-A3 and C2-A2 fail in opposite directions, so both are needed.
- **The one-frame yield changes settlement for C1's clauses too.** Every existing ability now returns to
  `settle()` between frames. The C1 tests must stay green unchanged; if one needs editing, that is a
  behavioural regression, not a test fix.
- **Ordering drift between live and determinised play.** Watchers must come from the field arrays only.

## Changelog vs revision 1

- **Dedup rule corrected** (C2-3): once per *matching transition*, not once per batch. CR §11.8.6.
- **`Frame.triggerEvent` added** (C2-5): revision 1 gave Luso no way to refer to the card it damaged.
- **Settlement now yields between frames** (C2-6): without it, ability damage resolves Luso before the
  §12.4.5 rule process, which is backwards.
- **C2-2 narrowed** from "every zone movement" to the two transitions these clauses actually watch, and the
  `owner`/`controller` conflation in the existing record called out.
- **Party attribution by membership** (C2-8) — the array-position bug is real and silent.
- **`TargetFilter.types`** (C2-9) for "Character".
- **Total ordering key, AP-first labelled a deviation** (C2-11).
- **The stale-candidate risk removed** — Codex traced it unreachable; replaced by C2-A9, which pins it.
- **Work staged** (C2-12) so the machinery lands with the clauses that only need it.

## What C2 actually built, and what C3 inherits (from the C2 code review)

Recorded so C3 does not start from a false assumption, the way C2 nearly did:

- **`ZoneTransition` covers field→Break Zone only.** C2-2 promised field→Break Zone *and* Break Zone→hand;
  only the first was built. `toHand` removes from either the field or the Break Zone and emits no
  transition, so `moveToHand` is invisible to observers. No C2 clause watches it, so nothing is wrong
  today — but **Cloud's "cannot be returned to its owner's hand by your opponent's Summons or abilities"
  has no observer source until it exists**, and that is a C3 clause. Build the transition-producing
  primitive before Cloud, and keep `breakCard` distinct from a plain "put into the Break Zone": the latter
  must bypass `cannotBeBroken`.
- **Deck search cannot reuse the current target prompt as-is.** `Pending` carries raw `CardId`s and
  `viewFor` copies them wholesale, while `determinise` mints replacement ids for hidden cards and then
  copies the stale pending ids over. Deck-search candidates would be orphaned for the acting AI and could
  leak private identifiers to the opponent. **Decide the private/revealed visibility model before adding
  any deck target** — it is an information-model change, not a targeting change.
- **The continuation slot alone cannot carry Cloud's Attack-Phase clause.** Passing Main Phase 1 enters
  attack declaration in one step and `enterAttackDeclaration` emits preparation and declaration together,
  so queueing Cloud before it would resolve the clause while the state still says Main Phase 1. Attack
  entry has to split: preparation (set the phase, fire beginning-of-phase triggers) then a continuation
  into declaration once they resolve.
- **Haste targeting is power-blind to abilities.** `hasteUnlock` is `1 + power/1000`, so with an unblocked
  9000 vanilla and a fresh 3000 Luso the AI hastes the 9000 — although both deal a single point of damage,
  and Luso additionally breaks whatever it damages, so a blocker is *good* for it. Left unfixed
  deliberately: the honest value is "what does this card do when it attacks", which is a bounded rollout,
  and inventing a constant to out-weigh 9000 power would be tuning to one fixture. Needs the fixture
  Codex gives (Lightning/Luso vs a higher-power vanilla) and a measured change, not a guess.
