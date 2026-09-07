# Rung G6 — for one decision in seven, the only button is "Concede"

> **STATUS: BUILT 2026-09-08** (`apps/web/test/concede-only.test.tsx`, `PromptStrip.tsx`). Codex plan review
> skipped by decision. Measured over the same corpus: 2,288 decisions, 345 where the choices would put Concede
> alone; after the fix 0 render it alone (A1), 0 strips with a real choice lost a button (A2), and every
> `byCard` key at those 345 decisions renders a pressable control (A4). Mutation: gating on `cardOnly` instead
> of `concedeOnly` silenced 14 `chooseTargets` strips ("Choose no targets" vanished) and A2 caught it. The
> README's marker grep only included `*.ts`, which would have hidden this `.tsx` marker; widened (A5).
>
> Found by driving the PRODUCTION build, which is how it surfaced at all: a script clicking the first strip
> button conceded a game it was winning.

## What I saw, and then measured

Driving the production preview by clicking the first control on the prompt strip, the run ended:

```
You: Pass
End Phase
You: Concede
Game over — the AI wins. You conceded.
```

The strip at that moment held exactly one button, and it was Concede. The status line said
*"Discard down to 5 cards · click a highlighted card"* — the real answer was on a card, not on the strip.

Measured over 40 seeded games, 2,288 human decision points:

| | |
|---|---|
| decisions where the strip's only button is **Concede**, on arrival | **345 — 15.1 %** |
| …and no card click can ever add one, so it stays that way for the whole prompt | **343 — 15.0 %** |
| the prompts it happens at | `chooseTargets`, `chooseFromDeck`, `discardToHandSize` |

The two rows are stated separately because the strip is not static: selecting a card that does NOT commit on
click adds that card's choices to the strip. At these prompts almost every candidate commits — clicking a
target IS the answer — so there is nothing to select and the strip stays as it arrived. Two decisions in 2,288
differ. This program has twice reported a figure whose noun was wrong, so the noun is pinned here.

What they have in common is that they are every "click a highlighted card" decision: the answers are
card-keyed, so `choices.loose` holds nothing but concede, and the strip renders exactly that.

## Why it matters, and why it is not already handled

The engine is not at fault: concede is never the only *legal* command — 0 of 2,288. It is the only *strip*
command, because every other answer lives on a card.

Two mitigations already exist and neither closes this:

- **Concede is sorted last** (`Board`: *"which would make it the leftmost, most-reachable button on the strip
  all game"*). Sorting last does nothing when there is nothing else to sort it after.
- **It arms before it fires** — one press changes the label to "Concede game", a second confirms. That stops a
  stray single click. It does not stop a keyboard user, and deliberately so: `e.detail === 0` is treated as a
  keyboard activation and *"deliberate by definition"*, so two Enters end the game.

For a keyboard player this is the sharp end. Tabbing into the strip during a target prompt lands on Concede as
the only stop, and the game is two Enters from over — while the thing they actually need to press is a card in
a grid elsewhere on the board.

This repo already decided this question once, for the terminal: `hotseat.test.ts` has an entire block called
*"the terminal prompt cannot lose the game by accident"*, whose first assertion is that Concede is
*"offered LAST, never as option 0"*. In the browser, at these 345 decisions, it is option 0 — because it is the
only option.

## Design

`PromptStrip` already computes exactly this state and calls it `cardOnly`:

```ts
const cardOnly = yours && choices.byCard.size > 0 && (picking || !shown.some((c) => c.command.type !== 'concede'))
```

It is used to change the prompt's wording. The fix is to let it change the buttons too: **when the strip has
nothing to offer but Concede, and the real answer is on a card, the strip offers nothing.** The player answers
on the board, which is where the prompt is already pointing them.

**The trade, stated plainly:** you cannot concede at those instants. CR §2.1 lets a player concede at any time,
so this is a genuine (small) restriction, and it needs a marker rather than silence. It lasts exactly one
decision — answer the prompt and Concede is back on the very next strip. Weighed against a one-in-seven chance
that the sole affordance is the one that ends the game, that is the right side to err on, and it is the same
call the CLI already made.

An alternative I considered and rejected: keep Concede but add a second, harmless button. That is a control
invented purely to dilute another one, and a strip that says "Do nothing" is worse than a strip that says
nothing.

## Acceptance, predeclared

**G6-A1 — the before-figure, and it goes to zero.** 345 of 2,288 human decision points (15.1 %) currently
render Concede as the strip's only button. After the change, no sampled decision does. Counted over the same
corpus — 40 seeds, greedy driving, sampled at every point where the human acts.

**G6-A2 — and the strip is not silenced anywhere else.** Wherever a non-concede strip choice exists, the strip
still renders it, and Concede still appears alongside. Asserted as a count over the same corpus, not on one
position: a fix that hid the strip whenever it felt like it would pass A1 perfectly.

**G6-A3 — Concede remains reachable in the ordinary case, and still last.** The existing ordering guarantee is
untouched, and the existing arming behaviour is untouched. Both have their own tests; neither is in scope.

**G6-A4 — the card the prompt points at is pressable.** The reason it is safe to offer nothing is that the
answer is elsewhere; if it were not, this would strand the player. Every `byCard` key at these decisions must
render a pressable control. `useGame.test.ts` already asserts this property in general — A4 is that it holds
specifically at the decisions A1 changes, not merely somewhere.

**G6-A5 — a marker.** The lost ability to concede mid-prompt is a deliberate deviation from §2.1 and carries an
`MVP0-SIMPLIFICATION` comment naming it, so `grep` finds it with the others. An unmarked deviation is a defect
by this repo's own standard.
