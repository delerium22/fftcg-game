# Rung J3 — First Strike (§15.2.3) and Freeze (§15.2.4), with real cards in both decks

> **STATUS: BUILT, 2026-09-16** (commits 6850058..64a3fbd; the Codex review runs when its quota resets and is adjudicated in the next session — see the handoff). Agreed under the user's standing instruction ("loop the work until it's implemented, review
> with Codex, go with your recommendations at a crossroads"). Every call below is mine and recorded so it can be
> overturned here. The matrix rows 15.2.3.1–4, 15.2.4.1–2 and 15.1.1.9.7 are `simplified` today; J3 turns them
> `tested` and removes the markers in `attack.ts` and `phases.ts`.

## As built (differences from the design below)

- `FieldCard.frozen` and `AttackState.heldDamage` are OPTIONAL fields (absent = false / none): a dozen test
  fixtures build field cards and attack states by hand, and a required field would churn them for no behaviour.
- The invariant on the `firstStrike` step does NOT forbid a pending decision: a zone-change trigger fired by
  the first batch's break (Lightning watching the broken blocker) is placed and declares IN the window, which
  §15.2.3.3 permits — it bars casting and activating, not triggers. Found by self-play (seed 119); pinned by a
  Layer 1 test.
- The resumed damage step announces itself (`phaseStarted damage`) BEFORE the second batch lands, so a trace
  reads `step:damage, battle…, step:firstStrike, step:damage, battle…`.
- J3-A6 asserts the block's SCORE, not the decision: greedy chump-blocks a 6000 with a 5000 whether or not the
  attacker has First Strike (a point of damage outweighs the Forward for it), so the observable is that 5000
  into 5000 scores lower with the keyword (one-sided kill) than without (a trade). It does decline nothing.
- The deck change re-shuffled every seed: pressable → seed 28, deck-search → 28, card-details → 17, the
  announcements literal re-derived at seed 1 ("discard Miner as earth, discard Shiva as ice"), two sweeps
  widened, one sweep now stops on the exact condition it asserts, one given a 60 s budget. Payment's seed 50
  and how-to-play's 1 and 21 survived by luck.

## The problem

Battle damage is simultaneous and there is no frozen status. Both are common keywords in later sets, both are
timing rules (First Strike splits the Damage Resolution Step in two with a priority grant between; Freeze
changes the next Active Phase), and neither card exists in the Starter Vol. 2 pool — so the rules cannot be
tested by playing without bringing cards in.

## The cards (J3-D1)

The user's rule: if a rung waits on a card the pool lacks, bring that card in and add it to both decks. The
full Square Enix list (4261 cards) was searched for earth/lightning cards:

- **1-147C Dragoon** — lightning Forward, cost 3, 6000, generic; text is the bare keyword line "First Strike".
  Nothing else to implement. Every other earth/lightning First Strike card also prints an ability.
- **1-038R Shiva** — ice Summon, cost 3: "EX BURST Choose 1 Forward. Dull it and Freeze it." Chosen over the only
  earth/lightning Freeze card, 24-073H Valigarmanda ("Dull it and Freeze it. It loses 9000 power … Deal it 9000
  damage"), whose Freeze is unobservable in this pool because nothing survives its −9000 (§12.4.4) — and over
  the Light-element Freeze cards (Yuna, Squall), which print clauses the AST cannot yet express. Shiva needs one
  ice CP (§11.2.2), so:
- **1-040C Summoner** — ice Backup, cost 1, no text. The pool's Class Tenth Moogle produces lightning only.

Two copies of each go into `decks/starter-2025-vol2.txt` (both seats play that list). Six slots come from
reducing six 3-copy cards to 2: 9-074C Class Tenth Moogle, 20-074C Miner, 1-121C Red Mage, 18-069C Red Mage,
20-105C Reeve, 13-072R Odin. The deck stays 50 cards, ≤3 copies (§8.1). `cards.json` is refetched (the fetch
keeps only deck codes). Two Summoners are non-generic (§12.4.6): a player may field one at a time, as with the
two Red Mages already in the list. No art is committed (the CDN may 403 on the new codes; the card falls back to
text as the starter exclusives do).

## First Strike (J3-D2 to J3-D5)

- **J3-D2 — when it applies.** Only in a BLOCKED battle (§15.2.3.2 names attacking or blocking Forwards; an
  unblocked attack deals its point with nobody "in battle"). The First Strike set is: the blocker if it has the
  keyword (`keywordsOf`, so printed, granted and layer all count); the attacking side if it is one Forward with
  the keyword, or a party whose EVERY member has it (§15.2.3.4, §15.1.1.9.7). If the set is empty, or it is
  every combatant, damage is simultaneous as today and nothing else changes.
- **J3-D3 — the split step.** `AttackStep` gains `firstStrike`. `beginDamageResolution`:
  1. If the BLOCKER is in the First Strike set and the attack is a party, the §10.1.4.2.1 split is owed now
     (`assignPartyDamage`); otherwise it is owed when the blocker deals its damage, after the window (the party
     may have shrunk). A blocker that is gone by then owes nothing.
  2. The First Strike set deals its battle damage (`battleDamage` events). Rule processes run (§11.1.3): the
     victim may break here, which is the whole point.
  3. The damage occurrences of this batch are HELD on `attack.heldDamage`, not enqueued: §15.2.3.3 says
     triggers from First Strike damage are not put on the stack until all non-First-Strike damage is resolved.
  4. The `firstStrike` window opens: priority to the turn player, `passes = 0`. In it nobody may cast a Summon
     or use an ability (§15.2.3.3); `menuShape` offers only `pass` (unless a Back Attack Character is castable —
     J3 second review H2, 2026-09-29: the letter bars Summons and abilities, not a Character cast), so `forcedPass` reports it and the browser
     and the AI's rollouts pass through it without a render or a search (J1-D14/D15). It is a window, not a
     decision, so `isResponseWindow` is true and `ATTACK_WINDOWS` (instant speed) does NOT include it.
     **Reading (review M3, 2026-09-16):** only `dealtDamage` clauses are held. A zone-change trigger CAUSED by the
     first batch's break (Lightning watching a broken blocker) is triggered by the zone change, not the damage,
     so it is placed under §11.1.4 and may resolve IN the window. The alternative reading ("triggered by First
     Strike damage" = anything the damage caused) would hold those too; it is not taken, and a card whose
     "when this is broken" clause should wait for the second batch is the case that would reopen it.
     **Fixed set (review H1):** the First Strike set is computed ONCE, at the beginning of the step, and carried
     as `attack.firstStrikers` (§15.2.3.2) — never recomputed over the survivors.
  5. On the double forfeit (`exitAttackWindow`): the remaining combatants still in battle deal their damage to
     targets still in battle (§10.1.3.2.1: a broken blocker deals nothing, and nothing is dealt to a Forward that
     has left). Then ALL damage occurrences — the held ones first, then this batch — are enqueued in one
     `enqueueDamageTriggers` call, rule processes run, and the `damage` window opens as today (§10.1.4.4).
- **J3-D4 — events.** `phaseStarted { phase: 'attack', step: 'firstStrike' }` marks the split. No new event kind:
  the two `battleDamage` batches and the step event between them are the whole story.
- **J3-D5 — the AI is unaffected in code.** Greedy and ISMCTS evaluate a block by APPLYING it and scoring the
  result, so the engine's split step prices First Strike for them; `forcedPass` walks the window. Nothing in
  `packages/ai` changes; a test proves greedy declines a block that First Strike makes free for the attacker.

## Freeze (J3-D6 to J3-D7)

- **J3-D6 — the status.** `FieldCard.frozen: boolean` (every construction site sets `false`; `checkInvariants`
  requires a boolean). A new effect `{ kind: 'freeze' }` sets it and emits `frozen { card }`. Freeze does not
  dull; Shiva's "Dull it and Freeze it" is `[{ dull }, { freeze }]`. Any Character on a field can be frozen (the
  CR's §15.2.4.2 says Forwards, but Celes 16-033C freezes Backups; the status is on `FieldCard`).
- **J3-D7 — the Active Phase.** A frozen card of the turn player's does not activate and its `frozen` clears
  (§15.2.4.2: "their controller's next Active Phase" — one skip, then normal). Event `thawed { card }` for the
  narration ("Luso stays dull — it was frozen"). The End Phase does NOT clear `frozen` (it is not an
  until-end-of-turn effect; a Forward frozen in the opponent's turn skips its own next Active Phase).

## The browser and the CLI (J3-D8)

- The card shows a `Frozen` badge (with the buffs, `cardBuffs`), said in its accessible name; the log narrates
  `frozen` ("Shiva freezes Luso — it will not activate next turn") and `thawed`.
- `ATTACK_STEP_LABEL.firstStrike = 'first strike'` for the prompt, though the window is never shown (forced).
- The AI's narration of a First Strike battle needs nothing new: the `battleDamage` lines already exist.

## Tests (J3-A1 to J3-A6)

- **J3-A1** (engine, Layer 1, synthetic): a 6000 First Strike attacker into a 5000 blocker breaks it before it
  deals damage — the attacker takes none; the reverse (First Strike blocker) likewise; two First Strike
  combatants are simultaneous; a party with one non-First-Strike member deals normal damage; an unblocked
  First Strike attack has no split step; the split is owed at the right batch for a party.
- **J3-A2** (engine): the `firstStrike` window admits only `pass` (`legalCommands` lists pass and concede; a
  Summon in hand and a live activation are refused), `forcedPass` reports it, `isResponseWindow` is true; a
  trigger from the First Strike batch (a synthetic "when this deals damage" clause) is placed only when the
  `damage` window opens, together with the second batch's.
- **J3-A3** (engine): a frozen Forward stays dull through its next Active Phase and activates the one after; a
  frozen ACTIVE Forward stays active; a Backup can be frozen; the End Phase leaves `frozen` alone.
- **J3-A4** (cards): Dragoon's def carries `keywords: ['firstStrike']` and no abilities; Shiva's AST quotes the
  printed text, is the marked EX Burst clause, dulls and freezes its target; Summoner is vanilla; the pool test
  still finds every clause implemented; `normalise`, `art` and harness counts move from 18 to 21.
- **J3-A5** (Layer 3, real cards): "dragoon-blocks" — Luso attacks, Dragoon blocks, the golden shows the split
  step, Luso broken before it deals, Luso's damage trigger absent; "shiva-freezes" — Shiva cast in Main Phase 1 on
  the opponent's dull Forward, then that Forward stays dull through its Active Phase and activates a turn later.
- **J3-A6** (AI): greedy declines to block a First Strike attacker whose power beats the blocker's, where it
  would have traded without the keyword.
- **Matrix**: rows 15.2.3.1–4, 15.1.1.9.7, 15.2.4.1–2 become `tested`; the markers go; the referee passes.
- **e2e**: the deck change re-shuffles every seed. A finder script re-pins seeds 1, 8, 21, 50 to seeds with the
  same properties (who chooses first, Hugh Yurg castable on turn 1 with a Geomancer in hand, six pressable
  hand cards, Class Tenth Moogle fundable four ways); each spec's comment says which seed and why.
- **Gates** typecheck, lint, unit, browser; a browser play-through of a Dragoon block and a Shiva cast.
