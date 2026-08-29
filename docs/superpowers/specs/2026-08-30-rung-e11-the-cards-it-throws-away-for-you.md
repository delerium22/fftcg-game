# Rung E11 — the cards it throws away for you

> **STATUS: SPEC, awaiting plan review.** Nothing built. Found by playing, and then measured.

## The defect

To cast a card you discard other cards from hand as CP. `legalCommands` enumerates every minimal payment, so
one castable card can appear dozens of times; spec B6 collapses them to a single button using
`preferredPayment`. **The player cannot choose which cards are thrown away.**

Measured over twelve seeds of real play (644 human decision points):

- **230 casts** offered more than one distinct payment — up to **nine** ways to pay for one card.
- **76 of those 230 (33%)** kept a payment that discards strictly MORE printed cost than one it hid.
- Worst observed: casting Shantotto by discarding **Lightning** — this deck's 7-cost bomb — plus Miner, when
  discarding Noel plus Undead Princess was equally legal. A four-cost swing, and qualitatively worse than the
  number says, because Lightning is the card the deck is built around.

I noticed it playing seed 11 and reading a button that offered to discard Sphene to cast a one-cost Red Mage.
That particular one turned out to be **forced** — Sphene was the only other Lightning card in hand — which is
why the claim above is measured rather than asserted from the one case that prompted it.

## Why this is the same defect twice refused

E9's plan review refused collapsing duplicate commands, because two same-code cards can differ in what the
opponent knows. E10's code review found `payableKey` collapsing an activation's TARGETS, so four legal targets
became one button and whichever Forward came first was pumped.

Both times the ruling was: **the UI must not decide a live choice on the player's behalf and disclose it
afterwards.** Payments were explicitly waved through as the interchangeable case — "that is what
`preferredPayment` is for". The measurement above says they are not interchangeable. Which cards you throw
away is frequently the most important decision in the turn, and a third of the time the automatic answer is
measurably not even the cheapest one.

**The label does disclose it before the click**, which is what makes this a lesser sin than E4's. It is still
a decision the player is not permitted to make.

## What must NOT be done

Showing all nine payments as nine buttons. B6's reason is real: `legalCommands` explodes, the strip becomes
unusable, and every cast turns into a combinatorics exercise. A rung that trades one bad interface for another
has not fixed anything. Whatever this does must keep the common case — one button, one click — untouched.

## Proposed shape, with my recommendation

Keep the single preferred button. Add a way to change the payment when the player wants to:

**(A) A "pay differently" affordance.** Selecting a card that has several distinct payments shows, alongside
its normal action, an option that lists the alternatives. Small, uses the prompt strip that already exists,
and cannot affect the one-payment case at all.

**(B) Nominate CP sources by clicking.** The player clicks the cards they want to discard, then casts —
which is how a real client works. Truer to the game and better long-term, but it is a new interaction mode,
it needs its own affordances for clearing a selection, and it touches the click model E9 and E10 just settled.

**I recommend (A)** for this rung and would leave (B) as a later one if playing shows (A) is clumsy. I hold
this loosely: it is exactly the kind of judgement the last two plan reviews have overturned, and if the
reviewer thinks the click model should absorb it, that is a better argument than my preference for the
smaller change.

**Open question I cannot settle alone:** does this apply to ACTIVATION payments too? `payableKey` collapses
those the same way. My instinct is yes, same defect, same fix — but activations also carry targets now, and
the interaction between "choose a target" and "choose a payment" on one card may need its own answer.

## Acceptance

Each criterion names the guard that stops it passing vacuously, because seven criteria across E9 and E10
passed while the thing they claimed was false.

- **E11-A1** At a reached position with a cast offering ≥2 distinct payments (guard: assert that count from
  `legalCommands`, not from the fixture's shape), every distinct payment is reachable through the interface,
  and each reachable option maps to a command whose `payment` is exactly that one.
- **E11-A2** The one-payment case is unchanged: a cast with a single legal payment still commits on one click,
  with no extra affordance. Guard: assert such a card exists in the same fixture.
- **E11-A3** What the player picks is what is applied — asserted by driving the choice and comparing the
  applied command's `payment` field, not by reading a label.
- **E11-A4** The preferred payment stays the default, so the common path costs no extra clicks. Asserted as
  the exact command, so a change of default is a visible failure rather than a silent one.
- **E11-A5** Accessible: each alternative is a real control with a name saying which cards it discards.
  Asserted in the browser, where the accessibility tree is computed rather than written by us.
- **E11-A6** Mutations: offer only the preferred payment; map every alternative to the preferred command;
  drop the payment from the label; change the default. Each must fail.
- **E11-A7** Existing tests pass unedited; full gates green. Noted as a regression gate, not as evidence.

## Also found while playing, NOT this rung

A hand card with exactly one action announces it — "Cast Class Tenth Moogle paying: discard Geomancer as
earth". A card with SEVERAL actions announces none of them, because `actionFor` deliberately returns
`undefined` rather than name one option the click will not take. The reasoning is right, but the result is
backwards: the card with more options tells the player less, and a screen reader announces a pressable card
with no indication that pressing it opens anything. Recorded here so it is not lost; it is a separate, smaller
rung and should not be smuggled into this one.
