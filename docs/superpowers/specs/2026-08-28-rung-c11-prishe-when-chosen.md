# Rung C11 — Prishe's "when chosen", without building agenda preemption

**Card:** 22-068R Prishe (Earth Forward, cost 2, 5000), clause 1.

> When Prishe is chosen by a Summon or an ability, Prishe gains +2000 power until the end of the turn.

The last clause in the pool blocked on a missing MECHANIC rather than on being a no-op. Landing it takes
coverage to 27 of 28; the only remainder is then Sphene's static, which provably does nothing in this pool
(nothing removes an opponent's card).

## Why it was deferred, and why that reasoning no longer applies

C2-13 deferred it because it "needs the agenda to **preempt an active frame**, which it cannot do; targets
are chosen while a frame is already executing". That is the right diagnosis of the ORDERING problem and the
wrong conclusion about the cost.

The ordering matters and is the whole point of the card: a Summon that chooses a 5000 Prishe and deals 5000
damage kills it, unless the +2000 lands FIRST. Get that wrong and the clause is not partially implemented,
it is wrong.

But general preemption — pausing a running frame, resolving another to completion, resuming — is only
needed when the preempting effect can itself SUSPEND. Prishe's cannot. Its entire effect is
`+2000 powerBonus until end of turn`: no target, no mode, no deck look, nothing that can raise a prompt.
A choice-free effect can therefore be applied at the moment the choice is fixed, with no agenda involvement
at all, and it lands before the choosing ability continues — which is the ordering the card turns on.

That is NOT the same as being CR-exact, and an earlier draft of this spec wrongly claimed it was. The plan
review found a reachable case in this very deck where the order still differs; it is stated precisely under
*MVP0-SIMPLIFICATION* below, and it is why this rung implements the CLAUSE rather than the mechanism.

## Design

*Revised after a Codex plan review, which found two blockers. Both are recorded here because they changed
the design, and one of them falsified a claim this spec originally made.*

`AbilityTrigger` gains `observesChosen`, alongside `observesZoneChange` / `observesEnterField`. It is
declarative like the others, and the per-clause coverage counter picks it up.

### It runs the AST — it does not hand-write the effect

> **Plan review, blocker 2.** The first draft said "dispatched inline" and left it there. That is not a
> design: `addPower` acts on `ctx.chosen`, and `enqueueTrigger` builds frames with `chosen: []`, so nothing
> would have bound Prishe to her own pump. Writing `powerBonus += 2000` by hand instead would duplicate the
> engine's single power-modification authority and make the AST decorative — the card would say one thing
> and the code do another, which is the exact failure the AST exists to prevent.

So the helper executes the matching ability through the REAL effect executor with the chosen card bound as
`chosen`, and **rejects any effect shape that could suspend**. A `chooseTargets`, `chooseModes` or
`lookAtDeck` under an `observesChosen` trigger is a spec error and fails loudly, because an inline
application has nowhere to suspend to.

### Both places a target becomes fixed

1. `applyChooseTargets` (`resolve.ts`) — a prompt the player answered.
2. `applyActivateAbility` (`activate.ts`) — declared targets, which never touch the prompt path.

The review confirmed these are the only two: `chooseMode` selects branches whose nested targets still reach
`applyChooseTargets`; `chooseFromDeck` commits indices, not "choose" targets; a single legal candidate is
NOT auto-selected; and the search reaches `apply` like everything else.

**Not** hooked: `onSubject` and `forEach`, which bind a card the printed text names rather than one anybody
chose. The review confirmed that reading.

## MVP0-SIMPLIFICATION: the ordering is not CR-exact, and here is exactly where

> **Plan review, blocker 1**, which falsified this spec's original claim that inline gives "exactly the CR
> ordering". It does not, and the counterexample is in this deck.

Ramuh can deal lethal damage in one selected mode and raise another target prompt in the SAME frame, and
this engine deliberately leaves the lethally damaged Forward on the field until that frame finishes. If the
second choice takes Prishe, then:

- inline gives **pump → Ramuh continues → §12.4.5 break**
- a real preempting frame gives **break → then Ramuh continues**

`powerModified` and `broken` come out in the opposite order, and a Lightning watching that break sees a
different agenda. The outcome can differ, not just the log.

This ships anyway, marked, because **the engine has no stack at all** — every ability already resolves
immediately, which is a far larger documented deviation than this one, and the same class. What is NOT
acceptable is an unmarked deviation, so the marker names Ramuh specifically rather than gesturing at
"ordering may differ".

Also deferred, explicitly, as C8 deferred its equivalent: the AI's target heuristic prices 5000 damage
against a 5000 Prishe as lethal and does not know about the +2000 that will land first. `apply` simulates
the chosen candidate correctly, so the search is not wrong — its candidate RANKING is.

## Acceptance

- **C11-A1** The ordering that is the card: a 5000 Prishe chosen by a Summon dealing 5000 damage SURVIVES
  at 7000. The assertion is survival, not the power number.
- **C11-A2** Fires on BOTH routes — an answered `chooseTargets` prompt, and an activated ability's declared
  targets — and on both **for an OPPONENT's ability too** (plan review 6: several abilities use
  `controller: 'any'`, and a helper scanning only the acting player's field passes every other criterion).
- **C11-A3** Does NOT fire without a choice: an untargeted `forEach`, an `onSubject` effect, or a choice
  that took a different Forward.
- **C11-A4** Cardinality, both directions (plan review 7): Prishe chosen alongside a bystander in ONE
  choice pumps once, not once per target; Prishe chosen in TWO distinct modal target nodes of one Ramuh
  pumps twice. A wrong implementation multiplying by `targets.length` passes A1 alone; one deduplicating
  per frame fails the second.
- **C11-A5** The log says WHY: an `abilityTriggered` for the clause precedes the `powerModified`, since the
  power line alone says what changed and not why (plan review 3).
- **C11-A6** Immutability (plan review 8): the pump does not mutate its input state. An in-place
  `powerBonus += 2000` passes every card-level test while corrupting sibling search branches, so this is
  asserted directly — the pre-command state is unchanged, and a live choice equals the determinised one.
- **C11-A7** Coverage: `22-068R` reports 2 of 2 clauses and stops warning.

Every criterion verified by mutation.
