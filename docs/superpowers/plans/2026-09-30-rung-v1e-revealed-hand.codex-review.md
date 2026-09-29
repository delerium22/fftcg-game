# Rung V1-E plan — review adjudication (2026-09-30)

Codex out of quota; a fresh Claude Fable reviewer, read-only, against main 7341c60. Findings checked against code.

**Accepted (2 HIGH, 5 MEDIUM, 4 LOW):** H1 the hand-select redaction would leak once known ids are visible → R1.
H2 bounced/retrieved cards carry no knowledge bit → R2. M1 views and determinisation must land together → R3. M2 the
opponent hand row does not exist → R4. M3/M5 narration and `revealTaken` scope → R5. M4 deck-slot knowledge surfacing
on draw → R6. LOW → R7.

**Confirmed fine:** `settleLook` forgets after the taken card left the deck; mulligan precedes knowledge; LB codes
filtered; `knownBy` carried through `visibleKnownBy`; the SIMPLIFIED marker regex.

**Rejected (0).**
