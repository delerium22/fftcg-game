# Rung V1-A2 — code review adjudication (2026-09-30)

Codex out of quota (until 2026-09-30 02:06); a fresh Claude Fable reviewer, read-only with deleted probes, against
feat/v1a2-zones-selects at ace6437. No CRITICAL or HIGH reproduced.

**Accepted (2 MEDIUM, 1 LOW), fixed by refusing the shapes at game creation (`validateEffects`):**
- M1 — `declarationNode` would declare a select that opens an activated ability (hand ids on the stack, activation
  gated on candidates, Prishe firing). Refused until V1-A3 (its plan R10) makes such a select resolution-time.
- M2 — reproduced: after a hand select was answered, a nested prompt left the hand card's id in the frame's
  `chosen`/`declared`, public in the other seat's view — and ids are minted in decklist order, so an id names a code.
  A prompt under a hand select is refused unless the pick has left the hand first (a `discard` or `playOntoField`
  earlier in the same `then` — Porom's shape stays legal).
- LOW — `forEach` over a hand is refused.

**Recorded, no change:** the prompt's existence and `max` clamp reveal that a match exists (accepted in the
as-built note); no committed test scans the whole other-seat view for hand ids (the new validation removes the only
known path); ISMCTS gives up the bigger Forward to a synthetic "opponent selects" at 200 iterations while greedy and
`evaluate` do not — rollout behaviour, for AI tuning. Backlog: mint ids after shuffling codes so an id never names a
card (changes RNG consumption and every seed).

**Verified as holding:** opponent-owned pending through priority, auto-pass and the AI; nesting both ways; the
`min` shrink is unreachable live; put-into-Break-Zone semantics; play-onto-field rule processes; redaction and the
`/hidden` digest.
