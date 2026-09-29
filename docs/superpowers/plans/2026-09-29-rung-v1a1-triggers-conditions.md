# Rung V1-A1 — the `attacks` trigger, `controlsAtLeast`, the `if` effect, counted damage — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** add the four engine vocabulary items the Vol. 1 pool needs first, each proven by synthetic Layer 1 tests, with no card-pool change.

**Architecture:** every item is a new member of an existing AST union (`AbilityTrigger`, `StaticCondition`, `Effect`, the `damage` amount), wired through its executor and every reader (V1-D16). The `if` effect owns two levels of the frame's program counter (branch, then index), like `chooseModes`, so a prompt inside a branch suspends and resumes.

**Tech Stack:** TypeScript, pnpm workspaces, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-29-rung-v1-vol1-pool.md` (V1-D5, V1-D6, V1-D7, V1-D16).

## Global Constraints

- CR 3.3 is the rules pin; cite sections in comments and `it('…')` names (`L1 §x.y — …`). No escaped apostrophe in an `it` name the matrix cites.
- Card definitions are plain data (structuredClone-safe): no functions in the AST.
- `git add` named paths only; never `vitest.config.ts`. No `packages/cards` or `decks/` changes in this PR.
- Verify: `pnpm typecheck && pnpm lint && pnpm test && pnpm test:browser`.

## Review Focus

1. A party of two Forwards that both print "when this attacks": both triggers are placed at the `declared` window, before the turn player's priority, and resolve before the block.
2. A prompt inside an `if` branch (a `chooseTargets` in `then`) suspends and resumes on the same branch even if the condition would now read differently.
3. `controlsAtLeast` as a static `when` must not read the layer's output (it counts cards by definition only), so a Haste grant cannot loop.
4. Counted damage with zero matching cards deals 0 and fires no damage trigger.
5. The AI prices an `if` by the branch that would run now, and a counted amount by the count now — never `0` by default.

---

### Task 1: the `attacks` trigger (§10.1.2.5)

**Files:**
- Modify: `packages/engine/src/abilities.ts` (the `AbilityTrigger` union, after `attackPhaseBegins`)
- Modify: `packages/engine/src/attack.ts` (`applyDeclareAttack`)
- Modify: `docs/rules/timing-matrix.md` (row 10.1.2.5)
- Test: `packages/engine/test/timing-l1-attack-trigger.test.ts` (new)

**Interfaces:**
- Produces: trigger `{ kind: 'attacks' }` — "when THIS Forward attacks". Enqueued once per attacking Forward that carries it, controller = the turn player.

- [ ] **Step 1: Write the failing test.** Synthetic defs on `VANILLA_POOL`: `T-ATK` (Forward 5000, cost 0, element earth) with clause `{ id: 'T-ATK:draw', trigger: { kind: 'attacks' }, text: 'When this attacks, draw 1 card.', effects: [{ kind: 'draw', count: 1 }] }`. Cases:
  - `L1 §10.1.2.5 — a Forward that attacks puts its trigger on the stack before the declared window opens to the turn player`: one `T-ATK` attacks; after `declareAttack` the stack holds `T-ATK:draw`, `priority` is 0, `attack.step` is `declared`; `passBoth` resolves it (player 0 drew 1) and the window is still `declared`.
  - `L1 §10.1.2.5 — a party: each attacking member places its own trigger`: two `T-ATK` in a party → two stack items.
  - `a Forward that does not attack does not trigger`: a second `T-ATK` stays home → one item.
  Use the helpers of `timing-l1-first-strike.test.ts` (`endPhase`, `withField`, `withHandSize`, `passBoth`, `checkInvariants`).
- [ ] **Step 2: Run it** — `pnpm vitest run packages/engine/test/timing-l1-attack-trigger.test.ts`. Expected: FAIL (type error on `'attacks'`, then no stack item).
- [ ] **Step 3: Implement.** Add to the union, with a doc comment citing §10.1.2.4–5:
  ```ts
  | { readonly kind: 'attacks' }
  ```
  In `applyDeclareAttack`, after the `attack` state is set and before returning, enqueue each attacker's clauses (they are placed at the next priority grant by the existing agenda, as ETBs are):
  ```ts
  for (const id of ordered) s = dispatchTrigger(s, defOf(s, id), id, player, 'attacks')
  ```
  (`dispatchTrigger` is exported from `resolve.ts`; check the import graph — `attack.ts` already imports from `resolve.ts`.) Fix every exhaustive switch on `AbilityTrigger['kind']` the compiler flags (AI, web narration): an `attacks` clause is described like `enterField`.
- [ ] **Step 4: Run the test** — PASS. Then `pnpm typecheck`.
- [ ] **Step 5: Matrix row.** Row 10.1.2.5 → `tested | engine/timing-l1-attack-trigger#§10.1.2.5`. Run `pnpm vitest run packages/engine/test/timing-matrix.test.ts` — PASS.
- [ ] **Step 6: Commit** `feat(engine): "when this attacks" triggers (§10.1.2.5, V1-A1)`.

### Task 2: `controlsAtLeast` (static condition)

**Files:**
- Modify: `packages/engine/src/abilities.ts` (`StaticCondition`)
- Modify: `packages/engine/src/layer.ts` (`staticApplies`)
- Test: `packages/engine/test/conditions.test.ts` (new)

**Interfaces:**
- Produces: `{ kind: 'controlsAtLeast'; count: number; controller: 'self' | 'opponent'; filter?: DefFilter }` — "you control / your opponent controls N or more <filter> Characters". Counts `forwards` + `backups` of that player, relative to the static's controller, matching `filter` by DEFINITION only (`matchesDefFilter`). No filter = any Character.

- [ ] **Step 1: Failing test.** `T-ZACK` Forward with static `{ kind: 'static', effect: { kind: 'grantKeyword', keyword: 'haste', to: { controller: 'self', ... self-only scope as Zack's Haste is encoded — use the existing self-scope shape from a J6 card }, when: { kind: 'controlsAtLeast', count: 3, controller: 'opponent', filter: { type: 'forward' } } } }`. Cases: with 2 opponent Forwards `keywordsOf` lacks haste; with 3 it has it; opponent Backups do not count. A second case: `controlsAtLeast { count: 2, controller: 'self' }` (no filter) counts a Forward and a Backup.
- [ ] **Step 2: Run** — FAIL (type).
- [ ] **Step 3: Implement** in `staticApplies`:
  ```ts
  controlsAtLeast: (w) => {
    const p = w.controller === 'self' ? ctx.controller : opponentOf(ctx.controller)
    const ps = ctx.state.players[p]
    const n = [...ps.forwards, ...ps.backups].filter((c) => {
      const d = defOfId(ctx.state, c.id)
      return d !== undefined && (w.filter === undefined || matchesDefFilter(d, w.filter))
    }).length
    return n >= w.count
  },
  ```
  Check that `matchesDefFilter`'s signature fits a `DefFilter` (it is in `filters.ts`); comment that counting by definition keeps the layer from reading its own output (Review Focus 3).
- [ ] **Step 4: Run** — PASS; `pnpm typecheck` (the AI or web may switch on condition kinds).
- [ ] **Step 5: Commit** `feat(engine): the controlsAtLeast condition (V1-A1)`.

### Task 3: the `if` effect and `subjectMatches`

**Files:**
- Modify: `packages/engine/src/abilities.ts` (`Effect` union; `Condition` type; `effectAtPath`)
- Modify: `packages/engine/src/resolve.ts` (`runEffect`)
- Modify: `packages/engine/src/layer.ts` (export a `conditionHolds(ctx, cond, chosen)` beside `staticApplies`)
- Modify: `packages/ai/src/candidates.ts` (`targetDelta`, `effectsValue`)
- Modify: `apps/web/src/game/commands.ts` (`targetVerb`'s walker)
- Test: `packages/engine/test/conditions.test.ts`, `packages/ai/test/candidates.test.ts`

**Interfaces:**
- Consumes: `controlsAtLeast` (Task 2).
- Produces:
  ```ts
  export type Condition = StaticCondition | { readonly kind: 'subjectMatches'; readonly filter: TargetFilter }
  | { readonly kind: 'if'; readonly when: Condition; readonly then: readonly Effect[]; readonly else?: readonly Effect[] }
  export function conditionHolds(ctx: { state: GameState; source: CardId | null; controller: PlayerId }, when: Condition, chosen: readonly CardId[]): boolean
  ```
  `subjectMatches` is true when `chosen[0]` matches `filter` (`matchesFilter` on the instance, wherever it is — hand, field or Break Zone).
  Program counter: `if` owns TWO levels — `path[depth + 1]` is the branch (0 = then, 1 = else), then the index within it. `effectAtPath` walks `eff.then`/`eff.else` accordingly.

- [ ] **Step 1: Failing tests (engine).** Synthetic Palom-shaped clause: ETB `chooseTargets` 1 Forward → `[{ kind: 'if', when: { kind: 'controlsAtLeast', count: 1, controller: 'self', filter: { name: 'T-MARK' } }, then: [{ kind: 'damage', amount: 8000 }], else: [{ kind: 'damage', amount: 4000 }] }]`. Cases: without `T-MARK` the target takes 4000; with it, 8000. Suspension: a clause `[{ kind: 'if', when: <true>, then: [{ kind: 'chooseTargets', …, then: [{ kind: 'dull' }] }] }]` raises `chooseTargets`; answering it dulls the pick; `effectAtPath(effects, frame.path, frame.modes)` returns the inner `chooseTargets` while suspended. Resume-on-branch: between raising and answering, change the state so the condition would be false (remove `T-MARK` directly); the answer still runs the `then` branch (Review Focus 2). `subjectMatches`: choose a Forward, `if subjectMatches { element: 'fire' }` then damage 5000 else 1000.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement `runEffect`'s `if` case**, mirroring `chooseModes`:
  ```ts
  case 'if': {
    // Answered: the branch was fixed when the prompt inside it was raised — never re-read the condition.
    const branch = answered ? (ctx.resume[depth + 1] ?? 0)
      : (conditionHolds({ state: ctx.state, source: ctx.source, controller: ctx.controller }, eff.when, ctx.chosen) ? 0 : 1)
    const effects = branch === 0 ? eff.then : (eff.else ?? [])
    ctx.path = [...ctx.path.slice(0, depth + 1), branch]
    runEffects(ctx, effects, depth + 2, answered)
    return
  }
  ```
  An `if` is not a choice node, so the declare stage ends at it (a condition is read at resolution). In `effectAtPath` add:
  ```ts
  if (eff.kind === 'if') { const k = path[depth + 1]; const b = k === 0 ? eff.then : k === 1 ? eff.else : undefined; return b ? walk(b, depth + 2) : null }
  ```
  Check how `ctx.resume` is compared in `runEffects` (`depth + 1 < ctx.resume.length`) so the two-level node is recognised as answered — follow `chooseModes` exactly.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: AI pricing (failing test first).** In `candidates.test.ts`: a Palom-shaped Summon whose `if` picks 8000 when `T-MARK` is on the field ranks a 7000 Forward as a kill (outranks a 3000 one's chip) only when `T-MARK` is present. Implement: in `targetDelta` and `effectsValue`, an `if` recurses into the branch `conditionHolds` picks NOW (with `chosen = [id]` in `targetDelta`). In the web `targetVerb` walker add `else if (e.kind === 'if') { walk(e.then); walk(e.else ?? []) }`.
- [ ] **Step 6: Run** `pnpm vitest run packages/ai/test/candidates.test.ts` and `pnpm typecheck` — PASS.
- [ ] **Step 7: Commit** `feat(engine,ai,web): the if effect and subjectMatches (V1-A1)`.

### Task 4: counted damage

**Files:**
- Modify: `packages/engine/src/abilities.ts` (`damage` effect's `amount`)
- Modify: `packages/engine/src/resolve.ts` (`damage` case)
- Modify: `packages/ai/src/candidates.ts` (`targetDelta` `damage`)
- Test: `packages/engine/test/conditions.test.ts`, `packages/ai/test/candidates.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type Amount = number | { readonly per: { readonly controller: 'self' | 'opponent'; readonly filter?: DefFilter }; readonly times: number }
  export function amountOf(state: GameState, controller: PlayerId, amount: Amount): number   // abilities.ts or layer.ts, exported
  ```
  The count uses the same Character count as `controlsAtLeast` (share one helper `countControlled(state, player, filter)`).

- [ ] **Step 1: Failing test.** Zack-shaped clause: `forEach { zone: 'forwards', controller: 'opponent' } do [{ kind: 'damage', amount: { per: { controller: 'self', filter: { type: 'backup' } }, times: 1000 } }]`. With 3 own Backups each opponent Forward takes 3000; with 0 Backups nothing changes and no `abilityDamage` event is emitted (Review Focus 4).
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.** `const amount = amountOf(ctx.state, ctx.controller, eff.amount)`; skip the whole effect when `amount <= 0`. Replace every other read of a damage effect's `amount` (grep `eff.amount` in `packages/ai/src` and `apps/web/src`) with `amountOf(...)`.
- [ ] **Step 4: AI test + fix**: `targetDelta` prices counted damage by `amountOf` now (3 Backups → a 3000-power target is a kill).
- [ ] **Step 5: Run** — PASS; `pnpm typecheck`.
- [ ] **Step 6: Commit** `feat(engine,ai): counted damage amounts (V1-A1)`.

### Task 5: verify and ship

- [ ] Full gate: `pnpm typecheck && pnpm lint && pnpm test && pnpm test:browser` — all green (the pool is unchanged, so no seed moves).
- [ ] Spec: add an "As built (V1-A1)" note under the status block with the commit range.
- [ ] Commit the spec and this plan; push `feat/v1a1-triggers-conditions`; PR; merge on green; fast-forward the worktree and the main checkout.

## Later PRs (outline; each gets its own plan)

- **V1-A2** — `putIntoBreakZone`; `chooseTargets.chooser: 'opponent'` (select: no `observesChosen`, ignores "cannot be chosen", not a castability gate); `onlyIfChosen`; `TargetSpec.zone: 'hand'` with hidden candidates in the opposing view; `discard`; `putOntoField` from hand; `activate`.
- **V1-A3** — `anyOf`; multi-job match on `job.split(' · ')`; `sameElementAsChosen`; special abilities (`special`, `discardSameName`) and the §11.7 rows; `onlyCp` payment restriction; `cannotUseActionAbilities`.
- **V1-B** — Vol. 1 data, the exclusives patch, 22 encodings, deck files, Layer 3 scenarios, pool gap table, strict self-play.
- **V1-C** — per-seat deck picker (web + CLI), per-seat decks through the coordinator, worker and agents; e2e re-pins with a finder.

---

## Revisions after the Codex plan review (2026-09-29)

Adjudication: `2026-09-29-rung-v1a1-triggers-conditions.codex-review.md`. These override the tasks above where they differ.

- **R1 (H1)** — `conditionHolds` lives in `resolve.ts` (where `matchesFilter` is), exported through `index.ts`;
  it delegates every `StaticCondition` to `layer.ts`'s `staticApplies` and handles `subjectMatches` itself.
  `controlsAtLeast` stays in `staticApplies` (definition-only, no cycle).
- **R2 (H3)** — thread the frame's `controller` through `targetScore`/`targetDelta`/`effectsValue` and every caller;
  `conditionHolds` and `amountOf` take it, never `state.cards[source].owner`.
- **R3 (H4, H5, M8)** — web: `verbOf` handles `if` and counted amounts. Where a frame is known (`targetVerb`), the
  condition and the count are evaluated on `stateShim(v)` with the frame's controller, so the prompt names the branch
  and the number that will actually apply; with no frame (`clauseTargetVerb`), `if` shows its `then` branch and a
  counted amount reads "1000 for each Backup you control". `commands.test.ts` cases for both branches and both forms.
- **R4 (M2)** — `StaticScope.self?: true` ("<this card> gains …"): the scope is the source alone. A name filter is
  wrong: LB Zack 22-112R shares the name. `validateContinuousStatics` accepts it; Task 2's test uses it.
- **R5 (M1, M4)** — spec V1-D6 amended: a condition's filter is a `DefFilter` (definition only), static or not.
  `validateContinuousStatics` also checks `when.controlsAtLeast` (definition-only filter, integer `count` ≥ 1).
- **R6 (M3)** — `activate.ts` `needsChoice` recurses into both `if` branches, so a chooser under an `if` in an
  activated ability hits the existing loud rejection (C3-1). Test it.
- **R7 (M5, M6, M7)** — tests: `subjectMatches` on a chosen card after `moveToHand` moved it; zero counted damage
  with a `dealtDamage` watcher on the source asserts nothing is queued; the party test asserts both distinct
  attacker ids as the frames' sources and controller 0.
- **R8 (H2, narrowed)** — no cache. Within one frame no card leaves the field by damage: breaks are rule processes
  run between frames (`resolve.ts` damage case, §12.4.5). So every hit of a sweep reads the same count. Spec V1-D7
  is reworded to say that; a future clause whose own sweep moves counted cards gets the cache then.
- **R9 (LOW)** — `Condition` and the `if` member are two declarations; Task 4 lists `apps/web/src/game/commands.ts`
  and its test; the frame-cause comment (`abilities.ts` ~412) and the program-counter comment (`resolve.ts` ~217)
  name `attacks` and `if`.
