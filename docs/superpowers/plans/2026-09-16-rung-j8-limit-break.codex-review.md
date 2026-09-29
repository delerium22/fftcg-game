# Rung J8 — review adjudication (2026-09-16)

Codex was out of quota; the review was run by a fresh Claude Fable 5.1 session (read-only, against the built code at
a1143e5..3cfaebf) — `~/.claude/handoffs/fftcg-game/claude-j8-review.md`. Each accept and reject is backed by the code
or a reproduction.

**Accepted (11):**
- C1 — the ISMCTS index never named LB-deck cards, so every LB cast keyed opaque and `searchIsmcts` threw at the root;
  in the browser the coordinator then dropped the worker and played greedy for the rest of the game. Reproduced with
  strict self-play (`ismcts:4`, the shipped LB decks, seed 1: 0 completed, 2 failures). Fix: `buildIndex` indexes both
  LB decks by code with the face state in the ref; the cast key carries the flips and `decodeCast` reads them back;
  `searchView` sees LB ids; `observationKey` digests both decks. Tests: the decoder round-trip with LB decks (every LB
  cast key names its cards and decodes to a legal command) and strict self-play with LB decks for random, greedy and
  ISMCTS — the repro, now green. Spec J8-D8 and the audit row corrected.
- H1 — no play-level coverage with an LB deck: the self-play and decoder tests above; `--lb-deck` now reaches `mirror`
  and `profile`.
- M1 — an LB Summon on the stack at game over stayed in the Break Zone (rule processes stop at a result): the sweep
  runs at every game-over exit in `apply` (test: a concede with the Summon waiting; red before).
- M2 — every X-subset listed per CP payment (240 casts on turn 1): one canonical subset is listed and any is accepted
  through `lbFlipCheck`; the browser's picker offers every face-down other and completes with the player's own X,
  validated by `isLegal` in `useGame.choose` (the reviewer's "keeps working" needed this change — `extendable` and
  `completedChoice` compared flips against the listed set).
- L1 — sweep granularity (between frames) recorded on `sweepLimitBreak`.
- L2 — `applyCosts` refuses an activation payment carrying `lbFlip`, as `paymentCheck` already did.
- L3 — the invariant's LB-zone check is skipped only while a frame is active, not under every pending.
- L4 — a face-up LB card is refused as `lbSpent` ("Spent — a face-up LB card is not cast again"), not `notInHand`.
- L5 — the AI's cast reads "from the AI's LB deck" (the move line is described from the human's view).
- L7 — flips join with commas; the misplaced `paymentCheck` docstring moved back.
- L8 — "not shuffled (§8.2.1.1 does not require it)".

**Deferred (1):**
- L6 — `cast.from` is unread by renderers. The move line already says "from the LB deck", so the log is not missing
  it; the field stays as data for a future reader rather than being dropped from the event and its test.

**Rejected (0). Disagreed with the reviewer on (0).**

## Second pass — Codex (adjudicated 2026-09-29)

Codex (gpt-5.6-sol, xhigh, read-only) reviewed main at 8a4e874 on 2026-09-29, told of the first pass. Each accept
and reject is backed by the code, a red-before test, or the CR 3.3 text. Fixes are on branch `fix/j8-codex-second-pass`.

**Accepted (7):**
- H1 — an LB Summon skipped the `lbCost` refusal (the Summon branch of `castBlocker` returns before it), so a
  zero-flip cast was listed that `isLegal` refused. `lbShort` is computed once and asked in both branches. Test with
  a one-card LB deck (red before).
- H2 — a Summon still declaring its targets lives only in `resolution.placing`; a concede cleared it and the card
  was in no zone. Wider than reported: any Summon, not only an LB one. `clearStackAtGameOver` now moves a placing
  Summon to the Break Zone (the LB sweep then returns an LB one). Test for both (red before).
- M2 — `overAndSwept` dropped the sweep's `lbReturned` events. They are kept, placed before `gameOver` so it stays
  the last event (asserted in the H2 test).
- M1 — the browser's Auto payment matched `preferredPayment` against the ONE canonical flip subset, so a Maat cast
  flipped Noctis instead of a twin Maat. `preferredChoices` matches on CP sources and keeps the preferred flips;
  `useGame.choose` still runs `isLegal` on the result. Test (red before).
- L2 — the card sheet now explains the viewer's own LB cards (`lbCost`, `lbSpent`); the opponent's row stays silent.
- L3 — `validateLbDeck` refuses an LB cost that is not a whole number above 0 (§15.2.8.2). The parser is left as is:
  `fetch-cards.ts` already rejects such a value before it reaches the card data.
- L4 — matrix rows 15.2.8.4.3 and 15.2.8.4.5 now say their replacement-effect sentences are untested/vacuous (the
  engine has no replacement effects).

**Rejected (1):**
- L1 — "the sweep omits the Damage Zone". CR 3.3 §15.2.8.4.1 lists exactly four zones: hand, Break Zone, main deck,
  removed from play. The sweep matches the letter; the Damage Zone is not one of them.
