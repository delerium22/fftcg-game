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
A choice-free effect applied at the moment the choice is fixed lands in exactly the position the CR puts
it — before the choosing ability continues — with no agenda involvement at all.

So this rung implements the CLAUSE, not the mechanism. That is a real limitation and the spec says so
below rather than letting a future reader assume preemption exists.

## Design

`AbilityTrigger` gains `observesChosen`, alongside the existing `observesZoneChange` / `observesEnterField`.
It is declarative like the others — the AST says what the card says, and the per-clause coverage counter
picks it up — but it is DISPATCHED INLINE rather than through the resolution agenda.

There are exactly two places in the engine where a target becomes fixed, and the hook belongs at both:

1. `applyChooseTargets` (`resolve.ts`) — a prompt the player answered.
2. `applyActivateAbility` (`activate.ts`) — an activated ability whose targets are DECLARED with the
   command (spec C3-1), which never passes through the prompt path at all.

Missing the second is the obvious bug here, and it is invisible from the card's own tests: Prishe pumped by
a Summon would work while Prishe pumped by an activated ability silently would not. One shared helper,
called from both, and a test that drives each route.

**Not** hooked: `onSubject`, which binds a trigger event's subject (Luso's "break **it**"). That is not a
choice — the printed text names it — and treating it as one would fire Prishe on effects that never
targeted her.

## What this deliberately does NOT implement

General agenda preemption. Any future "when chosen" clause whose effect can raise a prompt — "when chosen,
choose a Forward and dull it" — still needs the mechanism C2-13 described, because an inline application
has nowhere to suspend to. The `MVP0-SIMPLIFICATION` marker says exactly that, so the next person meets the
limit at the point where it binds rather than discovering it from a wrong answer.

## Acceptance

- **C11-A1** The ordering, which is the card: a 5000 Prishe chosen by a Summon dealing 5000 damage
  SURVIVES at 7000. The same test with the clause removed kills her — the assertion is the survival, not
  the power number.
- **C11-A2** Fires on BOTH routes: an ability answering a `chooseTargets` prompt, and an activated ability
  with declared targets. The second is the one that would silently not work.
- **C11-A3** Does NOT fire when Prishe was not chosen: an untargeted `forEach` that hits her, an
  `onSubject` effect, and an ability that chose a DIFFERENT Forward.
- **C11-A4** Fires once per choosing, and stacks across separate choosings within a turn (+2000, then
  +4000), expiring at end of turn with every other until-end-of-turn effect.
- **C11-A5** The log says why her power changed; a silent +2000 is the thing the amber warnings exist to
  prevent.
- **C11-A6** Coverage: `22-068R` reports 2 of 2 implemented clauses and stops warning.

Every criterion verified by mutation.
