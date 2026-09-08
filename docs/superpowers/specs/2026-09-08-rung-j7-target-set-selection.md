# Rung J7 — target sets picked card by card, and a cap on what `legalCommands` enumerates

> **STATUS: BUILT, revision 2, 2026-09-08.** Slices 1–3 landed first; the Codex plan review ran against the
> code as built ([the review](../plans/2026-09-08-rung-j7-target-set-selection.codex-review.md)) and every
> finding is adjudicated at the end; the accepted ones landed as follow-up commits. The audit's pressure
> point 3 (ladder J7): "pre-enumeration
> in `legalCommands`" — needed before the pool grows past ~40 cards. Bounded in the engine, a new picker in
> the browser (the shape of I2's payment tray). The user was away; the design calls are mine, recorded here.

## The problem

Every decision over a SET of cards is enumerated as whole commands: `chooseTargets` lists Σ C(N, k) for
k in min..max (legal.ts), `declareAttack` lists every legal subset of the ready Forwards (`legalAttackSets`,
2ⁿ), an activation lists every target set × every payment (`activationsFor`), `discardToHandSize` and
`breakExcessBackups` list C(N, count). The browser files each command under every card it names, so a
Forward in a 4-Forward board carries "8 options" on its sheet — eight buttons naming parties — and a clause
printing "choose up to 3 Forwards" over two full fields would list ~1,300 commands, most of them under one
card. The AI already prunes its own candidates (`attackCandidates`, `chooseTargetsCandidates`) and the
ISMCTS decoder validates a key against the pending, not against the list. Only two things depend on the
list being COMPLETE: the browser's "an illegal click is unrepresentable" invariant (B-A4, `useGame.choose`
checks membership) and the legal-apply property test.

## Design

- **D1 — legality is a predicate, enumeration is a courtesy.** The engine exports one check per set-shaped
  command, each the exact test its `apply` runs: `attackCheck` and `activationCheck` exist; add
  `chooseTargetsCheck(state, player, targets)`, `partyDamageCheck(state, player, assignments)`,
  `discardCheck(state, player, cards)` and `excessBackupsCheck(state, player, cards)` (the bodies move out of
  the `apply*` functions, which call them). `isLegal(state, command): string | null` dispatches on
  `command.type` — for the non-set commands it is "listed by `legalCommands`" — and `apply` calls nothing
  else for validation. B-A4's invariant becomes "the browser never sends a command `isLegal` refuses",
  which `useGame.choose` enforces with the predicate instead of the list.
- **D2 — the cap.** `legalCommands` takes `{ setCap = 64 }`: when a set-shaped enumeration would exceed the
  cap it lists the singletons (every card alone, for min ≤ 1), every legal PAIR up to the cap, and the
  largest legal set — the same three shapes `attackCandidates` already keeps — and marks the result
  (`legalCommands.capped`, a boolean the browser reads to know the list is a sample). Below the cap nothing
  changes, so every existing fixture and the frozen corpus replay as they are.
- **D3 — the target tray.** A choice whose command names a SET (`declareAttack`, `chooseTargets` with
  `max > 1`, `activateAbility` with several targets, `discardToHandSize`, `breakExcessBackups`,
  `assignPartyDamage` stays a strip choice) opens the TRAY, as a payment does: the strip's row becomes
  "Attack with: Cloud, Prishe — 2 chosen" with Clear / Cancel / Confirm; the board's clickable set is the
  candidates the predicate still admits (a click on a chosen card removes it; a candidate is offered only
  if adding it keeps a completion reachable — for attacks, the party's shared element; for targets, `max`);
  Confirm is enabled exactly when the predicate accepts the selection. Pressing a card whose sole choice is a
  singleton set commits as today (the sheet's "Attack with Cloud"); the sheet gains one "Choose several…"
  action when more than one member is possible, replacing the list of N parties.
- **D4 — one picker, three kinds.** `apps/web/src/game/selection.ts` mirrors payment.ts: `SelectionModel
  { kind: 'attackers' | 'targets' | 'discards' | 'backups'; chosen: CardId[] }`, `candidatesFor(view, pending
  or attack)`, `extendableWith(shim, sel, id)` (the predicate on `sel + id`, or on any completion of it),
  `completed(shim, sel)` → the command. The tray component is `SelectionTray` (crystal row swapped for a
  chip row of chosen names); PromptStrip's `tray` slot already exists.
- **D5 — the AI is unchanged**: `candidateCommands` never read the full list for sets; the ISMCTS decoder
  validates through the pending and `apply` re-validates. A7 pins that the decoder's acceptance equals
  `isLegal`.
- **D6 — keyboard and screen reader.** The tray's live text announces the count and the names; the chosen
  cards carry `aria-pressed`; Confirm's disabled reason is the predicate's message ("a party must share an
  element").

## Slices

1. Engine: the four checks + `isLegal`; `apply*` call them; `useGame.choose` uses `isLegal` (behaviour
   unchanged: everything listed is legal).
2. Engine: the cap with `capped`; the legal-apply property test asserts "every listed command is legal" and
   a new one asserts "every legal set is accepted by `isLegal` even when not listed".
3. Browser: `selection.ts` + `SelectionTray`; attacks and multi-targets go through it; sheet actions
   collapse to "Choose several…"; jsdom + Playwright tests.

## Acceptance

- **J7-A1** `isLegal` agrees with `apply` on 2,000 random commands over 20 seeds (accepts ⇔ apply does not
  throw), including commands `legalCommands` does not list.
- **J7-A2** A `chooseTargets` over 12 candidates with `max: 3` lists ≤ 64 commands, `capped === true`, and
  every listed command is legal; below the cap the list is unchanged from today (fixture equality).
- **J7-A3** In the browser, a two-Forward party is built by two clicks and Confirm; a third Forward of another
  element is not offered while the two are chosen; Cancel restores the strip; the resulting command is the
  one `legalCommands` would have listed.
- **J7-A4** "Choose up to 2 Forwards" (Noel): one click then Confirm submits one target; two clicks submit
  two; the "no targets" strip button stays.
- **J7-A5** Discard to hand size with 7 cards: the picker refuses Confirm until `count` are chosen and
  refuses an 8th.
- **J7-A6** The sheet of a Forward that can attack alone or in a party shows "Attack with Cloud" and
  "Choose several…", not N party buttons.
- **J7-A7** The ISMCTS decoder accepts a key exactly when `isLegal` accepts the decoded command (property).
- **Gates** typecheck, lint, unit, browser; the frozen corpus replays; the 29017ab timing script within 10 %.

## Plan review outcome (as built → revision 2)

**Accepted (CRITICAL, 2):** the browser's AI handler still checked the worker's command against the list —
now `isLegal`, with the refusal in the warning; `isLegal` for activations (and casts) consulted the list for
the payment — now `paymentCheck` generates the CP and asks `canPay`, exactly as `apply` does (§11.2.2.3).

**Accepted (HIGH, 5 of 6):** activation target sets are generated lazily and stopped at the cap
(`activationTargetSets(…, cap)`; the AI takes sixteen); the cast fallback is the same `paymentCheck`; the
party-damage split has an arithmetic existence test (`splittable`) and its enumeration is bounded; `capped`
reaches the browser (`ChoiceSet.capped`) and every set candidate glows and offers "Choose several…" when the
list is a sample; A7 is now a property over candidates AND probes (decoder-legality.test.ts), and the browser
validates the AI's decoded command with `isLegal` before applying it. **Deferred (HIGH, 1):** an activation
with several targets has no picker kind — no pool card prints one; `SetKind` grows an `activation` variant
(source, ability, payment, bounds) when one does, and the sheet still lists such commands whole until then.

**Accepted (MEDIUM, 5):** the cap reserves room for the largest sets (never more than 64); legal sets are
counted as generated, not estimated from raw subsets (a complete list is never marked capped; the scan itself
stops at 4,096 subsets); `aria-pressed` reflects the chosen state and Confirm is described by the refusal;
only-multi-member sheets ("choose 2", discard of two) and A4/A5 are Board tests.

**Accepted (LOW, 1):** `extendableWith` offers nothing when the candidates cannot reach `min`, with tests.
**Deferred (LOW, 1):** a deterministic Playwright flow for the party picker — the jsdom Board tests cover the
flow; the whole-game driver deliberately takes the plain action and confirms as soon as the set is legal.
