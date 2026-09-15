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
