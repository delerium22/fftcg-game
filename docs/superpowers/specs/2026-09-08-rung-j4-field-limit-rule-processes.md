# Rung J4 — the field limits as rule processes (§7.7.3–5, §12.4.6–8)

> **STATUS: BUILT, 2026-09-08.** Bounded rung from the [rules-conformance audit](2026-09-08-rules-conformance-audit.md)'s
> ladder (J4). No plan review: three rule processes and one pending, shaped like the ones that exist. The user
> was away; the design calls are mine, recorded so they can be overturned here.

## What the rules say

- **§7.7.3** — one copy of a non-generic name per field; **§7.7.5** — at most one Light or Dark card per
  field; **§7.7.4** — at most five Backups. An ACTION that would exceed a limit is prohibited (a cast); an
  EFFECT that exceeds it is allowed to happen, and a rule process then repairs the field.
- **§12.4.6** — two or more non-generic Characters of one name under one player's control: ALL of them go to
  their owner's Break Zone. **§12.4.7** — two or more Light/Dark Characters: all of them. **§12.4.8** — six or
  more Backups: the controller CHOOSES the extra ones to put into the Break Zone, down to five.

## What the engine did

`castBlocker` refused the cast (`sameName`, `backupsFull`) — correct for an action — but entry by ability
(`putOntoField`, Hugh Yurg's search) placed a second copy and nothing repaired the field; the cards test
"can find a second copy of a name already on the field" pinned that deviation. Light/Dark had no cast check
at all. Six Backups could not be reached by any pool effect, so §12.4.8 had no code.

## Design

- **D1 — transitions, not checks.** `pendingBreakTransitions` (rules.ts) now also lists the §12.4.6 and
  §12.4.7 removals — Forwards AND Backups, `reason: 'sameName' | 'lightDark'` — so they happen in the same
  simultaneous batch as §12.4.4/§12.4.5 breaks, with the same re-check loop, the same owner's Break Zone,
  the same zone-change triggers (they are "put from the field into the Break Zone", so Lightning's watcher
  sees them) and a `putIntoBreakZone` event carrying the reason. Neither is a break: no `broken` event,
  `cannotBeBroken` does not apply.
- **D2 — §12.4.8 is a pending.** After the batch, a player with more than five Backups owes
  `{ kind: 'breakExcessBackups', player, count }`; the answer is `{ type: 'breakExcessBackups', player,
  cards }` (exactly `count` of their Backups), moved to the Break Zone with `reason: 'backupLimit'` and their
  zone-change triggers queued. Raised only when nothing else is pending (§12.3: rule processes come first,
  and an EX Burst offer is raised after them by `dealPlayerDamage`); `settle` stops on it like any pending;
  `finishEndPhase` does not start the next turn while it is owed, and the answer resumes the End Phase.
  `checkInvariants` allows a sixth Backup only while this pending is owed by its controller.
- **D3 — the cast keeps its guards, plus one.** `castBlocker` adds `lightDark` (§7.7.5); `sameName` and
  `backupsFull` stay, as §7.7.3–4 say the action is prohibited. A generic card never clashes (§7.7.3.1).
- **D4 — the AI answers it like the hand discard.** `candidateCommands` puts the lowest-valued Backups
  into the Break Zone; greedy treats it as a forced decision; the ISMCTS keys give it an action key (a set of
  field refs), a decoder and a pending key (the count).
- **D5 — the browser and the CLI narrate the reason.** "is put into the Break Zone (0 power / two of the
  same name / a second Light or Dark card / more than five Backups)"; the pending's prompt says "Put N
  Backup(s) into the Break Zone (five at most)"; the answer's label names the cards.

## Acceptance

- **J4-A1 (§12.4.6)** Two non-generic same-name Forwards on one field (one arriving by ability): both go to
  the owner's Break Zone in one batch, a watcher of "put from the field into the Break Zone" fires for each,
  no `broken` event; two generic copies stay; the opponent's same-name card is untouched; a generic and a
  non-generic of one name coexist (§7.7.3.1).
- **J4-A2 (§12.4.7)** A Light and a Dark Character on one field: both go; one alone stays.
- **J4-A3 (§12.4.8)** Six Backups: the controller owes `breakExcessBackups` with `count: 1`; `legalCommands`
  lists one command per Backup; a wrong count or a card that is not theirs is rejected; the answer leaves five,
  the sixth in the Break Zone, invariants clean throughout.
- **J4-A4 (§7.7.5)** Casting a second Light/Dark card is refused with `lightDark`; the first is castable.
- **J4-A5** Hugh Yurg finding a second Undead Princess: both Princesses end in the Break Zone (the cards test
  that pinned the deviation now asserts the rule).
- **J4-A6** ISMCTS key totality and round trip include the new command; the AI's candidate for the pending
  is the lowest-valued Backup.
