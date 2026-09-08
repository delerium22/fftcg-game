# Rung K2 — a decision with one answer is not a decision: the empty block and the empty attack declaration

> **STATUS: BUILT, 2026-09-08.** Found by playing (seed 8): with both of my Forwards dull the strip read
> "Choose a blocker for the AI's Hugh Yurg (power 8000)" over a single "Don't block"; with no Forward ready
> the attack declaration read "no Forward of yours is ready; pass" over a single "Pass". Rung J1-D14 already
> settles a pass-only RESPONSE window in the same step as the move that opened it; these two are the same
> thing one step over. The user was away; the design call is mine, recorded here to overturn.

## Design

- **K2-D1 — the engine names the forced answer.** `forcedDecision(state)` returns `forcedPass(state)` where
  that applies, else `declareBlock(null)` when the holder owes a block and has no active Forward
  (§10.1.3.1.1), else `pass` at the attack declaration when no Forward of the turn player's can attack
  (`attackCheck` on each one), else null. `forcedPass` itself is unchanged — the AI's rollouts keep asking
  it, and price a combat step themselves.
- **K2-D2 — the browser settles it.** `settleForcedWindows` asks `forcedDecision` instead of `forcedPass`,
  for either seat, so no render shows the strip and the AI never "thinks" about a block it cannot make. No
  move line is written for the forced answer; what it CAUSES (the phase lines, the damage) is narrated as
  before (J1-D14/D15).
- **K2-D3 — what is deliberately still shown.** A block decision with at least one active Forward, however
  poor; the attack declaration with at least one Forward that can attack. The rules-facing question — should
  the human get a beat to see the attack before it lands unblocked? — is answered by the damage line and by
  the `blocked` window, which is still shown whenever the human holds anything to use in it.

## Acceptance

- **K2-A1** (engine) `forcedDecision` reports the no-block for the defender whose Forwards are all dull, the
  pass at declaration for a turn player with no attack-eligible Forward, and null for each with one Forward
  that can block / attack.
- **K2-A2** (browser) `settleForcedWindows` applies the forced no-block and stops at the next real decision,
  with no move line for it.
- **Gates** typecheck, lint, unit, browser.
