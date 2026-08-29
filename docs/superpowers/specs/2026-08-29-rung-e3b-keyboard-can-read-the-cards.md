# Rung E3b — a keyboard can read the cards

> **STATUS: SPEC, awaiting plan review.** Nothing built. This is the declared debt from
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
