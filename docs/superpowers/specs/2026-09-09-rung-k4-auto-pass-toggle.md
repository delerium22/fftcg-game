# Rung K4 — the auto-pass toggle: "I won't be responding for now"

> **STATUS: BUILT, 2026-09-09; D1 and D2 SUPERSEDED by rung K5 (2026-09-16-rung-k5-smart-auto-pass.md).** The user's decision (2026-09-09): keep the rules-exact windows as the
> default — a response is a real game element and must not be lost for fewer clicks — and add a toggle for
> the stretches where the player knows they will not activate anything.

## The problem

The browser already closes every window whose only answer is Pass (J1-D14, K2). But as soon as the player
holds anything usable at instant speed — Geomancer in hand, Undead Princess in the Break Zone — every
priority window is a real decision and shows a Pass button: after each cast, each trigger, in every Attack
Phase step, in the AI's Main Phases. In the seed-50 play-test one cast on turn 3 cost 8 clicks.

## Design

- **K4-D1 — default off.** Nothing changes until the player turns it on. Off is rules-exact.
- **K4-D2 — what "on" passes.** While on, the human's RESPONSE windows (`isResponseWindow`: something on
  the stack, priority in the AI's phase, or an Attack Phase step that is a window) are answered with a
  pass in the same step as the move that opened them, for as long as they keep opening. It never passes the
  human's own empty-stack Main Phase (the Pass that ends a phase stays a button), never a decision the game
  owes (a block, targets, an EX Burst, a hand-size discard), and never the attack declaration.
- **K4-D3 — turning it on mid-window passes that window.** The toggle is the answer the player is giving.
  Turning it off does nothing retroactively.
- **K4-D4 — no move lines for the passes**, as for forced passes (J1-D14); what the passes CAUSE is narrated.
  The toggle's own state is visible on the strip (`aria-pressed`), so a window that was not shown is
  explained by the control that is.
- **K4-D5 — per game.** A restart turns it off: the setting is "for now", not a preference.
- **K4-D6 — the AI is unaffected**: its search sees the same positions; only which of the human's windows
  reach a render changes.

## Acceptance

- **K4-A1** (pure) `settleWindows(state, { autoPass: true })` passes the human's response windows and stops
  at the human's Main Phase, a pending decision, or the AI's real decision; with `autoPass: false` it is
  `settleForcedWindows`.
- **K4-A2** (hook) with the toggle on, a cast whose trigger opens a window for the human never publishes
  that window; turning the toggle on while a window is shown closes it.
- **K4-A3** (strip) the toggle renders with `aria-pressed`, flips on click, and is off after a restart.
- **Gates** typecheck, lint, unit, browser.
