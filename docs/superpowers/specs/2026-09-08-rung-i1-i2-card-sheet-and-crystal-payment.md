# Rungs I1 and I2 — the card sheet, and paying crystal by crystal

> **STATUS: BUILT 2026-09-08** (commits ed0be07 and the polish after it; verified: typecheck, lint, 1073 unit tests, 13 browser tests, and played by hand on seed 11). Asked for by the user in one message: *"when you click a card it
> will enlarge it and bring it to the centre of the screen so we can see the full card text. From there there
> should be options next to it to show what you can do (play, back) etc; if you don't have enough of what's
> needed to pay then the pay button should be greyed out. Instead of choosing options when 'paying', make it so
> to use a card/pay we click it then pay, then we get a nice animation of crystal symbols that are greyed and
> then you select what cards to use to pay for it — dull a backup and it shows dulled and a crystal lights up,
> or select a card in your hand to discard for two of that element and those cards are highlighted and the
> greyed crystals fill up. When all are lit you can select a confirm/pay button to execute."* The user was not
> available for design questions; the calls below are mine, recorded so they can be overturned rather than
> rediscovered.

## What changes, in one paragraph

Today a click on a card either **commits** (one choice, one payment), **selects** it so the strip grows its
buttons, or opens a list of whole pre-baked payments ("Pay differently", rung E11). After this rung a click on
**any** card — yours, the AI's, in hand, on the field, in an open pile, actionable or not — opens **the card
sheet**: the card at three times its hand size in the centre of the screen, its printed text at reading size
beside it, and one button per thing the card can do right now, plus Back. Nothing commits from the board any
more. A cast or a CP-costed ability does not commit from the sheet either: it opens **the payment tray** in
the prompt strip's row, showing the cost as greyed crystals, and the board's backups and hand become the
things you click to light them. Confirm submits the exact payment you built.

## I1 — the card sheet

**I1-D1 — a native modal `<dialog>`, the third in the app.** Same mechanism as game over and How to play:
`showModal()`, focus on the heading, Escape closes (there is a board to return to), `aria-modal`,
`aria-labelledby` the card's name. Modal, so a click meant for the sheet's Cast can never land on the board
behind it. The buttons are one Tab from the heading.

**I1-D2 — every card is a button.** A card with nothing to do today renders as `role="img"`, reachable only
through its grid cell; the mulligan hand and the AI's whole board are read by hover or arrow keys only. Now
every card is a `<button>` whose press opens its sheet, and `CardGrid`'s cell-as-focus-target branch is no
longer exercised by the board (it stays, unused, for one rung; removed when nothing needs it). The
`is-selectable` lift and rim keep their meaning — **"you can act on this"** — and now attach to the new
`actionable` prop rather than to button-ness.

**I1-D3 — the sheet's buttons are the card's `byCard` choices, headlined.** One button per `Choice` under
that card, in `legalCommands` order. A payable choice (cast, or an activation with a CP cost) is headlined
**without** its payment — "Cast Ramuh", "Class Tenth Moogle's [Dull]: …" — because pressing it opens the tray
where the payment is chosen; naming a payment the press will not make is the E4 defect. `describeChoice` gains
a `{ payment: false }` option rather than a regex over the English. Non-payable choices keep their full label
("Block with Luso", "Attack with Cloud + Luso", "Dull Cloud and Prishe"), and pressing one commits and closes
the sheet. A free cast (cost 0 after Odin's reduction) commits directly: there is no crystal to light.

**I1-D4 — a hand card that cannot be cast shows a disabled Cast with the reason.** The reason comes from the
engine: `castCheck` (phase, priority, pending, five backups, same-name clash) mapped to player English, and
when it returns null but no cast is legal, "Not enough CP". The button is `disabled` with the reason as
visible text under it and in `aria-describedby`; a disabled control with no stated reason is the "greyed
button that will not say why" the How-to-play sheet promised not to have. Only **your hand** gets this; the
AI's hand is face down and a field card has no cast.

**I1-D5 — the card's accessible action changes shape.** F6 gave every pressable card an `action`: the exact
label when the press commits, `N options` or `N ways to pay` otherwise. No press commits now, so the three
forms become two: **the headline of its sole choice** ("Cast Ramuh", "Block with Luso") when there is one,
`N options` when there are several, and nothing when the card is only readable. The details panel shows the
same string. The sheet is where the full label (with payment, after I2 builds it) is read before committing.

**I1-D6 — the strip keeps only subjectless choices.** Pass, Concede, Keep/Mulligan, modes, "Choose no
targets", EX Burst use/decline, first-turn choice. The `selected`-card strip growth and "Pay differently" go;
the concede arming, focus restoration and live region are untouched.

**I1-D7 — hover still reads.** The rail's details panel keeps following the pointer and focus. The sheet is
for deciding; the panel is for glancing.

## I2 — the payment tray

**I2-D1 — the tray replaces the strip's row while paying.** The prompt strip is the centre row of the board,
between the two fields, which is exactly where a thing you pay for with cards from both rows belongs. While
paying, the strip renders the tray instead of its buttons: the card being paid for (small), a title ("Paying
for Ramuh"), the crystal row, the running total as text, and four controls: **Auto** (fills the payment the
AI's chooser prefers — the one E11's collapse used to submit silently), **Clear**, **Cancel**, **Confirm**.
The prompt's live region says what is being asked and, on every change, how much is paid.

**I2-D2 — crystals are the cost, element-first.** `castRequirement` / `abilityCpRequirement` give `amount`
and a multiset `requiredElements`. The row draws `amount` crystals: one per required element, tinted with
that element and labelled with it, then the rest untinted ("any"). A crystal is greyed until paid. The shape
is the faceted gem `Card.css` already draws for missing art.

**I2-D3 — sources are the cards; clicking toggles.** While paying, the board's clickable set is not
`choices.byCard` but the **candidate sources**: your active backups and your hand cards that appear in at
least one legal payment for this move. A source is selectable iff adding it to the current selection is still
a subset of some legal payment (the union of the collapsed choice and its `alternatives`, i.e. exactly the
minimal payments `legalCommands` enumerated). That keeps legality with the engine: the tray can only ever
build a payment the engine listed, so `useGame.choose`'s membership check holds by construction and the
picker never invents a rule. A selected backup renders dull with a "dulls" badge; a selected hand card gets a
danger-tinted ring and a "discard" badge; either announces its role ("dull for 1 earth CP", "discard for
2 lightning CP").

**I2-D4 — a two-element discard asks which element, only when it matters.** Shantotto and Billy Bob are
earth/lightning. If both declarations keep the selection extendable, the tray shows "Discard Shantotto as:
Earth / Lightning" and waits; if only one does, it is taken. The declared element is part of `Payment`
(one discard is two CP of **one** element), so the choice is real.

**I2-D5 — lighting is display; legality is the engine's.** Which crystals light is computed in the browser
from the engine's own `generateCp` (which also validates every click) by matching required crystals first
and pouring the remainder into the untinted ones. The tray's "all lit" and the engine's `canPay` are pinned
equal by a property test over real positions, and Confirm is enabled only when the selection **equals** a
legal payment — which, given I2-D3, is exactly when every crystal is lit.

**I2-D6 — activations pay the same way.** An activated ability whose cost has CP goes through the tray with
its own requirement and its own alternatives (targets already fixed, as E11's `payableKey` fixes them). A
`[Dull]`-only or Break-Zone-only cost commits from the sheet: there is no CP to pick.

**I2-D7 — any change of position cancels the tray.** As E11 did: the tray is dropped on every new choice set,
because its buttons spend cards and must never refer to a stale board.

## Rejected

- **Keeping one-click commit for target answers** and opening the sheet only for hand cards. Two click
  behaviours on one board is the confusion F6 measured; the sheet costs one press and buys a read-before-commit
  on every card, including the blocker decision.
- **Pre-filling the tray with the preferred payment.** The user asked to choose; Auto is one press away.
- **Letting the tray over-pay** (CR §11.2.2.3 allows generating excess). The browser's membership check would
  refuse it and the engine's minimal enumeration is the honest list; nobody wants to dull a third backup for a
  two-cost card.
- **A fourth live region for crystal state.** The strip's `role="status"` already exists; the tray's changes
  go through it.

## Acceptance

- **I1-A1** Pressing any rendered card — actionable or not, yours or the AI's — opens a modal dialog whose
  accessible name is the card's name and whose text contains the printed text. Escape and Back close it and
  nothing was applied. *jsdom over a real Board; browser for modality.*
- **I1-A2** In a real Main Phase 1 the sheet for a castable card offers "Cast X" and pressing it opens the
  tray, applying nothing; for an uncastable hand card it offers a disabled Cast with the engine's reason
  ("Not enough CP" on a fixture where `castCheck` passes but no payment exists; a phase reason at the
  mulligan).
- **I1-A3** For a card with a non-payable sole choice (a blocker at `declareBlock`; a target at
  `chooseTargets`) the sheet's button carries the full `Choice.label`, and pressing it submits exactly that
  command and closes the sheet. A card in several choices lists every one.
- **I1-A4** No press on the board submits a command: sweep six seeded games, at every human decision press
  every rendered card, assert `choose` was never called.
- **I1-A5** The card's accessible name carries its sole choice's headline or `N options`, and never a payment
  string; the strip carries no card-subject choice and no "Pay differently".
- **I2-A1** Opening the tray for a 2-cost lightning card draws two crystals, one labelled lightning, both
  greyed, Confirm disabled.
- **I2-A2** Clicking a candidate backup lights one crystal and renders it dull; clicking it again un-lights
  and restores it. Clicking a candidate hand card lights two and marks it for discard.
- **I2-A3** A source whose addition leaves no legal payment is not selectable (the earth-backup-plus-lightning
  -discard case for a 2-cost lightning cost: after the discard, the backup is not offered).
- **I2-A4** With every crystal lit, Confirm is enabled and submits a command that is a member of the legal
  set, with the exact sources chosen; the log's move line names them.
- **I2-A5** Auto fills the preferred payment; Clear empties; Cancel returns to the ordinary strip with nothing
  spent. A change of position closes the tray.
- **I2-A6** Property: over every human decision in six seeded games, for every payable move and every subset
  of its candidate sources, "all crystals lit" ⇔ engine `canPay` ⇔ selection is a member of the legal set.
- **I2-A7** Dual-element discard: on a fixture where both elements are extendable the tray asks; where one is,
  it does not. *Built (`toggleSource`); pinned only through I2-A6's walk, which exercises both element
  declarations of Shantotto and Billy Bob. No mounted-Board fixture reaches a position where both declarations
  are extendable for one cost, so the ask branch is exercised by `payment.test.tsx`'s built-payment loop only
  when the corpus supplies one — recorded as a gap, not claimed.*
- **I2-A8** Browser: seed 11's Class Tenth Moogle (three ways, E11's route) can be paid by clicking Cloud in
  hand, the crystal shows lit, Confirm casts it, and the log says "discard Cloud as earth".
- **Gates** `pnpm typecheck && pnpm lint && pnpm test`, `pnpm test:browser`, and existing tests updated only
  where the interaction model changed by design (listed in the commit).

## Mutation plan

| mutation | must fail |
|---|---|
| a card press commits its sole choice as before | I1-A4 |
| the sheet's Cast carries the payment string | I1-A5 / I1-A2 |
| the disabled Cast has no reason | I1-A2 |
| the tray lights crystals by counting CP without matching elements | I2-A6 |
| a source is selectable regardless of the legal list | I2-A3 |
| Confirm submits the preferred payment instead of the built one | I2-A4 |
| the tray survives a change of position | I2-A5 |
