# Rung V1-A2 plan — review adjudication (2026-09-29)

Codex was out of quota (until 2026-09-30 02:06); the review was run by a fresh Claude Fable session, read-only,
against the code at feat/v1a1-triggers-conditions (6c4bc9e). Each finding cites code; each was checked.

**Accepted (all — 1 CRITICAL, 3 HIGH, 5 MEDIUM, 5 LOW):** C1 invariant forbids an opponent-owned pending → R1.
H1 §7.7.4 puts a sixth Backup into the Break Zone by rule process; the plan's refusal contradicted it and forked
`putOntoField` → R2. H2 the search keys `searchView`, not `viewFor` → R3. H3 the rebuilt pending's shape → R4.
M1 caster-side pricing of an opponent's select is a min → R5. M2/M3 event reason unions and web narration → R6.
M4 the Prishe skip site → R7. M5 redaction by visibility → R8. LOW: `activated` name clash, `select` vs `chooser`
naming, non-Character play, `active.chosen` leak, recursive validation → R2/R6/R9.

**Verified as holding:** priority and acting player for an opponent select; the declare stage ending at a
non-choice; `chooseTargetsCheck` validating against the frame controller's candidates; action keys built from the
actor's view; CLI naming of unseen cards; the LB sweep between frames.

**Rejected (0).**
