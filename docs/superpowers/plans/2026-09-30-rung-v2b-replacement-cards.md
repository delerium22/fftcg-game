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
