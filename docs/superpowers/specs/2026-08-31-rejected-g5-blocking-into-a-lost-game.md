# Rejected — G5: "the AI declines a block and dies"

> **STATUS: REJECTED at the gate, before any code was written.** Recorded because the symptom is alarming, the
> explanation is not obvious, and the next person to notice it will want to fix it. F2 cost a rung by
> rebuilding something already rejected; this file exists so that does not happen here.

## What it looks like

Play greedy against greedy and count the block decisions. Over 40 seeded games:

| | |
|---|---|
| block decisions | 524 |
| declined **with a blocker available** | 76 |
| …and lost the game on that very damage | 11 |
| …where a block would have avoided losing **at that instant** | **11 — all of them** |

Eleven games in forty end with the AI at six damage, holding an untapped Forward, watching an attack go
through. It reads exactly like the AI failing to see lethal.

## Why it is not a blunder

The scores at one such decision — seed 3, P0 at 6/7, one attacker, one legal blocker:

```
block=none     score -100000.0
block=21       score -100000.0
```

An exact tie at `-weights.terminal`. Both candidates lose, so `better()` falls through score and `fizzled` to
candidate order, and `legalCommands` lists the no-block answer first.

The tie is **honest**, which is the part I had to check rather than assume. Applying each answer and rolling
out to the end of that same turn:

```
block=none   immediately: LOST   | end of turn: winner 1 (damage)
block=21     immediately: alive  | end of turn: winner 1 (damage)
```

Blocking saves that point and the attacker simply declares another attack with another Forward. P0 reaches
seven either way, inside the same turn. The AI is not failing to see lethal; it is correctly seeing that
lethal arrives regardless.

## The gate: does blocking anyway ever save the game?

That is the whole question, and it is cheap to answer without an A/B — replay the same seeds, forcing the
block wherever the AI would have declined into immediate death, and compare who won.

**120 seeds. 32 games affected. The winner changed in 0 of them.**

A tie-break preferring "still alive" would therefore change the AI's visible behaviour in a quarter of all
games and change the outcome of none. That is not worth a rung, and shipping it would have looked like an
improvement while being measurably nothing.

## What would change this

- **A perception argument, not a strength one.** A human watching the AI concede a point it could have blocked
  will judge it, whatever the arithmetic says. If the goal becomes "the AI should look competent" rather than
  "the AI should win more", this is the cheapest thing on the list — it is a two-line lexicographic tie-break
  after `score` and `fizzled`, and by the evaluation's own measure it cannot cost anything, because it only
  ever fires between candidates that already scored identically.
- **A pool with fewer attackers.** The result depends on the attacker having a second Forward to finish with.
  A deck where the follow-up is rarer would move the 0.
- ~~**The ISMCTS agent**, which was not measured here.~~ **Now measured, and it settles the question the other
  way: the shipping opponent never does this at all.** Twelve games at the shipping 200 iterations, search on
  seat 0 against greedy on seat 1 (214 s):

  | | |
  |---|---|
  | block decisions by the search | 85 |
  | **fatal declines** (a block existed that avoided losing on the spot) | **0** |
  | winning attacks available to the search | 6 |
  | …not taken | 0 |

  So the alarming behaviour is greedy's alone. The search reaches the same positions and blocks. That is worth
  knowing for two reasons: the browser opponent — which is the search — never shows a player the thing that
  looks like a blunder, and greedy's indifference is confined to rollouts and the worker-failure fallback,
  where it costs nothing measurable (0 of 32 games, above).

  Sample sizes, stated because they differ a lot: 85 block decisions is a solid basis for the 0; **6** lethal
  opportunities is not, and that half is corroborated by the greedy corpus (60 of 60) rather than standing
  alone.

## Method

`GreedyAgent({ depth: 1 })` on both seats, `decks/starter-2025-vol2.txt`, seeds 1–120, one agent instance per
game. A "fatal decline" is: the pending is `declareBlock`, the agent answers `blocker: null`, applying that
answer sets `result` against the deciding player, and some legal blocking answer would not have. Forcing takes
the first such blocker.
