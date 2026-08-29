# Rung E11 — you don't get to choose what you pay with

> **STATUS: REVISED after plan review. My headline claim was wrong** and the original is preserved below,
> because the correction is the useful part. Nothing built.
>
> The file was called "the cards it throws away for you". That title asserted the app chooses *badly*. It does
> not; it chooses by a value function, and my measurement disagreed with that function rather than exposing a
> mistake in it. The defect is that **the player is not allowed to choose at all** — which is enough, and did
> not need the exaggeration.

## What I claimed first, and why it was wrong

I wrote that the app "throws away your best cards for you", citing a cast that discards **Lightning** — this
deck's 7-cost bomb — plus Miner, when Noel plus Undead Princess was equally legal. Printed cost 10 against 6.

`preferredPayment` does not rank by printed cost. It minimises a value function: a dulled Backup costs `1`, a
discard costs `2 + cardValue`, where a Forward is `power/1000 + 1.5` (+0.5 at cost ≥ 5) and a Backup is
`3.5 − cost × 0.15` (`packages/ai/src/payment.ts:59`, `cardValue.ts:3`). On that scale my "worst case" is:

| Payment | Score |
|---|---|
| Lightning + Miner (**kept**) | 13 + 5.05 = **18.05** |
| Noel + Undead Princess (hidden) | 13 + 5.5 = **18.5** |

Both Forwards score 11, so the entire difference is Miner against Undead Princess — **0.45** — and the
selector kept the one it scores as cheaper. It is doing exactly what its own comment says it exists to do:
"stop the AI discarding an 8000-power Forward to pay for a draw."

So the sound claim is only: *in N observed cases the preferred payment discarded more printed COST than
another legal payment*. That is my proxy disagreeing with a better one. It is **not** evidence the selector
chose badly, and presenting it that way was the same error as E9's "verified at three layers" — reading real
evidence and over-claiming from it.

## The defect, stated at the size it actually is

To cast a card, or pay for an activated ability, you discard cards from hand and dull Backups as CP.
`legalCommands` enumerates every minimal payment; `preferredChoices` collapses them to one button per action
(spec B6). **The player cannot choose which of their cards are spent.** Whatever the selector's judgement,
this is a decision about the player's own hand that the player never sees offered.

That it is disclosed in the label before the click is what makes it a lesser sin than E4's, where the
disclosure came afterwards. It is still not a choice.

## Measurement, with the method that makes it reproducible

The first version of this spec gave numbers with no method attached, and the reviewer's own replays produced
three different sets from three legitimate human policies. That is not a measurement, it is an anecdote with
digits. Re-run and stated in full:

- **human policy** — take the first non-concede choice of `buildChoiceSet(view, preferredChoices(view, legal)).all`
- **opponent** — `GreedyAgent({ seed, decks: DECKS, depth: 1 })`, same seed as the game
- **seeds** — 1..12, `createGame({ seed, decks: DECKS, defs: CARD_DEFS })`
- **payment identity** — exact: `dullBackups` sorted, plus discards sorted by `card:element`
- **counted** — at every state where `actingPlayer === HUMAN`, before the human's choice is applied

| | |
|---|---|
| human decision points | **390** |
| casts offering ≥2 distinct payments | **170** |
| activations offering ≥2 distinct payments | **41** |
| most exact payments for one action | **30** |

Per seed (decisions/casts/activations): 1:24/10/1 2:23/16/2 3:41/8/4 4:40/19/17 5:28/13/1 6:41/14/0 7:24/7/2
8:42/16/2 9:30/12/1 10:24/19/1 11:33/18/3 12:40/18/7.

This reproduces the reviewer's independent "first UI choice" row exactly (390 / 170), which is the point of
writing the policy down. My original 644 / 230 / "up to nine" came from a different, unrecorded policy; **30**
is the observed maximum here and is a property of this trace, not a bound on the interface.

## Scope

**Casts AND activations.** The same code collapses both (`payableKey`), and 41 activation positions in the
trace above have the identical defect. Leaving them out would leave the defect standing.

**Do not flatten targets × payments into a Cartesian product.** E10 deliberately made an activation's source
and targets subjects while excluding payers. That stands: the semantic action is *source + ability + target
set*, and payment is an attribute of it, not another axis of it. Nor may payer cards become subjects — that
would put "use this card", "target this card" and "spend this card" into one `byCard` list and collide head-on
with what E9 and E10 settled.

**Out of scope:** any change to `preferredPayment` itself. See *A real AI defect* below — it exists, it is
narrower and stronger than what I claimed, and it belongs to an AI rung with its own oracle tests.

## Shape: (A), and the one-click contradiction that has to be resolved first

The reviewer ruled for **(A)** — disclose the engine-enumerated payments for one semantic action — over (B),
clicking cards to nominate CP sources. (B) needs a new selection mode, multi-select state, confirm/cancel,
partial-payment validity, and a way to tell "click as source" from "click as target" from "click as payer".
(A) is not a stopgap that (B) will replace: disclosing enumerated valid payments avoids invalid partial
nominations entirely and is far easier to operate accessibly.

**My proposed flow could not work, and the review caught it.** I wrote "selecting a card with several payments
shows a *pay differently* option". But after collapsing, such a card has exactly ONE choice, and `pick`
commits immediately on a single choice (`Board.tsx:275`) — it only selects when there are several. There is no
selected state in which my affordance could ever appear, so my own A4 ("no extra clicks") contradicted my own
flow.

**Resolution: a multi-payment action SELECTS rather than commits.** The strip then shows its preferred action
plus one disclosure of the alternatives. This costs one extra click on exactly those actions that hide a
choice, and leaves single-payment actions committing on one click as they do today.

I take that trade deliberately: an action concealing a decision about your own hand is precisely the one that
should not fire the instant you touch it, and it keeps the rule the board already has — *several options means
select, one option means act*. A4 is rewritten to match rather than left contradicting the flow.

## Acceptance

Rewritten to the review's audit. Each names the guard that stops it passing vacuously.

- **E11-A1** At a reached position, for a cast AND for an activation each offering ≥2 distinct payments, the
  set of payments reachable through the interface equals the normalised set from raw `legalCommands`. Guard:
  assert the multiplicity from `legalCommands`, never from what the UI rendered — expectations derived from
  the rendering would validate the rendering against itself.
- **E11-A2** A cast with exactly ONE legal payment still commits on a single click. Guard: the payment must be
  non-empty and uniquely legal — a free (`amount: 0`) cast would pass this while proving nothing. Seed 11's
  forced Sphene discard is a suitable pinned route.
- **E11-A3** Choosing a NAMED non-preferred payment applies that payment: assert the applied command's
  `payment` differs from the preferred one and equals the chosen one. Driving only the preferred option would
  be vacuous.
- **E11-A4** *(rewritten — the original contradicted the flow)* The preferred payment is the default and is
  reachable in one click from the disclosure; a single-payment action still needs no disclosure at all.
  Asserted by mounting `Board` and counting `choose` calls, not by calling `preferredChoices` directly.
- **E11-A5** Every alternative is a control whose accessible name states **every dulled Backup, every
  discarded card, and each discard's declared element** — not merely "which cards". Guard: at least two
  alternatives, and an E9 same-name case so the occurrence marker is exercised. Asserted in the browser.
- **E11-A6** *(the prohibition, which nothing previously enforced)* In the initial state of such a position the
  main strip offers ONE action per semantic action plus at most one disclosure; the alternatives are absent
  until asked for. Without this, an implementation that simply stops collapsing — every payment as its own
  button, the thing this rung must not do — would satisfy every other criterion.
- **E11-A7** Mutations, each against a guarded fixture: offer only the preferred payment; map every
  alternative to the preferred command; drop the payment from the label; change the default; dump every
  payment into the main strip; omit activation payments; collapse activation TARGETS while grouping payments;
  drop dulled Backups from the accessible name; treat two payments differing only in declared element as one.
- **E11-A8** Existing tests pass unedited; gates green. **A regression gate, not evidence for E11.**

## A real AI defect, found by the review, deliberately not fixed here

`preferredPaymentFor` exhaustively optimises only the required-element assignment, then greedily tops up and
strips redundant sources — it never globally minimises the final payment's value (`payment.ts:116,142`). At a
reached seed-3 position it is **strictly dominated**:

| | printed cost | its own score | CP sources |
|---|---|---|---|
| chosen: dull field Red Mage + discard Miner | 3 | 6.05 | 2 |
| hidden: discard hand Red Mage | 1 | 5.35 | 1 |

Worse on printed cost, worse on the selector's **own** objective, and spends more sources. That is a genuine
defect and much rarer than my 76 proxy disagreements, but far stronger evidence — it needs no proxy at all.

It stays out of E11: this rung is player agency, and changing `preferredPaymentFor` changes AI play and wants
an AI rung with an exhaustive oracle to check against.

## Order, as ruled

1. **E11** — payment agency. `preferredChoices` removes commands before the board ever sees them.
2. **The multi-action announcement rung** — `actionFor` withholds narration, but a multi-action card is still
   fully operable: clicking selects it and the strip lists its actions. Less severe, so it comes second.
3. **The AI payment-optimiser rung** — the strict-dominance defect above.

## Corrections carried from the review

- "Up to nine payments" was a trace figure I implied was an interface bound. The observed maximum is **30**.
- "Cards thrown away" is incomplete: payments also differ by **dulled Backups**, which cost the player a CP
  source for the turn and must appear in every label and every assertion.
- Two payments spending the same cards but declaring different elements ARE distinct to `samePayment`
  (`commands.ts:777`), even where the resulting board is identical. E11 treats them as distinct, because the
  command model does, and a mutation checks that they are not silently merged.
