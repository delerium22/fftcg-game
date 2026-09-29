# Rung V1-E — revealed cards stay known in the opponent's hand; searches reveal what they find — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** §15.1.1.8.1 ("to search means to find specific cards … reveal them") holds for Leonora 3-143C, Taivas 21-010H and LB Luso 23-130H, and a card revealed and then kept in a hand stays known to the opponent — in their view, their board, the AI's determinisation and its search keys.

**Architecture:** the knowledge already exists: `learn`/`knownBy` flag a card per player, and `lookAtDeck` with `audience: 'all'` (Miner's reveal) learns it for both. What is missing is the HAND half of the spec-C9 MVP0-SIMPLIFICATION in `view.ts`: known opponent-hand cards are not surfaced. This rung surfaces them (`FieldView.knownHand`), pins them in determinisation, digests them in the ISMCTS observation key, shows them on the board, and adds `lookAtDeck.revealTaken` for searches that reveal only the card they take.

**Spec:** `docs/superpowers/specs/2026-09-29-rung-v1-vol1-pool.md`; `docs/superpowers/plans/2026-09-30-rung-v1d-fidelity.md` R1 (why this is its own rung); CR 3.3 §15.1.1.8.1, §7 (hand is a hidden zone).

## Global Constraints

- `viewFor` and `searchView` are duplicate projections and must stay key-for-key identical (`test/ismcts-search.test.ts` pins agreement over a self-play trace): change both, extend that test.
- Knowledge must not leak the other way: a card this viewer does NOT know stays opaque (`?`).
- Plain-data AST; `git add` named paths; never `vitest.config.ts`; every commit green.
- Verify: `pnpm typecheck`, `pnpm lint`, `pnpm test` (5 known onTaskUpdate errors — grep), `pnpm test:browser`.

## Decisions

- **E-D1 — `FieldView.knownHand: CardId[]`** (the viewer's knowledge of THAT player's hand; for the viewer's own seat, empty — they see their hand). Filled from `ps.hand.filter((id) => knows(state, me, id))` for the other player; those ids join `visibleIds`/`see` so their instances are in `cards`. Both projections.
- **E-D2 — determinisation pins them.** For the other player: `hand = [...knownHand, ...sample(handCount - knownHand.length)]` with the known codes removed from the unseen multiset first. The known cards keep their REAL ids from the view (as field cards do), and their `knownBy` bits come across unchanged. Conservation errors if a known code is absent from the deck list.
- **E-D3 — keys.** `fieldDigest`'s `hd${handCount}` becomes `hd${handCount}[${sorted codes of knownHand}]`, the codes appended only when non-empty (so every position without known hand cards keys exactly as before). Two views differing only in a known hand card digest differently (test).
- **E-D4 — when knowledge ends.** A known card leaving the hand to a PUBLIC zone needs nothing (it is visible there). To a hidden, shuffled zone (the deck, then a shuffle): the existing `forget` on shuffle covers it. To the bottom of the deck unshuffled (mulligan, "return to the bottom"): it stays known in that deck slot — the existing C9 behaviour.
- **E-D5 — `lookAtDeck.revealTaken?: true`.** The search's look stays private to its controller (`audience: 'self'`), but each TAKEN card is revealed as it moves: event `revealed { player, cards }` and `learn(state, [0, 1], taken)`. Leonora, Taivas and LB Luso set it. (`audience: 'all'` remains the reveal-everything shape Miner uses.)
- **E-D6 — the board.** The opponent's hand row shows each known card face up and the rest face down (count unchanged). Narration: "The AI reveals Porom and adds it to their hand."

## Review Focus

1. A revealed card that later leaves the hand to the field, then returns to the hand by a bounce: still known (it was public on the field) — `learn` on the bounce, or rely on the prior bit? Decide: a card that was on the field is public; returning it to hand keeps it known (bits already set) — test it.
2. `searchView`/`viewFor` agreement over a self-play trace that includes a revealed search (extend the existing test with a Vol. 1 pool game).
3. A determinisation from the opponent's seat with two known hand cards and a hand of five: exactly those two ids present, three sampled, conservation holds, invariants clean.
4. ISMCTS keys stable across determinisations with known hand cards; opaque unknown ones unchanged.
5. The shuffle after a search (`rest: 'shuffle'`) must NOT forget the taken card now in hand (`forget` runs on the deck after the taken card left it — check the order in `settleLook`).

---

### Task 1: surface known hand cards (views)

- [ ] Failing tests: after a synthetic reveal-then-take, `viewFor(state, opp).fields[p].knownHand` names the card and `cards` has its instance; the unknown hand cards stay absent; `searchView` agrees (extend the agreement test). Implement E-D1 in both projections; remove the hand half of the spec-C9 MVP0-SIMPLIFICATION comment. Commit.

### Task 2: determinisation and keys

- [ ] Failing tests per Review Focus 3 and 4 and E-D3. Implement E-D2 and E-D3. Commit.

### Task 3: `revealTaken` and the cards

- [ ] Failing tests: a search with `revealTaken` emits `revealed`, the opponent learns only the taken card (not the rest of the deck), Review Focus 5. Implement E-D5; set it on Leonora, Taivas, LB Luso; remove their three SIMPLIFIED entries and markers (the table then holds only Yuna). Commit.

### Task 4: the board and narration

- [ ] Failing tests: the opponent hand row renders known cards face up (component test); the log line; a browser check. Implement E-D6. Commit.

### Task 5: ship

- [ ] Gate green; spec "As built (V1-E)"; PR; merge; fast-forward.

---

## Revisions after the plan review (2026-09-30)

Fresh Fable reviewer (Codex out of quota); adjudication in `2026-09-30-rung-v1e-revealed-hand.codex-review.md`.
These override the plan above.

- **R1 (H1)** — the V1-A2 hand-select redaction must key on ZONE, not visibility: any candidate in the other
  player's hand forces `{ candidates: [], hidden: true }` (view.ts ~91), so known hand ids do not reveal which
  unknown cards fail a filter. Test: two known + one unknown, filter matching only the known → still hidden.
- **R2 (H2)** — a card moving from a public zone (field, Break Zone) to a hand is known to both players:
  `toHand` (resolve.ts ~239) calls `learn(state, [0, 1], [id])`. Review Focus 1's test uses a card never exposed
  before it was cast, then bounced.
- **R3 (M1)** — Tasks 1 and 2 land in ONE commit (views and determinisation together), so no commit deals a known hand
  card's code twice.
- **R4 (M2)** — Task 4 is a new opponent-hand zone on the board (known cards face up, the rest as a count or backs),
  with `boardCardIds` and the orphan-row logic updated; sized and tested as a component, plus a browser check.
- **R5 (M3, M5)** — narration: `addedToHand` gains `revealed?: true` and reads "The AI reveals Porom and adds it to
  their hand"; no separate `revealed` line, and the event joins the "engine really emits" test list. `revealTaken` is
  valid only with `to: 'hand'` (setup validation).
- **R6 (M4)** — tests: Miner's reveal → bottom → drawn → surfaces in `knownHand`; a private look's (`audience:
  'self'`) bottom cards do NOT surface when drawn.
- **R7 (LOW)** — a known opponent hand card still keys as `?` in ACTION keys (no pool select picks from the other
  player's hand; comment updated at keys.ts ~32); the CLI render prints the known names beside `hand N`; E-D4's
  "shuffle forgets" note says no effect returns a hand card to the deck today; the hand digest omits the knownBy mask
  (the owner always knows their own hand).
