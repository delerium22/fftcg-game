# Rung A — Heuristic AI opponent: design spec

## Context

MVP0 delivered a headless rules engine (`packages/engine`), the Starter Set 2025 Vol. 2 card
pool, a `RandomAgent`, and a CLI with a random-vs-random self-play fuzzer. The end goal (standing
mandate, 2026-08-26) is a browser game where the user plays against an AI opponent with real card
art. Rung A builds the opponent's brain at engine level so that rung B (web UI) ships as
"play vs AI" from day one. The AI must be **fair** (sees only `PlayerView`), **deterministic**
(seeded), **fast enough for a browser** (tens of ms per decision), and **measurably better than
random**.

Research (Forge, SabberStone / Hearthstone AI competition, Cowling et al. ISMCTS; notes in the
session scratchpad `ai-research.md`) says: the biggest strength jump is random → *any*
evaluation function; a greedy one-ply agent with a hand-tuned evaluation was runner-up in the
2018 Hearthstone AI competition; mana/CP payment must be collapsed to one canonical choice, never
enumerated; tune weights by self-play win rate. Rung D (ISMCTS) reuses the evaluation, the
determinisation utility and the playout policy built here.

## Decisions

| # | Decision | Ruling (and why) |
|---|---|---|
| A1 | Agent shape | **Greedy lookahead**: for each legal command, simulate it on a determinised copy of the game and score the resulting state with an evaluation function; pick the best. General over every command type (cast, attack, block, party split, mulligan, discard) — no per-decision rule code except CP payment. |
| A2 | Lookahead depth | Configurable `depth`: 0 = score right after the command; 1 = finish my own turn greedily (default); 2 = also let a greedy opponent take its turn (used for attack/block decisions when time allows). Default 1; the attack declaration step uses depth 2. |
| A3 | Hidden information | The agent receives only `PlayerView` plus the two **deck lists** (public knowledge for starter decks; the web UI will pass the same). A `determinise(view, decks, rng)` engine utility rebuilds a full `GameState` consistent with the view: visible ids preserved, opponent hand / both decks sampled from the unseen multiset with the agent's seeded RNG. Never the ground-truth state. |
| A4 | CP payment | Never enumerate. `preferredPayment(view, card)` picks one payment per castable card: dull backups first (element match required), then discard the least valuable hand cards (by `cardValue`). Only that command is evaluated. |
| A5 | Evaluation | One scalar `evaluate(state, me): number` reused everywhere (Forge's `CreatureEvaluator` pattern): damage race, board (forward power sum × active), backups (CP economy, capped at 5), hand size, deck size (small), lethal/loss terminal values. Weights in a plain `Weights` object with defaults; tuning recorded in the spec's appendix. |
| A6 | Posture | A single `aggression` scalar (0–1) shifts weight from own-board preservation to opponent-damage; default 0.5. (Forge's 0–6 aggression knob, simplified.) |
| A7 | Determinism | Agent constructor takes a seed; all randomness through the engine's `Rng`. Same seed + same views ⇒ same decisions. |
| A8 | Time budget | `decide` must average < 50 ms on the Vol. 2 pool at depth 1 (measured in the CLI); a `maxSimulations` cap guards pathological branching. |
| A9 | Measurement | `selfplay` gains `--p0/--p1 random|greedy` and a `--seed`; `GreedyAgent` must beat `RandomAgent` **≥ 80 %** over 200 seeded games (research: greedy+eval "crushes" random; 80 leaves headroom for the ability-less pool). Greedy-vs-greedy games must terminate within the command cap. |
| A10 | Not in scope | Tree search (rung D), ability awareness (no abilities exist yet), opening-hand / mulligan sophistication beyond a simple rule, UI. |

**As built — reconciliation notes** (see the Architecture section below for the concrete file/signature list; this only calls out where the implementation diverged from the ruling above):
- **A2**: attack declaration forces `Math.max(this.depth, 2)`, not a flat "2" — an agent configured with `depth: 2` stays at 2, never drops. Setup states (`chooseFirst`/`mulligan`) are scored at depth 0 regardless of configured depth, since `evaluate` already prices hand quality directly and rolling out an undealt turn adds nothing (F5 in the Codex review).
- **A3**: `determinise` takes one options object, `{ view, decks, rng }`, and returns a **tuple** `[GameState, Rng]` (the advanced RNG state, not a mutated `Rng`) — callers must thread the returned `Rng` back in, which `GreedyAgent.decide` does (`this.rng = rng`). It lives at `packages/engine/src/determinise.ts`, not under `view.ts`. The two deck lists are required to be the players' **complete, publicly declared 50-card lists** — this is a game-mode assumption (an open/fixed starter matchup), not a general rules guarantee; `determinise` throws if a visible card's code isn't in the declared list for that player. See the fairness note below.
- **A4**: the built signature is `preferredPayment(state, player, card)` — it operates on a full (determinised) `GameState`, not a bare `PlayerView`, because it needs backup/hand card definitions and `canPay`/`generateCp` from the engine. It also resolves multi-element costs via `requiredElements(def)` (§11.2.1.1 Light/Dark exemption, C3) and bounded backtracking over the required elements (C2, final fix wave) — not simply "dull backups then discard" in element order, and not a single scarcity-first greedy pass either: a single pass, even scarcest-element-first, can still strand a later element when the cheapest per-element pick spends a source only that element's rescue depended on (Codex's 3-element counterexample). Backtracking explores every source-to-element assignment and keeps the cheapest complete one.
- **A5**: the board term is `forwardPower × (dull ? dullFactor : 1) + forwardPresence` per forward (a flat per-body bonus, not folded into the power term), and there is a `handQuality` term (`Σ cardValue(hand card) × weights.handQuality`) not listed in A5's feature list. The `threat` feature is **not** "opponent's attacking power vs my blockers" as originally planned; it is a **per-side, antisymmetric tempo term** — each side's own active (undull) forwards contribute `power × weights.threat` to that side's own material score, and `evaluate` is `material(me) × 2 × (1 − aggression) − material(opp) × 2 × aggression`, which is exactly zero-sum at `aggression = 0.5`. This replaced the original blocker-relative threat term per the Codex review (MEDIUM: "per-side tempo replaces the antisymmetric threat term").
- **A9**: `AgentSpec` (in `apps/cli/src/agents.ts`) carries no seed — `{ kind: 'random' }` or `{ kind: 'greedy'; depth?: 0 | 1 | 2 }`. Seats are seeded by `selfPlay` itself: `(seed + g) * 2 + p + 1` for game `g`, seat `p`, so the seat's RNG stream is independent of the legacy random-vs-random `seed * 2 + 1/2` scheme. `Agent` gained a `needsLegalCommands` flag (`RandomAgent: true`, `GreedyAgent: false`) so `selfPlay` can skip building `legalCommands` for greedy seats — see the Appendix timing note.
- **Final fix wave (2026-08-26, C1–C5)**: an interim fix wave had regressed the simulation budget to a single `Budget` shared across all of `decide`'s top-level candidates, making scoring order-dependent (early candidates could exhaust the budget rollouts later ones needed). `scoreCandidates(det, cands, opts)` now allocates a fresh `Budget{used,cap}` per candidate, `cap = max(1, floor(maxSimulations / candidates))` — the chosen command is invariant under candidate reordering (C1). Combat resolution (`resolveCombat`) never stops early on an exhausted budget and always runs to completion (W1); a party's `declareBlock` candidates are now scored on the fully-resolved outcome (the damage split included), not the pre-split snapshot (W2). `resolveCombat` takes an explicit `perspective: PlayerId` parameter instead of keying aggression off `state.turnPlayer` (C4) — needed because the agent's own defensive decisions (`declareBlock`/`assignPartyDamage`) have `p !== turnPlayer` throughout the opponent's Attack Phase. `boundedAttackSets` (C5) now also emits every legal *pair* of attackers, deduplicated by sorted attacker-id signature, alongside singles and per-element full parties.
- **Backlog (deferred, not defects today)**: `evaluate`'s `dullFactor` and `threat` weights both encode active-vs-dull forward power from different angles (Codex LOW — tuning/design overlap); no behavioural bug, left as a future tuning simplification. `determinise` conserves each deck list by field **controller**, not `CardInstance.owner` (`packages/engine/src/determinise.ts:35-46`) — correct under MVP0, which has no control-changing effects, but will need the owner-based fix before any control-change mechanic ships.

## Architecture (as built)

```
packages/engine/src/determinise.ts   determinise({ view, decks, rng }): [GameState, Rng]   (engine utility; also for ISMCTS)
packages/ai/src/evaluate.ts          evaluate(state, me, weights?, aggression?): number; DEFAULT_WEIGHTS; Weights
packages/ai/src/cardValue.ts         cardValue(def): number                          (for discards / payment choice / handQuality)
packages/ai/src/payment.ts           preferredPayment(state, player, card): Payment | null
packages/ai/src/candidates.ts        candidateCommands(state, player): Command[]     (bounded attack sets; one payment per castable card)
packages/ai/src/agent.ts             interface Agent { decide, needsLegalCommands? }; class RandomAgent implements Agent
packages/ai/src/greedy.ts            class GreedyAgent implements Agent; greedyStep, resolveCombat, pruneCandidates, scoreCandidates (exported for testing)
packages/ai/src/index.ts             re-exports (Agent, RandomAgent, GreedyAgent, evaluate, candidateCommands, preferredPayment, …)
apps/cli/src/agents.ts               AgentSpec (no seed); parseAgentSpec/describeAgentSpec; makeAgent (seat-seeds an Agent)
apps/cli/src/selfplay.ts             agent selection per seat; per-agent timing (msPerDecision) and decision counts in the report
apps/cli/src/main.ts                 --p0 --p1 --depth --fast flags
```

### `determinise({ view, decks, rng })` (engine)
- Inputs: `PlayerView` for `me`, both deck lists (`string[]` of codes, index by player, must be the complete declared 50-card lists), `Rng`.
- Known: my hand ids, both fields, damage zones, break zones, all with real ids and codes (from `view.cards`).
- Unseen multiset per player = that player's deck list minus the codes of their visible cards (field/damage/break, plus my own hand for me). For the opponent, sample `handCount` codes for the hand and the rest is the deck (shuffled); for me, my deck is the rest of my unseen multiset (shuffled). New synthetic ids (≥ 100 000, `SYNTHETIC_ID_BASE`) for hidden cards.
- Output must satisfy `checkInvariants` and `viewFor(det, me)` must equal the input view modulo synthetic ids (counts, zones, public cards identical). Deterministic per rng. Returns `[GameState, Rng]` — the caller must keep the returned `Rng` for its next call, since the input `rng` is consumed by the shuffle.

### `evaluate(state, me, weights, aggression)` (ai)
Terminal: `±weights.terminal` if `result.winner` is me/opponent, `0` on a draw. Otherwise `material(me) × 2 × (1 − aggression) − material(opp) × 2 × aggression`, where `material(state, p, weights)` sums, for side `p`:
- `damage`: `(DAMAGE_TO_LOSE - damageZone.length) × weights.damage` (the race).
- per forward: `(power / 1000) × weights.forwardPower × (dull ? weights.dullFactor : 1) + weights.forwardPresence`, plus (if active) `(power / 1000) × weights.threat` — this side's own attack-ready tempo, added on both sides so the term is antisymmetric in the final `mine - theirs` and exactly zero-sum at `aggression = 0.5` (not "opponent power vs my blockers" as first drafted — see the A5 reconciliation note).
- `backup`: `min(backups, MAX_BACKUPS) × weights.backup` — CP economy.
- `hand`: hand size (diminishing 0.25× above `HAND_SIZE_LIMIT`), plus `handQuality`: `Σ cardValue(hand card) × weights.handQuality`.
- `deck`: `deck.length × weights.deck` (deck-out awareness; small).
`aggression ∈ [0, 1]` (throws `RangeError` outside that range) shifts weight from own-board preservation (low) to opponent-damage (high); `resolveCombat`/`greedyStep` evaluate the opponent's own steps at `1 − aggression`.

### `GreedyAgent.decide(view, legal)`
1. Determinise once per decision: `[det, rng] = determinise({ view, decks, rng: this.rng })`; store the returned `rng` for next time.
2. Build candidates via `candidateCommands(det, me)` — legal commands with cast commands collapsed to one per card via `preferredPayment` (bypassing `legal`'s enumerated payment permutations), and attack declarations bounded above 6 eligible attackers (`boundedAttackSets`: every singleton, every legal pair, plus per element the full same-element party — deduplicated by sorted attacker-id signature, C5) instead of `legalAttackSets`'s full 2ⁿ enumeration. `pass` is always last. `legal` is only consulted as a fallback (empty candidates ⇒ the non-acting player's only legal command, `concede` — C6) — the hot path never needs it, which is what `needsLegalCommands: false` signals to the caller.
3. `pruneCandidates` caps the candidate count at `max(1, maxSimulations)`, always keeping `pass`.
4. Depth for this decision: 0 at `setup` phase (chooseFirst/mulligan — `evaluate` already prices hand quality without a rollout); `max(configuredDepth, 2)` at attack declaration; else the configured `depth` (default 1).
5. `scoreCandidates(det, cands, opts)` scores each candidate independently (see Budget below): apply it, then `resolveCombat` fast-forwards any pending `declareBlock`/`assignPartyDamage` — scored from the explicit `perspective = me`, not `state.turnPlayer` (C4) — so combat is always resolved before scoring, including the party-damage split (W2), never scored mid-combat. Then, per depth: `depth ≥ 1` rolls out the rest of the *acting turn's owner's* turn with `greedyStep`; `depth ≥ 2` also rolls out the following (opponent's) turn. `decide` takes the strictly-best-scoring candidate (ties favor the earlier one, which is `pass`-last by construction) and throws if it references a synthetic card id (W4 — candidates are built only from `me`'s own, always-visible resources, so one never should).
6. Budget (C1, final fix wave): each candidate gets its **own** fresh `Budget { used, cap }`, `cap = max(1, floor(maxSimulations / candidates))` — not one budget shared across all candidates, which would make the pick order-dependent (an interim version regressed to sharing one, since fixed). The top-level apply and the full `resolveCombat` that follows are exempt from the cap — they always run to completion (W1) — but their applies still count against `used`, so the rollout loop that follows may already be over cap before it starts. `lastSimulations` sums `used` across all per-candidate budgets; documented bound `lastSimulations ≤ maxSimulations + lastCandidates` (as before — the per-candidate floor plus the always-applied top-level apply account for the `+ lastCandidates` term). `lastSimulations`, `lastCandidates`, `lastDepth`, and `lastScores` (`{ command, score, turn, used }[]`, one per top-level candidate) are exposed for tests/diagnostics.

### Selfplay changes
`selfPlay({ agents: [AgentSpec, AgentSpec], … })` where `AgentSpec = { kind: 'random' } | { kind: 'greedy'; depth?: 0 | 1 | 2 }` — **no seed on the spec**; `selfPlay` seeds each seat's `Agent` itself via `makeAgent(spec, (seed + g) * 2 + p + 1, decks)` for game `g`, seat `p`. The report gains `agents: [string, string]`, `msPerDecision: [number, number]` (end-to-end per-decision average, see the Appendix timing note), and `decisions: [number, number]`. CLI flags `--p0`, `--p1` (default `random random`), `--depth` (applies only to a bare `greedy` spec, not `greedy:N`), `--fast` (relaxes `selfPlay`'s `strict` invariant/mutation checks for faster tournament runs).

## Testing
- `determinise`: invariants hold; visible zones identical to the view; unseen multiset conservation (for each player, codes across sampled hand+deck == deck list minus visible); deterministic per seed; works from setup states (pending chooseFirst/mulligan) and mid-attack states (pending declareBlock) — the walk test from MVP0 provides the states.
- `evaluate`: monotonic sanity checks (more own damage → lower; more own board → higher; terminal states dominate).
- `preferredPayment`: prefers dulling backups over discards; never discards the card being cast; returns null when unaffordable; result satisfies `canPay`.
- `GreedyAgent`: deterministic per seed; never returns concede while another command exists; takes lethal when available (a constructed board with an unblocked lethal attack); blocks when losing the race; greedy-vs-greedy self-play terminates. **As built**: the in-suite strength test (`apps/cli/test/selfplay.test.ts`) runs 30 games (15 per seat, depths 1) and asserts `wins ≥ 21` (≥ 70 %) plus `msPerDecision < 80` ms and `decisions/msPerDecision > 0` per side (guards against a vacuously-passing broken timer/counter); the real ≥ 80 % / 200-game gate is measured by the CLI run and recorded in the Appendix below, not re-run inside the test suite.

## Verification (done-when)
- `pnpm test && pnpm typecheck && pnpm lint` green.
- `pnpm --filter @fftcg/cli selfplay --games 200 --seed 1 --p0 greedy --p1 random --fast` → greedy wins ≥ 160; `--p0 random --p1 greedy --fast` symmetric check ≥ 160; `--p0 greedy --p1 greedy --fast` → 200 completed, 0 failures. See the Appendix for the measured msPerDecision (end-to-end — well under the < 50 ms A8 target — at depth 1 and 2).
- Rung A appendix records the tuned weights and the win rates measured.

## Risks
- Ability-less pool may make the game too "vanilla" for evaluation features to matter — mitigated by measuring, not assuming.
- Determinisation from the setup phase (before draws) is trivial (everything unseen); tests must cover it.
- Depth-2 rollouts multiply cost: gated by `maxSimulations`.

## Appendix — rung A measurements (2026-08-26)

### Final weights

`DEFAULT_WEIGHTS` in `packages/ai/src/evaluate.ts`, unchanged from the first implementation — every tuning-range tournament below cleared the ≥ 80 % gate on the first run, so no adjustment was needed:

```ts
export const DEFAULT_WEIGHTS: Weights = {
  damage: 30,
  forwardPower: 1.2,
  forwardPresence: 4,
  dullFactor: 0.6,
  backup: 5,
  hand: 2,
  handQuality: 0.5,
  deck: 0.1,
  threat: 0.8,
  terminal: 100_000,
}
```

### Baseline

The random baseline throughout is **concrete-command random**: `RandomAgent` samples uniformly over `legalCommands`, and `legalCommands` enumerates one command *per payment permutation* for each castable card (`enumeratePayments`), not one per card. So `RandomAgent` implicitly over-weights cards with more ways to pay for them relative to a "semantic" random baseline that would first pick a card uniformly and then a payment for it. This makes the baseline slightly stronger at flooding the board than a naive reading of "plays randomly" would suggest, which if anything makes greedy's win rates below a more conservative comparison.

### Timing note

`msPerDecision` is **end-to-end**: it wraps `viewFor` (build the player's view), `legalCommands` (skipped for greedy seats — see below), and `agent.decide`, timed per decision in `apps/cli/src/selfplay.ts`. `Agent.needsLegalCommands` is `false` for `GreedyAgent`, so `selfPlay` passes it `legal: []` and never pays for `legalCommands(state, p)` on the greedy hot path; `RandomAgent.needsLegalCommands` is `true` (the default), so its `msPerDecision` figures below *do* include a full `legalCommands` call. This asymmetry is why greedy's per-decision cost (~0.2–0.4 ms, dominated by determinise + rollout) is not directly comparable to random's (~0.05 ms, dominated by `legalCommands`'s payment enumeration) as a measure of "who does more work" — they are timing different things.

### Tuning range (`--seed 1000`, untouched by any weight decision — used only to decide *whether* to tune)

| Matchup | Depth | Wins (p0/p1) | Win % (greedy) | Completed | avgTurns | msPerDecision (p0/p1) |
|---|---|---|---|---|---|---|
| greedy(p0) vs random | 1 | 198 / 2 | 99.0 % | 200/200 | 13.585 | 0.2475 / 0.0527 |
| random vs greedy(p1) | 1 | 4 / 196 | 98.0 % | 200/200 | 13.695 | 0.0543 / 0.2570 |
| greedy vs greedy | 1 | 89 / 111 | — | 200/200 | 23.085 | 0.3298 / 0.3599 |
| greedy(p0) vs random | 2 | 198 / 2 | 99.0 % | 200/200 | 12.610 | 0.3030 / 0.0526 |
| random vs greedy(p1) | 2 | 0 / 200 | 100.0 % | 200/200 | 12.195 | 0.0524 / 0.2929 |
| greedy vs greedy | 2 | 102 / 98 | — | 200/200 | 18.530 | 0.3578 / 0.3698 |

Both greedy-vs-random seat orders cleared 160/200 (80 %) at depth 1 on the first run (198/200 and 196/200), so no `DEFAULT_WEIGHTS` iteration was needed — the brief's tuning loop (`damage` 30→40, `threat` 0.8→1.5, `forwardPresence` 4→6) was not entered.

### Gate (`--seed 1`, run once, final weights = unchanged `DEFAULT_WEIGHTS`)

| Matchup | Depth | Wins (p0/p1) | Win % (greedy) | Completed | avgTurns | msPerDecision (p0/p1) |
|---|---|---|---|---|---|---|
| greedy(p0) vs random | 1 | 200 / 0 | 100.0 % | 200/200 | 13.650 | 0.2284 / 0.0468 |
| random vs greedy(p1) | 1 | 3 / 197 | 98.5 % | 200/200 | 13.945 | 0.0483 / 0.2284 |
| greedy vs greedy | 1 | 102 / 98 | — | 200/200 | 23.285 | 0.2034 / 0.1992 |
| greedy(p0) vs random | 2 | 200 / 0 | 100.0 % | 200/200 | 12.040 | 0.3088 / 0.0502 |
| random vs greedy(p1) | 2 | 2 / 198 | 99.0 % | 200/200 | 12.320 | 0.0531 / 0.3278 |
| greedy vs greedy | 2 | 94 / 106 | — | 200/200 | 18.680 | 0.3571 / 0.3693 |

All six seed-1 gate runs completed 200/200 games with zero failures. Both greedy-vs-random seat orders clear the ≥ 80 % A9 gate by a wide margin (98.5–100 %) at both depths; greedy-vs-greedy stays close to 50/50 (as expected — a symmetric weight set playing itself), and terminates well within the command cap. All `msPerDecision` figures are two orders of magnitude under the < 50 ms A8 budget.

**Re-verified after the final fix wave (2026-08-26, `DEFAULT_WEIGHTS` unchanged, depth 1, same `--seed 1` gate)**: greedy(p0) vs random 199/1 (99.5 %); random vs greedy(p1) 3/197 (98.5 %, identical to the row above); greedy vs greedy 96/104. All 200/200 completed, 0 failures. Not a material change from the table above (still comfortably ≥ 160/200 in both asymmetric seats; the symmetric matchup stays close to 50/50) — the small per-game deltas are the expected effect of C1–C5's behavioural fixes (per-candidate budget, budget-exempt combat resolution, corrected `resolveCombat` perspective, bounded-backtracking payment, deduplicated attack pairs), not a regression.

Commands used (repo root, `pnpm --filter @fftcg/cli selfplay`), e.g.:
```
pnpm --filter @fftcg/cli selfplay --games 200 --seed 1000 --p0 greedy --p1 random --fast
pnpm --filter @fftcg/cli selfplay --games 200 --seed 1000 --p0 greedy --p1 random --fast --depth 2
pnpm --filter @fftcg/cli selfplay --games 200 --seed 1    --p0 greedy --p1 greedy --fast --depth 2
```
(swap `--p0`/`--p1` for the mirrored seat order; drop `--depth 2` for depth 1, the default).
