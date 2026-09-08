# Rung K1 — the defender's party-damage assignment: candidates that break something

> **STATUS: BUILT, 2026-09-08.** Found by playing (seed 8, turn 6): the AI blocked a Cloud + Shantotto party
> with Billy Bob and assigned all 8000 of his damage to Cloud, who could not be broken that turn, instead of
> breaking Shantotto. The user was away; the design call is mine, recorded here to overturn.

## The problem

`candidateCommands` hands the search EVERY legal split (`legalPartyDamageAssignments`): a blocker of 8000
power over a party of two is nine assignments in 1000-steps. At the browser's budget (500 ms, at least 64
iterations) each root child gets ~15 visits, and the rollout means sit within noise of each other (0.62–0.73
in the position above), so the pick is a coin toss over nine options of which only two break a Forward.
Measured on the real position (`apps/cli/test/party-damage.test.ts`, K1-A2): ISMCTS broke Shantotto 3 times
in 10 seeds; greedy 9 in 10. In a vanilla position with no abilities the gap between children is wide enough
and the search finds the break 10/10 — the noise comes from the real cards' rollouts, not from the split
itself. Attacks and targets are already pruned to a few shaped candidates (C5, C1); the split was not.

## Design

- **K1-D1 — the shape of a good assignment is static.** For each legal split, score `broken` = Σ `cardValue`
  of the attackers it breaks (damage so far + assigned ≥ effective power, and not `cannotBeBroken`, the same
  test §12.4.5 runs in `pendingBreakTransitions`), and `wasted` = damage dealt beyond a break or to a Forward
  that cannot be broken. Rank by `broken` descending, then `wasted` ascending, then enumeration order.
- **K1-D2 — the candidates.** The best-ranked split, plus every CONCENTRATION (the whole amount on one
  attacker, the shape a follow-up "deal it 3000 damage" or Luso's "when Luso deals damage to a Forward, break
  it" can finish) that breaks as much as the best does — or every concentration when nothing breaks at all.
  Deduplicated. So a two-Forward party with one breakable member offers exactly one answer: measured with
  the concentrations always included, the search at 64 iterations still put the damage on the unbreakable
  Forward 2 times in 10, because the rollouts price the broken 7000 Forward at only 0.02–0.07 of reward
  (a weak signal worth its own look — see the backlog note). A choice the position has already made is not
  given to the search to un-make.
- **K1-D3 — the engine is unchanged**: `legalCommands` still lists every split (capped, J7-D2), `isLegal`
  still accepts any; only the AI's own candidate policy narrows. Greedy prices fewer candidates, so it gets
  faster and no weaker (it already found the break 9/10).

## Acceptance

- **K1-A1** A 7000 blocker over a 7000 (`cannotBeBroken`) + 7000 party: the one candidate is the whole 7000
  on the attacker it breaks; no split, and not the concentration on the protected one.
- **K1-A2** The seed-8 position with the real cards, ISMCTS at 64 iterations (the browser's floor, fixed so the test is deterministic) over 10 seeds: the
  assignment breaks Shantotto in at least 9.
- **K1-A3** Every candidate is `isLegal` (the decoder-legality property already walks candidates).
- **Gates** typecheck, lint, unit; the frozen corpus (greedy's candidate list changed only where a party is
  blocked — regenerate if it diverges and say so in the commit).

## Backlog note

The rollout reward barely moves when a 7000 Forward is broken (0.65 vs 0.67 at the root, 30 visits each).
Either the horizon ends before the broken Forward's absence costs anything, or `material` undervalues a
Forward next to damage points. Not this rung's problem — K1 removes the noisy choice — but it bounds how
much any low-iteration search can see, and it is where a strength rung after K1 should look first.
