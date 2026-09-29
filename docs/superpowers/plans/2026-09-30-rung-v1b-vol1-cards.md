# Rung V1-B — the Vol. 1 cards, patch and deck files — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Starter Set 2025 Vol. 1 (Fire/Water, Zack) joins the card pool as printed: 22 cards, a 50-card main deck file and an 8-card LB deck file, every expressible clause encoded, the rest honestly marked, strict self-play Vol. 1 vs Vol. 2 green.

**Architecture:** data (`cards.json` via `fetch-cards`, plus a hand patch for the four exclusives) → encodings in a NEW module `packages/cards/src/abilities-vol1.ts` merged into the existing `ABILITIES`/`ABILITY_CLAUSES`/`INERT_CLAUSES` maps → deck files → Layer 3 scenarios. One PR (spec V1-D2: `pool-coverage` makes the data, the decks and the encodings atomic). No engine change, unless an encoding hits a gap — then stop and report it rather than widen this PR.

**Tech Stack:** TypeScript, pnpm workspaces, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-29-rung-v1-vol1-pool.md` (V1-D1, V1-D3, V1-D4 and the As built notes of V1-A1..A3 — use the AS-BUILT names of the vocabulary, e.g. the transition reason `putByAbility`, `select`, `onlyIfChosen`, `playOntoField`, `amountOf`'s `Amount` shape, `anyOf`, `elementIn`/`sameElementAsChosen`, `special`/`discardSameName`, `onlyCp`, `cannotUseActionAbilities`, `StaticScope.self`).

## Global Constraints

- The decklist, its source and counts are exactly spec V1-D1. The deck file headers cite Materia Hunter product 229 and say the list is unofficial.
- Never commit card art. `vitest.config.ts` never staged. `git add` named paths.
- The Vol. 2 deck files are unchanged, so Vol. 2 seeds do not move. Any test that reads "every card in the pool" will now see Vol. 1 too — expect to update such pool-wide assertions (e.g. `abilities.test.ts`'s list of implemented codes/ids, pool-coverage's UNKNOWN set), never to weaken them.
- Card text is quoted verbatim in each ability's `text` (the SE text, or Materia Hunter's for the exclusives).
- Verify: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:browser` (run separately; the known 5 "Timeout calling onTaskUpdate" errors are machine-load noise — grep to confirm).

## Decisions

- **B-D1 — data.** Add `decks/starter-2025-vol1.txt` and `decks/starter-2025-vol1-lb.txt` first, then `packages/cards/data/patches/starter-2025-vol1-exclusives.json` for 27-122S Wuk Lamat, 27-123S Zack, 27-128S Charlotte, 27-129S Yuna, with name/type/elements/cost/power/keywords/generic (false — exclusives are non-generic, check `isMultiPlayable: false`)/exBurst (false)/hasAbilities/text from Materia Hunter (quoted in the spec research: the scratchpad `mh.json`), plus `job` (Wuk Lamat `"Princess/Warrior"`, Zack `"SOLDIER"`, Charlotte `"Knight"`, Yuna `"Gullwings"`) and `categories` (`XIV`, `VII`, `FFBE`, `X`). Then run `pnpm --filter @fftcg/cards fetch` once (it calls the SE endpoint; if the network fails, stop and report). Commit `cards.json`/`cards.meta.json` with the result.
- **B-D2 — encodings** live in `packages/cards/src/abilities-vol1.ts`, exported as `VOL1_ABILITIES`, `VOL1_CLAUSES`, `VOL1_INERT`, spread into the three maps in `abilities.ts`. One const per clause, a doc comment per card on its reading (the style of the Vol. 2 encodings). Per card (spec V1-D3 table is the source of truth):
  - A: Warrior 11-010C (two activated self-break clauses; the second costs `{ cp: { amount: 2, requiredElements: ['fire'] }, dull, selfToBreakZone }`), Ifrit 12-005C (EX Burst), Palom 13-013C (`chooseTargets` → `if controlsAtLeast {1, self, { type: 'forward', name: 'Porom' }}` then 8000 else 4000), Machinist 18-003C, Geomancer 18-094C, Zack LB 22-112R, Leo LB 22-123R.
  - B: Zack 27-123S (Haste static `self` scope when `controlsAtLeast {3, opponent, forward}`; `enterField` and `attacks` clauses sharing one effect list: `forEach` opponent Forwards → damage `{ per: { controller: 'self', filter: { type: 'backup' } }, times: 1000 }`; ONE printed clause each → `VOL1_CLAUSES` 2), Wuk Lamat 27-122S clause 2 (`enterField` + `attacks`: choose opponent Forward → `if controlsAtLeast {5, self}` → 7000), Yuna 27-129S, Fairy 1-170C, Leonora 3-143C, Porom 11-121C clause 1, Jecht 18-129C (clause 1 `activated` Fire+Water `yourTurnOnly` → grant Haste, First Strike, Brave to self until end of turn — check how "until the end of the turn" self-grants are encoded today, e.g. `onSubject`/self binding; clause 2 `special: { name: 'Jecht Beam' }`, cost `{ dull, discardSameName }`), Alphinaud 20-106R (select opponent's dull Forward → `putIntoBreakZone`; Damage 3 static `modifyPower +2000` `self` scope `when damageReceived 3`), Ward 21-001R (`onlyCp: 'fire'` static; EX Burst ETB 7000), Taivas 21-010H, Vincent LB 23-119R, Luso LB 23-130H, Ultima Weapon LB 24-126H.
  - C (V1-D4): encode every expressible clause; the replacement clauses stay unimplemented (NOT inert): Wuk Lamat clause 1, Charlotte clause 1, Porom clause 2, Yuzuki clauses 1 and 2. Charlotte clause 2 is INERT (no cost-1 Summon in either pool) with a proof test; clause 3 is the `cannotUseActionAbilities` grant to opponent's Forwards.
- **B-D3 — `pool-coverage`.** "implements every printed clause" gains an explicit expected-gap table `{ '27-122S': 1, '27-128S': 1, '11-121C': 1, '13-125R': 2 }` with a comment pointing to rung V2; any other gap still fails, and a gap SMALLER than the table also fails (so V2 must update it). The J5 UNKNOWN set is unchanged (the Vol. 1 patch carries job and categories).
- **B-D4 — clause counts** come from the printed text: the LB line, the LB reminder and keyword lines are not clauses (as `normalise` already rules); "enters the field or attacks" is ONE printed clause encoded as two abilities.

## Review Focus

1. Zack's `attacks` sweep with 0 Backups deals nothing and fires nothing; with a party of Zack and another Forward only Zack's clause triggers.
2. LB Zack 22-112R and main-deck Zack 27-123S share the name "Zack": same-name rule processes (§12.4.6) keep one, and Zack's Haste static (self scope) never reaches the other.
3. Taivas's `[0]` plays Wuk Lamat (job "Princess/Warrior", cost 3) and the Warrior Backup; not a cost-4 Warrior; only on its controller's turn; once per turn.
4. Alphinaud with no dull opponent Forward: the ETB is a no-op, no prompt, no "no legal target" noise; with two, the OPPONENT selects.
5. Ward: a payment that includes a Water Backup is refused; the AI never proposes one.

---

### Task 1: data and deck files

- [ ] Write `decks/starter-2025-vol1.txt` and `decks/starter-2025-vol1-lb.txt` (headers as in Vol. 2's files, citing the source) and the patch JSON. Run `pnpm --filter @fftcg/cards fetch`. Confirm `cards.json` gained exactly the 22 codes (and kept the 24 Vol. 2 ones).
- [ ] `pnpm test` will now fail in pool-coverage/abilities tests — expected until Task 2. Do not commit a red tree: continue to Task 2 and commit Tasks 1+2 together if needed, or commit Task 1 with pool-coverage's gap table already listing every Vol. 1 card as missing and shrink it per card as Task 2 lands (preferred: each commit green).

### Task 2: encodings, card by card

- [ ] For each card: a data test (type, cost, elements, generic, EX Burst, keywords, job) and an ability test in `packages/cards/test/abilities-vol1.test.ts` (new) that drives the clause through the engine on the real def (the Vol. 2 tests in `abilities.test.ts` are the pattern), red first, then the encoding. Group commits by card family (burn: Ifrit, Palom, Zack LB, Ward; draw/search: Machinist, Geomancer, Leo, Leonora, Luso, Yuna; field: Warrior, Fairy, Alphinaud, Ultima Weapon, Vincent, Taivas; specials/statics: Jecht, Zack, Wuk Lamat, Charlotte, Porom, Yuzuki).
- [ ] pool-coverage gap table per B-D3; Charlotte clause 2's inert proof test.

### Task 3: Layer 3 scenarios

- [ ] `packages/cards/test/scenarios/`: `zack-sweeps` (Zack attacks, the sweep, a party), `alphinaud-selects` (the opponent selects), `vincent-when-you-do-so` (decline → no damage prompt; accept → 9000), `taivas-plays` (the `[0]` from hand), `jecht-beam` (special ability, same-name discard), `ward-fire-only`, `ultima-weapon` (both conditions). The harness `trace` gains lines for any new event kinds.
- [ ] Timing matrix: cite scenarios where a row now has a real card (10.1.2.5 → zack-sweeps; §11.7 rows → jecht-beam).

### Task 4: strict self-play

- [ ] `apps/cli/test/selfplay.test.ts`: strict games Vol. 1 vs Vol. 2 with their LB decks, random/greedy and a small ISMCTS (`iterations: 4`), both seat orders — the J8 test's shape. Every game completes, no invariant violation, no thrown apply.

### Task 5: verify and ship

- [ ] Gate green; spec "As built (V1-B)"; PR; merge; fast-forward.

---

## Revisions after the plan review (2026-09-30)

Fresh Fable reviewer (Codex out of quota); adjudication in `2026-09-30-rung-v1b-vol1-cards.codex-review.md`. These
override the plan above.

- **R1 (C2, H1) — a small engine PR V1-A4 lands FIRST** (split out per the user's standing rule), with synthetic
  Layer 1 tests and the V1-D16 touchpoints: an `onSource` effect ("<this card> gains …": binds `chosen` to the
  ability's source, like `onSubject`, and may not suspend) for Jecht clause 1 and LB Luso clause 2; and
  `TargetSpec.zone: 'characters'` (Forwards and Backups — "Character you control") for LB Luso clause 1.
- **R2 (C1)** — `ABILITY_CLAUSES` counts AST UNITS where one printed clause is encoded as several abilities: Zack
  27-123S 3 (Haste static, `:etb`, `:attack`), Wuk Lamat 27-122S 3 (clause 1 unimplemented + `:etb` + `:attack`), Yuna
  2. Update the header comment of `ABILITY_CLAUSES` and spec V1-D5 (which said the count reads the printed text).
  Gap table unchanged: Wuk Lamat 1, Charlotte 1, Porom 1, Yuzuki 2.
- **R3 (C3)** — `packages/cards/test/harness.ts` pins its LB deck to the Vol. 2 LB codes (it doubled every LB card in
  `DEFS`, which would be 14 > 8) and its `DECK` to the Vol. 2 list; re-run the suite after Task 1.
- **R4 (H2)** — the FIRST commit is green and complete for the pool tests: data + patch + deck files + harness fix +
  `ABILITY_CLAUSES` for all 22 + the four EX BURST encodings + the gap table listing every not-yet-encoded card; later
  family commits shrink the table. (Or squash Tasks 1–2; every commit green is the requirement.)
- **R5 (H3)** — Taivas's play filter carries `types: ['forward', 'backup']`; the `[0]` scenario pins that it can be
  activated with nothing playable and spends its once-per-turn. The spec's "Taivas gap" is stale (A3 fixed
  `declarationNode`) — remove it from the as-built note.
- **R6 (M1)** — Luso's observer is `observesEnterField { whose: 'self', of: 'backup', filter: { job: 'Standard Unit' } }`
  with a proof test that every Standard Unit in both pools is a Backup.
- **R7 (M2, M3)** — the activated-effect `EXPECTED` table in `abilities.test.ts` gains the seven new activated clause
  ids. Task 3 adds scenarios `porom-discards` (asserting the opposing view carries no hand id while the nested hand
  select waits), `yuna-attacks` (the `attacks` look inside the `declared` window) and `luso-searches`.
- **R8 (M4)** — Review Focus 2 reframed: casting a same-name card is refused by the `sameName` cast blocker; the
  reachable §12.4.6 path is Yuna/Taivas PLAYING a second same-name card from hand — scenario around `playOntoField`.
- **R9 (M5)** — Fairy's `draw 1` sits inside the chooser's `then`: §11.11.2 cancels the whole item when its only
  target became illegal, so the draw goes with it.
- **R10 (LOW)** — self-play asserts `unimplementedAbilities > 0` for Vol. 1 games (five real gaps) and `0` for the
  Vol. 2 mirror; Zack's patch has `keywords: []`; Charlotte's `ABILITY_CLAUSES` is 3; Jecht Beam targets
  `controller: 'any'` and "cannot choose themselves" (§11.7.5) is recorded as an open reading.
