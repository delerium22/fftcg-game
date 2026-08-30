# Rung G3 — EX Burst, the thing that happens when you take damage

> **STATUS: SPEC, revised after plan review. Nothing built.** The first draft was ruled *not safe to
> implement*: it never mentioned the line that would have erased the decision before the player ever saw it,
> and its headline acceptance criterion was not a valid experiment. Both are fixed below, and the review's own
> reading shrank the rung in one place — see "What the review established".

## The gap, measured

`dealPlayerDamage` reveals the top card into the damage zone and, if it prints EX BURST, emits
`exBurstSkipped` and moves on. The marker is honest — `// MVP0-SIMPLIFICATION: §11.10 EX Burst not resolved` —
so this is a *declared* deviation, not a defect. It is also the largest one left.

Measured over 20 greedy-vs-greedy games on the shipping deck:

| | |
|---|---|
| damage dealt | 190 |
| EX Bursts revealed and skipped | **43 — 22.6 % of all damage** |
| deck codes with EX BURST | 4 of 18 (Lightning, Noel, Reeve, Odin) |

Nearly a quarter of every damage event in the game does nothing. To a player who knows FFTCG, flipping a
Lightning off the top and watching nothing happen is the single most obviously-missing rule.

**Correction to my own first draft: it is not silent.** The UI already renders `exBurstSkipped` as an amber
warning — *"EX Burst on Lightning skipped (not implemented)"* — so the player is told, every time, that a rule
was not applied. `types.ts` even argues the point: *"A warning that cries wolf is worse than no warning,
because the EX Burst ones are real."* That is the right way to ship an unimplemented rule, and it raises the
bar for this rung rather than lowering it: the gap is already visible and honestly labelled, so the only thing
worth shipping is the rule itself, correctly. Half-implementing it would replace an accurate warning with
inaccurate play.

## Why it is smaller than it looks

**All four abilities already exist and already work.** They are the same clauses these cards use on a normal
cast, and every effect they need — `chooseTargets`, `dull`, `breakCard` — is implemented and exercised:

| card | clause | fires today on |
|---|---|---|
| 16-092C Noel | `16-092C:etb` | `enterField` |
| 27-127S Lightning | `27-127S:etb` | `enterField` |
| 20-105C Reeve | `20-105C:etb` | `enterField` |
| 13-072R Odin | `13-072R:summon` | `summonResolve` |

That is also what the real rule says: the EX BURST tag prefixes *one printed clause*, and being dealt as damage
is a second way to reach it. So this rung must **reuse the existing `Ability` objects**, not copy them. Two
definitions of one clause would drift, which is the divergence this repo has been bitten by three times
(`preferredPayment` against `canPay`, `backupElements` against `def.elements`, `promptFor` against the phase).

C1's own plan already scheduled this: *"EX Burst on damage | Odin, Noel, Reeve, Lightning | C3"*. C3 shipped
activated abilities instead and this was never picked back up. It is deferred work, not rejected work — a
distinction F2 got wrong once and cost a rung.

## What the review established, including where I was wrong

**A prompt created in `dealPlayerDamage` would never be seen.** `resolveDamage` (`attack.ts:184`)
unconditionally writes `pending: null` after damage resolves. The natural implementation — swap
`exBurstSkipped` for a pending — produces *no decision at all*, and every test that checked the board would
still pass. My first draft did not mention this integration point.

**EX Burst must resolve before the attacker's damage triggers.** `dealPlayerDamage` enqueues `dealtDamage`
clauses and the agenda is FIFO, so a burst appended afterwards would resolve *second*. The order is: damage
lands → lethal check → EX Burst offer and resolution → damage step finishes → ordinary damage triggers.

**The batching case is unreachable, so it is scoped out rather than built.** CR §6.5.2.1 batches multiple
points of one damage resolution before any EX Burst resolves. I worried about this and it does not arise:
`resolveDamage` (`attack.ts:145`) has an unblocked party deal **one** point, with members sharing only
attribution, and blocked members deal power to the blocker. **No engine path deals more than one point of
player damage**, so at most one EX Burst is ever pending. That collapses the ordered continuation the review
sketched into a single deferred offer — the rung got smaller because the reviewer read the code.

**All four clause bodies are safe to reach from damage** — confirmed by reading, not assumed. None looks up
its source on the field. Reeve's `lookAtDeck` reads the controller's deck, which after damage is correctly the
*next* cards rather than Reeve. Odin already resolves from off-field on a normal cast (`cast.ts:69`), so the
damage zone is no different. Odin's unrelated static cost reduction must not fire.

**And two things I had structurally wrong.** A `Frame` stores `abilityId`, `source` and `controller` — not an
`Ability` object — so G3-A2's "assert by identity" had nothing to hold. And `drainResolution` emits
`abilityTriggered` for every non-activated frame, which would narrate an EX Burst as an ordinary trigger.

## Design

**Mark the clause, do not infer it.** Add `exBurst: true` to the four `Ability` objects rather than matching
the string `'EX BURST'` at the front of `text`. Selecting behaviour by prose is how a card gets mis-triggered
when someone rewords a comment, and the flag lets the pool check assert every `def.exBurst` card has exactly
one marked ability.

**A dedicated pre-frame decision**, because no existing pending fits. `chooseTargets`, `chooseMode` and
`chooseFromDeck` are all projections of a *suspended active frame*, and `applyChooseMode` requires the frame's
current AST node to be `chooseModes`. Noel's `min: 0` does not help either: "use the clause and choose zero
targets" is a different answer from "decline the burst", and the two must stay distinguishable in the log.

```ts
Pending  { kind: 'chooseExBurst'; player: PlayerId; card: CardId; abilityId: string }
Command  { type: 'chooseExBurst'; player: PlayerId; use: boolean }
```

It must **not** create `resolution.active` — it precedes the frame — so it stays out of the invariant that
pairs ability pendings with an active frame, or every offer would report as an orphan.

**The offer has to survive the damage step.** It is raised after the lethal check and must keep
`attack.step === 'damage'` until answered; `stopped` must clear it on a game-ending path, since it currently
clears `resolution` but not `pending`.

**Use routes through the existing ability**, by id, through `abilityOf`/`runFrame`, with an `exBurst` frame
origin so it is narrated as a burst rather than as an ETB trigger. No second effect AST anywhere.

**The card stays in the damage zone**, and none of the four can target itself — the source sits in a zone
`targetCandidates` never enumerates. Nothing about the damage changes: the deck still loses its top card, the
damage still counts toward seven, and the empty-deck loss (§3.1.3) still takes precedence.

**`exBurstSkipped` goes away and must be replaced, not simply deleted.** It is the honest warning that today
tells the player a rule was not applied; removing it without `exBurstOffered` / `exBurstUsed` /
`exBurstDeclined` would leave the lifecycle unnarrated and the acceptance figures unauditable.

## Acceptance, predeclared

**G3-A1 — every eligible reveal is accounted for, one way each.** My first draft demanded "the same 43 EX
Bursts, now offered instead of skipped". That is not a valid experiment: once bursts change boards and AI
choices the same seeds no longer produce the same games, so the count *must* move. It also contradicted A5,
since any lethal reveal must NOT be offered — and it could have passed by renaming the event while resolving
nothing.

Replaced with a per-reveal accounting over the corpus: for every damage event revealing a `def.exBurst` card,
exactly one of these holds, and the three tallies sum to the reveals —

1. **lethal-suppressed** — the damage was the seventh, the game ended, no offer;
2. **declined** — offered, answered `use: false`;
3. **used** — offered, answered `use: true`, followed by a frame carrying that card's marked `abilityId`.

`exBurstSkipped` is emitted zero times. The pre-change baseline is recorded as 43 skips of 190 damage events
over 20 games, as context for the size of the change — *not* as a number the after-run must reproduce.

**G3-A2 — selection and routing, since there is no object to identify.** The offered `abilityId` is the card's
marked `exBurst` ability; execution goes through `abilityOf`/`runFrame`; and the pool check asserts each
`def.exBurst` card has exactly one marked ability and no card has two. That is what "no copy of the clause"
actually means in this engine.

**G3-A3 — declining is a real answer, and leaves nothing behind.** For each of the four cards, driven both
ways. Declining is asserted against the *complete settled state* with only the expected deck/damage transition
removed — plus explicitly: `pending` is null, the agenda is empty, combat advanced, and no ability-lifecycle
event fired. "The board looks the same" would pass with a stranded prompt or a queued frame.

**G3-A4 — opt in, then no legal target.** Odin's clause with no Forward on the board must reach
`abilityNoLegalTarget` **through the new command**, tied to the same damage card and ability id, and settle.
Asserting the no-target path alone would pass on behaviour that already works from a normal cast.

**G3-A5 — the seventh damage suppresses the offer, proven against a fixture that otherwise offers.** The same
fixture must first be shown to offer and resolve *below* lethal; only then does the seventh copy assert no
offer, no use, no ability event and no pending. Asserted the other way round, A5 passes on today's
completely unimplemented code.

**G3-A6 — the AI can actually choose, not merely enumerate.** `candidateCommands` returns both answers;
`isForcedDecision` treats `chooseExBurst` as forced (its fallback only forces unknown pendings when there is
resolution work, and a burst with no queued trigger would otherwise be evaluated half-resolved); ISMCTS gets a
distinct stable `actionKey` per answer, a round-tripping decoder, and a `pendingDigest` naming the card and
ability. Both answers are keyed **world-independently** — a boolean must not be keyed by an unrevealed deck
identity. And a constructed position for each answer where the agent actually picks it.

**G3-A7 — a gate that can fail.** `unimplementedAbilities: 0` is vacuous here: it counts `unimplementedAbility`
events, these four clauses already count as implemented, and the gate passes today while every burst is
skipped. Replaced with explicit offered / used / declined / lethal-suppressed counters in `selfplay`, and
`exBurstSkipped === 0`. The existing gates still have to hold as regressions — 200/200 completed, full suite,
browser suite — they are simply not evidence *for* this rung.

**G3-A8 — the batching exclusion is asserted, not assumed.** A test establishes that no engine path deals more
than one point of player damage in a single resolution, so at most one EX Burst is ever pending. If that ever
becomes false, this test fails and CR §6.5.2.1 batching has to be built. Carrying an `MVP0-SIMPLIFICATION`
marker would be wrong here: nothing is being simplified away while the case cannot arise.
