# Rung E4 — the browser says what a cast will cost

> **STATUS: SPEC, awaiting plan review.** Nothing built. Sibling of [E3](2026-08-29-rung-e3-the-browser-shows-what-a-card-does.md);
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
