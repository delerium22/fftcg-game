# Rung V2-B — the five damage-replacement clauses on the Vol. 1 cards — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** encode Wuk Lamat 27-122S clause 1, Charlotte 27-128S clause 1, Porom 11-121C clause 2 and both Yuzuki 13-125R clauses with the V2-A2 vocabulary, empty `pool-coverage`'s gap table, and prove each on the real cards.

**Spec:** `docs/superpowers/specs/2026-09-30-rung-v2-damage-replacement.md` (the clause table; "As built (V2-A1/A2)" for the AS-BUILT names — use those, not this plan's guesses).

## Global Constraints

- Card text quoted verbatim in each ability's `text`; the clause-count convention is AST units (V1-B R2).
- `git add` named paths; never `vitest.config.ts`; every commit green (the gap table and the encodings land together).
- Verify: `pnpm typecheck`, `pnpm lint`, `pnpm test` (report passes and the 5 known worker errors), `pnpm test:browser`.

## The encodings (check each against the printed text and the as-built AST)

- **Charlotte 27-128S** — "If Charlotte is dealt damage, reduce the damage by 1000 instead." → static `damageReplacement { affects: self, change: { reduce: 1000 } }`.
- **Yuzuki 13-125R (1)** — "If a Fire Forward you control is dealt damage by your opponent's abilities, the damage becomes 0 instead." → `affects: { controller: 'self', filter: { type: 'forward', element: 'fire' } }`, `byCause: 'ability'`, `byController: 'opponent'`, `change: { becomes: 0 }`. A Summon (cast or EX Burst) is NOT an ability.
- **Yuzuki 13-125R (2)** — "If a Water Forward you control is dealt damage, reduce the damage by 2000 instead." → element water, `reduce: 2000`, any cause. Yuzuki is Water/Fire: both clauses reach her.
- **Wuk Lamat 27-122S (1)** — "If you control 7 or more Characters, Wuk Lamat gains 'If a Forward you control deals damage to a Forward, the damage increases by 2000 instead.'" → a `damageReplacement` on Wuk Lamat with `when: controlsAtLeast { 7, self }`, `bySource: { controller: 'self', filter: { type: 'forward' } }`, target any Forward, `change: { add: 2000 }` — once per packet.
- **Porom 11-121C (2)** — "[Dull], put Porom into the Break Zone: Choose 1 Forward. During this turn, the next damage dealt to it is reduced by 2000 instead." → activated, cost `{ dull, selfToBreakZone }`, `chooseTargets` 1 Forward → `shieldNextDamage { amount: 2000 }`.

## Tests

- Per card (packages/cards/test/abilities-vol1.test.ts): the printed-text case, and the boundary (Charlotte: 1000 → 0, no trigger; Yuzuki: opponent's Warrior burn → 0, opponent's Ifrit cast and EX Burst → full, battle → full, own ability → full; Water: 5000 → 3000; Wuk: 6 Characters → no increase, 7 → +2000 once for a party; Porom: next hit only, end-of-turn expiry).
- Layer 3 scenarios: `charlotte-endures`, `yuzuki-shields-fire`, `porom-guards`, `wuk-lamat-rallies` (battle + ability damage), and one ORDER scenario: Wuk Lamat's side deals ability damage to a Fire Forward under Yuzuki → the Yuzuki player is asked, both answers land correctly.
- `pool-coverage`: the gap table is EMPTY and stays asserted exactly (a new gap fails).
- Strict self-play Vol. 1 vs Vol. 2 (random/greedy/ISMCTS) still passes; `unimplementedAbilities` for Vol. 1 games is now 0.

## Tasks

- [ ] 1: encodings + per-card tests + gap table emptied (one green commit, or per card with the table shrinking).
- [ ] 2: scenarios + the timing-matrix citations for §11.12.5 rows if the matrix covers them (it covers chapters 9–12: check for 11.12.5 rows and cite).
- [ ] 3: self-play and gate; spec "As built (V2-B)"; PR; merge.

## Revisions after the plan review (2026-10-12)

Codex (gpt-5.6-sol, xhigh); adjudication in `2026-09-30-rung-v2b-replacement-cards.codex-review.md`. These override the
plan above.

- **R1 (C1, C2, M7, L1) — the exact encodings.** Each static is
  `{ id, trigger: { kind: 'static', effect: { kind: 'damageReplacement', id, affects, change, when? } }, text, effects: [] }`,
  `text` a verbatim slice of the printed text. Abilities sit in PRINTED order in `VOL1_ABILITIES`; the stale "rung V2"
  comments in `abilities-vol1.ts` go in the same commit as the clause they describe.

  | Card | Ability id | Effect id | `affects` | `change` | `when` | Position |
  |---|---|---|---|---|---|---|
  | Charlotte 27-128S | `27-128S:damage-reduction` | `reduce` | `{ target: 'self' }` | `{ reduce: 1000 }` | — | before `:no-action-abilities` |
  | Yuzuki 13-125R | `13-125R:fire-zero` | `fire-zero` | `{ target: { controller: 'self', filter: { type: 'forward', element: 'fire' } }, byCause: 'ability', byController: 'opponent' }` | `{ becomes: 0 }` | — | first |
  | Yuzuki 13-125R | `13-125R:water-reduce` | `water-reduce` | `{ target: { controller: 'self', filter: { type: 'forward', element: 'water' } } }` | `{ reduce: 2000 }` | — | second |
  | Wuk Lamat 27-122S | `27-122S:damage-increase` | `increase` | `{ target: { controller: 'any', filter: { type: 'forward' } }, bySource: { controller: 'self', filter: { type: 'forward' } } }` | `{ add: 2000 }` | `{ kind: 'controlsAtLeast', count: 7, controller: 'self' }` | before `:etb` |

  Porom 11-121C `11-121C:shield`, after `:etb`:
  `trigger: { kind: 'activated', sourceZone: 'field', cost: { dull: true, selfToBreakZone: true } }`,
  `effects: [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'any' }, then: [{ kind: 'shieldNextDamage', amount: 2000 }] }]`
  — Warrior 11-010C `:pump`'s shape. The target is declared with the activation, before the cost is paid.
  If a filter key above is not what `DefFilter` calls it, the as-built name wins and the as-built note says so.
- **R2 (H1) — one commit per card, each green.** Each card's commit carries its encoding, its tests, its shrunken
  `EXPECTED_GAPS` entry, its flipped "still warns" test in `abilities-vol1.test.ts`, and its ids in
  `abilities.test.ts`. The commit that removes the LAST gap also flips `selfplay.test.ts:81` from `> 0` to `0`.
  These are tests of the behaviour this rung changes; they are listed in the PR body.
- **R3 (H2, M2, M3) — tests that a wrong encoding fails.** Per card, an exact `toEqual` on the encoded ability, and:
  - Charlotte: a Forward beside her takes full damage; 1000 → 0 marks nothing and fires no dealt-damage trigger; her
    reduction applies to battle, ability and Summon damage alike.
  - Wuk Lamat: 6 Characters (Wuk + 5 Backups) → no increase; a 7th (a Forward) → +2000. With 7: a Summon's damage
    (Ifrit) and a Backup's ability (Warrior's burn, Palom) are NOT increased; the opponent's Forward dealing damage is
    not; her controller's Forward damaging her controller's OWN Forward is; a party's packet is increased once.
  - Porom: found through `legalCommands`; candidates are both players' Forwards and no Backup; not offered while she
    is dull; no CP is spent; she is in the Break Zone before the ability resolves (and it still resolves); the next
    damage only; gone at end of turn.
- **R4 (H3, M1) — Yuzuki's victims are named.** Fire-only victim (Ward 21-001R or Wuk Lamat) for the Fire clause:
  the opponent's action ability (Warrior's burn), auto-ability (Wuk Lamat's ETB), special ability (Jecht Beam) and
  Character EX Burst (Ward) → 0; the opponent's Ifrit, cast and as an EX Burst → full; battle → full; her controller's
  own ability → full. Water-only victim (Charlotte or Yuna) for the Water clause: 5000 → 3000 from any cause, either
  controller. Yuzuki herself, both clauses: an opponent's ability → 0 with no order prompt (both orders end at 0);
  battle → −2000. An opponent's Fire Forward is untouched by either.
- **R5 (H4) — the matrix.** `SCOPE` stays as it is: adding §11.12 means a row for every §11.12 subsection, which is its
  own job (backlog). Row 11.8.15 becomes `tested`, citing the test that a damage replaced to 0 fires no dealt-damage
  trigger, on the real cards. Task 2's "cite §11.12.5 rows" is dropped: there are none.
- **R6 (M4, M5) — scenarios.** `trace` gains `damageReducedToZero` (`zero:<target>`) and `shieldGranted`
  (`shield:<card>:<amount>`); existing goldens cannot change, since no shipped scenario emits either. The ORDER
  scenario: six Characters on the Wuk Lamat side BEFORE she is cast (seven when her ETB resolves), a Fire-only victim
  under the opponent's Yuzuki, the prompt owed by the victim's controller, and both answers played: Yuzuki first →
  2000 marked; Wuk Lamat first → 0, no damage event.
- **R7 (M6) — self-play.** `pool-coverage`'s exact, empty table is the structural gate. The Vol. 1 self-play tests
  assert `unimplementedAbilities` is 0 for random-vs-greedy and for ISMCTS, as integration checks only.
- **R8 (M8) — the conformance audit.** `2026-09-08-rules-conformance-audit.md`: row 11.12.5 and the J6 ladder cell say
  what rung V2 built (damage to Forwards) and what stays absent (every other replacement).
- **R9 (L2) — green.** Green is zero failed tests in `pnpm test` and `pnpm test:browser`, with typecheck and lint
  clean. `pnpm test` may still exit 1 on the known "Timeout calling onTaskUpdate" worker errors; they are counted and
  reported beside the pass count, and any other error is a failure. The gate command is unchanged.
- **R10 (O1, O2) — readings pinned by tests.** §6.4.2: a Forward broken while its damaging ability is on the stack
  still deals that damage as a Forward its controller controlled, so Wuk Lamat's increase applies. §11.12.5.3: Wuk
  Lamat herself gone before her ETB resolves → no increase.

Tasks, revised: **1** Charlotte; **2** Yuzuki; **3** Wuk Lamat; **4** Porom — the last gap, with the self-play flip
(R2, R7); **5** scenarios, `trace`, the matrix row and the audit (R5, R6, R8); **6** gate, spec "As built (V2-B)",
reviews, PR, merge.
