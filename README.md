# fftcg-game

A personal digital implementation of the *Final Fantasy Trading Card Game* (Square Enix):
a rules engine plus a text hotseat CLI, built as a from-scratch exercise. Not affiliated
with Square Enix.

Design spec and MVP ladder:
[`docs/superpowers/specs/2026-08-25-fftcg-game-design.md`](docs/superpowers/specs/2026-08-25-fftcg-game-design.md).

## Status: rung B — playable in the browser against the AI

**You can sit down and play a full game against the AI in a browser**: first-player choice and
mulligan, casting Backups/Forwards/Summons with CP paid for you, attacking and blocking, party
damage, and win/loss. The engine (`packages/engine`) and the greedy AI (`packages/ai`) contain no
`node:` imports, so the whole game — rules, opponent, and card database — runs client-side. There
is no server.

Card abilities are still not implemented: every card plays as if its text box were blank, and the
game log says so in amber whenever a card with abilities hits the field, so the caveat is visible
in play rather than a silent surprise. That is rung C.

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
pnpm --filter @fftcg/cli deckorder --seed 1                            # print a seeded deck order
```

All three CLI commands accept `--seed N` and `--deck <path>` (default deck:
`decks/starter-2025-vol2.txt`); `selfplay` also accepts:
- `--games N` — number of games (default 200).
- `--p0 <spec>`, `--p1 <spec>` — per-seat agent, one of `random` (default), `greedy`, or `greedy:N`
  (`N` = 0, 1, or 2; pins that seat's lookahead depth regardless of `--depth`).
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

`packages/ai`'s `GreedyAgent` plays by determinising the game (rebuilding a full, consistent
`GameState` from the agent's own `PlayerView` plus both players' deck lists — assumed public
knowledge, e.g. a fixed starter matchup — sampling unseen cards with a seeded RNG, never the
ground-truth state). The search itself is a **greedy one-ply lookahead with rollout**: for each
legal move it applies the move, fully resolves any combat it opens, then rolls out greedily to the
end of the current turn (depth 1, the default); at attack declaration the depth adaptively widens
to 2, also rolling out the opponent's following turn. Every resulting state is scored with a
hand-tuned evaluation function and the best-scoring move is played. It is seeded and deterministic
(same seed + same views ⇒ same decisions) and never sees hidden information beyond what a real
player could infer from the deck lists being public. Measured over 200 seeded self-play games
(`docs/superpowers/specs/2026-08-26-heuristic-ai-design.md`'s appendix has the full breakdown):
greedy wins **≥ 98 % of games vs. the concrete-command random baseline** on 200-game seeded runs,
regardless of seat or lookahead depth.

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
packages/ai       Agent interface + RandomAgent + GreedyAgent (determinised greedy lookahead)
apps/cli          hotseat / selfplay / deckorder CLI (tsx)
decks/            deck list text files
docs/superpowers/ design spec and implementation plans
```
