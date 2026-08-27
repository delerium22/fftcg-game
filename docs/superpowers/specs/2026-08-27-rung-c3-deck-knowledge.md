# Rung C3 — Looking at your own deck: the information model, and the two cards that need it

> Revision 1 (2026-08-27). Prerequisite reading: the "What C2 actually built, and what C3 inherits" section of
> `2026-08-27-rung-c2-observer-triggers.md`, and the "WHAT I WOULD DO DIFFERENTLY" section of
> `2026-08-27-rung-d2-search-worker.codex-code-review.md`, both of which say the same thing: decide the
> visibility model **before** adding any deck target.

## Context

Ten of the starter deck's 28 printed ability clauses work. The next ones in line all touch a zone no ability
has touched yet — the **deck** — and the engine cannot currently express them for a reason that is not about
targeting at all.

`Pending.chooseTargets` carries materialised `CardId`s (`packages/engine/src/state.ts:36`). `viewFor` copies
`state.pending` wholesale to **both** players (`packages/engine/src/view.ts:33`), and `determinise` mints
fresh ids for every hidden card and then copies the stale pending ids over the top
(`packages/engine/src/determinise.ts:41`). So a deck target today would be simultaneously **orphaned** for the
player choosing (ids that name nothing in their view) and **leaked** to the player not choosing. Neither is a
bug in targeting; both are the absence of a model for *who knows what*.

## The two cards, and why they are one card

| | Miner (20-074C) | Reeve (20-105C) |
|---|---|---|
| Trigger | ETB | ETB (printed `EX BURST`) |
| Sees | **reveal** the top 5 — public | **look at** the top 3 — private |
| Takes | 1 **Backup** among them → hand | 1 **card** among them → hand |
| Rest | to the bottom of the deck, in any order | to the bottom of the deck, in any order |

Structurally identical: *expose N from the top, take one matching a filter, bottom the rest.* They differ only
in **N**, in the **filter**, and in **who is allowed to watch**. That last difference is the whole rung — it is
the smallest pair of cards that forces the private/public distinction to be built properly rather than fudged,
which is exactly why they are the right two to do first.

As with Noel and Lightning in C1, the printed `EX BURST` tag on Reeve is quoted but not implemented: the
clause fires on a normal cast, which is what `enterField` means. EX Burst itself stays out of scope.

## Decisions

| # | Decision | Ruling (and why) |
|---|---|---|
| C3-1 | **Knowledge is per player, and lives in the view's deck** | `FieldView.deckCount: number` becomes `FieldView.deck: readonly (CardId \| null)[]` — one slot per card, non-null **only** where that viewer legitimately knows what is there. The count is `deck.length`, so nothing is lost. This is the minimal representation that can express "I know my top 3 but not my fourth", which is precisely what Reeve creates. |
| C3-2 | **`determinise` pins what is known and samples the rest** | Non-null slots keep their id and code and are removed from the unseen multiset before shuffling, exactly as field and hand cards already are (`determinise.ts:38`). Everything else is sampled as today. Without this, an AI that looked at its own top 3 would re-randomise them the instant it tried to think about them — the search would be reasoning about a deck it had just been told it did not have. |
| C3-3 | **`viewFor` redacts pending candidates the viewer cannot see** | A `chooseTargets` whose candidates include hidden cards is filtered to those visible **to that viewer**, and carries `hidden: number` for the remainder. The opponent of a Reeve therefore sees "choosing 1 of 3 cards" and no identities. Redaction happens at the view boundary, not at the prompt, because the view boundary is the only place that knows who is asking. |
| C3-4 | **A private choice by the OPPONENT must key on what was observed, not on what was sampled** | In ISMCTS, an opponent's private deck choice is re-sampled every determinisation. Keyed by card identity, one real decision would shatter into dozens of tree nodes that the searcher can never tell apart in play — and each would be conditioned on information the searcher does not have. Action keys for a non-root player's private choice collapse to the observable form (`take 1 of N from deck`). This is the D2 review's warning that "Reeve's private look invalidates the search's assumption that every action becomes public", answered. |
| C3-5 | **`reveal` and `look at` are one primitive with a visibility flag** | `lookAt { count, visibility: 'public' \| 'private', filter, take }`. Public grants the knowledge to both players, private only to the controller. Building these as two effects would duplicate the ordering, filtering and bottoming logic to express a difference of one field. |
| C3-6 | **MVP0-SIMPLIFICATION: "in any order" becomes a fixed order** | The rest go to the bottom in their revealed order; the player is not asked to arrange them. Asking would add a permutation decision (4 cards = 24 orderings) to every Miner, for cards going to the **bottom of a 40+ card deck**, which in a game this length will almost never be drawn. Marked `MVP0-SIMPLIFICATION` at the site with this reasoning, and listed in the README's deviations. |
| C3-7 | Not in scope | **Hugh Yurg** (searches the *whole* deck, and *plays* the card onto the field rather than taking it to hand — that needs a put-into-play-without-paying effect); **Cloud's Attack-Phase clause** (needs attack entry split into preparation + continuation); EX Burst; Sphene; the "in any order" prompt. |

## What could go wrong, in the order it will bite

- **The knowledge model leaks the other way.** The interesting failure is not "the opponent saw my card" but
  "the AI saw its own deck when it should not have". `determinise` is the AI's only window onto hidden state,
  and it is *supposed* to invent cards. Pinning slots is a deliberate hole in that invention, so the pin must
  be driven by the view — never by ground truth. A test that determinises from a view and asserts that
  **only** the pinned slots are stable is the guard.
- **`deckCount` → `deck` touches every view consumer.** Cheap but wide; the compiler finds them all.
- **The AI has no reason to value knowledge.** `evaluate` scores material and tempo; knowing the top 3 of your
  deck scores zero. Reeve and Miner will be played for their bodies and their card, which is *most* of their
  value — but the ordering choice among revealed cards will be made by whatever the search's tie-break
  happens to be. Say so rather than claim the AI plays them well.

## Acceptance criteria

- **C3-A1** Miner's ETB reveals the top 5 publicly, adds a chosen **Backup** among them to hand, and bottoms
  the rest; if there is no Backup among the five, the reveal still happens and nothing is added.
- **C3-A2** Reeve's ETB shows the top 3 **to its controller only**, adds a chosen card to hand, bottoms the
  rest. A view built for the opponent contains **none** of the three identities, and its pending reports
  `hidden: 3`.
- **C3-A3 (the determinisation guard)** From a view in which the controller knows its top 3, `determinise`
  reproduces those three ids and codes **exactly**, and samples every other deck slot. From the opponent's
  view of the same state, all three are sampled.
- **C3-A4 (no leak through the search)** Two determinisations of the same opponent-private choice produce the
  **same** action key, and that key does not name a card.
- **C3-A5** A deck with fewer cards than the reveal count reveals what is there and does not throw; an empty
  deck is a no-op, not a loss (deck-out is checked by its own rule process).
- **C3-A6** `ABILITY_CLAUSES` for both cards drops by one clause each, the amber "not implemented" warning
  stops naming the implemented clause, and the marker audit still passes.
- **C3-A7** `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm --filter @fftcg/web build` green; fuzzer
  200/200 with zero failures; ISMCTS still beats greedy over a mirrored run (no strength claim beyond "not
  worse" — see below).

## What this rung will NOT claim

It will not claim the AI plays these cards *well*. The honest statement after C1/C2/D1 is that a win-rate gate
cannot see the defects that matter, and a two-card ability addition is far below the noise floor of a 120-game
mirrored run. The strength gate here is a **guard against regression**, not evidence of improvement, and the
report will say so.
