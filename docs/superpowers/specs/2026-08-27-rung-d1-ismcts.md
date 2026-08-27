# Rung D1 — ISMCTS: a search-based opponent, headless

> Revision 2 (2026-08-27), after a Codex plan-review that found four blockers. Changelog at the end; the
> review is `docs/superpowers/plans/2026-08-27-rung-d1-ismcts.codex-review.md`. **Two of revision 1's
> blockers would have produced a search that looked fine and was silently broken**, which is the failure
> mode this rung is most exposed to.

## Context

The standing mandate names the AI progression: **heuristic then ISMCTS**. `GreedyAgent` is merged and
beats `RandomAgent` 200/0. Rung A built `determinise()` and `evaluate()` *for this rung*; C2 added
`resolveForcedDecisions`. This rung is **headless only** — the browser half needs a Web Worker and is D2,
but D1 must define the worker-safe seam so D2 does not rewrite the search core.

## Decisions

| # | Decision | Ruling (and why) |
|---|---|---|
| D-1 | **SO-ISMCTS**, tree keyed on the root player's information set | Nodes are `(parent history, ActionKey, ObservationKey)`. No state transpositions initially. |
| D-2 | **Node identity is semantic, never by `CardId`** | This is the crux of the rung. `Command` embeds `CardId` throughout, and each determinisation assigns fresh sequential synthetic ids — so the same numeric id can mean **different cards in different worlds** (false matches) and the same semantic card can get **different ids** (false splits). `ActionKey` encodes: public zone + position for field and Break-Zone cards; **card code + occurrence** for private-hand casts and discards; normalised (sorted) sets for attackers, payments, targets and assignments. `ObservationKey` is a canonical `PlayerView` digest with every id — including in `attack`, `pending` and `resolution` — replaced by a canonical reference. Keys are decoded against the *current* determinisation; the real root `Command` is what gets returned. |
| D-3 | **Every `Pending` is a tree ply, whoever owns it** | Revision 1 said nodes exist only where `pending === null`, draining forced decisions first. That is backwards and dangerous: blocks, party-damage splits and ability mode/target prompts are genuine player decisions, and **at the search root, draining would have had `greedyStep` consume the very command `decide` was called to choose**. `settle()` already runs all system-only work to idle-or-prompt, so the state `apply` returns *is* the next decision boundary. Determinisation chooses hidden cards and deck order — **never a player action**. Greedy answers prompts only *past the expansion frontier*, in rollout. |
| D-4 | **UCB1 with availability, stated exactly** | `UCB(s,a) = mean(s,a) + C · sqrt( log A(s,a) / N(s,a) )`, where `N` is times selected and `A` is visits to `s` on which that canonical action was present in `candidateCommands`. **Availability is incremented for every compatible sibling on backpropagation**, not just the selected one; `N`/`W` only along the selected path. Revision 1 said "divide by availability", which is simply wrong — availability replaces the parent-visit count *inside the logarithm*. A win-rate gate cannot detect this being wrong, so it gets a deterministic toy test with one always-available and one rarely-available action. |
| D-5 | **Bounded, actor-aware rewards** | `evaluate` returns ±100,000 at terminals on an arbitrary material scale; with `C ≈ 1` one terminal rollout swamps exploration. Backpropagate a **bounded root reward**: terminal `1/0/½`, and `tanh(evaluate / scale)` at the depth cap. At root-controlled nodes maximise the mean; at **opponent-controlled nodes maximise its negation** — otherwise the search builds a cooperative opponent. `C`, the expansion rule, the final root choice (**highest visit count**) and tie-breaking are all specified, not left to the implementation. |
| D-6 | **Rollouts are greedy and hard-bounded** | `greedyStep` for both players past the frontier, with an explicit **cap on rollout commands**, not just a depth description — ability cascades make "depth" a poor proxy for work. Then `evaluate`. |
| D-7 | **A pure, serialisable search core** | `searchIsmcts(input): { command, diagnostics }` — synchronous, no callbacks, no timing dependencies, inputs and results structured-cloneable — plus a thin stateful `IsmctsAgent` wrapper implementing `Agent`. The D2 worker protocol is **defined now**: one-time init for decks and definitions, then `{ requestId, view, seed/decisionIndex, iterations }` requests with generation-checked results. D2 then owns cancellation and React changes only. |
| D-8 | **Determinism comes from bookkeeping, not the RNG** | The engine RNG is already explicit. The real risks are child insertion order depending on the first determinisation, object-reference keys, floating UCB ties, and `Map` insertion order. Rebuild the tree per `decide`; canonical string keys with a **total** comparator; **separate RNG streams** for world sampling, expansion and tie-breaking. |
| D-9 | **Fairness is a non-interference contract** | Not "simulations never inspect hidden cards" — they necessarily do, that is what a determinisation is. The requirement is that **every simulated state derives only from `PlayerView` + the two declared deck lists**, never from the live `GameState`. No search entry point may accept a `GameState`. Deck lists are semantically a **multiset**, so copy and sort before sampling — `determinise` currently preserves caller array order. |
| D-10 | Not in scope | The browser (D2), learned weights or an opening book, and any change to `evaluate`'s weights. |

## Acceptance criteria

- **D-A1 (strength)** **200 held-out seed pairs = 400 games**, roles swapped on each identical game seed.
  Draws score ½; a harness failure counts as a loss. Require **point score ≥ 55 %** with a paired-bootstrap
  95 % lower bound above 50 %, reported per seat. Revision 1's "≥ 60 % over 200 games, both seats" was
  statistically fine (Wilson 53.0–66.6 %) but methodologically weak: the harness pins agents to seats for a
  whole run, and the existing "both seats" test uses *different seed ranges* rather than mirrored games.
  The iteration budget is calibrated on **separate development seeds** and reported on the held-out ones.
- **D-A2 (correctness, where the real risk is)** Targeted unit tests, because **a tournament gate cannot
  detect a broken bandit** — a biased search still plays legal, plausible moves and still beats random:
  - canonical keys: same numeric id / different card code across worlds must **not** match; same semantic
    action / different id **must** match;
  - availability counters, on the deterministic toy bandit;
  - opponent nodes minimise the root's reward;
  - a node exists for every `Pending` kind, with the expected owner;
  - rollouts respect the command cap;
  - fairness (D-9): two live states with identical `PlayerView` and deck multisets but different hidden
    hands, deck order and live RNG must produce identical traces.
- **D-A3 (determinism)** Two fresh same-seed agents over an identical full view trace produce identical
  commands and identical non-timing diagnostics.
- **D-A4 (cost)** Counters for determinisations, tree applies, rollout applies, evaluations, nodes and max
  command depth, reported by the CLI — so D2 picks a browser budget from measurement.
- **D-A5 (no regression)** A **smoke** run against `RandomAgent`, not a 200-game gate: greedy already wins
  200/0 and the search reuses its policy and evaluation, so the large random tournament buys almost nothing.
- **D-A6** Strict fuzzer passes with `ismcts` on both seats. `pnpm test`, `pnpm typecheck`, `pnpm lint` green.

## Cost, measured rather than assumed

Codex profiled this codebase: **~107 µs per `determinise()`, of which ~103 µs is the final
`structuredClone`**; isolated `apply` and `evaluate` are **under 1 µs**. Revision 1's premise that "apply
clones on every command" was wrong — `apply` does immutable structural updates. So:

- shallow iterations are **determinisation-bound** (~107 ms floor for 1000 iterations);
- deep greedy rollouts become dominated by repeated candidate generation and `apply` instead.

**Order of work:** add the counters, profile, then narrow or remove the redundant final clone in
`determinise` (build alias-free arrays while sharing readonly definitions). **Only then** consider world
reuse — and it is *not* the default. Reusing `K` worlds searches the empirical distribution of those
worlds; with `K = 1` it degenerates toward perfect-information UCT, and small `K` leaves availability
estimates biased no matter how many iterations run. If adopted: round-robin over `K`, `K` growing with the
budget, benchmarked at `K = {1, 8, 32, iterations}` at equal wall time, reporting strength **and**
action-availability coverage.

## Risks

- **Every blocker in this rung is invisible to a win-rate gate.** A wrongly-keyed tree, a mis-incremented
  availability counter, a cooperative opponent node — each still produces legal, plausible play that beats
  random. This is why D-A2 exists and why D-A1 alone is not sufficient evidence.
- **The root prompt trap.** `decide` is frequently called *while a `Pending` is outstanding*. Any code path
  that "drains" before searching answers the question it was asked.
- **Determinisation cost may force a design change**; measure before adopting one.

## Changelog vs revision 1

- **Node identity is semantic** (D-2). Raw `Command`/move-sequence keys are unsound across determinisations.
- **Every `Pending` is a tree ply** (D-3), replacing revision 1's "nodes only where `pending === null`",
  which would have had the rollout policy consume the root decision.
- **The UCB formula is stated correctly** (D-4) — revision 1's "divide by availability" was wrong.
- **Rewards bounded and actor-aware** (D-5); revision 1 left opponent nodes and reward scale unspecified.
- **A pure serialisable search seam is defined now** (D-7) so D2 does not rewrite the core.
- **Fairness restated as non-interference** (D-9), plus sorting the declared deck multiset.
- **Gate is 200 mirrored seed pairs at ≥ 55 % with a confidence bound** (D-A1), not 60 % over 200 fixed-seat
  games; correctness moves into targeted unit tests (D-A2), and the random tournament shrinks to a smoke run.
- **Cost section replaced with measurements**, and world reuse demoted from "fallback" to "benchmark first".
