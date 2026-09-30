# Rung V2-A2 — damage replacement effects, the affected player's order choice, Porom's shields — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the replacement machinery of spec V2 on the V2-A1 packet seam, proven by synthetic Layer 1 tests: damage-modifying statics, one-shot shields, the §11.12.5.7 order choice when order matters, 0 damage is not damage, AI and web.

**Spec:** `docs/superpowers/specs/2026-09-30-rung-v2-damage-replacement.md` (V2-D2..D10, "As built (V2-A1)"). Built on `packages/engine/src/damage.ts` (`DamagePacket`, `applyDamagePacket`, `previewDamagePacket`, `damageProvenance`, `DamageTraceStep`).

## Global Constraints

- CR 3.3 §11.12.5.1–7, §4.3; official notice 2020-03-18; @FFTCG_SQEX ruling 2021-08-19 ("damage is not damage").
- Plain-data AST; `git add` named paths; never `vitest.config.ts`; every commit green (report the pass count and the 5 known worker errors separately).
- The card pool is unchanged in this rung (V2-B encodes the five clauses).

## Decisions

- **A2-D1 — the AST.** `StaticEffect { kind: 'damageReplacement'; id: string; affects: DamageScope; change: { add: number } | { reduce: number } | { becomes: 0 }; when?: StaticCondition }` where `DamageScope` names (a) the damaged Forward — `self` (the source card), or `{ controller: 'self', filter?: DefFilter }` (your Forwards of an element) — and optionally (b) the damage — `byCause?: 'ability'`, `byController?: 'opponent'`, `bySource?: { controller: 'self', filter: DefFilter }` (Wuk Lamat: "a Forward you control deals damage to a Forward"). Validated at game creation (definition-only filters, integral amounts, a known `change`). The static is read from cards on the FIELD only.
- **A2-D2 — shields.** Effect `shieldNextDamage { amount: number }` on the chosen Forward → `FieldCard.shields: { id: string; reduce: number; expires: 'endOfTurn' }[]` (id = source card id + turn + sequence — deterministic). Cleared in the End Phase with the other "until the end of the turn" effects and when the card leaves the field (a new FieldCard). A shield is a replacement of the damaged Forward; it is consumed only when APPLIED to a packet. In the ISMCTS field digest; validated by invariants (positive integral `reduce`).
- **A2-D3 — collection and application.** `replacementsFor(state, packet) → Replacement[]` (each `{ id, owner card, change, label }`), in a stable canonical order (by owner card id, then id). `applyInOrder(amount, order) → { final, trace }` with §4.3 arithmetic: a running value that may go negative between steps; final below 0 → 0. `becomes: 0` sets the running value to 0.
- **A2-D4 — when to ask (§11.12.5.7).** If two or more replacements apply and the permutations do NOT all give the same `(final, consumed shields)`, the affected Forward's controller chooses the order: a new pending `chooseReplacementOrder { player, target, options: string[][] }` (the DISTINCT-outcome orders only, each as replacement ids, max 4! = 24), answered by a command `chooseReplacementOrder { player, order: number }` (an index into options). Otherwise the canonical order applies with no prompt.
  - **Battle damage:** the damage step already raises `assignPartyDamage` before landing; do the same — before a batch lands (`resolveDamage`, `landFirstStrike`, `landSecondBatch`), build its packets, and raise one `chooseReplacementOrder` per packet that needs it, storing answers on `attack.replacementOrders` until the batch lands (all packets of a batch are simultaneous — the choices are made first, then everything lands).
  - **Ability damage:** the `damage` effect suspends its frame like a chooser (program counter: the effect's path; the answer is stored on the frame like `picks`), then applies on resume.
  - AI: enumerate the options; greedy picks the order minimising its own loss via `previewDamagePacket` with that order; ISMCTS keys the pending by its options and decodes the index.
- **A2-D5 — 0 damage.** `final <= 0` (or 0 after `becomes: 0`): nothing marked, no `battleDamage`/`abilityDamage`, NO occurrences (no dealt-damage trigger), one `damageReducedToZero { target, dealers, original, trace }`. Shields applied along the way ARE consumed (they replaced the event).
- **A2-D6 — AI.** `previewDamagePacket` applies the replacements (canonical order, or the order minimising damage for the affected side when a choice exists — the affected player's likely choice) and `final > 0` gates the pricing of dealt-damage triggers and break-on-damage (Luso). The evaluator values an active shield as `reduce/1000 × 0.5` of a Forward's durability term (record the weight; strict self-play must still pass).
- **A2-D7 — web.** Damage lines show `original → final` with the trace ("5000 → 4000 (Charlotte)"); `damageReducedToZero` reads "Charlotte's damage is reduced to 0"; the order prompt lists each option as "Yuzuki's reduction to 0, then Wuk Lamat's +2000 → 2000"; a shield badge ("Shield −2000") with an accessible name; the CLI prints the same text.

## Review Focus

1. A packet with Yuzuki-style `becomes: 0` (by an opponent ability) and a Wuk-style `add 2000` from the source side: two outcomes (0, 2000) → the DAMAGED Forward's controller is asked; each answer lands the right amount.
2. Two shields on one Forward and a 1000 hit: both apply only if chosen/needed? Pin: canonical order applies shield 1 (−2000 → −1000), shield 2 (−2000 → −3000), final 0 — both consumed; decide and test whether a shield that cannot reduce further is still "applied" (it is: it replaced the event) — and that a later hit the same turn meets no shield.
3. A blocked party (one packet, two dealers) against a reduction: the reduction applies ONCE to the total.
4. A First Strike batch with an order prompt: the prompt comes before the batch lands; the held occurrences carry the final amount; the second batch builds and asks its own.
5. 0 damage: Luso's "when Luso deals damage to a Forward, break it" does not fire; the web shows the reduced-to-0 line; no `battleDamage` event.

---

### Task 1: the static, collection and arithmetic (no prompt yet)

- [ ] Failing tests: synthetic `self` reduce, element-scoped reduce, `byCause: 'ability'` + `byController: 'opponent'` becomes-0 (a Summon's damage is NOT affected; an EX Burst Summon neither; a Character's EX Burst IS), `bySource` add (battle and ability damage from a Forward you control; not to a player); §4.3 arithmetic; 0 damage per A2-D5. Implement A2-D1, A2-D3, A2-D5 in `damage.ts` (canonical order only). Commit.

### Task 2: shields

- [ ] Failing tests per A2-D2 and Review Focus 2 (expiry at end of turn, leaving the field, keys, invariants). Implement. Commit.

### Task 3: the order choice

- [ ] Failing tests per A2-D4 and Review Focus 1, 3, 4 (battle: party, split, First Strike; ability: a frame suspends and resumes; a pending owned by the non-acting player mid-battle — actingPlayer, auto-pass and the AI coordinator; ISMCTS round-trip). Implement. Commit.

### Task 4: AI and web/CLI

- [ ] Failing tests per A2-D6, A2-D7 and Review Focus 5. Implement. Commit.

### Task 5: ship

- [ ] Gate; strict self-play still passes; spec "As built (V2-A2)"; PR; merge.

## Carried from the V2-A1 code review

- The applier gates `final <= 0` for EVERY packet (battle included): no damage event, no occurrence, a
  `damageReducedToZero` instead — so the held-occurrence invariant (`amount > 0`) and the applier agree.
- The AI's `damageProvenance` call (`candidates.ts` ~120) passes the frame's `origin`, so a priced EX Burst is
  `exBurst: true` where Yuzuki's clause reads it.
