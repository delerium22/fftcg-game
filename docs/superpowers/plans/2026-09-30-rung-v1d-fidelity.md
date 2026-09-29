# Rung V1-D — rules fidelity for the Vol. 1 pool: conditional triggers, "When you do so", revealed searches, Fire-only CP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** remove four of the SIMPLIFIED entries V1-B recorded (its Codex review H1, H2, M2, M3), each against the CR letter or an official ruling, and re-encode the affected cards.

**Architecture:** engine vocabulary first (each with synthetic Layer 1 tests), then the card re-encodings and the SIMPLIFIED table shrink, in one PR (the pool test ties them).

**Spec:** `docs/superpowers/specs/2026-09-29-rung-v1-vol1-pool.md`; adjudication `docs/superpowers/plans/2026-09-30-rung-v1b-code-review.md`. CR 3.3: §11.8.13, §11.8.7, §15.1.1.8.1, §11.2.2.3. Official ruling on "When you do so": https://fftcg.square-enix-games.com/en/news/regarding-when-and-if-wording-on-card-text (2019-07-19, Fusilier 9-013C).

## Global Constraints

- Plain-data AST; `git add` named paths; never `vitest.config.ts`; every commit green; V1-D16 touchpoints for every new kind (executor, validation, AI pricing, web narration, keys if a pending shape changes, invariants, timing matrix).
- Verify: `pnpm typecheck`, `pnpm lint`, `pnpm test` (5 known onTaskUpdate errors — grep), `pnpm test:browser`.

## Decisions

- **D-D1 — conditional auto-abilities (§11.8.13).** `Ability.triggerIf?: StaticCondition` for "(trigger), if (condition), (effect)". Checked when the trigger would be enqueued (`enqueueTrigger` or its dispatch callers: false → it does not trigger, no event) and again when the frame STARTS resolving (`runFrame`, beside the §11.11.2 check: false → cancelled with a `abilityCancelled`-style event, reason `condition`). Evaluated with the source's controller and `source` (`staticApplies`). Timing matrix 11.8.13 → tested. Ultima Weapon's Water clause moves its `if` from the effects to `triggerIf`. (Its Fire clause — "choose 1 Forward. If …, deal it 9000" — is an effect-level condition and stays.)
- **D-D2 — "When you do so" (reflexive auto-abilities).** A clause may carry follow-up abilities with `trigger: { kind: 'reflexive' }`, which no dispatcher ever fires on its own. An effect `{ kind: 'triggerReflexive', abilityId }` enqueues that ability (source and controller of the running frame, trigger event null) so it is placed at the next priority grant like any auto-ability — a separate stack item, with a response window after the first one resolves, its "choose" declared when placed (§11.8.4 cancellation applies). Vincent: the select → `onlyIfChosen` → `[putIntoBreakZone, triggerReflexive 23-119R:when-you-do-so]`; the reflexive clause chooses 1 opponent Forward → 9000. Clause counts are AST units (V1-B R2): Vincent gains one. Web narration: "Vincent's ability triggers (when you do so)".
- **D-D3 — revealed searches (§15.1.1.8.1).** `lookAtDeck.revealTaken?: true`: the taken cards are revealed to both players as they move (event `revealed`, and `learn(state, [0, 1], taken)` so the opponent's knowledge of that hand card persists). Check how knowledge of a card in HAND is kept today (`knownBy`/`knows`, `determinise`'s hand sampling): if a known hand card is not pinned in determinisation, pin it (a determinised opponent hand must contain the revealed card while it stays there), with a test. Leonora, Taivas and LB Luso set `revealTaken`.
- **D-D4 — Fire-only CP per §11.2.2.3.** A player may generate CP they do not spend; "You can only pay with Fire CP" restricts the CP USED. `canPay` under `onlyElement` succeeds when the admissible CP alone (each narrowed to the element) cover the requirement; inadmissible CP in the payment are allowed and unspent. `enumeratePayments` stays minimal (so it never lists a payment with a pointless Water source); `isLegal`/`apply` accept one; the web `crystals()` mirrors `canPay` (its property test). Tests: 3 Fire + 1 Water generated → legal; 2 Fire + 1 Water → refused.

## Review Focus

1. A conditional trigger whose condition becomes true only after it would have triggered (3 → 4 Water Characters later in the same chain) never triggers; one that becomes false before resolution is cancelled with a visible event.
2. Vincent: the opponent can respond (cast a Summon, e.g. a Back Attack or an instant) between the Backup going to the Break Zone and the reflexive clause's target being chosen; with no opposing Forward when the reflexive clause is placed, it is removed (§11.8.4).
3. A revealed searched card, still in the searcher's hand three turns later, appears in every ISMCTS determinisation of the opponent's view of that hand.
4. Ward with an over-generated Water CP: legal; the Water Backup is dulled (the CP was generated) and the Fire CP pay.

---

### Task 1: conditional auto-abilities

- [ ] Failing Layer 1 tests (synthetic): triggers with the condition true; does not trigger when false (no `abilityTriggered`); cancelled at resolution when it became false in between (Review Focus 1); timing matrix row 11.8.13 cites the test. Implement D-D1. Commit.

### Task 2: reflexive auto-abilities

- [ ] Failing tests: the reflexive ability is placed as its own stack item after the first resolves; a response in between (Review Focus 2); declined select → no reflexive trigger; placement cancellation with no target; the web narrates it; ISMCTS/greedy handle the new stack item (strict self-play with a synthetic card). Implement D-D2. Commit.

### Task 3: revealed searches

- [ ] Failing tests: `revealed` event; the opponent's view names the card in hand; determinisation keeps it (Review Focus 3); a search without the flag stays private. Implement D-D3. Commit.

### Task 4: Fire-only CP per §11.2.2.3

- [ ] Failing tests per D-D4, engine and web property test. Implement. Commit.

### Task 5: the cards

- [ ] Re-encode Ultima Weapon (Water clause `triggerIf`), Vincent (reflexive), Leonora/Taivas/LB Luso (`revealTaken`); Ward needs no data change. Update their tests and scenarios (Vincent's scenario: the response window; Ultima Weapon: 3 Water → no trigger). Remove the five entries from `pool-coverage`'s SIMPLIFIED table (Yuna's stays). Spec "As built (V1-D)". Commit.

### Task 6: ship

- [ ] Gate green; PR; merge; fast-forward.

---

## Revisions after the plan review (2026-09-30)

Fresh Fable reviewer (Codex out of quota until 07:09); adjudication in `2026-09-30-rung-v1d-fidelity.codex-review.md`.
These override the plan above.

- **R1 (H1) — Task 3 (revealed searches) is SPLIT OUT into its own rung V1-E** (the user's standing rule): known
  opponent-hand cards touch `viewFor` (view.ts, the spec-C9 MVP0-SIMPLIFICATION), `searchView` (search.ts), the
  hand sampling in `determinise`, the ISMCTS hand digest (`keys.ts` `hd${handCount}`) and the board. Leonora,
  Taivas and LB Luso stay in the SIMPLIFIED table, now pointing at rung V1-E. V1-D = Tasks 1, 2, 4, 5 (cards: Ultima
  Weapon, Vincent), 6.
- **R2 (H2)** — the AI must price `triggerReflexive` by following it into the reflexive ability's effects (the best
  target of Vincent's 9000), so the min-0 select is taken when a kill is available; greedy test.
- **R3 (H3)** — the reflexive ability's "choose" is declared when it is PLACED (J1-D3), inside `settle`, before any
  priority. The response window is after that declaration and before resolution. Review Focus 2's test: the opponent
  responds by removing the chosen Forward and the item ends `stackCancelled` reason `targetsGone` (§11.11.2).
- **R4 (M1, M2, M3)** — the resolution-time re-check is §11.11.3; flip timing-matrix rows 11.8.13 and 11.11.3 to
  `tested` in Task 1's commit. The check lives in `enqueueTrigger` (the single choke point); the `runFrame` re-check is
  gated on `stage === 'resolve' && frame.path.length === 0` only (not on `declared.length`). Extend `stackCancelled`'s
  reason union with `'condition'` (no new event); ADD web narration for `stackCancelled` in `useGame` (none exists —
  the §11.8.4 case is silent today too). Setup validation refuses `triggerIf` on non-auto trigger kinds.
- **R5 (M4)** — D-D4 needs no web change (`crystals()` already filters); Review Focus 4 is engine-only (`paymentCheck`,
  `apply`). Reverse the docs: `onlyCp` comment, `onlyAdmissible`, `canAffordCast`'s comment, and the V1-A3
  adjudication's kept reading.
- **R6 (M5, LOW)** — Vincent: `VOL1_CLAUSES['23-119R']` 1 → 2; update `abilities-vol1.test.ts`'s pinned tuple; the
  reflexive `text` is a contiguous slice of the printed text and the ETB's text shrinks to its first sentence; pin that
  a zone watcher resolves before the reflexive (same-controller last-triggered-first). Remove the `onlyIfChosen`
  MVP0-SIMPLIFICATION marker in engine `abilities.ts` that D-D2 retires. Narration "(when you do so)" reads the trigger
  kind from `defs` by `abilityId`. Task 5 removes three SIMPLIFIED entries (Ultima Weapon, Vincent, Ward).
