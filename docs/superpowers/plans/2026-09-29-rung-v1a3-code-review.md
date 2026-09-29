# Rung V1-A3 — code review adjudication (2026-09-30)

Codex out of quota; a fresh Claude Fable reviewer, read-only with deleted probes, against feat/v1a3-filters-costs
(c5bbb30). No CRITICAL or HIGH. All findings accepted and fixed in 3eae57c:

- M1 — `sameElementAsChosen` inside an `anyOf` member passed validation and threw mid-game (reproduced). Refused at
  game creation.
- L1/L2 — the AI and `hasAnyActivation` could spend the only same-name copy as CP for a special with a CP cost
  (reproduced: the AI listed nothing while `legalCommands` listed one). The copy is kept out of CP sources.
- L3 — `needsChoice` counted a select as a declaration-time choice; a select anywhere in an activated ability no
  longer throws in `declarationNode`.
- L4 — `effectsValue` could pass an unresolved axis to `targetCandidates`; resolved against nothing chosen.
- L5 (web `crystals()` narrows where `canPay` refuses whole) — unreachable through the picker, pinned by the I2
  property test; recorded only.

Verified by the reviewer: isLegal/apply agree on `sameName`/`onlyCp`/`lbFlip`; no card pays twice; ISMCTS keys and
decoding of a special across determinisations; the ban's scope; the head select made at resolution; element-of-chosen
timing; the multi-job split confined to the job axis.
