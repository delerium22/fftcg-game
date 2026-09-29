# Rung V1-C plan — Codex review adjudication (2026-09-30)

Codex (gpt-5.6-sol, xhigh, read-only). Findings checked against the cited code.

**Accepted (1 CRITICAL, 8 HIGH, 6 MEDIUM, 2 LOW):** C2 no New game control exists → R1. H1 pending vs active pair → R2. H2 signature collision with the seams → R3. H3 restart-with-new-pair test → R4. H4 restart API files → R5. H5 CLI flag compatibility → R6. H6 mirror confounds seat and deck → R7. H7 nondeterministic default e2e → R8. H8 swapped-pair test too weak → R9. M1–M6 → R10. LOW → R3/R11.

**Kept against the review (1):** C1 — the CLI default stays the Vol. 2 mirror: the CLI is the measuring tool, and every recorded win rate assumes the mirror. Spec V1-D17 amended.

**Rejected (0).**
