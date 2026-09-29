# Rung V1-A4 — `onSource` and the `characters` zone — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** two engine gaps the V1-B plan review found (its R1), closed before the Vol. 1 cards land: "<this card> gains …" (Jecht 18-129C clause 1, LB Luso 23-130H clause 2) and "choose 1 Character you control" (LB Luso clause 1).

**Architecture:** `onSource` is `onSubject`'s sibling: it binds `chosen` to the ability's SOURCE and runs `do`, which may not suspend. `TargetZone` gains `'characters'`: a player's Forwards then Backups, in that order.

**Spec:** `docs/superpowers/specs/2026-09-29-rung-v1-vol1-pool.md` (V1-D16 touchpoints); `docs/superpowers/plans/2026-09-30-rung-v1b-vol1-cards.md` R1.

## Global Constraints

- Plain-data AST; `git add` named paths; never `vitest.config.ts`; no `packages/cards` src or `decks/` change.
- Verify: `pnpm typecheck`, `pnpm lint`, `pnpm test` (5 "Timeout calling onTaskUpdate" errors are known noise — grep), `pnpm test:browser`.

## Review Focus

1. `onSource` after the source has LEFT the field (a Jecht-shaped activation whose source is broken in response): `addPower`/`grantKeyword` on a card not on the field are no-ops, no throw.
2. A `characters` chooser whose pick is a Backup, then a filter with `sameElementAsChosen`: the Backup's elements are used.
3. The AI prices `onSource` (a self-grant is worth what the same grant on a chosen own Forward is), never 0 by default.

---

### Task 1: `onSource`

**Files:** `packages/engine/src/abilities.ts` (the `Effect` union, next to `onSubject`; `effectAtPath` untouched — it does not suspend), `packages/engine/src/resolve.ts` (case beside `onSubject`: save `ctx.chosen`, set `[ctx.source]`, run `do`, throw if it suspended, restore), `packages/engine/src/setup.ts` (`validateEffects`: walk `do`, and refuse a suspending node inside, like `onSubject`), `packages/engine/src/activate.ts` (`needsChoice`: recurse), `packages/ai/src/candidates.ts` (`effectsValue`: price `do` against the source with `targetScore`), `apps/web/src/game/commands.ts` (walkers recurse into `do`), Tests: `packages/engine/test/selects.test.ts` or a new `source-binding.test.ts`, `packages/ai/test/candidates.test.ts`.

- [ ] Failing tests: an activated `[0]: <this> gains +2000 power and Brave until the end of the turn` (`[{ kind: 'onSource', do: [{ kind: 'addPower', amount: 2000 }, { kind: 'grantKeyword', keyword: 'brave' }] }]`) raises the source's power and grants Brave, and nothing else changes; an `observesEnterField` clause with `onSource` pumps the WATCHER, not the arriving card; Review Focus 1; the AI values activating the pump above passing when the source can attack.
- [ ] Red → implement → green → typecheck → commit `feat(engine,ai,web): onSource — "<this card> gains" (V1-A4)`.

### Task 2: the `characters` zone

**Files:** `abilities.ts` (`TargetZone`), `resolve.ts` (`targetCandidates`: forwards then backups), any exhaustive switch on `TargetZone` (grep `zone ===` / `TargetZone` across packages/ai and apps/web: web target nouns — "Character"), `setup.ts` if zones are validated, Tests: `packages/engine/test/target-filters.test.ts` or `selects.test.ts`, `apps/web/test/commands.test.ts` (the prompt reads "Choose 1 Character").

- [ ] Failing tests: `chooseTargets { from: { zone: 'characters', controller: 'self' } }` offers own Forwards and Backups, not the opponent's; picking a Backup then a `lookAtDeck` search with `sameElementAsChosen` uses the Backup's element; the web prompt noun is "Character".
- [ ] Red → implement → green → typecheck → commit `feat(engine,web): the characters target zone (V1-A4)`.

### Task 3: ship

- [ ] Gate green; add "As built (V1-A4)" to the spec; PR; merge; fast-forward.
