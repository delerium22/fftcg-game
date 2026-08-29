# Rung F1 — a Backup dulled for nothing

> **STATUS: SPEC, awaiting plan review.** Nothing built. The first AI rung in a while; found by the E11 plan
> review, then characterised and measured here.

## The defect, and its exact mechanism

`preferredPaymentFor` (`packages/ai/src/payment.ts`) builds a payment in three phases: assign the required
elements, greedily top up to the amount, then drop redundant sources. The **element declaration is fixed
before the top-up knows which sources will be spent**, and nothing reconsiders it.

Reached position, seed 6. Ramuh costs 2 and requires one Lightning:

| | payment | score |
|---|---|---|
| chosen | dull **Reeve** (Lightning backup) + discard **Billy Bob as earth** | 12.50 |
| available | discard **Billy Bob as lightning** | 11.50 |

The element phase takes the cheapest source that can supply Lightning — a Backup at cost 1 always beats a
discard at `2 + cardValue` — and commits. The top-up then adds Billy Bob for the remaining CP and declares it
as its own first element, earth. Declaring that same discard as *lightning* would have covered both the amount
and the requirement, alone.

The drop-redundant pass cannot rescue it: dropping Reeve leaves "Billy Bob as earth", which does not satisfy
the Lightning requirement. **The declaration, not the source set, is what is wrong.**

Consequence: a Backup is dulled for nothing, so the AI has one fewer CP source for the rest of the turn.

## Measurement, with its method

- **oracle** — `enumeratePaymentsFor` lists every minimal legal payment; score each by `preferredPaymentFor`'s
  OWN objective (dulled Backup = 1, discard = `2 + cardValue`) and take the minimum. No proxy of mine is
  involved, which is the correction I earned in E11.
- **driver** — seeds 1..10, `GreedyAgent({ seed, decks: DECKS, depth: 1 })` driving both seats; at every state
  and for every card in the acting player's hand with a non-zero requirement and ≥2 legal payments.

| | |
|---|---|
| comparisons | **574** |
| chosen payment beaten on its own objective | **4 (0.7%)** |
| worst gap | **1.00** — exactly one Backup dulled needlessly |
| times the better payment also used fewer sources | **4 of 4** |
| enumeration size | mean **5.1**, max **40** |

**I am not going to oversell this.** 0.7% at a gap of 1.0 will not measurably change who wins a game. What
makes it worth a rung is that it is a heuristic with an exactly computable optimum that it misses for a
identifiable reason, and the fix may well be less code than the bug.

## The tension the plan has to resolve

The obvious fix is to stop being clever: score `enumeratePaymentsFor` and take the minimum. It is exactly
optimal by construction, and would delete all three greedy phases.

**But this is on the hot path.** `candidateCommands` calls `preferredPaymentFor` for every castable card and
every activation, and is itself called once per rollout step by both `GreedyAgent` and the ISMCTS search
(`greedy.ts:371`, `ismcts/search.ts:409`). `candidateCommands` deliberately mirrors `legalCommands`'s switch
rather than deriving from it, precisely so it does NOT enumerate payments — which is the reason
`preferredPaymentFor` exists at all. Enumerating in that loop is exactly what the current design avoids.

So: **mean 5.1 and max 40 say enumeration is cheap in THIS pool**, and say nothing about a larger hand or a
board full of Backups, where the enumeration is combinatorial.

## Options

- **(A) Surgical.** After the top-up, if a required element's assigned source is droppable once some other
  chosen source is re-declared to cover that element, re-declare and drop. Keeps the hot path allocation-free.
  Narrow, and only fixes the failure I have actually observed.
- **(B) Enumerate and minimise**, unconditionally. Exactly optimal, deletes the greedy code, and puts a
  combinatorial enumeration into every rollout step.
- **(C) Hybrid.** Enumerate when the source count is under a cap, fall back to the greedy build above it. Gets
  optimality where it is affordable, but keeps both code paths — the worst of the maintenance burden, and two
  behaviours to test.

**I recommend (B) if and only if it measures clean**, and (A) otherwise — with the decision made by measuring
`msPerDecision` on the existing 200-game selfplay gate rather than by argument. If (B) holds decision time
within noise, the simplification is worth more than the micro-optimisation; the current code is sixty lines of
three-phase greedy reasoning whose comments are mostly about the ways it goes wrong.

I hold this loosely. Every plan review so far has overturned at least one of my judgements, and my instinct
here is biased toward the version that deletes code.

## Acceptance

Each names its anti-vacuity guard.

- **F1-A1** An exhaustive oracle test: over a driven multi-seed run, `preferredPaymentFor`'s result is never
  worse, on its own objective, than the minimum over `enumeratePaymentsFor`. Guard: assert the number of
  comparisons AND that at least one position had ≥2 legal payments, or the run proves nothing.
- **F1-A2** The seed-6 Ramuh position specifically, pinned as a regression: it must choose "discard Billy Bob
  as lightning" and dull nothing. Guard: assert the position still has the shape described (cost 2, requires
  Lightning, a Lightning Backup available), so a drifting fixture fails loudly instead of passing elsewhere.
- **F1-A3** The result remains a MINIMAL payment — one `enumeratePaymentsFor` actually lists — because a
  non-minimal payment is not in `legalCommands` and is therefore unusable as a move. This is an existing
  property; the guard is that it is asserted over the same driven run, not on one fixture.
- **F1-A4** Performance: `msPerDecision` from the 200-game seed-1 selfplay gate, before and after, both
  recorded in the spec. A regression beyond ~2× is a reason to take option (A) instead, and the number is
  reported either way rather than only when it flatters the change.
- **F1-A5** Mutations: return the first enumerated payment rather than the cheapest; score a dulled Backup as
  0; ignore `requiredElements`. Each must fail.
- **F1-A6** Existing tests pass unedited — in particular `packages/ai/test/payment.test.ts`, which pins the
  current behaviour on hand-built positions. **If any of those expectations must change, that is a finding to
  report and not an edit to make quietly.**

## Not in scope

`cardValue` itself. It scores a Forward by power and a Backup by cost, values no abilities, and is the reason
"discard Lightning + Miner" scored cheaper than "discard Noel + Undead Princess" in E11. Improving it is a
different rung with a much harder measurement problem, and conflating the two would make both unfalsifiable.
