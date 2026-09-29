# Rung V1-D — code review adjudication (2026-09-30)

Codex out of quota (until 07:09); a fresh Claude Fable reviewer, read-only with deleted probes, against
feat/v1d-fidelity at cf78ceb. No CRITICAL, HIGH or MEDIUM. Probes confirmed: a queued reflexive survives a later
suspension of its frame; a reflexive fires from a source already broken in response (defensible under §11.11.4 and the
Fusilier ruling — an ability on the stack exists independently of its source); a failed condition with a gone target
cancels once, reason `condition`.

**Accepted and fixed (f6a7453):** L1 the "becomes true only after the event" test only caught its mutant by an
incidental throw — rewritten around a Summon that plays two cards in one resolution, mutation-checked. L2 duplicate
narration for `noTargetAtPlacement`/`targetsGone` — one line per cancelled item. Plus Yuna's SIMPLIFIED entry now names
rung V1-F (the bottom-order choice), and the table check accepts exactly V1-E/V1-F.

**Recorded, no change:** L3 per-pick reflexive pricing (no pool select of 2+ fires one); L5 Vincent counted as two AST
units (V1-B R2's deliberate convention).
