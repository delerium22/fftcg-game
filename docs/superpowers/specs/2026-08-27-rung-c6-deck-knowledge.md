# Rung C6 (DEFERRED) — Looking at your own deck: the information model

> **Status: deferred, deliberately, after its own Codex plan-review found four blockers.** Revision 1 was
> written as the next rung; the review is
> `docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md`. Everything below is revision 1
> as reviewed — kept intact because the analysis is sound and this rung will be built eventually. What changed
> is only *when*.

## Why this is deferred, and what it would cost

The review found four blockers, none of them cosmetic, and together they describe a substrate rather than a
feature:

1. **`FieldView.deck` cannot be the knowledge model.** `PlayerState` has no knowledge state at all, so after
   Reeve bottoms two known cards nothing records that its controller still knows those positions. And
   `(CardId | null)[]` cannot express *"unknown to me, known to them"* — which is precisely what a root
   determinisation must preserve about an opponent who has looked at their own deck. Knowledge has to live
   durably in `GameState` as a per-card `knownBy` mask, projected per viewer.
2. **`determinise` must REBUILD a deck pending, not copy one.** Redacting the opponent's candidates leaves
   nothing executable, and a redacted `Pending` cannot be live state at all — `invariants.ts:62` requires
   `max <= candidates.length` and every candidate to exist. That forces a `PendingState` / `PendingView`
   split and a reconstruction step from the AST plus the sampled deck.
3. **Collapsing the action key would make the search play its opponent at RANDOM.** This one was my error and
   it is worth recording precisely: `search.ts:386` groups commands sharing a key and picks among them
   uniformly, so collapsing all of an opponent's private Reeve choices into one key does not model hidden
   information — it replaces the opponent's decision with a coin flip, the exact defect the existing
   actor-view keying was built to avoid. The fix is two identities (an actor/policy key and an observer
   transition key), not one collapsed `ActionKey`.
4. **The browser log leaks the private choice outright.** AI commands are narrated from the AI's own view
   (`useGame.ts:222`) and `describeChoice` names every chosen target (`commands.ts:241`), so an AI Reeve would
   print the card it took straight to the human. Narration has to be observer-relative.

## Why something else goes first

The decisive argument is arithmetic, and the review's own scoping section supports it. This substrate buys
**two** ability clauses (Reeve's and Miner's ETBs). Meanwhile **eight** clauses in the same starter deck are
activated abilities — Red Mage's `[Lightning][Dull]`, Noel's `[Dull], put into the Break Zone`, Miner's
`[2][Dull]`, Undead Princess's two, Geomancer's and Red Mage 18-069C's `discard`, and Sphene's `[0]` — and
every one of them is blocked on a single missing thing: there is no `activateAbility` command in the `Command`
union at all (`packages/engine/src/commands.ts:5`). They reuse the existing `Effect` AST for their effect half
and the existing `Payment` machinery for their CP half.

Eight clauses behind one primitive beats two clauses behind four blockers, and activated abilities are also
the ones a *human* feels: they are the difference between a board you watch and a board you use. Deck
knowledge is deferred until the cards that need it outnumber the cost of the substrate — Hugh Yurg's search
and EX Burst both push in that direction.

**When this is picked up again, start from the review, not from this spec.** Its staging advice stands: build
the information substrate first with no cards attached, then Reeve alone to prove private pinning, redaction,
rebinding and non-interference, then Miner to prove public visibility, known-opponent-hand persistence,
observer-relative narration, and the browser rendering the reveal at all — the board currently shows deck
count only (`Board.tsx:57`), so a "public" reveal would today be visible to nobody.

---

*Revision 1 follows, unchanged.*

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
