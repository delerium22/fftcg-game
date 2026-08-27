# fftcg-game

A personal digital implementation of the *Final Fantasy Trading Card Game* (Square Enix):
a rules engine plus a text hotseat CLI, built as a from-scratch exercise. Not affiliated
with Square Enix.

Design spec and MVP ladder:
[`docs/superpowers/specs/2026-08-25-fftcg-game-design.md`](docs/superpowers/specs/2026-08-25-fftcg-game-design.md).

## Status: rung D — playable in the browser against a search-based AI

**You can sit down and play a full game against the AI in a browser**: first-player choice and
mulligan, casting Backups/Forwards/Summons with CP paid for you, attacking and blocking, party
damage, and win/loss. The engine (`packages/engine`) and the AI (`packages/ai`) contain no `node:`
imports, so the whole game — rules, opponent, and card database — runs client-side. There is no
server.

The browser opponent is the **ISMCTS search**, running in a Web Worker so the board never freezes
while it thinks (rung D2). It beats the heuristic agent **90.0 %** over 120 mirrored games. If the
worker fails for any reason the game falls back to the heuristic agent permanently and says so in
the log, in amber — a weaker opponent is never silent.

Card abilities are **partly** implemented: **20 of the starter deck's 28 printed ability clauses,
across 15 of its 19 cards**. Every unimplemented clause plays as if its text box were blank, and the
game log says so in amber whenever such a card hits the field, so the caveat is visible in play
rather than a silent surprise.

Six of those eighteen are **activated abilities** — ones you choose to use, paying a cost in CP, in
dulling, or in the card itself. They appear as ordinary clickable choices on the card, labelled with
the printed cost. One is **static**: Odin costs 3 less to cast once you have taken 5 damage, which
the board simply reflects in what you can afford.

**One deliberate rules deviation to know about:** action abilities are *sorcery-speed* here. You may
only use them on your own turn, in a Main Phase. The real rules also allow the Attack Phase, so
Undead Princess cannot be used as a combat trick — you cannot pump a Forward after blockers are
declared. Everything else about them follows the printed text.

The same engine still plays in the terminal (hotseat) and under a self-play fuzzer.

## Running it

```sh
pnpm install
pnpm --filter @fftcg/web dev                           # play in a browser — open the URL it prints

pnpm test                                              # vitest
pnpm typecheck                                         # tsc -b, all packages
pnpm lint                                               # eslint .

pnpm --filter @fftcg/cli hotseat --seed 1                              # play a game in the terminal
pnpm --filter @fftcg/cli selfplay --games 200 --seed 1                 # random-vs-random fuzzer
pnpm --filter @fftcg/cli selfplay --games 200 --seed 1 --p0 greedy --p1 random --fast   # greedy AI vs random
pnpm --filter @fftcg/cli mirror --pairs 60 --a ismcts --b greedy --fast                 # ISMCTS vs greedy, seats swapped
pnpm --filter @fftcg/cli deckorder --seed 1                            # print a seeded deck order
```

`mirror` is the honest way to compare two agents: it plays every seed twice with the seats swapped,
so a seat advantage cannot masquerade as a strength difference, and reports a **paired-bootstrap
confidence interval** rather than a bare percentage.

All three CLI commands accept `--seed N` and `--deck <path>` (default deck:
`decks/starter-2025-vol2.txt`); `selfplay` also accepts:
- `--games N` — number of games (default 200).
- `--p0 <spec>`, `--p1 <spec>` — per-seat agent, one of `random` (default), `greedy`, `greedy:N`
  (`N` = 0, 1, or 2; pins that seat's lookahead depth regardless of `--depth`), or `ismcts[:N]`
  (`N` = iteration budget; bare `ismcts` uses the search's own default, so a run is always reported
  with the budget that produced its ms/decision).
- `--depth N` — lookahead depth (0, 1, or 2; default 1) applied to any `greedy` seat that didn't pin
  its own depth via `greedy:N`.
- `--fast` — skips the engine's `checkInvariants`/immutability assertions between commands (`strict:
  false`), which meaningfully speeds up large tournaments; use the default (strict) mode when
  debugging engine behaviour, `--fast` for win-rate measurement runs.

## Card data

`packages/cards/data/cards.json` is a generated snapshot, not hand-maintained. Regenerate
it with:

```sh
pnpm --filter @fftcg/cards run fetch
```

(`pnpm fetch` collides with pnpm's own built-in `fetch` command — the `run` is required.)

This POSTs to Square Enix's public `get-cards` endpoint and keeps only the cards referenced
by files in `decks/`. The Vol. 2 starter-exclusive cards (`27-1xxS`) aren't in that
endpoint's data, so they're hand-transcribed from the physical cards into
`packages/cards/data/patches/starter-2025-vol2-exclusives.json`, which takes priority over
the fetched data for any overlapping code. Card images are never fetched or committed.
Card text and imagery are © Square Enix; this repo uses them only for personal, non-commercial
play.

## AI opponent

Both agents in `packages/ai` play by **determinising** the game — rebuilding a full, consistent
`GameState` from the agent's own `PlayerView` plus both players' deck lists (assumed public
knowledge, e.g. a fixed starter matchup), sampling unseen cards with a seeded RNG, never touching
the ground-truth state. Neither ever sees hidden information beyond what a real player could infer
from the deck lists being public, and both are seeded and deterministic: same seed + same views ⇒
same decisions.

**`IsmctsAgent` is what the browser plays, and it is the stronger of the two.** It runs
single-observer ISMCTS: a fresh determinisation per iteration, one shared tree, and UCB1 corrected
for *availability* — an action's exploration bonus counts only the iterations in which that action
was actually legal, `mean + C·sqrt(log A(s,a) / N(s,a))`, which is what stops rarely-available
actions from looking artificially good. Nodes are keyed canonically so the same decision found under
different determinisations shares statistics. Rollouts are bounded twice over (command cap and apply
cap) because their tail, not their median, is what costs.

**`GreedyAgent`** is the fallback and the baseline: a one-ply lookahead that applies each legal move,
fully resolves any combat it opens, then rolls out greedily to the end of the turn (depth 1, the
default), widening to depth 2 at attack declaration. Every resulting state is scored with a
hand-tuned evaluation function.

Measured strength, all on seeded runs:

| Matchup | Result |
|---|---|
| ISMCTS vs greedy, 120 mirrored games, 200 iterations | **90.0 %** |
| Greedy vs the concrete-command random baseline, 200 games | **≥ 98 %**, regardless of seat or depth |
| ISMCTS in the browser (production build, Apple Silicon) | p50 **152 ms**, p95 240 ms per decision |

Full breakdowns: [`docs/superpowers/specs/2026-08-26-heuristic-ai-design.md`](docs/superpowers/specs/2026-08-26-heuristic-ai-design.md)
(greedy) and [`docs/superpowers/specs/2026-08-27-rung-d1-ismcts.md`](docs/superpowers/specs/2026-08-27-rung-d1-ismcts.md)
(ISMCTS). One caveat worth stating plainly: the 200-iteration budget was chosen because the browser
comfortably affords it, **not** because it was calibrated for strength — more iterations have not
been shown to be worth their latency.

## Card images

The board renders real card art from the Square Enix CDN, cached locally:

```sh
pnpm --filter @fftcg/web fetch-images            # ~20 s for the 18 distinct codes
pnpm --filter @fftcg/web fetch-images --dry-run  # list what it would fetch, zero network requests
```

Images land in `apps/web/public/cards/` and are **git-ignored** — never committed. The script is
strictly serial with 1.1 s between requests and aborts on the first 403/429: the CDN sits behind a
Cloudflare WAF that rate-limits hard, and roughly a dozen rapid requests will get your IP blocked
for a long time (verified: a block was still in force 18 hours later, and it is IP-based, not a
User-Agent filter). Re-running skips anything already on disk, so an aborted run resumes.

**The app is fully playable with no images at all** — every card falls back to a styled text card
showing name, cost, elements, type and power. Art is an enhancement, never a dependency.

## Rules version

Pinned to **Comprehensive Rules v3.3 (7 Aug 2026)**:
https://fftcg.cdn.sewest.net/2026-08/fftcg-comprules-v3.3.pdf

## Deliberate shortcuts

MVP0 takes a number of known shortcuts against the full CR (no priority passing, no stack,
Summons resolve with no effect, EX Burst skipped, etc.), each marked in the source with a
comment. Find them all with:

```sh
grep -rn MVP0-SIMPLIFICATION packages apps --include='*.ts' --exclude-dir=dist
```

## Repo layout

```
packages/engine   pure TS rules engine (state, commands, reducer, legal-move enumeration, views)
packages/cards    Vol. 2 card data: fetch script + patches + normalisation
packages/ai       Agent interface + RandomAgent + GreedyAgent (determinised lookahead) + IsmctsAgent (SO-ISMCTS)
apps/cli          hotseat / selfplay / deckorder CLI (tsx)
decks/            deck list text files
docs/superpowers/ design spec and implementation plans
```
