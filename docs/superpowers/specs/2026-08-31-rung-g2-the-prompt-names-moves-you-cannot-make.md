# Rung G2 — the prompt names moves you cannot make

> **STATUS: BUILT** — `9ce0fea`. Found by playing the app, which is how E9, E11, F3 and F6 were found too.
> (This line said "Nothing built" for a while after the commit that built it, which a code review caught.)

## What I saw

Turn 1, empty board, nothing castable after spending my only affordable play. The strip said:

> **Main Phase 1 — cast, attack, or pass**

The only buttons were **Pass** and **Concede**. There was nothing to cast and nothing to attack with — Luso had
just entered and had no Haste. A player reads "cast, attack, or pass" and hunts for the cast they were told
they could make.

Then in the Attack Phase, with that same summoning-sick Luso:

> **Attack Phase — declare an attack or pass**

Again: Pass and Concede, nothing else.

## This is the repo's own stated principle, violated one branch below where it is stated

`commands.ts:671`, on the `chooseFromDeck` case:

> *Without this the strip fell through to the PHASE line and told the player to "cast, attack, or pass" while
> the only legal answers were deck picks — a prompt instructing a move the engine would reject.*

That fix made `chooseFromDeck` name its own prompt. It did not touch the phase fallback it was falling through
*to*, and that fallback is a fixed string per phase:

```ts
case 'main1': return 'Main Phase 1 — cast, attack, or pass'
case 'main2': return 'Main Phase 2 — cast or pass'
case 'attack': return v.attack?.step === 'declaration' ? 'Attack Phase — declare an attack or pass' : …
```

Three sentences that describe the *phase*, not the position. The pending-prompt branches above them are all
derived from state; only the fallback is hard-coded, so it is wrong exactly whenever the phase's headline
moves are unavailable — which on an empty or dull board is most of the time.

`main1` is the worst of the three, because it is wrong in a second way as well: **you cannot declare an attack
during Main Phase 1 at all.** Attacks are declared in the Attack Phase, which you reach by passing. So the
prompt names a move that is not merely unavailable in this position but not a Main Phase 1 move in the first
place.

## Design

Derive the fallback from the legal commands the strip is already given, rather than from the phase alone. The
`ChoiceSet` the board renders is built from exactly those commands, so the information is in hand — the prompt
just is not reading it.

Roughly: keep the phase name as the subject, and let the predicate list only the verbs actually on offer,
falling back to "nothing to do but pass" when the only move is `pass`.

The verb list must come from the *commands*, not from a second guess at legality. Recomputing "can I attack?"
independently would be a second implementation of the same rule, and this repo has been bitten by exactly that
divergence before (`preferredPayment` vs `canPay`, `backupElements` vs `def.elements`).

## Acceptance, predeclared

**G2-A1 — no prompt names a verb the position does not offer.** Over a walked corpus (seeds 1–6, greedy
driving both seats, sampled at every state where the human acts), for every state: if the prompt says "cast",
some legal command is a cast; if it says "attack", some legal command is `declareAttack`; if it says "block",
some legal command is `declareBlock`. Counted per verb and per phase, so a fix that repairs `main1` and leaves
`attack` broken cannot pass.

**G2-A2 — and it still names the ones it does offer.** The converse, which is what stops A1 being satisfied by
a prompt that says nothing at all: if a cast is legal the prompt says "cast", and if an attack is legal it says
"attack". Both directions or neither.

**G2-A3 — "attack" never appears in a Main Phase 1 prompt**, because it is not a Main Phase 1 move. Asserted
separately from A1 so it cannot be satisfied by a board that merely happens to have no attackers.

**G2-A4 — the measured before-figure is recorded.** How many sampled states carried a prompt naming an
unavailable verb, before the change. Without it "0 after" is not a result, and this program has twice reported
an after-figure whose before-figure turned out to be wrong.

**G2-A5 — the pending-prompt branches are untouched.** Every existing prompt test still passes. This rung
changes the fallback only; the `chooseFromDeck`, blocker, party-damage and trigger prompts are already derived
from state and are not in scope.
