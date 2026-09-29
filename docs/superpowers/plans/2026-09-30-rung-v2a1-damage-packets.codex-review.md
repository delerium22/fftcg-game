# Rung V2-A1 plan — Codex review adjudication (2026-09-30)

Codex (gpt-5.6-sol, xhigh, read-only) against main 8576881. Findings checked against the code and CR §12.4.5,
§15.1.1.9.5/8.

**Accepted (4 CRITICAL, 6 HIGH, 8 MEDIUM, 3 LOW):** C1 breaker attribution does not exist and the matrix overclaims →
R1 (marked simplified — unobservable in the pool; ledger to backlog). C2 dealers vs party members → R2. C3 the spec's
API → R3. C4 one packet-scoped event → R4. H1 provenance → R5. H2/H3 party-level First Strike batches and held
occurrences → R6. H4/H5/H7 what "behaviour-preserving" can mean, the literal inventory, a before/after oracle → R7.
H6 sequencing → R8. MEDIUM → R3/R9. LOW → R9/R10.

**Rejected (0).**
