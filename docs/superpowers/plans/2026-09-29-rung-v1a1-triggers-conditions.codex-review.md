# Rung V1-A1 plan — Codex review adjudication (2026-09-29)

Codex (gpt-5.6-sol, xhigh, read-only) reviewed the plan and spec against the code. Each finding was checked in the
repo before it was accepted or rejected. The plan's "Revisions" section (R1–R9) carries the changes.

**Accepted (15):**
- H1 — `matchesFilter` is private to `resolve.ts:135`, and `layer.ts` imports only types and `filters.ts`: a
  `conditionHolds` in `layer.ts` would need a cycle. → R1.
- H3 — `targetDelta(state, source, effects, id)` (`candidates.ts:103`) has no controller. → R2.
- H4 — `nodeVerb` maps only `node.then` through `verbOf` (`commands.ts:412`), which returns null for any other
  kind, so a chooser over an `if` renders as a generic target. → R3.
- H5 — `verbOf` interpolates `e.amount` (`commands.ts:363`); an object would print `[object Object]`. → R3.
- M1/M4 — the spec said `TargetFilter`, the plan `DefFilter`; setup validation covers `to.filter` only. → R5.
- M2 — `StaticScope` has no source-only form, and a name filter would also reach LB Zack. → R4.
- M3 — `needsChoice` (`activate.ts:81`) does not look inside new container kinds. → R6.
- M5, M6, M7, M8 — test gaps. → R7, R3.
- LOW ×3 — folded into R9.

**Narrowed (1):**
- H2 — "counted damage is recomputed per hit of a sweep". True of the code, but the count cannot change inside one
  sweep: damage marks cards, and breaks are rule processes between frames (`resolve.ts`, the `damage` case). The
  spec's "counted once" is reworded rather than adding a cache no card needs. → R8.

**Rejected (0).**
