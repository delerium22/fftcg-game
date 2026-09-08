# Rules conformance audit — the engine against Comprehensive Rules 3.3, and the ladder from here

> **STATUS: written 2026-09-08 from a full read of CR 3.3 (the PDF at the pinned URL, `pdftotext`) against the
> source.** The user asked, in one line, to "loop to really build out and test that the app functions and works
> how it's supposed to, i.e. how game rules are applied, and that they are applied in a way that is scalable as
> we add more cards and effects", and to "have a look at the full rules and make sure the game accommodates
> them". This document is the audit; the ladder at the end is the program it implies. Design calls are mine
> (user away) and are recorded so they can be overturned rather than rediscovered.

## Verdict in three sentences

The engine implements the turn structure, combat, CP, damage, EX Burst, zones and the pool's 27 printed
clauses correctly for the rules it claims, and every deviation is marked in the source (26 markers). **The one
structural gap is §11.1 and §7.12: there is no stack and no priority passing**, and roughly seven of the
markers are consequences of that single absence (Summons and action abilities only in a Main Phase, no
response window, the Damage Resolution Step auto-advancing, fixed trigger order). The ability system itself
— a data AST on `CardDef`, hand-written per clause — scales to more cards without structural change; what
does **not** scale is the target filter vocabulary (no job, category, name or power axes), the pre-enumeration
of target sets and payments in `legalCommands`, and the absence of any continuous-effect layer beyond fields
stamped directly on `FieldCard`.

## Section-by-section

Status: **ok** = implemented as written and tested; **partial** = implemented with a marked deviation;
**absent** = not implemented; **n/a** = the pool cannot reach it and nothing is simplified (the case is
unreachable, not skipped).

| CR § | Rule | Status | Where / what deviates |
|---|---|---|---|
| 2.1 | Concede at any time | ok (engine) / partial (browser) | `legalCommands` lists concede everywhere; G6 removed the button at card-only prompts (`PromptStrip.tsx:51`). |
| 3.1–3.3 | Loss on 7 damage, deck-out, damage on empty deck; draw | ok | `rules.ts`, `game-end-cause.test.ts`. |
| 5.2.1 | Elements, multi-element, Light/Dark CP rules | ok | `cp.ts:13` (Light/Dark exempt), C6 flexible sources. Light/Dark discard ban `cp.ts:57`. |
| 5.2.2.1 | Generic icon / same-name limit | partial | Cast is refused outright (`cast.ts:23`); §12.4.6 would instead break both copies. Ability entry (Hugh Yurg) bypasses it (`resolve.ts:862`). |
| 6.2 | Owner vs controller | partial | Nothing changes control; narration keys on owner (`commands.ts:56`). Becomes wrong the day a control-changing card is added. |
| 6.5 | Damage resolution, EX Burst order | ok | G3; multiple EX Bursts resolve in dealt order. |
| 6.7 / 6.8 | Counters, Crystals | absent | Nothing in the pool. `FieldCard` has no counter field. |
| 7.4 | Card is new in the destination zone | ok | `FieldCard` rebuilt on entry; `granted`/`powerBonus` reset. |
| 7.7.3 / 12.4.6 | Same-name rule process | absent | See 5.2.2.1. |
| 7.7.4 / 12.4.8 | Five backups, 6th to Break Zone | partial | Cast refused (`cast.ts:20`); ability entry unchecked. |
| 7.7.5 / 12.4.7 | One Light/Dark | absent | Pool has none. |
| 7.12 | **The stack** | **absent** | `state.ts:140`, `resolve.ts:23`. Root cause of the rows marked ★ below. |
| 7.13 | Removed from play | ok | C7. |
| 7.14 / 8.1 / 15.2.8 | LB deck, Limit Break | absent | Deliberately deferred (design spec MVP5); deck file is main deck only. |
| 8.2 | Setup, first player, mulligan | partial | Mulligan keeps hand order to the bottom (`setup.ts:74`); §8.2.1.4 lets you choose. Unobservable in a shuffled 50-card deck without deck-bottom effects. |
| 9.1 | Active Phase | ok | `phases.ts`. No Freeze (§15.2.4), so "frozen do not activate" is absent. |
| 9.2 | Draw Phase, first turn draws one | ok | `cr9-phases.test.ts`. |
| 9.3.1.5 | Characters cast only with an empty stack | ok (vacuously) | Always empty. |
| 9.3.1.6 ★ | Summons castable in Main **and Attack** Phase | partial | Main only (`cast.ts:12`). |
| 9.3.1.7 ★ | Action abilities in Main **and Attack** Phase | partial | Main only, turn player only (`activate.ts:102`). Undead Princess cannot be a combat trick. |
| 9.5 | End Phase: hand size, damage removal, until-end-of-turn expiry, loop back on new triggers | ok / partial | Hand size and expiry ok. §9.5.1.4's "new triggers → priority again" is not modelled (no priority). |
| 10.1.1 | Attack Preparation Step triggers | ok | C5 (`attackPhaseBegins`). |
| 10.1.2 | Declaration: active, Haste/continuous control, Brave, party same element, attack cost | ok | `attack.ts:35,61`. No card prints an attack cost; `n/a`. |
| 10.1.3 | Block: active, restrictions, cost to block | ok | No restrictions or costs in the pool. |
| 10.1.4 ★ | Damage resolution, party split, **priority after damage** | partial | Damage ok, party split ok (`party-damage.test.ts`); §10.1.4.4 window auto-advances (`attack.ts:94`). |
| 11.1 ★ | **Priority** | absent | Always the turn player. `applyPass` advances the phase; it is not a priority pass. |
| 11.2 | Paying CP (exact amount, one excess per element by discard, wasted CP, Light/Dark) | ok | `cp.ts`; `legalCommands` lists minimal payments; `apply` accepts any `canPay` payment. |
| 11.3 ★ | Casting a Summon (to the stack, respondable) | partial | Resolves immediately from the Break Zone (`cast.ts:69`). |
| 11.3.3 / 11.6.5 | "Choose" needs a legal target to cast/use | ok | `activationCheck`, `castCheck` + `abilityNoLegalTarget` handling. |
| 11.4 | Casting a Character (special action, no stack) | ok | Correct even with a stack, since it never uses one. |
| 11.5.4 / 6.4.2 | Abilities on the stack are independent of their source | n/a today | With a stack, "last known information" (§11.11.4) becomes required. |
| 11.6 ★ | Action abilities: costs paid simultaneously, `[Dull]` needs continuous control unless Haste | ok / partial | Cost atomicity ok (C3); Haste gate ok (`activate.ts:55`); speed partial (see 9.3.1.7). |
| 11.7 | Special abilities (S icon, discard same name) | absent | None in the pool. |
| 11.8 ★ | Auto-abilities: trigger, go on the stack when priority is next gained, **controller orders own triggers, NAP on top** | partial | Trigger and resolve ok (C2/C8); fixed AP-first FIFO (`resolve.ts:793`); no stack. |
| 11.8.13 | Conditional auto-abilities re-check on resolution | n/a | None in the pool. |
| 11.8.14 | "You may" abilities | ok | Modelled as `chooseModes` with min 0 / `chooseTargets` min 0. |
| 11.8.17 | Delayed auto-abilities | absent | None in the pool; no AST node. |
| 11.9 | Field abilities (statics) | partial | Two shapes only (`costReduction`, `produceElement`). No general continuous-effect layer. |
| 11.10 | EX Burst | ok | G3. Not offered on lethal damage (the game is over first) — correct under §12.4.1 ordering. |
| 11.11.2 | Cancel when all targets invalid at resolution, apply to the still-valid ones | ok | `resolve.ts` re-filters candidates at resolution. |
| 11.12.4.6 | Ongoing-effect layering order | absent | Only power bonus / keywords / flags exist; no type/text/controller changes to order. |
| 11.12.5 | Replacement effects | absent | No AST node; nothing in the pool needs one. |
| 12.4.4 / 12.4.5 | Zero power / lethal damage break as rule processes | ok | `runRuleProcesses`; C11 notes one intra-frame ordering deviation (`resolve.ts:611`). |
| 13 | Infinite loops | absent | `MAX_RESOLUTION_STEPS = 512` is a safety cap, not the §13 procedure. Acceptable. |
| 14 | Illegal actions rewind | ok by construction | `apply` is pure; an illegal command throws and the old state stands. |
| 15.1.1 | Keyword actions (activate, dull, break, discard, remove, search, party) | ok | Search (`chooseFromDeck`, C9), party (C1/attack). |
| 15.2.1 Brave | | ok | `attack.ts:61`. |
| 15.2.2 Haste | | ok | `attack.ts:35`, `activate.ts:55`. |
| 15.2.3 First Strike | | absent | `attack.ts:145`. No card prints it; type exists. |
| 15.2.4 Freeze | | absent | No status beyond active/dull. |
| 15.2.5 Back Attack | | absent | Type exists, never consulted. Needs the non-turn player to have priority — i.e. the stack. |
| 15.2.6 Damage (keyword) | | absent | Nothing in the pool. |
| 15.2.7 Warp, 15.2.9 Priming, 15.2.8 Limit Break | | absent | Later sets / LB deck. |

## What scales and what does not

**Scales (keep):**
- The AST on `CardDef` as plain data. One clause = one record; per-clause coverage is counted, an inert
  clause needs a written proof, and `pool-coverage.test.ts` fails the day a card ships with a clause missing.
  Adding a card is additive.
- `Frame` as a resumable program counter with `effectAtPath` as the single walk, shared by the engine, the
  AI and the browser (E2).
- Payment as explicit data on the command, validated by `generateCp` + `canPay` (bipartite matching over
  element **sets**), so a new CP-producing static is one more `produceElement`.
- Settlement in `apply.ts` (rule processes ↔ agenda) — the right shape for a stack to slot into.

**Does not scale (the pressure points, in the order they will bite):**
1. **No stack / no priority.** Every future set adds instant-speed Summons and combat tricks; the whole
   Attack Phase interaction of the real game is missing. It also blocks Back Attack and §11.8.7 ordering.
2. **`TargetFilter` vocabulary.** No `job`, `category`, `name`, `power`/`powerAtMost`, `status`, `controller
   is opponent` axes; `CardDef` carries no job or category at all (the fetched data has both). A large
   fraction of printed text is unrepresentable until `CardDef`, `TargetFilter` and `matchesFilter` grow
   together.
3. **Pre-enumeration in `legalCommands`.** Target sets and payments are enumerated as whole commands
   (bounded today at ~C(20,2)). An "up to 4" over a large Break Zone, or an activated ability with several
   targets and several payments, multiplies. Incremental selection in the UI is now the plan (rung I2 for
   payments); the engine side needs a candidate cap or a select-then-confirm pending for target sets.
4. **No continuous-effect layer.** `powerBonus`, `granted` and `flags` are stamped on `FieldCard`; a card
   granting "+1000 to all your Forwards while on the field" has nowhere to live, and §11.12.4.6 ordering
   cannot be expressed.
5. **Owner ≡ controller everywhere.** Narration, `holderOf`, the twin-name qualifier all key on owner.

## The ladder from here

The user's two asks are ordered: the interaction work is what they described concretely, and the rules work
is the standing program. Each rung is spec → (Codex plan review where the change is architectural) → TDD →
verify by playing.

| Rung | What | Why this order |
|---|---|---|
| **I1** | **The card sheet**: click any card to enlarge it in the centre with its full text and its actions (Cast / Attack / Block / Choose / Back), Cast greyed with the reason when it cannot be cast. | Asked for explicitly. Replaces the click-commits-or-selects ambiguity F6 documented. |
| **I2** | **The crystal payment picker**: Cast opens a tray of greyed crystals; click backups to dull and hand cards to discard; crystals light; Confirm when the cost is met. | Asked for explicitly. Payment sources become subjects the player picks, inverting E11's "chosen for you". |
| **J0** | **Rules-citation index**: commit `docs/rules/cr-3.3-sections.txt` (section numbers and headings only, not the text) and a test that every `§x.y.z` cited in source and specs exists. | Citations have drifted once already (C3 review); cheap, catches the next one. |
| **J1** | **The stack and priority** (§7.12, §11.1, §11.3, §11.8.7, §11.11): `priority` becomes a real holder with consecutive-pass tracking; Summons and action abilities go on a stack and resolve when both pass; auto-abilities are placed when priority is next gained, controller-ordered, NAP on top; Characters need an empty stack; response windows in Main and Attack Phase steps (§10.1.1.2, 10.1.2.6, 10.1.3.6, 10.1.4.4). | The root deviation. Architectural: touches `state`, `legal`, `apply`, `resolve`, the ISMCTS codec, `determinise`, the AI's move model (it must decide whether to respond), and the browser's "whose turn" model. Needs its own spec and a Codex plan review. |
| **J2** | ~~Summons and action abilities at instant speed in the Attack Phase (§9.3.1.6/7)~~ — built inside J1 (slices 4–5); what remains is Back Attack (§15.2.5). | Follows directly from J1. |
| **J3** | First Strike (§15.2.3) with its priority window, and Freeze (§15.2.4) as a status. | Small once J1 exists; both are common in later sets. |
| **J4** | ~~Same-name / Light-Dark / sixth-backup as rule processes (§12.4.6–8), ability entry included.~~ Built 2026-09-08 ([spec](2026-09-08-rung-j4-field-limit-rule-processes.md)). | Correctness for search effects; small. |
| **J5** | ~~`CardDef.job`/`category` from the fetched data; `TargetFilter` grows `job`, `category`, `name`, `power`, `controller`; `matchesFilter` in lockstep; a pool test that every filter axis is exercised.~~ Built 2026-09-08 ([spec](2026-09-08-rung-j5-target-filter-vocabulary.md)): job, category, name, keyword, minPower/maxPower, status, grantedKeyword; `FILTER_AXES` is the lockstep guard. `controller` stays on `TargetSpec`. | The scaling item for "more cards". |
| **J6** | Continuous effects: a layer computed by `effectivePower`/`keywordsOf` from field abilities in play, with §11.12.4.6 ordering; delayed auto-abilities; replacement effects. | The scaling item for "more effect types". Architectural. |
| **J7** | `legalCommands` combinatorics: candidate cap plus a select-then-confirm pending for target sets, mirroring I2's incremental model. | Needed before the pool grows past ~40 cards. |
| **J8** | Limit Break deck (§7.14, §15.2.8); then Vol. 1 pool. | Last; the design spec's MVP5. |

Not on the ladder, deliberately: Monsters (§5.2.3.1.1, no pool card), Warp/Priming/Crystals/Counters
(later sets), infinite-loop procedure (§13), three-player games (§1).
