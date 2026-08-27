# Rung C10 — Sphene's `[0]` retrieve

**Card:** 27-126S Sphene (Lightning Forward, cost 3, 7000).

> `[0]`: Choose 1 Forward other than Sphene put in your Break Zone from the field during this turn.
> Add it to your hand. You can only use this ability during your turn and only once per turn.

The last **buildable** clause in the Vol. 2 main deck. Landing it takes coverage to 26 of 28 printed
clauses and closes MVP4 as far as this pool allows — see *What stays unimplemented*.

**Revised after a Codex plan review**, which found one blocker and five majors in the first draft. Each is
marked below with what it changed, because the reasons are the substance of this rung.

## Why this clause and not the other two

- **Sphene's static** ("All cards in your Break Zone cannot be removed from the game by your opponent's
  Summons or abilities") is a **no-op in this pool**. The only removal anywhere is Undead Princess paying
  her own `selfRemoveFromGame` cost — the controller's own card, not "by your opponent's". Implementing it
  means adding an enforcement point to a code path with no caller: the "static that nothing consults" this
  project has already declined three times. It stays unimplemented and keeps warning; the README says why.
- **Prishe's "when chosen"** is order-critical: a Summon choosing a 5000 Prishe and dealing 5000 kills it
  unless the +2000 lands FIRST. With no stack (MVP0), the choosing ability must pause mid-frame while the
  pump resolves — the agenda preemption deferred as C2-13. Implementing it without that ordering would be
  wrong rather than partial, so it stays deferred.

## What the clause needs that the engine does not have

The `[0]` cost, the Break-Zone source zone, "other than Sphene" (`excludeSourceName`) and `moveToHand` all
exist. **"During your turn" also already exists**: C3-11 restricts every activated ability to the turn
player. It needs a test, not code.

> **Plan review (11):** the first draft claimed the Main-Phase restriction as Sphene's semantics. It is
> not. Sphene says "during your turn"; Main-Phase-only is the engine's own `MVP0-SIMPLIFICATION` at
> `activate.ts`, which its comment already admits costs something (CR §9.3.1.7 permits the Attack Phase).
> The acceptance criterion below states the two separately.

### C10-1 — once per turn, per instance

The **trigger** gains `oncePerTurn?: true`; usage is tracked on the `FieldCard`.

- `FieldCard.usedThisTurn: string[]` — ability ids activated from this instance this turn.
- `activationCheck` rejects a `oncePerTurn` ability already listed; `activate` appends on success.
- Cleared with the other per-turn flags.

Per **instance**, not per player or per name: "this ability" is the ability of that card object, two copies
have separate allowances, and under CR §7.4 a card that leaves the field and returns is a NEW object in the
destination zone — so the allowance resets, which a fresh `FieldCard` models for free.

Sphene's source zone is the FIELD, so a `FieldCard` always exists to carry the marker. `oncePerTurn` on an
ability activated from `hand` or `breakZone` has no carrier and must fail loudly, not silently never limit.

### C10-2 — "put in your Break Zone from the field during this turn"

- `PlayerState.putIntoBreakZoneFromFieldThisTurn: CardId[]`.
- `TargetFilter.putIntoBreakZoneFromFieldThisTurn?: true`, checked in `matchesFilter` — **not** in
  `matchesDefFilter`, which is definition-only; this is a fact about the instance and the state.

> **Plan review (3):** first draft called it `brokenFromFieldThisTurn`. A self-payment is expressly NOT a
> break (CR §15.1.1.3.2, and this codebase already distinguishes `reason: 'cost'` from `'ability'`). The
> old name invites a future filter on `ZoneTransition.reason` that would silently drop costs. Renamed.

> **Plan review (2), and the shape of the fix:** the draft said "append wherever a card moves field → Break
> Zone" and then listed two of the **three** paths — it missed `breakCard`. Rather than enumerate paths,
> record inside `enqueueZoneChangeTriggers`, which every field → Break Zone path already calls and whose
> docblock says so in as many words. That function exists *because* `breakCard` once bypassed the old choke
> point and silently missed ~40% of the breaks its printed text named. A fourth path that forgets this now
> loses its observer triggers too — a loud, already-guarded failure rather than a quiet one.

The printed text says "put in your Break Zone from the field", not "broken", so a card paid there as a COST
qualifies. The Lightning observer already reads its own clause the same cause-agnostic way.

**Pruning is required, not optional.** A tracked id that LEAVES the Break Zone must be dropped:

> **Plan review (1), the blocker:** `moveToHand` removes the target from the Break Zone, so retrieving a
> card would immediately violate "every tracked id is in the Break Zone" — C10-A1 would fail its own
> invariant. And it is semantics, not bookkeeping: a card going Break Zone → hand → Break Zone (discarded)
> in one turn is a NEW object under CR §7.4 and must not still be retrievable.

Exits today: Break Zone → hand (`moveToHand`) and Break Zone → removed (`selfRemoveFromGame`).

### C10-3 — clear at the true turn boundary

> **Plan review (6):** `finishEndPhase` resets the per-turn flags and THEN runs a final rule-process pass.
> A field → Break Zone move produced by that pass would be recorded after the clear and survive into the
> next turn. Clear in `startTurn` instead — the actual boundary.

`FieldCard.usedThisTurn` may stay with the existing flag reset (nothing activates during that pass), but
the movement history must not.

## Visibility and search

Both new pieces are **public**: the Break Zone is public, and everyone saw the card leave the field. There
is no redaction surface. But both are new state, and every projection must carry them or silently diverge —
the half-way bug this project has hit twice (C7's `removedFromGame`, C9's deck knowledge):

`state.ts` · `setup.ts` · `resolve.ts` (fresh `FieldCard`, the predicate, pruning) · `rules.ts` ·
`activate.ts` (check, record, prune) · `phases.ts`/`startTurn` · `view.ts` · `searchView` ·
`determinise.ts` · `keys.ts` · `invariants.ts` · **`apps/web/src/game/commands.ts`**, which rebuilds a
`PlayerState` field by field (plan review 7 — a boundary the draft missed entirely).

**Keys (plan review 9):** sort `usedThisTurn` in the digest — it is a set, and activation order must not
split an information set. Encode Break-Zone eligibility **positionally**, beside each `bz[…]` entry, not by
code: two same-code cards in the Break Zone can differ in eligibility, and `z0:0` and `z0:1` are then
different legal actions that a code-only digest would collide.

**Invariants (plan review 10):** every tracked id is in that player's Break Zone; no duplicates in either
array; every id in `usedThisTurn` names a `oncePerTurn` ability that card actually has — which is also what
enforces the "non-field `oncePerTurn` is a spec error" promise.

## Acceptance

- **C10-A1** Retrieves a Forward broken from the field this turn: Break Zone → hand, invariants clean after.
- **C10-A2** Does NOT offer a Forward discarded from HAND this turn, one broken on a PREVIOUS turn, Sphene
  itself, or a Backup/Summon in the Break Zone.
- **C10-A3** All THREE producers count, tested separately (plan review 12): the rule process, `breakCard`,
  and the `selfToBreakZone` cost.
- **C10-A4** Second activation the same turn is illegal; legal again on that player's NEXT Main Phase with
  an eligible target present. Separately: a Sphene that leaves the field and returns in the same turn has a
  fresh allowance, and two instances have separate ones.
- **C10-A5** Illegal on the opponent's turn (Sphene's printed text). Separately, illegal outside a Main
  Phase — under the engine's existing `MVP0-SIMPLIFICATION`, not as Sphene semantics.
- **C10-A6** With nothing retrievable the ability is not offered at all — no dead prompt.
- **C10-A7** A card retrieved to hand and re-discarded in the SAME turn is no longer retrievable, and
  invariants stay clean throughout (the blocker, as a test).
- **C10-A8** `searchView` equals `viewFor` and `determinise` round-trips both fields, from a fixture with
  NON-DEFAULT values — non-empty usage and mixed eligible/ineligible Break-Zone cards (plan review 14: with
  both arrays empty the assertion passes even if both projections drop them).
- **C10-A9** Two states differing only in `usedThisTurn`, or in eligibility between two SAME-CODE Break
  Zone cards, key differently (plan review 9).

Every criterion is verified by MUTATION. The four wrong implementations the review named must each be
reinstated and shown to redden a test: omitting `breakCard`; a player-global boolean instead of
per-instance; a stale un-pruned history entry; and code-only key encoding.

## What stays unimplemented after this rung

26 of 28. Sphene's static (no-op in this pool) and Prishe's "when chosen" (agenda preemption, C2-13). The
README states both; the in-game log keeps warning on those cards.
