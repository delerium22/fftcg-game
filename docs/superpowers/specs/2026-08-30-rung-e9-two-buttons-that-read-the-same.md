# Rung E9 — two buttons that read the same

> **STATUS: SPEC, awaiting plan review.** Nothing built. Found by playing, not named by a review.

## Why

Playing a game in the browser, at the discard-to-hand-size step, the prompt offered:

```
Discard Luso, Odin  |  Discard Luso, Noel  |  Discard Luso, Shantotto  |
Discard Luso, Hugh Yurg  |  Discard Luso, Shantotto  |  Discard Luso, Hugh Yurg  |  Concede
```

**"Discard Luso, Shantotto" and "Discard Luso, Hugh Yurg" each appear twice.** The hand at that moment was
`Noel, Shantotto, Hugh Yurg, Shantotto, Hugh Yurg` — two copies of each card. So the duplicates are distinct
card *instances* producing distinct commands with identical labels.

A player is shown two buttons that read the same, cannot tell them apart, and has no way to know the choice
between them does not matter. It reads as a bug even though the game is behaving correctly, and it pads a
list the player has to work through under a hand-size deadline.

## What this rung is

Collapse choices that are **the same choice to a player**: identical label, mechanically interchangeable.

This is not a new idea in this codebase — it is exactly what `preferredChoices` already does for payments.
`legalCommands` enumerates every minimal payment, so one castable card appeared dozens of times, and the UI
collapses them to the one payment `preferredPayment` picks (spec B6). Same shape here: the engine enumerates
by INSTANCE, and the UI should present by MEANING.

## Why collapsing is safe, and where it would not be

Two copies of one card in hand are interchangeable: the resulting states differ only in which `CardId` sits
in the Break Zone, and nothing in the rules or the pool distinguishes them — every effect that reads the
Break Zone reads `code`, not identity.

That argument is load-bearing, so I checked it at three layers rather than asserting it:

- **The rules.** The only per-instance Break Zone state is `putIntoBreakZoneFromFieldThisTurn`, which Sphene
  reads. It is appended only by `recordBreakZoneArrivals`, on FIELD → Break Zone transitions. The hand-size
  discard in `phases.ts` moves cards straight from `hand` to `breakZone` and never calls it, so neither copy
  is marked and Sphene cannot tell them apart.
- **The search.** `bzEntry` in the ISMCTS observation key digests a Break Zone card as its `code` plus a `!`
  when that flag is set — identity is not in the key at all. Discarding either copy yields the same entry,
  so the two commands lead to the same information set.
- **Determinisation.** `determinise` rebuilds from the view's Break Zone, which lists codes; two states
  differing only in which of two same-code ids was discarded reconstruct identically.

It remains the sort of "obviously equivalent" claim that stops being true when a card gains a per-instance
ability. The safe form of
the rule is: collapse only when the labels are identical AND the commands differ solely in the identity of
cards with the same `code` in the same zone. If a future card can distinguish two same-code instances, the
collapse must stop — so this needs a test that would notice.

## What this rung is NOT

- **Not a change to any label.** Rung E4 settled what a cast button says; this is about how many of them
  there are.
- **Not a change to `legalCommands`.** The engine must keep enumerating every legal command — `apply`
  re-derives from it, and the AI searches over it. This is a presentation rule in `buildChoiceSet`, the same
  layer `preferredChoices` already occupies.
- Not the CLI, whose numbered menu has the same duplication but a different audience and no click target.

## The question for the plan review

**Collapse, or disambiguate?** I lean to collapsing, because the choice genuinely does not matter and a
numbered "Shantotto (1)" / "Shantotto (2)" asks the player to make a distinction that has no meaning. But
disambiguating is more honest about what the engine is doing, and this program has been bitten before by
UI that quietly decides something on the player's behalf — rung E4 exists because an auto-chosen payment was
invisible until it was irreversible. Rule on it.

## Acceptance

- **E9-A1** At a real discard-to-hand-size position reached by PLAYING, with a hand holding two copies of a
  card, no two offered buttons carry the same label. Asserted against a hand-written expected set, not
  against whatever the choice set produces.
- **E9-A2** The surviving choice still submits a legal command — the collapse must not drop the option, only
  the duplicate.
- **E9-A3** Choices that merely LOOK similar but differ mechanically are NOT collapsed. Needs a case where
  two commands share a label and are genuinely different; if none exists in this pool, say so explicitly
  rather than leaving the criterion to pass vacuously.
- **E9-A4** `legalCommands` is unchanged — pinned, because collapsing at the wrong layer would take options
  away from the AI as well as from the player.
- **E9-A5** Existing tests pass unedited; full gates green including `pnpm test:browser`.

## Mutation plan

| mutation | must fail |
|---|---|
| the collapse is removed | A1 |
| the collapse drops ALL copies rather than the duplicates | A2 |
| the collapse keys on label alone, ignoring mechanical equivalence | A3 |
| the collapse is applied in `legalCommands` instead of the UI layer | A4 |
