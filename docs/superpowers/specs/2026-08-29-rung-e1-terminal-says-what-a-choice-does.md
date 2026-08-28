# Rung E1 — the terminal says what a choice does

> **STATUS: the modal half is BUILT; the target half is NOT, and the plan review was right to refuse it.**
> The defect is real and still open. What the review killed is the idea that moving the browser's wording
> into the engine would fix it — it would not have, for a reason I had not seen. Read *Plan review outcome*
> before treating the design above as a plan.

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

---

## Plan review outcome — refused, and the refusal found the real shape

**CRITICAL: this rung would not have fixed the defect it was written for.** The browser says what a choice
does in TWO places, and I proposed to move only one of them. The button carries `imperative`; the prompt
above it carries the fuller `purpose`. Cloud is the clearest case, and the browser pins the split
deliberately:

- button: `Protect Cloud`
- prompt: `… to protect from being broken and from the opponent's return effects`

`joinImperatives` goes further and DISCARDS every effect after the first when the verbs differ, on the
explicit grounds that the prompt carries the complete meaning. The terminal has no prompt. So calling the
moved helper from `describeCommand` would have given the hotseat `Protect Cloud (27-124S)` — which still
does not say what it grants, which is exactly the complaint. E1-A2 would then have blessed the incomplete
string and the rung would have closed with the player no better off.

Four MAJORs behind it, each checkable:

1. There are **three** copies of the AST walk, not two: the browser's `nodeAt`, the engine's `effectAt`, and
   a third in the AI's `candidates.ts`. All three are equivalent today, so unifying is safe — but E1-A4's
   "the duplicate disappears" was false while the AI copy stayed, and drift there would affect move quality,
   not just wording.
2. `describeTargetVerb` is **not** analogous to its proposed neighbours. `describeAbilityCost` and
   `describeAbilityEffect` render text the CARD prints; `verbOf` invents English from semantic nodes — it
   says "Return" where every shipped `moveToHand` card says "Add it to your hand". Moving a front-end
   paraphrase into the engine would promote it to domain API. If it is to be shared, it belongs in a
   `packages/ui-text`, over a pure engine traversal.
3. E1-A3 asked for a test that REACHES a state the engine's own invariants forbid — a `chooseTargets`
   pending with no active frame. The existing web test manufactures it by deleting the frame, which is a
   legitimate defensive test but necessarily hypothetical, and the criterion should say so.
4. E1-A2 was ambiguous and gameable: the pool has 19 distinct `chooseTargets` SITES, not one per clause, and
   a table keyed by ability id cannot express Shantotto's or Ramuh's several. Worse, it could be satisfied
   by calling the new helper directly while `describeCommand` still returned its unconditional `Target`.

## What to do instead

Give the terminal the thing the browser has and it lacks: **a line above the menu saying what is being asked
and why**, from the clause's own printed text. That needs no invented English, no cross-package move and no
new domain API — `describeAbilityEffect` already extracts the effect half of a printed ability, and the
resolution frame already names the clause.

Separately, and independently of any wording: extract ONE pure `effectAtPath` helper and have the engine, the
AI and the UI all consume it, retiring all three copies. Keep `targetVerb`'s heuristic whole-AST fallback out
of it — engine validation must reject an invalid program counter, not guess.
