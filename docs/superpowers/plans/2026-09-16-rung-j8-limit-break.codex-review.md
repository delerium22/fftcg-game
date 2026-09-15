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
