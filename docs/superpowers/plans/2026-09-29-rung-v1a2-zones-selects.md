# Rung V1-A2 — selects, `putIntoBreakZone`, hand targets, `discard`, play from hand, `activate` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the zone-moving and selecting vocabulary the Vol. 1 pool needs (Alphinaud, Ultima Weapon, Vincent, Yuna, Taivas, Porom, Fairy), proven by synthetic Layer 1 tests, with no card-pool change.

**Architecture:** one new flag on `chooseTargets` makes it a SELECT (made at resolution, by its controller or the opponent, never a "choose"); `TargetSpec.zone` gains `hand`; three new effects (`putIntoBreakZone`, `discard`, `activate`); `putOntoField` gains a hand source. Hidden hand candidates are redacted from the other seat's view and recomputed in determinisation.

**Tech Stack:** TypeScript, pnpm workspaces, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-29-rung-v1-vol1-pool.md` (V1-D8, V1-D9, V1-D10, V1-D11, V1-D16). V1-A1 (merged before this) supplies `if`, `conditionHolds`, the frame controller in AI pricing, and web `verbOf(frame)`.

## Global Constraints

- CR 3.3 pin. Rules read for this rung: §11.3.3 ("To select something is not equivalent to to choose"), §15.1.1.1 (activate: dull → active; activating an active card is legal), §15.1.1.3.2 (put into the Break Zone is not a break), §15.1.1.4 (discard: hand → Break Zone), §15.1.1.7 (cast = play by paying a cost; "play onto the field" is not a cast), §7.7 (field limits and same-name apply to anything entering the field).
- Plain-data AST; `git add` named paths; never `vitest.config.ts`; no `packages/cards`/`decks/` change.
- Verify: `pnpm typecheck && pnpm lint && pnpm test && pnpm test:browser`.

## Decisions

- **A2-D1 — the select flag.** `chooseTargets.select?: 'self' | 'opponent'`. A select node is NOT declared at placement: the declare stage ends at it (like any non-choice effect), and it prompts at resolution. It raises `chooseTargets` on `select === 'opponent' ? opponentOf(controller) : controller`. It does not call `dispatchChosenTriggers`, ignores `cannotBeChosen`-style protections (none exist yet beyond Prishe's observer — assert Prishe does not fire), and is never a castability gate (`canDeclare` skips it). An empty candidate set is a no-op without `abilityNoLegalTarget`. Every "you may put/play/discard", "your opponent selects" in the pool is a select; only printed "choose" is a choice.
- **A2-D2 — `onlyIfChosen`.** `chooseTargets.onlyIfChosen?: true`: `then` is skipped when the answer is empty. Everything nested under it runs at resolution (Vincent's "When you do so, choose 1 Forward opponent controls" is a choice made at resolution — MVP0-SIMPLIFICATION: the reflexive trigger is not stacked separately; mark it in `abilities.ts`).
- **A2-D3 — hand targets.** `TargetZone` gains `'hand'` (only with `controller: 'self'` — validated in `setup.ts`). `targetCandidates` reads `ps.hand`. `matchesFilter` already works off the definition for non-field cards. A hand zone node must be a select (validated): hand cards cannot be "chosen" targets in this pool.
- **A2-D4 — hidden candidates.** `viewFor(state, me)`: a `chooseTargets` pending owned by the other player whose candidates include a card `me` cannot see is shown with `candidates: []` and a `hidden: true` marker (add `hidden?: true` to that `Pending` member). `determinise`: a pending chooseTargets with `hidden` is rebuilt from the suspended node (`effectAtPath` of the active frame) against the sampled state via `targetCandidates`, clamped `max` as the engine does when raising. Keys: `pendingDigest` digests a hidden pending by `min/max/hidden` only.
- **A2-D5 — new effects.** `putIntoBreakZone`: each chosen card on a field goes to its OWNER's Break Zone as a zone movement with reason `ability` (reuse the transition path `breakCard` uses, so field→Break Zone watchers fire and the LB sweep applies), but no `broken` event and `cannotBeBroken` does not stop it. `discard`: each chosen card in its owner's hand → Break Zone, event `discarded` (reuse the existing discard event if one exists for `discardToHandSize`; grep `discard` in `events.ts`). `activate`: each chosen field Character becomes `active` (a no-op on an active one, no event); event `activated`.
- **A2-D6 — play from hand.** An effect `putOntoField` (the existing primitive `putOntoField(state, id, controller, events)` in `resolve.ts`) as an Effect: `{ kind: 'playOntoField' }` — each chosen card in its owner's hand leaves the hand and enters via `putOntoField` (ETB and watchers fire; no CP, no `cast` event). Field limits: refuse (skip, with `abilityNoLegalTarget`) a Backup when five are on the field; same-name/Light-Dark are settled by the existing rule processes after entry (as Hugh Yurg's search already does — see its MVP0-SIMPLIFICATION).

## Review Focus

1. An opponent's select raised during MY resolution: the pending belongs to the opponent, the AI (either seat) can answer it, and after the answer priority/turn state is as before.
2. The other seat's view of a hand select shows no hand ids; ISMCTS search from that seat does not throw (determinise rebuilds candidates) and keys stay stable across determinisations.
3. `putIntoBreakZone` on an LB Forward: it lands in the LB deck face up (sweep), and a Lightning-style field→Break Zone watcher fires.
4. Play from hand with five Backups on the field and a Backup selected: skipped, no crash, invariants clean.
5. `onlyIfChosen` with an empty answer: nothing nested runs, no prompt raised.

---

### Task 1: `select` and `onlyIfChosen` on `chooseTargets`

**Files:** `packages/engine/src/abilities.ts` (flags + doc comments), `packages/engine/src/resolve.ts` (`runEffect` chooseTargets case: declare-stage end, chooser, no chosen dispatch, `onlyIfChosen`), `packages/engine/src/cast.ts` (`canDeclare` skips selects), `packages/engine/src/setup.ts` (validation), `packages/ai/src/candidates.ts` (a select owned by the other seat is priced from THAT seat's point of view: `targetScore` with `me` = the selector), `apps/web/src/game/commands.ts` (prompt says "select"; an opponent's select shows "The AI selects …" while waiting), Test: `packages/engine/test/selects.test.ts` (new), `packages/ai/test/candidates.test.ts`, `apps/web/test/commands.test.ts`.

- [ ] Failing tests: (a) an ETB `chooseTargets { select: 'opponent', from: { zone: 'forwards', controller: 'opponent', filter: { status: 'dull' } }, then: [{ kind: 'dull' }] }` raises the pending on player 1 at resolution (not at placement: the item is already on the stack or resolved when the prompt appears); (b) a Prishe-style `observesChosen` watcher does not fire for a select; (c) a Summon whose only node is a select with no candidates is castable and resolves as a no-op; (d) `onlyIfChosen` with `[]` skips a nested `chooseTargets` (no second prompt); with a pick, the nested choice prompts; (e) greedy answering an opponent's select picks the card worst for the SELECTOR's opponent — i.e. its own least valuable (check the sign with a 2-Forward case).
- [ ] Run red, implement, run green, `pnpm typecheck`.
- [ ] Commit `feat(engine,ai,web): select nodes and onlyIfChosen (V1-A2)`.

### Task 2: `putIntoBreakZone`, `activate`

**Files:** `abilities.ts`, `resolve.ts` (new cases, reusing the `breakCard` transition machinery with reason `ability` and no `broken` event), `events.ts` (`activated`; reuse or add `putIntoBreakZone`-visible event — the zone transition event already emitted by the transition path is enough if it exists; check), AI `targetDelta` (`putIntoBreakZone` priced like `breakCard` minus the `cannotBeBroken` exemption; `activate` priced as the inverse of `dull`), web `verbOf` ("Put into the Break Zone", "Activate"), Test: `selects.test.ts`, `candidates.test.ts`, `commands.test.ts`.

- [ ] Failing tests: (a) `putIntoBreakZone` on a `cannotBeBroken` Forward moves it; no `broken` event; an `observesZoneChange field→breakZone` watcher fires; (b) on an LB Forward (use the LB fixtures from `packages/engine/test/limit-break.test.ts`) it ends in the LB deck face up; (c) `activate` on a dull Forward makes it active, on an active one is silent.
- [ ] Red → implement → green → typecheck → commit `feat(engine,ai,web): putIntoBreakZone and activate (V1-A2)`.

### Task 3: hand targets, `discard`, `playOntoField`, hidden candidates

**Files:** `abilities.ts` (`TargetZone` `'hand'`, effects `discard`, `playOntoField`), `resolve.ts` (`targetCandidates` hand; cases), `setup.ts` (hand only with `controller: 'self'` and `select`), `state.ts` (`hidden?: true` on the chooseTargets pending), `view.ts` (redaction), `determinise.ts` (rebuild), `packages/ai/src/ismcts/keys.ts` (`pendingDigest` for hidden), AI pricing for `discard` (cost of the card) and `playOntoField` (value of the card entering), web `verbOf` ("Discard", "Play onto the field"), Tests: `selects.test.ts`, `packages/engine/test/determinise.test.ts`, `packages/ai/test/ismcts-keys.test.ts`, `commands.test.ts`.

- [ ] Failing tests: (a) Yuna-shaped ETB `chooseTargets { select: 'self', min: 0, max: 1, from: { zone: 'hand', controller: 'self', filter: { type: 'forward', cost: 3 } }, then: [{ kind: 'playOntoField' }] }` puts the picked Forward on the field; its own ETB fires; no `cast` event; hand shrinks; (b) with five Backups and a Backup picked by a play effect: skipped, invariants clean; (c) Porom-shaped `discard` then V1-A1's `if subjectMatches { category: 'IV' }` reads the discarded card in the Break Zone; (d) `viewFor(state, 1)` of player 0's hand select has `candidates: []` and `hidden: true`, and no id of player 0's hand appears anywhere in the pending; (e) `determinise` from player 1's view rebuilds a legal pending — `legalCommands(det, 0)` is non-empty and every candidate is in the sampled hand; (f) ISMCTS `observationKey` from player 1's view is equal across two determinisations; (g) an ISMCTS agent for player 0 answers its own hand select with a legal command.
- [ ] Red → implement → green → typecheck → commit `feat(engine,ai,web): hand selects, discard and playing onto the field; hidden candidates (V1-A2)`.

### Task 4: verify and ship

- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm test:browser` green.
- [ ] Spec: "As built (V1-A2)" note. Timing matrix: any rows these touch (grep §15.1.1.1, §15.1.1.3, §15.1.1.4 in `docs/rules/timing-matrix.md`; add no new rows — the matrix covers chapters 9–12 and 15.1.1.9).
- [ ] PR, merge on green, fast-forward.

---

## Revisions after the plan review (2026-09-29)

Review by a fresh Fable reviewer (Codex out of quota); adjudication in `2026-09-29-rung-v1a2-zones-selects.codex-review.md`.
These override the tasks above where they differ.

- **R1 (C1)** — `invariants.ts:125` requires `pending.player === active.controller`. Accept the opponent when the
  suspended node (`effectAtPath` of `resolution.active`) has `select: 'opponent'`. Task 1 file list gains `invariants.ts`.
- **R2 (H1)** — A2-D6's Backup refusal is dropped. §7.7.4: a sixth Backup is put into the Break Zone by rule
  process, and `putOntoField` already enters without limit checks on purpose; `runRuleProcesses` raises
  `breakExcessBackups`. Test 3(b) becomes: playing a Backup from hand with five on the field raises
  `breakExcessBackups` for its controller. Guard: a non-Character def is skipped by the executor, and setup
  validation rejects a `playOntoField` whose filter admits a Summon.
- **R3 (H2)** — `pendingDigest` (`keys.ts`): a `chooseTargets` pending that is `hidden`, or whose candidate refs are
  opaque, digests as `${head}/${min}-${max}/hidden`. Test 3(f) keys from `searchView` (the path the search uses),
  not only `viewFor`.
- **R4 (H3)** — the determinised pending keeps `hidden: true` and carries the SAMPLED candidates (so
  `legalCommands` and `chooseTargetsCandidates` read them); `max` clamps to the sampled count; `min` clamps to it
  too (a rebuilt min 1 over an empty sample is `min 0` — latent in the pool, recorded as a determinisation
  simplification). `checkInvariants` passes on it.
- **R5 (M1)** — `effectsValue` prices a nested `select: 'opponent'` as the selector's best answer, i.e. the WORST
  for the caster (a min, not a max). The "targetScore with me = the selector" item for answering is already true
  (`chooseTargetsCandidates` passes `player`); no change there.
- **R6 (M2, M3, LOW)** — events: `putIntoBreakZone` reason gains `'ability'` (`events.ts:82`) and
  `apps/web/src/game/useGame.ts` `BREAK_ZONE_WHY` narrates it; `discarded` reason gains `'ability'` and
  `useGame.ts:103` narrates it; `activate` reuses no Active-Phase event — add `activatedByAbility { card }` and
  narrate it. `useGame.ts` joins the file lists.
- **R7 (M4)** — the Prishe skip is in `applyChooseTargets` (`resolve.ts` ~926): read the suspended node's `select`.
- **R8 (M5)** — redaction discriminator: any candidate the viewer cannot see (not in the view's visible ids),
  whoever owns the pending.
- **R9 (LOW)** — spec V1-D9 names the flag `select` (was `chooser`); note in the as-built. `resolution.active.chosen`
  carrying a hand id is recorded as a known gap (no pool card suspends with a hand pick in `chosen`). Hand-zone
  validation walks effects recursively (`then`, `do`, modes, `if` branches).
