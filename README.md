# fftcg-game

A personal digital implementation of the *Final Fantasy Trading Card Game* (Square Enix):
a rules engine plus a text hotseat CLI, built as a from-scratch exercise. Not affiliated
with Square Enix.

Design spec and MVP ladder:
[`docs/superpowers/specs/2026-08-25-fftcg-game-design.md`](docs/superpowers/specs/2026-08-25-fftcg-game-design.md).

## Status: MVP0 — Bones

The engine plays a full legal game of the Starter Set 2025 Vol. 2 deck (Earth/Lightning,
Cloud) end to end via a hotseat CLI: setup and mulligan, turn phases, CP payment, casting
Backups/Forwards/Summons, the attack/block/damage sequence, and win/loss conditions. Card
abilities are not yet implemented — every card plays as if its text box were blank
(Summons resolve with no effect). A random-vs-random self-play fuzzer exercises the engine
for invariant violations. See the spec's MVP ladder for what comes next (MVP1: web hotseat
UI).

## Running it

```sh
pnpm install
pnpm test                                              # vitest
pnpm typecheck                                         # tsc -b, all packages
pnpm lint                                               # eslint .

pnpm --filter @fftcg/cli hotseat --seed 1               # play a game in the terminal
pnpm --filter @fftcg/cli selfplay --games 200 --seed 1   # random-vs-random fuzzer
pnpm --filter @fftcg/cli deckorder --seed 1              # print a seeded deck order
```

All three CLI commands accept `--seed N` and `--deck <path>` (default deck:
`decks/starter-2025-vol2.txt`); `selfplay` also accepts `--games N`.

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
packages/ai       Agent interface + RandomAgent
apps/cli          hotseat / selfplay / deckorder CLI (tsx)
decks/            deck list text files
docs/superpowers/ design spec and implementation plans
```
