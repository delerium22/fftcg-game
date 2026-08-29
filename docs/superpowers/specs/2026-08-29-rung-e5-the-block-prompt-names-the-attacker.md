# Rung E5 — the block prompt names the attacker

> **STATUS: SPEC, awaiting plan review.** Nothing built. Third sibling of
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
