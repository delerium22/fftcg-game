# Rung D1 — ISMCTS: a search-based opponent, headless

## Context

The standing mandate names the AI progression explicitly: **heuristic then ISMCTS**. The heuristic
(`GreedyAgent`) is merged and beats `RandomAgent` 200/0 on the seed-1 gate. Rung A built
`determinise()` and `evaluate()` *for this rung* and they have since been proved through two ability
rungs. This is the rung they were for.

**Why now, ahead of more ability clauses.** Thirteen of eighteen cards still play as vanilla, and that is
the more *visible* gap — but it is a long tail of three more C rungs, while D is one, and the AI opponent
is what the mandate puts first. `GreedyAgent` at depth 1 is a competent-but-shallow player: it never sees
that a trade it likes now loses the race two turns out. Against a human that is the difference between an
opponent and a puzzle. Abilities resume at C3 straight after.

**Scope discipline.** This rung is **headless only** — the CLI gains an `ismcts` agent and the measurement
harness proves it is stronger than greedy. Wiring it into the browser needs a Web Worker (see D-3 below)
and is **rung D2**. Splitting there keeps both halves small and keeps a search-quality regression separate
from a UI-threading regression.

## What the research says (and what we already have)

Cowling, Powley & Whitehouse's ISMCTS, and the way Forge and the Hearthstone simulators apply it:

- **Determinise per iteration, share the tree.** Each iteration samples one consistent world from the
  information set and descends the *same* tree. Nodes are information sets, not states — which is what
  makes the search sound under hidden information instead of cheating.
- **UCB1 with availability counts** (SO-ISMCTS). Different determinisations make different moves legal, so
  a move's UCB must divide by how often it was *available*, not by how often the parent was visited.
  Getting this wrong silently biases toward moves that are rarely legal.
- **Cheap rollouts, good evaluation.** A heuristic rollout beats a random one; a heuristic *evaluation* at
  a depth cap beats rolling to terminal. We already have both.

Everything the search needs already exists and is battle-tested: `determinise({view, decks, rng})`,
`candidateCommands()` (bounded, deterministic, `pass` last), `evaluate()`, and — the one C2 made
essential — `resolveForcedDecisions()`, which drains combat and ability work so a node is only ever
created at a genuine decision point.

## Decisions

| # | Decision | Ruling (and why) |
|---|---|---|
| D-1 | **SO-ISMCTS with UCB1-availability** | Single-observer: the tree is built from the searching player's information set; the opponent's hidden cards come from the per-iteration determinisation. Availability counts are non-negotiable — without them the bandit is biased by how often a move happened to be legal. |
| D-2 | **Nodes live at genuine decision points only** | Every state entering the tree is first run through `resolveForcedDecisions`. A node owing a block, a party split or an ability target is not a decision the searching player is choosing at — that is the same class of error as R4 and C1's `chooseMode` chain, and it has now arrived three times. |
| D-3 | **Deterministic and seeded** | Same seed + same views ⇒ same move, exactly as `GreedyAgent`. Self-play compares runs; the fuzzer's mutation check is unforgiving. All randomness through the engine's `Rng`. |
| D-4 | **Budget is iterations, not wall-clock** | Wall-clock makes the agent non-reproducible and the tests flaky. `iterations` is the knob; the CLI reports ms/decision so the browser budget can be chosen from measurement in D2. |
| D-5 | **Rollouts use the greedy policy, capped** | `greedyStep` for both players to a depth cap, then `evaluate()`. Random rollouts in a game with this much board state are mostly noise. |
| D-6 | **`GreedyAgent` is untouched** | It stays the baseline, the rollout policy, and the fallback. A new `IsmctsAgent` implements the same `Agent` interface (`decide(view, legal)`, `needsLegalCommands = false`), so the CLI, the web app and every harness take it with no changes. |
| D-7 | **Not in scope** | The browser (D2 — needs a Web Worker: `decide` is synchronous with no deadline, and search will run 100–1000× a greedy decision), opening-book or learned weights, and any change to `evaluate`'s weights. |

## Acceptance criteria

- **D-A1** `IsmctsAgent` beats `GreedyAgent` **≥ 60 %** over 200 seeded games, both seats, at a stated
  iteration budget — the bar that says search is actually buying something over one-ply lookahead.
- **D-A2** It still beats `RandomAgent` ≥ 95 %, i.e. the search never regresses below the heuristic floor.
- **D-A3** Determinism: same seed and same views produce an identical decision trace, asserted over a
  whole game, and a determinised state and a live one search identically (the C1-A6 shape).
- **D-A4** **Fairness**: the search only ever reads `PlayerView` plus the two public deck lists. Asserted,
  not inspected — the same test shape that pins `viewFor` not leaking the opponent's hand.
- **D-A5** Every state a node is created at satisfies `pending === null` and an empty resolution agenda
  (D-2), asserted by a diagnostic like `CandidateScore.resolutionQueued` rather than inferred.
- **D-A6** The strict fuzzer passes with `ismcts` on both seats; no illegal state, no dead end, no
  unbounded search.
- **D-A7** The CLI reports iterations/decision and ms/decision, so D2 can pick a browser budget from
  measurement rather than a guess.
- **D-A8** `pnpm test`, `pnpm typecheck`, `pnpm lint` green.

## Risks

- **The availability-count subtlety is easy to get wrong and invisible when wrong** — a biased bandit
  still plays legal, plausible moves and still beats random. D-A1's ≥ 60 % over *greedy* is the only gate
  that would notice; a weaker bar would let a broken search through.
- **Search depth vs. the ability agenda.** C2 made triggers cascade. A node created mid-cascade would
  search a position the player never actually chooses at (D-2).
- **Time.** Greedy is ~0.3 ms/decision; ISMCTS at a useful budget will be orders of magnitude more. That
  is affordable headless and is precisely why the browser half is a separate rung.
- **Determinisation cost.** One `determinise()` per iteration, each `structuredClone`-ing a full state, may
  dominate the budget. If so, the fix is to sample fewer worlds and reuse each across several iterations —
  a documented deviation from pure ISMCTS, and one to measure before adopting rather than assume.
