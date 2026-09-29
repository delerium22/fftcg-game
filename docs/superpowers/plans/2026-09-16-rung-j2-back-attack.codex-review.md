# Rung J2 — review adjudication (2026-09-16)

Codex was out of quota; the review was run by a fresh Claude Fable 5.1 session (read-only, against the built code at
7d942d7..b9a111a with HEAD 3cfaebf) — `~/.claude/handoffs/fftcg-game/claude-j2-review.md`. Each accept and reject is
backed by the code.

**Accepted (9):**
- H1 — under the default Smart auto-pass (K5-D4) the AI's `declared` window was passed, so the surprise-blocker cast
  never reached the human. `smartPasses` now keeps any window in which a Character is castable (`actionMenu.castable`
  holds a non-Summon). K5-A1 case added (red before the fix); recorded in the J2 spec's as-built section.
- M1 — the stack-top and AI-Main-Phase prompts said "cast a Summon" with a Back Attack Character castable: `castVerb`
  hoisted above all three branches; two prompt cases added (red before).
- M2 — the non-turn player's Back Attack ETB path had no committed test: L1 case added (turn player holds priority
  while the caster declares targets; the turn player's watcher is placed first and the caster's ETB resolves on top,
  §11.4.7 + §11.8.7). It passed first time — the behaviour was right, only unproven.
- M3 — J2-A5's sheet case is now built (a Back Attack card in the declaration step).
- L1 — the First Strike exclusion is recorded as a reading in J2-D2 (the letter names abilities and Summons; a cast is a
  special action) with both code sites named.
- L2 — the `phase` refusal follows the card: "Only in your Main Phase" for a plain Character; "Not in this step — cast
  it in a Main Phase or an Attack Phase window" for a Summon or a Back Attack Character.
- L3 — matrix 15.2.5.1 cites the scenario too and says it is definitional; 15.2.5.4 cites the new M2 case.
- L4 — J2-D5 records that rollouts pass through combat windows, so a Back Attack is a top-level candidate only.
- L5 — the card-details sweep plays each seed once.

**Rejected (0). Disagreed with the reviewer on (0).**

## Second pass — Codex (adjudicated 2026-09-29)

Codex (gpt-5.6-sol, xhigh, read-only) reviewed main at 8a4e874 on 2026-09-29, told of the first pass and of the
First Strike window change (J3 second review H2). Fixes are on branch `fix/j2-codex-second-pass`.

**Accepted (4):**
- M1 — `forcedPass` and Smart auto-pass read `actionMenu.castable`, which ignores CP, so an UNAFFORDABLE card
  (a Summon since J1, a Back Attack Character since J2) held a pass-only window open: the browser showed a strip
  whose one answer was Pass, and the AI searched a forced move. Reproduced (a cost-2 card as the only card in hand:
  `legalCommands` = pass, `forcedPass` = null). Fix: `canAffordCast` (`cp.ts`) — overpaying is legal (§11.2.2.3), so
  one `canPay` over every source the player has decides it — used by `forcedPass` and `smartPasses`. Engine and web
  cases added. Two knock-ons: the K5-A2 fixture had a Lightning Summon with only Earth cards to pay (it passed only
  because of this bug; it now holds Lightning discards), and B-A2's blind sweep found its first party split at seed
  26, so its bound goes 24 → 30.
- L1 — §15.2.5.2 now has Main Phase 2 and the post-damage `damage` window cases.
- L2 — an ETB Back Attack cast in response to a Summon: its ETB goes on top and resolves first; the turn player
  holds priority with `passes` 0.
- L3 — ISMCTS through an off-turn cast: one key across five determinisations, a legal decode in each, and the
  agent returns a legal command.

**Rejected (0).**
