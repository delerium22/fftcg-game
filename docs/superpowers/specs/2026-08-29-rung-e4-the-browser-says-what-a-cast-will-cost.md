# Rung E4 — the browser says what a cast will cost

> **STATUS: REFUSED as written; rewritten below and cleared to build.** The defect is real and the reviewer
> says so. What it refused is the acceptance — which could pass with the disclosure wired to nothing — and
> one factual claim of mine that was simply wrong. Read *Plan review outcome* first. Sibling of [E3](2026-08-29-rung-e3-the-browser-shows-what-a-card-does.md);
> both are "the terminal shows something the browser hides", found in the same ten minutes of play.

## Why

Turn 1, Main Phase 1. My hand: Class Tenth Moogle, **Odin (cost 5)**, Ramuh, Undead Princess, two Red Mages.
I clicked Ramuh — a 2-cost Summon — to cast it. One click, no further prompt. The log then said:

```
You: Cast Ramuh paying: discard Odin as lightning
```

The game discarded my most expensive card to pay for a cheap one, I was never asked, and I found out only
after it was irreversible. The button I clicked was labelled `"Ramuh, cost 2, lightning, summon"`. Nothing on
it, in it, or near it mentioned Odin.

**The auto-chosen payment is not the defect.** That is spec B6 and it is right: `legalCommands` enumerates
every minimal payment, so one castable card can appear dozens of times, and `preferredChoices` collapses
them to the one `preferredPayment` likes. A hand of six cards would otherwise be thirty buttons.

The defect is that **the collapse is invisible until it is irreversible.** A decision was made on my behalf
and disclosed afterwards, in the past tense, in the log.

And again the terminal is ahead of the browser, from the same shared `describeCommand`:

| | before you commit | after |
|---|---|---|
| terminal | `Cast Ramuh paying: discard Odin as lightning` | — |
| browser | `Ramuh, cost 2, lightning, summon` | `Cast Ramuh paying: discard Odin as lightning` |

The string already exists. The browser writes it into the log one moment too late.

## What this rung is

Put the payment on the cast affordance **before** the click: a hand card that is castable says what casting
it will spend. The string is the one the terminal already builds, so no new wording is invented — the same
argument that made the E1 refusal's replacement work.

Where it goes is the open design question, and the plan review should rule on it. The candidates:

1. **On the card's `aria-label` / `title`.** Cheapest, and it fixes the screen-reader case for free, which
   matters because right now a screen-reader user gets *less* warning than a sighted one — they cannot even
   see the log update. But a native `title` tooltip is slow to appear and easy to miss.
2. **In the prompt strip**, which already carries the "why" line for ability choices.
3. **In the E3 details panel**, if E3 lands first — the panel is already the place the player looks to learn
   about a card, and the payment is a fact about casting *this* card *now*.

(3) is the most coherent if E3 lands, and (1) is the one that is correct regardless, because the label is
what assistive technology reads. My recommendation is (1) unconditionally, plus (3) if E3 has landed.

## What this rung is NOT

- **Not letting the player choose the payment.** That is a real feature and a much bigger rung — it needs a
  payment-picking UI and it re-opens the thirty-buttons problem B6 closed. Disclosure first; choice later, if
  playing shows disclosure is not enough.
- **Not a change to `preferredPayment`'s choice.** Whether discarding Odin was a *good* pick is an AI
  question, not a UI one. (It looks bad, and it is worth a separate look: the payment picker seems not to
  weigh the discarded card's own value. Recorded, not fixed here.)
- Not the equivalent problem for activated abilities, which pay costs too. Same shape; do it in the same
  rung if it is one line, split it if it is not.

## Acceptance

- **E4-A1** A castable hand card discloses its payment before the click, asserted against a hand-written
  expected string on a fixture where the payment is NOT trivial — i.e. it discards a *named* card, not
  "nothing". A fixture that pays from backups only would pass while the Odin case stayed broken.
- **E4-A2** The disclosed string and the string the log prints afterwards are the SAME string, asserted by
  comparing them in one test rather than by writing the expectation twice. Two hand-written copies of the
  same expectation is how they drift.
- **E4-A3** A card that is in hand but NOT castable discloses nothing — no empty "paying:" fragment.
- **E4-A4** Existing web tests pass with no expectation edited. If a label assertion has to move, that label
  was load-bearing and the move needs justifying, not updating.
- **E4-A5** Full gates green; `selfplay --games 200 --seed 1` 200/200.

## Mutation plan

- Disclose the *card's* label instead of the payment → A1 must fail. (Catches "the button shows a string".)
- Disclose a hard-coded `"paying: nothing"` → A1 must fail on the Odin-shaped fixture and would have passed
  on a backups-only one, which is the point of A1's fixture requirement.
- Build the disclosed string from a second call site rather than the shared one → A2 must fail.

## Side note, not part of this rung

Both fields were empty when I cast Ramuh, and every one of its three modes begins "Choose 1 Forward". All
seven mode buttons were offered anyway; each would fizzle. That is legal — the player can pick "None of
these" — but the UI said nothing about it. Whether a choice that cannot do anything should be marked is a
separate question, and a smaller one than this.

---

## Plan review outcome — refused, and it made the rung SMALLER

### MAJOR 1 — the seam I documented does not exist, and the real one is better

I wrote that the terminal and the browser share `describeCommand`, so "the string already exists". Half
right, in the wrong place. **The browser does not import `describeCommand` at all** — verified, there is no
such import in `apps/web/src`. It builds the identical string itself, in `describeChoice`:

```ts
case 'castCharacter':
case 'castSummon':
  return pay.length ? `Cast ${qualifiedName(v, c.card)} paying: ${pay.join(', ')}` : `Cast ${qualifiedName(v, c.card)} (free)`
```

and `buildChoiceSet` hangs it on **every** `Choice` as `label`. So the string is not merely available — it is
already computed, already attached to the exact cast the click will submit, and then never shown. The log
recomputes it afterwards.

This makes the rung much smaller than I specified: **disclose the surviving cast choice's existing
`Choice.label`.** No CLI refactor, no new payment formatter, no cross-package move.

### CRITICAL 1 — the acceptance was E3a's refused mutant again

A1–A3 never required a mounted `Board`, so all three could pass against a new `Card` prop while Board's hand
path never supplied it. That is precisely the shape E3a was refused for, and precisely the mutant that
survived E3a's *first* round of tests. Now mandatory: a mounted real-Main-Phase Board test that reaches the
named-discard payment through `legalCommands → preferredChoices → buildChoiceSet`, hovers and separately
focuses the real castable card, sees the exact hand-written string before clicking, proves neither hover nor
focus submits, and dies when the payment is disconnected at `Board`.

### CRITICAL 2 — "discloses" let one surface stand in for the other

I recommended the accessible name *and* the panel, but wrote A1 so either alone would satisfy it. Panel-only
leaves screen-reader users worse off than sighted ones — they cannot see the log update either. Label-only
leaves sighted users depending on a slow native tooltip. **Both are mandatory, with separate criteria and
separate removal mutations.**

Ruled out: the prompt strip. Main-phase casting can expose several cards at once and a single-choice card
commits immediately, so a card-specific payment there would need selection/confirmation behaviour this rung
does not own.

### MAJOR 2 — my "built from a second call site" mutation cannot fail

An exact duplicate formatter produces identical output, so no behavioural test can distinguish it. Replaced
with **semantic divergence** mutations: disclose the cast card instead of the discarded one; omit the discard
Element; reorder the payment sources for one consumer. Behavioural tests cannot prove source sharing — that
has to come structurally, from passing the existing `Choice.label` rather than recomputing.

### MAJOR 3 — I left activated abilities undecided, which is not a plan

The spec said both "not this problem" and "do it here if it is one line". **Decided: E4 is cast-only.**
Activated abilities have the same defect but live on field cards and need their own current-action treatment.

### MINOR — the selfplay gate goes

200 games cannot observe a UI disclosure. E5 omitted it correctly; E4 should not have asked for it.

## Revised acceptance

- **E4-A1** In a mounted Board at a real Main Phase, the castable card's ACCESSIBLE NAME carries the cast
  action, asserted against a hand-written string naming the discarded card, without losing the name, cost,
  element, type or power already in the label.
- **E4-A2** The same action line is VISIBLE in the `CardDetails` panel, asserted separately.
- **E4-A3** Hover discloses and does not submit; focus discloses and does not submit; one click still plays.
- **E4-A4** A hand card that is not castable discloses nothing — no dangling "paying:" fragment.
- **E4-A5** The disclosed string is the `Choice.label` the click submits, established by passing it rather
  than rebuilding it, and pinned by the divergence mutations below.
- **E4-A6** Existing web tests pass with no expectation edited. Full gates green. No selfplay gate.

## Revised mutation plan

| mutation | must fail |
|---|---|
| Board stops supplying the payment | A1 and A2 |
| disclosure removed from the accessible name only | A1 |
| disclosure removed from the panel only | A2 |
| the accessible name is REPLACED by the action, losing cost/element/power | A1 |
| disclose the cast card instead of the discarded card | A5 |
| omit the discard Element ("discard Odin" not "discard Odin as lightning") | A5 |
| hover or focus submits the command | A3 |
| a non-castable card discloses an empty payment | A4 |
