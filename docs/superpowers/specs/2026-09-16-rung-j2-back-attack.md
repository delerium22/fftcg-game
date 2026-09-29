# Rung J2 — Back Attack (§15.2.5), with a real card in both decks

> **STATUS: BUILT, 2026-09-16** (commits 7d942d7..e4ba5e9; the Codex review is deferred to 08:15 by `~/.claude/handoffs/fftcg-game/codex-j2-review.sh` and adjudicated next session). Agreed under the user's standing instruction ("loop the work until it's implemented, review
> with Codex, go with your recommendations at a crossroads"). Calls are mine and recorded so they can be overturned
> here. The matrix rows 15.2.5.1–4 are `simplified` today; J2 turns them `tested` and removes the marker in `cast.ts`.
> Bounded rung: the spec carries its own task list; the Codex review is deferred (quota) like J3's.

## As built (differences from the design below)

- No browser play-through: the mechanism is the same tray-and-window path the K rungs verified for Summons, and
  the prompt/sheet wording is unit-tested; a play at a seed holding Scarmiglione is a follow-up.
- **Review H1 (2026-09-16):** under the default Smart auto-pass (K5-D4) the AI's `declared` window was PASSED, so
  the surprise-blocker cast this card exists for never reached the human. `smartPasses` now keeps any window in
  which a Character is castable (`actionMenu.castable` holds a non-Summon). Review M1: the stack-top and AI-Main-
  Phase prompts say "cast a card" too. Review L2: the sheet's `phase` refusal follows the card — "Only in your Main
  Phase" for a plain Character, "Not in this step — cast it in a Main Phase or an Attack Phase window" for a
  Summon or a Back Attack Character.
- J2-A4's second case asserts greedy CASTS the surprise blocker in the `declared` window (it does, at depth 1).
- The deck change re-pinned: deck-search → 135, card-details → 135, the announcements literal ("Cast Sphene …
  discard Dragoon as lightning"), the blocker-choice and Reeve sweeps now seek what they assert, and the mirror
  Billy Bob fixture strips a dealt twin from the hand. Pressable's 28 and payment's 50 survived.

## The rule

§15.2.5: Back Attack is a Character field ability. Its holder may be cast by a player WITH PRIORITY during either
player's Main Phase or Attack Phase (§15.2.5.2), as a response to the opponent (§15.2.5.3), and it does not use
the stack, so nothing can prevent it entering (§15.2.5.4). Today `castBlocker` refuses a Character outside the
turn player's own Main Phase, with priority, and with an empty stack (§9.3.1.5, §11.4.1).

## The card (J2-D1)

The earth/lightning Back Attack cards in the Square Enix list number eight; two print nothing but the keyword:
**2-085H Scarmiglione** (earth Forward, cost 2, 5000, "Back Attack (Like Summons and abilities, this card can be
played during either player's Attack Phase or Main Phase.)") and 7-066C Carbuncle (earth Backup, cost 2). The
Forward is the one that shows the rule off — a surprise blocker cast in the attacker's `declared` window — so
Scarmiglione ×2 joins both decks; Sphene 27-126S and Ramuh 20-103H drop from 3 to 2. A Back Attack BACKUP is
covered by a synthetic Layer 1 case. Non-generic (§12.4.6), like the Red Mages. `cards.json` is refetched. The
parser already turns the keyword line (with its parenthetical) into `keywords: ['backAttack']`.

## Design

- **J2-D2 — castability.** In `castBlocker`, a Character whose printed keywords include `backAttack` skips the
  three Character-only refusals — `phase` (Main Phase only), `notTurnPlayer`, `stackNotEmpty` — and is instead
  gated like a Summon: `instantSpeedAllowed` (a Main Phase, or an Attack Phase window; NOT the `firstStrike`
  window), the caster holds priority, nothing is pending. **Superseded 2026-09-29 (J3 second review H2):** the
  letter is followed — `backAttackAllowed` (`cast.ts`) also admits the `firstStrike` window, and `menuShape` lists
  casts there. The original text follows. **The First Strike exclusion is a reading (review L1):**
  §15.2.3.3 bars "Summons or ... action or special abilities" there; casting a Character is a special ACTION
  (§9.3.1.5), which the letter does not name. The intent — nothing enters or acts between the two batches — is
  taken; it is encoded in `instantSpeedAllowed` (`cast.ts`) and `menuShape` (`legal.ts`), and a revised reading
  must touch both. Unobservable in this pool (Scarmiglione has no ETB and the block is already declared). The field limits (§7.7.3–5), the Backup
  cap and the Monster refusal still apply. Printed keywords only: a card in hand has no field card to carry a
  granted keyword, and no pool effect grants Back Attack.
- **J2-D3 — priority after the cast.** §11.4.7: the Character is on the field, its ETB triggers are placed at
  the next priority grant, and THE TURN PLAYER gains priority. `applyCastCharacter` sets `priority` to the turn
  player and `passes` to 0 (an action resets the forfeit count) — a no-op for the turn player's own casts, and
  for the non-turn player's Back Attack the opponent answers first. (§11.3.8 and §11.6.11 give a Summon's
  caster priority back; §11.4.7 does not say so for Characters, and it is the section that governs.)
- **J2-D4 — no stack.** Nothing changes: `putOntoField` places the card at once and the ETB triggers go on the
  stack when priority is next gained. A response to a Summon on the stack (§15.2.5.3) therefore lands BEFORE
  the Summon resolves, which is the point of the keyword.
- **J2-D5 — the AI.** `actionMenu(...).castable` runs every hand card through `castCheck`, so the cast appears
  among the AI's candidates in every window where it is legal, and `forcedPass` no longer reports a window in
  which the AI could cast it. No AI code changes; a test proves greedy sees the candidate in the `declared`
  window and casts it as a blocker when that saves a point of damage for free. **Limit (review L4):** inside
  rollouts, greedy's `combatWindow` passes through every combat window, so neither agent anticipates the
  opponent's Back Attack when it attacks, and its own Back Attack inside a rollout never happens — the cast is
  a top-level candidate only. An ISMCTS node opens for the non-turn player in those windows whenever the
  determinised hand holds the card and CP; the rollout below prices it as a pass.
- **J2-D6 — the browser and the engine's words.** The window prompt says "cast a card" when a Character is
  castable there (it says "cast a Summon" when only Summons are). The engine's and the sheet's `phase` refusal
  texts mention Back Attack: "Only in your Main Phase — or, with Back Attack, in any window".

## Tests (J2-A1 to J2-A5)

- **J2-A1** (engine, Layer 1, synthetic `T-BA` Forward and `T-BA-B` Backup with `keywords: ['backAttack']`):
  castable by the non-turn player in the turn player's Main Phase 1 once the turn player has forfeited; castable
  by the defender in the `declared` and `blocked` windows and by the turn player in `preparation`; refused in
  the `firstStrike` window and in the declaration step; castable with the opponent's Summon on the stack, and
  the Character is on the field before that Summon resolves; after the non-turn player's cast the TURN player
  holds priority with `passes` 0; a plain Character is still refused for the non-turn player; a sixth Back
  Attack Backup is still refused.
- **J2-A2** (cards): Scarmiglione's def carries `keywords: ['backAttack']`, no abilities, non-generic, earth 2
  for 5000; the pool test still finds every clause implemented; counts 21 → 22.
- **J2-A3** (Layer 3, real cards, `scenarios/scarmiglione-blocks.test.ts`): player 0 attacks with Luso into
  player 1's empty board; in the `declared` window player 1 casts Scarmiglione with two Geomancers; priority
  returns to player 0; both forfeit; player 1 blocks with Scarmiglione; 5000 into 3000 breaks Luso, and Luso's
  damage trigger breaks Scarmiglione back (C2-A4: it damaged it) — the golden order from a probe.
- **J2-A4** (AI): with Scarmiglione-shaped `T-BA` in hand and CP, greedy's candidates in the opponent's
  `declared` window include the cast; facing a lone attacker it can block for free, greedy casts.
- **J2-A5** (web): the window prompt reads "cast a card" with a Back Attack Character castable and "cast a
  Summon" without; the sheet's refusal text for a Back Attack card in the declaration step names the rule.
- **Matrix**: 15.2.5.1–4 → `tested`; the marker in `cast.ts` goes; the referee passes.
- **e2e and seeded fixtures**: the deck change reshuffles every seed again; re-pin with the finders as J3 did.
- **Gates** typecheck, lint, unit, browser.

## Tasks

1. Engine: J2-A1 red → `castBlocker` + `applyCastCharacter` + refusal text → green; commit.
2. Cards: deck edit, fetch, J2-A2, counts; commit.
3. Web: J2-A5 red → prompt verbs + sheet text → green; commit.
4. Probe → J2-A3 scenario; J2-A4; commit.
5. Matrix, ladder, seed re-pins, gates, a browser play at a seed holding Scarmiglione; spec BUILT; handoff.
