# Rung J3 — review adjudication (2026-09-16)

Codex was out of quota; the review was run by a fresh Claude Fable 5.1 session (read-only, against the built code
at 6850058..d908269 with HEAD 3cfaebf) — `~/.claude/handoffs/fftcg-game/claude-j3-review.md`. Findings are
hypotheses; each accept and reject below is backed by the code.

**Accepted (11):**
- H1 — a mixed party's First Strike survivor dealt nothing after the window: `landSecondBatch` recomputed the set over
  the SURVIVORS (`attack.ts`). Verified by the new L1 case (red before the fix). Fix: `attack.firstStrikers` is fixed
  in `beginDamageResolution` (§15.2.3.2) and read everywhere else; `dealAfterSplit` keys on it; an invariant requires it.
- M1 — `openDamageWindow` now sets `step: 'damage'` explicitly; `applyChooseExBurst` fails loudly in the First Strike
  window rather than dropping the held batch.
- M2 — the AI priced Shiva's freeze on an active target at 0.5 after its own dull: `targetDelta` tracks the status the
  effects so far leave (test: an active 5000 outranks a dull 7000 for `[dull, freeze]`; red before).
- M3 — the §15.2.3.3 reading (only `dealtDamage` clauses held; break observers place in the window) is recorded in
  spec J3-D3 and the matrix row.
- L1 — `thawed` narration reads the card's status ("is no longer frozen" for an active card).
- L2 — greedy's `combatWindow` lists `firstStrike`.
- L5 — invariant: `heldDamage` only in the window or while the post-window split is owed.
- L6 — comment in `landFirstStrike` on why `ruled.result`/`pending` need no guard.
- L7 — `phases.ts` "five windows"; `ATTACK_STEP_LABEL: Record<AttackStep, string>` (exhaustive).
- L8 — the deck file says why Shiva is often held.
- L4 — recorded as untested in the matrix row 15.1.1.9.5 (a party shrinking to one inside the window needs a
  Forward-breaking trigger; none in the pool).

**Rejected / deferred (2):**
- L3 — J3-A6's first case is a control, not vacuous: it pins that greedy still blocks with a 7000 through the split
  step (a regression in the two-batch path would surface as a thrown apply or a declined block). Kept as is.
- L9 — the widened sweeps have explicit timeouts where they run long (offboard 60 s) and each asserts a hit with a
  message; pinning seeds trades a timeout for a re-pin on every deck change. Deferred to the next deck edit.

**Disagreed with the reviewer on (0).**
