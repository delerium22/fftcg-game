# Rung E7 — the game-over dialog is actually a dialog

> **STATUS: REFUSED as written; rewritten below and cleared to build.** The defect is real — the reviewer
> named it — but this plan could have gone green while the player never heard the result and the board was
> never actually modal. Read *Plan review outcome* first; it supersedes the design above.
>
> The defect itself was NAMED BY THE E3 CLOSURE REVIEW, not chosen by me: it was asked for the strongest
> remaining defect in `apps/web` and gave this one.

## Why

The game ends. A curtain drops over the board and says who won. It is `role="alertdialog"` and it is,
in every other respect, a `<div>`.

Measured in a real browser at the moment the banner appears:

| | |
|---|---|
| where focus is | `document.body` |
| focus inside the dialog | **no** |
| `aria-modal` | **absent** |
| tab stops on the page | **7** |
| tab stops inside the dialog | **1** |
| position of "Play again" in the tab order | **7th — last** |

So a player who has just lost, using a keyboard, must tab past **six board controls** — the AI's Break Zone
opener, two cards, their own Break Zone, their own Damage Zone, another card — to reach the only action the
game still offers. A screen-reader user is told nothing has happened at all: focus never moved, and without
`aria-modal` the board behind is still theirs to explore as though the game were live.

This is the mirror of the defect rung E3b-1 fixed at the other end of the game. There, the *prompt* came
before the *evidence* and a player met the commit controls before the cards. Here the only remaining control
comes after everything, including the six openers E3b-3 just added — **this rung's defect is partly the last
rung's doing**, which is worth saying plainly.

## What this rung is

Make the dialog behave as one:

1. **Move focus into it** when it appears — to the dialog itself, not to "Play again", so the winner and the
   reason are announced before the only button.
2. **`aria-modal="true"`**, so assistive technology stops exposing the board behind it.
3. **Make the background inert**, so the six board controls leave the tab order entirely rather than merely
   being announced as unavailable.
4. **Escape does nothing.** There is nothing to dismiss to — the game is over, and the only way on is
   "Play again". A dialog that closes to a dead board is worse than one that will not close.

## The environment constraint, measured rather than assumed

I probed this jsdom before designing, the way the E3b Tab-traversal finding taught me to:

```
showModal is a function:            false
inert in HTMLElement.prototype:     false
inert blocks focus in jsdom:        false
```

So **`<dialog showModal>` cannot be tested here at all** — the dialog would simply never open in a test — and
`inert`'s actual focus-blocking cannot be observed either. That rules out the platform-native answer for the
tested path, however much I would prefer it.

The design that follows: set `inert` on the board content as an ATTRIBUTE (React 19 supports it as a prop),
and move focus explicitly. Then behaviour is asserted where jsdom can see it (focus moved, focus restored,
the attribute present and removed), the attribute is a contract where jsdom cannot (real inerting), and the
end-to-end truth is checked once in a real browser via Playwright. Saying which is which is the point;
pretending an attribute assertion is a behavioural one is the failure this program keeps making.

## What this rung is NOT

- **Not a change to what the banner says.** E6 settled that wording and a test watches it.
- **Not a focus-trap implementation.** `inert` on the background is the whole trap: with nothing else
  focusable, Tab cycles within the dialog by construction. Hand-rolling a key-handling trap would be more
  code and more ways to be wrong.
- Not the `restart` flow itself, which works.

## Acceptance

- **E7-A1** When the game ends in a mounted `Board`, focus moves into the dialog, and lands on the DIALOG
  rather than on "Play again" — asserted by identity, not by "focus is not body".
- **E7-A2** The dialog carries `aria-modal="true"` and keeps `role="alertdialog"`.
- **E7-A3** Every board control outside the dialog is removed from the tab order. Asserted as a COUNT of
  focusable elements outside the dialog being zero, from a real finished game reached by playing — a game
  with an open pile and cards on both fields, so the count is not trivially zero for want of controls.
- **E7-A4** The `inert` attribute is present on the board content while the dialog is up and absent when it
  is not, stated in the test as a CONTRACT assertion because this jsdom cannot enforce inerting.
- **E7-A5** Escape does not dismiss the dialog.
- **E7-A6** After "Play again", focus is somewhere sensible in the new game rather than on `document.body`,
  and the board is interactive again.
- **E7-A7** A real-browser Playwright check that Tab from the dialog cannot reach a board control. This
  belongs to THIS rung and not to a later one: A3 and A4 together are the whole claim, and neither can be
  verified in jsdom.
- **E7-A8** Existing tests pass with no expectation edited; full gates green. No selfplay gate.

## Mutation plan

| mutation | must fail |
|---|---|
| focus is never moved into the dialog | A1 |
| focus moves to "Play again" instead of the dialog | A1 |
| `aria-modal` removed | A2 |
| `inert` never applied | A3 and A4 |
| `inert` applied but never removed on restart | A6 |
| Escape closes the dialog | A5 |
| the dialog is rendered but the board is left focusable | A3 |

---

## Plan review outcome — refused, and I made the same mistake a third time

### CRITICAL 1 — "focus the dialog and its contents will be announced" is the E3 failure, again

A1 said: move focus to the dialog container, so the winner and the reason are announced before the button.
That is the *exact* shape rung E3b-1 was refused for, and that the E3b-3 review caught again in the pile
tests: **visible text exists, and nothing establishes an accessible relationship carrying it to the focused
element.**

The banner's only accessible name is `aria-label="Game over"`. So A1 and A2 could both pass while a screen
reader announced "Game over, alert dialog" and stopped — no "The AI wins", no reason. The player would learn
the game had ended and not who won.

The APG alert-dialog pattern wants what E3 eventually built for cards: `aria-labelledby` pointing at the
visible title, `aria-describedby` pointing at the message, and initial focus on an element INSIDE the dialog
rather than the container. So: focus an `<h2 tabindex="-1">`, label the dialog by that heading, describe it
by the reason. Removing or mis-pointing either relationship must fail independently of any visible-text test.

Three times now. Knowing the shape has not stopped me writing it.

### CRITICAL 2 — A3 could not be observed, and its substitute would have been tautological

A3 asked jsdom to count focusable elements outside the dialog and find zero. It cannot: under `inert` a
button is still a button with the same attributes, so a selector still finds it. The only way to make the
count come out right is to teach the helper to skip `[inert]` descendants — which merely restates A4 and
would report zero even in a browser where the attribute did nothing.

And A7 was underspecified in a way that hid the same hole: with focus starting on the title, **the first Tab
lands on "Play again" even when the board is entirely non-modal**, so a one-Tab check survives the
"board left focusable" mutation. The browser test has to prove the BOUNDARY: title → Tab → Play again → Tab
stays inside → Shift+Tab from the first stop stays inside → focusing a known outside control fails → Escape
leaves it open.

### Mechanism: ruled for `<dialog>.showModal()`, against my design

I chose a manual `inert` sibling *because* jsdom cannot test `showModal`. The reviewer's answer is that this
reasoning is backwards: the real-browser test already belongs to this rung, so the native path is testable
where it actually exists — and `showModal()` supplies the whole contract being claimed (top layer, and
inertness of every node outside the dialog for focus, pointer, commands and accessibility exposure), including
for controls this rung never enumerated. Letting jsdom's limitations pick the production mechanism is the tail
wagging the dog.

jsdom then asserts only what it can honestly prove: the element is a `<dialog role="alertdialog"
aria-modal="true">`; `aria-labelledby` resolves to the winner heading; `aria-describedby` resolves to the
exact reason; the HEADING carries `tabindex="-1"` and receives focus; a spied `showModal()` proves the
lifecycle calls it, without pretending to emulate modality; a `cancel` event is prevented, checked via
`defaultPrevented` AFTER dispatch (the propagation lesson from the grid); and restart closes the dialog and
puts focus on one exact named control.

Everything else — opening, inertness, tab containment, Escape, focus blocking — is Playwright's alone.

### MAJOR — `openPile` is component state, so A3's fixture was not reachable as written

I argued a finished game supplies an open pile, since a damage loss guarantees seven cards in the Damage
Zone. The zone is guaranteed; the OPEN pile is not, because `openPile` is local React state and cannot be
obtained by playing an engine to a terminal position. It has to be opened through the UI first, before the
dialog appears. (A non-empty Break Zone is also not guaranteed by the rules, only by the measured seed.)

## Revised acceptance

- **E7-A1** The dialog is a native `<dialog>` with `role="alertdialog"` and `aria-modal="true"`.
- **E7-A2** `aria-labelledby` resolves to the winner heading and `aria-describedby` to the exact result
  reason — asserted by resolving the ids to their text, not by the text being present somewhere.
- **E7-A3** The HEADING carries `tabindex="-1"` and is what receives focus, asserted by identity.
- **E7-A4** `showModal()` is called when the game ends, proven with a spy, and NOT claimed to emulate modality.
- **E7-A5** A `cancel` event is prevented — `defaultPrevented` read after dispatch, never in a listener on
  the target.
- **E7-A6** Restart closes the dialog and puts focus on one exact named control of the new game.
- **E7-A7** A real-browser proof of the boundary, all six steps above. This rung owns it.

  **Done, but MANUALLY, and that is a gap worth naming.** The repo has no browser-test infrastructure at
  all — no `playwright.config`, no vitest browser provider, nothing beyond jsdom. So the six steps were
  driven by hand through the browser and their results recorded: the dialog opens with `open=true`; focus
  lands on the `<h2>` "The AI wins"; `aria-labelledby` resolves to "The AI wins" and `aria-describedby` to
  "You have taken 7 damage."; Tab reaches "Play again", a further Tab does not reach the board, and a third
  returns to "Play again"; calling `.focus()` directly on a board control is REFUSED; Escape leaves the
  dialog open; and after "Play again" focus lands on "Take the first turn".

  That is genuine verification and it caught a real defect the green jsdom suite concealed — but it does not
  re-run, so nothing stops a regression. Standing up a browser runner is a dependency and CI decision rather
  than a wording fix, so it is flagged as its own rung rather than smuggled into this one.
- **E7-A8** Existing tests pass unedited; full gates green. No selfplay gate.
