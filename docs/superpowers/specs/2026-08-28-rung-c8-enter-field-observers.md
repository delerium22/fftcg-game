# Rung C8 — Watching cards arrive

> Revision 1 (2026-08-28). Follows C7, complete and reviewed.

## Context

Twenty-one of the starter deck's 28 printed clauses work, across 15 of its 19 cards. Seven remain, and only
one group is bigger than a single clause:

| Needs | Clauses |
|---|---|
| Deck knowledge (rung C9) | 3 — Miner's reveal, Reeve's look, Hugh Yurg's search |
| **An enters-field observer** | **1** — Hugh Yurg's second clause |
| Field→Break-Zone this-turn history + once-per-turn | 1 — Sphene's `[0]` |
| — **blocked** | 1 — Sphene's static (nothing removes an *opponent's* card, so it guards nothing) |
| — **blocked** | 1 — Prishe (needs the agenda to preempt an active frame, C2-13) |

Deck knowledge is the largest, and it is the four-blocker substrate whose own review says to stage it as
*substrate with no cards, then Reeve, then Miner*. That is the right next big piece of work and it is not a
small rung. This one is: a single clause that **extends machinery C2 already built, in the mirror direction**.

## The clause

> **Hugh Yurg (24-063H), clause 2** — "When a Forward of cost 1 enters your field, choose 1 Forward. Until the
> end of the turn, it gains +2000 power and Brave."

C2 built `observesZoneChange` for cards leaving the field for the Break Zone. This is the same shape pointed
the other way: a card *arriving*. The watcher, the "whose field" resolution, the per-occurrence trigger and
the ordering rules are all already settled — this reuses them rather than inventing a second dispatch.

It also has a live interaction with the rung just finished: **Undead Princess is a cost-1 Forward**, and C7
gave her a second life from the Break Zone. Playing her under a Hugh Yurg is a real line.

## Decisions

| # | Decision | Ruling (and why) |
|---|---|---|
| C8-1 | **A new trigger `observesEnterField`, mirroring `observesZoneChange`** | `{ kind: 'observesEnterField'; whose: TriggerWhose; of: CardType; filter?: TargetFilter }`. Not a new mechanism: `whose` resolves against the **watcher's** controller exactly as C2-10 settled, and a matching clause is enqueued per arrival. |
| C8-2 | **The watcher is read AFTER the card has arrived** | The mirror of C2-4, which snapshots watchers *before* a batch leaves. A card that enters can itself be watched, and a watcher that just arrived can watch — both follow from reading the post-arrival field, and both are what the printed text implies by "enters your field". |
| C8-3 | **`TargetFilter` gains an exact `cost`** | It has `maxCost` (Lightning's "cost 4 or less") but nothing for "of cost 1". Exact, not a ceiling: a cost-3 Forward must not trigger Hugh Yurg. |
| C8-4 | **The entering card's OWN clauses queue first** | `dispatch(enterField)` already runs for the arriving card; the observers queue after it. Two clauses reacting to one arrival is an ordering the CR gives to the active player and MVP0 gives to queue order (spec C1-4), so this is a documented simplification, not a claim of correctness. |
| C8-5 | **Dispatched from wherever a card ENTERS THE FIELD, which is one place today** | `cast.ts` after the field arrays are updated. Hugh Yurg's *other* clause will add a second entry point (put into play from the deck without casting), which is rung C9 — this is written as a helper so that path calls the same one rather than growing a parallel copy. |
| C8-6 | Not in scope | Deck knowledge (C9) and Hugh Yurg's first clause; Sphene; Prishe. Hugh Yurg therefore still warns about one clause, and `ABILITY_CLAUSES` does not move. |

## What could go wrong, in the order it will bite

- **"Your field" resolved against the turn player.** C2-10 already had to fix this once for
  `observesZoneChange`: a watcher's "your"/"opponent's" is relative to **its own controller**, never to whose
  turn it is. A fixture with one Hugh Yurg on one side cannot tell the two apart, so the test needs one on
  each.
- **An exact cost filter that is really a ceiling.** `maxCost` exists and is the obvious thing to reach for.
  A cost-3 Forward triggering Hugh Yurg would be invisible in any test that only ever plays cost-1 Forwards.
- **The observer firing on a Backup.** "a **Forward** of cost 1" — `of: 'forward'`. C2 made this restriction
  explicit for exactly this reason: leaving it implicit in "the producer happens to scan the forwards array"
  is how it fires on the first Backup a later rung moves.
- **Nothing firing at all**, because the dispatch went in before the field arrays were updated. The watcher
  must see the arrived card, so the call site matters and a test that only asserts "no crash" would miss it.

## Acceptance criteria

- **C8-A1** Casting a cost-1 Forward with a Hugh Yurg on the field raises Hugh Yurg's target choice, and the
  chosen Forward gains **+2000 power and Brave** until end of turn.
- **C8-A2 (exact cost)** Casting a cost-2 or cost-3 Forward raises nothing.
- **C8-A3 (whose field)** With a Hugh Yurg on **each** side, only the one whose own field the card entered
  triggers. Asserted separately, because one Hugh Yurg cannot distinguish it.
- **C8-A4 (type)** A cost-1 **Backup** entering raises nothing.
- **C8-A5** The arriving card's own `enterField` clauses still fire, and still fire first.
- **C8-A6** `ABILITY_CLAUSES['24-063H']` unchanged at 2; implemented count +1; Hugh Yurg still warns about
  its remaining clause.
- **C8-A7** `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm --filter @fftcg/web build` green; fuzzer 200/200.

## What this rung will NOT claim

That the AI plays around it. `evaluate` will see the resulting board and nothing teaches it that holding a
cost-1 Forward until a Hugh Yurg is out is a line. One clause is far below the noise floor of a mirrored run.
