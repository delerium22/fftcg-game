# Rung V2-B plan — Codex review adjudication (2026-10-12)

Codex (gpt-5.6-sol, xhigh, read-only, codex-cli 0.146.0) against main 88429e0. Each finding checked against the code,
the printed texts in `packages/cards/data/cards.json`, and CR 3.3 (the PDF the section index names; §6.4.2, §11.8.15,
§11.10.1–3, §11.12.5.1–7).

**Accepted (2 CRITICAL, 4 HIGH, 8 MEDIUM, 2 LOW — 16 of 16; L2 in part):**
- C1 the three static sketches are not the as-built AST → R1. Evidence: `abilities.ts:459` requires `id` and
  `affects: DamageScope`; `DamageScope.target` is `'self' | { controller, filter? }` (`abilities.ts:475`). The plan
  already said its names were guesses, so this is a wording fix, not a design change.
- C2 Porom's sketch is not a valid `Ability` → R1. Evidence: Warrior 11-010C prints the same cost and is encoded
  `{ kind: 'activated', sourceZone: 'field', cost: { dull: true, selfToBreakZone: true } }` (`abilities-vol1.ts:280`);
  targets are declared with the activation and checked before any cost is paid (`activate.ts:104`).
- H1 "every commit green" cannot hold as sequenced → R2. Evidence: `selfplay.test.ts:81` asserts `> 0`;
  `abilities-vol1.test.ts:837, 859, 909, 915` assert the warnings; `abilities.test.ts:453–476` pins both id lists.
- H2 the listed tests admit wrong encodings → R3 (exact AST assertions and negative controls).
- H3 Yuzuki is Water AND Fire (`cards.json`: `["water","fire"]`), so "battle → full" is false on her → R4.
- H4 the timing matrix has no §11.12.5 rows: `SCOPE` (`timing-matrix.test.ts:16`) omits §11.12, and row 11.8.15
  (`timing-matrix.md:165`) still says the pool has no replacement effect → R5.
- M1 "abilities" needs a Character EX Burst and a special ability → R4. Evidence: §11.10.3 — a Character's EX Burst
  applies its marked AUTO-ABILITY, a Summon's applies the Summon; `damageProvenance` reads the source's printed type.
- M2 Porom's cost and target clause are untested → R3. M3 a legal 6/7-Character fixture → R3. M4 the ORDER scenario's
  board → R6. M5 the scenario `trace` drops `damageReducedToZero` and `shieldGranted` (`harness.ts:121–166`) → R6.
- M6 a zero self-play counter is vacuous when the card is never cast → R7 (pool-coverage stays the structural gate).
- M7 ids and printed order → R1. M8 the conformance audit's row 11.12.5 and its J6 ladder cell → R8 (the audit is a
  live document: every rung since J1 has struck its own row).
- L1 stale source comments → R1. L2 "green" with a nonzero exit → R9, in part.

**Rejected (in part, 1):** L2's suggested change of command. The gate is fixed by the lane contract
(`pnpm typecheck && pnpm lint && pnpm test && pnpm test:browser`), and `--no-file-parallelism` would time a different
run than every earlier rung's. What is accepted is the definition: green is zero failed tests, with the worker
errors counted and named separately.

**Severity:** C1 and C2 are worded as CRITICAL; both are shape corrections the type checker would have forced. Nothing
in the review changes the rung's design.

**Added by the adjudication (not raised by Codex):**
- O1 a dealer that has left the field. §6.4.2: "If the source of an ability has been removed from its original Zone
  when that ability needs to reference information from it, the card's information is used in the state it was in
  just before it left the Zone." So a Forward whose ability is on the stack and which is then broken still "deals
  damage" as a Forward its controller controlled, and Wuk Lamat's increase applies. As built, the dealer carries the
  frame's controller and `bySource.filter` reads the printing, which agrees → R10 pins it.
- O2 Wuk Lamat's own presence. Her static is read from the FIELD (§11.12.5.3): if she leaves before her own ETB
  resolves, nothing increases it → R10.
