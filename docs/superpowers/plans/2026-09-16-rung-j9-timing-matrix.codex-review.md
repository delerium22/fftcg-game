# Rung J9 — Codex plan review and adjudication

Codex (GPT-5.6-Sol, `xhigh`, read-only) reviewed `2026-09-16-rung-j9-timing-matrix.md` against the working tree
WHILE the plan was being executed (the review took ~25 minutes; the build was committed underneath it), so some
findings describe the plan's snippets and were already fixed in the built tests by the probe-derived goldens. Each
is adjudicated against HEAD after the build. Findings are hypotheses; accepts and rejects both carry evidence.

## Changelog

**Accepted and applied (commit after 0c0c692):**
- CRITICAL-4 / MEDIUM-6: the activation order (cost paid, THEN the item placed; targets validated post-cost) is a
  CR §11.6.3–4 deviation. Marked in `activate.ts`; matrix rows 11.6.3 and 11.6.4 are `simplified`; the audit's
  §11.6 row is `partial`; §11.1 is `partial` too for the missing End Phase window. Unobservable in this pool
  (§11.6.5 forbids self-targeting; no cost removes another card a choice could name).
- HIGH-1: six over-claimed rows reclassified — 11.3.7, 11.4.6, 11.6.9 ("cost is locked": `n/a`, nothing in the
  pool changes a cost between declaration and payment); 11.8.15 (`n/a`, no replacement effects); 11.8.3 (`n/a`,
  no pool card triggers in a phase without a window); 12.2 cites the settle-runs-it test; 11.3.5 and 11.3.8
  paraphrases narrowed to what the cited tests show. Rows 11.11.4/11.11.7 now cite `abilities.ts`, where the LKI
  marker actually is — the loose marker check had let `resolve.ts` pass.
- HIGH-2: the referee now requires a `MVP0-SIMPLIFICATION` marker that CITES the row's section or an ancestor
  (`markerCites`), restricts marker paths to `packages/*/src`, rejects empty `#fragment`s and non-heading rows
  outside the scope (MEDIUM-5). Markers in `attack.ts`, `phases.ts`, `abilities.ts` gained the sections they
  cover. Fixtures added for each new refusal.
- HIGH-4: `heading` added to the spec's status vocabulary with the reason.
- HIGH-6: spec J9-A3 reworded to what was built (four new compositions with sequences, three by citation).
- HIGH-7: traces distinguish `broken:` (the §12.4.5 rule process) from `abilityBroken:` (a `breakCard` effect);
  the engine trace carries `drew`'s count; the cards trace adds flags and to-hand moves.
- HIGH-8: cloud-turn now resolves Cloud's attack-phase trigger and asserts the `cannotBeBroken` flag;
  ramuh-in-a-window continues through the no-block, the point of damage, and Prishe's damage trigger retrieving
  Luso from the Break Zone.
- HIGH-9: the full suite was re-run after Codex released the CPU; exit code and unhandled-error count are in the
  report, not waved through.
- LOW-1..5: the plan is marked ARCHIVAL; its snippets are not corrected individually (the built source is
  authoritative and the as-built note lists every difference).

**Accepted, already true at HEAD before the review landed (fixed by the probe during the build):**
- CRITICAL-1 (five API shapes), CRITICAL-2 (harness extraction range, `setPlayer` exported), CRITICAL-3
  (goldens: activate→cost→push→trigger; per-item trigger/push; P0-before-P1 rule breaks; Prishe's chosen-trigger
  above Ramuh), MEDIUM-2 (explicit Ramuh payment), MEDIUM-3 (`drew` count, `step:` form), MEDIUM-4 (missing-file
  fixture). All recorded in the plan's as-built note.

**Rejected:**
- HIGH-3 (`n/a | pending Task N` rows): never used. The committed matrix cited the Layer 1/2 files from the first
  commit and the referee was red until those files landed within the same session; no row ever claimed `n/a` for
  a rule that is reachable. The option in the plan text was not taken.
- HIGH-5, second half ("priority remains populated through Active/Draw"): `state.priority` is a field, not a
  grant; the observable claim of §9.1.1.2/§9.2.1.2 is that no command boundary exists in those phases, which the
  test asserts (one `apply` spans end→active→draw→main1). First half accepted: the §11.8.3 citation was removed.
- MEDIUM-7 (skills unavailable): Codex cannot see this session's skill set; `superpowers:*` and `handoff` exist
  here and were used.

**Disagreed with Codex on:**
- CRITICAL-3, "rule-break events are emitted P0 before P1, contrary to the plan": the plan's Task 5 golden did
  say `broken:sphene, broken:luso`, and the built test says `broken:luso, broken:sphene` — Codex is right about
  the engine and the built test already matched it; recorded here so the plan's stale line is not trusted.

## The review as delivered

Literal-reference audit: **none missing**. All **156/156** `pkg/file#fragment` references in the current matrix occur literally on a `describe`/`it` line.

## CRITICAL

- **The supplied test snippets do not compile against the real APIs.** Task 3/4/5 use `players[1].damage` instead of `damageZone`, import `powerOf` from `abilities.ts` instead of `state.ts`, define `{kind:'draw', amount}` instead of `count`, read `abilityDamage.card` instead of `target`, and assert pending kind `chooseModes` instead of `chooseMode`. See [plan:549](</Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/docs/superpowers/plans/2026-09-16-rung-j9-timing-matrix.md:549>), [plan:646](</Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/docs/superpowers/plans/2026-09-16-rung-j9-timing-matrix.md:646>), [plan:682](</Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/docs/superpowers/plans/2026-09-16-rung-j9-timing-matrix.md:682>), [plan:707](</Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/docs/superpowers/plans/2026-09-16-rung-j9-timing-matrix.md:707>), [plan:1112](</Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/docs/superpowers/plans/2026-09-16-rung-j9-timing-matrix.md:1112>), versus [events.ts:87](</Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/events.ts:87>), [abilities.ts:108](</Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/abilities.ts:108>), [state.ts:44](</Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/state.ts:44>), and [state.ts:219](</Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/state.ts:219>). **Change:** correct all five shapes in the executable snippets, not only in the as-built note.

- **The harness extraction range is destructive and incomplete.** Task 5 says copy/delete lines 19–108, but `DEFS` originally began at line 18 and line 108 was `const apply = applyNow`; it also says leave `setPlayer` private even though `abilities.test.ts` calls it nine times. The current code had to export/import it at [harness.ts:37](</Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/cards/test/harness.ts:37>) and [abilities.test.ts:18](</Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/cards/test/abilities.test.ts:18>). **Change:** extract declarations by symbol, include `DEFS`, exclude local aliases, and export/import `setPlayer`.

- **Several golden sequences contradict the engine’s actual ordering.** Actual activation order is `abilityActivated → cost events → stackPushed(action) → abilityTriggered → stackPushed(trigger)` ([activate.ts:293](</Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/activate.ts:293>), [apply.ts:97](</Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/apply.ts:97>)); the plan’s Cloud golden puts the trigger before the action push. Combat immediately raises Lightning’s cost-movement trigger, and trigger placement is `trigger/push` per item, not both triggers then both pushes. Rule-break events are emitted P0 before P1, so Luso precedes Sphene, contrary to [plan:1071](</Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/docs/superpowers/plans/2026-09-16-rung-j9-timing-matrix.md:1071>). Ramuh also places Prishe’s chosen trigger above the Summon before Ramuh can resolve. **Change:** replace the stale goldens with the actual event contract and explicitly represent simultaneous rule-process batches.

- **The plan knowingly accepts a CR activation-procedure deviation while claiming J9-D6 found none.** [plan:1012](</Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/docs/superpowers/plans/2026-09-16-rung-j9-timing-matrix.md:1012>) says §§11.6.3–11.6.4 require stack-then-pay but instructs accepting the engine’s pay-then-place behavior. Those matrix rows remain `tested`, and `activate.ts` has no section-specific `MVP0-SIMPLIFICATION`; this contradicts [spec:63](</Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/docs/superpowers/specs/2026-09-16-rung-j9-timing-matrix.md:63>) and the claim at [plan:24](</Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/docs/superpowers/plans/2026-09-16-rung-j9-timing-matrix.md:24>). **Change:** either demonstrate that the difference is only event serialization, or mark the affected rows `simplified` with marker and failing conformance test.

## HIGH

- **The meta-test proves textual existence, not that a cited test tests the row.** Concrete false claims include cost locking (§§11.3.5/.7, §11.4.6, §11.6.9), replacement events (§11.8.15), and uncontrolled rule processes (§12.2); their cited tests assert different behavior. See [timing-matrix.md:93](</Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/docs/rules/timing-matrix.md:93>), [timing-matrix.md:108](</Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/docs/rules/timing-matrix.md:108>), [timing-matrix.md:125](</Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/docs/rules/timing-matrix.md:125>), [timing-matrix.md:164](</Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/docs/rules/timing-matrix.md:164>). **Change:** manually reclassify these rows or add focused assertions; do not call the syntactic checker a truth referee.

- **Simplification validation can be satisfied by an unrelated marker.** The checker only searches the named file for any `MVP0-SIMPLIFICATION` token ([timing-matrix.test.ts:72](</Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/test/timing-matrix.test.ts:72>)). **Change:** require the marker to include the row’s section or a declared parent-section mapping, and restrict paths to `packages/**/src/*.ts`.

- **Temporary `n/a | pending Task N` rows deliberately make a false matrix green.** This conflicts with the defined meaning “unreachable with the pool” and with the plan’s truthfulness goal ([plan:224](</Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/docs/superpowers/plans/2026-09-16-rung-j9-timing-matrix.md:224>)). **Change:** use an explicit draft status excluded from release gates, or sequence test creation before publishing the `tested` row.

- **`heading` violates the specification’s status vocabulary.** The spec permits only `tested`, `simplified`, and `n/a` ([spec:23](</Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/docs/superpowers/specs/2026-09-16-rung-j9-timing-matrix.md:23>)); the plan silently adds `heading` ([plan:119](</Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/docs/superpowers/plans/2026-09-16-rung-j9-timing-matrix.md:119>)). **Change:** amend the spec explicitly or keep headings outside parsed data rows.

- **The Active/Draw Layer-1 test originally asserts the opposite of emitted events and still does not test the claimed rule.** `startTurn` emits both `phaseStarted(active)` and `phaseStarted(draw)` ([phases.ts:34](</Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/phases.ts:34>)); [plan:531](</Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/docs/superpowers/plans/2026-09-16-rung-j9-timing-matrix.md:531>) rejects `active`. More importantly, no waiting trigger is created, so the test cannot support matrix §11.8.3, and the state’s `priority` remains populated through these phases. **Change:** test an actual queued trigger and a direct no-command-boundary observable; otherwise mark the precise “nobody holds priority” claim simplified.

- **J9-A3 is not met.** The plan supplies four new compositions plus three citations, while the spec says seven with two by citation ([spec:74](</Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/docs/superpowers/specs/2026-09-16-rung-j9-timing-matrix.md:74>)). L2-e has no event sequence, J1-A5 is state-only, and C2-A5 asserts relative positions rather than an exact sequence. **Change:** add a fifth Layer-2 composition and give all seven explicit event sequences.

- **The trace abstraction erases the distinction the event model intentionally preserves.** Both traces collapse `broken` and `brokenByAbility`, so a test claiming “the rule process broke it” can pass if an ability did so instead; L2 also drops draw counts and ability sources. Compare [plan:708](</Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/docs/superpowers/plans/2026-09-16-rung-j9-timing-matrix.md:708>) with [events.ts:77](</Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/events.ts:77>) and [events.ts:92](</Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/events.ts:92>). **Change:** emit distinct `ruleBroken`/`abilityBroken` tokens, preserve source, and include `drew.count`.

- **Two Layer-3 scenarios stop before their promised final board.** Cloud ends with its attack-phase ability still stacked and never asserts the protection; Ramuh stops at `declareBlock` despite the script promising forced no-block and one damage ([plan:1086](</Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/docs/superpowers/plans/2026-09-16-rung-j9-timing-matrix.md:1086>)). **Change:** resolve Cloud’s trigger and assert flags; complete Ramuh through no-block, damage, and final zones.

- **Unhandled test-runner errors are incorrectly declared non-failures.** [plan:1255](</Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/docs/superpowers/plans/2026-09-16-rung-j9-timing-matrix.md:1255>) allows a green handoff despite unhandled timeout errors. **Change:** require a clean rerun or a zero-error report before setting the spec to BUILT.

## MEDIUM

- **The §11.3.8 row overclaims cast-trigger coverage.** Its Layer-1 test uses a vanilla Summon and checks only priority/stack resolution; it cannot test “cast-triggers fire” ([timing-matrix.md:97](</Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/docs/rules/timing-matrix.md:97>)). **Change:** split the claim or add a synthetic cast-observer test.

- **The Ramuh command selection does not guarantee the payment described by the scenario.** The cards harness empties only P0’s hand, so P1 has discard-payment alternatives; `.find(castSummon)` may choose something other than the two Red Mages. **Change:** issue the explicit `castSummon` command with `payment: {dullBackups: cp, discards: []}`.

- **The plan delegates directly inspectable event facts to trial-and-error.** `drew` is one aggregate event with `count` ([draw.ts:26](</Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/draw.ts:26>)), so the two `drew:1` expectation is predictably wrong; a step-bearing `phaseStarted` produces only `step:*` in the trace. **Change:** derive goldens from `events.ts` and emitters before writing tests.

- **The negative meta-test omits a missing-file fixture despite claiming all six failure classes.** The original fixture covers a dead fragment but not a nonexistent test file ([plan:194](</Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/docs/superpowers/plans/2026-09-16-rung-j9-timing-matrix.md:194>), [plan:1267](</Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/docs/superpowers/plans/2026-09-16-rung-j9-timing-matrix.md:1267>)). **Change:** add an explicit `engine/no-such-file#x` fixture.

- **The parser accepts malformed and extra claims.** An empty `#fragment` matches every test line; valid but out-of-scope sections are not rejected; `n/a` reasons need only be nonempty. **Change:** validate both sides of `#`, reject rows outside scope except declared headings, and require substantive reasons.

- **The audit refresh overstates conformance.** Task 6 marks §11.1 and §11.6 `ok` while acknowledging the absent End Phase window and omitting the activation-order discrepancy ([plan:1225](</Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/docs/superpowers/plans/2026-09-16-rung-j9-timing-matrix.md:1225>)). **Change:** use `partial` until those deviations are either proved equivalent or marked.

- **Required workflow skills are unavailable in the stated environment.** Neither the `superpowers:*` skills nor `handoff` named at [plan:3](</Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/docs/superpowers/plans/2026-09-16-rung-j9-timing-matrix.md:3>) and [plan:1261](</Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/docs/superpowers/plans/2026-09-16-rung-j9-timing-matrix.md:1261>) exists in the available skill set. **Change:** remove the hard dependency or name an available fallback workflow.

## LOW

- **The as-built note records corrections but leaves the executable steps stale.** Replaying Tasks 1–5 now would duplicate markers or overwrite already-correct files. **Change:** clearly mark the plan archival, or update every snippet to the built source.

- **The proposed code violates lint before tests run.** `readdirSync`, `statSync`, and both `NO_PAY` declarations are unused, while the repository treats unused variables as errors. **Change:** remove them from the snippets.

- **The preservation check for `abilities.test.ts` is ineffective.** BSD `grep` does not portably interpret `\s`, it misses `it.each`, and the command does not compare before/after counts ([plan:903](</Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/docs/superpowers/plans/2026-09-16-rung-j9-timing-matrix.md:903>)). **Change:** use Vitest’s reported test count or a portable regex and explicit comparison.

- **The meta-test interface description is internally inconsistent.** It says “exports nothing” but exports `SCOPE`, `Row`, `parseMatrix`, and `problems`; `problems` is also described as pure despite filesystem reads. **Change:** document the actual test-only API or keep those symbols private.

- **Commit snippets omit the mandated co-author trailer.** This conflicts with the global constraint at [plan:34](</Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/docs/superpowers/plans/2026-09-16-rung-j9-timing-matrix.md:34>). **Change:** include the trailer in every shown commit command.