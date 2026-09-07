# Rung H1 — "How to play", and card text you can read

> **STATUS: BUILT 2026-09-08.** Asked for by the user in one line ("add an intro page/popup to explain the game
> rules, make the text of a card bigger and more prominent"); the user was not available for design questions,
> so the calls below are mine and are recorded here so they can be overturned rather than rediscovered.

## What was asked, and what it was read as

Two things, both about a first-time player sitting down at the browser build:

1. **The game explains itself before the first decision.** Today the first thing on screen is "Choose who
   goes first" and a Concede button. Nothing says what the goal is, what CP is, or that the cards on the board
   are clickable. The README explains all of it — to a developer, in another window.
2. **A card's text is legible.** The printed text is shown in the right-hand rail's details panel at 12 px,
   under a 14 px name and 10 px metadata. On a 320 px rail that is the smallest type in the interface, for the
   one thing every decision in the game turns on. Read as: the *details panel*, not the card faces — a hand
   card is 96 px wide and has no text box, and the panel is where the text already lives.

## Design decisions

**H1-D1 — a native modal `<dialog>`, the same mechanism as game over.** `HowToPlay` opens with `showModal()`
so the board is inert while it is up: a player cannot click "Take the first turn" through a rules sheet. Unlike
the game-over dialog it is a `role="dialog"`, not an alert, and **Escape closes it** — there is a board to
return to. Focus lands on the heading, as game over does, so a screen reader hears the title first.

**H1-D2 — shown once, remembered in `localStorage`** under `fftcg.howToPlay.seen`. Every read and write is
wrapped, so a browser that throws on storage (private mode, blocked site data) sees the intro every time
rather than a blank page. The flag is per browser, not per game: "Play again" does not re-show it.

**H1-D3 — reopenable from the rail.** A "How to play" ghost button sits at the top of the right rail, above the
card details. `Board` takes an optional `onHelp`; without it (every existing test) nothing renders, so no
existing focus or button-count assertion moves.

**H1-D4 — the rules text is this build's rules,** not the CR's: sorcery-speed abilities, no First Strike, the
auto-paid CP with "Pay differently", Concede arming twice, and the strip that goes empty when the answer is a
card (G6). It names the pool's keywords (Haste, Brave) and nothing the pool does not print.

**H1-D5 — the details panel gets bigger type, not a bigger rail.** Name 14 → 18 px, printed text 12 → 15 px at
line-height 1.5 in full ink rather than dim, metadata 10 → 11 px, the click-action line 11 → 12 px, and the
panel's cap 40 % → 50 % of the rail so Cloud's 373 characters still fit without scrolling at 15 px. The rail
stays 320 px: widening it squeezes the board, and the board is where the game is.

**H1-D6 — existing browser tests are shielded by `storageState`,** not by editing every spec. The Playwright
config pre-seeds the flag for its origin, so the five existing specs load straight onto the board as before.
The new spec overrides with an empty state to see the intro.

## Rejected

- A separate landing *page* with its own route. The app has no router and one screen; a second screen for
  a paragraph of rules is a subsystem for a sentence.
- Putting text on the card faces. At 96 px the plate already clips power on undamaged cards; the text box
  would be unreadable and the panel exists precisely because of that.
- A "don't show again" checkbox. Closing IS not showing again; a checkbox is a second decision about the
  first.

## Acceptance

**H1-A1** — on a fresh browser profile the dialog is open, modal (a Tab from its last control stays inside;
`document.activeElement` is never on the board), and titled "How to play". After "Play" it is gone and the
first prompt's buttons are pressable. A reload does NOT show it again. *Browser test.*

**H1-A2** — the rail's "How to play" button reopens it; Escape closes it. *Browser test.*

**H1-A3** — the lifecycle calls `showModal`, focus lands on the heading, Play and Escape both call `onClose`,
the storage helpers survive a throwing `localStorage`. *jsdom.*

**H1-A4** — with the pointer over a hand card, the details text's computed `font-size` is at least 15 px and
its colour is the full-ink token. *Browser test — jsdom loads no CSS, so this cannot be proved there.*

**H1-A5** — every existing test, jsdom and browser, passes unchanged.
