# Rung V1-C — a deck per seat (web picker, URL, CLI, AI) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the player picks their deck and the AI's (Starter 2025 Vol. 1 or Vol. 2) before a game; default **you Vol. 2 vs AI Vol. 1**; the CLI takes a deck per seat; every AI agent gets the per-seat lists.

**Architecture:** a small deck registry (`apps/web/src/deck.ts`: `DECK_CHOICES = { vol1: { main, lb, label }, vol2: {…} }`) feeds `newGame` and `createAiSearch`; the choice lives in React state set by two `<select>`s next to the New game button, and in a `?decks=<you>,<ai>` URL parameter parsed like `?seed=`. The worker/coordinator already take `decks` per seat; they are passed the chosen pair instead of the `DECKS` constant.

**Spec:** `docs/superpowers/specs/2026-09-29-rung-v1-vol1-pool.md` V1-D17. Depends on V1-B (the Vol. 1 deck files and cards).

## Global Constraints

- `DECKS`/`LB_DECKS` stay exported as the Vol. 2 MIRROR for test fixtures, so seed-pinned unit tests do not move.
- E2E routes that pin a seed append `&decks=vol2,vol2` (their pinned game stays the mirror they were written for) — NO seed re-pin. One new e2e covers the default pairing.
- Plain CSS, React 19, no new dependency. `git add` named paths; never `vitest.config.ts`.
- Verify: `pnpm typecheck`, `pnpm lint`, `pnpm test` (5 known onTaskUpdate errors — grep), `pnpm test:browser`.

## Decisions

- **C-D1 — when a choice applies.** Changing a `<select>` does not end the game in progress; it applies at the next New game (the button's label says "New game (Vol. 2 vs Vol. 1)"). The URL parameter applies at load. A malformed `?decks=` is ignored with a console warning, like `?seed=`.
- **C-D2 — the pair is part of a game's identity.** `useGame(seed, decks)`; the restart path takes the pair; `createAiSearch` rebuilds its coordinator with the pair (a coordinator is per game already). The opening log line names the decks ("New game — you play Starter Vol. 2, the AI plays Starter Vol. 1").
- **C-D3 — CLI.** `--deck0 <path>` / `--deck1 <path>` and `--lb-deck0` / `--lb-deck1` for hotseat and selfplay (and mirror/profile if they already take `--deck`); `--deck` stays and sets both seats; default both seats Vol. 2 in the CLI (unchanged behaviour for scripts and measured win rates), documented in the help text.

## Review Focus

1. The AI's determinisation uses the AI's OWN list for its hand/deck and the HUMAN's list for the human's hidden cards — a swapped pair would sample impossible cards (ISMCTS decoder returns null / throws). Test with the asymmetric default.
2. Restarting with a different pair mid-session: the old coordinator/worker is dropped; the new one gets the new lists; no search result from the old game is committed.
3. `?decks=vol1,vol1&seed=5` reproduces the same game on reload.
4. The picker is keyboard-operable and labelled (the app has accessibility tests — follow `focus.test.tsx`/`how-to-play.test.tsx` patterns).
5. A deck file edit changes nothing for the Vol. 2 mirror tests.

---

### Task 1: the registry, `useGame(seed, decks)`, and the AI plumbing

**Files:** `apps/web/src/deck.ts`, `apps/web/src/game/useGame.ts` (`newGame`, `createAiSearch`, restart), `apps/web/src/App.tsx` (`decksFromLocation`), Tests: `apps/web/test/useGame.test.ts`, `apps/web/test/search-coordinator.test.ts`, a new `apps/web/test/deck-choice.test.ts`.

- [ ] Failing tests: `decksFromLocation('?decks=vol1,vol2')` → `['vol1','vol2']`; malformed → default with a warning; `newGame(seed, ['vol2','vol1'])` deals the Vol. 1 list and LB deck to seat 1; the coordinator built for that game receives `decks = [vol2 main, vol1 main]`; an ISMCTS decision from that position returns a legal command (Review Focus 1).
- [ ] Red → implement → green → commit.

### Task 2: the picker UI

**Files:** the board header component that holds the New game button (grep `New game` in `apps/web/src/ui`), `styles.css`, Tests: a component test (render + change + press New game → the new game uses the pair), accessibility (labels, focus order).

- [ ] Red → implement → green → commit.

### Task 3: e2e

- [ ] Every `goto('/?seed=N')` in `apps/web/e2e` becomes `goto('/?seed=N&decks=vol2,vol2')`; the seven `goto('/')` routes: check each — those that assert only seed-independent UI keep `/`; any that depends on the mirror gets `?decks=vol2,vol2`. One new spec: load `/`, the header shows "Vol. 2 vs Vol. 1", the AI makes its first move without an error.
- [ ] `pnpm test:browser` green → commit.

### Task 4: CLI

**Files:** `apps/cli/src/flags.ts`, `main.ts`, `hotseat.ts`, `selfplay.ts` wiring, `apps/cli/test/*` (flag parsing, a Vol. 1 vs Vol. 2 selfplay run via the flags).

- [ ] Red → implement → green → commit.

### Task 5: ship

- [ ] Gate green; spec "As built (V1-C)"; README or How to play mentions the picker if either documents deck choice; PR; merge; fast-forward.

---

## Revisions after the Codex plan review (2026-09-30)

Adjudication: `2026-09-30-rung-v1c-deck-picker.codex-review.md`. These override the plan above.

- **R1 (C2)** — there is no header or persistent New game control today (the only restart is the game-over dialog's
  "Play again"). Add a `DeckPicker` toolbar component above the board: two labelled `<select>`s ("Your deck", "AI
  deck") and a "New game" button. The first game still starts at load with the URL/default pair; the toolbar's
  button starts a new game with the SELECTED pair; the dialog's "Play again" is kept and also uses the selected pair.
- **R2 (H1)** — the picker's selection is separate state from the ACTIVE game's pair. The active pair (keys and
  lists) lives in refs owned by `useGame`, changed only inside `restart(nextDecks)`. Test: changing a select alone
  neither replaces the worker nor changes the current game.
- **R3 (H2, LOW)** — no positional collision with the seams: `useGame(seed, { decks?: DeckPair; seams?: SearchSeams })`
  and `createAiSearch(readState, seed, { decks: DeckLists; seams? })`; a deliberate exported
  `createWebGame(seed, deckKeys)` replaces the private `newGame` for tests. Enumerate and migrate every call site
  (`budget-wire.test.ts`, `useGame.test.ts`, others found by the compiler).
- **R4 (H3)** — required test: start a search, restart with another pair, the old worker terminates, a stale reply is
  rejected, the new worker's `init.decks`, the LB decks, the Greedy fallback's decks and the opening log all name the
  new pair.
- **R5 (H4)** — `game/types.ts` (`GameApi.restart(decks?)`) and `GameOverDialog` (`onRestart`) join Task 1/2; the
  restart owner is `Board` (it renders both the toolbar and the dialog).
- **R6 (H5)** — CLI: `--deck` and `--lb-deck` keep meaning "both seats" (`--lb-deck` joins `KNOWN_FLAGS`, it is read
  but missing today); `--deck0/--deck1/--lb-deck0/--lb-deck1` override per seat; a seat flag wins over the shared one;
  flags accepted per command are listed; real CLI invocations tested.
- **R7 (H6)** — `mirror` refuses asymmetric lists (its seat-bias metric assumes one list); a seat×deck crossover is a
  later rung if wanted.
- **R8 (H7)** — the default-pair e2e uses a finder-selected fixed `?seed=N` (no `decks`) where the AI acts first, and
  asserts an AI move and no worker/fallback warning.
- **R9 (H8)** — the ISMCTS test runs after hands are dealt, from the AI seat, with composition-distinct decks, checks
  per-seat conservation, and goes through the worker protocol (`search-protocol.test.ts`), not only the coordinator.
- **R10 (M1–M6)** — all four pairings start legally with the right main/LB ownership and clean invariants; the
  production-hook tests that shadow with `DECKS` pass `vol2,vol2` explicitly; an App-level reload test for
  `?seed=5&decks=vol1,vol1` (location parsed once, lazily); the three full-game e2es (`announcements`, both
  `game-over`) pin `?decks=vol2,vol2`; accessibility: visible labels, a real-browser tab-order test, the modality
  selectors in How-to-play/game-over include the toolbar; the opening-log fixtures and "Play again" expectations are
  updated deliberately; README and CLI usage updates are REQUIRED.
- **R11 (LOW)** — comments claiming both seats play one list are reworded; `VOL2_DECKS` aliases are added beside the
  retained `DECKS`/`LB_DECKS` fixtures.
- **Kept against the review (C1)** — the CLI default stays the Vol. 2 mirror. The CLI is the measuring tool: every
  recorded win rate, gate and weights A/B assumes the mirror, and a silent default change would move them all. Spec
  V1-D17 is amended to say so.
