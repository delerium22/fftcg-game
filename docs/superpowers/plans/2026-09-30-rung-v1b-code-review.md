# Rung V1-B — Codex code review adjudication (2026-09-30)

Codex (gpt-5.6-sol, xhigh, read-only) against feat/v1b-vol1-cards at b5a7545. Every rules claim was checked against
CR 3.3 or the cited official page.

**Accepted as engine work, split into rung V1-D (per the user's standing rule), tracked honestly now:**
- H1 — Ultima Weapon's Water clause is a conditional auto-ability (§11.8.13: checked when it would trigger and again
  at resolution). Confirmed in the CR; the engine has no trigger-level condition.
- H2 — Vincent's "When you do so" is a separate auto-ability placed on the stack, with a response window after the
  Backup leaves. Confirmed by the official ruling of 2019-07-19 (Fusilier 9-013C).
- M2 — searches do not reveal the found card (§15.1.1.8.1).
- M3 — Ward: §11.2.2.3 lets a player generate more CP than needed and choose which CP pays; "You can only pay with
  Fire CP" restricts the CP used, not the CP generated. Confirmed; this reverses the reading kept in the V1-A3
  adjudication.
- M6 — the pool gate overstated completeness: a SIMPLIFIED table in `pool-coverage` now lists these five deviations
  (plus Yuna's fixed bottom order), asserted exactly, each with an `MVP0-SIMPLIFICATION` marker.

**Accepted, fixed in V1-B:** M1 LB Luso's watcher now covers Forwards and Backups (V1-A5 made `of` a list; a Dragoon
case added). LOW: Warrior's cost text shows the generic `[1]`; exact categories pinned; exact deck multisets pinned.

**Recorded, no change:** H3 simultaneous triggers are placed in a fixed order — the existing §11.8.7 simplification
(timing matrix `simplified`); a controller-ordered placement is its own rung. M4 Yuna's "in any order" — the
existing spec C9 simplification.
