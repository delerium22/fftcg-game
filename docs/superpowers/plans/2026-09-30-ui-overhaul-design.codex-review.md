# UI/UX overhaul design spec — review adjudication

**Spec:** `docs/superpowers/specs/2026-09-30-ui-overhaul-design.md`, reviewed at `9dd8eb7`.
**Reviewers:** Codex (`codex-cli 0.146.0`, gpt-5.6-sol, effort xhigh, read-only) and a fresh-context Fable
`verifier` agent (read-only, with a throwaway view-diff census over 20 Greedy-vs-Greedy games, 6,939 applies).
Both reviewed the spec against the code independently, without my conclusions.

**Result:** Codex raised 2 CRITICAL, 6 HIGH, 9 MEDIUM and 4 LOW; Fable raised 2 HIGH, 6 MEDIUM and 2 LOW.
Several are the same defect found twice.
All accepted except one factual disagreement (the Motion version) and one partial rejection (the payment
source). The architecture in spec §4 was rewritten. Its core idea (a displayed state that trails the real one)
survives, but it now diffs a flat render projection instead of `PlayerView`, and gameplay input waits for
convergence.

## Adjudication

Each finding was checked against the code before it was accepted or rejected. The evidence column names what
was read.

### CRITICAL and HIGH

| # | Finding | Verdict | Evidence and change |
|---|---|---|---|
| Codex C1, Fable 1 | Per-card diffs of `PlayerView` can't form a valid view. `DeckSlot`s are positional with `null` entries; `cards`/`knownBy`/`priority`/`passes`/`resolution` go undiffed. The board rebuilds a `GameState` (`stateShim`, `commands.ts:1193`) and recomputes continuous effects over it, so a partial view either shows wrong power or throws (`unknown card id 72`, reproduced by the Fable census on a cast). | **Accept** | Read `stateShim` and `view.ts:36-57`. New §4.3: the board renders a flat **`BoardModel`** from `project(view)`, run only on *complete* views. The director diffs `project(before)` against `project(after)`. No engine or shim code ever runs on a partial state. |
| Codex C2, Fable 2 | Unlocking input after a soft beat's `interruptibleAt` pairs authoritative `choices` with a stale board: a card shown in its old zone, spurious "Choose a card" orphans (`Board.tsx:176, 555`), and set commands built from the displayed view that `choose` then rejects and throws (`useGame.ts:646`). | **Accept** | Read `orphanTargetIds` and `choose`. New §4.4: gameplay input unlocks only at **convergence** (displayed = authoritative). Until then the Board gets an empty `ChoiceSet` that keeps the prompt. Beats release all their diffs at their emphasis point, and only decoration runs after, so the player still regains control before the animation tail ends. |
| Codex H1 | `usePresentation(game)` wraps a game whose coordinator already exists, so it can't inject an idle gate. | **Accept** | `createAiSearch` is built inside `useGame` (`useGame.ts:574`). The director is now owned by `useGame` and passed to the coordinator at construction. |
| Codex H2 | A boolean idle check inside the one-shot delivery timer stalls the AI for good. | **Accept** | `schedule()` sets one `clock.after`; a callback that returns early leaves nothing scheduled (`coordinator.ts` `schedule`/`deliver`). New §4.5: a cancellable `whenIdle(cb) → cancel` held in `delivery`, with a recheck after waking; `decisionIndex` still advances only in `deliver`. Named tests listed. |
| Codex H3 | Raw `Event[]` and `Command` carry hidden IDs (`deckExposed.cards`, the AI's private picks), and IDs follow decklist order. | **Accept** | Read `events.ts:33`. In a single-player page the whole `GameState` is in memory anyway, so this is not a new cheat. It does break spec B3 and the "serialisable" claim. New §4.1: the director receives a redacted `PresentationStep` (projections plus redacted facts plus a public telegraph descriptor). |
| Codex H4, Fable 4 | The hook API gives live regions nothing displayed to follow. `aiThinking` and the log are authoritative. 15 jsdom tests build `GameApi` by hand. | **Accept** | Read `types.ts:54`, `PromptStrip.tsx:31-76`, `announcements.test.tsx:41`. New §4.6: `useGame` still returns a `GameApi`, whose `view`, `log`, `aiThinking` and `choices` are now the displayed or gated ones. New fields are optional, so hand-built fixtures keep working. Warnings join the stream as decoration-only facts. |
| Codex H5 | Endpoint views can't render a card that is public only in the middle of a step, and `settleWindows` flattens applies. | **Accept (restrict)** | The Fable census found 0 transient stops in the Vol. 2 corpus. Stage actors render only identities in `before.cards ∪ after.cards` (the existing `narrator` union) and use a card back otherwise. `settleWindows` (web code) returns per-apply boundaries. A richer reveal needs an engine fact under D7. |
| Codex H6, Fable 10 | Instant through `storageState` misses `how-to-play.spec.ts` (it resets storage), and 0 ms timers are still asynchronous. UO-A4 contradicts V1-C's planned route re-pins. | **Accept** | Read `how-to-play.spec.ts:11`. Instant now **drains synchronously inside `commit`**, with no timers. The board root carries `data-presentation="idle|playing"`. The how-to-play spec gets `?motion=instant`. UO-A4 allows V1-C's re-pins and opening the log drawer. |
| Codex H7 | The convergence test has no defined projection, and 200 Greedy games miss rare transitions. | **Accept** | The `BoardModel` is the canonical projection. Invariants are checked after every beat, equality at idle, plus targeted fixtures (§10). |

### MEDIUM

| # | Finding | Verdict | Evidence and change |
|---|---|---|---|
| Codex M1 | The event table isn't exhaustive (46 variants), and `cpGenerated` doesn't name the dulled backups. | **Accept in part** | Accepted: a compile-time `Record<Event['type'], 'beat' \| 'logOnly' \| 'settle'>`. Rejected: "the payment source can't be identified". The backups dulled to pay are exactly the step's active→dull status diffs not named by `attackDeclared` or `dulled`, and the discards are named by `discarded{reason:'cp'}`. |
| Codex M2 | Every face-up card is a button that opens its sheet (`Card.tsx:275`). Disabling presses breaks inspection. | **Accept** | Read `Card.tsx`. While locked, presses still open the `CardSheet`, with its commit actions hidden. §6 says the hover preview replaces the `CardDetails` rail and the `CardSheet` workflow stays. |
| Codex M3 | Collapsed zones have no per-card anchors, and simultaneous moves can't share one pile node. | **Accept** | Every zone gets an anchor. Stage actors use per-move lanes. |
| Codex M4 | Membership in `view.cards` doesn't mean face-up: both LB decks are in `cards` while face-down (`view.ts:72`). | **Accept** | The projection carries an explicit `face` per card from a zone visibility rule. `layoutId` follows the projection, not `cards`. |
| Codex M5, Fable 6 | IDs restart at 1 while the Board stays mounted (`Board.tsx:213`), and `restart` bypasses `commit` (`useGame.ts:679`). | **Accept** | A game-generation number namespaces keys and `layoutId`s. `restart` resets the director synchronously. |
| Codex M6 | Turning full control off settles windows and commits, so it's gameplay input. | **Accept** | It is locked until convergence, like other gameplay input. |
| Codex M7, Fable 8 | `?seed=` parsing lives in `App.tsx`, which V1-C edits, and so do `styles.css`, `Board.tsx`, `useGame.ts` and `deck.ts`. | **Accept** | Read V1-C plan Files lines. U0 parses flags in a new `bootstrap.ts` wired from `main.tsx`. U1 is confined to a new `tokens.css`, `Card.tsx` and `Card.css`. |
| Codex M8 | U5 and U6 both start after U4 and overlap. | **Accept** | The ladder is now strictly sequential. |
| Codex M9 | "Four permanent text cards" is stale: V1 adds four more exclusives. | **Accept** | The count is dropped; fallback is data-driven. |
| Fable 3 | Per-card index diffs collide or leave holes under partial release (311 applies shift a neighbour's index), and 19 applies change the stack by more than one entry. | **Accept** | A zone materialises as the cards displayed in it, sorted by displayed index then ID. Stack entries are a keyed list with insert/remove, so each push gets its own beat. |
| Fable 5 | "Conceding always works" has no control off-turn (`PromptStrip.tsx:173`). | **Accept** | U2 adds an always-available Concede in the top bar menu. The engine already allows it at any time (`apply.ts:72`). |
| Fable 7 | "Open the existing zone sheets": none exist. A closed LB pile hides castable LB cards from the e2e driver. The Forward dull geometry is unspecified, and V1-C's toolbar is missing from the layout. | **Accept** | U2 builds a `ZoneSheet`. Your LB deck stays a compact fan beside the hand (gridcell buttons as today, so the driver is unchanged), and the AI's becomes a pile. A dull Forward is `rotate(90deg) scale(0.72)` inside its portrait slot. There is an overflow rule, and V1-C's toolbar goes in the top bar. |

### LOW

| # | Finding | Verdict | Evidence and change |
|---|---|---|---|
| Codex L1 | "Motion 13.4.6 is wrong (npm page says 13.4.1); `^` isn't a pin." | **Disagree on the version, accept the pin** | `npm view motion version` returned `13.4.6` on 2026-09-30 (the registry, a primary source). U4 re-checks and pins an exact version. |
| Codex L2, Fable 9 | The prompt strip isn't sticky; each seat scrolls on its own. `handCount` is on both `FieldView`s. There are 46 event types. | **Accept** | Read `styles.css:137-162` and `view.ts:27`. §2 corrected. |
| Codex L3 | Cards already have crystal-coloured frames, backs and fallbacks. | **Accept** | U1 is now defined as measurable changes to the existing treatment. |
| Codex L4 | A closed drawer must keep the `role="log"` node mounted and exposed. `announcements.spec.ts` expects visible lines. | **Accept** | The closed drawer hides its panel with the visually-hidden pattern (never `display:none`, `hidden`, `aria-hidden` or `inert`), and that e2e opens the drawer first. |

### Held up under review (no finding)

- The coordinator's D2-4 identity gate survives the idle gate. There is no deadlock, because beats are
  clock-driven and never wait on a human decision (Fable).
- StrictMode: batches are made in `commit`, not in effects, so the existing cleanup still discards the doubled
  request (Fable).
- The settle beat converges once the diff set is complete (Fable).
- Confirmed facts: React 19.2.8, `apply` returns events, IDs are minted before the shuffle (`setup.ts:216`),
  events are dropped at `commit`, and the 600 ms delivery hold.

---

## Appendix A — Codex review (verbatim, paths made repo-relative)

## CRITICAL

- **“Before + released per-card diffs” cannot maintain a valid `PlayerView`.** Decks are positional `DeckSlot`s with anonymous `null` entries and knowledge masks; card visibility is duplicated across `cards`, `knownBy`, zone arrays, `hand`, and `handCount`; pending/resolution/stack contain cross-card references. Worse, the UI reconstructs a `GameState` and recomputes continuous effects globally, so releasing one static-effect source can immediately change unreleased cards. ([spec §4.3](docs/superpowers/specs/2026-09-30-ui-overhaul-design.md:121), [view.ts](packages/engine/src/view.ts:14), [commands.ts](apps/web/src/game/commands.ts:1193), [layer.ts](packages/engine/src/layer.ts:83)).  
  **Change:** Define an explicit render projection with atomic patch types—zone membership plus visibility record plus count, deck-slot replacement, and semantic-state replacement—or release coherent projection snapshots per beat. Do not patch arbitrary `PlayerView` fields independently.

- **Soft-beat unlocking exposes authoritative actions against stale visuals.** `choices` is calculated from authoritative state, while the proposed board renders an older view. An action may therefore attach to a card shown in its previous zone, or to a newly visible card absent from the displayed view; existing code already turns such choices into `?` orphan targets. Collapsing only after the click is too late—the target was selected from a false display. ([spec §4.4](docs/superpowers/specs/2026-09-30-ui-overhaul-design.md:153), [useGame.ts](apps/web/src/game/useGame.ts:629), [Board.tsx](apps/web/src/ui/Board.tsx:337), [Board.tsx](apps/web/src/ui/Board.tsx:550)).  
  **Change:** Keep gameplay controls locked until the displayed interaction projection equals authoritative state, or synchronously collapse and rerender before accepting the activating input. Never combine displayed locations with unfiltered authoritative `ChoiceSet`s.

## HIGH

- **The proposed presentation-idle gate has no viable ownership path.** `SearchCoordinator` is constructed inside `useGame`, whereas the proposed `usePresentation(game)` wraps the already-created game. The wrapper cannot inject its idle state into that coordinator without inverted ownership or an external store. ([spec §4.5](docs/superpowers/specs/2026-09-30-ui-overhaul-design.md:166), [spec §4.6](docs/superpowers/specs/2026-09-30-ui-overhaul-design.md:181), [useGame.ts](apps/web/src/game/useGame.ts:574)).  
  **Change:** Create the presentation scheduler before `useGame` and inject a cancellable delivery-gate interface, or move AI delivery ownership outside `useGame`.

- **A boolean idle check can permanently stall AI delivery.** The coordinator currently schedules one timer, rechecks staleness, then delivers. If that callback merely finds presentation busy and returns, no state change necessarily occurs to trigger another request. Invalidation must also cancel an idle waiter while preserving the delivery target used by failure recovery. ([coordinator.ts](apps/web/src/game/search/coordinator.ts:311), [coordinator.ts](apps/web/src/game/search/coordinator.ts:374), [coordinator.ts](apps/web/src/game/search/coordinator.ts:421)).  
  **Change:** Use a cancellable `waitUntilIdle(callback)` subscription retained as delivery state. Recheck request ID, state identity, actor, disposal, and pacing after wake-up; increment `decisionIndex` only immediately before a real commit. Add false→idle, invalidate-while-waiting, restart, fallback, and dispose tests.

- **Raw `Event[]` and `Command` invalidate the claimed hidden-information boundary.** `deckExposed` contains actual card IDs, and commands can contain the AI’s private card selections. Human `before`/`after` views do not sanitize those adjacent fields; deck-order ID minting can make accidental leakage especially damaging. The resulting object is not a safe replay/network DTO. ([spec §4.1](docs/superpowers/specs/2026-09-30-ui-overhaul-design.md:94), [events.ts](packages/engine/src/events.ts:33), [setup.ts](packages/engine/src/setup.ts:213), [useGame.ts](apps/web/src/game/useGame.ts:161)).  
  **Change:** Feed the director a viewer-redacted `PresentationEvent`/`PresentationCommand` DTO containing only permitted identities, public facts, and counts. Do not serialize raw engine events or commands as the presentation protocol.

- **The proposed hook API cannot make live regions follow displayed state.** `usePresentation` returns no displayed log or displayed choices/prompt. Today the log is appended with the authoritative commit, while `PromptStrip` combines authoritative `choices.prompt` and `aiThinking` with its supplied view. Search warnings also append outside batches. ([spec §4.6](docs/superpowers/specs/2026-09-30-ui-overhaul-design.md:181), [types.ts](apps/web/src/game/types.ts:54), [useGame.ts](apps/web/src/game/useGame.ts:615), [PromptStrip.tsx](apps/web/src/ui/PromptStrip.tsx:31)).  
  **Change:** Expose one display-facing facade containing coherent `view`, interaction choices/prompt, log, result, and AI status. Release terminal result and terminal log atomically, and define how out-of-band warning lines enter that stream.

- **Endpoint views plus current events cannot produce every promised stage actor.** A card can become public and hidden again during internal settling while the event records only its ID; neither endpoint necessarily contains its code or renderable state. `settleWindows` also flattens multiple applies and discards intermediate boundaries. This conflicts with “no engine changes through U7.” ([spec §4.3](docs/superpowers/specs/2026-09-30-ui-overhaul-design.md:141), [spec D7](docs/superpowers/specs/2026-09-30-ui-overhaul-design.md:463), [useGame.ts](apps/web/src/game/useGame.ts:502), [apply.ts](packages/engine/src/apply.ts:26)).  
  **Change:** Either restrict U7 actors to transitions reconstructible from redacted endpoint views, or preserve redacted intermediate presentation snapshots/facts at the engine boundary.

- **“Instant means existing E2E unchanged” is false.** Playwright’s global storage state can set the mode, but `how-to-play.spec.ts` replaces it with an empty origin. A zero-duration timer is still asynchronous, so the existing driver can race locks or open stale sheets. The prior V1-C spec also explicitly repins default routes, contradicting UO-A4’s “only selector edits.” ([spec §10](docs/superpowers/specs/2026-09-30-ui-overhaul-design.md:387), [spec UO-A4](docs/superpowers/specs/2026-09-30-ui-overhaul-design.md:429), [playwright.config.ts](playwright.config.ts:34), [how-to-play.spec.ts](apps/web/e2e/how-to-play.spec.ts:11), [prior V1-C spec](docs/superpowers/specs/2026-09-29-rung-v1-vol1-pool.md:242)).  
  **Change:** Enforce Instant through a shared fixture/query parameter that overrides every test, drain Instant batches synchronously, expose a presentation-idle marker for the driver, and permit V1-C’s required route/seed updates in UO-A4.

- **The convergence test is underspecified and can pass despite invalid intermediate state.** “Rendered projection” is not defined, while full `PlayerView` equality includes definitions, knowledge, counters, and resolution metadata that may never render. Two hundred Greedy games are also unlikely to cover rare visibility/knowledge transitions. ([spec §10](docs/superpowers/specs/2026-09-30-ui-overhaul-design.md:398), [view.ts](packages/engine/src/view.ts:36)).  
  **Change:** Define a canonical display projection and assert its invariants after every beat, then exact equality at idle. Add targeted fixtures for shuffle/knowledge loss, hidden→public→hidden, stack/resolution references, simultaneous moves, LB flips, and continuous-effect sources.

## MEDIUM

- **The event-to-beat table is not exhaustive and cannot drive some named animations.** The engine union has 46 variants; the table omits mulligan, first-player choice, ability activation, play source, dull/activate, prevention, no-target/unimplemented outcomes, and others. `cpGenerated` carries element sets but not which backup was dulled, so `beatsFor(step)` alone cannot identify the payment source. ([spec §8](docs/superpowers/specs/2026-09-30-ui-overhaul-design.md:315), [events.ts](packages/engine/src/events.ts:8), [cp.ts](packages/engine/src/cp.ts:259)).  
  **Change:** Require compile-time exhaustive classification of every event as animated, log-only, or settle-only. Give the mapper sanitized command/payment context or add public source facts.

- **The spec’s card-clickability premise is outdated.** Every face-up card is currently a button for inspection; only its gameplay actions are conditional on `choices.byCard`. Disabling all card presses during animation would break the established CardSheet inspection workflow and keyboard access, while leaving the sheet authoritative would expose stale actions. ([spec §2](docs/superpowers/specs/2026-09-30-ui-overhaul-design.md:58), [Card.tsx](apps/web/src/ui/Card.tsx:275), [CardSheet.tsx](apps/web/src/ui/CardSheet.tsx:95)).  
  **Change:** Preserve inspection while locked, but suppress all commit actions in CardSheet, trays, and prompts. State explicitly whether `CardDetails` replaces or wraps the existing modal workflow.

- **The anchor model covers too few zones.** Break, removed, LB, and collapsed damage areas generally have no persistent per-card DOM endpoint even when the identity is visible. Multiple cards cannot reliably animate through one pile-top layout node. ([spec D3](docs/superpowers/specs/2026-09-30-ui-overhaul-design.md:459), [Board.tsx](apps/web/src/ui/Board.tsx:516)).  
  **Change:** Define anchors for every collapsed/non-card zone, not just hidden cards, and allocate transient actor lanes for simultaneous movements.

- **Presence in `view.cards` does not mean “face-up identity.”** Both players’ LB deck identities are deliberately included in `cards` while individual LB cards can remain face-down. Assigning `layoutId` based only on record presence can reveal or incorrectly morph face-down LB cards. ([spec §4.3](docs/superpowers/specs/2026-09-30-ui-overhaul-design.md:143), [view.ts](packages/engine/src/view.ts:64), [state.ts](packages/engine/src/state.ts:32)).  
  **Change:** Base animatable identity on explicit zone visibility policy, not membership in `cards`.

- **Restart reuses card IDs while the Board remains mounted.** A bare `layoutId={card.id}` can morph a new game’s unrelated card from the old game’s last position. The current Board already documents this reuse. ([useGame.ts](apps/web/src/game/useGame.ts:679), [Board.tsx](apps/web/src/ui/Board.tsx:213)).  
  **Change:** Add a game-generation ID, namespace all motion identities and keys with it, and synchronously reset director state on restart.

- **Full-control toggling is an unlisted gameplay-advancing input.** Turning full control off can call `settleWindows`, invalidate AI search, and commit state. Allowing it during playback can enqueue an unpresented transition or invalidate the currently displayed batch. ([spec §4.4](docs/superpowers/specs/2026-09-30-ui-overhaul-design.md:153), [useGame.ts](apps/web/src/game/useGame.ts:667)).  
  **Change:** Treat this toggle as gameplay input: lock it, or collapse presentation before executing it.

- **U0’s stated file boundary conflicts with current query parsing and V1-C.** Seed/query handling lives in `App.tsx`, yet U0 proposes `?motion=instant` while claiming it avoids `App.tsx`; V1-C is already expected to edit that file. ([spec U0](docs/superpowers/specs/2026-09-30-ui-overhaul-design.md:406), [spec D15](docs/superpowers/specs/2026-09-30-ui-overhaul-design.md:482), [App.tsx](apps/web/src/App.tsx:19)).  
  **Change:** Defer App wiring until after V1-C, or extract location/settings parsing into a new bootstrap module with one post-merge integration point.

- **The ladder permits conflicting U5/U6 work.** Both start after U4 and both alter presentation/board behavior, while U6 payment/selection actors depend on U5 targeting state semantics. ([spec rung ladder](docs/superpowers/specs/2026-09-30-ui-overhaul-design.md:402)).  
  **Change:** Make U6 follow U5, or specify disjoint ownership and an integration rung.

- **The missing-art count is already stale against planned V1 work.** The UI spec names four permanent fallbacks, while the V1 pool spec adds four patched exclusives whose official art is also unavailable. ([spec §2](docs/superpowers/specs/2026-09-30-ui-overhaul-design.md:60), [prior V1 spec](docs/superpowers/specs/2026-09-29-rung-v1-vol1-pool.md:130), [prior V1 spec](docs/superpowers/specs/2026-09-29-rung-v1-vol1-pool.md:248)).  
  **Change:** Make fallback eligibility data-driven and avoid a fixed count in the design.

## LOW

- **The Motion version claim appears wrong, and `^13.4.6` is not a pin.** Motion is absent from the repository; the current npm package page reports 13.4.1 rather than 13.4.6. ([spec §2](docs/superpowers/specs/2026-09-30-ui-overhaul-design.md:40), [package.json](apps/web/package.json:12), [npm package page](https://www.npmjs.com/package/motion)).  
  **Change:** Verify the registry version during U4 and lock the exact tested version if reproducibility is intended.

- **The current-layout description overstates the prompt behavior.** `PromptStrip` is an ordinary grid-area element, not sticky-positioned; the seat columns themselves scroll. Card dimensions also reach roughly 60×80 only near the minimum viewport, not generally. ([spec §2](docs/superpowers/specs/2026-09-30-ui-overhaul-design.md:43), [styles.css](apps/web/src/ui/styles.css:153), [styles.css](apps/web/src/ui/styles.css:384), [Card.css](apps/web/src/ui/Card.css:37)).  
  **Change:** Correct the baseline description so acceptance comparisons measure the actual layout.

- **U1 duplicates existing card treatments without identifying the delta.** Current cards already have crystal-colored frames, card backs, and no-art fallbacks. ([spec U1](docs/superpowers/specs/2026-09-30-ui-overhaul-design.md:407), [Card.css](apps/web/src/ui/Card.css:73), [Card.css](apps/web/src/ui/Card.css:325)).  
  **Change:** Define U1 as a measurable replacement/refinement of those states, rather than implying they do not exist.

- **The drawer design can accidentally remove the log live region from accessibility APIs.** Existing tests depend on a stable, mounted `role="log"` node; closing a drawer with `display:none`, `hidden`, `aria-hidden`, or `inert` would defeat that requirement. ([spec §9](docs/superpowers/specs/2026-09-30-ui-overhaul-design.md:350), [EventLog.tsx](apps/web/src/ui/EventLog.tsx:17), [announcements.test.tsx](apps/web/test/announcements.test.tsx:176)).  
  **Change:** Require the closed drawer’s live-region node to remain mounted and accessibility-visible, with only its visual panel concealed.
---

## Appendix B — Fable review (verbatim)

**Verdict: PARTIAL.** §2 is accurate bar two small errors. The §4 architecture survives, but as written it crashes the board, throws on human input mid-batch, and cannot satisfy its own convergence assertion. Each defect has a concrete fix. §6, §10, §11 have gaps that plans must close.

Method: read the spec against the code; ran a per-apply view-diff census over 20 Greedy-vs-Greedy games (6,939 applies) plus a crash demo, scripts in the scratchpad, sources imported from the main checkout (verified byte-identical to this worktree via `diff -rq`).

**1. HIGH — §4.3's diff set does not match `PlayerView`, so displayed views are inconsistent and can crash render.**
§4.3 step 1 diffs per-card fields, counters and "turn, phase, attack step, stack, pending, result". `packages/engine/src/view.ts:36-57` also carries `cards`, `knownBy`, `priority`, `turnPlayer`, `passes`, `resolution`, `firstPlayer`, `mulliganDecided`, `putIntoBreakZoneFromFieldThisTurn`, and `deck` is `DeckSlot[]` not a count (`Seat` reads `f.deck.length`, `apps/web/src/ui/Board.tsx:146`). Consequences:
- Census: 621 applies put a card id into a public zone that `before.cards` lacks (AI casts, your draws). Demo: `partial = { ...before, fields: after.fields }` then `effectivePower(stateShim(partial), card)` → `unknown card id 72` (`packages/engine/src/state.ts:230-235`), which `fieldCardDisplay` calls for every field card (`apps/web/src/game/commands.ts:577-590`). The §7 `cast` beat releases exactly that zone diff.
- `priority` undiffed: `PromptStrip.yours` (`apps/web/src/ui/PromptStrip.tsx:45`) and `setKindFor` (`apps/web/src/game/selection.ts:23-26`) read it, so the attackers picker never appears on the displayed view.
- Step 4's "displayed = after" dev assertion fails on the first batch.
Fix: diff every `PlayerView` field; keep `cards`/`knownBy`/`defs` as the union of before and after until the settle beat (precedent: `narrator`, `apps/web/src/game/useGame.ts:379`).

**2. HIGH — §4.4/§4.6: commands built from the displayed view are checked against the authoritative state and throw.**
Input unlocks after a soft beat's `interruptibleAt` while later beats remain. `Board` builds set commands from `view`: `completedSelection(view, selecting)` (Board.tsx:430), `commandFor(view, …)` (604), `refusal` → `isLegal(stateShim(displayed))` (selection.ts:100-104). `choose` then runs `isLegal(current)` and throws (useGame.ts:646-647), unreachable today only because view and choices share one state. Also `orphanTargetIds(view, choices)` (Board.tsx:555, 176-179) shows a spurious "Choose a card" row for every authoritative candidate not yet displayed — e.g. the two cards drawn in the batch that hands you the turn (`settleWindows` applies land in the same commit, useGame.ts:543, 656-657). Census: 27 applies raise `chooseTargets` candidates absent from `before.cards`.
Fix: while displayed ≠ authoritative, hand `Board` an empty `ChoiceSet` (keep `prompt`), or make the pointer-down acknowledgement collapse the queue before any command is derived.

**3. MEDIUM — §4.3 "index" per-card diffs are ill-defined under partial release.**
Census: 311/6,939 applies shift a surviving card's index in its own zone; 277 coincide with a move. Example seed 1 apply 87: two Forwards broken, `p0.forwards[1]→[0]`, `p1.forwards[2]→[1]`. `Board` renders zones by `.map` over arrays, so releasing the break without the neighbour's index diff yields a hole or a collision. Fold in the stack: 19 applies change `stack.length` by more than one (e.g. `activateAbility`: 0→2), so §7's per-entry "slides into the stack" beat cannot come from the atomic stack diff §4.3 specifies.
Fix: define zone materialisation as "cards whose displayed zone is Z, ordered by displayed index, ties by id", or model zones and the stack as insert/remove/move ops.

**4. MEDIUM — §4.6 will break 15 jsdom fixtures and the prompt live region unless `usePresentation` is `GameApi`-shaped.**
15 test files render `Board` with a hand-built `GameApi` (e.g. `apps/web/test/announcements.test.tsx:41-49`); UO-A4 permits only selector edits. The prompt text mixes `aiThinking` (authoritative, useGame.ts:717) with `yours` (displayed) at PromptStrip.tsx:65-76: mid-batch it announces "The AI is thinking" before the human's move has landed, contradicting §4.6. The log appends at commit (useGame.ts:615-619); `appendLog` warnings (621, 549) bypass batches.
Fix: `usePresentation` returns `GameApi` with displayed `view`, `log`, `aiThinking` and gated `choices`; route warnings through the director.

**5. MEDIUM — §4.4 "conceding always works" has no control.** `PromptStrip` renders no actions when `!yours` (PromptStrip.tsx:173-174); there is no off-turn Concede today. Add one outside the `yours` gate; `concede` is legal any time (`packages/engine/src/apply.ts:72`).

**6. MEDIUM — restart bypasses the director.** `restart()` sets state directly, never `commit` (useGame.ts:679-691). With a queue still playing, `displayedView.result` stays set, the dialog stays open on the new game, and the `restarting` focus effect (Board.tsx:258-269) misfires. Fix: `restart` flushes the queue and jumps displayed.

**7. MEDIUM — §6 layout gaps.**
- "Open the existing zone sheets": none exist; `pileRow` renders an inline `Zone` grid (Board.tsx:316-323); `CardSheet` is per-card.
- LB deck as a pile: castable LB cards glow as gridcell buttons today (`lbItems`, Board.tsx:531-548) and the driver clicks `[role="gridcell"] button.is-selectable` (`apps/web/e2e/drive.ts:47`); a closed pile makes LB casts unreachable in e2e.
- 1280×720 arithmetic: V1-C's toolbar (R1, absent from the diagram) ~40, AI hand backs ~48, centre ~40, your hand ~96 visible, two backup rows ~112, gaps ~48 → ~168px per Forwards row, cards ~120 wide. Census max 6 Forwards: 6×128 = 768 fits in ~960; but §9 dulls by `rotate(90deg)` in a square slot while §6 gives square slots to backups only — 6 square 168px slots = 1056 > 960. Specify the overflow rule and the Forward dull geometry.

**8. MEDIUM — §11 U0/U1 overlap V1-C.** U0 parses `?motion=`/`?art=` "like `?seed=`", which lives in `apps/web/src/App.tsx:20-29`; V1-C adds `decksFromLocation` there and changes `useGame`'s signature (plan Task 1, R3). `styles.css` is in U1's list and V1-C Task 2. Fix: put parsing in a new module wired from `main.tsx`; confine U1 to `tokens.css`/`Card.css`.

**9. LOW — §2 inaccuracies.** `handCount` is on both `FieldView`s (view.ts:27, 62), not "only for the opponent". No `sticky` in `apps/web/src/styles.css`; seats scroll individually (`overflow-y: auto`, 153-162) and the prompt is a grid row. 46 event types.

**10. LOW — §10 "Existing e2e unchanged".** `apps/web/e2e/how-to-play.spec.ts:11` overrides `storageState` to empty, dropping the Instant setting; it survives only because it never plays a batch. `announcements.spec.ts` asserts `.log__line` `toBeVisible()`, so the closed drawer's hiding technique must keep a box (no `display:none`).

**No finding:** D2-4 identity gate (`coordinator.ts:351, 427`) and the idle gate: no deadlock, since beats are clock-driven and none waits on a human decision; concede mid-beat goes through `invalidate()` as today. StrictMode: batches are produced in `commit`, not in effects; the existing cleanup `invalidate` (useGame.ts:697-702) still discards the doubled request. Settle-beat convergence holds once the diff set is complete. Layer-only power changes and transient stops: 0 in this corpus (Vol. 2, Greedy); V1's continuous statics may change that. React 19.2.8, `apply` returning events, ids pre-shuffle (`setup.ts:216`), events dropped at `commit`, 600 ms hold: all confirmed.
