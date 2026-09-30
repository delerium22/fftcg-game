# Rung U2b plan — review adjudication

**Reviewer:** a fresh Fable `verifier` agent, read-only. Codex was at its usage limit until 12:29. The reviewer measured
the current board in Chromium at 1280×720 (turn 3 of seed 1), built a static mock of the plan's CSS, a two-dialog mock,
and a hand-fan mock.

**Verdict:** the layout mechanism (grid areas and `display: contents`) and the accessibility surfaces held up. The
first draft's vertical budget and two of its new pieces did not. The plan was rewritten; this file records why.

| # | Severity | Finding | Verdict and change |
|---|---|---|---|
| 1 | CRITICAL | 1280×720 cannot fit with the first draft's row model. The card clamps bottom out at 720. A bottom-right dock set the hand row's height. The seats had 224 px of 281 needed. The LB zone stacked above the hand, not beside it. The orphan and known-hand rows each add 88 px. Empty rows were shorter than filled ones. | **Accept.** The plan now carries a measured row budget. Zone labels are visually hidden (−22 px per row), the seat HUD becomes a side column (−41 px per seat), and the actions stay in the centre line. The hand row is a fixed track. The orphan row and your LB deck sit beside the hand; the AI's known hand sits beside its Backups. Empty rows reserve exactly a filled row's height. |
| 2 | HIGH | The phase tracker and the phase pill overlap in one grid cell. | **Accept.** One `.prompt__lead` wrapper holds both. |
| 3 | HIGH | The fan's arc (ends dropped) gives the hand a vertical scrollbar and clips the end cards. | **Accept.** The arc is inverted: the centre lifts into the row's headroom. `.hand` is added to the scroll check. |
| 4 | MEDIUM | Closing a card sheet opened from a pile sheet leaves focus on `body`. | **Accept.** A `useReturnFocus()` hook in both sheets, and `piles.spec` asserts focus returns. The gap exists today for the card sheet; the stacked sheets make it bite. |
| 5 | MEDIUM | The new dull rule would shrink and rotate the sheet's large card. | **Accept.** The rule is scoped with `:not(.card--large)`, so a dull card reads upright in the sheet. |
| 6 | MEDIUM | The payment/selection tray was not placed. | **Accept.** The actions stay in the centre line, in an `auto` column that widens for the tray. UO-A1 is measured with no tray open. |
| 7 | MEDIUM | `piles.spec` could click an opener behind a card sheet, and the overlap check can false-positive on a scrolling hand. | **Accept** the first: the predicate requires no open card sheet. **Noted** the second: it is a false positive, never a miss. |
| 8 | LOW | The `.zone-sheet .zone__cards` rule order matters to `card-details.test.tsx`'s stylesheet slice. `boardCardIds` still counts the AI's LB deck. The sheet has no padding. Modal openers should say `aria-haspopup`. | **Accept all four.** |
| 9 | LOW | Section 6 items absent from the plan: a full-height stack column, the Deck as a pile, the AI hand as fanned backs, and `Board.tsx` split into zone components. | **Accept:** D33 assigns them to U2c. The Deck stays a count in the HUD, because its cards are hidden. |

**Held up:** `display: contents` keeps `role=status`, `live=polite` and `atomic=true` in Chromium's accessibility tree.
`::before` places at row 3 across columns 1–3. The `.prompt__phase` predicate reaches turn 3 on seed 1 in 3.8 s, and
the zone labels match exactly. The dull arithmetic fits both slots. jsdom reads custom properties from `style`. The
DOM-order test, the `closest('.table__prompt')` inertness checks, `focus.test.tsx`, `known-hand.test.tsx` and the pile
regexes all survive.
