# Rung E3b — a keyboard can read the cards

> **STATUS: REFUSED, and split into three.** Nothing built from this spec. The refusal found that this
> rung would not have closed the defect *for a screen-reader user at all* — see *Plan review outcome*, which
> supersedes everything above it. The successor rungs are E3b-1 (hand + the route to it), E3b-2 (fields and
> the orphan row), E3b-3 (persistent public piles). **None of them may claim to close E3 except the last.**
> Originally the declared debt from
> [E3a](2026-08-29-rung-e3a-card-details-panel.md), which shipped the pointer path and said plainly that it
> does **not** close the defect.

## Why

E3's defect was: the game deals five cards, asks "keep or mulligan", and there is no way to learn what any of
them does. E3a fixed that for a mouse — hover a card, read its printed text in the rail.

A keyboard-only player got nothing. The plan review named the reason and it is exact: **mulligan is a
subjectless command.** No hand card enters `choices.byCard`, so `Board` passes `selectable={false}`, so all
five render as `role="img"` divs, which are not in the tab order. There is no key that reaches them.

So the opening decision of every game — the one E3 was written about — is still made blind by anyone not
using a pointer. The same is true of the AI's Forwards while choosing a blocker, and of the attackers while
choosing whether to trade.

E3a's own commit message says this is not closed. This closes it.

## What this rung is

**Roving tabindex, one group per visible zone.** The standard pattern for a grid of items: the group takes a
single tab stop, and arrow keys move within it.

- Each card zone (`AI Backups`, `AI Forwards`, `Your Backups`, `Your Forwards`, the hand, and the
  `Choose a card` orphan row when present) becomes a keyboard group.
- Within a group exactly one card has `tabIndex={0}`; the rest have `tabIndex={-1}`.
- Left/Right (and Up/Down, which is the same axis here — the zones are single rows) move the roving index.
- Home/End go to the first/last card of the group.
- Focus already drives the details panel, so moving focus reads the card. **No new inspect wiring** — E3a
  built that, and this rung's job is to make focus reachable.

The alternative — `tabIndex={0}` on every card — is rejected: it puts ~20 stops in the tab order between the
board and the prompt strip, and undoes the focus work from earlier today that exists precisely so a keyboard
player is not tabbing through the whole document after every AI turn.

## What this rung is NOT

- **Not a change to what clicking does.** A selectable card is still a `<button>`; Enter and Space still
  play it. This adds reachability, not new actions.
- **Not a change to the details panel.** E3a's `onInspect` on focus already exists and already works for
  focusable cards. If this rung has to touch `CardDetails`, something is wrong.
- **Not making non-selectable cards actionable.** They become *focusable*, which is a different thing. A
  `role="img"` div that takes focus needs a role a screen reader will announce sensibly — probably
  `role="option"` inside a `role="listbox"`, or `role="gridcell"` in a `role="row"`. The plan review should
  rule on which, because getting this wrong makes the announcement worse, not better.
- Not mobile. Out of scope since B10.

## The question I cannot answer from the code

What ARIA shape should a zone be? The options I can see:

1. `role="listbox"` + `role="option"` — announces "Cloud, 1 of 3", but implies selection semantics the board
   does not have for the AI's cards.
2. `role="grid"`/`role="row"`/`role="gridcell"` — accurate for a board, heavier, and grids imply 2-D.
3. `role="group"` with a label and plain focusable children — simplest, weakest announcement.

I lean to (3) because the cards already carry a complete `aria-label` and the zone already has a visible
label, so the extra semantics buy little. But I have been wrong about announcement quality before and this is
the part a real screen-reader user would notice first.

## Acceptance

- **E3b-A1** In a mounted `Board` at a REAL mulligan, arrow keys move focus across all five hand cards.
  Asserted by dispatching `keydown` and checking `document.activeElement` — the handler moves focus
  explicitly, so this is a real behavioural check.

  I first wrote this as "assert reachability by driving keydown, **not** by inspecting `tabIndex`, because
  the attribute is the mechanism and reachability is the property." That is half wrong, and probing jsdom
  rather than assuming is what showed it. jsdom **does** gate `.focus()` on `tabIndex` — a plain `<div>`
  cannot take focus, a `tabIndex={-1}` one can — so the E3a gap is genuinely observable here. But jsdom
  implements **no Tab traversal**: pressing Tab moves nothing. So the "one tab stop per group" property has
  no behavioural observable in this environment at all, and the attribute is not the mechanism behind the
  property — it *is* the only evidence available. A3 below is therefore attribute-based by necessity, and
  saying so is better than pretending it is a behavioural test.
- **E3b-A2** Focusing a card that way puts its printed text in the details panel — the E3 defect, closed for
  a keyboard. Asserted against a hand-written expected string.
- **E3b-A3** Exactly one card per group has `tabIndex={0}` at any time, including after the roving index
  moves. A group with two tab stops, or none, is the failure mode this pattern exists to avoid. Necessarily
  an attribute assertion — see A1 for why no behavioural one exists under jsdom. A real browser check
  belongs in a Playwright pass, which this rung does not own.
- **E3b-A4** The AI's Forwards are reachable, so a blocking decision can be researched — asserted at a real
  `declareBlock` position, not a hand-built one.
- **E3b-A5** A selectable card still plays on Enter, and arrow keys do NOT play it.
- **E3b-A6** The roving index survives the zone's contents changing (a card leaves play while focused) rather
  than trapping focus or losing it to `document.body`.
- **E3b-A7** Existing web tests pass with no expectation edited. Full gates green. No selfplay gate.

## Mutation plan

| mutation | must fail |
|---|---|
| every card gets `tabIndex={0}` | A3 |
| every card gets `tabIndex={-1}` | A1 |
| arrow keys move focus but do not update the roving index | A3 |
| arrow key handler also submits the card's choice | A5 |
| the roving index is not clamped when the zone shrinks | A6 |
| focus no longer triggers `onInspect` | A2 |

---

## Plan review outcome — refused, and the central claim was wrong

Seventh refusal, and the one that found the biggest hole. I wrote "E3a's own commit message says this is not
closed. This closes it." It would not have.

### CRITICAL 1 — a screen-reader user would still not have been able to read a card

The card's `aria-label` carries name, cost, elements, type, power, status, buffs and (since E4) the cast
action. It does **not** carry `def.text`. Focusing a card updates the details panel, but that panel is
neither a live region nor programmatically related to the focused element — so assistive technology is never
told the printed text exists.

My A2 asserted "focusing a card puts its text in the panel", which proves a **sighted keyboard user** sees
the panel change. That is a real improvement and it is not the defect E3 was written about. A grid could
even make it worse, by putting a screen reader into application-style navigation while the useful text stays
somewhere it will never be announced.

The fix is an accessible *description*, not a longer name: `aria-describedby` pointing at stable per-card
printed text that exists **before** focus. Relying on the single dynamic panel is explicitly wrong — the
focus announcement can happen before React has replaced its content.

This is the E1 failure shape exactly: a rung that would have gone green while the person it was written for
still could not do the thing.

### CRITICAL 2 — "closes it" was false for a second reason

Break and Damage zones are rendered as **counts only**, and the orphan row is derived from the *current*
`choices.byCard`, so it does not exist until a target choice has already been raised. Concretely:

- Luso asks whether to choose its "Character in your Break Zone" mode *before* that mode raises its target.
- The player decides whether to cast Billy Bob *before* its ETB creates the Break-Zone row.
- Damage-zone identities are public information and are never shown at all.

The view already carries the ids and defs for all of it, so this is UI work, not an engine change.

### CRITICAL 3 — A6 was undecidable, and fights existing focus code

`PromptStrip`'s provenance ref means "has **ever** received focus" — set on `focusin`, never cleared. So this
sequence is reachable: focus a prompt action → move to a hand card → cast it → the card unmounts, focus goes
to `body` → PromptStrip tries to restore *because its historical ref is still true* → the zone simultaneously
tries to repair its roving index. My spec did not say which wins, and "survives, not `body`" is satisfiable
by almost anything.

Needs: track the roving card by **`CardId`, not index**; name the exact behaviour for removal before the
current card, of the current card, of the last card, and of an emptied zone; never steal focus from a zone
that did not own it; and clear PromptStrip's provenance when focus deliberately leaves it.

### CRITICAL 4 — my mutation mapping was wrong, and A5 is untestable where I put it

"Every card gets `tabIndex={-1}` → A1 fails" is **false**. Once a test programmatically focuses a `-1` card,
arrows traverse the rest happily. That mutant fails A3, not A1.

And jsdom does not synthesise `click` from Enter on a button, so A5 cannot prove "still plays on Enter"
there; dispatching a click would test clicking. I had already caught that jsdom has no Tab traversal and
concluded a Playwright pass "belongs elsewhere". That is not available to a rung claiming completion: Tab in,
arrow within, Tab out, Shift+Tab back and Enter/Space activation are the central claims, so a real-browser
test belongs to whichever rung asserts them.

### MAJOR — ARIA ruled: a layout grid

Not listbox/option — a listbox means *selecting*, which is false for the opponent's cards. Not a plain
group — it does not communicate the arrow-key model. **A labelled `role="grid"` per non-empty zone, one
`role="row"`, a `role="gridcell"` per card**, focusing the cell for a non-actionable card and the existing
button for an actionable one (never replacing its button role). WAI defines layout grids for exactly this:
collapsing interactive widgets into one tab stop while preserving descendant semantics.

One row means **Left/Right and Home/End only** — mapping Up/Down onto the same axis is not the standard
interaction and I should not have invented it.

And my premise that "each zone already has a visible label" is **false**: `.hand` has none. It needs one.

### MAJOR — the prompt comes before the evidence

The DOM renders `PromptStrip` *before* the player's zones and hand. At the mulligan the fields are empty, so
the first focusable things a keyboard player reaches are **Keep hand / Mulligan / Concede** — the commitment
controls — and the cards they need to read come afterwards. My A1 began by directly focusing a hand card, so
it could never have caught this. The review route has to be designed and tested from the document's initial
focus.

### MAJOR — two more gaps

The orphan branch is unproved (and A3 would be vacuous for it: deleting `role="grid"` just removes that row
from the query set). Home/End, boundary behaviour and `preventDefault` on handled keys have no acceptance at
all. And A3 as written — "exactly one per group at any time" — is **impossible** for the four always-rendered
empty field zones; it must say "exactly one in each non-empty grid, zero in an empty one".

## The split

Three materially distinct paths, not six zones. Ordered so each is independently useful:

| rung | scope | may it claim to close E3? |
|---|---|---|
| **E3b-1** | printed text as an accessible description; the hand grid; the review route to it | no |
| **E3b-2** | field zones and the orphan row | no |
| **E3b-3** | persistent public Break/Damage/removed-from-game piles | yes, and only then |

E3b-1 leads because the accessible description is the part that makes any of the rest worth having, and it
benefits cards that are *already* focusable today.
