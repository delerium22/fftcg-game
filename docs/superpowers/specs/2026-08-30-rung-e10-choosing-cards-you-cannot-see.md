# Rung E10 — choosing between cards you cannot see

> **STATUS: SPEC, awaiting plan review.** Nothing built.
>
> Named by E9's own known limit, not by a new session of play. E9 made every button read differently; it did
> not make every button's subject *visible*, and for three kinds of choice there is nothing on screen at all.

## The defect

Three commands name cards the board does not draw:

| Choice | Where the card is | What the board shows |
|---|---|---|
| Billy Bob / Prishe "choose 1 Character in your Break Zone" | Break Zone | a **count** |
| Undead Princess's ability, used from the Break Zone | Break Zone | a **count** |
| Hugh Yurg's "search your deck" | deck | **nothing** |

E9 gave each of these a distinct label — `Target Cloud (1)` / `Target Cloud (2)`, `Play Luso (1) onto the
field`. That removed the ambiguity between *buttons*. It did not give the player anything to look at. To
choose between "Cloud (1)" and "Cloud (2)" a player must know which Cloud in a face-down pile is which, and
nothing on screen tells them. For the deck search it is worse: the player is picking a card out of a
fifty-card list they have never seen, by name alone, with no cost, element, power or text.

E9's ruling asked for an identifier that corresponds *visibly and accessibly* to a rendered card. For these
three it corresponds to nothing. I wrote that limit down rather than papering over it; this rung is the fix.

## Why it matters for the actual goal

The goal is a game the user can play. A search is one of the strongest effects in this pool — Hugh Yurg picks
any card in the deck and puts it into play — and right now it presents as a list of bare names. A player who
does not have the card pool memorised cannot make that decision at all. This is not a polish rung.

## Scope

Render the candidates of a choice whose subjects are not otherwise on the board, as cards, using the SAME card
component the hand and field already use — so cost, element, type, power and the E9 occurrence marker all come
along for free, and there is exactly one card renderer rather than two that can drift.

**In scope:** `chooseTargets` over the Break Zone; `chooseFromDeck` (both `to: 'field'` searches and
`to: 'hand'` looks); activations whose source sits in the Break Zone.

**Out of scope, deliberately:**
- A general Break Zone browser (viewing the pile when no choice is pending). That is a convenience; this rung
  is about a decision the player cannot currently make.
- Any change to `legalCommands`, the engine, or what is legal. Same as E9.
- Card images. The pool plays with zero art (the CDN blocks this IP); this must work from text.

## Acceptance

- **E10-A1** At a reachable Break Zone `chooseTargets`, the candidate cards are rendered, and each rendered
  card's accessible name matches the label of the choice that selects it — asserted as exact strings, both
  directions.
- **E10-A2** At a reachable `chooseFromDeck` search, likewise; and the rendered candidates are exactly the
  cards the pending makes eligible — no card the player may not pick is shown, and none they may pick is
  hidden. Asserted against `deckPickCandidates`, not against a hand-written list.
- **E10-A3** Clicking a rendered candidate submits the command naming **that** `CardId`. The E9 failure mode
  (one representative filed under several ids) must be impossible here too.
- **E10-A4** Nothing hidden leaks: at a `chooseFromDeck` the rest of the deck is NOT rendered, and the
  opponent's Break Zone is not rendered by a choice over your own. Asserted from the DOM, not from intent.
- **E10-A5** The candidate row disappears when the pending resolves — no stale cards left on the board.
- **E10-A6** A browser check (`pnpm test:browser`): the candidates are reachable and named in the accessibility
  tree Chromium actually computes, not merely present in the jsdom DOM.
- **E10-A7** Mutations: render the wrong zone; render all deck cards rather than the eligible ones; map every
  candidate to the first id; leave the row mounted after the pending clears. Each must fail a test.
- **E10-A8** Existing tests pass **unedited**; full gates green.

## Risks I can see

- **The orphan row already exists.** The Codex review mentioned `Board.tsx` rendering some choices through an
  "orphan row" without applying `occurrenceOf`. I have not read that code yet. This rung may be an extension
  of it rather than a new component, and the plan should establish which before any code is written.
- **Leaking the deck is a correctness bug, not a cosmetic one.** `viewFor` already decides what a player may
  see; the renderer must read the view and never the state. If I find myself reaching for `GameState` in the
  React tree, the design is wrong (spec B3).
- **The eligible set is the engine's rule.** `deckPickCandidates` computes it. Re-deriving the filter in the
  UI is how the two would silently diverge, exactly as C7's zone did.
