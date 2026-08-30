# Rung G3 — EX Burst, the thing that happens when you take damage

> **STATUS: SPEC. Nothing built.**

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

## Design

**Mark the clause, do not infer it.** Add `exBurst: true` to the four `Ability` objects. The tag is currently
discoverable only by the string `'EX BURST'` at the front of `text`, and selecting behaviour by prose is how a
card gets silently mis-triggered when someone rewords a comment. An explicit flag also lets the coverage check
assert that every `def.exBurst` card has exactly one `exBurst` ability, and that no card has two.

**It is optional (§11.10: "you may use it").** So the damaged player gets a decision before the ability
resolves. Declining must be a first-class answer, not a timeout: Odin's clause is `min: 1`, so once it starts
resolving there is no way back out of it.

**The card stays in the damage zone.** It is damage that happened to have an ability, not a card being cast.
Nothing about the damage itself changes — the deck still loses its top card, the damage still counts toward
seven, and `dealPlayerDamage`'s empty-deck loss (§3.1.3) still takes precedence.

## Acceptance, predeclared

**G3-A1 — the before-figure is recorded and then goes to zero.** 43 of 190 damage events over 20 games
revealed an EX Burst and skipped it. After the rung, `exBurstSkipped` is never emitted in that corpus, and the
count of EX Bursts *offered* is the same 43. A rung that fires fewer than it skipped has lost some.

**G3-A2 — the ability that fires is the ability the card already has.** Asserted by identity, not by
behaviour: the resolution that runs on an EX Burst is built from the same `Ability` object the card uses on a
normal cast. This is what stops the clause being copied and left to drift.

**G3-A3 — declining is a real answer.** For each of the four cards, a test drives the decision both ways: used,
and declined. Declining leaves the board exactly as it was apart from the damage itself — asserted against a
snapshot taken before the EX Burst was offered, not by eyeballing a few fields.

**G3-A4 — the damage lands either way.** The revealed card is in the damage zone, the deck is one shorter, and
the damage counts toward seven, whether the burst is used, declined, or has no legal target. Odin's clause with
no Forward on the board must not strand the game waiting for a target that cannot exist —
`abilityNoLegalTarget` already covers that path and must be reached here too.

**G3-A5 — the seventh damage still ends the game before anything resolves.** An EX Burst revealed as the
killing damage does not get to fire: the game is over. Asserted directly, because "the rung that made the AI
lose a won game" is the expensive version of finding this later.

**G3-A6 — the AI decides rather than defaults.** `candidates.ts` must offer both answers, so the search can
weigh them. An AI that always declines would satisfy A1's "offered" count and play strictly worse than before.

**G3-A7 — the existing gates hold.** `selfplay --games 200 --seed 1` completes 200/200 with 0 unimplemented
abilities, and the full suite stays green.
