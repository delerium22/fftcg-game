# Backlog — the app is desktop-only by construction

> **NOT a rung, and not started.** Recorded with evidence so the decision to do it (or not) is an informed
> one. It is a substantial piece of work, not a small rung, and it has been on the flagged list for the user
> since rung E7 without ever being examined. This examines it.

## What a phone actually gets

Measured in the production preview at 390 × 844 (an iPhone 14 viewport):

| | |
|---|---|
| horizontal overflow | **yes** — `scrollWidth` 446 against a 390 viewport |
| the hand | **22 px wide**, 157 px tall — a vertical sliver |
| the side rail (card details + log) | **320 px**, starting at x = 70 |
| the board | the remaining **70 px** |
| buttons fully off-screen | 0 — they are reachable, just crushed |

## Why: there is no responsive layout at all

The whole stylesheet contains **one** media query, and it is `prefers-reduced-motion: reduce`. There is no
width breakpoint anywhere. `.table` is:

```css
display: grid;
grid-template-columns: 70px 320px;   /* at EVERY viewport width */
```

So this is not a layout that degrades on small screens — it is a fixed desktop layout that happens to be
rendered inside a phone. Nothing about it is responsive, and no amount of small fixes changes that.

## What it would take

A real breakpoint strategy, which is a design decision rather than a bug fix:

- the rail (card details + game log) has to stop being a fixed column — a drawer, a tab, or below the board;
- the board's two seats and the hand need a vertical arrangement at narrow widths;
- card sizes and the grid's arrow-key navigation both assume a row that fits.

The keyboard model would survive it — one tab stop per grid, arrows within — but every zone's geometry is
currently written for a wide screen.

## Recommendation

**Ask before starting.** The brief is "a web UI so the user can play", and the user has been playing on a
desktop, where the app is in good shape: a full game plays cleanly, every pressable card says what pressing
it does, and the browser p95 sits under the pacing floor. Mobile is a genuine barrier only if the user wants
to play on a phone, and that is their call rather than an inference from silence.
