# Rung K5 — smart auto-pass: stop only where a response is worth a look

> **STATUS: BUILT, 2026-09-16** (commit f5268f9 and its follow-up). The user's decision: "go with your stop list" — the K4 default (every
> real window is a button) is replaced by a default that stops only at the windows a player would hold for,
> and the K4 toggle becomes "Full control". This supersedes K4-D1 and K4-D2; K4-D3 to K4-D6 carry over with the
> toggle's meaning flipped. Every refinement below is recorded so it can be overturned here.

## The problem

K4 removed the pass-only windows and gave the player a toggle for "I won't be responding for now". But
the moment the player holds anything usable at instant speed — Undead Princess in the Break Zone makes EVERY
window a real decision for the rest of the game — the default is still a Pass button after each cast, in
each Attack Phase step, in the AI's Main Phases, and the toggle passes ALL of them, including the AI's
Summon the player would have answered. Neither setting is how a player wants to sit through a game.

## Design

The model is MTG Arena's default stops: pass the windows where nothing is happening, stop where the
opponent has done something or combat is about to be decided.

- **K5-D1 — two modes: Smart (default) and Full control.** Smart is the default for every new game. Full
  control shows every real window, which is exactly K4's "off" behaviour. K4's "pass everything" mode is
  gone: the windows Smart keeps are the ones the toggle existed to skip, and nobody asked to skip them.
- **K5-D2 — what Smart passes.** A response window (`isResponseWindow`) held by the human is passed in the
  same step as the move that opened it, for as long as such windows keep opening, UNLESS one of the stops
  in D3 holds. So: the AI's Main Phases with an empty stack; the Attack Phase `preparation`, `declared` and
  `damage` windows in either turn; and a window whose stack top is the human's OWN Summon or ability —
  whether the AI has yet seen it or has passed on it. Passing hands it to the AI, or resolves it, which is
  what the player wanted when they cast it.
- **K5-D3 — the stops.** Smart never passes:
  1. a window whose TOP stack item the AI controls (`controller === AI` on a Summon, `frame.controller` on
     an ability): the AI cast or triggered something the player could answer. Top, not any item: after the
     player's response to the AI's Summon resolves, the AI's Summon is on top again and the window is
     kept again — the player may respond a second time, as the rules allow.
  2. the Attack Phase `blocked` window — the block is declared, damage not yet dealt. This is where combat
     is decided. It is kept in EITHER turn and whether or not a blocker was named (the engine enters
     `blocked` with `blocker: null` for an unblocked attack). Narrowing to declared blockers is one clause;
     decide by playing.
  3. anything that was never a response window: the human's own empty-stack Main Phase (its Pass ends the
     phase and stays a button), the attack declaration, every pending decision the game owes (a block,
     targets, an EX Burst, a hand-size discard).
- **K5-D4 — the `declared` window is passed when the AI attacks.** The user's list passes the Attack Phase
  "preparation/declaration" windows; `declaration` is the turn player's decision, so the window meant is
  `declared`. Passing it means the player cannot act between the AI's attack declaration and their block
  decision. Full control has it. This is the first thing a player will notice if it is wrong.
- **K5-D5 — the toggle.** The strip's control reads "Full control: off/on" (`data-toggle="full-control"`,
  `aria-pressed`). Turning full control OFF is the answer to whatever window is open: the position is
  settled under Smart at once (K4-D3, mirrored). Turning it ON does nothing retroactively. It is per game:
  a restart turns it off (K4-D5).
- **K5-D6 — unchanged from K4.** No move lines for the passes; what they cause is narrated (K4-D4). The AI's
  search is unaffected (K4-D6). The forced windows (`forcedDecision`) settle in both modes as before.

## Acceptance

- **K5-A1** (pure) `settleWindows(state, { control: 'smart' })`: passes the human's empty-stack window in
  the AI's Main Phase; keeps a window whose top is the AI's Summon; passes a window whose top is the human's
  own Summon after the AI's pass; keeps the `blocked` window; never touches the human's own Main Phase or a
  pending. `{ control: 'full' }` keeps every real window and is `settleForcedWindows`.
- **K5-A2** (hook) the AI's commit path settles under the live mode. The setter's mid-window settlement
  (turning full control off) mirrors K4-D3 line for line and is covered by the pure K5-A1 cases, not by a
  hook-level test: building a kept window inside the mounted hook is more fixture than the three lines
  are worth.
- **K5-A3** (strip) the control renders "Full control: off" with `aria-pressed="false"`, flips through its
  handler, is absent without one, hidden behind a tray, and off after a restart.
- **Gates** typecheck, lint, unit, browser.
