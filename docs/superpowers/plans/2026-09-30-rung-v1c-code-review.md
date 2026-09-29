# Rung V1-C — code review adjudication (2026-09-30)

Codex out of quota (until 07:09); a fresh Claude Fable reviewer, read-only with deleted Playwright probes, against
feat/v1c-deck-picker at 0e2916e. No CRITICAL or HIGH; it verified per-seat lists reaching the search and the Greedy
fallback after a restart, seat-indexed determinisation, the pending selection not leaking, per-seat LB decks, every
CLI command's decks, and modality with the toolbar.

**Accepted and fixed (c7c8d4f, 0059552):**
- MEDIUM — reproduced: after New game / Play again with the AI acting first, focus landed on the Full control toggle
  (inside `.prompt__actions` while the AI thinks) and spent the restart flag; inherited from K5 for Play again. Focus
  now waits for a `button[data-command]`; both e2e assertions tightened and red on the old code.
- LOW — the CLI read deck files before validating flag names; flags are checked first.
- LOW — "Play again" dealt a pending selection unnamed; it now names the pair.

**Recorded, no change:** StrictMode double-runs the lazy URL parse in dev (a malformed `?decks=` warns twice in dev
only); the toolbar is read last by a screen reader though drawn first (a documented, tested trade-off; `<fieldset>`
would be more semantic than `role="group"`).
