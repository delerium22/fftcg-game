# Rung V1-A3 — `anyOf`, multi-job, element-of-chosen, special abilities, Fire-only payment, the action-ability ban — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the last engine vocabulary the Vol. 1 pool needs (Leonora, Taivas, Luso, Jecht, Ward, Charlotte), proven by synthetic Layer 1 tests, with no card-pool change.

**Architecture:** filter axes on `TargetFilter` (definition-only), one new cost on `AbilityCost` plus a `special` marker on activated abilities, one new `StaticEffect` read by the cast requirement, and one new `FieldFlag` reached through the existing continuous `grantFlag`.

**Tech Stack:** TypeScript, pnpm workspaces, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-29-rung-v1-vol1-pool.md` (V1-D12, V1-D13, V1-D14, V1-D15, V1-D16). Builds on V1-A1 and V1-A2 (merged first).

## Global Constraints

- CR 3.3 pin: §11.7.1 (a special ability costs, in addition, a discard of a card with the same name; it has a proper name and the S icon), §11.6 vs §11.7 (an action ability is not a special ability), §11.2 (paying CP), §7.2 (Characters).
- Plain-data AST; `git add` named paths; never `vitest.config.ts`; no `packages/cards`/`decks/` change.
- Verify: `pnpm typecheck && pnpm lint && pnpm test && pnpm test:browser`.

## Decisions

- **A3-D1 — `anyOf`.** `TargetFilter.anyOf?: readonly DefFilter[]` — the card matches at least one member (Leonora "Card Name Palom or Card Name Porom"; Taivas "Job Warrior or Card Name Warrior"). A definition axis: `FILTER_AXES.anyOf = 'def'`, `matchesDefFilter` checks it; setup validation rejects instance axes inside a member. `target-filters.test.ts` exercises every axis by name — add `anyOf` there.
- **A3-D2 — multi-job.** SE data writes several jobs as `"Warrior/Rebel"` (169 cards in the SE dump). The `job` axis matches when `filter.job` is one of `def.job.split('/')` (trimmed). No data-shape change; the Wuk Lamat patch in V1-B writes `"Princess/Warrior"`.
- **A3-D3 — element of the chosen card (Luso).** `TargetFilter.sameElementAsChosen?: true`. Never read by `matchesFilter` directly: the executor RESOLVES it when it raises a pending or builds candidates, replacing it with `elementIn: [...the first chosen card's elements]` (a new definition axis `elementIn?: readonly Element[]`, any of). So `chooseFromDeck.filter` (which travels on the pending and is re-read by `deckPickCandidates` in determinised worlds) carries only concrete, world-independent axes. With nothing chosen, `elementIn: []` matches nothing.
- **A3-D4 — special abilities (§11.7).** Activated trigger gains `special?: { readonly name: string }` (the proper name, e.g. `'Jecht Beam'`). `AbilityCost.discardSameName?: true` — discard one OTHER card from hand whose name equals the source's name. The card discarded is part of the payment: `Payment.sameName?: CardId`. `legalCommands` lists one canonical choice (the first same-name card in hand order), and `activationCheck`/`apply` accept any card that qualifies (the J8 canonical-subset pattern). ISMCTS keys: the activation key carries the discarded card's hand ref; the decoder resolves it. The AI prices the discard as the loss of that card (as it prices CP discards). The web names the ability by its proper name and shows "discard <name>" in the cost. The §11.7 timing-matrix rows the tests exercise move from `n/a` to `tested` (at least 11.7.1, 11.7.2.2 dull-cost rules through the Jecht case, 11.7.3 on the stack, 11.7.11 priority after); the rest stay `n/a` with "no pool card".
- **A3-D5 — "can only pay with <Element> CP" (Ward).** `StaticEffect { kind: 'onlyCp'; element: Element }`, read by `castRequirement` into `CpRequirement.onlyElement?: Element`. `canPay`, `enumeratePaymentsFor`, `canAffordCast`, `checkedPay` and the AI's `preferredPaymentFor` admit only CP that can be that element: a Backup whose elements include it, a discard declaring it. Overpaying with another element is refused. The web tray offers only admissible sources (its legality comes from the enumerated payments — check `apps/web/src/game/payment.ts`).
- **A3-D6 — the action-ability ban (Charlotte clause 3).** `FieldFlag` gains `'cannotUseActionAbilities'`, granted by the existing continuous `grantFlag` (scope: opponent's Forwards). `activationCheck` refuses an ability of a source carrying the flag unless it is `special`. The web shows the refusal reason on the card sheet like other activation refusals.

## Review Focus

1. A special ability with its only same-name copy being the source itself (on the field) and no copy in hand: refused, with a reason.
2. Ward with a Water Backup and a Fire Backup and a Fire discard available: exactly the Fire-only payments are listed; a payment including the Water Backup throws.
3. Luso's search in a determinised world: the pending's filter has no `sameElementAsChosen`, only `elementIn`, and `deckPickCandidates` gives the same indices across determinisations.
4. A Forward under the ban can still use a special ability, and a Backup (not a Forward) of the same player can still use its action ability.
5. `anyOf` with a job match on a multi-job card ("Princess/Warrior" matches Job Warrior; "Warrior of Light" does not).

---

### Task 1: `anyOf`, multi-job, `elementIn`, `sameElementAsChosen`

**Files:** `packages/engine/src/abilities.ts` (`TargetFilter`, `FILTER_AXES`), `packages/engine/src/filters.ts`, `packages/engine/src/resolve.ts` (resolve `sameElementAsChosen` where `chooseTargets` builds candidates and where `lookAtDeck` raises `chooseFromDeck`), `packages/engine/src/setup.ts` (validation), Tests: `packages/engine/test/target-filters.test.ts`, `packages/engine/test/selects.test.ts` or a new `filters-v1.test.ts`.

- [ ] Failing tests: `anyOf [{name: 'A'}, {name: 'B'}]` matches A and B, not C; job `Warrior` matches `"Princess/Warrior"` and `"Warrior"` but not `"Warrior of Light"`; a search `lookAtDeck { count: 'all', take: { filter: { job: 'Standard Unit', sameElementAsChosen: true } } }` under a `chooseTargets` of an own Character: with a Water Character chosen the pending's filter is `{ job: 'Standard Unit', elementIn: ['water'] }` and only water Standard Units are eligible; a determinised copy gives the same eligible indices.
- [ ] Red → implement → green → typecheck → commit `feat(engine): anyOf, multi-job and element-of-chosen filters (V1-A3)`.

### Task 2: special abilities and `discardSameName`

**Files:** `abilities.ts` (`special`, `discardSameName`, `describeCost`), `commands.ts` (`Payment.sameName`), `activate.ts` (check, pay, canonical listing in `legalCommands`' activation path — follow the flow from `activationsWithMeta` in `legal.ts`), `packages/ai/src/ismcts/keys.ts` (encode/decode), `packages/ai/src/candidates.ts`/`payment.ts` (price the discard), `apps/web/src/game/commands.ts` (label with the proper name, cost text), `apps/cli/src/render.ts` if it renders activation costs, `docs/rules/timing-matrix.md` (§11.7 rows), Tests: `packages/engine/test/special-abilities.test.ts` (new), `packages/ai/test/ismcts-keys.test.ts`, `apps/web/test/commands.test.ts`.

- [ ] Failing tests (a Jecht-shaped synthetic Forward: `special: { name: 'T Beam' }`, cost `{ dull: true, discardSameName: true }`, effect choose 1 Forward → damage 8000): with a same-name copy in hand it is listed once, activates, the copy is in the Break Zone, the ability is on the stack (§11.7.3), the activator regains priority (§11.7.11); with no copy in hand it is refused ("no card with the same name in your hand"); the source itself never pays for itself; the dull-icon rules of §11.7.2.2 hold (entered this turn without Haste: refused); `Payment.sameName` naming a different-name card throws; an ISMCTS round-trip over the activation key across determinisations decodes to a legal command.
- [ ] Red → implement → green → matrix rows → typecheck → commit `feat(engine,ai,web): special abilities with the same-name discard (§11.7, V1-A3)`.

### Task 3: `onlyCp` payment restriction

**Files:** `abilities.ts` (`StaticEffect`), `cp.ts` (`castRequirement`, `CpRequirement`, `canPay`, `enumeratePaymentsFor`, `canAffordCast`), `cast.ts` (`checkedPay`), `packages/ai/src/payment.ts` (`preferredPaymentFor`), `setup.ts` (validation), Tests: `packages/engine/test/payment.test.ts` or a new `only-cp.test.ts`, `packages/ai/test/payment.test.ts`, web payment test if the tray filters sources (`apps/web/test/payment-model.test.ts`).

- [ ] Failing tests (a Ward-shaped Forward, cost 3, fire, static `onlyCp: 'fire'`): with 1 Fire Backup, 1 Water Backup and a Fire card to discard, every listed payment is Fire-only; a payment dulling the Water Backup throws; with only Water sources it is unaffordable (`canAffordCast` false, `forcedPass` passes); a Fire/Water dual Backup counts as Fire.
- [ ] Red → implement → green → typecheck → commit `feat(engine,ai): only-<Element>-CP payment restriction (V1-A3)`.

### Task 4: the action-ability ban

**Files:** `abilities.ts` (`FieldFlag`), `activate.ts` (`activationCheck`), web flag label/narration if flags are listed (grep `FLAG_PURPOSE`/`FieldFlag` in `apps/web`), Tests: `packages/engine/test/activated-abilities.test.ts` or new.

- [ ] Failing tests: a Charlotte-shaped static `grantFlag cannotUseActionAbilities to { controller: 'opponent', filter: { type: 'forward' } }`: the opponent's Forward with an action ability cannot activate it (reason names the ban); its special ability still can; the opponent's Backup's action ability still can; the controller's own Forwards are unaffected; the ban lifts when the source leaves the field.
- [ ] Red → implement → green → typecheck → commit `feat(engine,web): the cannot-use-action-abilities flag (V1-A3)`.

### Task 5: verify and ship

- [ ] Full gate green; spec "As built (V1-A3)" note; PR; merge on green; fast-forward.

---

## Revisions after the plan review (2026-09-29)

Fresh Fable reviewer (Codex out of quota); adjudication in `2026-09-29-rung-v1a3-filters-costs.codex-review.md`.
These override the tasks above where they differ.

- **R1 (H1)** — `sameElementAsChosen` must never fail open: `matchesFilter`/`matchesDefFilter` THROW on it
  unresolved; `FILTER_AXES` gains a third class `'resolved'` for it; a `target-filters.test.ts` case asserts the
  throw. Setup validation allows it only in `lookAtDeck.take.filter` or a `chooseTargets.from.filter` nested under
  an earlier `chooseTargets` (never on a declaration-stage node or an activation's head chooser).
- **R2 (H2)** — one `sameNameCheck(state, player, source, cost, payment)` shared by `isLegal`
  (`legal.ts` activateAbility path) and `applyCosts`; `payment.sameName` may not also be a CP discard, and a CAST
  refuses `sameName` as an activation refuses `lbFlip`. The canonical copy is INJECTED in `activationsWithMeta`
  (`legal.ts`) and the AI's `activationCandidates` (`candidates.ts`) — constructing it is the requirement; pricing
  the discard is secondary.
- **R3 (H3)** — `canPay` takes the `CpRequirement` (so the compiler finds every caller: `legal.ts` paymentCheck,
  `activate.ts` applyCosts, `cast.ts` checkedPay, `cp.ts` canAffordCast/enumeratePaymentsFor, and the web's
  `crystals()` in `apps/web/src/game/payment.ts`, which a property test pins to `canPay`). Under `onlyElement`, CP
  from a source that cannot be that element is refused, and a flexible entry (a Fire/Water Backup, from
  `backupElements` so Moogle-style grants count) is narrowed to `[onlyElement]`. Reading kept: "You can only pay
  with Fire CP" means no other CP may be generated for the cast, overpay included.
- **R4 (M1)** — a `packages/cards/test/normalise.test.ts` case: a `[[s]]Jecht Beam[[/]] 《S》…` line counts as one
  printed clause.
- **R5 (M2)** — matrix: 11.7.3/11.7.4 are `simplified` (mirroring 11.6.3/11.6.4: the engine pays before it pushes,
  `activate.ts` MVP0-SIMPLIFICATION); 11.7.11's test asserts `state.priority === activator`.
- **R6 (M3)** — `DefFilter` gains `anyOf` and `elementIn`; `anyOf` members are `DefFilter` (definition only), so
  the member validation is the type's; spec V1-D12 is corrected (`DefFilter[]`, separator `/`).
- **R7 (M4)** — `evaluate.ts` `abilityTerms` gets no term for the ban in this rung; recorded as an AI tuning gap in the
  as-built note (a weight changes measured win rates).
- **R8 (M5)** — activation preflight with an empty payment may count the same-name card as a hand target: latent (no
  pool card combines a special ability with a hand target); recorded.
- **R9 (LOW)** — `describeAbilityCost(cost)` gets the source name for "discard <name>" (or reads "discard a card with
  the same name"); CLI `render.ts` labels `sameName`; the three flag maps (`Card.tsx` FLAG_LABEL, `commands.ts`,
  `useGame.ts`) gain the flag; the payment test lives in a new `packages/engine/test/only-cp.test.ts`; the
  `activateAbility` key round-trip in `ismcts-keys.test.ts` is new; `samePayment` ignoring `sameName` is intentional
  (a CP-less special never opens the tray).
- **R10 (from the V1-A2 build)** — `declarationNode` (`activate.ts`) treats a `select` at the head of an activated
  ability as a target declared at activation. A select is made at resolution (§11.3.3), so it must be skipped there:
  Taivas's `[0]` ("Play 1 Job Warrior or Card Name Warrior of cost 3 or less from your hand onto the field") is an
  activated select from hand. Add to Task 2 (it touches `activate.ts`): a failing test with an activated ability whose
  only node is `chooseTargets { select: 'self', from: { zone: 'hand', … } }` — it activates with no declared targets,
  goes on the stack, and prompts its controller at resolution.
