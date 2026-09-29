# Rung V1-A1 — code review adjudication (2026-09-29)

Codex hit its usage limit mid-review (until 2026-09-30 02:06); the review was run by a fresh Claude Fable session,
read-only, with scratch probes, against feat/v1a1-triggers-conditions at 6c4bc9e.

**Accepted (1 MEDIUM, 1 test gap):**
- M1 — after a nested prompt resumed, `ctx.chosen` stayed bound to the INNER answer, so an effect after the inner
  chooser in the outer chooser's `then` acted on the inner pick (reproduced: `choose A → [if → choose B → dull,
  damage 1000]` dulled B and damaged B; A took nothing). Root cause predates V1-A1 (a bare chooser-in-chooser too);
  `if` makes it a normal shape. Fix: every `chooseTargets` binds its own targets and restores the outer binding after
  its `then`; on resume, the node the prompt was raised at takes the answer (`ctx.answer`) and records it in
  `declared`, and every ancestor rebinds its recorded targets. Tests: declared outer and resolution-time outer (red
  before). The §11.11.2 check reads `declared` only as a frame starts resolving, so the resolution-time entries do
  not reach it.
- The reviewer's probe P2 (mode → if → chooser, a five-level program counter) is now a permanent test.

**Recorded, no change (2 LOW):**
- L1 — a chooser under an `if` prompts at resolution, not at placement (§11.8.4/§11.8.9 cancellation does not apply
  to it). Already in the spec's as-built note; a card whose printed "choose" sits under a condition must be encoded
  with the condition inside the chooser's `then` (Palom's shape), not around it.
- L2 — `subjectMatches` reads the first chosen card; every planned user picks one.

**Verified as holding (by probe or reading):** the attack trigger with a declare-stage chooser end to end;
declare/resolve split at `if`; greedy's rollout and web Smart auto-pass with an attack trigger on the stack; no
layer self-dependence; ISMCTS frame digest; every program-counter walker handles `if`; zero counted damage.
