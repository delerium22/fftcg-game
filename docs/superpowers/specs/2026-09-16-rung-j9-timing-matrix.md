# Rung J9 — the timing matrix: every timing rule mapped to a test, in three layers

> **STATUS: BUILT, 2026-09-16** (commits 5b6ea90..1cf4aac; the Codex plan review ran after the build — see the plan's `.codex-review.md` for what it found and what changed). The user asked how the order of play, timing, the stack and resolution are
> tested, and for tests "that validate how all of these things work separately, and then on top of each
> other so we know it works". Chosen over J3 First Strike + Freeze, which follows and adds its rows here.

## The problem

Timing is tested, but coverage follows the rungs, not the rulebook. `cr11-stack`, `cr10-attack-windows`,
`cr9-phases`, `observer-triggers` and `party-damage` pin what J1, C2, C5 and K2 each needed; nobody can
point at CR chapter 11 and say which subsections have a test, and the 2026-09-08 audit table predates the
stack, so its starred rows still read "absent" for what J1 built. Timing primitives are proved on synthetic
cards; real cards are exercised one clause at a time; layered chains exist (the Luso cascade, C2-A8) but
there are perhaps five, each written for one rung. The next three rungs — First Strike, Back Attack, Limit
Break — are timing rules. They need a floor to stand on.

## Design

- **J9-D1 — the matrix is a document with a test on it.** `docs/rules/timing-matrix.md` has one row per
  subsection of CR 3.3 chapters 9, 10, 11 (except 11.2, 11.5, 11.9 and 11.12, which are cost, taxonomy,
  field abilities and effects, not timing), 12, 15.1.1.9 and 15.2.1–15.2.5, taken from
  `docs/rules/cr-3.3-sections.txt`. Columns: `§`, `rule` (a paraphrase, since the text is Square Enix's),
  `status`, `tests`. Status is one of `tested`, `simplified` (a marked deviation; the row names the marker's
  file), or `n/a` (unreachable with the pool; the row says why). A `tested` row cites one or more test
  references of the form `file#name-fragment`, e.g. `cr11-stack#J1-A1`.
- **J9-D2 — the meta-test.** `packages/engine/test/timing-matrix.test.ts` parses the matrix and fails when:
  a row's `§` is not in the section index; a `tested` row cites nothing; a cited file does not exist under
  `packages/*/test` or `apps/*/test`; a cited fragment matches no `describe(` or `it(` line in that file; a
  `simplified` row names no file containing `MVP0-SIMPLIFICATION`; or a subsection in scope is missing from
  the matrix. It is `rules-citations` for timing: a row that lies fails the build.
- **J9-D3 — three layers, three homes.**
  - **Layer 1, primitives in isolation** (`packages/engine/test/timing-l1-*.test.ts`, synthetic `V-*` cards
    and hand-built ASTs as the existing engine tests do): one test per rule that the matrix finds untested.
    Expected gaps, to be confirmed by the matrix: the "at the beginning of" placements (§9.3.1.3, §9.5.1.1,
    §10.1.1.1), triggers placed at each Attack Phase step before its window (§10.1.2.5, §10.1.3.5,
    §10.1.4.3), priority after resolution to the turn player (§11.1.5), rule processes before priority
    (§11.1.3, §12.3), triggers placed when priority is gained (§11.1.4), the blocker leaving (§10.1.3.3),
    no attackers declared (§10.1.2.7), another attack after the step (§10.1.4.6), a Summon to the Break
    Zone after resolving (§11.3.8, §11.11.10), the party rules (§15.1.1.9.x).
  - **Layer 2, pairwise compositions** (`packages/engine/test/timing-l2-*.test.ts`, synthetic): one rule
    on top of another, asserted as the exact sequence of event types. At least: a Summon answered by the
    non-turn player's action ability, both resolving in stack order; a trigger fired by a resolving Summon
    placed and resolved before the next item; a rule process between two frames of one resolution; an EX
    Burst inside combat with a trigger it causes; two triggers on both sides placed turn player first,
    non-turn player on top (exists as J1-A4 — cited, not rewritten); an until-end-of-turn effect from a
    stack item expiring in the End Phase; a Character refused while the stack is non-empty (exists, J1-A5).
  - **Layer 3, scripted real-card scenarios** (`packages/cards/test/scenarios/*.test.ts`, the SHIPPED
    `CARD_DEFS` from the two decks, since `@fftcg/cards` may import the engine and not the reverse). Each
    scenario is a fixed opening position, a list of commands for both seats, and a golden sequence of event
    types plus the final board. At least four: the Cloud turn (ETB pump trigger on the stack, Undead
    Princess answered from the Break Zone, Attack Phase begins trigger); combat with tricks (a Luso party,
    a block, an Undead Princess pump in the `blocked` window, Luso's damage trigger, Lightning's observe
    trigger for the other side); Ramuh in a window (the AI's Ramuh in the human's `declared` window, 5000
    damage breaking the attacker, the attack continuing with what survived); the End Phase (a pump expires,
    hand size discard, damage removed). Goldens are asserted as lists of event `type`s with the cards named
    where the sequence would be ambiguous without them.
- **J9-D4 — existing tests are cited, not moved or renamed.** The matrix points at them by file and
  name fragment. New tests carry their matrix row in the name (`L1 §10.1.2.7 — …`) so the fragment is the
  section itself.
- **J9-D5 — the audit table is refreshed, then frozen.** The starred rows of the 2026-09-08 audit are
  updated to what J1–J7 and K1–K5 built, and a note at the top says the matrix is the live view for the
  timing chapters from now on.
- **J9-D6 — what a gap becomes.** A rule the matrix finds untested and reachable gets a Layer 1 test in
  this rung. A rule it finds WRONG gets a failing test committed under `it.fails` with the section in its
  name, a row status `simplified`, and a line in the audit's ladder — not a fix in this rung (the user's
  scope rule: report, don't fix). First Strike (§15.2.3) and Freeze (§15.2.4) are `simplified` rows that J3
  turns `tested`.

## Acceptance

- **J9-A1** the matrix exists with every in-scope subsection as a row; the meta-test passes on it and
  fails on a fixture matrix with a bad section, an uncited `tested` row, a dead fragment, and a missing row.
- **J9-A2** every Layer 1 gap listed in D3 has a test or a `simplified`/`n/a` row with a reason.
- **J9-A3** (pure) the Layer 2 compositions exist: four new ones asserting an event-type sequence (the
  until-end-of-turn one asserts power across the turn instead, since expiry emits no event) and three by citation
  (J1-A4, J1-A5, C2-A5), which assert stack order and state rather than a full sequence. As built.
- **J9-A4** the four Layer 3 scenarios exist against the shipped card definitions, each asserting a golden
  event sequence and a final board.
- **J9-A5** the audit table's starred rows match the code; the meta-test is in `pnpm test`.
- **Gates** typecheck, lint, unit. No browser change.
