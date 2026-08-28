# Rung E1 — the terminal says what a choice does

> **STATUS: SPEC, awaiting plan review.** Half of it is already built and committed (the modal wording);
> this specifies the half that moves code between packages, which is the half worth reviewing first.

## Why

Found by playing the hotseat — a mode I had never played until this session, and which has now produced
three defects in two iterations (Enter conceding, Ctrl-D crashing, and this).

Mid-game, at 5 of 7 damage, the terminal offered player 0 exactly this:

```
  0: Target Lightning (27-127S)
  1: Concede
```

`Target` — for what? The opponent had cast something that made P0 choose, and nothing on screen said whether
the target was about to be dulled, damaged, broken or buffed. At 5 damage that choice can lose the game.

The browser has not had this problem since rung C1: `targetVerb` reads the suspended clause off the AST and
labels the button with the effect the click will have — "Dull Cloud", "Give Haste to Cloud", "Give +2000
power and Brave to Cloud". The terminal renders `Target ${names}` unconditionally.

The same was true of modal choices — the terminal printed "Choose mode 1 + 2" while the browser printed the
card's own wording. **That half is already fixed and shipped**: the engine has always carried the printed
labels on the `chooseMode` pending, so the terminal simply had to read them, and no code moved.

## What this rung is

Move the target WORDING into the engine, beside the two functions that already live there for exactly this
reason — `describeAbilityCost` (rung C3) and `describeAbilityEffect` (this session) — and have both
front-ends call it.

```ts
// packages/engine/src/abilities.ts, beside its two siblings
export function describeTargetVerb(view: PlayerView, pending: Extract<Pending, { kind: 'chooseTargets' }>):
  { readonly imperative: string; readonly purpose: string } | null
```

The browser keeps its current behaviour by construction — it is the same function, moved — and the terminal
gains it. Today's split is an accident of history: the wording was written when only the browser existed.

## What this rung is NOT

- **Not a change to any label the browser already shows.** That is the acceptance test: the web suite must
  pass UNCHANGED. If a web expectation has to move, the move was not behaviour-preserving and is wrong.
- Not a rewrite of the terminal's other labels. `Cast X paying: …`, `Attack with …` and the deck-pick
  wording are already shared or already right.
- Not an attempt to make the terminal render like the browser. It stays a numbered menu.

## The move, and what makes it awkward

`targetVerb` is not self-contained. It needs `verbOf` (an `Effect` to an imperative and a purpose), `nodeAt`
(walk `path`/`modes` to the effect node the agenda is suspended on) and `activeAbility` (find the clause on
`defs`). `nodeAt` is already a deliberate duplicate of the engine's private `effectAt`, with a comment saying
so — moving it home removes that duplication rather than adding any.

`verbOf` also feeds the browser's PROMPT ("… to give Haste"), not only its buttons, through `purpose`. Both
halves move together or the prompt breaks.

## Acceptance

- **E1-A1** The web test suite passes with NO expectation changed. Any edit to an existing web assertion is
  a failure of this rung, not a fixture update.
- **E1-A2** The terminal names the effect for every clause in the pool that raises a `chooseTargets`, checked
  against a hand-written table of expected strings — not against whatever the function returns.
- **E1-A3** The terminal still falls back to `Target …` when the clause cannot be read (no agenda frame), and
  a test reaches that state rather than asserting it hypothetically.
- **E1-A4** `nodeAt`'s duplicate disappears: the engine has one implementation, and a test pins that the
  shared one walks a nested `chooseModes → chooseTargets` path, which is where the duplicate earned its
  comment.
- **E1-A5** Full gates green; `selfplay --games 200 --seed 1` still completes 200/200.
