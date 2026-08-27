# Rung C3 — Activated abilities: giving the player something to *do* with the board

> Revision 2 (2026-08-27), after a Codex plan-review that found five blockers, three of which were my own
> errors and one of which was a flat self-contradiction. The review is
> `docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md`. This rung replaced a
> planned deck-knowledge rung; that reasoning is at the top of `2026-08-27-rung-c6-deck-knowledge.md`, and the
> review independently confirmed the reordering was right.

## Context

Ten of the starter deck's 28 printed clauses work. Every one is **triggered** — something happens to a card
and the ability fires. The player never chooses to use an ability, because there is no way to: the `Command`
union has casts, attacks, blocks and the answer commands, and **nothing for activating an ability**
(`packages/engine/src/commands.ts:5`).

That gap blocks eight clauses. This rung takes **six** of them:

| Card | Clause | Cost | Source zone |
|---|---|---|---|
| Red Mage (1-121C) | Choose 1 Forward, it gains Haste | `[Lightning]` + `[Dull]` | field |
| Noel (16-092C) | Dull all Forwards opponent controls | `[Dull]` + put into Break Zone | field |
| Miner (20-074C) | Draw 1 | `[2]` + `[Dull]` + put into Break Zone | field |
| Undead Princess (19-052C) | Choose 1 Forward, +4000 | put into Break Zone | field |
| Geomancer (18-064C) | Draw 1 | `[Earth]` + discard itself | **hand** |
| Red Mage (18-069C) | Draw 1 | `[Lightning]` + discard itself | **hand** |

**This is the rung a human notices.** Ten triggered clauses make a board that happens to you; activated
abilities are the first thing that makes it a board you *use*.

The two hand-sourced Backups are in on the review's recommendation, and they earn their place: they force
`sourceZone` to be real rather than speculative, and they cost almost nothing extra once Miner has already
forced a `draw` effect and generalized CP. Left for C4: Undead Princess's second clause (needs a
removed-from-game zone) and Sphene's `[0]` (needs field→Break-Zone history and once-per-turn state).

**Correction to revision 1's framing.** It said "eight clauses behind one primitive", which undersold this.
Activation also needs target declaration, generalized costs, a draw effect, command codecs, AI enumeration and
a timing policy. The reordering is still right — the review agreed, because none of that entangles
determinisation with private information the way rung C6 does — but this is a substrate, not a one-liner.

## Decisions

| # | Decision | Ruling (and why) |
|---|---|---|
| C3-1 | **`activateAbility { player, source, abilityId, payment, targets }`** | Targets are declared **with** the activation, not discovered after the frame starts. `resolve.ts:235` treats an empty target set as a successful no-op, which is right for a triggered ability and wrong here: it would let Undead Princess pay her whole cost — breaking herself — for nothing. Activation is one transaction: legal targets, or not legal at all. |
| C3-2 | **`abilityId`, never an array index** | `Ability.id` already exists as a stable per-clause identity (`abilities.ts:121`). Indices would break precisely because of this rung's own ordering: Miner's action is its *second* printed clause but would sit at index 0 while its ETB is deferred to C6, then silently shift when C6 lands. |
| C3-3 | **`sourceZone: 'field' \| 'hand' \| 'breakZone'` is first-class now** | An activation precondition, not a cost. Inferring "on the field" from the presence of a `[Dull]` cost would need replacing immediately for the two hand Backups and again for C4's Break-Zone clause. |
| C3-4 | **Generalize the CP machinery, keep `Payment`** | `Payment` describes CP *sources* and is fine. What cannot be reused is the cast validator, which derives amount and elements from the card definition (`cast.ts:33`): Red Mage's ability costs `[Lightning]` = 1 Lightning while the card's printed cost is 2, and Miner's costs a generic `[2]` while the card is a 3. So: `{ amount, requiredElements: Element[], excludedSources: CardId[] }`, shared by casting, enumeration, `preferredPayment` and activation. `[0]` admits only the empty payment. |
| C3-5 | **Exclusions apply to dulled Backups too, not only discards** | `generateCp` excludes `casting` in the discard loop and **not** in the Backup loop (`cp.ts:24`–`cp.ts:34`). Left alone, Red Mage would dull *itself* to make its own Lightning CP and pay its `[Dull]` cost with the same action — one dull, two costs. |
| C3-6 | **`[Dull]` restrictions gate on the cost containing `[Dull]`** | Active status, entered-this-turn and the Haste exception apply only when the cost has the dull icon. Undead Princess's cost is *only* "put into the Break Zone", so she may activate **while dull and on the turn she enters** — revision 1's acceptance criterion said otherwise and was simply wrong. |
| C3-7 | **A self-break cost is not a break, but it IS a zone movement** | Revision 1 contradicted itself here. The implemented observer's printed text is "is **put from the field into the Break Zone**" (`cards/src/abilities.ts:220`) and `watches` ignores the transition reason by design, so paying this cost **must** trigger Lightning. What must not be emitted is a `broken` / `brokenByAbility` / `breakPrevented` event, and `cannotBeBroken` must not prevent the payment. Add `ZoneTransition.reason: 'cost'` so a future "when broken" observer can filter, and fix `describeTriggerCause`, which currently narrates every zone move as "was broken" (`apps/web/src/game/commands.ts:60`). |
| C3-8 | **Cost triggers are enqueued BEFORE the action frame** | `drainResolution` is FIFO (`resolve.ts:413`). An ability whose cost breaks its own source generates watcher triggers that must resolve *above* the action they paid for. "Pay, then push the frame" is only correct if the cost's transitions are handed to `enqueueZoneChangeTriggers` first. |
| C3-9 | **Add `{ kind: 'draw'; count }` and move `drawCards` somewhere neutral** | Revision 1 claimed all four effect halves needed no new machinery. False: `Effect` has no draw, and the only draw primitive lives in `phases.ts`, which `resolve.ts` cannot import because `phases.ts` already imports `resolve.ts` (`phases.ts:8`). Extract `drawCards` — empty-deck loss semantics (§3.1.2) intact — into a module both can import. |
| C3-10 | **The AI must be given activations explicitly** | Revision 1 said the AI gets them "for free" from `legalCommands`. It does not: `candidateCommands` hand-builds casts and `pass` in the Main Phases (`candidates.ts:295`) and the search enumerates *that* list. Activation needs its own emission (one preferred-payment activation per `(source, abilityId, target set)`), plus `ActionKey` encode/decode and the synthetic-id guard. |
| C3-11 | **MVP0-SIMPLIFICATION: turn player, Main Phase 1 or 2 only — and this one costs something** | Revision 1 claimed this was "not a further loss of fidelity". Wrong: the CR allows action abilities in the Attack Phase too, and the engine even has an unblocked turn-player action point at attack declaration (`legal.ts:68`). Noel and Red Mage still work from Main 1 before attacking, but **Undead Princess stops being a combat trick** — she cannot pump after blockers are declared. Stated plainly as "action abilities are sorcery-speed", marked at the site, and listed in the README's deviations. |
| C3-12 | Not in scope | Undead Princess's second clause and the removed-from-game zone; Sphene; EX Burst; static abilities (Class Tenth Moogle's CP, Odin's cost reduction, Sphene's protection); deck knowledge (C6). |

## Rules citations

Revision 1's citations were wrong (§1.3.3 and §9.3.2 name unrelated rules). Per the plan review the correct
ones are: **§§11.6.3–11.6.11** activation procedure, **§11.6.10** cost atomicity, **§11.6.5** targeting at
activation, **§11.5.4** source independence, **§11.6.2.2** the `[Dull]` control-since-start / Haste rule,
**§15.1.1.3.2** putting into the Break Zone as a cost is not breaking, **§11.2.2.3** CP over-*generation*
(not overpayment).

**These are adopted from the review and are not independently verified here** — the Square Enix CDN that hosts
the rules PDF IP-blocks this machine. They go into code comments as citations, so if any is wrong it will
propagate; whoever can open the PDF should check them once.

## What could go wrong, in the order it will bite

- **The AI will misuse these, and the win-rate gate will not notice.** Two concrete, already-identifiable
  errors rather than a vague worry: Backup status contributes nothing to material (`evaluate.ts:95`), so
  dulling a CP Backup looks free; and losing an active 2000-power Undead Princess scores exactly the same as
  giving another Forward +4000, with greedy keeping the earlier command on a tie (`greedy.ts:95`) — so it can
  trade a body for a pump it never uses. Needs a small active-Backup/ready-CP term and a discount on
  `powerBonus` that cannot affect combat before it expires, plus explicit "pass over the useless activation"
  tests.
- **Cost/effect atomicity.** Four of the six costs remove or dull the source; it is the normal case here, not
  the exotic one. Any implementation that reads the source card while resolving the effect works for Red Mage
  and breaks for Noel.
- **The UI will show one button per payment.** `preferredChoices` collapses payment variants for casts only
  (`apps/web/src/game/commands.ts:372`); Red Mage and Miner would otherwise expose every enumerated payment
  as a separate choice. Casts and activations both need to be treated as "payable commands".

## Acceptance criteria

- **C3-A1 (reachability)** Every one of the six clauses is reachable from `legalCommands` **and** emitted by
  `candidateCommands`, in a real driven game — the second half is the one revision 1 missed. Both agents must
  be shown actually choosing an activation at least once.
- **C3-A2 (atomicity)** Noel's effect dulls every opponent Forward even though its cost has already put Noel
  into the Break Zone; Undead Princess's +4000 lands on a chosen Forward after she has left the field.
- **C3-A3 (cost triggers first)** Paying Noel's self-break cost with an opponent Lightning in play resolves
  **Lightning's triggered Haste grant before Noel's dull-all**, per the FIFO agenda.
- **C3-A4 (cost is not a break)** A source with `cannotBeBroken` can still pay a self-break cost; the
  transition carries `reason: 'cost'`; Lightning's "put from the field into the Break Zone" observer **does**
  fire; and no `broken` / `brokenByAbility` / `breakPrevented` event is emitted. All four asserted.
- **C3-A5 (legality, as constructed unit tests, not a sweep)** Separately: `[Dull]` costs are illegal from a
  dulled source and from one that entered this turn without Haste, but **legal with Haste**; Undead Princess
  is legal **while dulled and freshly played**; a CP payment may not use the source as either a dulled Backup
  or a discard; an activation with no legal target is absent from `legalCommands` entirely; and activation is
  illegal outside the turn player's Main Phases. Rare positions (fresh Noel with Haste, no legal non-source
  target) will not turn up reliably in a seeded sweep, so they are constructed.
- **C3-A6 (`ABILITY_CLAUSES` must NOT change)** It counts *printed* clauses, implemented or not
  (`cards/src/abilities.ts:21`); revision 1 asked for it to drop by four, which would have falsely hidden
  Miner's and Undead Princess's still-missing clauses. Assert instead that the implemented AST count rises by
  six and the derived missing-warning count falls by six.
- **C3-A7 (browser)** Activations appear as ordinary choices on their source card, labelled with the printed
  cost, with payment variants collapsed to one button; narration says the ability was **activated**, not
  "triggered" (`useGame.ts:77`); a human can use all six in a driven game.
- **C3-A8** `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm --filter @fftcg/web build` green; fuzzer 200/200
  zero failures; ISMCTS still beats greedy over a mirrored run — **as a regression guard only**. Six clauses
  are far below the noise floor of a 120-game run, and no strength improvement will be claimed from it.

## Staging

The dangerous seam is not any individual AST; it is the transaction from declaration through simultaneous
costs, cost triggers and queued resolution.

1. **Substrate, no cards.** Action metadata (`sourceZone`, cost shape, `abilityId`), the command and its
   codecs, target preflight, generalized CP with exclusions, atomic cost transitions with `reason: 'cost'`,
   agenda ordering, the `draw` effect and the `drawCards` extraction, AI enumeration, UI payment collapsing.
2. **The six clauses**, plus the adversarial tests above.
