# Rung U2a plan — review adjudication

**Plan:** `docs/superpowers/plans/2026-09-30-rung-u2a-board-model.md`. **Reviewer:** a fresh Fable `verifier` agent
(read-only, with a scratch corpus replica). Codex was at its usage limit until 12:29, so Fable reviewed alone, as the
project does when Codex is unavailable.

**Verdict:** partial. The plan's code matches the codebase: every signature was checked, and the projection covers
every id the view carries. But "identical output" was unproven, and the model omitted state that U3 needs.

| # | Severity | Finding | Verdict and change |
|---|---|---|---|
| 1 | HIGH | Nothing pins the Board's DOM. The web suite pins names and behaviour, the gallery screenshots cards, and the baseline spec is skipped, so "identical output" was unproven. | **Accept.** Task 2 records every corpus position's `renderToStaticMarkup` of `<Board>` before the refactor and asserts byte-equality after, in a throwaway test deleted once it passes. |
| 2 | MEDIUM | Corpus coverage is seed-dependent and unasserted. Seeds 5–8 reach no frozen card. | **Accept.** The corpus test tallies pumped Forwards, known hand cards, spent LB cards, cards in no board zone, Break/Damage Zones and a non-empty stack, and fails if any was never reached. |
| 3 | MEDIUM | The corpus test has no timeout (4 games take about 2.8 s raw; the default is 5 s). | **Accept.** The test gets 30 s. |
| 4 | MEDIUM | The model omits state the spec (section 4.1) assigns to it and U3 diffs: the stack, turn player, priority holder, and pending kind and owner. | **Accept.** It adds `stack: StackEntryModel[]` (keyed `s:<card>` / `a:<source>:<clause>`, with an occurrence suffix), `turnPlayer`, `priority` and `pending { kind, player }`, all pure data. |
| 5 | LOW | The cleanup list misses the unused `shim` and imports; lint would catch them. | **Accept.** Listed in Task 2 step 11. |
| 6 | LOW | "Same props in the same order" is inaccurate, though unobservable. | **Accept.** It now reads "same props by value". |
| 7 | LOW | The name, face and hand-count assertions are wiring pins. | **Noted.** They pin `project` to `displayName` and `fieldCardDisplay`, which is their purpose. |

**Held up:** every signature (commands, view, setup, greedy, useGame, deck). Prop identity for pile, known-hand, LB,
hand, orphan and sheet faces, field for field. The `elsewhere` sweep catches deck-known cards, stack and placing
Summons. The spec's section 4 constraints hold.

**Backlog (pre-existing, not this rung):** for a hidden `chooseTargets` the human owes, the orphan row renders `#id`
cards. Check whether that names AI hand positions.
