# Rung C7 — Removing a card from the game

> Revision 1 (2026-08-28). Follows C6, complete and reviewed.

## Context

Twenty of the starter deck's 28 printed clauses work, across 15 of its 19 cards. Eight remain.

**This rung was re-picked.** The first choice was Prishe's *"When Prishe is chosen by a Summon or an ability,
Prishe gains +2000 power until the end of the turn"* — one clause, completes a card, no new zone. Checking
C2's own notes before writing the spec turned that up as already-analysed and already-rejected:

> **C2-13** — *"Prishe c1 … needs the agenda to **preempt an active frame**, which it cannot do; targets are
> chosen while a frame is already executing."*

That is exactly right and it is fatal to a small rung. The clause only does anything if Prishe's +2000 lands
**before** the Summon that chose her resolves — that is the whole point of the card. In this engine targets
are chosen *during* a frame's execution (spec C1-6), and C2-9 established that queued work never preempts an
active frame. Making it work needs either that invariant broken or target selection moved to declaration
time; making it "work" without either produces a card that reliably gains +2000 a moment too late to matter.
Neither belongs in a small rung, and shipping the useless version would be worse than not shipping it.

## The clause

> **Undead Princess (19-052C), clause 2** — *"Remove Undead Princess in the Break Zone from the game: Choose 1
> Earth Forward. It gains +2000 power until the end of the turn. You can only use this ability during your
> Main Phase and if Undead Princess is in the Break Zone."*

Chosen because it is the one remaining clause that **completes a card** while needing only mechanical work:
one new public zone, one new cost. Her first clause already works, so after this Undead Princess joins Odin
and Cloud as a card that does everything it prints — from the Break Zone, having already been spent once.

It also unblocks Sphene's Break-Zone static, which C4 and C5 both excluded for being unobservable without a
removal effect. That clause is **not** in this rung (see C7-6), but it stops being untestable after it.

## Decisions

| # | Decision | Ruling (and why) |
|---|---|---|
| C7-1 | **A per-player `removedFromGame: CardId[]`, and it is PUBLIC** | Unlike the deck (rung C9), nothing here is hidden: both players can see what has been removed, so `viewFor` exposes it to both and `determinise` subtracts it from the unseen multiset exactly as it already does for the Break Zone. No information model is needed, which is the whole reason this rung is small and C9 is not. |
| C7-2 | **A new `AbilityCost` member: `selfRemoveFromGame`** | Alongside `selfToBreakZone` and `selfDiscard`. Its `sourceZone` is `'breakZone'`, which C3 already supports — the union has had that member since activated abilities landed, with no card using it until now. |
| C7-3 | **Removal is not a break, and not a discard** | It produces no `ZoneTransition`: a transition is `to: 'breakZone'` by construction (`rules.ts:47`), and nothing in the pool watches removal. When something does — Sphene — it gets its own observer rather than being retrofitted onto the break watcher. A distinct `removedFromGame` event carries it. |
| C7-4 | **The timing text is already satisfied** | *"only during your Main Phase"* is C3-11's global rule for every activated ability, and *"if Undead Princess is in the Break Zone"* is `sourceZone: 'breakZone'`. Nothing card-specific is needed, which is a sign the C3 primitives were cut in the right places. |
| C7-5 | **Every zone-accounting site must learn the new zone** | `checkInvariants` counts each card exactly once across zones (`invariants.ts:31`); `viewFor` builds `visibleIds`; `determinise` builds `visibleIds` and reconstructs `PlayerState`. Miss one and a removed card is either double-counted or vanishes — and the fuzzer's invariant walk is what will say so. |
| C7-6 | Not in scope | Sphene's static (it becomes buildable but is a separate clause with its own protection semantics); Prishe's clause and the preemption problem; deck knowledge (C9); everything else. |

## What could go wrong, in the order it will bite

- **A card lost from the accounting.** `checkInvariants` asserts every card is in exactly one place. The
  fuzzer runs it every command under `--strict`, so a missed zone shows up loudly — provided the new zone is
  actually added to the invariant. If it is added to `viewFor` but not `checkInvariants`, nothing complains.
- **`determinise` inventing a removed card.** Removed cards are public and gone. If their codes are not
  subtracted from the unseen multiset, the search will deal them back into a deck and reason about a game
  with 51 cards in it.
- **The target being wrong.** *"Choose 1 Earth Forward"* — an Element filter, either side of the board.
  `TargetFilter.element` exists and is unused so far, so this is its first live use and worth checking rather
  than assuming.
- **Undead Princess targeting herself.** She cannot: she is in the Break Zone, and the target spec is
  Forwards on the field. Worth a test anyway, because C3's declaration validates against the POST-cost state
  and this is the first cost that removes the source from a *non-field* zone.

## Acceptance criteria

- **C7-A1** The clause is offered by `legalCommands` only when Undead Princess is in the controller's Break
  Zone, only in a Main Phase, and only when an Earth Forward exists to target.
- **C7-A2** Activating it removes her from the Break Zone into `removedFromGame`, and the chosen Earth
  Forward gains +2000 until end of turn.
- **C7-A3 (the filter)** A non-Earth Forward is not offered; an Earth Forward on *either* side is.
- **C7-A4 (accounting)** `checkInvariants` passes with cards in the new zone, and the fuzzer's strict walk
  stays clean. A removed card is in `removedFromGame` and nowhere else.
- **C7-A5 (determinisation)** From a view where a card has been removed, `determinise` reproduces it in
  `removedFromGame` and does **not** deal it into either deck — asserted by counting, since a silently
  duplicated card is exactly what a green test suite would otherwise miss.
- **C7-A6** Removal emits `removedFromGame`, and **no** `broken`, `brokenByAbility` or `discarded` event.
- **C7-A7** `ABILITY_CLAUSES['19-052C']` unchanged at 2; implemented count +1; Undead Princess stops warning.
- **C7-A8** `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm --filter @fftcg/web build` green; fuzzer 200/200.

## What this rung will NOT claim

That the AI uses the second life well. It will spend Undead Princess from the Break Zone when `evaluate`
prefers the resulting board, and nothing teaches it that holding her is an option. One clause is far below the
noise floor of a mirrored run.
