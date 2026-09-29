# Rung V2 — damage-modifying replacement effects (§11.12.5), and the five Vol. 1 clauses that need them

> **STATUS: DESIGN, 2026-09-30.** Under the user's standing instruction (loop, recommended option at a crossroads, CR
> letter, split large mechanics into their own PRs). Decisions marked V2-D are mine and recorded to be overturned here.

## The clauses

The `pool-coverage` gap table (rung V1-B) names exactly these:

| Card | Printed clause | Shape |
|---|---|---|
| Wuk Lamat 27-122S | "If you control 7 or more Characters, Wuk Lamat gains 'If a Forward you control deals damage to a Forward, the damage increases by 2000 instead.'" | conditional static granting a damage-INCREASE replacement over damage dealt BY your Forwards TO Forwards |
| Charlotte 27-128S | "If Charlotte is dealt damage, reduce the damage by 1000 instead." | self damage-REDUCTION replacement |
| Porom 11-121C | "[Dull], put Porom into the Break Zone: Choose 1 Forward. During this turn, the next damage dealt to it is reduced by 2000 instead." | a one-shot, until-end-of-turn reduction created by an effect, consumed by the next damage event |
| Yuzuki 13-125R | "If a Fire Forward you control is dealt damage by your opponent's abilities, the damage becomes 0 instead." | reduction to 0, only for damage from the opponent's ABILITIES |
| Yuzuki 13-125R | "If a Water Forward you control is dealt damage, reduce the damage by 2000 instead." | reduction over your Water Forwards |

## The rules, as read from CR 3.3 and official notices

- §11.12.5.1–5: a replacement effect is an ongoing effect that waits for a replacing event and changes part or all
  of it; "instead" marks one (§11.12.5.2); it must exist BEFORE the event (§11.12.5.3); the same replacement cannot
  apply again as a result of itself (§11.12.5.5).
- §11.12.5.7: several replacements on one event — self-replacements first, then the controller of the affected card
  (or the affected player) CHOOSES the order of the rest.
- Official notice 2020-03-18 ("Change to the 'doesn't/don't receive damage' effect"): "doesn't receive damage" became
  "if dealt damage, the damage becomes 0", and the damage INCREASE and the "becomes 0" effect are applied "during the
  same step" — its example: 7000 increased by 1000 against Minwu's effect → 0.

## Design (rewritten after the Codex spec review, 2026-09-30 — adjudication `../plans/2026-09-30-rung-v2-spec.codex-review.md`)

Further rules read for the rewrite: §4.3 (a value made negative is used as negative when changed again, zero
otherwise); §15.1.1.9.8 (a blocked party's damage is CALCULATED, then may be redirected or prevented — one total,
each member a source); §15.1.1.9.10; §11.12.5.6 (self-replacement is a resolving ability replacing its OWN effects —
none of these five clauses is one); the official ruling (@FFTCG_SQEX, 2021-08-19, "damage is not damage. So, Ramuh
cannot break Garland") that damage reduced to 0 is not damage.

- **V2-D1 — one damage packet, one application point.** Every damage to a FORWARD — battle (attacker(s) → blocker;
  blocker → attacker or each split target), ability, and First Strike batches — becomes a `DamagePacket { target,
  amount, contributors: { source, sourceController }[], cause: 'battle' | 'summon' | 'ability', causeController,
  exBurst?: boolean }` applied once by `applyDamagePacket(state, packet) → { state, final, applied, trace }` (pure;
  `previewDamagePacket` for the AI). A blocked party's damage to the blocker is ONE packet with every member as a
  contributor (§15.1.1.9.8); a blocker's split is one packet per split target. Held First Strike occurrences store the
  post-replacement packet and are never modified again. PLAYER damage is out of scope (none of the five clauses
  touches it); a regression pins that unblocked and EX Burst player damage is unchanged.
- **V2-D2 — ordering is the affected controller's choice (§11.12.5.7).** When two or more replacement effects apply
  to one packet and their order changes the result, a `chooseReplacementOrder` pending goes to the controller of the
  affected Forward, and the packet resumes from it; when every order gives the same result, no prompt (the order is
  observably irrelevant). AI: enumerates the orders (at most 4 modifiers in this pool). Keys: the new pending digests
  by the ordered replacement ids.
- **V2-D3 — arithmetic (§4.3).** Modifications apply in the chosen order to the running amount, which may go
  negative between steps (§4.3 keeps the negative for the next change); the final amount below 0 is 0. Example: a
  1000 hit with Porom's −2000 then Wuk Lamat's +2000 is 1000 − 2000 = −1000, then −1000 + 2000 = 1000; the reverse
  order is 1000 + 2000 − 2000 = 1000. The orders agree, so no prompt. Pin the arithmetic in a test.
- **V2-D4 — 0 damage is not damage** (official ruling 2021-08-19; the 2020-03-18 notice). A final amount of 0 marks no
  damage and emits no `battleDamage`/`abilityDamage` and no dealt-damage trigger (Luso's break-on-damage does not
  fire); a separate non-triggering event `damageReducedToZero { target, original, trace }` narrates it. A positive
  final amount emits the usual event carrying `original` and `trace` for narration.
- **V2-D5 — Porom's shields.** Effect `shieldNextDamage { amount }` (an AST leaf; executor, validation, AI preview,
  narration, web verb). `FieldCard.shields: { id, amount, source }[]`, cleared at end of turn and when the card leaves
  the field; each shield is a distinct replacement, consumed only when it is APPLIED to a packet (if Yuzuki's
  "becomes 0" is ordered first and makes it 0, a later shield is not applied and survives — decide and pin by test).
  Shields are in the ISMCTS field digest and checked by invariants.
- **V2-D6 — cause.** Yuzuki's "by your opponent's abilities" matches `cause === 'ability'` (action, auto, special —
  NOT a Summon, including an EX Burst Summon) with `causeController` the opponent. Tests: cast Ifrit, EX Burst Ifrit,
  Warrior's burn, an auto ability, the player's own ability, battle.
- **V2-D7 — a dedicated damage-replacement collector**, not the continuous layer (which yields power/keywords/flags
  for one card): `StaticEffect { kind: 'damageReplacement', scope, when?, change: { add } | { reduce } | { becomes: 0 } }`
  with a source-aware scope (affected Forward: self / your Forwards of an element; for Wuk Lamat's increase: the
  SOURCE is a Forward you control and the target a Forward). Wuk Lamat's "gains '…'" is that static on her with
  `when: controlsAtLeast 7`. Validation and every exhaustive switch updated.
- **V2-D8 — AI** prices with `previewDamagePacket` everywhere (`targetDelta`, combat and party-split scoring); a
  dealt-damage trigger is priced only when the final amount is positive; an active shield is valued in the evaluator
  (or the measured gap recorded).
- **V2-D9 — web.** "5000 → 4000 (Charlotte)"; "reduced to 0 (Yuzuki)"; a shield badge; the order prompt names each
  replacement and its effect.
- **V2-D10 — honesty.** The gap table empties only when every one of the above is built; nothing is recorded as done
  that is simplified.

## PRs

- **V2-A1** — the damage packet refactor (V2-D1, D4's event shape) with NO modifiers: behaviour-preserving; party
  damage aggregated per §15.1.1.9.8 (the one intended behaviour change, with tests); First Strike held packets.
- **V2-A2** — replacement effects (D2, D3, D5, D6, D7), the order pending, shields, AI, web — synthetic tests.
- **V2-B** — the five clauses on the real cards, the gap table emptied, Layer 3 scenarios, strict self-play.

## Tests (acceptance)

Every case in the Codex review's list: each meaningful Wuk/Yuzuki/Porom order including deliberately non-minimal
choices; two Porom shields; Yuzuki-first shield preservation; reduced-to-0 fires no trigger; Summon vs ability vs EX
Burst; party aggregate reduction with per-contributor Wuk; blocker splits; First Strike applied once; shield expiry
and leave/re-enter; the final `DamageOccurrence.amount`; §12.4.5 breaker attribution; player damage unchanged; AI
keys/candidates; zero-damage narration; the shield badge's accessible name.

## Out of scope

Replacement effects on anything other than damage to Forwards.
