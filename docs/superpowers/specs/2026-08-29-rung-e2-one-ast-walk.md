# Rung E2 — one AST walk

> **STATUS: BUILT.** This is the second, independent half of the E1 plan review's *What to do instead*.
> The first half (a line above the terminal menu saying what is being asked) shipped earlier.

## Why

The E1 plan review found **three** copies of the same program-counter walk, not the two I had counted:

| copy | package | drives |
|---|---|---|
| `effectAt` (private) | `packages/engine/src/resolve.ts` | the authority — `apply` re-derives candidates from it |
| `nodeAt` | `apps/web/src/game/commands.ts` | button and prompt WORDING |
| `effectAt` | `packages/ai/src/candidates.ts` | MOVE QUALITY |

All three were behaviourally identical, so nothing was broken. Each carried a comment explaining why it was
duplicating the others — the engine keeps its copy private on purpose, being the thing `apply` re-validates
against, and both consumers wrote "the cost of drift is bounded" in slightly different words.

The bound is real but it is not the interesting part. What makes this worth removing is that **the failure
mode has no alarm on it**. If the AI's copy drifted, the engine would keep re-deriving candidates from its
own copy, so every game would stay legal, every test would stay green, and the only symptom would be the AI
quietly playing worse. That is the exact shape of defect this session has been finding by playing rather
than by gating, and here it can be deleted outright instead of tested for.

Duplication has also been the root of this session's recurring wording bugs — two `name()` implementations,
three statements of the win rate, five hand-composed possessives. Same disease.

## What changed

One exported `effectAtPath(effects, path, modes)` in `packages/engine/src/abilities.ts` — the pure-AST
module, beside the `Effect` union it walks, not in `resolve.ts` where it would drag the resolution engine
into the browser's import graph. `depth` is now an internal detail of the closure rather than a parameter
every caller had to pass `0` for.

All three copies deleted; four call sites now go through it (engine `suspendedNode`, AI `suspendedEffect`,
web `targetVerb`).

## What deliberately did NOT move

`targetVerb`'s heuristic whole-AST fallback stays in the browser. When the counter cannot be followed it
scans for a `chooseTargets` whose `min`/`max` match the pending, and speaks only if exactly one matches.
That is a reasonable thing for a **label** to do and an unacceptable thing for the **engine** to do:
engine validation must reject an invalid program counter, not guess at one. Keeping the guess out of the
shared helper is what lets the helper be pure and total.

## Acceptance

- **E2-A1** One implementation; `grep` finds no other walk over `path`/`modes`. ✅
- **E2-A2** A test pins the two-level `chooseModes` step against HAND-WRITTEN expectations — the step every
  one of the three comments singled out, and the one a re-implementation gets wrong. ✅
  `packages/engine/test/effect-at-path.test.ts`
- **E2-A3** The three consumers are shown to actually route through it, not merely to call the same
  function. Verified by mutation, per copy, because "calls the same function" is not "covers that call
  site" — a lesson from an earlier review this session. ✅
- **E2-A4** No behaviour change anywhere: full gates green and `selfplay --games 200 --seed 1` 200/200. ✅
  The mirror benchmark **corroborates but does not strictly reproduce** the recorded figure, and the reason
  is worth writing down. I ran `mirror --games 120 --seed 1 --iterations 200` expecting the README's
  120-game measurement. `mirror` has no `--games` flag — it counts in `--pairs`, each pair being one seed
  played twice with the seats swapped — so the flag was silently ignored and the default 200 pairs ran
  instead: **400 games, `pointScore` 0.7475, CI95 [70.25, 79.25]**. The README's 75.0 % sits comfortably
  inside that interval, and 400 games is the tighter measurement, but it is a different sample from a
  different configuration and calling it a reproduction would be false precision.

  What actually carries E2 is the code and the mutations: three implementations that were identical by
  inspection, 44 tests across five packages that fail if the walk breaks, and a deterministic
  `selfplay --seed 1` that is unchanged. The tournament is corroboration, not the proof.

  The silently-ignored flag was itself a defect and is now fixed — see `apps/cli/src/flags.ts`.

## Mutations run

| mutation | result |
|---|---|
| `chooseModes` consumes one counter level instead of two | 3 of 3 new tests fail |
| always take `modes[0]`, ignoring the recorded choice | 2 of 3 fail, with the branch named in the diff |
| the walk gives up on any nested counter | 44 tests fail across engine, cards, cli, ai AND web |
| the web call site loses its exact node, keeping only the fallback | the Shantotto/Ramuh nested-mode test fails |

The last one matters on its own: the third mutation does not prove the browser's call site, because
`targetVerb`'s fallback scan rescues it. Only a mutation aimed at that call site shows it is covered.
