# Rung J8 — Limit Break (§7.14, §8.1, §15.2.8): the LB deck as a zone, LB cards cast from it

> **STATUS: BUILT, 2026-09-16** (commits a1143e5..26971c5; the Codex review is deferred to 08:50 by
> `~/.claude/handoffs/fftcg-game/codex-j8-review.sh` and adjudicated next session, after J3's and J2's). Agreed under
> the user's standing instruction ("loop the work until it's implemented, review with Codex, go with your
> recommendations at a crossroads"). Calls are mine and recorded so they can be overturned here. Architectural: a
> new zone, a new cost, a new deck file, a new board row. Plan: `docs/superpowers/plans/2026-09-16-rung-j8-limit-break.md`.

## As built (differences from the design below)

- The Layer 3 scenario (J8-A3) spans two turns: Maat cannot attack the turn it is cast (§10.1.2.1.1), so the Brave
  attack is Scarmiglione's (granted by Maat's ETB, stays active), and Maat's return is Luso's trigger breaking it
  as a blocker on turn 2 — which also shows the pump expiring and Maat's printed Brave surviving it.
- §15.2.8.4.4 (a hidden zone) has its own Layer 1 case: a synthetic bounce Summon returns the LB Forward to hand
  and it is in the LB deck face up when the command returns.
- The CLI flag is `--lb-deck path|none` (default the starter LB file); `hotseat` and `selfplay` take `lbDecks?`;
  `mirror`, `profile` and `deckorder` still play without an LB deck (a follow-up if their numbers should include it).
- The browser play (seed 28, turn 1): Maat cast from the LB deck with Auto (two discards, Maat's twin flipped),
  the row shows "LB" / "Spent", the ETB pumps. The pressable e2e now counts hand casts only — the LB deck's four
  cards are pressable casts on turn 1 (a discard pays for Maat).
- The harness `trace` gained `lbFlip:` and `lbReturn:` lines. No seed re-pins: the main deck file is unchanged.
- **Review fixes (2026-09-16, `claude-j8-review.md`):** C1 the ISMCTS index (J8-D8); H1 strict self-play with the LB
  decks for random, greedy and ISMCTS, the decoder round-trip with LB decks, and `--lb-deck` reaching `mirror` and
  `profile` too; M1 the sweep runs at game over as well (an LB Summon waiting on the stack at a concede ends face up
  in the LB deck, §15.2.8.4.3); M2 the canonical flip subset (J8-D3); L2 an activation's payment refuses `lbFlip`; L3
  the invariant's LB-zone check is skipped only mid-frame; L4 a spent LB card is refused as `lbSpent`, not
  `notInHand`; L5/L7 the AI's cast reads "from the AI's LB deck" and flips join with commas; L8 "not shuffled
  (§8.2.1.1 does not require it)". L1 (sweep granularity is per frame) is recorded on `sweepLimitBreak`; L6
  (`cast.from` is unread by renderers — the move line already says "from the LB deck") is left as data.

## The rules, as read from CR 3.3

- §7.14: the LB deck is a zone of face-down cards placed at the start; public, but face-down cards are seen by
  the owner only. §8.1.1.1: up to eight cards, none required; §8.1.1.2 ≤3 copies; §8.1.3: in a constructed game
  an LB deck holds only LB cards and a main deck holds none. §8.2.1.1: LB decks are not shuffled.
- §15.2.8: "Limit Break -- X" is the LB cost. LB cards are cast FROM the LB deck (§15.2.8.3), under the usual
  conditions for their type, paying the base cost AND the LB cost (§15.2.8.3.1), which is paid by turning X
  face-down LB-deck cards face up (§15.2.8.3.2). On the field they are ordinary Characters (§15.2.8.4). An LB
  card moved to hand, Break Zone, main deck or removed-from-play goes there — its arrival triggers fire
  (§15.2.8.4.2) — and is then put into the LB deck face up at once, not via the stack, no replacement effects
  (§15.2.8.4.1, .4.4, .4.5). A Summon LB card goes stack → Break Zone → LB deck face up (§15.2.8.4.3).

## The cards (J8-D1)

Earth/lightning LB cards in the Square Enix list number 21; two are fully expressible with the AST as it is:
**23-125R Noctis** (earth Forward, cost 6, 7000, LB 2: "When Noctis enters the field, choose 1 Forward in your
Break Zone. Add it to your hand.") and **22-119R Maat** (earth Forward, cost 4, 8000, LB 1, Brave: "When Maat
enters the field, until the end of the turn, all the Forwards you control gain +1000 power and Brave."; it also
prints the reminder "(Cards with [LB] cannot be included in your main deck.)"). Both seats get the LB deck
`decks/starter-2025-vol2-lb.txt`: Noctis ×2, Maat ×2 — four cards, room for eight. No LB Summon is in reach
(none prints only expressible clauses), so §15.2.8.4.3 is covered by a synthetic Layer 1 case. The fetch script
already reads every `decks/*.txt`; `normalise` learns the "Limit Break -- X" line (→ `limitBreak: X`, not a
clause) and drops the LB reminder line from the clause count.

## Design

- **J8-D2 — the zone.** `PlayerState.lbDeck: { id: CardId; faceUp: boolean }[]`, in deck-file order (never
  shuffled, §8.2.1.1). `createGame` gains `lbDecks?: [string[], string[]]` (default none); `validateDeck` refuses
  an LB card in a main deck (§8.1.3); `validateLbDeck` refuses more than eight, more than three copies, or a
  card without `limitBreak`. `CardDef.limitBreak?: number`.
- **J8-D3 — casting.** `castBlocker` accepts a card that is in the caster's LB deck FACE DOWN as it does a hand
  card; the type's own conditions apply unchanged (Main Phase for a Character, any window for a Back Attack one
  or a Summon, field limits). A new blocker `lbCost` when fewer than X OTHER face-down cards remain.
  `Payment.lbFlip?: CardId[]` names the X cards to turn face up; `checkedPay` demands exactly X distinct
  face-down cards of the caster's LB deck, none the cast card itself, and flips them (event `lbFlipped {
  player, cards }`). The cast card leaves the LB deck as a hand card leaves the hand; `cast` events gain
  `from: 'hand' | 'lbDeck'`. `enumeratePayments` lists ONE canonical flip subset per CP payment (the first X
  face-down others) and `isLegal`/`apply` accept any X-subset through `lbFlipCheck` — as J7 does for built target
  sets (review M2: crossing every subset multiplied the list by C(7,X) per CP payment, 240 casts on turn 1). The
  browser's tray offers every face-down other and completes with the player's own X, validated by `isLegal`.
  `preferredPayment` flips the face-down cards it values least:
  duplicates of the cast card first, then the highest printed cost.
- **J8-D4 — the return.** `runRuleProcesses` ends with the Limit Break sweep: every card whose def has
  `limitBreak` found in either player's hand, Break Zone, main deck or removed-from-play moves to its OWNER's LB
  deck face up, with event `lbReturned { player, card, from }`, and is pruned from
  `putIntoBreakZoneFromFieldThisTurn`. The sweep runs after the zone-change triggers of the move were enqueued
  (they read the transitions), so "put from the field into the Break Zone" watchers still fire (§15.2.8.4.2),
  and Sphene's retrieve can never see an LB card (it is gone before any priority). A resolved Summon reaches
  the Break Zone by §11.11.10 and sweeps the same way (§15.2.8.4.3). `checkInvariants` counts the LB deck as a
  zone and forbids an LB card anywhere in hand, Break Zone, deck or removed-from-play once settled.
- **J8-D5 — what the other side sees.** Both seats' LB decks are exposed with identities and face state in
  `FieldView.lbDeck`. This is a deliberate deviation from §7.14.2 (face-down identities are the owner's): this
  app plays open decklists (spec B4), and the face-down SET is exactly the list minus the face-up cards and the
  cast ones, so no information a real opponent lacks is created — only which face-down card is which, which the
  rules give no meaning (the owner chooses any). Marked in `view.ts`. `determinise` keeps LB cards by id and
  never subtracts their codes from the main-deck multiset.
- **J8-D6 — the browser.** Each seat gets an "LB deck" row: the owner's face-down cards are ordinary pressable
  cards with an "LB" badge, face-up ones dimmed with a "spent" badge; the opponent's row shows the same (D5). The
  sheet offers "Cast … from your LB deck"; the tray gains an LB part — "Turn face up: 0 of X" — filled by
  pressing own LB-deck cards (Auto fills it with `preferredPayment`'s choice). The move line reads "Cast Noctis
  from your LB deck, turning Maat face up, paying: …". Log lines for `lbFlipped` and `lbReturned`.
- **J8-D7 — the CLI** renders each LB deck as a line of `[id] Name (face down|UP)`; `hotseat`/`selfplay` load
  `decks/starter-2025-vol2-lb.txt` beside the main list.
- **J8-D8 — the AI.** `actionMenu.castable` and `enumeratePayments` reach the LB casts for greedy. ISMCTS DID need
  changes (review C1, 2026-09-16 — the claim "no search changes" was wrong): the key index names both LB decks by
  code with the face state in the ref (`l0:22-119R`, `l0:22-119R:up`), the cast key carries the flips as a fourth
  field and `decodeCast` reads them back, `searchView` sees LB ids, and `observationKey` digests both decks' face
  state. Without the index every LB cast keyed opaque and `searchIsmcts` threw at the root — in the browser the
  coordinator then dropped the worker and played greedy for the rest of the game. The evaluation is still blind to
  the LB deck's remaining value (a follow-up).

## Tests (J8-A1 to J8-A6)

- **J8-A1** (engine, synthetic `T-LB2` Forward with `limitBreak: 2`, `T-LB1`, `T-LB-S` Summon with `limitBreak:
  1`): castable from the LB deck face down in a Main Phase, paying base CP plus flipping exactly two others;
  refused with a wrong flip count, a face-up flip, the card flipping itself, or with fewer than two others face
  down; a face-up card is not castable; the cast card leaves the LB deck; on the field it is ordinary (attacks,
  blocks, dies); when broken it reaches the Break Zone — a watcher of "put from the field into the Break Zone"
  fires — and is in the LB deck face up when the command returns, not in the Break Zone; `T-LB-S` resolves and
  ends face up in the LB deck; a main deck holding an LB card is refused; an LB deck of nine, of four copies, or
  with a non-LB card is refused; `viewFor` exposes both LB decks; `determinise` conserves them; random walks
  with LB decks keep the invariants.
- **J8-A2** (cards): Noctis and Maat defs (`limitBreak` 2 and 1, keywords, no clause for the reminder line);
  Maat's ETB pumps and grants Brave; Noctis's ETB retrieves a Forward from the Break Zone; the pool test finds
  every clause implemented; the LB deck file validates.
- **J8-A3** (Layer 3, real cards): Maat cast from the LB deck in Main Phase 1 (four earth CP, one flip), its
  ETB, an attack with Brave, a block that breaks it, the return face up — golden order from a probe.
- **J8-A4** (AI): greedy's candidates in a Main Phase include the LB cast; `preferredPayment` flips a
  duplicate before a different card.
- **J8-A5** (web): the LB row renders both decks with face state; the tray reaches Confirm only with X flips;
  the move line names the flips; `lbFlipped`/`lbReturned` narrate.
- **J8-A6** (CLI): the render names the LB deck's cards and face state.
- **Matrix**: rows 15.2.8.1–.4.5 → `tested` (they are out of the referee's scope today — the scope gains
  `15.2.8`); the audit's 7.14 / 8.1 rows → ok.
- **Gates** typecheck, lint, unit, browser; a browser play at a seed with four earth CP by turn 3.
