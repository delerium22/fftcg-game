# Rung J6 — the continuous-effect layer (CR §11.12.4)

> **STATUS: BUILT, 2026-09-08 (revision 2, slices 1–3 in one commit).** Revision 1 went to a Codex plan review
> ([the review](../plans/2026-09-08-rung-j6-continuous-effects.codex-review.md)); every finding was checked
> against the code and the adjudication is at the end. The audit's "scaling item for more effect types"
> (ladder J6). The user was away; the design calls are mine, recorded so they can be overturned here.

## What the rules say

- **§11.12.4.2** — an ongoing effect from a Summon or an ability affects only the cards present when it
  resolved (Cloud's "until the end of the turn, all Forwards you control gain 3000 power").
- **§11.12.4.4–5** — a FIELD ability's ongoing effect applies for as long as its source stays on the field
  and affects cards that arrive later ("Forwards you control gain +1000 power" printed on a Backup).
- **§11.12.4.6–7** — order: controller, text, type/job, other information, then POWER; within a kind, a
  card's effect on itself first. **§11.12.4.8–13** — timestamps and dependency order the rest.

## What the engine does

`powerBonus`, `granted` and `flags` are STAMPED on `FieldCard` by single effects and cleared at the End
Phase — exactly §11.12.4.2, and correct for every ongoing effect in the pool, all of which come from Summons
and abilities. There is no place for a field ability's ongoing effect to live: `StaticEffect` has
`costReduction` (read in hand) and `produceElement` (read at CP generation), both consulted at one site. A
card printing "+1000 power to your other Forwards" or "your Forwards gain Haste" cannot be expressed. Power
has one authority (`effectivePower`, spec C1-7); keywords have one (`keywordsOf`); FLAGS HAVE NONE — they are
read raw in rules.ts, resolve.ts, candidates.ts, evaluate.ts and the web's `fieldCardDisplay`.

## Design

- **D1 — two sources, three readers.** Stamps stay for resolved effects (§11.12.4.2). Field abilities'
  ongoing effects become CONTINUOUS `StaticEffect` members: `{ kind: 'modifyPower'; amount; to; when? }`,
  `{ kind: 'grantKeyword'; keyword; to; when? }`, `{ kind: 'grantFlag'; flag; to; when? }`. The three
  readers — `effectivePower(state, card)`, `keywordsOf(state, card)` and the NEW `flagsOf(state, card)` —
  union the stamps with the layer. Every consumer of power, keywords or flags migrates to them (the list is
  in the changelog); a raw read of `card.flags`/`card.granted`/`card.powerBonus` outside state.ts is a
  review failure from here on.
- **D2 — scope reuses the targeting vocabulary.** `to: { controller: TargetController; excludeSource?:
  boolean; filter?: DefFilter }` — the existing `'self' | 'opponent' | 'any'` (relative to the SOURCE's
  controller), the existing "other than this card" flag, and `DefFilter = Pick<TargetFilter, definition axes>`
  (type, types, element, cost, maxCost, job, category, name, keyword). Instance axes are EXCLUDED on purpose:
  a scope that read effective power or granted keywords would re-enter the layer it is part of. Dependency
  (§11.12.4.12–13) is therefore structurally impossible here and is recorded as a MVP0-SIMPLIFICATION
  marker on `DefFilter`: the day a non-additive effect ("set power to", "loses all abilities") or an
  instance-scoped one lands, this is where fixed-point semantics go.
- **D3 — no timestamps yet.** Every layer member is additive, so §11.12.4.6–13 ordering is unobservable;
  `enteredSeq`/`seq` plumbing (setup, resolve, view, search, determinise, shim, every fixture) is deferred
  with a marker until an effect exists whose order a test can see. The §11.12.4.7 self-first rule is likewise
  a no-op for sums and is marked.
- **D4 — cost, without a state memo.** No `WeakMap<GameState, …>`: states are cloned by `viewFor`,
  `determinise` and the worker, and `determinise` documents `GameState` as mutable, so a state-keyed memo
  would both miss and go stale. Instead `continuousStatics(defs)` — the set of codes whose definition carries
  a continuous static — is memoised on the `defs` OBJECT (one per game, shared by every state of it and by
  `stateShim`), and a reader scans the two fields (≤ 10 cards) for members of that set. With no such card on
  the field a reader costs one Set lookup per field card; the 29017ab timing script must not regress.
- **D5 — conditions ride on the effect.** `when?: StaticCondition` on each continuous member, evaluated
  by `staticApplies({ state, source, controller }, when)` — the existing `damageReceived` moves to that
  context (source-aware), and new kinds are added when a card needs them.
- **D6 — the layer lives in a lower module.** `packages/engine/src/filters.ts` takes `matchesDefFilter`
  out of resolve.ts (re-exported there); `packages/engine/src/layer.ts` imports it and `state.ts`'s data
  helpers; `state.ts`'s three readers import `layer.ts`. No cycle: layer → filters → types.
- **D7 — the AI and the web read through the readers.** `evaluate.abilityTerms` and the protection term use
  `keywordsOf`/`flagsOf` (today they read stamped arrays and return early); `candidates.ts` uses `powerOf`
  and the readers; `fieldCardDisplay` (commands.ts) derives `power`, `keywords` and `flags` from the readers
  through one `stateShim` built per call of `fieldCardDisplay`'s caller, not per card; `Card.tsx` de-duplicates
  a badge printed AND granted. `CardSheet.tsx` and `CardDetails.tsx` show "8000 (printed 7000)" when they differ.
- **D8 — the observation key already covers the layer's inputs**: a field card's code, controller and zone
  are digested (keys.ts), and definitions are immutable within a search. A6 tests the real dynamic input: two
  fields that differ by a continuous source give different keys.
- **D9 — validation.** `createGame` rejects a continuous static with a non-finite `amount`, an unknown
  keyword/flag, or an instance axis in its scope filter (the type forbids it; the runtime check catches data
  that arrived through JSON).
- **D10 — delayed auto-abilities and replacement effects are NOT this rung** (§11.8.3, §11.12.5); they get
  their own spec when a pool card needs them.

## Slices (each commits green)

1. `filters.ts` + `flagsOf` + the reader migration (every raw read moved; no behaviour change; a grep test
   that no `src/` file outside state.ts/layer.ts reads `.flags`/`.granted`/`.powerBonus` of a FieldCard).
2. Continuous `StaticEffect` members, `layer.ts`, `continuousStatics(defs)`, `staticApplies` context,
   validation; synthetic-card tests A1–A5.
3. AI readers (A6, evaluate tests for layer-only Haste and protection) and the web (A7; sheet/details).

## Acceptance

- **J6-A1** A Backup printing "Forwards you control gain +1000 power" pumps a Forward that arrives later
  and stops when the Backup leaves; the opponent's Forwards are untouched; `evaluate` prices the pump.
- **J6-A2** "Other Forwards you control gain Haste" excludes the source; a Forward that entered this turn
  may attack while the source is on the field and may not once it leaves.
- **J6-A3** A stamped bonus and a layer bonus add; the floor at 0 holds; §12.4.4 breaks a Forward whose
  layer debuff takes it to 0; a layer `cannotBeBroken` protects against the §12.4.5 break AND `breakCard`.
- **J6-A4** `when: damageReceived` gates a continuous effect by its SOURCE's controller's damage.
- **J6-A5** With no continuous source on either field a reader performs no filter matching (a counter on
  `matchesDefFilter` calls stays 0 across a full random game).
- **J6-A6** The ISMCTS observation key differs between two fields that differ by a continuous source;
  `evaluate` scores a layer-only Haste and a layer-only protection.
- **J6-A7** The web board shows the effective power, keywords and flags the engine uses (extends the C1-7
  board test); the sheet shows "8000 (printed 7000)".
- **Gates** typecheck, lint, unit, browser; the 29017ab timing script within 10 %.

## Plan review outcome (revision 1 → 2)

**Accepted (CRITICAL, 2):** `flagsOf` did not exist and flags were read raw in six places — D1 now names
the reader and slice 1 migrates every consumer; a `TargetFilter` scope would re-enter the layer — D2
restricts scopes to `DefFilter` and records dependency as a marker.

**Accepted (HIGH, 8):** the `effectivePower` migration list (state.ts, candidates.ts, commands.ts, the
abilities-engine test) is in slice 1; the WeakMap-on-state premise was false (mutable, cloned) — D4 memoises
on `defs` and scans the field; D5's conditions now attach to the effects with a source-aware context;
slice 1's `seq`/`enteredSeq` plumbing (nine sites) is DROPPED with the timestamps (D3), which also removes
the key inconsistency (D8 tests the real input); `evaluate` and the web read through the readers (D7).

**Accepted (MEDIUM, 6):** scope reuses `TargetController` + `excludeSource` (D2); `matchesDefFilter` moves
to filters.ts to avoid the cycle (D6); only the continuous kinds are indexed (D4); timestamps deferred (D3);
`CardSheet.tsx` is in slice 3 (D7); runtime validation (D9).

**Accepted (LOW, 2):** A5 is a measured call count, not a spy; the authority comments are on the checklist.

**Rejected: none.** Every finding checked out against the code.
