# Rung V2-A1 — damage packets: one application point for every damage to a Forward — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** route every damage to a Forward through one pure applier, with the event shape V2 needs, changing NO behaviour except the one the CR requires (§15.1.1.9.8: a blocked party's damage to the blocker is one total) — so V2-A2 can add replacement effects in one place.

**Spec:** `docs/superpowers/specs/2026-09-30-rung-v2-damage-replacement.md` V2-D1, V2-D4 (event shape only), V2-D10; adjudication `2026-09-30-rung-v2-spec.codex-review.md`.

## Global Constraints

- Behaviour-preserving: every existing test passes unchanged EXCEPT tests that pin per-member party damage events into a blocker (e.g. `cr10-attack.test.ts` ~162 and the First Strike party cases) — each such change is deliberate, listed in the commit message, and justified by §15.1.1.9.8.
- No replacement effects yet: `applyDamagePacket` computes `final = amount` (a single hook, `replacementsFor(state, packet) → []`, returns nothing in this rung).
- Plain-data state; `git add` named paths; never `vitest.config.ts`; every commit green.
- Verify: `pnpm typecheck`, `pnpm lint`, `pnpm test` (5 known onTaskUpdate errors — grep), `pnpm test:browser`.

## Decisions

- **A1-D1 — the packet.** `DamagePacket { target: CardId; amount: number; contributors: readonly { source: CardId; sourceController: PlayerId }[]; cause: 'battle' | 'summon' | 'ability'; causeController: PlayerId; exBurst?: true }` in `state.ts` beside `DamageOccurrence`. `cause` for ability damage comes from the running frame: a Summon's frame (the stack item is a Summon, including an EX Burst Summon) → `'summon'`; any other frame → `'ability'`; `exBurst` from the frame's EX Burst origin (check how an EX Burst frame is marked — `attack.ts`/`rules.ts` `chooseExBurst`).
- **A1-D2 — the applier.** `applyDamagePacket(state, packet): { state; final: number; occurrences: DamageOccurrence[]; events: Event[] }` (engine, pure), and `previewDamagePacket(state, packet): number` (no state change) for the AI. It marks `final` damage on the target (if it is still a Forward on a field), emits the damage event(s), and returns one `DamageOccurrence` PER CONTRIBUTOR (each contributor is a source for dealt-damage triggers and §12.4.5 attribution) carrying `amount: final`. `final <= 0` → no mark, no damage event, no occurrences (V2-D4) — unreachable in this rung, but coded and unit-tested via a stub `replacementsFor` in the test.
- **A1-D3 — events.** `battleDamage` and `abilityDamage` gain `original` (equal to `amount` in this rung) and keep one event per contributor for a party (narration unchanged: "Cloud and Luso deal 8000 damage to X" if the web already groups, else per contributor — keep today's lines). New event kind `damageReducedToZero { target, original, contributors }` declared (emitted from V2-A2); the web narrates it and it is in the "engine really emits" list only once emitted — add the narration now with a unit test on a hand-built event.
- **A1-D4 — call sites.** `resolve.ts` `damage` effect (one packet per chosen target; `forEach` damage likewise), `attack.ts` `hitsFor`/`landHits` (attackers → blocker: ONE packet with all attacking contributors; blocker → lone attacker: one packet; blocker split: one packet per assignment), `landFirstStrike`/`landSecondBatch` (held occurrences are the post-application ones; the second batch builds its own packets; nothing is re-applied). `enqueueDamageTriggers` consumes the returned occurrences. Player damage (`dealPlayerDamage`) is untouched — a regression pins unblocked party and EX Burst player damage.
- **A1-D5 — AI.** `targetDelta`'s damage and the combat/party-split scoring call `previewDamagePacket` (identical numbers in this rung — the point is the seam). No evaluator change.

## Review Focus

1. A blocked party of two into one blocker: one packet, total = sum of powers, each member receives the dealt-damage trigger it had before, and a break by the total is attributed to every member (§15.1.1.9.8, §12.4.5).
2. First Strike: a held batch is never re-applied when the second batch lands; a mixed party (not all First Strike) deals as one packet in the normal batch.
3. An EX Burst Summon's damage has `cause: 'summon'` and `exBurst: true`; an auto ability's has `cause: 'ability'`.
4. Every seeded self-play / e2e / scenario result is unchanged except party-into-blocker events.

---

### Task 1: the packet type, the applier, the preview (engine, unit tests)

- [ ] Failing tests for `applyDamagePacket`/`previewDamagePacket` on hand-built packets (single contributor, two contributors, a target that left, a stub replacement to 0). Implement A1-D1/D2. Commit.

### Task 2: ability damage through the applier

- [ ] Switch `resolve.ts`'s `damage` effect; tests pin `cause`/`exBurst` (Review Focus 3); all existing tests green. Commit.

### Task 3: battle damage through the applier; party aggregate; First Strike

- [ ] Failing tests for Review Focus 1 and 2; switch `attack.ts`; update the per-member party assertions deliberately (list them in the commit). Commit.

### Task 4: AI and web seams

- [ ] AI through `previewDamagePacket` (A1-D5), web narration of the new fields and `damageReducedToZero` (A1-D3). Commit.

### Task 5: ship

- [ ] Gate green; spec "As built (V2-A1)"; PR; merge; fast-forward.

---

## Revisions after the Codex plan review (2026-09-30)

Adjudication: `2026-09-30-rung-v2a1-damage-packets.codex-review.md`. These override the plan above.

- **R1 (C1)** — §12.4.5 breaker attribution is NOT implemented today (no occurrence reaches `runRuleProcesses`;
  `ZoneTransition.cause` is null for rule-process breaks). No pool card reads who broke a card, so it is unobservable:
  timing-matrix row 12.4.5 becomes `simplified` with that note and a marker; a real attribution ledger is backlog.
  Review Focus 1 drops its attribution clause.
- **R2 (C2)** — a packet carries `dealers` (the members that can legally deal damage — every member in this pool; no
  card restricts it) and builds the amount and one `DamageOccurrence` per dealer only from them.
- **R3 (C3, M1)** — the spec's API is authoritative: `applyDamagePacket → { state, applied: boolean, final, trace,
  occurrences, events }` (`trace` empty in A1); an absent or non-Forward target is `applied: false` with nothing
  emitted, and `previewDamagePacket` returns the same `{ applied, final }`. Test a departed target and a Backup.
- **R4 (C4)** — ONE packet-scoped damage event: `battleDamage { target, dealers, original, amount, trace }` (and
  `abilityDamage` likewise with its single source). Per-dealer `DamageOccurrence`s exist only for triggers. The web and
  CLI narrate one line per packet ("Cloud and Luso deal 8000 damage to X"); trigger-cause reconstruction matches a
  dealer within the packet.
- **R5 (H1)** — one exported provenance helper: a normal Summon is a `summon` stack item; an EX Burst frame is
  `Frame.origin === 'exBurst'` and is a Summon's burst (`cause: 'summon', exBurst`) or a Character's (`cause:
  'ability', exBurst`). `Ctx` carries it. Tests: normal Summon, EX Summon, Character EX Burst, auto, activated.
- **R6 (H2, H3)** — battle: choose the First Strike batch at PARTY level first (a mixed party deals nothing early),
  then build packets; aggregate attackers only while the surviving attackers are still a party (§15.1.1.9.5); attacker
  packet before blocker packets. Held First Strike occurrences carry the final amount and `targetController` and are
  enqueued once without re-application (test: all-First-Strike party into a surviving blocker; triggers once).
- **R7 (H4, H5, H7)** — "behaviour-preserving" means BOARD outcomes for the current pool: before any code change,
  capture per-seed winner/turns/command-count for the random, greedy and ISMCTS self-play seeds and the scenario goldens,
  and compare after (event-log changes excluded). Inventory every exact event literal in tests and update them in the
  same commit as the schema; replace negative whole-object equality with predicates; the 3000+5000 → 8000 and
  5000+6000 → 11000 party goldens change deliberately.
- **R8 (H6) sequencing:** (1) pure packet/provenance types and the applier in a new `packages/engine/src/damage.ts`
  (no imports from rules/resolve; exported from `index.ts`); (2) the event schema, BOTH producers, every consumer and
  test literal atomically; (3) resolve migration; (4) battle/First Strike aggregation; (5) AI, keys, invariants, docs.
- **R9 (M2–M8)** — AI: `targetDelta` and `partyDamageCandidates` use `final` for lethal/chip/waste and
  `breaksWhatItDamages`, gated on `final > 0`; `evaluate.ts` untouched. Keys: digest `Frame.origin`; test differing
  origins and aggregate held occurrences. Invariants validate held occurrences (positive integral amount, exactly one of
  target/victim, controllers, `targetController` for Forward hits). CLI: `hotseat.ts` narrates packet damage and
  ability damage (tested). No stub seam in A1: `damageReducedToZero` and zero-final runtime tests move to V2-A2; A1
  only declares the event and its narration (unit-tested on a hand-built event). Route only the `damage` case
  (`forEach` re-enters it; keep a regression). The EX Burst marker is `Frame.origin`, applied in `applyChooseExBurst`
  (attack.ts). Exact order tests: multi-target damage, `forEach`, a departed target, stable dealer order, all damage
  lands before rule processes.
- **R10 (LOW)** — the gate: `pnpm test` exits 1 on the five "Timeout calling onTaskUpdate" worker errors on this
  machine even when every test passes; that is recorded, not called green — report both the pass count and the errors.
