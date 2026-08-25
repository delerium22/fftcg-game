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

## Architecture

```
packages/engine/src/determinise.ts   determinise(view, decks, rng): GameState        (engine utility; also for ISMCTS)
packages/ai/src/evaluate.ts          evaluate(state, me, weights?): number; DEFAULT_WEIGHTS; Weights
packages/ai/src/cardValue.ts         cardValue(def): number                          (for discards / payment choice)
packages/ai/src/payment.ts           preferredPayment(view, card): Payment | null
packages/ai/src/greedy.ts            class GreedyAgent implements Agent { constructor(opts) }
packages/ai/src/index.ts             re-exports (Agent, RandomAgent, GreedyAgent, evaluate, …)
apps/cli/src/selfplay.ts             agent selection per seat; per-agent timing in the report
apps/cli/src/main.ts                 --p0 --p1 flags
```

### `determinise(view, decks, rng)` (engine)
- Inputs: `PlayerView` for `me`, both deck lists (`string[]` of codes, index by player), `Rng`.
- Known: my hand ids, both fields, damage zones, break zones, all with real ids and codes (from `view.cards`).
- Unseen multiset per player = that player's deck list minus the codes of their visible cards (field/damage/break, plus my own hand for me). For the opponent, sample `handCount` codes for the hand and the rest is the deck (shuffled); for me, my deck is the rest of my unseen multiset (shuffled). New synthetic ids (≥ 100 000) for hidden cards.
- Output must satisfy `checkInvariants` and `viewFor(det, me)` must equal the input view modulo synthetic ids (counts, zones, public cards identical). Deterministic per rng.

### `evaluate(state, me, weights)` (ai)
Terminal: `+∞`-like constant if `result.winner === me`, negative if lost, 0 draw. Otherwise a weighted sum of features computed for me minus opponent:
- `damage`: `(7 - myDamage)` vs `(7 - oppDamage)` (weight high; the race).
- `board`: Σ forward power (active forwards count fully, dull forwards at a fraction), plus a per-forward presence bonus.
- `backups`: count (capped 5) — CP economy.
- `hand`: hand size (diminishing above 5).
- `deck`: small positive per card (deck-out awareness).
- `threat`: opponent's total attacking power vs my blockers (feeds the aggression split).
`aggression` scales the opponent-side terms.

### `GreedyAgent.decide(view, legal)`
1. Build candidate commands: all non-concede `legal` commands, but for cast commands collapse to one per card via `preferredPayment` (the legal list's payments for that card are ignored; if `preferredPayment` yields a payment not in `legal` it is still legal — `apply` validates semantically).
2. Determinise once per decision (`det = determinise(view, decks, rng)`).
3. For each candidate: `s1 = apply(det, cmd)`; then per depth: 1 → play out my turn with the *same* greedy policy at depth 0 until the turn passes or the game ends; 2 → then play the opponent's turn with greedy depth 0. Score with `evaluate`. Tie-break deterministically by candidate order, then prefer non-pass.
4. `pass` is always a candidate; mulligan/discard/block/party-split decisions flow through the same loop.
5. Cap: if candidates × depth-1 rollouts would exceed `maxSimulations`, drop to depth 0.

### Selfplay changes
`selfPlay({ agents: [AgentSpec, AgentSpec], … })` where `AgentSpec = { kind: 'random' | 'greedy', seed }`; report adds `msPerDecision: [number, number]`. CLI flags `--p0`, `--p1` (default `random random` to keep the fuzzer's behaviour).

## Testing
- `determinise`: invariants hold; visible zones identical to the view; unseen multiset conservation (for each player, codes across sampled hand+deck == deck list minus visible); deterministic per seed; works from setup states (pending chooseFirst/mulligan) and mid-attack states (pending declareBlock) — the walk test from MVP0 provides the states.
- `evaluate`: monotonic sanity checks (more own damage → lower; more own board → higher; terminal states dominate).
- `preferredPayment`: prefers dulling backups over discards; never discards the card being cast; returns null when unaffordable; result satisfies `canPay`.
- `GreedyAgent`: deterministic per seed; never returns concede while another command exists; takes lethal when available (a constructed board with an unblocked lethal attack); blocks when losing the race; ≥ 80 % vs random over 200 games (CLI-level test with a smaller in-suite sample, e.g. 60 games ≥ 75 %, and the 200-game figure asserted by the CLI run in the plan's verification); greedy-vs-greedy self-play terminates; average decision time asserted loosely in a test (< 200 ms) and measured precisely in the CLI.

## Verification (done-when)
- `pnpm test && pnpm typecheck && pnpm lint` green.
- `pnpm --filter @fftcg/cli selfplay --games 200 --seed 1 --p0 greedy --p1 random` → greedy wins ≥ 160; `--p0 random --p1 greedy` symmetric check ≥ 160; `--p0 greedy --p1 greedy` → 200 completed, 0 failures, msPerDecision < 50 at depth 1.
- Rung A appendix records the tuned weights and the win rates measured.

## Risks
- Ability-less pool may make the game too "vanilla" for evaluation features to matter — mitigated by measuring, not assuming.
- Determinisation from the setup phase (before draws) is trivial (everything unseen); tests must cover it.
- Depth-2 rollouts multiply cost: gated by `maxSimulations`.
