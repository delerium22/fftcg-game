# Rung J8 — Limit Break: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the LB deck exists as a zone; LB cards are cast from it for base CP plus X flips; LB cards that leave the field or resolve return to it face up; two real LB cards play in both seats' LB decks in the browser and the CLI.

**Architecture:** one new zone on `PlayerState`, one optional field on `Payment`, one blocker code, one sweep at the end of `runRuleProcesses`, one view field exposed to both seats (open lists), one board row, one tray part. Cards are data plus two small ASTs.

**Spec:** `docs/superpowers/specs/2026-09-16-rung-j8-limit-break.md`

## Global Constraints
- TDD per task; real-card goldens from a throwaway probe. Every `createGame` caller keeps working with no LB deck (the option defaults to none).
- The main deck file does not change, so no seed re-pins this rung (the LB deck is never shuffled and is a separate zone).
- Commit each task green with the repo's message style and the `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` trailer.

## Tasks

### Task 1: data — `limitBreak` on `CardDef`, the LB deck file, the two ASTs (J8-A2)
- `packages/engine/src/types.ts`: `limitBreak?: number` on `CardDef`, doc "§15.2.8.2, the LB cost; present only on LB cards".
- `packages/cards/src/normalise.ts`: `LB_LINE = /^Limit Break -- (\d+)$/` and `LB_REMINDER = /^\(Cards with \[LB\] cannot be included in your main deck\.\)$/`; `parseLimitBreak(textEn): number | undefined`; both lines excluded from `nonKeywordLines`; `limitBreak` set when present. Tests in `normalise.test.ts` for both lines (a synthetic `SeCard`).
- `packages/cards/scripts/fetch-cards.ts` `assertCardDef`: `limitBreak` absent or a positive integer.
- `decks/starter-2025-vol2-lb.txt`: `2 23-125R`, `2 22-119R`, with a header; `pnpm --filter @fftcg/cards run fetch` → 24 cards. `packages/cards/src/deck.ts`: nothing (the parser is shared); `apps/web/src/deck.ts`: `LB_DECK`/`LB_DECKS` from the new file; `apps/cli/src/main.ts`: `--lb-deck` defaulting to the file.
- `packages/cards/src/abilities.ts`: `MAAT_ETB` (forEach self forwards: addPower 1000, grantKeyword brave), `NOCTIS_ETB` (chooseTargets breakZone self filter types forward → moveToHand); `ABILITIES`/`ABILITY_CLAUSES` entries (1 each). Tests in `abilities.test.ts` on the real defs; `art.test.ts` EXPECTED and count (24 codes across both files — check `planFetches` reads both deck files; if it reads only the main list, keep 22 and say so).
- Commit `feat(cards): Noctis and Maat, the LB deck file, and Limit Break parsed (J8)`.

### Task 2: the zone and casting (J8-A1 first half)
- `state.ts`: `LbCard`, `PlayerState.lbDeck`; `emptyPlayer` sets `[]`; `Payment.lbFlip?: CardId[]` (`commands.ts`).
- `setup.ts`: `CreateGameOptions.lbDecks?`, `validateLbDeck`, main-deck refusal of LB cards, minting into `lbDeck` face down in list order.
- `cast.ts`: `castBlocker` — the card may be in hand or face-down in the LB deck; new code `lbCost`; `CAST_BLOCKER_TEXT`; `checkedPay` validates and applies `lbFlip`; `applyCastCharacter`/`applyCastSummon` remove from whichever zone held it; `cast` event `from`.
- `cp.ts`: `enumeratePayments` crosses with flip subsets for LB cards (`lbFlipSubsets(state, player, card)`); `packages/ai/src/payment.ts` `preferredPayment` adds the least-valued flips.
- `legal.ts` `actionMenu`: castable includes face-down LB cards; `isLegal`'s cast branch unchanged (it calls `castCheck` + `paymentCheck`; `paymentCheck` must also verify `lbFlip` — put the LB validation in one function `lbFlipCheck(state, player, card, payment)` used by both).
- Tests `packages/engine/test/limit-break.test.ts` (the first block of J8-A1). Commit `feat(engine): the LB deck, and casting from it for base CP plus flips (§15.2.8.3, J8)`.

### Task 3: the return sweep, the view, determinise, invariants (J8-A1 second half)
- `rules.ts` `runRuleProcesses`: after the field-limit pending block, `sweepLimitBreak(s)` → `[state, events]`; `events.ts`: `lbFlipped`, `lbReturned`.
- `view.ts`: `FieldView.lbDeck` (both seats, D5 comment with the §7.14.2 deviation); `visibleIds` include LB ids. `determinise.ts`: keep `lbDeck` from the view; exclude LB codes from `removeVisible`.
- `invariants.ts`: LB deck as a zone (`note`), `faceUp` boolean, no LB card in hand/Break Zone/deck/removed when nothing is pending or mid-resolution.
- Tests: the rest of J8-A1, including `legal-apply`-style random walks with an LB deck (`makeGame({ lbDecks })` needs a helper option in `packages/engine/test/helpers.ts`). Commit `feat(engine): LB cards return to the LB deck face up; both LB decks in the view (§15.2.8.4, J8)`.

### Task 4: the browser and the CLI (J8-A5, J8-A6)
- `Board.tsx`: an LB row per seat (`Zone` with `GridItem`s; `fieldCardProps`-like props for LB cards: `lb: 'down' | 'up'`), `Card.tsx` badges `LB` / `Spent`; selection: a face-down own LB card is actionable when castable (`choices.byCard` already keys by card id, so the sheet path works once `subjectsIn` recognises the cast).
- `PaymentTray.tsx` + `apps/web/src/game/payment.ts`: the LB part (need X, chosen ids), Auto, Confirm gating; `useGame.ts`/`selection.ts`: pressing an own LB-deck card while the tray is open toggles a flip.
- `commands.ts`: `describeChoice` for casts with `lbFlip`; `useGame.ts` `eventLine` for `lbFlipped`/`lbReturned`; `CAST_BLOCKER_TEXT.lbCost`.
- `apps/cli/src/render.ts`: the LB line. Tests as J8-A5/A6. Commit.

### Task 5: scenario, AI test, matrix, gates, play (J8-A3, J8-A4)
- Probe → `packages/cards/test/scenarios/maat-limit-break.test.ts`; `packages/ai/test/limit-break.test.ts`.
- `docs/rules/timing-matrix.md`: scope gains `15.2.8`; rows 15.2.8, .1–.4.5 with refs; audit rows 7.14 and 8.1 → ok; ladder J8 struck through. `pnpm typecheck && pnpm lint && pnpm test && pnpm test:browser`; a browser play. Spec BUILT; handoff; memory.
