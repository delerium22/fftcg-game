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

## Second pass — Codex (adjudicated 2026-09-29)

Codex (gpt-5.6-sol, xhigh, read-only) reviewed the tree at 07:54 on 2026-09-16, BEFORE the fix commit 963eed6
(08:31), so some findings are already fixed. Each accept and reject below is backed by the code or by the CR 3.3
text (`fftcg-comprules-v3.3.pdf`). Fixes are on branch `fix/j3-codex-second-pass`.

**Already fixed by 963eed6 (3):** H1 (the First Strike set recomputed over survivors — `attack.firstStrikers`);
M2's first half (Shiva's freeze priced on the status the dull leaves); L3 (thaw narration for an active card).

**Accepted (5):**
- H2 — a Back Attack Character is castable in the First Strike window. §15.2.3.3 bars "Summons or ... action or
  special abilities"; a Character cast is a special ACTION (§9.3.1.5), and a special ability is the S-icon kind
  (§11.7). Spec J2-D2's exclusion was an intent reading against the letter; the letter is followed (user decision,
  2026-09-29). `backAttackAllowed` (`cast.ts`) admits the window; `menuShape` lists casts there and `castBlocker`
  still refuses Summons and every other Character. Test inverted (timing-l1-back-attack, §15.2.3.3 case: cast,
  the window stays open, the turn player gains priority). J2-D2, J3-D2 step 4 and matrix row 15.2.3.3 updated.
- H3 — `observationKey` omitted `frozen`, `attack.firstStrikers` and `attack.heldDamage`. All three are now keyed,
  each appended only when present, so every other position keys exactly as before (no measured tree changes).
  Two key tests (red before).
- M1 — a held occurrence whose target broke in the first batch lost its side, and `damagedSideMatches` fell
  through to `true`, so a `whose: 'self'` clause fired on an opponent's Forward. `DamageOccurrence.targetController`
  is recorded as the hit lands (combat and ability damage). L1 case with `self` and `opponent` clauses (red
  before). Latent in the pool: its only `to: 'forward'` clause is `whose: 'any'`.
- M3 — the post-window party split had no case: an all-First-Strike party into a 13000 blocker that survives now
  owes the split only after the window (green on first run; coverage only). The "combatant leaves before the
  second batch" half stays as first-pass L4 (no pool trigger breaks a Forward in the window).
- L4 — Summoner's card-data test pins `generic: false`. The same-name limit itself is covered generically.

**Rejected / deferred (4):**
- M2 second half — `evaluate` has no term for a frozen card. Adding a weight changes every measured win rate, so
  it is a tuning change with a measurement, not a review fix. Deferred to the AI tuning backlog.
- L1 — `frozen` stays optional: state.ts documents absent-as-false by design, and there is no behavioural
  difference. The new key treats absent and false alike (tested).
- L2 — invariant consistency: first-pass L5 already constrains `heldDamage` placement; the rest has no failing case.
- L5 — the seed searches: first-pass L9 deferred this to the next deck edit (the Vol. 1 pool rung).
