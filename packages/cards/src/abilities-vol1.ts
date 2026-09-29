import type { Ability } from '@fftcg/engine'

/**
 * Rung V1-B: the hand-written ability ASTs of the Starter Set 2025 Vol. 1 pool (Fire/Water, Zack) — spec
 * `2026-09-29-rung-v1-vol1-pool.md`, V1-D1 (the list), V1-D3 (the table) and V1-D4 (the clauses left for rung V2).
 *
 * The same rules as `abilities.ts`, which spreads these three maps into its own: plain readonly data (these ride on
 * `CardDef` through `structuredClone`), one const per clause, `text` quoted verbatim from the printed card (the SE
 * endpoint's wording, or Materia Hunter's for the four exclusives, which the SE endpoint does not carry).
 */

// ---------------------------------------------------------------------------
// Per-clause coverage (spec C1-9; V1-B plan R2)
// ---------------------------------------------------------------------------

/**
 * AST units per card, implemented or not — see `ABILITY_CLAUSES` in `abilities.ts`. "When X enters the field or
 * attacks" is ONE printed clause encoded as TWO abilities (`:etb`, `:attack`), and counts 2 here (R2): a count of the
 * printed text would let the two encoded halves hide a real gap on the same card (Wuk Lamat's clause 1).
 */
export const VOL1_CLAUSES: Record<string, number> = {
  '27-122S': 3,   // static (V2: damage +2000, a replacement) | ETB | attack — the last two one printed clause
  '27-123S': 3,   // static Haste | ETB sweep | attack sweep — the last two one printed clause
  '27-128S': 3,   // damage −1000 (V2) | cannot be chosen by cost-1 Summons (inert) | the action-ability ban
  '27-129S': 2,   // ETB play a cost-3 Forward | attack: look at the top 3
  '1-170C': 1,    // EX BURST activate, draw
  '3-143C': 1,    // EX BURST ETB search Palom or Porom
  '11-010C': 2,   // [Dull], self-break: +1000 | [Fire][1][Dull], self-break: 5000 damage
  '11-121C': 2,   // ETB discard, then draw | [Dull], self-break: next damage −2000 (V2)
  '12-005C': 1,   // EX BURST 9000 damage
  '13-013C': 1,   // ETB 4000, or 8000 with a Porom Forward
  '13-125R': 2,   // both damage replacements (V2)
  '18-003C': 1,   // [Fire], discard: draw 1
  '18-094C': 1,   // [Water], discard: draw 1
  '18-129C': 2,   // [Fire][Water]: Haste, First Strike, Brave | special ability Jecht Beam
  '20-106R': 2,   // ETB the opponent selects a dull Forward | Damage 3: +2000
  '21-001R': 2,   // only Fire CP | EX BURST ETB 7000
  '21-010H': 2,   // ETB search | [0]: play from hand
  '22-112R': 1,   // ETB 3000 (the LB line and the reminder are not clauses)
  '22-123R': 1,   // ETB draw 1
  '23-119R': 1,   // ETB put a Fire Backup, when you do so 9000 (First Strike is a keyword line)
  '23-130H': 2,   // ETB search by the chosen Character's Element | a Standard Unit enters: +4000
  '24-126H': 2,   // ETB 9000 with 4 Fire Characters | ETB with 4 Water Characters: the opponent selects
}

// ---------------------------------------------------------------------------
// The EX BURST cards
// ---------------------------------------------------------------------------

/**
 * Ifrit's Summon. "Choose 1 Forward" is unrestricted, so `controller: 'any'`, as for Odin and Ramuh. The `EX BURST` tag
 * is quoted because it is printed; `exBurst` marks this as the clause a damage reveal may use (§11.10).
 */
const IFRIT_SUMMON: Ability = {
  id: '12-005C:summon',
  exBurst: true,
  trigger: { kind: 'summonResolve' },
  text: 'EX BURST Choose 1 Forward. Deal it 9000 damage.',
  effects: [{
    kind: 'chooseTargets', min: 1, max: 1,
    from: { zone: 'forwards', controller: 'any' },
    then: [{ kind: 'damage', amount: 9000 }],
  }],
}

/**
 * Fairy's Summon. "Activate it" is the `activate` effect (§15.1.1.1; an active Forward stays active). The draw sits
 * INSIDE the chooser's `then` (plan R9): the Summon has one target, and §11.11.2 cancels the whole item when that target
 * is no longer legal at resolution, so "Draw 1 card" goes with it. As a `then` sibling it would still draw.
 */
const FAIRY_SUMMON: Ability = {
  id: '1-170C:summon',
  exBurst: true,
  trigger: { kind: 'summonResolve' },
  text: 'EX BURST Choose 1 Forward. Activate it. Draw 1 card.',
  effects: [{
    kind: 'chooseTargets', min: 1, max: 1,
    from: { zone: 'forwards', controller: 'any' },
    then: [{ kind: 'activate' }, { kind: 'draw', count: 1 }],
  }],
}

/**
 * Leonora's ETB: Hugh Yurg's search shape (`count: 'all'`, private, "you may" = `take.min: 0`, then shuffle), taking to
 * hand. "Card Name Palom or Card Name Porom" is an `anyOf` of two names.
 *
 * MVP0-SIMPLIFICATION (§15.1.1.8.1): a search REVEALS the card it finds. `lookAtDeck` has no "reveal the taken card only"
 * audience — `all` would show the opponent the whole deck — so the found card goes to hand unseen by the opponent.
 */
const LEONORA_ETB: Ability = {
  id: '3-143C:etb',
  exBurst: true,
  trigger: { kind: 'enterField' },
  text: 'EX BURST When Leonora enters the field, you may search for 1 Card Name Palom or Card Name Porom and add it to your hand.',
  effects: [{
    kind: 'lookAtDeck', count: 'all', audience: 'self',
    take: { min: 0, max: 1, filter: { anyOf: [{ name: 'Palom' }, { name: 'Porom' }] } },
    to: 'hand', rest: 'shuffle',
  }],
}

/**
 * Ward's first clause: a static read by `castRequirement` wherever Ward is cast from (rung V1-A3, V1-D14). No CP of
 * another Element may pay for Ward, overpay included. A card PLAYED onto the field (Taivas's `[0]`) is not cast and pays
 * nothing, so the clause does not reach it.
 */
const WARD_ONLY_FIRE: Ability = {
  id: '21-001R:only-fire',
  trigger: { kind: 'static', effect: { kind: 'onlyCp', element: 'fire' } },
  text: 'You can only pay with Fire CP to cast Ward.',
  effects: [],   // a static makes something true; it has nothing to run
}

/** Ward's second clause, the one the EX BURST tag prefixes. "Choose 1 Forward": either side. */
const WARD_ETB: Ability = {
  id: '21-001R:etb',
  exBurst: true,
  trigger: { kind: 'enterField' },
  text: 'EX BURST When Ward enters the field, choose 1 Forward. Deal it 7000 damage.',
  effects: [{
    kind: 'chooseTargets', min: 1, max: 1,
    from: { zone: 'forwards', controller: 'any' },
    then: [{ kind: 'damage', amount: 7000 }],
  }],
}

/** Implemented Vol. 1 clauses by card code, spread into `ABILITIES`. Printed order within each card. */
export const VOL1_ABILITIES: Record<string, readonly Ability[]> = {
  '1-170C': [FAIRY_SUMMON],
  '3-143C': [LEONORA_ETB],
  '12-005C': [IFRIT_SUMMON],
  '21-001R': [WARD_ONLY_FIRE, WARD_ETB],
}

/** Vol. 1 clauses left unimplemented on purpose, spread into `INERT_CLAUSES` (each with its proof in `abilities.test.ts`). */
export const VOL1_INERT: Record<string, { readonly count: number; readonly why: string }> = {
}
