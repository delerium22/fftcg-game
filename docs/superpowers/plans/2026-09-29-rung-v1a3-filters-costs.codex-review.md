# Rung V1-A3 plan — review adjudication (2026-09-29)

Codex was out of quota; the review was run by a fresh Claude Fable session, read-only. Each finding cites code and
was checked against it.

**Accepted (3 HIGH, 5 MEDIUM, 6 LOW):** H1 an unresolved `sameElementAsChosen` would match everything → R1. H2
`isLegal` and `apply` would disagree on `Payment.sameName`, and neither legal enumeration nor the AI would build it
→ R2. H3 `onlyCp` misses `canPay` callers and flexible dual-element CP → R3. M1 clause count → R4. M2 §11.7.3/4 are
simplified like §11.6.3/4 → R5. M3 `DefFilter` and the spec's separator → R6. M4 no AI term (recorded) → R7. M5 latent
preflight overlap (recorded) → R8. LOW → R9.

**Kept against a reviewer note (1):** the overpay remark. CR §11.2.2.3 allows generating unspent CP in general, but
Ward's own text ("You can only pay with Fire CP to cast Ward") forbids any non-Fire CP for that cast, so refusing it
is the card's rule, not a simplification.
*Reversed 2026-09-30 (rung V1-B review M3, implemented in rung V1-D):* §11.2.2.3 lets a player generate as much CP as
they like and then choose which CP pays; "You can only pay with Fire CP" restricts the CP used, not the CP generated. An
off-Element CP may be generated and go unspent (§11.2.2.3.1).

**Rejected (0).**
