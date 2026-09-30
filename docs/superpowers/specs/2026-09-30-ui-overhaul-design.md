# UI/UX overhaul — a premium, Marvel Snap–style presentation layer

<!-- review-page: https://claude.ai/artifact/Doa1ofjxA78fc5BkesWYtF round: 1 -->

> **Status:** design spec, written 2026-09-30, revised the same day after a Codex review and a Fable review
> (adjudicated in `docs/superpowers/plans/2026-09-30-ui-overhaul-design.codex-review.md`). **Approved by the user
> 2026-09-30**: all six review questions and every decision in §D accepted as written. V1-C merged (PR #12), so U2
> onward is unblocked.
> **Input:** the user's research report "Polishing a React-DOM FFTCG App" (pasted 2026-09-30), checked against this repo.
> **Shape:** one umbrella spec. Each rung (U0–U11) below gets its own plan, a Codex plan review for the architectural
> rungs, TDD, a play-test and a PR — the same process as rungs A–V1.

## 1. Goal

Turn the working rules game into one that feels premium and fun to play: every state change is *shown*, opponent
actions can be followed, cards feel physical, big moments land hard, and the pace stays quick.

The user chose (2026-09-30):

| Question | Answer |
|---|---|
| Platforms | Desktop landscape first. Phone portrait is a later rung. |
| Sequencing | Design rungs start now in worktree `ui-overhaul`. Rungs that touch `useGame`/`Board` wait for V1-C. |
| Sound | Yes, as a later rung. Plan the hooks from the start. |
| Feel | **Marvel Snap–like**: flashy and punchy, bold colour, strong effects on reveals and power changes, short beats. |

**Success looks like:**

- A new player can watch an AI turn and say what happened without reading the log.
- Nothing feels like waiting: skip is always available, and a typical AI turn presents in about 6 s at Normal speed.
- The board fits the screen. Nothing scrolls, and nothing covers a card.
- The game still plays correctly at Instant speed, with every existing test passing.

## 2. What exists today (checked against the repo, not the report)

| Report assumption | This repo | Consequence |
|---|---|---|
| "Change `apply` to return `{state, events}`" | **Already done.** `apply` returns `ApplyResult { state, events }` with 46 typed events (`packages/engine/src/events.ts`). | The foundation needs **no engine change**. |
| "Give every card a lifelong instance ID" | **Already done.** `CardId` is a number fixed for the whole game. | Use it, namespaced by a game generation (section 4.6), as the React key and the Motion `layoutId`. |
| "Hidden cards get their ID but not their code" | **Unsafe here.** IDs are assigned in decklist order before the shuffle (`packages/engine/src/setup.ts:216`), so a hidden card's ID *reveals* the card. The opponent's hand reaches the view only as `handCount`. Both LB decks are in `view.cards` even while face-down. | Hidden cards animate from **zone anchors**. Face-up-ness comes from an explicit per-zone rule in the projection (section 4.1), not from `view.cards`. |
| "The client receives events" | **Events are dropped at the seam.** `narrateApply` and `choose` compute events, then call `commit(state, lines)` with log lines only (`apps/web/src/game/useGame.ts`). | U3 threads redacted steps through `commit` (section 4.2). |
| One `apply` per commit | `settleWindows` applies several commands (forced passes, Smart auto-passes) in one commit. | A commit is a *batch* of one or more applies; `settleWindows` returns each apply's boundary. |
| AI paced by `AI_STEP_MS` | `SearchCoordinator` holds a result until `request time + stepMs` (600 ms). | Delivery also waits for "presentation idle" through a cancellable subscription (section 4.5). |
| React 19.3 `<ViewTransition>` | React is **19.2.8**. | No `<ViewTransition>` until a deliberate upgrade (U10). |
| Motion 13.4.4/13.4.5 | `npm view motion version` = **13.4.6**; peers `react ^18 \|\| ^19`. | U4 re-checks the registry and pins an exact version. |

**The current look** (1440×900, `?seed=12345`, played to turn 3. The screenshots are local only, in the main
checkout's git-ignored `.playwright-mcp/ux-0{1,2}-*.png`, because they show Square Enix card art):

- Each seat's half of the board scrolls on its own (`overflow-y: auto`), and the prompt strip is a grid row
  between them, so the Forward rows are cut off at the strip.
- The two LB-deck rows take the most prominent board space.
- Field and LB cards are small (roughly 50–75 px wide at this size), and most show the text fallback.
- The 320 px right rail (card details + log) is a fixed column at every width (decision B10: desktop only).
- Motion today: a 140 ms hover lift, a pulsing "playable" shadow, a discard flame, the sheet rising, and payment
  crystals lighting. There is no zone movement, and state changes are instant.
- There is no audio (rung E8 "the game can be heard" was about screen-reader live regions).

Constraints this overhaul must keep:

- **Accessibility built in rungs E3–E8.** One tab stop per `CardGrid` with arrow keys inside, card accessible
  names, the prompt's `role="status"` live region, the log's `role="log"` live region, and focus returning after
  "Play again". The existing a11y tests are a gate.
- **Legality stays the engine's** (spec B-A4). A card's gameplay actions come only from `choices.byCard`. Every
  face-up card is also a button that opens its `CardSheet` for reading (rung I1).
- **Only views leave the hook** (spec B3). The presentation layer works on projections of the human's views and
  on redacted events, never on `GameState` or raw events.
- **Art is optional** (spec B9). Several starter exclusives have no art anywhere (27-124S…127S today, and V1 adds
  more), and cached art is git-ignored. Which cards fall back is data-driven. The text card is a permanent,
  first-class design, not a placeholder.
- **The e2e driver** (`apps/web/e2e/drive.ts`) plays real games by clicking `.is-selectable` and `[data-command]`.
  `pnpm test:browser` is the merge gate, so Instant mode must exist before any input gating ships.

## 3. Approach

Three approaches were considered:

- **A. Director + displayed view, DOM cards, one canvas effects overlay (chosen).** It keeps the accessibility
  work, can sequence anything (stack, EX Burst, AI telegraphing), and a canvas overlay gives Snap-style particles.
- **B. Diff-and-FLIP only.** Render the real view immediately and animate whatever moved. This can't sequence or
  telegraph, and AI moves would still land too fast. Rejected.
- **C. A canvas/WebGL board (PixiJS).** This rewrites all rendering, loses the accessibility work, and turns every
  browser test into pixel-clicking. Rejected.

## 4. Architecture

```
 human click / AI worker result
            │
            ▼
   useGame: apply → settleWindows (one step per apply)     authoritative GameState, as today
            │  project(view) on the complete before/after views → BoardModel
            │  commit(state, lines, steps: PresentationStep[])
            ▼
   Director (pure TS, owned by useGame)        step → beats → released model diffs
            │  displayed BoardModel, stage actors, converged?
            ▼
   GameApi (same shape as today)               view/log/aiThinking displayed; choices gated
            │
   Board renders the displayed BoardModel      Motion animates between beat releases
   FxLayer (canvas), AudioBus (U8)             play each beat's decoration
```

### 4.1 The render projection: `BoardModel`

The board renders straight from `PlayerView` today. Several of the values it shows are computed, not stored:
`fieldCardDisplay` rebuilds a `GameState` with `stateShim` (`commands.ts`) and runs the continuous-effect layer
over the whole field. Those computations are correct only on a complete, real view. A partial view either shows a
wrong power or throws (the Fable review reproduced `unknown card id 72` on a cast).

U2 adds `project(view): BoardModel`, a flat, render-only model, and makes the Board render from it:

- **Cards:** one record per rendered card, keyed by `CardId`. Each record holds its zone, its index, and its face
  (`up` or `down`). The face comes from an explicit per-zone visibility rule, not from membership in `view.cards`,
  because both LB decks are in `cards` while face-down. The record also holds every computed display value:
  power, remaining power, damage, status, frozen, granted keywords, flags and LB state.
- **Piles and counters:** per player, the deck count, hand count and damage count, the top card of the Break Zone
  and of Removed, and an LB summary.
- **Stack:** a keyed list of entries (a Summon by its card ID; an ability by its source, clause and placement
  order) with controller and display text.
- **Scalars:** turn, turn player, phase, attack step, priority holder, the pending decision's kind and owner, and
  the result.
- **No cross-references** that need another record to render: no frames, no `knownBy`, no `resolution`.

`project` runs only on complete views: the real `before` and `after` of each apply. No engine or shim code ever
runs on a partial state.

### 4.2 The presentation step

`settleWindows` already loops over `apply`. It now also returns each apply's boundary, so `commit` receives one
step per apply:

```ts
interface PresentationStep {
  before: BoardModel; after: BoardModel   // projections of the HUMAN's complete views
  facts: PresentationFact[]               // this apply's events, redacted
  telegraph: Telegraph | null             // the AI's move as public facts (first step of an AI batch only)
}
```

- **Redaction.** `redactEvent(e, beforeView, afterView)` keeps a card ID only when that card is visible in
  `before.cards ∪ after.cards` (the existing `narrator` union). Otherwise it keeps only counts: `deckExposed` for
  the AI's private look becomes "the AI looks at 3 cards". A `Telegraph` is built from the command after it
  applied, and names only cards that are public by then: the card cast, the attackers, the targets. Raw `Event[]`
  and `Command` never reach the director. This keeps spec B3, and it makes a step plain, safe JSON for a later
  replay viewer or network transport.
- **Exhaustive classification.** A compile-time `Record<Event['type'], 'beat' | 'logOnly' | 'settle'>` covers all
  46 event types. A new event type fails the build until someone classifies it.

### 4.3 The director and the displayed model

`apps/web/src/game/presentation/` is pure TypeScript with a clock seam, created and owned by `useGame`.

- **Mapper:** `beatsFor(step): Beat[]`. It reads the facts for order and meaning, and the two projections for
  positions.
- **Beat:** `{ kind, cards, anchors, durationMs, releaseAtMs, blocking: 'hard' | 'soft', decoration?: { fx, sound, tailMs } }`.
- **Clock-driven.** A beat ends when its duration elapses at the current speed. Animations are fire-and-forget,
  so a dropped animation can't hang the queue, and tests run on a fake clock.
- **Diffs.** The director diffs `before` against `after` per model record: card records, pile counters, stack
  entries (an insert or remove per key) and scalars. Each diff is atomic.
- **Release.** Each beat releases its diffs at `releaseAtMs`, its emphasis point. Displayed = `before` + the
  released diffs.
- **Materialisation.** A zone renders the cards whose displayed zone is that zone, sorted by displayed index, then
  by ID. A partial release therefore never leaves a hole or a collision. (The Fable census found 311 of 6,939
  applies that shift a neighbour's index.)
- **Settle.** After the mapped beats, one 0 ms settle beat releases every unclaimed diff. In development it logs a
  warning that names them. At the end of every step, displayed must equal `after` exactly (a development
  assertion).
- **Payment sources need no new event.** The backups dulled to pay are the step's active→dull diffs that
  `attackDeclared` and `dulled` don't claim. The discards are named by `discarded{reason:'cp'}`.

This design keeps three properties:

- **An incomplete mapper is safe.** A mapper that maps nothing still converges through the settle beat. U3 ships
  that way.
- **No engine logic runs on displayed data.** Power, remaining power and every other computed value come from
  `project` over complete views.
- **Every intermediate displayed model is well formed.** Each card ID is in at most one zone, counters match their
  lists where both exist, and no identity appears outside `before.cards ∪ after.cards`.

**Stage actors.** A stop that starts and ends inside one apply is invisible to the endpoint diff. Examples: a
Forward that enters and is broken by its own trigger, or a Summon pushed and resolved. A stage actor plays it: an
overlay element outside the displayed model. An actor renders only identities in `before.cards ∪ after.cards`, and
shows a card back for anything else. The Fable census found no such stop in the Vol. 2 corpus, so this matters
mainly for later pools. A richer reveal needs a new engine fact, under D7. Every zone, including the piles and the
collapsed damage zone, has an anchor element. Simultaneous moves get separate actor lanes, so they never share one
pile node.

**Hidden cards.**

- An opponent's draw is a hand-count diff. It plays as a card back flying from the deck anchor to the hand anchor.
- A card cast from a hidden hand appears only in `after`. Its actor starts face-down at the hand anchor, flips at
  centre stage, then flies to its slot.
- A card returned to a hidden hand flies to the anchor, flips face-down, and leaves the model.
- `layoutId` follows the projection's face-up records, namespaced by the game generation (section 4.6).

### 4.4 Input: converge, then play

- **Gameplay input waits for convergence.** Until displayed = authoritative, the `GameApi` gives the Board an
  empty `ChoiceSet` that keeps its `prompt`. No command can be built from a stale model, so no stale click can
  reach `choose` (which would throw).
- **Release early, decorate late.** A beat releases its diffs at its emphasis point. Only decoration (particles,
  a number settling, sound) runs after the release, and decoration never blocks. So a batch converges before its
  animation tails finish. The player regains control while the animation ends (the report's lock-out point),
  without ever acting on a stale board.
- **Always available:** pressing a card opens its `CardSheet` for reading (its commit actions are hidden while
  locked), the hover preview, the log, settings, skip, and Concede. U2 adds an always-available Concede in the top
  bar menu; today Concede exists only in the strip on your own turn. Concede first collapses the queue (displayed
  jumps to authoritative), then applies; its game-over step then plays like any other, and the dialog opens after it.
- **Locked until convergence:** every strip action, the payment and selection trays, `CardSheet` actions, and
  the full-control toggle (turning it off settles windows and commits, so it is gameplay input).
- **Skip:** click an empty board area, press Space, or press "»". The first skip collapses the current batch
  (displayed jumps to its `after`). A second skip within 400 ms collapses the whole queue. Skip never answers a
  decision: an EX Burst choice still waits for the player.
- **Instant speed drains synchronously inside `commit`.** No timer runs, so displayed = authoritative in the same
  render and gating does nothing. The e2e suite runs at Instant.
- **Acknowledge within 100 ms.** A pressed card reacts on pointer-down (local UI state), before its batch plays.

### 4.5 AI pacing and telegraphing

- The worker search still starts on the authoritative state at once, so latency stays where it is today.
- The director is created inside `useGame` beside `createAiSearch`, and the coordinator receives the director's
  `whenIdle(cb): cancel` at construction.
- In `schedule`, when the `notBefore` timer fires and the presentation is busy, the coordinator subscribes with
  `whenIdle` and stores that cancel in `this.delivery`, so `invalidate` cancels it. On waking it rechecks
  everything the timer callback checks today (disposed, `readState() === target.state`, the AI is acting) before it
  calls `deliver`. `decisionIndex` still advances only inside `deliver`. A plain "busy, return" check would stall
  the AI for good, because nothing would reschedule it.
- New coordinator tests: busy then idle delivers exactly once; invalidate while waiting cancels; restart while
  waiting drops the delivery; the Greedy fallback also waits; dispose while waiting.
- The board is therefore never more than one AI batch behind the authoritative state.
- Every AI batch opens with a telegraph beat built from its `Telegraph`:
  - A cast: the card reveals centre-stage, enlarged (about 450 ms), then flies to its slot.
  - An attack: the attackers lift and light up.
  - A target choice: an arrow draws from the source to each target.
  - A pass: a small "AI passes" chip.
- `aiThinking` becomes "converged **and** the AI is acting". The prompt therefore never says "The AI is thinking"
  before your own move has played. The visible thinking indicator appears only once the search passes the pacing
  floor.
- Replies are already matched to the state they were computed for (D2-4), so stale replies are dropped as today.

### 4.6 React integration

- `useGame` still returns a `GameApi` with today's shape. `view`, `log` and `aiThinking` are now the displayed
  ones, and `choices` is the gated one. New fields are optional (`display?: { board, stage, status, skip }`), so the
  15 test files that build a `GameApi` by hand keep working. The Board falls back to `project(game.view)` when
  `display` is absent.
- React re-renders once per beat release, not per frame. Frame-by-frame values live in Motion values, CSS and the
  canvas.
- Hover and preview state live in a small separate store, so hovering doesn't re-render the board.
- **Live regions follow the displayed state.** The prompt (`role="status"`) updates at convergence. The log
  (`role="log"`) appends a step's lines when that step converges. The result and its final log line release
  together. Search warnings (the coordinator's `onWarning`) enter the stream as decoration-only facts, so they
  appear in order.
- The board root carries `data-presentation="idle|playing"` for tests.
- **Restart** resets the director synchronously: the queue is dropped and displayed becomes the new game. Restart
  also increments a **game generation** number, and every React key and `layoutId` is namespaced by it, because card
  IDs restart at 1 while the Board stays mounted.
- `GameOverDialog` opens on the displayed `result`, after the final sequence.

## 5. Visual direction: "Crystal Arena"

Marvel Snap's feel, carried over to Final Fantasy through the series' most recognisable object, the crystal.
CP are crystals, damage cracks crystals, breaks shatter into crystal shards, and EX Burst is a crystal flare.

**What makes Snap feel like Snap, and what it becomes here:**

| Snap trait | Here |
|---|---|
| Cards are big and are the UI | Forwards and the hand are large. Chrome is minimal. |
| Chunky numbers with a dark outline, readable over art | Cost gems and power numbers in a heavy condensed face with a stroke. |
| Snap-in with overshoot and a landing thump | Cards land with scale 1.12 → 1, a shockwave ring in the element colour, and dust. |
| Power changes pop and count | Power numbers punch (scale 1.4), flash green or red, and count to the new value. |
| Reveals are the core moment | The AI telegraph reveals at centre stage. The EX Burst reveal is the biggest beat in the game. |
| Big end-turn button, bottom right | A large primary-action button bottom right (Pass / End / Confirm) that glows when it's the only sensible move. |
| Vivid colour on dark | A deep indigo stage with element-tinted light. Saturated element hues. Gold for emphasis, cyan for "you can act". |
| Short beats | Durations at the fast end (section 7), a Fast speed, and skip on click by default. |

**Tokens** (`apps/web/src/tokens.css`, mirrored in `motion.ts` where JS needs them):

- **Colour:** stage `--stage-0…3` (deep indigo to violet); `--el-*` for the six elements plus Light and Dark,
  re-saturated; `--accent-act` (cyan, "you can act"), `--accent-gold` (emphasis and yours), `--danger`; state
  colours `--state-targetable`, `--state-selected`, `--state-invalid`, `--state-opponent`.
- **Type:** Barlow Condensed (800/900) for numbers, names and banners; Barlow (500/600) for rules text. Both are
  OFL, self-hosted through `@fontsource`, and sized with `clamp()`.
- **Elevation:** z-layers `--z-board`, `--z-hand`, `--z-stack`, `--z-flight`, `--z-fx`, `--z-inspect`, `--z-banner`,
  `--z-dialog`, and a three-step shadow scale.
- **Spacing and radius:** a 4 px scale. Card radius is 7% of the card width.
- **Icons:** one SVG sprite for element crystals, CP, dull, EX Burst, stack, phases, and the keyword badges.

**The card** (one `Card` component, as today). Today's card already has element-coloured frames, a card back and a
text fallback with a crystal glyph. U1 replaces those treatments with the following, and the fixture gallery shows
old and new side by side:

- A thick rounded frame in an element gradient (a split gradient for two elements), an inner bevel and a depth
  shadow.
- Art fills the card, with a name plate at the bottom. A cost gem sits top-left. Forwards show a big power number
  bottom-right: remaining power, red once damaged, with printed power small beside it.
- **The text card** (no art) gets generative element art: layered SVG crystal shards in the card's element hues
  with a grain texture, seeded by the card code so it never changes. The card name is set large.
- **The card back** is our own design (a crystal emblem on deep blue with gold line work), not Square Enix's.
- **The hover preview** (section 6) shows a large card (about 320 px wide) with pointer-tracked tilt and a foil sheen, plus
  the full rules text in Barlow.

**Card visual state model.** Each state is derived, never stored, and exposed as a `data-*` attribute that CSS
styles and tests select on:

| Attribute | Values |
|---|---|
| `data-orientation` | `active`, `dull` |
| `data-face` | `up`, `down`, `revealing` |
| `data-interaction` | `idle`, `hover`, `pressed` |
| `data-role` | `none`, `selectable`, `selected`, `targetable`, `targeted`, `invalid` |
| `data-emphasis` | `none`, `attacking`, `blocking`, `on-stack`, `just-played` |
| `data-availability` | `playable`, `unaffordable`, `disabled` |
| `data-paying` | `none`, `dull`, `discard`, `flip` (existing prop, now an attribute) |

The existing `is-selectable` class stays until the e2e driver moves to `data-role`, so the driver keeps working.

## 6. Board layout (desktop landscape)

A CSS grid with named areas that fills the viewport at every size from 1280×720 to 2560×1440, with no page
scroll. Card sizes come from container query units, so the board, not the window, sets them.

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ [Your deck ▾] [AI deck ▾] [New game]   (V1-C)        [☰ Concede, How to play] ⚙ │
├───────────────────────────────────────────────────────────────────────┬─────────┤
│ AI · deck ▣ break ▣ LB ▣           AI hand (fanned backs, top edge)   │  STACK  │
│                         AI Backups (small, rotatable square slots)  ◆ │ (top    │
│                         AI Forwards (large)                         ◆ │  first) │
│ ══════ phase tracker ═══════  prompt pill  ═══════════ turn ● ═════ ◆ │         │
│                         Your Forwards (large)                       ◆ │         │
│                         Your Backups (small)                        ◆ │         │
│ You · deck ▣ break ▣   Your hand (fanned arc)  LB fan    [ PASS ]  ◆ │  »   ≡  │
└───────────────────────────────────────────────────────────────────────┴─────────┘
  ◆ = the seven damage slots per player, as crystals, cracked red when filled
  ▣ = a pile: the top card and a count badge; press it to open that zone's ZoneSheet
  » = skip, ≡ = log drawer, ☰ = menu, ⚙ = settings
```

- **A top bar** holds V1-C's deck picker and New game control, and a menu with Concede (available at any time) and
  How to play.
- **Piles replace rows.** Deck, Break Zone and Removed become piles with count badges. Pressing one opens a new
  `ZoneSheet`: a dialog showing that zone as a `CardGrid`. None exists today; the Break Zone is an inline grid.
- **The LB decks.** Your LB deck stays visible as a compact fan beside your hand. Its castable cards stay gridcell
  buttons that glow, as today, so the e2e driver needs no change. The AI's LB deck becomes a pile. This frees the
  space the two LB rows use today.
- **Backups** sit in square slots, so rotating to dull never pushes their neighbours.
- **Forwards** keep portrait slots. A dull Forward is `rotate(90deg) scale(0.72)`, which fits the rotated card
  inside the slot's width, so dulling never reflows the row.
- **Overflow.** Cards in a row shrink with the row (container units) down to 72 px wide, then overlap by up to 30%.
  The Fable census's maximum of 6 Forwards fits at 1280×720 without overlap.
- **The stack column** is a real grid area: entries top-first with source art, controller colour and the resolving
  item highlighted. It narrows to a slim rail when the stack is empty.
- **The centre line** holds the phase tracker (Active → Draw → Main 1 → Attack → Main 2 → End), the prompt pill
  (the `role="status"` region) and a whose-turn indicator.
- **The primary-action button** is bottom right. Secondary actions (the other strip buttons and Full control) sit
  beside it in a smaller style. The skip button (») sits under the stack column.
- **The hand** is a fanned arc along the bottom edge that partly overlaps the frame. The hovered or focused card
  lifts to full size with its neighbours spreading apart, and the lifted card gets an enlarged hit area.
- **The log** becomes a drawer (≡). When closed, only its panel is visually hidden, with the clip pattern. The
  `role="log"` node stays mounted and exposed: never `display:none`, `hidden`, `aria-hidden` or `inert`. A one-line
  ticker at the centre line shows the latest line. The e2e test that reads log lines opens the drawer first.
- **The hover preview** replaces the `CardDetails` rail: hover for 300 ms, or keyboard focus. Pressing a card still
  opens its `CardSheet` (rung I1), which stays the place to read a card and act on it.
- **Settings** (⚙) is a popover (section 8).
- The grid areas are named so U11 can add portrait templates without restructuring.

## 7. Motion and effects

**Motion tokens** (at 1×, all multiplied by `--motion-scale`; starting values, to be tuned faster in U9):

| Token | ms | Use |
|---|---|---|
| `--dur-instant` | 70 | Acknowledge a press |
| `--dur-fast` | 140 | Hover, highlight |
| `--dur-base` | 220 | Dull/activate, small moves |
| `--dur-move` | 320 | Zone to zone |
| `--dur-reveal` | 450 | A telegraph reveal |
| `--dur-dramatic` | 800 | EX Burst, turn banner, game over |

Easings: `--ease-out` `cubic-bezier(.16,1,.3,1)`, `--ease-in` `cubic-bezier(.7,0,.84,0)`, `--ease-in-out`,
`--ease-overshoot` `cubic-bezier(.34,1.56,.64,1)`. Springs in `motion.ts`: `snappy` (stiffness 520, damping 32),
`hover` (380, 26), `heavy` (260, 22).

**Tools** (one JavaScript animation engine):

- **Motion** (`motion/react`): zone moves through `layout`/`layoutId` in one `LayoutGroup`, exits through
  `AnimatePresence`, and springs for the hand and hover.
- **CSS** for every state style: dull rotation, glows (animate the opacity of a pre-rendered `::after`, never
  `box-shadow`), highlights and pulses.
- **WAAPI** for number punches and flashes.
- **A canvas 2D overlay (`FxLayer`)** for particles, shockwaves, crystal shards and flashes. It is DPR-aware, pools
  about 400 particles, and runs `requestAnimationFrame` only while an effect is live. Card art never touches it.
- **Screen shake** is a transform on the board container, used only on the 6th and 7th damage and the EX Burst.

**Beats.** Each has the shape preparation → emphasis → aftermath. The emphasis point releases the beat's diffs
(section 4.3); the aftermath is decoration and never blocks. "Decoration" in the table means the beat releases at 0 ms
and only its effect plays. Durations are at 1×. The table covers the event types that animate; the compile-time
classification (section 4.2) marks every other type `logOnly` or `settle`.

| Events | Beat | Blocking | Effect |
|---|---|---|---|
| (AI batch start) | Telegraph from the step's `Telegraph` (section 4.5) | soft | reveal flash / arrow |
| `turnStarted` | "YOUR TURN" / "AI TURN" banner punch, 700 ms | soft | banner sweep |
| `phaseStarted` | Phase tracker advances | decoration | — |
| `activated` | Active Phase untap, staggered 40 ms | soft | — |
| `drew` (+ hand diff) | Deck → hand. Your cards flip face-up; the AI's stay backs to its anchor | soft | — |
| `cpGenerated`, `discarded` (cp), the payment's dulls | Discards fly to the Break Zone, backups rotate, crystals fly to a CP meter that counts up | soft, batched | crystal trails |
| `cast` (Character) | Hand → slot with lift, flight and a landing thump | soft | shockwave + dust |
| `cast` (Summon), `stackPushed` | Reveal centre-stage → the stack column | soft | flash |
| `stackPushed` (ability), `abilityTriggered` | Source flares, a callout shows the text, the entry slides into the stack | soft | flare |
| `stackResolved`, `stackCancelled` | The entry resolves out; a Summon goes to the Break Zone | soft | — |
| `attackDeclared` | Attackers pull back, lunge and dull | soft | red rim |
| `blockDeclared` | The blocker steps forward and a clash line draws | soft | — |
| `battleDamage`, `abilityDamage` | 80 ms hit-stop, an impact flash and a damage number pop | soft | impact burst |
| `broken`, `brokenByAbility`, `putIntoBreakZone` | Shatter, then to the Break Zone | soft | crystal shards |
| `playerDamaged` | The deck's top card flips into a damage slot and the crystal cracks. Shake on the 6th and 7th | soft | crack + shake |
| `exBurstOffered` | "EX BURST": the card zooms to centre with slam text, then the choice appears | **hard** | radial flare + shake |
| `exBurstUsed`, `exBurstDeclined` | Resolve, or dismiss back to the damage slot | soft | — |
| `powerModified` | The number punches and counts | decoration | green/red sparks |
| `keywordGranted`, `flagGranted` | The badge pops in | decoration | — |
| `frozen`, `thawed` | An ice overlay forms or melts | decoration | frost |
| `returnedToHand`, `addedToHand` | Card → hand (an anchor when hidden) | soft | — |
| `deckExposed` | Cards fan out from the deck; face up only if the view carries them | soft | — |
| `lbFlipped`, `lbReturned` | LB pile flip | soft | — |
| `removedFromGame` | Dissolve to the Removed pile | soft | — |
| `gameOver` | Victory or defeat sequence, then the dialog | **hard** | crest + burst |
| (unclaimed diffs) | Settle | 0 ms | — (a warning in dev) |

**Pacing targets:** no blocking beat is longer than 900 ms at 1×. A typical AI turn of 4 actions presents in about
6 s or less at Normal. The telegraph reveal holds at least 300 ms so it can be read, and it can always be skipped.

**Every animation must carry information.** If a beat doesn't explain what moved, why, and who caused it, it
becomes non-blocking or is cut.

## 8. Settings, reduced motion and accessibility

**Settings** (the ⚙ popover, stored in `localStorage` inside try/catch; defaults apply when storage is blocked):

| Setting | Values | Default |
|---|---|---|
| Animation speed | Normal (1×), Fast (0.6×), Instant (0) | Normal |
| Reduced motion | System, On, Off | System |
| Effects | Full, Reduced (no particles, no shake) | Full |
| Skip on click | On, Off | On |
| Sound (U8) | volume, mute | 70 %, unmuted |

The full-control toggle stays in the action area (K4-D5: it is "for now", reset on restart, not a preference). It is
gameplay input, so it is locked until the board converges (section 4.4).

**Reduced motion** (from the system setting, or the in-app override):

- Movement becomes a cross-fade of 120 ms or less. There is no shake, particles, tilt or idle ambience.
- The information stays: telegraphs, highlights, the stack and the log. A hard beat shows a still, readable card for
  600 ms, or until a click.
- WCAG 2.2 SC 2.3.3: motion from interaction can be turned off. SC 2.2.2: ambient loops (the playable pulse, stage
  ambience) stop under reduced motion.

**Accessibility kept:** the `CardGrid` keyboard model (one tab stop per zone, arrows inside), card accessible names,
both live regions, focus return after "Play again", and visible focus drawn outside the glows. The existing a11y
tests (`focus`, `announcements`, `pressable`, `how-to-play`) must pass at every rung.

## 9. Performance

- Animate only `transform` and `opacity`. A dull Backup is `rotate(90deg)` in a square slot; a dull Forward is
  `rotate(90deg) scale(0.72)` in its portrait slot.
- Set `will-change: transform` only on cards in flight and the hovered card, and remove it afterwards.
- Use `contain: layout paint` on zone containers.
- Memoise `Card` by `(id, visual state)`. Never call `setState` inside an animation frame.
- Preload and `decode()` the art for both decks at game start. Every `<img>` keeps a fixed aspect ratio and
  `decoding="async"`. The text card shows until the art is decoded, then cross-fades.
- **Budget:** measured with the U0 protocol (`FFTCG_BASELINE=1 pnpm test:browser baseline --workers=1`: three full
  games at 4× CPU throttling, compared by median). The median long-task count stays at or below 40 (the U0 median of
  32, plus 25%). The median 99th-percentile frame gap stays at or below 67 ms (the U0 median of 50 ms, plus one frame).
  No frame longer than 50 ms may come from presentation code in a profiler trace. (Revised in U0: the original
  "within 2 long tasks" was inside the 18–41 spread between games.)

## 10. Testing

| Layer | What it proves |
|---|---|
| Director unit tests (Vitest, fake clock) | step → beats, blocking flags, release order, skip and collapse, restart, Instant draining synchronously, and convergence to `after` |
| **Convergence property test** | The canonical projection is the `BoardModel`. After every beat: the well-formedness invariants (section 4.3). At the end of every step: displayed = `after`. Corpus: 200 or more Greedy-vs-Greedy games, plus targeted fixtures for a shuffle that drops knowledge, a card public then hidden again, stack changes of more than one entry, two Forwards broken at once, LB flips, a continuous-effect source entering or leaving, and restart mid-batch |
| Mapper table tests | One fixture per animated event type → the expected beat kinds and released diffs; the compile-time classification covers the rest |
| Redaction tests | No `PresentationStep` carries a card ID outside `before.cards ∪ after.cards`, over the whole corpus |
| Coordinator tests | The idle gate: busy then idle delivers once; invalidate, restart and dispose while waiting; the Greedy fallback waits too |
| Component tests (jsdom) | Instant motion. Assert `data-*` states, never transforms |
| Existing e2e | At Instant, which drains synchronously. Playwright's `storageState` sets `fftcg.settings` to Instant. `how-to-play.spec.ts` resets storage, so it loads with `?motion=instant`. `drive.ts` needs no edit. Allowed edits: selectors for moved elements, opening the log drawer, and the route re-pins V1-C makes |
| One normal-speed e2e | A seeded EX Burst route: input is locked during the hard beat, and skip drains the queue |
| Fixture gallery | A separate Vite entry (`fixtures.html`) renders every card state, zone and dialog from seeded engine positions. `?art=off` makes it deterministic. It is the only place with committed screenshot baselines |
| Performance | A Playwright trace with 4× CPU throttling during a scripted combat, compared with the U0 baseline and kept in `docs/superpowers/measurements/` |

The flags `?motion=instant` and `?art=off` are production-safe query parameters. They are parsed in a new
`bootstrap.ts` wired from `main.tsx`, not in `App.tsx`, which V1-C edits.

## 11. Rung ladder

| Rung | Scope | Touches | Can start |
|---|---|---|---|
| **U0** Harness and baseline | Settings store; `--motion-scale`; `?motion=instant`, `?art=off`; Playwright `storageState` sets Instant; the `fixtures.html` entry skeleton; a dev frame/long-task overlay (`?perf=1`); baseline screenshots and a perf trace of today's UI | new `bootstrap.ts` and `settings.ts` wired from `main.tsx`, `art.ts`, `playwright.config.ts`, `vite.config.ts`, new `fixtures.html` | **now** |
| **U1** Tokens and the card | `tokens.css`, fonts, the icon sprite; the card redesign with the `data-*` state model, generative text-card art and the card back; the fixture gallery covering every card state | new `tokens.css` imported from `main.tsx`, `Card.tsx`, `Card.css`, fixture files (not `styles.css`, which V1-C edits) | **now** |
| **U2a** Render projection | `project(view)` → `BoardModel` (cards, seats, keyed stack, scalars); the Board draws every card's display props and the seat counters from it, with identical output | new `presentation/boardModel.ts`, `Board.tsx` | after U1 |
| **U2b** Board layout | The viewport-fit grid, the top bar (hosting V1-C's picker) with an always-available Concede, piles and `ZoneSheet`, the LB fan, damage crystals, the stack column, the centre line, the primary-action button. `Board.tsx` splits into zone components | `Board.tsx`, `PromptStrip`, `styles.css`, new `board/` | after U2a |
| **U2c** Drawer, preview, settings | The log drawer, the hover preview (replacing the `CardDetails` rail) and the settings popover | `EventLog`, `CardDetails`, new `board/` | after U2b |
| **U3** Director foundation | Per-apply `PresentationStep`s with redaction and the exhaustive event classification; the director, displayed model, settle beat, convergence gating, skip, speed, Instant draining synchronously, restart and game generation; the coordinator's `whenIdle` gate; the convergence property test. **Every step drains synchronously, as at Instant, until U4 adds durations: the game plays exactly as today, with no timers** | `useGame.ts`, `coordinator.ts`, `types.ts`, new `presentation/` | after U2 |
| **U4** Core motion | Add `motion`; zone moves (draw, play, break, discard, return, damage); dull and untap; hand fan springs; hover and inspect; turn and phase banners; AI telegraph reveals; the thinking indicator; art preload | presentation, UI | after U3 |
| **U5** Targeting and payment | Target arrows (SVG Bézier), highlight and dim, CP crystals flowing to the meter, clear confirm and cancel | `SelectionTray`, `PaymentTray`, board | after U4 |
| **U6** Signature sequences | Combat (lunge, clash, hit-stop, number pops), the damage flip, the EX Burst reveal, break shatter (DOM part), the stack column push and resolve, power punches, the game-over sequence | presentation, UI | after U5 |
| **U7** Effects layer and juice | `FxLayer` particles, shockwaves, crystal shards, sparks, shake, holo/tilt inspect, stage ambience, the Effects setting | new `fx/`, UI | after U6 |
| **U8** Sound | A Web Audio `AudioBus`, synthesised first (no asset licensing); optional CC0 samples; beat → sound mapping; volume and mute | new `audio/`, settings | after U7 |
| **U9** Pacing and performance pass | Time full games and cut durations until nothing feels like waiting; the perf trace against budget | tokens, mapper | after U8 |
| **U10** Shell | A title and pre-game screen that hosts V1-C's deck picker, screen transitions (with a React 19.3 upgrade if `<ViewTransition>` is wanted), victory and defeat screens | `App.tsx`, new screens | after U9 |
| **U11** Phone portrait and touch | Portrait grid templates, a bottom-sheet hand, long-press inspect, a 24/44 px hit-area audit, haptics on Android | layout, input | later (by decision) |

Rungs run one at a time, in this order, so no two rungs edit the same files at once.

**Exit criteria for every rung:** `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm test:browser` pass; the
fixture gallery is updated for any visual change; a play-test at Normal speed; a PR merged by the standing
self-merge rule. U3 additionally proves the property test and "identical to today, with no timers". The user play-tests after U4
and U6, which are the two points where the feel changes most.

## 12. Acceptance for the whole overhaul

- **UO-A1** From 1280×720 to 2560×1440 landscape, the page has no scroll, and no control or panel covers a card.
- **UO-A2** Every AI action is telegraphed for at least 300 ms at Normal before its result shows.
- **UO-A3** Once the game is waiting on you, gameplay input unlocks within 1 s at Normal unless a hard beat is
  playing, and skip always works.
- **UO-A4** At Instant, every existing unit and browser test passes. The only edits allowed are selectors for moved
  elements, opening the log drawer, and the route re-pins V1-C itself makes.
- **UO-A5** Under reduced motion, no movement lasts longer than a 120 ms fade, and there is no shake or particles.
- **UO-A6** Across the property-test corpus, every intermediate displayed model is well formed, and displayed =
  `after` at the end of every step.
- **UO-A9** No `PresentationStep` carries a card ID the human's views don't carry.
- **UO-A7** The performance budget in section 9 holds.
- **UO-A8** The accessibility tests pass, and a keyboard-only game can still be played to the end.

## 13. Out of scope

Multiplayer, deck building, a replay viewer, the hotseat curtain, drag-to-play, Rive/Lottie flourishes, card
thumbnails (they need an image-processing dependency; preload and decode cover the blank flash), and onboarding
beyond the existing "How to play" sheet. A `PresentationStep` is redacted, plain JSON, so a replay viewer and
multiplayer stay possible later.

## 14. Risks

| Risk | Mitigation |
|---|---|
| Displayed and authoritative drift apart | The flat `BoardModel`, the settle beat, the dev assertion, the property test, and Instant as an escape hatch |
| A stale click reaches `choose` | Gameplay input waits for convergence (section 4.4) |
| The AI stalls behind the presentation | A cancellable `whenIdle` subscription with rechecks, plus named coordinator tests (section 4.5) |
| Animation makes the e2e suite flaky | Instant drains synchronously; `storageState` plus `?motion=instant`; exactly one normal-speed e2e |
| Low-end performance | Only transform and opacity; `will-change` only in flight; pooled canvas; the Effects setting |
| Conflicts with V1 work | U0 and U1 avoid every file V1-C edits; U2 and later wait for V1-C (D15) |
| "Juice" grows without end | Every beat must carry information; the U9 pacing pass cuts |
| Accessibility regressions | The existing a11y tests are a gate; live regions follow the displayed view |
| Asset licensing | OFL fonts, synthesised sound, our own card back; Square Enix art stays local and git-ignored |

## As built

- **U0** (branch `feat/u0-harness`, plan `docs/superpowers/plans/2026-09-30-rung-u0-harness.md`): `settings.ts`,
  `bootstrap.ts` wired from `main.tsx`, the `?motion=instant`, `?art=off` and `?perf=1` flags, the fixture gallery
  (`fixtures.html`) with its screenshot baseline, the browser suite at Instant, and the recorded baseline in
  `docs/superpowers/measurements/u0/`. Over three serial games at 4× CPU throttling, today's UI shows a median of 32
  long tasks (18–41, worst 111 ms) and median frame gaps of p99 50 ms and worst 100 ms, all from React re-rendering
  the board. The section 9 budget was revised to compare medians, because the spread between games is wider than the
  first draft's allowance. Other deviations: code comments say "spec section N" rather than a section sign, because
  `rules-citations` checks every section sign under `apps/` against the Comprehensive Rules; screenshot specs run an
  art guard before capturing (review finding). Carried to later rungs (found by the U0 review, pre-existing): U5
  fixes the payment badge that labels an LB flip "Discard" (`Card.tsx`, `paying === 'dull' ? 'Dulls' : 'Discard'`); U4
  moves the raw `@media (prefers-reduced-motion)` block in `styles.css` to `[data-reduced-motion='true']`, so the
  in-app "Off" override works; the legacy `MediaQueryList.addListener` fallback and a real-browser reduced-motion
  test are deferred minors.
- **U1** (branch `feat/u1-tokens-card`, plan `docs/superpowers/plans/2026-09-30-rung-u1-tokens-card.md`): `tokens.css`
  (Crystal Arena palette, re-saturated elements, z-layers, shadows, motion durations times `--motion-scale`, easings)
  and its JS mirror `motion.ts`, with a test that keeps the two equal; Barlow and Barlow Condensed 5.3.0 self-hosted;
  generative crystal art (`crystalArt.ts`, `CardArt.tsx`) for any card without a loaded scan; the card restyled
  (metallic element frame, stroked italic power number over the art, larger cost gem, crystal pips, our own back); and
  the `data-orientation`/`data-face`/`data-role`/`data-emphasis`/`data-paying` state model, with `role` and `emphasis`
  props for U4–U6. The playable glow is an `::after` animated by opacity, static at Instant. The gallery covers every
  state and every pool card. Deviations: buff badges sit top-left under the gem (at the bottom they crowded the power);
  the gallery tolerance is 100 pixels, not 0.1% of the page (the ratio hid that moved badge); the pure module is
  `crystalArt.ts`, because macOS resolves `./CardArt` case-insensitively. The U1 review (Fable; Codex was out of quota)
  found four regressions, fixed with browser checks in `e2e/card-states.spec.ts`: focus is now a white ring 6px out
  (it was the playable ring's cyan), a taken payment source no longer shows the playable pulse, a card chosen for a set
  has the gold ring (keyed on `data-role='selected'`), and a loaded scan cross-fades over the crystal art (a `settled`
  status on `transitionend`). Carried: U4 must stop `:hover` erasing the `data-emphasis` rings before it sets them.
  Deferred minors: the card code label sits under the power number; the grain overlay also paints over loaded scans;
  uppercase names truncate sooner on small cards.
- **U2a** (branch `feat/u2a-board-model`, plan `docs/superpowers/plans/2026-09-30-rung-u2a-board-model.md`, reviewed
  by Fable): `presentation/boardModel.ts` — `project(view)` → `BoardModel` with a record per visible card (zone, index,
  face, LB state), the seats' counters and zone lists, a keyed stack, and the scalars U3 diffs (turn, turn player,
  phase, attack step, priority, pending kind and owner, result). The Board takes every card's display props and the
  seat counters from it; interaction stays view-based. A corpus test (four Greedy games, over 200 positions) checks the
  section 4.3 invariants and that it reached pumped Forwards, known hand cards, spent LB cards, cards in no zone, the
  Break and Damage Zones and a non-empty stack. Identical output was proved by pinning the Board's markup at all 460
  corpus positions before the refactor and matching it byte for byte after. The Fable review approved it (it
  independently re-ran the markup proof and a click-through of piles, sheets and the orphan row). Carried to U2b: the AI
  hand row label and the LB row guards still read `view` rather than the model; the corpus test does not tally
  `removedFromGame`, never reaches a `#n` stack key, and does not assert a record's side or index; a stale comment in
  `card-details.test.tsx` names the deleted `fieldCardProps`. Spec section 4.1's per-record `face` is derivable from the
  zone and `lbFaceUp` today; U3 makes it explicit if its hidden-card actors need it.

## Questions for your review

These are the calls taken on your behalf that most change what you'll see and play. Everything else in
**Decisions** follows from the reviews or the code.

1. **Section 5, D10 — the look.** "Crystal Arena": Snap's punch carried through FF's crystal motif, a deep indigo stage,
   saturated element colours, and Barlow Condensed with Barlow. Is that the direction? The other options are a
   punchier version of today's "card table under a low lamp", or a different motif.
2. **Section 6, D22, D28 — the layout.** The log moves into a drawer that is closed by default, the hover preview replaces
   the card-details rail, the stack gets a column on the right, and the LB decks become a fan (yours) and a pile
   (the AI's). Is a closed-by-default log acceptable?
3. **Section 7 — pacing.** About 6 s for a 4-action AI turn at Normal, a Fast speed at 0.6×, and skip on click on by default.
   Faster or slower to start?
4. **Section 11, D30 — order.** U0 and U1 start now while V1 finishes, then the rungs run strictly in order, and you
   play-test after U4 and U6. Any rung you want earlier (for example, sound)?
5. **Section 13 — out of scope.** Drag-to-play, a replay viewer, deck building and phone play (until U11). Should any of
   these come in?

## Decisions

The user was away when these were taken (the standing rule: take the recommended option and record it). Each one
can be overturned here.

- **D1 — Approach A** (director + displayed view, DOM cards, canvas effects overlay). It keeps the accessibility work
  and can sequence and telegraph. B can't; C costs a full rewrite.
- **D2 — Motion is the only JavaScript animation engine.** CSS handles state, WAAPI number pops, canvas particles.
  `layoutId` solves re-parenting a card between zone components with the least code. No GSAP.
- **D3 — The director is clock-driven.** Animations can't hang the queue, and tests run on a fake clock.
- **D4 — Displayed = `before` + released diffs of a flat `BoardModel`, with a settle beat for anything unclaimed.**
  An incomplete mapper converges, no view reducer duplicates the engine, and no engine code runs on a partial
  state. (Revised after review: the first draft diffed `PlayerView`, which crashes the power display.)
- **D5 — Transient stops are stage actors,** not displayed-model states. A per-apply diff can't see them. Actors
  render only identities in `before.cards ∪ after.cards`.
- **D6 — Hidden cards animate from zone anchors.** IDs follow decklist order, so a hidden ID would leak the card.
- **D7 — No engine changes through U7.** If a beat needs a fact no event carries, that field is added in its own
  reviewed change.
- **D8 — AI delivery waits for presentation idle, through a cancellable `whenIdle` subscription; the search does
  not wait.** Latency is unchanged, and the board is never more than one AI batch behind.
- **D9 — Settings:** Normal / Fast (0.6×) / Instant; reduced motion System / On / Off; Effects Full / Reduced; skip on
  click on. They live in `localStorage` because they are per-browser conveniences.
- **D10 — "Crystal Arena" visual direction** (section 5), with Barlow Condensed and Barlow self-hosted. It carries the Snap
  traits the user asked for through FF's crystal motif. The fonts and palette can be overturned at the U1 fixture
  review.
- **D11 — No `<ViewTransition>` now.** React is 19.2.8. Revisit in U10.
- **D12 — No drag-to-play.** Click-to-select stays. `@dnd-kit/react` is pre-1.0.
- **D13 — Sound is synthesised first** (Web Audio), with CC0 samples optional. Never Square Enix audio.
- **D14 — Desktop landscape from 1280×720.** Named grid areas leave room for U11's portrait templates.
- **D15 — U0 and U1 start now; U2 onward waits for V1-C.** V1-C adds a deck-picker toolbar to the board and edits
  `Board.tsx`, `styles.css`, `useGame.ts`, `deck.ts` and `App.tsx`. U0 and U1 touch none of them.
- **D16 — The full-control toggle stays in the action area,** not in settings (K4-D5), and is locked until
  convergence like other gameplay input.
- **D17 — The text card is first-class,** with generative element art seeded by the card code. Several starter
  exclusives will never have art, and which cards fall back is data-driven.
- **D18 — Screenshot baselines only for the fixture gallery,** with art off and Instant motion. The game itself is
  tested through `data-*` states.
- **D19 — One umbrella spec, with a plan per rung.** This matches the repo's rung process.
- **D20 — The hand is a fanned arc.** The lifted card gets an enlarged hit area.
- **D21 — The log is a drawer that stays in the accessibility tree when closed,** so the live region keeps working.
- **D22 — The hover preview replaces the `CardDetails` rail** (hover 300 ms or focus), and the `CardSheet` stays the
  press-to-read-and-act workflow. This keeps rung E3b's keyboard reading path.
- **D23 — Gameplay input waits for convergence** (displayed = authoritative). Beats release at their emphasis point
  and decorate afterwards, so control returns before the animation tail ends, without ever acting on a stale board.
- **D24 — Instant drains synchronously inside `commit`.** The e2e suite and jsdom tests see no timers at all.
- **D25 — The director receives a redacted `PresentationStep`,** never raw events or commands (spec B3), and a
  compile-time classification covers every event type.
- **D26 — `useGame` keeps returning a `GameApi`,** with displayed `view`/`log`/`aiThinking` and gated `choices`; new
  fields are optional, so hand-built test fixtures keep working.
- **D27 — A game generation number namespaces keys and `layoutId`s,** and restart resets the director
  synchronously.
- **D28 — Your LB deck is a fan beside your hand; the AI's is a pile.** Castable LB cards stay one press away and
  reachable by the e2e driver.
- **D29 — A dull Forward is `rotate(90deg) scale(0.72)` in its portrait slot;** a dull Backup rotates in a square
  slot. Neither reflows its row.
- **D30 — The ladder is strictly sequential,** one rung at a time.
- **D31 — Concede is always available** from the top bar menu, because gameplay controls lock during playback.
- **D32 — U2 is three rungs** (decided while building, 2026-09-30). U2a: the projection, with no visible change. U2b:
  the layout. U2c: the log drawer, the hover preview and the settings popover. One rung was a data-model refactor, a
  layout rewrite and three new components at once; each part now ships and is reviewed on its own.
