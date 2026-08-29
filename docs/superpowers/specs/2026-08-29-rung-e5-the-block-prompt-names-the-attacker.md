# Rung E5 — the block prompt names the attacker

> **STATUS: REFUSED as written, narrowly; rewritten below and cleared to build.** The design is sound; the
> acceptance was not, and my statement of the party-damage rule was backwards. Read *Plan review outcome*
> first. Third sibling of
> [E3](2026-08-29-rung-e3-the-browser-shows-what-a-card-does.md) and
> [E4](2026-08-29-rung-e4-the-browser-says-what-a-cast-will-cost.md) — all three are the browser hiding
> something the player needs at the moment of a decision, all three found by playing.

## Why

Turn 2. The AI cast Lightning off four discards, broke my Luso with its ETB, gave itself Haste off the
resulting trigger, and swung. The browser said, in full:

```
Choose a blocker
  [ Don't block ]  [ Concede ]
```

Blocking *what*? The prompt names no attacker, no power, and no consequence. In this particular position it
did not matter — Luso was dead, so I had no Forwards and no real choice — but the same string is what a
player sees when they *do* have blockers and must decide whether to trade a Forward for one point of damage.
To answer that they need to know which Forward is attacking and how hard it hits. The prompt tells them
neither, and the attacker is on the opponent's side of the board where the eye is not already resting.

What makes this one clear-cut rather than a judgement call is that **the code documents the principle it
violates, four lines below the offending string**:

```ts
case 'declareBlock': return 'Choose a blocker'
case 'assignPartyDamage': return 'Assign combat damage'
// Both ability prompts name the card that is asking and what the choice is FOR — "choose 2 targets" tells
// the player nothing they can act on. The wording is derived from the clause's own AST, never hard-coded.
case 'chooseTargets': { … }
```

`chooseTargets` earned that comment in rung C1. `declareBlock` is the same problem, one case earlier in the
same switch, and it kept the hard-coded string.

## What this rung is

Derive the block prompt from `view.attack`, which already carries `attackers`, and from the same
`effectivePower` authority the board renders from (spec C1-7). Roughly:

> *Lightning attacks for 9000 — block, or take 1 damage.*

Three facts, each one the player would otherwise have to go and find: **who** is attacking, **how hard**,
and **what happens if you don't**. The third matters most for a new player and is the one no amount of
hovering reveals.

A party attack has several attackers, so the wording must handle more than one without inventing a
false total — party damage is assigned per attacker (there is an `assignPartyDamage` pending for exactly
that), so summing their powers into one number would be a lie.

## What this rung is NOT

- **Not a change to the block BUTTONS.** `Block with X` already names the blocker and is right.
- **Not the `assignPartyDamage` prompt** ("Assign combat damage"), which has the same smell and should be
  looked at, but is a different pending with different data. One rung, one prompt.
- Not a new power authority. `effectivePower` via the board's existing display path, or nothing.

## Open question for the plan review

Should the prompt say "take 1 damage"? It is true today, but it is a RULES fact being restated in UI prose,
and if a future card changes what an unblocked attack does, this string becomes a quiet lie with no test
watching it. The alternative is to name only the attacker and its power and leave the consequence to the
player. My inclination is to include it *only if* it can be derived rather than written — and I do not yet
know that it can be.

## Acceptance

- **E5-A1** With one attacker, the prompt names that attacker and its effective power, asserted against a
  hand-written string from a real position reached by playing the engine, not a hand-built pending.
- **E5-A2** The power is the EFFECTIVE power, not the printed one. Pinned on a pumped attacker, where the
  two differ — otherwise the assertion passes on either and the C1-7 authority is not actually being used.
- **E5-A3** With a party of two attackers, both are named and no false combined total is printed.
- **E5-A4** The prompt still renders when the attacker somehow cannot be resolved, rather than throwing —
  reached, not hypothesised, or else stated as defensive-only.
- **E5-A5** Existing web tests pass with no expectation edited.
- **E5-A6** Full gates green. No selfplay gate: this is UI prose and 200 games cannot see it.

## Mutation plan

- Print the printed power instead of the effective power → A2 must fail.
- Name only the first attacker of a party → A3 must fail.
- Revert to the hard-coded `'Choose a blocker'` → A1 must fail.
- Sum a party's powers into one number → A3 must fail.

---

## Plan review outcome — refused narrowly; the design survives, my rules claim did not

### MAJOR 2 — I stated the party-damage rule backwards

I wrote that "party damage is assigned per attacker, so summing their powers into one number would be a lie."
That is not the rule and not what the engine does. Under CR 3.3 §10.1.4.2–2.1 each attacking Forward deals
**its own** power to the blocker, and the **blocker** assigns *its* damage among the party. The engine agrees
— `legalPartyDamageAssignments` splits `powerOf(blocker)` across `at.attackers`, verified.

So the attackers' summed power *is* a truthful total of what the blocker receives. It is still the wrong
thing to print, but for a different reason than I gave: it hides the individual sources, and it invites
confusion with the single point of damage an unblocked attack deals the player. The wording is therefore:

> Choose a blocker for Luso (power 5000) and Lightning (power 9000)

### MAJOR 1 — A3 could pass while the powers stayed hidden

"Both are named and no false total is printed" is satisfied by *"Choose a blocker for Luso and Lightning"* —
which hides exactly the number the decision turns on. A3 now demands a hand-written COMPLETE party string
carrying each attacker's individual effective power, with exactly one member pumped so that printed power,
the two individual effective powers, and their sum are all distinct.

### MAJOR 3 — "effective power" needed a damaged attacker, not just a pumped one

A2 as written distinguishes printed from pumped, and nothing more. It does not kill a mutant reporting
`effectivePower − damage`. That mutant is unusually tempting here because `Card` already computes and shows a
"remaining" number on the card face — while marked damage does **not** reduce a Forward's power or the
combat damage it deals. Added: a damaged-but-surviving attacker whose prompt must still report full effective
power. (Whether the card face's "remaining" wording is itself a defect is a separate question; not absorbed
into this rung.)

### MINOR — A4 is defensive-only and must say so

A `declareBlock` position is created immediately from attackers just validated, and there is no implemented
priority window in which one could leave. So an unresolvable attacker is not reachable in play today. The
fallback stays; the criterion is labelled a defensive unit case rather than pretending to reach a position
that does not exist.

## Open question — ruled: do NOT say "take 1 damage"

I asked rather than assumed, and the answer was the conservative one. It is a CR *default*, not something
derived from any consequence authority in the engine or UI, and card text takes precedence over general
rules. Hard-coding it manufactures exactly the quiet future lie the question anticipated. The attacker's
identity and effective power fix the reported defect on their own, and the existing "Don't block" button
already states the alternative.

## Revised acceptance

- **E5-A1** One attacker: the prompt names it and its effective power, from a position reached by playing.
- **E5-A2** The power is EFFECTIVE, pinned on both a pumped attacker and a **damaged but surviving** one —
  the damaged case is what kills `effectivePower − damage`.
- **E5-A3** A party of two: a complete hand-written string carrying BOTH names and BOTH individual powers,
  with one member pumped so printed, individual and summed values are all distinct. No combined total.
- **E5-A4** Defensive unit case only: an unresolvable attacker renders rather than throwing, labelled as
  unreachable in play today.
- **E5-A5** Existing web tests pass with no expectation edited. Full gates green. No selfplay gate.
