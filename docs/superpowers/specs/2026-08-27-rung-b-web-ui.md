# Rung B — Browser UI: play a full game against the AI

## Context

Rung A merged (`1cdc211`): a headless rules engine (`packages/engine`), the Starter Set 2025 Vol. 2
pool (`packages/cards`), and a `GreedyAgent` (`packages/ai`) that beats `RandomAgent` 200/0 and
2/198 on the seed-1 200-game gate at ~0.27 ms per decision. The standing mandate's end goal is a
browser game the user can actually sit down and play against that AI, with the real card art.

Rung B is that app. It adds **no rules**: every legal move already comes from
`legalCommands(state, player)` and every state transition from `apply(state, command)`. The UI's
whole job is to render a `PlayerView`, turn clicks into `Command`s, and let `GreedyAgent` answer.

**The enabling fact:** `packages/engine` and `packages/ai` contain **zero `node:` imports** — both
run unmodified in a browser. There is no server, no API, no backend. The entire game is a static
site: engine, AI, and card database all execute client-side.

## Decisions

| # | Decision | Ruling (and why) |
|---|---|---|
| B1 | Stack | **Vite + React + TypeScript** in `apps/web`, added to the existing pnpm workspace. Vite because the repo is already ESM/TS with no bundler opinion to fight; React because the UI is a state-driven board with many small interactive pieces. No router, no state library — one game, one screen. |
| B2 | Architecture | **Static SPA, no server.** `apps/web` imports `@fftcg/engine`, `@fftcg/ai` and the card JSON directly. Deployable as plain files; runnable with `pnpm --filter @fftcg/web dev`. |
| B3 | State ownership | One `useGame()` hook owns the ground-truth `GameState`. The React tree **never** sees `GameState` — it renders `viewFor(state, HUMAN)` only, so the UI physically cannot leak the AI's hand. Same fairness guarantee the AI itself gets. |
| B4 | Seats | Human is **P0**, `GreedyAgent` is **P1**, both decks the Vol. 2 starter. Seat choice and deck choice are out of scope. |
| B5 | Interaction model | **Click a card → its legal commands light up.** Build a `Map<CardId, Command[]>` from `legalCommands` each render; a card is clickable iff it is a key. Commands with no card subject (pass, mulligan, chooseFirst, no-block) render as buttons in a **prompt strip** that always states whose turn it is and what the game is waiting for. |
| B6 | CP payment | **Auto-pay via `preferredPayment`**, with the cost previewed on hover/selection before confirming. `legalCommands` enumerates every minimal payment (up to 34 for one card — the explosion rung A deliberately avoided for the AI); showing that to a human is worse than choosing well for them. If `preferredPayment` returns `null` but legal payments exist, fall back to the first legal one. A manual payment picker is deferred to rung E. |
| B7 | AI turn pacing | The AI's decisions are ~0.27 ms — far too fast to watch. Run its turn as a **stepped loop with a ~600 ms delay between moves**, narrating each into the event log, so the game reads as a game rather than a state jump. Runs on the main thread; no worker needed at this speed. |
| B8 | Card images | Real art from the SE CDN, fetched **once** by a script into `apps/web/public/cards/<code>.jpg` (git-ignored, never committed). **The CDN's Cloudflare WAF rate-limits hard — ~12 rapid requests got this machine IP-blocked.** The fetch script is therefore strictly serial at **≤ 1 request/second** with retry-after backoff. 18 distinct codes ≈ 20 seconds. |
| B9 | Missing-art fallback | Every card renders through one `<Card>` component that shows the art when present and a **styled text card** (name, cost, elements, power, type) when not. The app must be fully playable with zero images downloaded — art is an enhancement, never a dependency. |
| B10 | Not in scope | Abilities (rung C — the pool plays as vanilla, and the UI must surface that honestly), ISMCTS (rung D), animations/sound (rung E), multiplayer, deck building, mobile layout. |

## Rendering model

`PlayerView` already carries everything the UI needs (`fields[2]`, `hand`, `cards`, `defs`,
`attack`, `pending`, `result`, `turn`/`phase`/`priority`). `apps/cli/src/render.ts` is the reference
presentation model — `renderView` proves the state is fully renderable and `describeCommand` is the
exact command-to-English mapping the prompt strip needs. Rung B **ports** that logic to React
rather than reinventing it; `describeCommand` in particular should be lifted into a shared place so
the CLI and the web app cannot drift.

Board layout, opponent at top:

```
┌─────────────────────────────────────────────────────┐
│ AI  ██ deck 34  ✋ 5    damage ███░░░░ 3/7           │  opponent status
│   backups   [B][B][B]                               │
│   forwards  [F][F]                                  │
├─────────────────────────────────────────────────────┤
│            « prompt strip / phase + what's needed » │  ← always says what to do
├─────────────────────────────────────────────────────┤
│   forwards  [F][F][F]                               │
│   backups   [B][B]                                  │
│ YOU ██ deck 31   damage ██░░░░░ 2/7                 │
│   hand  [C][C][C][C][C]                             │
└─────────────────────────────────────────────────────┘
```

## Acceptance criteria

- **B-A1** A human can play a **complete game** start (first-player choice, mulligan) to finish
  (a `result`) against `GreedyAgent` in the browser, using only the mouse.
- **B-A2** Every command type is reachable from the UI: `chooseFirst`, `mulligan`, `castCharacter`,
  `castSummon`, `declareAttack` (including multi-forward parties), `declareBlock`,
  `assignPartyDamage`, `discardToHandSize`, `pass`, `concede`.
- **B-A3** The UI never renders a card the human cannot legally see — asserted by a test over
  `viewFor`, not by inspection.
- **B-A4** An illegal click is impossible, not merely rejected: only cards with legal commands are
  clickable. `apply` is never called with a command absent from `legalCommands`.
- **B-A5** The app is fully playable with **no card images present**.
- **B-A6** Unimplemented abilities are surfaced to the player (`unimplementedAbility` events appear
  in the log), so the vanilla-pool caveat is visible in play rather than hidden.
- **B-A7** `pnpm test`, `pnpm typecheck`, `pnpm lint` stay green, and the web app has tests for the
  view-model layer (command mapping, payment selection, AI turn driver) that run headless in vitest.

## Risks

- **The CDN WAF is the one irreversible-ish hazard** (B8): a careless parallel fetch blocks this
  machine's IP for a while and cannot be undone by retrying. Serial, throttled, one-shot, cached.
- **`GreedyAgent` needs both deck lists** to determinise (rung A's A3 fairness assumption). In a
  starter-deck matchup both lists are public, so the web app passes the same list twice — but this
  must be stated in the UI's own code, not silently assumed, so rung D does not inherit a
  hidden-information leak by accident.
- **The pool has no abilities yet** (rung C). Cards with `hasAbilities` play as vanilla; a game can
  therefore feel wrong to someone who knows the cards. B-A6 makes this visible rather than
  mysterious.
