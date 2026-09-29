# Rung V1-E — code review adjudication (2026-09-30)

A fresh Claude Fable reviewer (Codex was busy with the V2 spec review), read-only with a deleted probe, against
feat/v1e-revealed-hand at 9fc9c40. Nothing CRITICAL.

**Accepted and fixed (88fa7aa):**
- H1 (reproduced) — a card the opponent knew in the deck (Miner's public reveal, rest to bottom) kept that knowledge
  when a later PRIVATE look (Reeve, Yuna) took it to hand, so the opponent's view named the taken card; the deck slots
  also leaked the take by elimination (a pre-existing spec-C9 gap). Fix at the exposure: a private look forgets the
  exposed cards before the controller learns them; `revealTaken` still teaches the taken card to both.
- Related pre-existing: the web narrator could name an unrevealed card visible only in the previous view — it names it
  only from the after-move view.
- M1 — the B-A3 hand-leak assertion trusted the knowledge bit; it now justifies every known AI hand card from events the
  human saw, and fails on the probe without the engine fix.
- L1 — same-name numbering now covers the AI hand row.

**Verified as holding:** determinisation pins known cards with conservation (duplicates, LB filter); keys stable and
appended only when non-empty; the zone-keyed select redaction; `toHand` only from public zones, draws never learn;
knowledge ends on cast, discard, play onto the field, the LB sweep.
