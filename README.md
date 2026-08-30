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
while it thinks (rung D2). It beats the heuristic agent comfortably — the measured figure lives in
[Measured strength](#ai-opponent) and is stated once, there, because this line used to carry its own copy
and drifted: it still read 78.3 % after the shipped rollout cap changed the answer to 75.0 %. If the
worker fails for any reason the game falls back to the heuristic agent permanently and says so in
the log, in amber — a weaker opponent is never silent. A clause proven unreachable does NOT warn: a
warning that fires when nothing was lost teaches the player to ignore the ones that matter, and the EX
Burst warnings matter. Each such suppression is a claim about the pool that `packages/cards` proves.

Card abilities are implemented to **27 of the starter deck's 28 printed ability clauses**. The 28th —
Sphene's "cards in your Break Zone cannot be removed from the game by your opponent" — is left out
deliberately, because nothing in this pool can remove a card from anyone's Break Zone: the engine's only
removal is a card paying its OWN activation cost out of its own Break Zone. It plays as if its text box
were blank, and that is indistinguishable from playing it correctly.

An unimplemented clause plays as if its text box were blank, and the game log says so in amber whenever
such a card hits the field, so the caveat is visible in play
rather than a silent surprise.

Eight of those twenty-seven are **activated abilities** — ones you choose to use, paying a cost in CP,
in dulling, or in the card itself. They appear as ordinary clickable choices on the card, labelled
with the printed cost. Two are **static** — abilities that are never resolved, only read: Odin costs
3 less to cast once you have taken 5 damage, and Class Tenth Moogle can produce Lightning CP as well
as its printed Earth. Both simply change what you can afford, which is where the board shows them.

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
pnpm --filter @fftcg/cli mirror --pairs 60 --a ismcts:200+damage=25 --b ismcts:200      # one weight against the default
pnpm --filter @fftcg/cli deckorder --seed 1                            # print a seeded deck order
pnpm --filter @fftcg/cli run profile --games 3 --seed 1                  # where a rollout's applies go (rung D7)
pnpm --filter @fftcg/cli run profile --games 3 --seed 1 --opponent ismcts:200   # ...and where damage sits at each leaf
```

An agent spec is `random | greedy[:0-2] | ismcts[:N][+weight=value,...]`. The weight suffix is what makes an
evaluation A/B possible at all — the search used to hardcode its weights, so the only way to change one was to
edit source, and a comparison whose two arms are different checkouts is not one to ship on. Both an unknown
weight name and a value `Number()` would silently coerce (`1e3`, `0x10`, `' 1'`) are refused at the flag: an
arm that quietly runs the default policy while the report names it as the treatment is an A/B reporting one
arm twice. `profile`'s `--opponent` takes the same specs, because the leaf-damage distribution is a property
of the *matchup* and not of the searching agent alone.

Note the `run` in that last one. `profile` collides with pnpm's own built-in `profile` command, exactly as
`fetch` does below, so it needs `run` to reach the package script.

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

**One exception, and it is deliberate:** the browser gives the search a wall-clock box (rung F4), and a
wall clock is not reproducible. Determinism is preserved by OMISSION — the box is optional and absent
everywhere else, so the CLI, every tournament and every test are unchanged and still byte-identical for a
seed. Only the browser opts in, and only because a player waiting on a move cares about the clock in a way a
measurement does not.

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
| ISMCTS vs greedy, 120 mirrored games, 200 iterations | **75.0 %**, CI95 [66.7, 82.5] |
| Greedy vs the concrete-command random baseline, 200 games | **≥ 98 %**, regardless of seat or depth |
| ISMCTS in the browser (production build, Apple Silicon) | p50 **91–343 ms**, p95 **140–504 ms** per decision, over 5 finished games |

**The ISMCTS number has fallen, and the fall is real.** It measured 90.0 % when rung D1 landed; by rung D3
it was 78.3 %, and re-measured at rung D7 over the same 120 mirrored games it is 75.0 % — with 90.0 % well
outside the confidence interval, so this is not sampling noise. What changed in between is the CARD POOL: rungs C5–C10 added
removal, search, a Break-Zone retrieve and several combat tricks. The leading explanation — that a fixed
200-iteration budget now covers a smaller share of a wider tree — is tested below and holds up. A second,
untested one is that games now run 13.6 turns, giving a search fewer turns to compound an edge.

**The browser figure is a RANGE because a single number would be a fiction.** Measured over five full games
on a production preview, per-game p50 runs 91–343 ms and per-game p95 runs 140–504 ms. Before the search was
boxed (below) the same measurement gave p50 133–429 ms and p95 192–1347 ms — a seven-fold spread in the tail,
because the expensive decisions are the wide boards and how many of those a game reaches varies. Quoting one
game's p95, as this table used to, describes that game and nothing else.

Five games per arm **describe those games**; they do not estimate the population tail, whose per-game standard
deviation is around 409 ms. The number that carries weight is the observed maximum, because it is mechanistic
rather than statistical.

**The tail is SHORTENED by a wall-clock box (rung F4).** The search stops starting new iterations after
500 ms, with a floor of 64 iterations that the clock cannot cut into. It costs no measurable strength: over 60
mirrored seed pairs against greedy the mean paired difference was 0.0000 points per game, 95 % interval
[-2.5, +2.5], and Node decision time fell 243.9 → 206.3 ms. In the browser the worst single decision fell from
**2088 ms to 505 ms**, and every game's p95 now sits under the 600 ms pacing floor.

**The floor is 64 because 8 was dangerous**, which only a measurement showed. The floor is what a slow machine
actually plays, so its strength IS the opponent's strength there — and against greedy, before rung F5:
8 → 12.5 %, 16 → 33.3 %, 32 → 63.3 %, 64 → 71.7 % (30 pairs; 66.7 % on 60), against the unboxed 200's 75.0 %.
That shipped for one commit at a floor of 8, caught by a code review insisting on a gate that had been
specified and skipped.

**Rung F5 then removed the cause.** The ranking used to break a visit tie on the action KEY — a total order
that exists for determinism and is arbitrary with respect to quality — so equally-visited actions were decided
alphabetically and their rollout rewards discarded. Ties are common: 11.7 % of decisions at 200 iterations and
90.9 % at 8. Preferring the higher mean among equally-visited edges (the key remains the final tie-break) is
non-inferior at 200 and at 64, and at 8 iterations takes the agent from **12.5 % to 50.8 %**, paired 95 %
interval [+30.0, +46.7]. At the shipping floor of 64 it measures +7.5 points with an interval of [+0.0, +15.0]
— positive, safe, and underpowered at 120 games rather than the ~1,000 the claim would want.

It SHORTENS the tail rather than bounding it: the worker handles messages serially, so a superseded search
still runs to completion before the next one starts. A hard bound needs the search chunked across turns of the
event loop.

**Before F4, these numbers went UP when the measuring instrument was fixed (rung F3), and the old ones were
never real.**
`measure-worker.js` drove the human seat with `querySelector('.hand button.card')` — the FIRST hand card,
which in this deck is very often Lightning at cost 7 and therefore uncastable. The driver clicked it, found no
action, and passed. Every browser latency figure this project has ever published was measured on a game where
the human never played, so both boards stayed narrow and the wide-board decisions that dominate the tail
barely occurred. The driver now tries each card in turn; a full game went from not finishing in 166 seconds
to finishing in 27.

What did NOT vary: **zero long tasks in all five runs**, and a worst frame gap of 21–47 ms. The search runs
in a worker (rung D2) and the main thread is never blocked, so a slow decision is a wait with a "thinking"
indicator, not a frozen page — and `AI_STEP_MS` (600 ms) already paces the median, so most decisions are
presented on the same beat regardless. The tail is a patience question, not a jank one.

Full breakdowns: [`docs/superpowers/specs/2026-08-26-heuristic-ai-design.md`](docs/superpowers/specs/2026-08-26-heuristic-ai-design.md)
(greedy) and [`docs/superpowers/specs/2026-08-27-rung-d1-ismcts.md`](docs/superpowers/specs/2026-08-27-rung-d1-ismcts.md)
(ISMCTS), whose figures are the ones measured when those rungs landed.

The 200-iteration budget was chosen because the browser comfortably afforded it at the time, **not**
because it was calibrated for strength — and it no longer affords it as comfortably as that sentence
implied. That caveat used to end "more iterations have not been shown to be worth
their latency"; they now have been. Over the same 20 seed pairs, changing only the budget:

| Budget | Result |
|---|---|
| `ismcts:200` | 80.0 % (32/40), CI95 [67.5, 92.5] |
| `ismcts:600` | **90.0 %** (36/40), CI95 [80.0, 97.5] |

At 600 the search lands back on the figure it scored before the card pool widened, which is what makes
the branching explanation the likely one: the search did not get worse, its budget stopped covering the
tree. The intervals overlap, so on two independent runs alone this is support rather than proof — but it
is the same seeds and the same opponent, and the point estimate moves ten points in the predicted
direction.

**The default stays 200 anyway, and the measurement is why.** Re-measured with
`scripts/measure-worker.js` on a production preview, latency was p50 454 ms and p95 **1351 ms** — a row
that used to read p50 152 ms / p95 240 ms, so it had rotted by the same cause and further. Tripling the
budget to buy ten points of strength would have put p95 near four seconds.

Two changes since then, and the difference between them is the interesting part.

**D4** stopped the search deep-cloning the card database every iteration. The median fell 454 -> 283 ms and
**p95 did not move at all** (1351 -> 1385 ms): the saving landed on cheap decisions, while expensive ones
are dominated by the rollout. Since the coordinator paces AI moves to `AI_STEP_MS` = 600 ms, a faster
median is invisible in play — ~22 % more games per hour for measurement runs, and nothing a player feels.

**D5** halved the rollout command cap, 24 -> 12, after measuring the dial instead of reasoning about it.
That one reaches the tail, because the rollout is 99.4 % of engine work:

| cap | win rate (120 games) | ms/decision | browser p95 |
|---|---|---|---|
| 24 | 78.3 %, CI95 [70.8, 85.0] | 392 ms | 1385 ms † |
| **12** | **75.0 %**, CI95 [66.7, 82.5] | **240 ms** | **604 ms** † |
| 6 | 45.0 % (40 games) | — | — |

The worst case more than halves and lands at the 600 ms pacing floor, so nearly every decision now finishes
inside the window the player already waits — instead of occasional 1.4-second stalls. The cost is 3.3
points of win rate, which 120 games cannot distinguish from zero, though it moved the same way in both
samples, so it is more likely small-but-real than nothing. **The dial has a cliff just below 12**: at 6 the
agent falls to a coin flip, because a rollout that stops before it reaches informative states is evaluating
noise.

† **Those two p95 figures are historical and each describes ONE game**, which is the very thing this README
criticises two sections above. They are also pre-F3, so they were taken through the broken driver described
there and are understated. They are kept because the COMPARISON between them — the effect of halving the cap —
is what the row is for, and both sides carry the same bias. The current figure to trust is the range in the
strength table.

The numbers carry the harness's own instrumentation overhead and come from one machine under a scripted
driver, so treat them as indicative.

**The real lesson is that a fixed ITERATION count is the wrong control variable.** It holds work constant
and lets responsiveness drift, which is exactly backwards for an opponent a human waits on — and it is why
both of these numbers rotted silently as cards were added. A time-boxed budget ("search until 250 ms, then
answer") holds responsiveness constant instead, spends more iterations on cheap states than expensive ones,
and cannot rot as the pool grows. That is what most MCTS engines do, and it is the obvious next rung.

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
