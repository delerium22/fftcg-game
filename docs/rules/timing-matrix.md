# Timing matrix — CR 3.3 chapters 9–12 and the combat/keyword parts of 15, mapped to tests

Rung J9 (spec `docs/superpowers/specs/2026-09-16-rung-j9-timing-matrix.md`). One row per subsection of the
section index for chapters 9, 10, 11 (11.1, 11.3, 11.4, 11.6, 11.7, 11.8, 11.10, 11.11), 12, and 15.1.1.9,
15.2.1–15.2.5, 15.2.8. Checked by `packages/engine/test/timing-matrix.test.ts`.

Status: `heading` (a title with sub-rows), `tested` (cites `pkg/file#fragment` refs), `simplified` (names the
`packages/*/src` file whose `MVP0-SIMPLIFICATION` marker cites the section, optionally plus refs for what IS tested),
`n/a` (unreachable with the pool, with the reason). The `rule` column paraphrases; the rules text is Square Enix's.
The referee checks that every citation exists; that a cited test tests its ROW is the author's word, reviewed.

| § | rule | status | tests |
|---|---|---|---|
| 9 | Game Phases | heading |  |
| 9.1 | Active Phase | heading |  |
| 9.1.1 | The turn player's Characters activate, in the order below | tested | engine/cr9-phases#§9.1 active phase |
| 9.1.1.1 | The turn player activates all their dull cards; a special action, no stack | tested | engine/cr9-phases#activates all of the turn player |
| 9.1.1.2 | Nobody holds priority in the Active Phase; triggers wait for the next priority grant | tested | engine/timing-l1-priority#§9.1.1.2 |
| 9.2 | Draw Phase | heading |  |
| 9.2.1 | The turn player draws, in the order below | tested | engine/cr9-phases#draws 2 |
| 9.2.1.1 | Draws two; a special action | tested | engine/cr9-phases#draws 2 |
| 9.2.1.2 | Nobody holds priority in the Draw Phase | tested | engine/timing-l1-priority#§9.2.1.2 |
| 9.2.1.3 | The first player draws one on their first turn | tested | engine/cr9-phases#§9.2.1.3 |
| 9.3 | Main Phase | heading |  |
| 9.3.1 | Actions in the order below | heading |  |
| 9.3.1.1 | Main Phase 1 precedes the Attack Phase, Main Phase 2 follows it; extra Main Phases are Main Phase 2 | tested | engine/cr9-phases#main1 → attack declaration → main2 |
| 9.3.1.2 | The Main Phase ends when the stack is empty and both players forfeit | tested | engine/cr9-phases#J1-A1 |
| 9.3.1.3 | "At the beginning of the Main Phase" triggers, and pending triggers, go on the stack | n/a | no pool card prints it and the AST has no such trigger kind |
| 9.3.1.4 | The turn player gains priority | tested | engine/cr9-phases#the first pass hands priority to the opponent |
| 9.3.1.5 | Characters are cast by the turn player with priority and an empty stack; a special action | tested | engine/cr11-stack#J1-A5 |
| 9.3.1.6 | Summons need priority; Main and Attack Phase only | tested | engine/cr11.4-cast#§9.3.1.6 |
| 9.3.1.7 | Action and special abilities need priority; Main and Attack Phase only | tested | engine/activated-abilities#§9.3.1.7 |
| 9.4 | Attack Phase | heading |  |
| 9.4.1 | The turn player attacks with Forwards; see chapter 10 | heading |  |
| 9.5 | End Phase | heading |  |
| 9.5.1 | Processes at the end of the turn, below | heading |  |
| 9.5.1.1 | "Beginning of the End Phase" / "end of the turn" triggers go on the stack; the turn player gains priority; no Summons or action abilities | simplified | packages/engine/src/phases.ts |
| 9.5.1.2 | Discard down to the hand size; a special action | tested | engine/cr9-phases#§9.5.1.2; cards/scenarios/end-phase#L3 end-phase |
| 9.5.1.3 | Then, simultaneously: | heading |  |
| 9.5.1.3.1 | All damage on field cards is removed | tested | engine/cr9-phases#§9.5.1.3; cards/scenarios/end-phase#L3 end-phase |
| 9.5.1.3.2 | "Until the end of the turn" effects stop | tested | engine/abilities-engine#§9.5.1.3.2; engine/timing-l2-compositions#§9.5.1.3.2 |
| 9.5.1.4 | Then rule processes and waiting triggers; the turn player gains priority; after both forfeit, back to 9.5.1.3.1 | simplified | packages/engine/src/phases.ts |
| 9.5.1.5 | Nothing further: a new turn for the other player | tested | engine/cr9-phases#main1 → attack declaration → main2; cards/scenarios/end-phase#L3 end-phase |
| 10 | Attack Phase | heading |  |
| 10.1 | Carried out as follows | heading |  |
| 10.1.1 | Attack Preparation Step | heading |  |
| 10.1.1.1 | "Beginning of the Attack Phase" triggers go on the stack | tested | cards/abilities#At the beginning of the Attack Phase; cards/scenarios/cloud-turn#L3 cloud-turn |
| 10.1.1.2 | The turn player gains priority; either player may cast a Summon or use an ability | tested | engine/cr11-stack#the non-turn player may activate in the Attack Preparation window |
| 10.1.2 | Attack Declaration Step | heading |  |
| 10.1.2.1 | The turn player declares one Forward, or a same-element party | tested | engine/cr10-attack#§10.1.2.1 |
| 10.1.2.1.1 | Attackers must be active, and have Haste or have been controlled since the turn began | tested | engine/cr10-attack#a forward controlled since the start of the turn |
| 10.1.2.1.2 | And legally able: not attacked this turn, not prevented | tested | engine/cr10-attack#dull forwards and forwards that already attacked |
| 10.1.2.1.3 | Forwards that must attack keep the phase open | n/a | no pool card compels an attack |
| 10.1.2.2 | Legal attackers dull; Brave ones do not | tested | engine/cr10-attack#§10.1.2.2 |
| 10.1.2.3 | Attack costs are locked at declaration | n/a | no pool card has an attack cost |
| 10.1.2.4 | The Forward is now attacking | tested | engine/cr10-attack#§10.1.2.2 |
| 10.1.2.5 | Triggers caused by the attacking Forward go on the stack | tested | engine/timing-l1-attack-trigger#§10.1.2.5 |
| 10.1.2.6 | The turn player gains priority (the `declared` window) | tested | engine/cr10-attack-windows#declaring an attack opens the; cards/scenarios/ramuh-in-a-window#L3 ramuh-in-a-window |
| 10.1.2.7 | No attackers: skip the block and damage steps | tested | engine/cr9-phases#main1 → attack declaration → main2 |
| 10.1.3 | Block Declaration Step | heading |  |
| 10.1.3.1 | The defender may block with one Forward, or not | tested | engine/cr10-attack#only the defender may block |
| 10.1.3.1.1 | The blocker must be active | tested | engine/cr10-attack#only the defender may block |
| 10.1.3.1.2 | Block limitations | n/a | none in the pool |
| 10.1.3.1.3 | Compulsory blocks and block costs | n/a | none in the pool |
| 10.1.3.2 | If still controlled by the defender, it is blocking | tested | engine/cr10-attack-windows#declaring a block opens the |
| 10.1.3.2.1 | Attacker and blocker are in battle; one leaving ends it | tested | engine/cr10-attack-windows#§10.1.3.3 |
| 10.1.3.3 | A blocker or attacker removed during the step takes no damage | tested | engine/cr10-attack-windows#§10.1.3.3 |
| 10.1.3.4 | A party is blocked as one Character | tested | engine/cr10-attack#§10.1.3.4 |
| 10.1.3.5 | Triggers caused by the block go on the stack | n/a | no pool card prints "when blocks"; the AST has no such trigger |
| 10.1.3.6 | The turn player gains priority (the `blocked` window) | tested | engine/cr10-attack-windows#J1-A3; cards/scenarios/combat-tricks#L3 combat-tricks |
| 10.1.4 | Damage Resolution Step | heading |  |
| 10.1.4.1 | Unblocked: one point of damage to the opponent | tested | engine/cr10-attack#§10.1.4.1 |
| 10.1.4.2 | Blocked: each deals its power to the other as battle damage | tested | engine/cr10-attack#§10.1.4.2; cards/scenarios/dragoon-blocks#L3 dragoon-blocks |
| 10.1.4.2.1 | Against a party, the blocker splits its damage in multiples of 1000 | tested | engine/cr10-attack#§10.1.4.2.1; engine/party-damage#C2-A6 |
| 10.1.4.3 | Damage triggers go on the stack | tested | engine/observer-triggers#C2-A4; engine/party-damage#C2-A8; cards/scenarios/combat-tricks#L3 combat-tricks |
| 10.1.4.4 | The turn player gains priority (the `damage` window) | tested | engine/cr10-attack-windows#declaring a block opens the; engine/timing-l2-compositions#L2-d |
| 10.1.4.5 | The party disbands | tested | engine/cr10-attack#an unblocked party |
| 10.1.4.6 | Another attack, or Main Phase 2 | tested | engine/timing-l1-priority#§10.1.4.6 |
| 11 | Casting Cards and Using Abilities | heading |  |
| 11.1 | Priority | heading |  |
| 11.1.1 | The priority holder may cast or use | tested | engine/cr11.4-cast#§9.3.1.6; engine/activated-abilities#§9.3.1.7 |
| 11.1.2 | The turn player gains priority once start-of-step triggers are placed | tested | cards/abilities#At the beginning of the Attack Phase |
| 11.1.3 | Rule processes resolve before priority, repeated until none | tested | engine/cr12-field-limits#runs it: an; engine/observer-triggers#C2-A5 |
| 11.1.4 | On gaining priority, triggers go on the stack, repeated until none | tested | engine/cr11-stack#J1-A4; engine/observer-triggers#C2-A9; engine/timing-l2-compositions#L2-b |
| 11.1.5 | After a Summon or ability resolves, the turn player gains priority | tested | engine/timing-l1-priority#§11.1.5; engine/timing-l2-compositions#L2-a |
| 11.1.6 | Forfeit: the opponent gains priority | tested | engine/cr9-phases#J1-A1 |
| 11.1.7 | Both forfeit: the top of the stack resolves, or the step ends | tested | engine/cr9-phases#J1-A1; engine/cr11-stack#J1-A2 |
| 11.3 | Casting a Summon | heading |  |
| 11.3.1 | Hand to stack with the cost paid; an illegal cast rewinds | tested | engine/cr11-stack#J1-A2; engine/legal-apply#invariant |
| 11.3.2 | Declared, revealed, moved to the top of the stack under the caster | tested | engine/cr11-stack#J1-A2 |
| 11.3.3 | "Choose" needs a legal target or it cannot be cast; "select" is not "choose" | tested | engine/cr11-stack#§11.3.3; engine/selects#a Summon whose only node is a select |
| 11.3.4 | Modal Summons declare their mode | tested | cards/abilities#20-103H Ramuh; cards/scenarios/ramuh-in-a-window#L3 ramuh-in-a-window |
| 11.3.4.1 | The number of selectable effects is fixed at declaration | n/a | no pool Summon varies its mode count |
| 11.3.5 | A cost that references other information is fixed when referenced (Odin reads the damage count); alternative and variable costs | tested | cards/abilities#13-072R Odin — "If you have received 5 points |
| 11.3.6 | Effects applying differently to several cards or players | n/a | none in the pool |
| 11.3.7 | The cost is locked | n/a | nothing in the pool changes a cost between declaration and payment; the engine computes and pays in one apply |
| 11.3.7.1 | Paid all at once | tested | engine/cr11.2-cp#§11.2.2 paying a cost |
| 11.3.8 | The cast completes and the caster regains priority (no pool card triggers on a cast) | tested | engine/timing-l1-priority#§11.3.8 |
| 11.3.9 | All targets ineligible at resolution: cancelled | tested | engine/cr11-stack#J1-A7 |
| 11.3.10 | "Power becomes N" sets the base power | n/a | none in the pool |
| 11.3.11 | A Summon cast by an effect is cast right after it | n/a | none in the pool |
| 11.4 | Casting a Character | heading |  |
| 11.4.1 | With priority, in a Main Phase, with an empty stack; a special action, uninterruptible | tested | engine/cr11-stack#J1-A5 |
| 11.4.1.1 | Cast by an effect: right after it, no stack | n/a | Hugh Yurg PLAYS a card onto the field, which is not a cast; no pool card casts one |
| 11.4.2 | Declared and revealed | tested | engine/cr11.4-cast#§11.4 casting a Character |
| 11.4.3 | Modal Characters | n/a | none in the pool |
| 11.4.4 | Cost references, alternative and variable costs | n/a | none in the pool |
| 11.4.5 | Effects applying differently | n/a | none in the pool |
| 11.4.6 | The cost is locked | n/a | nothing in the pool changes a cost between declaration and payment; the engine computes and pays in one apply |
| 11.4.6.1 | Payment per §11.2 | tested | engine/cr11.4-cast#rejects insufficient or wrong-element payment |
| 11.4.7 | Enters the field; its ETB triggers go on the stack; the turn player gains priority | tested | engine/cr11-stack#J1-A4; cards/scenarios/cloud-turn#L3 cloud-turn |
| 11.6 | Action Abilities | heading |  |
| 11.6.1 | An effect for a cost | tested | engine/activated-abilities#C3-A2 |
| 11.6.2 | Written "(cost): (effect)" | tested | engine/activated-abilities#renders the printed cost |
| 11.6.2.1 | The text before the colon is the cost | tested | engine/activated-abilities#renders the printed cost |
| 11.6.2.2 | Dull-icon costs need control since the turn began, or Haste | tested | engine/activated-abilities#§11.6.2.2 |
| 11.6.2.3 | Dull/break costs use your own Characters | tested | engine/activated-abilities#a [Dull] cost needs an ACTIVE source |
| 11.6.2.4 | Remove/return costs need a Character you could otherwise remove or return | tested | cards/abilities#19-052C Undead Princess — "Remove |
| 11.6.3 | Put on the stack and the cost paid; a failed activation rewinds | simplified | packages/engine/src/activate.ts; engine/cr10-attack-windows#J1-A3; engine/activated-abilities#is ILLEGAL |
| 11.6.4 | Declared, revealed from a hidden zone, on top of the stack under the activator | simplified | packages/engine/src/activate.ts; engine/activated-abilities#honours sourceZone; engine/cr10-attack-windows#J1-A3 |
| 11.6.5 | "Choose" needs a legal target | tested | engine/activated-abilities#is ILLEGAL |
| 11.6.6 | Modal action abilities declare the mode | n/a | none in the pool |
| 11.6.6.1 | The mode count is fixed | n/a | none in the pool |
| 11.6.7 | Cost references, alternative and variable costs | n/a | none in the pool |
| 11.6.8 | Effects applying differently | n/a | none in the pool |
| 11.6.9 | The cost is locked | n/a | nothing in the pool changes a cost between declaration and payment; the engine computes and pays in one apply |
| 11.6.10 | Paid all at once | tested | engine/activated-abilities#C3-A2 |
| 11.6.11 | Activated; activation-triggers go on the stack; the activator regains priority | tested | engine/cr10-attack-windows#J1-A3 |
| 11.6.12 | All targets ineligible at resolution: cancelled | tested | engine/cr11-stack#J1-A7 |
| 11.7 | Special Abilities | heading |  |
| 11.7.1 | Like action abilities plus a same-name discard; the S icon | tested | engine/special-abilities#L1 §11.7.1 — with a same-name card in hand; engine/special-abilities#L1 §11.7.1 — with no same-name card in hand; engine/special-abilities#L1 §11.7.1 — the source never pays for itself |
| 11.7.2 | Written "(cost): (effect)" | tested | engine/special-abilities#names the discard in the printed cost |
| 11.7.2.1 | The text before the colon is the cost | tested | engine/special-abilities#names the discard in the printed cost |
| 11.7.2.2 | Dull-icon costs need control since the turn began, or Haste | tested | engine/special-abilities#L1 §11.7.2.2 |
| 11.7.2.3 | Dull/break costs use your own Characters | n/a | the pool's one special ability (Jecht Beam) dulls only its own source |
| 11.7.2.4 | Remove/return costs | n/a | no special ability in the pool removes or returns a Character as a cost |
| 11.7.3 | Put on the stack and the cost paid; a failed activation rewinds | simplified | packages/engine/src/activate.ts; engine/special-abilities#L1 §11.7.11 |
| 11.7.4 | Declared, revealed, on top of the stack under the activator | simplified | packages/engine/src/activate.ts; engine/special-abilities#L1 §11.7.11 |
| 11.7.5 | "Choose" needs a legal target | tested | engine/special-abilities#L1 §11.7.5 |
| 11.7.6 | Modal special abilities | n/a | no special ability in the pool is modal |
| 11.7.6.1 | The mode count is fixed | n/a | no special ability in the pool is modal |
| 11.7.7 | Cost references, alternative and variable costs | n/a | no special ability in the pool has one |
| 11.7.8 | Effects applying differently | n/a | no special ability in the pool has one |
| 11.7.9 | The cost is locked | n/a | nothing in the pool changes a cost between declaration and payment; the engine computes and pays in one apply |
| 11.7.10 | Paid all at once | tested | engine/special-abilities#L1 §11.7.1 — with a same-name card in hand |
| 11.7.11 | Activated; triggers go on the stack; the activator regains priority | tested | engine/special-abilities#L1 §11.7.11 |
| 11.7.12 | All targets ineligible at resolution: cancelled | tested | engine/special-abilities#L1 §11.7.12 |
| 11.8 | Auto-Abilities | heading |  |
| 11.8.1 | Trigger automatically on their event | tested | engine/observer-triggers#C2-A2 |
| 11.8.2 | Written "(trigger), (effect)" | tested | cards/pool-coverage#implements every printed clause |
| 11.8.3 | Trigger at the event, even in phases where nothing can be cast | n/a | no pool card triggers in the Active, Draw or End Phase; every trigger in the pool fires where a window follows |
| 11.8.4 | Trigger even with no legal target, then leave the stack at once | tested | engine/cr11-stack#§11.8.4 |
| 11.8.5 | The controller is the source's controller | tested | engine/observer-triggers#opponent controls |
| 11.8.6 | Once per occurrence of the event | tested | engine/observer-triggers#C2-A3 |
| 11.8.7 | Do nothing when triggered; placed when priority is next gained, the turn player's in their order, then the non-turn player's | simplified | packages/engine/src/resolve.ts; engine/cr11-stack#§11.8.7 |
| 11.8.8 | Cost references are locked at placement | n/a | none in the pool |
| 11.8.9 | "Choose" needs a legal target | tested | engine/cr11-stack#§11.8.4 |
| 11.8.10 | Modal auto-abilities declare the mode | tested | cards/abilities#12-120C Shantotto; engine/party-damage#C2-A8 |
| 11.8.10.1 | The mode count is fixed | n/a | no pool card varies it |
| 11.8.10.2 | No selectable mode: it does not trigger | n/a | none in the pool |
| 11.8.11 | Variable costs | n/a | none in the pool |
| 11.8.12 | Effects applying differently | n/a | none in the pool |
| 11.8.13 | Conditional auto-abilities check at trigger and at resolution | n/a | none in the pool |
| 11.8.14 | "You may": placed regardless, decided at resolution | tested | cards/abilities#24-063H Hugh Yurg — "you may search |
| 11.8.15 | Only when the event actually occurs; a replaced event does not trigger | n/a | no replacement effects in the pool and no AST node for one (§11.12.5 is out of scope) |
| 11.8.16 | Zone movement triggers | tested | engine/observer-triggers#C2-A2 |
| 11.8.16.1 | Fail when the card did not reach the zone | n/a | none in the pool |
| 11.8.16.2 | A search whose card does not reach the zone fails | n/a | none in the pool |
| 11.8.16.2.1 | Enter-the-field triggers; every field card is checked | tested | cards/abilities#24-063H Hugh Yurg — "When a Forward of cost 1 enters your field |
| 11.8.17 | Delayed auto-abilities | n/a | none in the pool; no AST node |
| 11.8.17.1 | Generated by resolving; not triggered before they exist | n/a | none in the pool |
| 11.8.17.2 | Trigger once unless given a duration | n/a | none in the pool |
| 11.8.17.3 | Follow the card until it leaves its zone | n/a | none in the pool |
| 11.8.17.4 | Source and controller when a Summon generates one | n/a | none in the pool |
| 11.8.17.5 | Source and controller when an ability generates one | n/a | none in the pool |
| 11.8.17.6 | Source and controller when a replacement effect generates one | n/a | none in the pool |
| 11.8.18 | State-based triggers fire when the condition is met and not again until resolved | n/a | none in the pool |
| 11.8.19 | All targets ineligible at resolution: cancelled | tested | engine/cr11-stack#J1-A7 |
| 11.10 | EX Burst | heading |  |
| 11.10.1 | Marked cards carry their whole information | tested | engine/cr12-rules#§11.10 |
| 11.10.2 | Offered when dealt as damage; optional; cannot be responded to | tested | engine/cr10-attack-windows#J1-A8; engine/cr12-rules#§11.10; engine/timing-l2-compositions#L2-d |
| 11.10.3 | Summons apply all their effects; Characters only the marked clauses | tested | cards/abilities#13-072R Odin — "EX BURST; engine/cr12-rules#ignores a marked clause |
| 11.11 | Resolving Summons and abilities | heading |  |
| 11.11.1 | Both forfeit: the top of the stack resolves | tested | engine/cr11-stack#J1-A2; engine/timing-l2-compositions#L2-a |
| 11.11.2 | All chosen targets invalid: cancelled | tested | engine/cr11-stack#J1-A7 |
| 11.11.2.1 | Some still valid: applies to those | tested | engine/cr11-stack#an item whose declared target is still there |
| 11.11.3 | Conditional auto-abilities re-check | n/a | none in the pool |
| 11.11.4 | A moved source is read as it was before it left | simplified | packages/engine/src/abilities.ts |
| 11.11.5 | The controller resolves per the text | tested | engine/abilities-engine#choices suspend the frame |
| 11.11.5.1 | Choices not declared at cast are made at resolution | tested | engine/abilities-engine#a nested chooseModes → chooseTargets chain |
| 11.11.5.1.1 | Still legal targets | tested | engine/abilities-engine#apply re-derives the candidates |
| 11.11.6 | Both players choose: the turn player first, then simultaneous | n/a | none in the pool |
| 11.11.7 | A moved card is read as it was before it left | simplified | packages/engine/src/abilities.ts |
| 11.11.8 | An instructed action is done by the source card | tested | engine/observer-triggers#C2-A4 |
| 11.11.9 | Variables declared once | n/a | none in the pool |
| 11.11.10 | A resolved Summon goes to its owner's Break Zone; abilities cease | tested | engine/cr11-stack#J1-A2 |
| 12 | Rule Processes | heading |  |
| 12.1 | Performed when their condition is met | tested | engine/cr12-rules#§12.4 rule processes |
| 12.2 | Nobody controls them | tested | engine/cr12-field-limits#runs it: an |
| 12.3 | Checked when priority is gained; simultaneous; repeated; then triggers are placed; then priority | tested | engine/observer-triggers#C2-A5; engine/cr12-field-limits#runs it: an; engine/timing-l2-compositions#L2-b |
| 12.4 | The processes: | heading |  |
| 12.4.1 | Seven damage loses | tested | engine/cr12-rules#§12.4.1 |
| 12.4.2 | Drawing from an empty deck loses | tested | engine/cr9-phases#§3.1.2 |
| 12.4.3 | Damage beyond the deck loses | tested | engine/cr12-rules#§3.1.3 |
| 12.4.4 | Zero or less power: to the owner's Break Zone | tested | engine/cr12-rules#§12.4.4 |
| 12.4.5 | Damage at or above power breaks; the damage source is credited | tested | engine/cr12-rules#§12.4.5; engine/observer-triggers#C2-A5 |
| 12.4.6 | Two same-name non-generic Characters: both to the Break Zone | tested | engine/cr12-field-limits#J4-A1 |
| 12.4.7 | Two Light/Dark Characters: all to the Break Zone | tested | engine/cr12-field-limits#J4-A2 |
| 12.4.8 | Six Backups: down to five | tested | engine/cr12-field-limits#J4-A3 |
| 15.1.1.9 | Form a Party | heading |  |
| 15.1.1.9.1 | Two or more Forwards attack as one | tested | engine/cr10-attack#§10.1.2.1 |
| 15.1.1.9.2 | Same element only | tested | engine/cr10-attack#§10.1.2.1 |
| 15.1.1.9.3 | Only Forwards that could attack alone | tested | engine/cr10-attack#dull forwards and forwards that already attacked |
| 15.1.1.9.4 | Any number of Forwards | tested | engine/timing-l1-priority#§15.1.1.9.4 |
| 15.1.1.9.5 | Down to one Forward, it is no longer a party (untested: a party shrinking to one INSIDE the First Strike window, which needs a trigger that breaks a Forward — none in the pool) | tested | engine/cr10-attack-windows#a party reduced to one; cards/scenarios/ramuh-in-a-window#L3 ramuh-in-a-window |
| 15.1.1.9.6 | Blockable if any member is; the whole party is blocked | tested | engine/cr10-attack#§10.1.3.4 |
| 15.1.1.9.7 | First Strike damage only if every member has it | tested | engine/timing-l1-first-strike#§15.1.1.9.7 |
| 15.1.1.9.8 | Each member checks it may damage the blocker; any break credits them all | tested | engine/cr10-attack#§10.1.4.2.1 |
| 15.1.1.9.9 | Disbands at the next declaration or when the phase ends | tested | engine/cr10-attack#an unblocked party |
| 15.1.1.9.10 | Ability damage by a member counts as the party's, sourced to that member | n/a | no pool card reads party damage |
| 15.2.1 | Brave | heading |  |
| 15.2.1.1 | A field ability changing the declaration step | tested | engine/cr10-attack#§10.1.2.2 |
| 15.2.1.2 | Does not dull when attacking; still once per turn | tested | engine/cr10-attack#§10.1.2.2 |
| 15.2.2 | Haste | heading |  |
| 15.2.2.1 | A field ability | tested | engine/cr10-attack#a forward controlled since the start of the turn |
| 15.2.2.2 | May attack the turn it arrives | tested | engine/cr10-attack#a forward controlled since the start of the turn |
| 15.2.2.3 | May pay a dull-icon cost the turn it arrives | tested | engine/activated-abilities#§11.6.2.2 |
| 15.2.3 | First Strike | heading |  |
| 15.2.3.1 | A field ability changing the damage step | tested | engine/timing-l1-first-strike#§15.2.3.2 |
| 15.2.3.2 | First Strike Forwards deal damage first, then the rest | tested | engine/timing-l1-first-strike#§15.2.3.2; cards/scenarios/dragoon-blocks#L3 dragoon-blocks |
| 15.2.3.3 | A priority window between the two, with no Summons or abilities (a Back Attack cast is allowed — J3 second review H2); damage triggers wait for the second (a break OBSERVER fired by the first batch places in the window — spec J3-D3 reading) | tested | engine/timing-l1-first-strike#§15.2.3.3; cards/scenarios/dragoon-blocks#L3 dragoon-blocks |
| 15.2.3.4 | A party needs First Strike on every member | tested | engine/timing-l1-first-strike#§15.2.3.4 |
| 15.2.4 | Freeze | heading |  |
| 15.2.4.1 | An ongoing effect applied by Summons and abilities | tested | engine/timing-l1-freeze#§15.2.4.1 |
| 15.2.4.2 | Frozen Forwards skip their controller's next Active Phase | tested | engine/timing-l1-freeze#§15.2.4.2; cards/scenarios/shiva-freezes#L3 shiva-freezes |
| 15.2.5 | Back Attack | heading |  |
| 15.2.5.1 | A Character field ability (definitional: the keyword is read from the printed card, `keywords: ['backAttack']`) | tested | engine/timing-l1-back-attack#§15.2.5.2; cards/scenarios/scarmiglione-blocks#L3 scarmiglione-blocks |
| 15.2.5.2 | Cast with priority in either player's Main or Attack Phase | tested | engine/timing-l1-back-attack#§15.2.5.2 |
| 15.2.5.3 | Cast as a response | tested | engine/timing-l1-back-attack#§15.2.5.3 |
| 15.2.5.4 | No stack: cannot be prevented by Summons or abilities | tested | engine/timing-l1-back-attack#§15.2.5.3; engine/timing-l1-back-attack#§11.4.7 + §11.8.7 |
| 15.2.8 | Limit Break | heading |  |
| 15.2.8.1 | A field ability written on the card | tested | engine/limit-break#a face-down LB card is castable in the Main Phase |
| 15.2.8.2 | "Limit Break -- X" is the LB cost | tested | cards/normalise#Limit Break |
| 15.2.8.3 | LB cards are cast from the LB deck, under the type's own conditions | tested | engine/limit-break#a face-down LB card is castable in the Main Phase; cards/scenarios/maat-limit-break#L3 maat-limit-break |
| 15.2.8.3.1 | The LB cost is paid in addition to the base cost | tested | engine/limit-break#a face-down LB card is castable in the Main Phase; cards/scenarios/maat-limit-break#L3 maat-limit-break |
| 15.2.8.3.2 | Paid by turning X face-down LB-deck cards face up | tested | engine/limit-break#refuses a wrong flip count; engine/limit-break#enumeratePayments lists one canonical flip subset |
| 15.2.8.4 | On the field, an ordinary Character | tested | engine/limit-break#an LB Forward broken in battle; cards/scenarios/maat-limit-break#L3 maat-limit-break |
| 15.2.8.4.1 | Moved to hand, Break Zone, main deck or removed: goes there, then to the LB deck face up at once | tested | engine/limit-break#an LB Forward broken in battle; cards/scenarios/maat-limit-break#L3 maat-limit-break |
| 15.2.8.4.2 | The arrival's triggers still apply | tested | engine/limit-break#an LB Forward broken in battle; cards/scenarios/maat-limit-break#L3 maat-limit-break |
| 15.2.8.4.3 | A Summon LB card: stack → Break Zone → LB deck face up (the replacement-effect sentence is untested: the engine has no replacement effects — J8 second review L4) | tested | engine/limit-break#an LB Summon resolves |
| 15.2.8.4.4 | Even from a hidden zone (deck, hand) it goes to the LB deck | tested | engine/limit-break#returned to hand is in the LB deck face up |
| 15.2.8.4.5 | The return is not stacked (tested); it admits no replacement effect (vacuous: the engine has no replacement effects — J8 second review L4) | tested | engine/limit-break#an LB Forward broken in battle |
