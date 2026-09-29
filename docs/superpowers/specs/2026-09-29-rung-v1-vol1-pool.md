# Rung V1 — the Starter Set 2025 Vol. 1 pool (Fire/Water, Zack), and a deck per seat

> **STATUS: DESIGN, 2026-09-29.** Agreed under the user's standing instruction (2026-09-29): "keep looping until all work
> is done; at a decision point go with the recommended option; for a ruling follow the official rules; only stop for a
> major crossroads; permission to merge". Scoping answers from the user (2026-09-29): **two rungs** (the four cards that
> need replacement effects are finished in a later rung V2), **a deck picker per seat**, **the retail list as
> printed**. Calls marked D are mine and recorded so they can be overturned here. Architectural: new trigger, effect,
> condition, filter and cost kinds; a second deck; per-seat decks through the web app, the CLI and the AI.

**As built (V1-A1), 2026-09-29.** Commits a1bf005 (`attacks` trigger, matrix row 10.1.2.5 tested), 083dc72
(`controlsAtLeast`, `StaticScope.self`), 7dee0a4 (`if`, `subjectMatches`), e106436 (counted damage). Deviations and
readings from the plan:
- `conditionHolds` is in `resolve.ts` (R1). `countControlled` and `amountOf` are in `layer.ts` and re-exported from
  `resolve.ts`, not through an `export *` of `layer.ts` in the index, which would export `staticApplies` twice (cp.ts
  already re-exports it).
- `subjectMatches.filter` is a `TargetFilter`, read once at resolution through `matchesFilter` (Task 3's interface).
  The definition-only rule (V1-D6, R5) binds `controlsAtLeast` and `per`, which the layer and the sweep count.
- Game creation checks every static carrying a `when` (`costReduction` included), and also refuses an unknown
  condition controller and a `self` that is not `true`.
- A chooser under an `if` raises its prompt at RESOLUTION (declaration ends at the `if`), so it has no declared
  targets for §11.11.2 to re-check and no §11.8.4 cancellation at placement.
- A damage amount that comes to 0 or less skips the effect entirely (no event, no damage trigger). That also covers a
  printed 0, which no pool card has.
- Web: before any pick, a `subjectMatches` branch cannot be read, so the prompt names the `then` branch; the target
  buttons read the picked card. With no frame (an activation button) a counted amount reads "1000 damage for each
  Backup you control".
- Task 4's commit also changes the web wording (R9), though its subject names only engine and ai.

**As built (V1-A2), 2026-09-30.** Commits 4ba1331 (`select`, `onlyIfChosen`), 1f7a875 (`putIntoBreakZone`,
`activate`), ecb081b (hand targets, `discard`, `playOntoField`, hidden candidates). The flag is named `select`
(V1-D9 said `chooser`). Deviations and readings from the plan and its revisions R1–R9:
- A `putIntoBreakZone` transition carries a new `ZoneTransitionReason` `putByAbility`, not `ability`: `ability` is
  `breakCard`'s, and the web's trigger cause read it as "was broken". The event is `putIntoBreakZone` with reason
  `ability` (R6).
- R3: a hidden or opaque `chooseTargets` pending digests with the PRINTED `min-max` of its suspended node, not the
  pending's. The determinised pending clamps to the sampled hand (R4), so its bounds differ between worlds.
- `chooseTargetsCheck` clamps a select's `min` to its candidates, as `max` already was. Live this changes nothing (a
  select is raised only over at least `min` candidates); it keeps a determinised min-1 select over an empty sample
  answerable. A select with some candidates but fewer than `min` still reports no legal target, like a choice.
- `viewFor` keeps a hidden pending's live `min`/`max`. `max` below the printed one says fewer cards matched; with
  every pool hand select at max 1 that says only "at least one", which the prompt existing already says.
- Game creation runs a new `validateEffects` (recursive, R9): a hand zone must be your own and `select: 'self'`, and
  a `playOntoField` must sit under a binding whose `type`/`types` excludes Summons. The executor also skips a
  non-Character (Forward and Backup only; Monsters are out of scope).
- Web: the put button reads "Put into the Break Zone: Cloud" (the button shape is `<imperative> <names>`); play reads
  "Play Cloud"; an AI select reads "The AI selects 1 Forward it controls to …", and over its hidden hand "… card from
  its hand …".
- Known gaps, for V1-B: `declarationNode` (activate.ts) still declares a head `chooseTargets` at activation even when
  it is a select, so Taivas's `[0]` needs it to skip selects. A frame's `chosen`/`declared` may carry a hand id while
  a nested prompt waits (R9); no pool card suspends there, and the other seat's key would show it opaque.
- Timing matrix: row 11.3.3 now also cites the select test ("select" is not "choose"). §7.7.4 and §15.1.1.1/.3/.4 have
  no rows (the matrix covers chapters 9–12 and 15.1.1.9); their Layer 1 cases are in `engine/test/selects.test.ts`.

## Source and the list (V1-D1)

Starter Set 2025 Vol. 1 is Fire/Water, built around Zack: 50 main-deck cards and an 8-card LB deck (official product
page: [news](https://fftcg.square-enix-games.com/na/news/new-product-information-starter-set-2025-vol-1-vol-2)). SE
does not publish the full list. It comes from Materia Hunter (product 229), which matched our Vol. 2 list card for
card (product 230 vs the retail Vol. 2 list, commit ee46405). The deck file cites the source and says it is
unofficial. The four exclusives `27-122S/123S/128S/129S` are absent from the SE card endpoint, like `27-124S..127S`,
and are hand-patched from Materia Hunter's text (`data/patches/starter-2025-vol1-exclusives.json`).

Main (50): 3 each of 27-122S Wuk Lamat, 27-123S Zack, 27-128S Charlotte, 27-129S Yuna, 1-170C Fairy, 3-143C Leonora,
11-010C Warrior, 11-121C Porom, 12-005C Ifrit, 13-013C Palom, 13-125R Yuzuki, 18-003C Machinist, 18-094C Geomancer,
18-129C Jecht, 21-001R Ward, 21-010H Taivas; 2 × 20-106R Alphinaud. LB (8): 2 × 22-112R Zack, 2 × 22-123R Leo,
1 × 23-119R Vincent, 1 × 23-130H Luso, 2 × 24-126H Ultima Weapon.

## Rungs and PRs (V1-D2)

`fetch-cards.ts` pulls every code in every `decks/*.txt` into `cards.json`, and `pool-coverage` requires every pooled
card to be encoded. So the Vol. 1 deck files, the patch, the 22 encodings and their scenarios land in ONE PR. The
engine vocabulary lands before it; the picker after it. Each is its own PR, merged green:

| PR | Content | Pool change |
|---|---|---|
| V1-A1 | Triggers, conditions, amounts: the `attacks` trigger, `controlsAtLeast`, the `if` effect, counted damage | none |
| V1-A2 | Zones and choosers: `putIntoBreakZone`, `chooser: 'opponent'` ("select"), `onlyIfChosen`, hand targets, `discard`, `putOntoField` from hand, `activate` | none |
| V1-A3 | Filters, costs, restrictions: `anyOf`, multi-job match, `sameElementAsChosen`, special abilities (`discardSameName`), `onlyCp` payment restriction, the action-ability ban | none |
| V1-B | Vol. 1 data, patch, encodings, deck files, Layer 3 scenarios, matrix rows | Vol. 1 added |
| V1-C | A deck picker per seat (web + CLI); per-seat decks through the AI | none |
| V2 (later rung) | Damage-modifying replacement effects (§11.12 reading to be written) and the four C clauses | none |

V1-A PRs carry synthetic Layer 1 tests only. Each new kind is wired through every touchpoint (V1-D14).

## The cards (V1-D3)

**A — encodable today:** Warrior 11-010C (two activated self-break abilities), Ifrit 12-005C, Palom 13-013C (its
"if you control a Card Name Porom Forward" uses `if` + `controlsAtLeast`; the pool's only Porom is a Backup, so the
8000 branch is live code with no reachable case — tested synthetically), Machinist 18-003C, Geomancer 18-094C,
Zack LB 22-112R, Leo LB 22-123R.

**B — encodable with V1-A:**

| Card | Needs |
|---|---|
| Zack 27-123S | Haste `when: controlsAtLeast {3, opponent, forward}`; `enterField` + `attacks` clause; `forEach` opponent Forwards, damage `{ per: {self, backup}, times: 1000 }` |
| Wuk Lamat 27-122S (clause 2) | `enterField` + `attacks`: `chooseTargets` opponent Forward → `if controlsAtLeast {5, self, character}` → damage 7000 |
| Yuna 27-129S | ETB: `chooseTargets` from own hand, min 0, `{forward, cost 3}` → `putOntoField`; `attacks`: the existing `lookAtDeck` (top 3, take 1, rest to bottom) |
| Fairy 1-170C | `chooseTargets` Forward → `activate`; `draw 1`; EX Burst |
| Leonora 3-143C | ETB search `anyOf [{name Palom}, {name Porom}]`, may; EX Burst |
| Porom 11-121C (clause 1) | ETB: `chooseTargets` own hand, 1, chooser self → `discard` → `if subject matches {category IV}` then draw 2, discard 1 else draw 1 |
| Jecht 18-129C | `activated` [Fire][Water], `yourTurnOnly`, grants Haste, First Strike, Brave to self until end of turn; special ability "Jecht Beam" [S][Dull]: damage 8000 |
| Alphinaud 20-106R | ETB: `chooseTargets chooser: 'opponent'`, opponent's dull Forward → `putIntoBreakZone`; Damage 3: `modifyPower +2000 when damageReceived 3` (existing; it reads the player's Damage Zone) |
| Ward 21-001R | static `onlyCp: fire`; EX Burst ETB damage 7000 |
| Taivas 21-010H | ETB search `anyOf [{job Warrior}, {name Warrior}]`, may; [0] `yourTurnOnly`, `oncePerTurn`: `chooseTargets` own hand `anyOf …, cost ≤ 3` → `putOntoField` |
| Vincent LB 23-119R | First Strike; ETB: `chooseTargets` own Fire Backup, min 0, `onlyIfChosen` → `putIntoBreakZone`, then `chooseTargets` opponent Forward → damage 9000 |
| Luso LB 23-130H | ETB: `chooseTargets` own Character → search `{job Standard Unit, sameElementAsChosen}`, may; observer `observesEnterField {self, job Standard Unit}` → +4000 to self until end of turn |
| Ultima Weapon LB 24-126H | ETB 1: `chooseTargets` Forward → `if controlsAtLeast {4, self, fire character}` → 9000; ETB 2: `if controlsAtLeast {4, self, water character}` → `chooseTargets chooser: 'opponent'`, their Forward → `putIntoBreakZone` |

**C — partly encoded in V1, finished in V2 (V1-D4):** Wuk Lamat clause 1 (+2000 damage), Charlotte clause 1
(−1000 to her), Porom clause 2 (next damage −2000), Yuzuki clauses 1 and 2. These clauses stay **unimplemented**, not
inert: they would change play. The engine already surfaces that (the details panel's caveat, the cast-time log
warning, E3a). `pool-coverage` gets an explicit expected-gap table `{27-122S: 1, 27-128S: 1, 11-121C: 1, 13-125R: 2}`
that V2 empties; any other gap still fails. Charlotte clause 2 ("cannot be chosen by your opponent's Summons of cost
1") is **inert**: neither pool has a cost-1 Summon (Vol. 2: Shiva 3, 13-072R 5, 20-103H 2; Vol. 1: Fairy 2, Ifrit 5),
with the usual proof test. Charlotte clause 3 (the action-ability ban) is B.

## Design

- **V1-D5 — `attacks` trigger (§10.1.2.5).** "When X attacks" fires when X is declared as an attacker (§10.1.2.4:
  "now treated as an attacking Forward"); §10.1.2.5 puts those abilities on the stack before the §10.1.2.6 grant.
  `applyDeclareAttack` enqueues one per attacking Forward that has the clause (a party: each member's own). Placed
  at the `declared` window's grant, turn player's first (§11.8.7). This is the declaration trigger vocabulary J1-D10
  deferred; matrix row 10.1.2.5 moves off n/a. "Enters the field or attacks" is two clauses with shared effects,
  two ids (`:etb`, `:attack`), one printed clause (the clause count reads the card text, V1-D13).
- **V1-D6 — conditions.** `StaticCondition` gains `controlsAtLeast { count, controller: 'self' | 'opponent',
  filter?: DefFilter }` (counts field Characters by DEFINITION only, so a static `when` never reads the layer's own
  output; validated at game creation). A continuous static that says "<this card> gains …" uses the new
  `StaticScope.self: true`. It serves static `when` (Zack's Haste, read by the
  layer each time) and a new effect `{ kind: 'if', when: Condition, then: Effect[], else?: Effect[] }`, evaluated at
  resolution. `Condition` = `StaticCondition | { kind: 'subjectMatches', filter }` (the frame's current subject,
  e.g. Porom's discarded card).
- **V1-D7 — counted amounts.** `damage.amount: number | { per: { controller, filter }, times: number }`, counted
  when each hit resolves. Within one sweep nothing leaves the field (breaks are rule processes between frames), so
  every hit of Zack's sweep reads the same count.
- **V1-D8 — `putIntoBreakZone` effect.** A zone movement from the field, not a break (§15.1.1.3.2: a break is by
  damage or an effect that says "break"): no `broken` event; watchers of field→Break Zone fire with reason
  `ability`; `cannotBeBroken` does not stop it; the LB sweep applies (§15.2.8.4.1).
- **V1-D9 — "your opponent selects".** `chooseTargets.select?: 'self' | 'opponent'` (named `select` in V1-A2; every "you may put/play/discard" is a select too). §11.3.3: "To select something is not
  equivalent to to choose something". So a select raises the pending on the OPPONENT of the effect's controller,
  does not dispatch `observesChosen` (Prishe), ignores "cannot be chosen", and never makes a Summon uncastable for
  lack of targets (§11.3.3 applies to "chooses"). An empty candidate set is a no-op.
- **V1-D10 — `onlyIfChosen`.** `chooseTargets.then` runs on zero picks today (resolve.ts:315), and existing "up to"
  shapes rely on it. A new `onlyIfChosen: true` skips `then` when nothing was picked (Vincent's "When you do so").
- **V1-D11 — hand targets.** `TargetSpec.zone` gains `hand` (own hand only). The pending's candidates are hidden
  information: the opposing view must not see their ids or codes (same treatment as `chooseFromDeck`). A `discard`
  effect moves the subject from hand to Break Zone. `putOntoField` accepts a hand subject ("play onto the field" is
  not a cast: no cost, no cast event, the enters-field triggers fire; field limits and same-name apply, §7.7).
- **V1-D12 — filters.** `anyOf: DefFilter[]`. Multi-job: `CardDef.job` stays one string; the job filter matches
  when the filter's job is one of `job.split('/')` (the SE endpoint writes multi-job cards as `"Warrior/Rebel"`;
  Wuk Lamat's patch says `"Princess/Warrior"`). `sameElementAsChosen: true` matches a card sharing an
  element with the frame's first chosen card.
- **V1-D13 — special abilities (§11.7).** `activated.special?: { name: string }` with cost `discardSameName: 1`
  (discard a card with the same name from hand). The action-ability ban does not reach a special ability
  (§11.6/§11.7 are distinct). Check that `normalise` counts the `[[s]]Name[[/]]` line as one printed clause. The
  §11.7 matrix rows that the Jecht cases exercise move to tested; the rest stay n/a.
- **V1-D14 — `onlyCp` payment restriction (Ward).** A static clause `{ kind: 'onlyCp', element }`, read by
  `castRequirement`; `canPay`, `enumeratePayments`, `canAffordCast` and `checkedPay` refuse any CP of another element,
  overpay included. (The `['fire','fire','fire']` data trick fails: overpaying is legal, §11.2.2.3.)
- **V1-D15 — the action-ability ban (Charlotte clause 3).** Static flag `cannotUseActionAbilities` with scope
  opponent's Forwards; `activationCheck` refuses an action ability (not a special ability) whose source is a Forward
  under it.
- **V1-D16 — touchpoints per new kind.** `abilities.ts` union → `resolve.ts` executor → `describeAbilityEffect`
  (narration) → `candidates.ts` `targetDelta` (priced, never a `0` default) → `keys.ts` for any new pending shape →
  web prompt text → `checkInvariants` for any new state field → `docs/rules/timing-matrix.md` rows.
- **V1-D17 — per-seat decks (V1-C).** Web: a pre-game picker of (your deck, AI deck) ∈ {Vol. 1, Vol. 2}², default
  **you Vol. 2 vs AI Vol. 1** (the set the user owns). `createGame` already takes per-seat `decks`/`lbDecks`. The AI
  coordinator, the worker protocol and every agent's `decks` get the per-seat lists (`determinise` needs the
  opponent's real list). CLI: `--deck0/--deck1` (and LB equivalents), default the same as the web. **Tests:** the
  exported `DECKS` stays the Vol. 2 mirror for fixtures, so seed-pinned tests are untouched; only e2e routes that
  run the app's real default are re-pinned, with a finder over the app's own choice set (handoff dead end).
- **V1-D18 — art.** Text-only for the four new exclusives (as for Vol. 2's). Reprint art is fetched locally with the
  throttled script if at all; never committed.

## Tests (acceptance)

- **V1-A:** one Layer 1 case per new kind, red before; for `attacks`: a party's two triggers placed at `declared`,
  turn player's first; for select: Prishe does not fire, a "cannot be chosen" Forward can be selected, the pending
  belongs to the opponent and the ISMCTS key round-trips; for hand targets: the opponent's view has no hand ids; for
  `onlyCp`: an overpay with water CP is refused; for the ban: an action ability refused, a special ability allowed.
- **V1-B:** every card's data test (type, cost, elements, generic, EX Burst), one Layer 3 scenario per B card group
  (Zack attack sweep, Alphinaud select, Vincent when-you-do-so, Taivas play-from-hand, Jecht Beam, Ward payment, Ultima
  Weapon both conditions), the pool gap table, strict self-play of Vol. 1 vs Vol. 2 with random/greedy/ISMCTS.
- **V1-C:** the picker's default and each combination start a legal game; the AI worker receives the per-seat lists;
  e2e: a game started from the picker's default reaches the AI's first move.

## Out of scope

Replacement effects and the C clauses (V2). A deck builder. Re-tuning AI weights for a burn deck (measure, record).
