# UI/UX overhaul — a premium, Marvel Snap–style presentation layer

> **Status:** design spec, written 2026-09-30, awaiting the user's review. No code yet.
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
| "Change `apply` to return `{state, events}`" | **Already done.** `apply` returns `ApplyResult { state, events }` with about 50 typed events (`packages/engine/src/events.ts`). | The foundation needs **no engine change**. |
| "Give every card a lifelong instance ID" | **Already done.** `CardId` is a number fixed for the whole game. | Use it as the React key and the Motion `layoutId`. |
| "Hidden cards get their ID but not their code" | **Unsafe here.** IDs are assigned in decklist order before the shuffle (`packages/engine/src/setup.ts:216`), so a hidden card's ID *reveals* the card. `PlayerView` carries `handCount` only for the opponent. | Hidden cards animate from **zone anchors**. A card gets a `layoutId` only once it is in `view.cards`. |
| "The client receives events" | **Events are dropped at the seam.** `narrateApply` and `choose` compute events, then call `commit(state, lines)` with log lines only (`apps/web/src/game/useGame.ts`). | The first code change threads events through `commit`. |
| One `apply` per commit | `settleWindows` applies several commands (forced passes, Smart auto-passes) in one commit. | A commit is a *batch* of one or more applies. |
| AI paced by `AI_STEP_MS` | `SearchCoordinator` holds a result until `request time + stepMs` (600 ms). | The director adds a second condition to that delivery: "presentation idle". |
| React 19.3 `<ViewTransition>` | React is **19.2.8**. | No `<ViewTransition>` until a deliberate upgrade (U10). |
| Motion 13.4.4/13.4.5 | `npm view motion version` = **13.4.6**; peers `react ^18 \|\| ^19`. | Pin `motion@^13.4.6` in U4. |

**The current look** (1440×900, `?seed=12345`, played to turn 3. The screenshots are local only, in the main
checkout's git-ignored `.playwright-mcp/ux-0{1,2}-*.png`, because they show Square Enix card art):

- The board column scrolls vertically, and the sticky prompt strip covers the Forward rows.
- The two LB-deck rows take the most prominent board space, while Forwards are cut off.
- Cards are small (about 60×80 px on the field), and most show the text fallback.
- The 320 px right rail (card details + log) is a fixed column at every width (decision B10: desktop only).
- Motion today: a 140 ms hover lift, a pulsing "playable" shadow, a discard flame, the sheet rising, and payment
  crystals lighting. There is no zone movement, and state changes are instant.
- There is no audio (rung E8 "the game can be heard" was about screen-reader live regions).

Constraints this overhaul must keep:

- **Accessibility built in rungs E3–E8.** One tab stop per `CardGrid` with arrow keys inside, card accessible
  names, the prompt's `role="status"` live region, the log's `role="log"` live region, and focus returning after
  "Play again". The existing a11y tests are a gate.
- **Legality stays the engine's** (spec B-A4). A card is clickable only if `choices.byCard` has it.
- **Only views leave the hook** (spec B3). The presentation layer works on `PlayerView`s, never `GameState`.
- **Art is optional** (spec B9). 27-124S…127S have no art anywhere, and cached art is git-ignored. The text card
  is a permanent, first-class design, not a placeholder.
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
   useGame: apply → settleWindows          (authoritative GameState, as today)
            │  commit({ state, lines, batch })
            ▼
   Director (pure TS, no React)            batch → beats → released diffs
            │  displayedView, stage actors, inputLocked
            ▼
   Board renders displayedView             Motion animates layout between beats
   FxLayer (canvas) plays beat effects      AudioBus (U8) plays beat sounds
```

### 4.1 The batch

`commit` gains a `Batch`:

```ts
interface Batch {
  actor: PlayerId | null          // who made the move (null: a settlement with no move, e.g. the full-control toggle)
  command: Command | null         // the move itself — the AI telegraph reads it
  steps: { before: PlayerView; after: PlayerView; events: Event[] }[]   // one step per apply() in the commit
  lines: LogLine[]
}
```

- The views are the **human's** (`viewFor(state, HUMAN)`), so nothing hidden can reach the presentation layer.
- One step per `apply`: `settleWindows` already loops over applies, so it returns each step's views as well.
- Plain JSON, serialisable. A replay viewer or a network transport can produce the same stream later.

### 4.2 The director

`apps/web/src/game/presentation/` — a pure module with a clock seam, tested without a DOM.

- **Input:** batches, in commit order.
- **Mapper:** `beatsFor(step): Beat[]`. It reads the events for order, grouping and meaning (§7) and the views for
  positions.
- **Beat:** `{ kind, cards, anchors, durationMs, blocking: 'hard' | 'soft' | 'none', interruptibleAt?, fx?, sound?, releases }`.
- **Clock-driven.** A beat ends when its duration elapses (scaled by the speed setting), not when an animation
  reports completion. Animations are fire-and-forget. A dropped animation can't hang the queue, and tests use a
  fake clock.

### 4.3 The displayed view: `before` plus released diffs

The board renders `displayedView`, which trails the real view and catches up beat by beat.

1. For each step, the director diffs `before` against `after` **per card**: zone, index, status, damage, power,
   face (up/down), frozen and granted keywords. It also diffs the per-player counters (hand count, deck count,
   damage count, LB state) and the non-card fields (turn, phase, attack step, stack, pending, result).
2. Every beat **releases** a set of those diffs. Displayed = `before` + all released diffs.
3. When the mapper finishes, it releases any unclaimed diffs in a final **settle** beat of 0 ms. In development
   builds it also logs a warning that names the unclaimed diffs.
4. After a batch's last beat, a development-build assertion checks that displayed = `after` (deep equality of the
   rendered projection).

Two consequences follow:

- **An incomplete mapper is safe.** A mapper that maps nothing still converges: every diff goes to the settle beat.
  U3 ships in exactly that state, and the game plays as it does today.
- **The mapper needs no view reducer.** No code applies events to a `PlayerView`, so none of the engine's rules get
  duplicated.

Two cases need more than a diff:

- **Transient stops.** A card can visit a zone and leave it inside one apply. For example, a Forward enters and is
  broken by its own trigger, or a Summon goes onto the stack and resolves. The per-card diff sees only the start and
  the end. The intermediate stop is played by a **stage actor**: an overlay element that flies, lands and shatters
  above the board. It is not part of the displayed view. The card's diff is released by the last beat that touches
  it.
- **Hidden cards.** An opponent's draw is a hand-count diff, played as a card back flying from the deck anchor to
  the hand anchor. A card cast from a hidden hand appears in `after.cards` with a new ID. Its actor starts face-down
  at the hand anchor, flips at centre stage, then flies to its slot. A card returned to a hidden hand flies to the
  anchor, flips face-down and leaves the displayed view.

### 4.4 Input gating and skip

- Legal choices are computed from the **authoritative** state, as today.
- `inputLocked` is true while a hard beat is pending, or a soft beat is before its `interruptibleAt`.
- Locked means the action buttons and card presses are disabled. Inspecting cards, opening the log and the
  settings, conceding, and skipping always work.
- A human command while soft beats remain **collapses** the queue: displayed jumps to the latest `after`, then the
  new batch starts.
- **Skip:** click an empty area of the board, press Space, or press the "»" button. The first skip collapses the
  current batch, and a second skip within 400 ms collapses the whole queue. Skip never skips a *decision*: an EX
  Burst choice still waits for the player.
- **Acknowledge within 100 ms.** A pressed card reacts on the pointer-down (local UI state), before its batch plays.

### 4.5 AI pacing and telegraphing

- The worker search still starts on the authoritative state at once, which keeps latency where it is today.
- The coordinator's delivery (today `max(result, request + stepMs)`) also waits for **"presentation idle"**, a new
  `SearchCoordinatorOptions` gate. The authoritative state is therefore never more than one AI batch ahead of the
  board.
- Every AI batch opens with a **telegraph beat** chosen from `batch.command`:
  - A cast: the card reveals centre-stage, enlarged (about 450 ms), then flies to its slot.
  - An attack: the attackers lift and glow.
  - A target choice: an arrow draws from the source to each target.
  - A pass: a small "AI passes" chip.
- "AI is thinking…" shows only when the queue is empty **and** the search has run past the pacing floor.
  Otherwise the animation already tells the player something is happening.
- Replies are already matched to the state they were computed for (D2-4), so stale replies are discarded as today.

### 4.6 React integration

- `usePresentation(game)` wraps `useGame` and returns `{ displayedView, stage, activeBeat, inputLocked, skip }`.
- `Board` and its children read `displayedView`. `choices` stay authoritative but pass through `inputLocked`.
- React re-renders **once per beat**, not per frame. Frame-by-frame values live in Motion values, CSS and canvas.
- Hover and inspect state live in a small separate store, so hovering doesn't re-render the board.
- The live regions follow the **displayed** state. The prompt text updates when input unlocks, and the log appends a
  batch's lines as the batch's last beat plays. A screen-reader user is told what they can see, when they can see
  it.
- `GameOverDialog` opens on `displayedView.result`, after the final sequence.

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
| Short beats | Durations at the fast end (§7), a Fast speed, and skip on click by default. |

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

**The card** (one `Card` component, as today):

- A thick rounded frame in an element gradient (a split gradient for two elements), an inner bevel and a depth
  shadow.
- Art fills the card, with a name plate at the bottom. A cost gem sits top-left. Forwards show a big power number
  bottom-right: remaining power, red once damaged, with printed power small beside it.
- **The text card** (no art) gets generative element art: layered SVG crystal shards in the card's element hues
  with a grain texture, seeded by the card code so it never changes. The card name is set large.
- **The card back** is our own design (a crystal emblem on deep blue with gold line work), not Square Enix's.
- **Inspect:** a large card (about 320 px wide) with pointer-tracked tilt and a foil sheen, plus the full rules text
  in Barlow.

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
┌───────────────────────────────────────────────────────────────────────┬─────────┐
│ AI · deck ▣ break ▣ LB ▣           AI hand (fanned backs, top edge)   │  STACK  │
│                         AI Backups (small, rotatable square slots)  ◆ │ (top    │
│                         AI Forwards (large)                         ◆ │  first) │
│ ══════ phase tracker ═══════  prompt pill  ═══════════ turn ● ═════ ◆ │         │
│                         Your Forwards (large)                       ◆ │         │
│                         Your Backups (small)                        ◆ │         │
│ You · deck ▣ break ▣ LB ▣      Your hand (fanned arc)     [ PASS ]  ◆ │  ⚙  ≡   │
└───────────────────────────────────────────────────────────────────────┴─────────┘
  ◆ = the seven damage slots per player, as crystals, cracked red when filled
  ▣ = a pile: the top card and a count badge; press it to open that zone's sheet
```

- **Piles replace rows.** Deck, Break Zone, Removed and the LB deck become piles with count badges. They open the
  existing zone sheets. An LB pile glows when an LB card is castable. This frees the space the LB rows use today.
- **Backups** sit in square slots, so rotating to dull never pushes their neighbours.
- **The stack column** is a real grid area: entries top-first with source art, controller colour and the resolving
  item highlighted. It narrows to a slim rail when the stack is empty.
- **The centre line** holds the phase tracker (Active → Draw → Main 1 → Attack → Main 2 → End), the prompt pill
  (the `role="status"` region) and a whose-turn indicator.
- **The primary-action button** is bottom right. Secondary actions (the other strip buttons, Concede, Full control)
  sit beside it in a smaller style.
- **The hand** is a fanned arc along the bottom edge that partly overlaps the frame. The hovered or focused card
  lifts to full size with its neighbours spreading apart, and the lifted card gets an enlarged hit area.
- **The log** becomes a drawer (≡). When closed it stays in the accessibility tree, visually hidden, so the live
  region keeps announcing. A one-line ticker at the centre line shows the latest line.
- **Card details** become the inspect overlay: hover for 300 ms, keyboard focus, or the existing "look at" action.
- **Settings** (⚙) is a popover (§8).
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

**Beats.** Each has the shape preparation → emphasis → aftermath. Durations are at 1×.

| Events | Beat | Blocking | Effect |
|---|---|---|---|
| (AI batch start) | Telegraph from `batch.command` (§4.5) | soft | reveal flash / arrow |
| `turnStarted` | "YOUR TURN" / "AI TURN" banner punch, 700 ms | soft | banner sweep |
| `phaseStarted` | Phase tracker advances | none | — |
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
| `powerModified` | The number punches and counts | none | green/red sparks |
| `keywordGranted`, `flagGranted` | The badge pops in | none | — |
| `frozen`, `thawed` | An ice overlay forms or melts | none | frost |
| `returnedToHand`, `addedToHand` | Card → hand (an anchor when hidden) | soft | — |
| `deckExposed` | Cards fan out from the deck; face up only if the view carries them | soft | — |
| `lbFlipped`, `lbReturned` | LB pile flip | soft | — |
| `removedFromGame` | Dissolve to the Removed pile | soft | — |
| `gameOver` | Victory or defeat sequence, then the dialog | **hard** | crest + burst |
| (unclaimed diffs) | Settle | none | — (a warning in dev) |

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

The full-control toggle stays in the action area (K4-D5: it is "for now", reset on restart, not a preference).

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

- Animate only `transform` and `opacity`. Dull is `rotate(90deg)` inside a square slot.
- Set `will-change: transform` only on cards in flight and the hovered card, and remove it afterwards.
- Use `contain: layout paint` on zone containers.
- Memoise `Card` by `(id, visual state)`. Never call `setState` inside an animation frame.
- Preload and `decode()` the art for both decks at game start. Every `<img>` keeps a fixed aspect ratio and
  `decoding="async"`. The text card shows until the art is decoded, then cross-fades.
- **Budget:** during a scripted full combat with 4× CPU throttling, no frame longer than 50 ms comes from the
  presentation layer. The long-task count stays within 2 of the U0 baseline.

## 10. Testing

| Layer | What it proves |
|---|---|
| Director unit tests (Vitest, fake clock) | batch → beats, blocking flags, release order, skip and collapse, and convergence to `after` |
| **Convergence property test** | Self-play (Greedy vs Greedy) for 200 or more seeded games through the director. Displayed = `after` after every batch, and no settle-beat warnings for event types the mapper claims |
| Mapper table tests | One fixture per event type → the expected beat kinds and released diffs |
| Component tests (jsdom) | Instant motion. Assert `data-*` states, never transforms |
| Existing e2e | Unchanged. Playwright's `storageState` sets `fftcg.settings` to Instant, so `drive.ts` needs no edit |
| One normal-speed e2e | A seeded EX Burst route: input is locked during the hard beat, and skip drains the queue |
| Fixture gallery | A separate Vite entry (`fixtures.html`) renders every card state, zone and dialog from seeded engine positions. `?art=off` makes it deterministic. It is the only place with committed screenshot baselines |
| Performance | A Playwright trace with 4× CPU throttling during a scripted combat, compared with the U0 baseline and kept in `docs/superpowers/measurements/` |

The flags `?motion=instant` and `?art=off` are production-safe query parameters, parsed like `?seed=`.

## 11. Rung ladder

| Rung | Scope | Touches | Can start |
|---|---|---|---|
| **U0** Harness and baseline | Settings store; `--motion-scale`; `?motion=instant`, `?art=off`; Playwright `storageState` sets Instant; the `fixtures.html` entry skeleton; a dev frame/long-task overlay (`?perf=1`); baseline screenshots and a perf trace of today's UI | new files, `art.ts`, `playwright.config.ts`, `vite.config.ts`, `index.html` | **now** |
| **U1** Tokens and the card | `tokens.css`, fonts, the icon sprite; the card redesign with the `data-*` state model, generative text-card art and the card back; the fixture gallery covering every card state | `Card.tsx`, `Card.css`, `styles.css`, new files | **now** |
| **U2** Board layout | The viewport-fit grid, piles, damage crystals, the stack column, the centre line, the primary-action button, the log drawer, the inspect overlay and the settings popover. `Board.tsx` (713 lines) splits into zone components | `Board.tsx`, `PromptStrip`, `EventLog`, `CardDetails`, styles | after V1-C merges |
| **U3** Director foundation | Batches threaded through `commit`; the director, displayed view, settle beat, input gating, skip, speed; the coordinator's idle gate; the convergence property test. **Every beat 0 ms: the game plays exactly as today** | `useGame.ts`, `coordinator.ts`, new `presentation/` | after U2 |
| **U4** Core motion | Add `motion`; zone moves (draw, play, break, discard, return, damage); dull and untap; hand fan springs; hover and inspect; turn and phase banners; AI telegraph reveals; the thinking indicator; art preload | presentation, UI | after U3 |
| **U5** Targeting and payment | Target arrows (SVG Bézier), highlight and dim, CP crystals flowing to the meter, clear confirm and cancel | `SelectionTray`, `PaymentTray`, board | after U4 |
| **U6** Signature sequences | Combat (lunge, clash, hit-stop, number pops), the damage flip, the EX Burst reveal, break shatter (DOM part), the stack column push and resolve, power punches, the game-over sequence | presentation, UI | after U4 |
| **U7** Effects layer and juice | `FxLayer` particles, shockwaves, crystal shards, sparks, shake, holo/tilt inspect, stage ambience, the Effects setting | new `fx/`, UI | after U6 |
| **U8** Sound | A Web Audio `AudioBus`, synthesised first (no asset licensing); optional CC0 samples; beat → sound mapping; volume and mute | new `audio/`, settings | after U6 |
| **U9** Pacing and performance pass | Time full games and cut durations until nothing feels like waiting; the perf trace against budget | tokens, mapper | after U7/U8 |
| **U10** Shell | A title and pre-game screen that hosts V1-C's deck picker, screen transitions (with a React 19.3 upgrade if `<ViewTransition>` is wanted), victory and defeat screens | `App.tsx`, new screens | after U9 |
| **U11** Phone portrait and touch | Portrait grid templates, a bottom-sheet hand, long-press inspect, a 24/44 px hit-area audit, haptics on Android | layout, input | later (by decision) |

**Exit criteria for every rung:** `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm test:browser` pass; the
fixture gallery is updated for any visual change; a play-test at Normal speed; a PR merged by the standing
self-merge rule. U3 additionally proves the property test and "identical at 0 ms". The user play-tests after U4
and U6, which are the two points where the feel changes most.

## 12. Acceptance for the whole overhaul

- **UO-A1** From 1280×720 to 2560×1440 landscape, the page has no scroll, and no control or panel covers a card.
- **UO-A2** Every AI action is telegraphed for at least 300 ms at Normal before its result shows.
- **UO-A3** Input is never locked for more than 1 s outside a hard beat, and skip always works.
- **UO-A4** At Instant, every existing unit and browser test passes. The only edits allowed are selectors for moved
  elements.
- **UO-A5** Under reduced motion, no movement lasts longer than a 120 ms fade, and there is no shake or particles.
- **UO-A6** Displayed = authoritative after every batch across the property-test corpus.
- **UO-A7** The performance budget in §9 holds.
- **UO-A8** The accessibility tests pass, and a keyboard-only game can still be played to the end.

## 13. Out of scope

Multiplayer, deck building, a replay viewer, the hotseat curtain, drag-to-play, Rive/Lottie flourishes, card
thumbnails (they need an image-processing dependency; preload and decode cover the blank flash), and onboarding
beyond the existing "How to play" sheet. The event batch is plain JSON, so a replay viewer and multiplayer stay
possible later.

## 14. Risks

| Risk | Mitigation |
|---|---|
| Displayed and authoritative drift apart | The settle beat, the dev assertion, the property test, and Instant as an escape hatch |
| Animation makes the e2e suite flaky | Instant through `storageState`; exactly one normal-speed e2e |
| Low-end performance | Only transform and opacity; `will-change` only in flight; pooled canvas; the Effects setting |
| Conflicts with V1 work | U2 and later wait for V1-C (D15) |
| "Juice" grows without end | Every beat must carry information; the U9 pacing pass cuts |
| Accessibility regressions | The existing a11y tests are a gate; live regions follow the displayed view |
| Asset licensing | OFL fonts, synthesised sound, our own card back; Square Enix art stays local and git-ignored |

## Decisions

The user was away when these were taken (the standing rule: take the recommended option and record it). Each one
can be overturned here.

- **D1 — Approach A** (director + displayed view, DOM cards, canvas effects overlay). It keeps the accessibility work
  and can sequence and telegraph. B can't; C costs a full rewrite.
- **D2 — Motion is the only JavaScript animation engine.** CSS handles state, WAAPI number pops, canvas particles.
  `layoutId` solves re-parenting a card between zone components with the least code. No GSAP.
- **D3 — The director is clock-driven.** Animations can't hang the queue, and tests run on a fake clock.
- **D4 — Displayed = `before` + released per-card diffs, with a settle beat for anything unclaimed.** An incomplete
  mapper converges, and no view reducer duplicates the engine.
- **D5 — Transient stops are stage actors,** not displayed-view states. A per-apply diff can't see them.
- **D6 — Hidden cards animate from zone anchors.** IDs follow decklist order, so a hidden ID would leak the card.
- **D7 — No engine changes through U7.** If a beat needs a fact no event carries, that field is added in its own
  reviewed change.
- **D8 — AI delivery waits for presentation idle; the search does not.** Latency is unchanged, and the board is
  never more than one AI batch behind.
- **D9 — Settings:** Normal / Fast (0.6×) / Instant; reduced motion System / On / Off; Effects Full / Reduced; skip on
  click on. They live in `localStorage` because they are per-browser conveniences.
- **D10 — "Crystal Arena" visual direction** (§5), with Barlow Condensed and Barlow self-hosted. It carries the Snap
  traits the user asked for through FF's crystal motif. The fonts and palette can be overturned at the U1 fixture
  review.
- **D11 — No `<ViewTransition>` now.** React is 19.2.8. Revisit in U10.
- **D12 — No drag-to-play.** Click-to-select stays. `@dnd-kit/react` is pre-1.0.
- **D13 — Sound is synthesised first** (Web Audio), with CC0 samples optional. Never Square Enix audio.
- **D14 — Desktop landscape from 1280×720.** Named grid areas leave room for U11's portrait templates.
- **D15 — U0 and U1 start now; U2 onward waits for V1-C.** V1-C adds the deck picker and a New game control to the
  board and edits `useGame.ts`, `deck.ts` and `App.tsx`.
- **D16 — The full-control toggle stays in the action area,** not in settings (K4-D5).
- **D17 — The text card is first-class,** with generative element art seeded by the card code. Four starter cards
  will never have art.
- **D18 — Screenshot baselines only for the fixture gallery,** with art off and Instant motion. The game itself is
  tested through `data-*` states.
- **D19 — One umbrella spec, with a plan per rung.** This matches the repo's rung process.
- **D20 — The hand is a fanned arc.** The lifted card gets an enlarged hit area.
- **D21 — The log is a drawer that stays in the accessibility tree when closed,** so the live region keeps working.
- **D22 — Card details become an inspect overlay** (hover 300 ms, focus, or "look at"). This keeps rung E3b's
  keyboard reading path.
