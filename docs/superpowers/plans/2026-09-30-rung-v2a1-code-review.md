# Rung V2-A1 — code review adjudication (2026-09-30)

Codex hit its usage limit mid-review (reset 12:29); a fresh Claude Fable reviewer, read-only with a deleted probe
(four party/First Strike scenarios), against feat/v2a1-damage-packets at bb189e7. No CRITICAL, HIGH or MEDIUM. Every
dealing write to a FieldCard's `damage` goes through `damage.ts`; held First Strike packets are never re-applied or
lost; a mixed party never deals early; a shrunken party gets no split; provenance per EX Burst kind is right.

**Fixed now:** L4 comment drift — dealers are in `attack.attackers` order (ascending id), not declaration order.

**Carried into V2-A2 (its plan):** L2 the applier must gate `final <= 0` for battle packets too (no 0-damage event or
occurrence), matching the held-occurrence invariant; L5 the AI's `damageProvenance` call passes the frame's `origin`
once `exBurst` is observable.

**Recorded, no change:** L1 the R7 oracle (247 games, 0 outcome diffs) is not in the repo — it lives in the session
scratchpad and is summarised in the spec's as-built note; L3 each party member's occurrence carries the packet total
(§15.1.1.9.8 defines no per-member amount; nothing in the pool reads it; the web cause line shows it by design);
L6 `contributors` in D1 vs `dealers` in code, reconciled in the as-built note.
