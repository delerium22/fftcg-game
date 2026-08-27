# Rung C6 — A CP source can produce more than one Element

> Revision 1 (2026-08-27). Follows C5, complete and reviewed.

## Context

Nineteen of the starter deck's 28 printed clauses work. Nine remain, and this rung takes the one that touches
the resource system the player uses every single turn:

> **Class Tenth Moogle (9-074C)** — "If Class Tenth Moogle is on the field, Class Tenth Moogle can produce
> Lightning CP."

Moogle is an **Earth** Backup in an Earth/Lightning deck. Its clause is colour fixing: dull it for Earth as
usual, or for Lightning when that is what you are short of. Every game of this deck runs into the moment it
solves.

## A correction to my own earlier scoping

The C4 spec excluded Moogle with this reasoning:

> *"it makes a Backup's element a **choice**, and `Payment.dullBackups` is a bare `CardId[]` with no element
> on it. Adding one is surgery across `cp.ts`, `payment.ts`, the ISMCTS codec and the browser's payment
> collapsing."*

**That was wrong** — or at least it assumed the only possible design. `Payment` does not have to record which
Element a dulled Backup produced, because **nothing needs to know**. The only question anyone asks is "does
this payment cover the cost", and that question can be answered by asking whether a valid *assignment* exists.

So the change is confined to `cp.ts`: `GeneratedCp` gains a set of Elements instead of one, and `canPay`
matches requirements against sources. `Payment` is untouched, and so are the ISMCTS codec, the browser's
payment collapsing, and all 31 `dullBackups` references across nine files. Worth recording as a wrong
estimate rather than quietly doing the cheap thing.

## Decisions

| # | Decision | Ruling (and why) |
|---|---|---|
| C6-1 | **A CP source produces a SET of Elements; `canPay` asks whether an assignment exists** | `GeneratedCp` becomes `{ elements: readonly Element[]; source }`. One dull is still one CP — the set is what that single CP *may* count as, not extra CP. Discards keep declaring their Element on the `Payment`, because a two-Element card discarded produces **two** CP of one chosen Element and that genuinely is a choice with consequences. |
| C6-2 | **Matching, not counting** | `canPay` already treats `requiredElements` as a multiset (fixed in C3's follow-up). With flexible sources, satisfying it becomes bipartite matching: each requirement needs its own distinct source that can produce it. Requirements are 1–3 and sources are single digits, so a plain backtracking search is right; anything cleverer is unjustifiable at this size. |
| C6-3 | **Moogle's clause is a `static`, reusing C4's primitive** | A new `StaticEffect`: `{ kind: 'produceElement'; element }`. This is the **field-scoped** static C4 said would come and made the scope field explicit for — Odin's modifies its own cost from hand; Moogle's applies while the card is on the field, which is exactly what its printed text says. |
| C6-4 | **This retires a standing `MVP0-SIMPLIFICATION`** | `cp.ts:26` says *"multi-element backups produce their first element; none in the MVP0 pool"*. The second half stops being true the moment a Backup can produce two Elements, and the marker goes with it. |
| C6-5 | **The `cpGenerated` event reports what a source COULD produce** | Nothing consumes it but the log, and with flexible sources there is no single fact to report — the engine never commits to "this dull was the Lightning one". Reporting the set is honest; reporting a guess is not. |
| C6-6 | Not in scope | The other eight clauses. In particular this does **not** add a general "static abilities on the field modify the rules" sweep: `produceElement` is read where CP is generated and nowhere else, exactly as `costReduction` is read only in `castRequirement`. |

## What could go wrong, in the order it will bite

- **Matching done greedily gives wrong answers.** Assign a `[Lightning][Earth]` cost greedily and Moogle may
  take the Earth slot, leaving a pure-Earth Backup unable to cover Lightning — when swapping them works. The
  search must backtrack, and the test for it needs a fixture where the greedy order fails.
- **`enumeratePayments` and `canPay` disagreeing.** Enumeration filters candidate payments through `canPay`,
  so they cannot drift apart by construction — but `preferredPaymentFor` builds its own assignment
  (`payment.ts:17`) and *can*. A previous rung shipped 40 % of preferred payments outside `legalCommands`;
  this needs the same membership check.
- **The static applying from the wrong zone.** Moogle in hand or in the Break Zone must not fix colours. Its
  printed text says "on the field", and C4 made the scope explicit precisely so this could not be assumed.
- **One dull becoming two CP.** The set is what one CP may count as. A test must show Moogle alone cannot pay
  a two-Lightning cost.

## Acceptance criteria

- **C6-A1** Moogle alone pays a 1-Lightning cost, and still pays a 1-Earth cost.
- **C6-A2** Moogle alone does **not** pay a `[Lightning][Lightning]` cost — one dull is one CP.
- **C6-A3** A pure-Earth Backup that is not Moogle still cannot pay a Lightning cost.
- **C6-A4 (backtracking)** A `[Lightning][Earth]` cost paid by Moogle plus one pure-Earth Backup succeeds —
  the case a greedy assignment gets wrong by taking Earth with Moogle first.
- **C6-A5 (zone)** Moogle in hand or in the Break Zone grants nothing; only the field.
- **C6-A6 (agreement)** Over seeded real games, every `preferredPaymentFor` result is a member of
  `enumeratePaymentsFor` for the same requirement — measured, not assumed.
- **C6-A7** `ABILITY_CLAUSES['9-074C']` unchanged at 1; implemented count +1; Moogle stops warning.
- **C6-A8** `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm --filter @fftcg/web build` green; fuzzer 200/200.

## What this rung will NOT claim

That the AI exploits the fixing. `preferredPaymentFor` minimises the value given up and will use Moogle when
it must, but nothing teaches it to *hold* Moogle for a Lightning turn. One clause is far below the noise floor
of a mirrored run.
