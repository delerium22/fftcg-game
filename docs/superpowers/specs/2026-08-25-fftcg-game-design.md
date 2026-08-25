# FFTCG digital game — design spec + MVP ladder

## Context

Personal project: a digital version of the Final Fantasy TCG (Square Enix) to play against a
computer, for enjoyment and as a building exercise. Greenfield — `~/repos/fftcg-game` is empty,
not yet a git repo.

Key finding from research that shapes everything: **the rules engine + per-card ability scripting
is ~85% of the work**; UI and AI are small by comparison. The one starter deck owned (Starter Set
2025 Vol. 2, Earth/Lightning, Cloud) has ability text on every card — there is no "vanilla cards
only" MVP that uses a real deck. So the ladder is: get the *rules* right with abilities treated as
blank, then fill in abilities card by card until the deck is fully playable.

Prior art: [Shufflingway](https://github.com/RockefellerA/Shufflingway) (Java, active, AI, regex-parses
official card prose, no licence) exists. Decision Q1: building it ourselves is the point, so this is
a reference for ideas only.

## Decisions locked (grilling rounds 1–3)

| # | Decision | Choice |
|---|---|---|
| Q1 | Goal | Building is the fun; ladder toward a competent AI |
| Q2 | Card pool | Starter Set 2025 Vol. 2 only (~40 distinct cards + 8 LB) |
| Q3 | Ability encoding | Hand-scripted per card in TS; unimplemented abilities play as blank with a warning |
| Q4/Q17 | UI | Local web page, React + Vite; engine has zero UI dependency |
| Q5 | Language | TypeScript throughout; Vitest |
| Q6 | AI ceiling | Ladder random → heuristic → search; AI sees only a filtered view (no cheating) |
| Q7 | MVP0 | Hotseat (engine as referee) before any AI |
| Q8 | Networking | Never built; design stays deterministic + serialisable anyway |
| Q9 | Rules fidelity | Real CR 3.3 phase/step model from day 1, filled in over time |
| Q10 | Time | A few hours/week → each rung is 2–5 short sessions |
| Q11 | Decks | Text files of card codes |
| Q12 | Card data | Official SE `POST /en/get-cards` snapshot, hand-patched for missing `27-1xxS` starter exclusives |
| Q13/Q15 | Matchup | Vol. 2 mirror match |
| Q14 | Repo | Personal GitHub, public; images not committed |
| Q16 | Limit Break | Own rung after core abilities (LB deck is optional under CR 3.3) |
| Q18 | Engine shape | Pure-data state + command reducer + event log; abilities as generator scripts that yield primitives and pause on decisions |

Rules pinned to **Comprehensive Rules v3.3 (7 Aug 2026)**:
`https://fftcg.cdn.sewest.net/2026-08/fftcg-comprules-v3.3.pdf`. Basic rules sheet:
`https://fftcg.cdn.sewest.net/2024-03/fftcgrulesheet-en.pdf`.

## Architecture

pnpm workspace monorepo:

```
packages/engine    pure TS, no deps. State, commands, reducer, legal-move enumeration, views.
packages/cards     card data snapshot (JSON) + one TS module per card code with ability scripts.
packages/ai        Agent interface + implementations (random, later heuristic/search).
apps/cli           text hotseat harness; also the AI self-play runner.
apps/web           React + Vite renderer + input adapter. Fetches/caches images from SE CDN.
docs/superpowers/specs   design docs (this plan becomes the first spec).
```

### Engine model (`packages/engine`)

- `GameState`: plain serialisable data. Zones per player (main deck, hand, field: forwards +
  backups, damage zone, break zone; LB deck later), turn/phase/step, CP pool, RNG seed + counter,
  `pending?: Decision`, `log: Event[]`.
- `apply(state, command): { state, events }` — the only way state changes. Deterministic given seed.
- `legalCommands(state, playerId): Command[]` — the UI and AI never construct illegal moves; they
  pick from this list. This is also the correctness oracle for tests.
- `viewFor(state, playerId): PlayerView` — hidden information (opponent hand, deck order) removed.
  Both UI and AI consume views, never raw state.
- Phase/step structure mirrors CR 3.3 §9–10: Active → Draw → Main 1 → Attack (prep / declare /
  block / damage) → Main 2 → End. Steps that carry no rules yet are still explicit.
- `new Game(seed, deckA, deckB)`; replay = re-apply command log from seed; undo = truncate log.

### Ability system (arrives MVP3, but the reducer is designed for it from MVP0)

- Card module: `packages/cards/src/cards/27-1xx.ts` exporting `abilities: Ability[]` beside the
  printed `text_en` as a comment (the text is the test oracle).
- Ability = trigger (`onEnterField`, `onAttack`, `activated`, `static`, `exBurst`, …) + a
  generator `function*(ctx)` that yields primitives: `ctx.choose.*`, `ctx.dealDamage`,
  `ctx.search`, `ctx.modifyPower`, … Yielding a choice sets `state.pending`; the answering
  `Choose` command resumes the generator. Mid-effect state is reconstructed by re-running the
  generator with recorded answers (keeps state serialisable for AI cloning).
- Registry: `abilitiesFor(code)`; unknown code → `[]` + `UnimplementedAbility` event (card plays
  as vanilla). A `coverage` script lists which pool cards are (un)implemented.

### AI (`packages/ai`)

`interface Agent { decide(view: PlayerView, legal: Command[]): Command }`. Random agent = one
line. Self-play runner in `apps/cli` seeds N games and asserts no engine invariant breaks — the
cheapest engine fuzzer we'll have.

### UI (`apps/web`)

Renders `PlayerView`; clickable elements are exactly `legalCommands`. Hotseat = one screen,
"pass device" between turns. Text rectangles first; images as a follow-up.

## MVP ladder

Each rung is independently playable/usable. "Sessions" = ~2-hour blocks.

| Rung | Name | Done when | ~Sessions |
|---|---|---|---|
| **MVP0** | Bones | Engine plays a full legal game of vanilla-ised Vol. 2 via CLI hotseat; tests cover CR §9–10 turn structure, CP payment (§11.2 as rewritten in 3.3), attack/block/damage, 7-damage and deck-out loss, keywords present in the pool. Summons cast with no effect. | 4–5 |
| **MVP1** | Table | Web hotseat UI: board, hand, CP payment picker, attack/block flow, damage zone. Rectangles, then images. | 3 |
| **MVP2** | Dummy | Random-legal-move AI in the web UI; self-play fuzzer runs 1,000 games clean. | 1 |
| **MVP3** | Abilities I | Generator ability system + primitives; first ~third of Vol. 2 cards scripted (ETB damage, activated abilities, EX Burst, simple statics). Coverage script. | 4–5 |
| **MVP4** | Abilities II | Remaining Vol. 2 main-deck cards incl. summons, search, conditionals, "choose up to N", replacement effects. Deck is fully playable as printed (minus LB). | 4–6 |
| **MVP5** | Limit Break | LB deck zone, LB costs, casting rules per CR 3.3 §15.2; the 8 LB cards scripted. Vol. 2 playable exactly as sold. | 2–3 |
| **MVP6** | Opponent | Heuristic AI (board-value scoring, attack/block evaluation). Beats random ≥90%. | 3 |
| **MVP7** | Search | Information-set MCTS over `PlayerView` with determinisation. Beats heuristic. | 4+ |
| Later | Pool | Buy Vol. 1 / add collection cards; deck builder; save games — only if still fun. | — |

Rules already deferred out of MVP0–2 on purpose: EX Burst (needs abilities), all card text,
LB deck, Priming/Crystals/Warp (not in Vol. 2 unless the card list says otherwise).

## MVP0 in detail (the only rung planned to task level now)

1. **Repo scaffold**: `git init`, pnpm workspace, TS strict, Vitest, ESLint minimal. Commit.
   Push to personal GitHub (public). `.gitignore` image cache.
2. **Card data**: `scripts/fetch-cards.ts` POSTs to SE endpoint with `set` filter, writes
   `packages/cards/data/cards.json` for the Vol. 2 pool only. Normalise: element kanji →
   enum, `cost`/`power` → numbers, guard `element: null`. Hand-add the Vol. 2 starter-exclusive
   `27-1xxS` cards (transcribe from the physical cards). Deck file `decks/starter-2025-vol2.txt`.
   Print the pool: type counts, keywords present — this tells us exactly which keywords MVP0 needs.
3. **Engine, TDD, in CR order**: state + zones + setup (§4–8: 50-card deck, draw 5, mulligan,
   first player draws 1 on turn 1) → phases/steps (§9) → play Backup/Forward with CP payment
   (§11.2 v3.3 semantics: generate any amount, cannot overpay, unspent CP vanishes; backups
   dull for 1 CP; discard from hand for 2 CP of that element; max 5 backups) → attack phase
   (§10: attack prep, declare incl. party attacks, block, damage, first strike/brave/haste if in
   pool) → damage zone + loss conditions (§12). Summon cast = pay + break zone + no effect.
   Each test file named after its CR section.
4. **`legalCommands` + `viewFor`** with invariant tests (a legal command never throws; a view
   never contains opponent hand contents).
5. **CLI hotseat** (`apps/cli`): prints view, numbered legal commands, reads a number. Play one
   full game end to end.
6. **Self-play smoke**: two random agents, 200 seeded games, no invariant violation. (This is
   MVP2's fuzzer arriving early because it's ~30 lines and catches engine bugs immediately.)
7. Write `HANDOFF.md` at each green commit (multi-session project — handoff discipline applies).

## Verification

- `pnpm test` green; engine tests map to CR sections so gaps are visible by omission.
- Self-play run: `pnpm --filter cli selfplay --games 200 --seed 1` exits 0.
- Manual: play one CLI hotseat game with the physical Vol. 2 deck alongside, same shuffle order
  entered as the seed's deck order, and confirm the engine allows/forbids the same moves.

## Risks / honest caveats

- **CR 3.3 is three weeks old** and changed CP payment; the basic rules sheet is from 2024 and
  predates it. Engine follows the CR, not the sheet.
- **Public repo + card text**: `cards.json` contains SE's card text for ~50 cards. Common practice
  in hobby projects, but it's their copyright; images are never committed. If that bothers you,
  Q14 "private" is a one-click change.
- **Generator resumption by replay** is elegant but has a sharp edge: ability scripts must be
  deterministic given the same answers (no reading `Math.random`, no external state). Enforced
  by convention + a lint rule later.
- **Vol. 2 card list is not yet verified** — step 2 produces it; anything surprising (Priming,
  Crystals, Warp) gets added to the deferred list rather than MVP0.

## Process

1. This spec is the first commit; next, `superpowers:writing-plans` produces the MVP0
   implementation plan only.
2. Each later rung gets its own short brainstorm → spec → plan cycle when we reach it; do not
   plan MVP3+ to task level now — MVP0's card-pool census will change the details.
