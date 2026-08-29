# Rung E6 — the game-over banner speaks English

> **STATUS: REFUSED as written; rewritten below and cleared to build.** The engine change is *justified* and
> `cause` is the right concept — the reviewer says so plainly. What it refused is the acceptance, which was
> self-contradictory in one place and surjective-but-not-correct in three others, plus a reachability claim I
> had just congratulated myself on getting right. Read *Plan review outcome* first.

## Why

I had never watched a game end in the browser. Nothing covered it either: the only endgame assertions in the
web suite are on `describeEvent`'s wording for a `gameOver` event and on `aiIsThinking` against a synthetic
result. So I drove a real game to a real conclusion and rendered the finished board.

The good news is that it works — the banner appears, the reason appears, "Play again" is there, and no stale
choice buttons linger. The bad news is what the banner says to the person who just lost:

```
The AI wins
player 0 has 7 damage (§12.4.1)
```

**"player 0"** is the human. They are "you" everywhere else in this UI — "Your Forwards", "You draw 1 card",
"your Luso is broken by Lightning" — and at the single most emotionally loaded moment in the game they
become a numbered index. **"(§12.4.1)"** is a Comprehensive Rules citation. It belongs in the code comments,
where it already is, not in the face of someone who has just been beaten.

This is the same family as every other defect found by playing today, and the last one on the list: engine
internals leaking into the player's view at the moment of a decision — or here, at the moment of the verdict.

There are **five** ways a game can end, not the four I first counted — I missed the draw, and its `reason`
is the one that is already player-neutral:

| cause | `reason` | site |
|---|---|---|
| damage | `player 0 has 7 damage (§12.4.1)` | `rules.ts:124` |
| concede | `player 0 conceded (§2.1)` | `apply.ts:83` |
| deck-out | `player 0 could not draw a card (§3.1.2)` | `draw.ts:21` |
| damage on an empty deck | `player 0 took damage with an empty deck (§3.1.3)` | `rules.ts:21` |
| **draw** | `both players reached 7 damage (§3.3)` | `rules.ts:123` |

That the draw exists is good news for E6-A4 below: it asks for a genuine simultaneous-death result, and the
engine really produces one, so the criterion is not demanding a fixture that cannot exist. (That was the
mistake in E5, where my hand-built blocking fixture described a state the engine could never reach.)

## What this rung is

`GameResult` is `{ winner: PlayerId | null; reason: string }`. The `reason` is free prose, so **no front-end
can phrase it without parsing English** — and string-munging "player 0" into "you" is exactly the fragile
thing that has bitten repeatedly in this codebase.

The obvious cheaper option is for the browser to INFER the cause from the state it already has: `PlayerView`
exposes both players' `damageZone` and `deck`. That does not work, and the reason is worth stating precisely
rather than hand-waving about fragility. **The same terminal state is reachable by different causes.** A
loser sitting on seven damage with an empty deck could have got there by the seventh damage (§12.4.1), by
taking damage with an empty deck (§3.1.3), by failing to draw (§3.1.2), or by conceding at that moment
(§2.1) — and a concede is invisible in the state entirely. The cause is *not recoverable* from the position,
so it has to be recorded when it is known.

So: add a structured **cause** to `GameResult`, and let each front-end write its own sentence from
`cause` + `winner` + who the viewer is.

```ts
export type GameEndCause = 'damage' | 'concede' | 'deckOut' | 'damageWithEmptyDeck' | 'bothReachedSeven'
export interface GameResult { winner: PlayerId | null; cause: GameEndCause; reason: string }
```

`reason` **stays exactly as it is**, citation and all. It is the right string for a self-play failure report,
a CLI log and a test assertion, and it is the one place the § reference genuinely earns its keep. What
changes is that the browser stops showing it to a human.

The browser then says what a person would say:

| cause | you lost | you won |
|---|---|---|
| damage | You have taken 7 damage. | The AI has taken 7 damage. |
| concede | You conceded. | The AI conceded. |
| deckOut | You could not draw from an empty deck. | The AI could not draw from an empty deck. |
| damageWithEmptyDeck | You took damage with an empty deck. | The AI took damage with an empty deck. |

A draw needs its own phrasing — §3.3 makes simultaneous death a draw — and must not be written as though
somebody won.

## What this rung is NOT

- **Not removing `reason`.** It is load-bearing for `selfplay`'s failure output and for tests.
- **Not a change to any rules behaviour.** The engine decides the same winners for the same reasons.
- **Not the terminal's wording**, and now with a reason rather than a shrug. `render.ts` prints
  `*** GAME OVER: P1 wins — player 0 has 7 damage (§12.4.1)`. The hotseat's whole vocabulary is `P0`/`P1` —
  the board, the damage lines, the prompts — so "player 0" is consistent there in a way it is not in a
  browser that says "You" everywhere else, and the citation is useful on a surface whose audience is me.
  The terminal keeps `reason`.
- Not the game-over banner's layout, colours, or the "Play again" flow, all of which work.

## Acceptance

- **E6-A1** Every `GameResult` the engine can produce carries a `cause`, pinned by a test that enumerates
  the `GameEndCause` union and asserts each value is reachable — so adding a SIXTH way to end a game without
  setting a cause fails, rather than silently defaulting. (Five today; I had counted four.)
- **E6-A2** The browser banner, in a mounted `Board` at a REAL finished game reached by playing, contains
  neither `player 0` nor a `§`. Asserted as an absence AND as a hand-written expected sentence, because an
  absence alone passes on an empty banner.
- **E6-A3** The sentence is correct from the loser's side and from the winner's side, asserted separately —
  a phrasing that ignores `v.me` reads correctly for exactly one of them.
- **E6-A4** A draw is phrased as a draw, and the test reaches or constructs a genuine simultaneous-death
  result rather than asserting on a hand-built `winner: null` that the engine could not produce.
- **E6-A5** `reason` is unchanged, pinned by a test asserting the exact existing string for one cause — the
  CLI and self-play depend on it.
- **E6-A6** Existing tests pass with no expectation edited. Full gates green. No selfplay gate: this is
  wording, and 200 games cannot see it. (Though `selfplay` DOES consume `reason`, so A5 protects it.)

## Mutation plan

| mutation | must fail |
|---|---|
| the banner renders `reason` again | A2 |
| the sentence ignores `v.me` and always says "You" | A3 |
| a draw is phrased as a loss | A4 |
| one `cause` is dropped at its construction site | A1 |
| `reason`'s citation is stripped at the engine | A5 |

## Open question for the plan review

Is `cause` the right shape, or should the engine expose the **loser** explicitly? `winner` plus `cause` is
enough for every current sentence, but "you have taken 7 damage" is really a fact about the loser, and
deriving the loser as `opponentOf(winner)` is only sound while every ending has exactly one. A draw already
breaks that. I lean to `cause` alone, with the draw handled as its own branch, but I would rather be told.

---

## Plan review outcome — refused, and it caught me repeating the E5 mistake

### CRITICAL 1 — E6-A6 was impossible as written

"Existing tests pass with no expectation edited" **cannot coexist** with adding a required field. `toEqual`
rejects the extra property, so five exact result assertions fail by construction
(`legal-apply.test.ts:73`, `cr9-phases.test.ts:41`, `cr12-rules.test.ts:34/40/56`), and synthetic
`GameResult` fixtures in `evaluate.test.ts` and `useGame.test.ts` stop typechecking.

I wrote that criterion out of habit — it is the right one for a browser-only rung and nonsense for a type
change. **Corrected:** no existing behavioural assertion may be removed, weakened, or changed, *except* to
add the expected `cause`. Mechanical strengthening is allowed; loosening is not.

### MAJOR 2 — fixing the banner would have left the identical leak in the log

`describeEvent(gameOver)` renders `result.reason` on its own, and both the human and AI commit paths append
that line to the production log. `Board` renders `EventLog` behind the banner. So A2 could have gone green —
against a mounted Board handed `log: []` — while the finished DOM still said `player 0 has 7 damage
(§12.4.1)` a few pixels lower.

**Corrected:** ONE browser formatter feeding both the banner and `describeEvent`, and the assertion is over
the whole real finished DOM *and* the production log, with mutations restoring `reason` at either consumer.

### MAJOR 3 — A1 proved the wrong property

Enumerating the union and collecting the causes that appear proves the producers are *surjective* over the
enum. It says nothing about which producer emits which. **Swapping two construction sites' causes leaves the
set identical and passes.** Corrected: assert the exact cause at each of the five producers, and add the
paired-swap mutation.

### MAJOR 4 — A5 guarded one string out of five

The spec promised every `reason` stays exact and then checked a single cause. Stripping a citation or
reweording any of the other four would survive. Corrected: pin the exact `{winner, cause, reason}` at all
five producers — the same table that repairs A1.

### MAJOR 5 — A3 could not catch a crossed wire

One loser-side and one winner-side sentence catches "always You". It does not catch `deckOut` being mapped
to the `damageWithEmptyDeck` sentence, or a missing `concede` branch. Corrected: table-driven over every
non-draw cause × both outcomes, plus the draw, keeping one real-play mounted-Board test.

### MAJOR 6 — the draw is NOT reachable by play, and I had just claimed the opposite

Two commits ago I recorded, with some satisfaction, that finding the fifth construction site meant A4 was
"not demanding a fixture that cannot exist". Wrong, in exactly the way E5 was wrong. The engine branch is
required by CR §3.3 and is genuinely reachable *as a rule-process input* — the existing `cr12-rules.test.ts`
hand-fills both damage zones to seven and calls `runRuleProcesses`. But **no operation damages both players
simultaneously**: `dealPlayerDamage` takes one victim and rule processes run after each landed point, so no
sequence of legal commands produces it.

Corrected: A4 says plainly that its fixture is an engine-produced result from a synthetic rule-process
input, not reachable through current legal play. The distinction that matters is *engine-produced* versus
*hand-asserted* — the result object comes from the engine, only its input is synthetic.

### MINOR 7 — a better shape than the one I proposed

Not a `loser` field. Discriminate the union so the invalid combinations cannot be written at all:

```ts
type GameResult =
  | { winner: PlayerId; cause: 'damage' | 'concede' | 'deckOut' | 'damageWithEmptyDeck'; reason: string }
  | { winner: null; cause: 'bothReachedSeven'; reason: string }
```

`{ winner: null, cause: 'concede' }` becomes unrepresentable. `opponentOf(winner)` is sound for every
non-draw result in a two-player game, and is simply never called on the draw.

### MINOR 8 — my rationale for keeping `reason` was wrong

`selfplay` does **not** consume it: `playGame` returns `winner` and `turns`, and failure output carries
thrown errors. The CLI *renderer* consumes it (`render.ts:76`). `reason` stays — the terminal shows it — but
for that reason, not the one I gave.

### Ruled on, and confirmed

- **Engine change: warranted.** `PlayerView` exposes both damage zones and decks but does not record the
  terminal transition. Parsing `reason` is wrong. The only alternatives are a generic "You lost" or dropping
  the line, neither of which preserves a cause-specific explanation.
- **Exactly five result constructors**, no sixth. Worker timeouts fall back, self-play command caps throw,
  illegal commands throw — none produces a `GameResult`.
- **Blast radius is compilation, not runtime.** A new string field is safe for `structuredClone`;
  `determinise` already copies `view.result`; the worker transports a `PlayerView`; sessions serialise and
  replay commands rather than persisting a `GameResult`.
- No rules change, so no `MVP0-SIMPLIFICATION` marker.

## Revised acceptance

- **E6-A1** The exact `{winner, cause, reason}` is asserted at all five producers, from engine-produced
  results. Killed by the paired-swap mutation, not merely by a missing cause.
- **E6-A2** A compile-time exhaustive map over `GameEndCause` pins the union, so a sixth cause fails to build
  rather than silently defaulting.
- **E6-A3** The finished browser DOM — banner *and* production log together — contains neither `player 0`
  nor `§`, asserted on a real game reached by playing, alongside a hand-written expected sentence.
- **E6-A4** Table-driven wording: every non-draw cause × loser-side and winner-side, plus the draw.
- **E6-A5** The draw's sentence, from an engine-produced result whose rule-process input is synthetic and
  **not reachable through legal play** — stated, not implied.
- **E6-A6** No existing behavioural assertion removed, weakened, or changed, except to add the expected
  `cause`. Full gates green.
