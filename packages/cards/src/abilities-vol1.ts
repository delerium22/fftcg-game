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

// ---------------------------------------------------------------------------
// Burn
// ---------------------------------------------------------------------------

/**
 * Palom's ETB. The target is declared as the ability is put on the stack; the `if` is read as it RESOLVES (rung V1-A1),
 * so a Porom Forward that arrives or leaves in between decides the amount. "a Card Name Porom Forward" you control is
 * `controlsAtLeast 1` over your Characters filtered to Forwards named Porom: the pool's only Porom (11-121C) is a
 * Backup, so in this pool the 8000 branch is live code with no reachable case (spec V1-D3; tested synthetically).
 */
const PALOM_ETB: Ability = {
  id: '13-013C:etb',
  trigger: { kind: 'enterField' },
  text: 'When Palom enters the field, choose 1 Forward. Deal it 4000 damage. If you control a Card Name Porom Forward, deal it 8000 damage instead.',
  effects: [{
    kind: 'chooseTargets', min: 1, max: 1,
    from: { zone: 'forwards', controller: 'any' },
    then: [{
      kind: 'if', when: { kind: 'controlsAtLeast', count: 1, controller: 'self', filter: { type: 'forward', name: 'Porom' } },
      then: [{ kind: 'damage', amount: 8000 }],
      else: [{ kind: 'damage', amount: 4000 }],
    }],
  }],
}

/** LB Zack's ETB (the LB line and the LB reminder are not clauses, as for Maat). "Choose 1 Forward": either side. */
const ZACK_LB_ETB: Ability = {
  id: '22-112R:etb',
  trigger: { kind: 'enterField' },
  text: 'When Zack enters the field, choose 1 Forward. Deal it 3000 damage.',
  effects: [{
    kind: 'chooseTargets', min: 1, max: 1,
    from: { zone: 'forwards', controller: 'any' },
    then: [{ kind: 'damage', amount: 3000 }],
  }],
}

// ---------------------------------------------------------------------------
// Draw and search
// ---------------------------------------------------------------------------

/**
 * The two Vol. 1 hand draws — Geomancer 18-064C's and Red Mage 18-069C's shape: `sourceZone: 'hand'` is "You can only
 * use this ability if <card> is in your hand" (spec C3-3), and the discard of the card itself is part of the cost.
 */
const MACHINIST_DRAW: Ability = {
  id: '18-003C:draw',
  trigger: {
    kind: 'activated', sourceZone: 'hand',
    cost: { cp: { amount: 1, requiredElements: ['fire'] }, selfDiscard: true },
  },
  text: '[Fire], discard Machinist: Draw 1 card. You can only use this ability if Machinist is in your hand.',
  effects: [{ kind: 'draw', count: 1 }],
}

const GEOMANCER_WATER_DRAW: Ability = {
  id: '18-094C:draw',
  trigger: {
    kind: 'activated', sourceZone: 'hand',
    cost: { cp: { amount: 1, requiredElements: ['water'] }, selfDiscard: true },
  },
  text: '[Water], discard Geomancer: Draw 1 card. You can only use this ability if Geomancer is in your hand.',
  effects: [{ kind: 'draw', count: 1 }],
}

/** LB Leo's ETB (the LB line and the reminder are not clauses). */
const LEO_ETB: Ability = {
  id: '22-123R:etb',
  trigger: { kind: 'enterField' },
  text: 'When Leo enters the field, draw 1 card.',
  effects: [{ kind: 'draw', count: 1 }],
}

/**
 * Yuna's ETB. "You may play" is a SELECT by Yuna's controller (spec V1-D9: every "you may put / play / discard" is one),
 * over her own hand (V1-D11: the candidates are hidden from the other seat), `min: 0` for "may". "1 Forward of cost 3"
 * is `cost: 3` EXACT — Hugh Yurg's trap again: a cost-2 Forward is not playable. `type: 'forward'` also satisfies game
 * creation's rule that a `playOntoField` binding exclude Summons. Playing is not casting (§15.1.1.7): no cost, no cast
 * event; the played card's own ETB fires, and a second copy of a name already on the field meets §12.4.6.
 */
const YUNA_ETB: Ability = {
  id: '27-129S:etb',
  trigger: { kind: 'enterField' },
  text: 'When Yuna enters the field, you may play 1 Forward of cost 3 from your hand onto the field.',
  effects: [{
    kind: 'chooseTargets', select: 'self', min: 0, max: 1,
    from: { zone: 'hand', controller: 'self', filter: { type: 'forward', cost: 3 } },
    then: [{ kind: 'playOntoField' }],
  }],
}

/** Yuna's attack trigger (§10.1.2.5): Reeve's look, word for word, fired on the declaration rather than on entering. */
const YUNA_ATTACK: Ability = {
  id: '27-129S:attack',
  trigger: { kind: 'attacks' },
  text: 'When Yuna attacks, look at the top 3 cards of your deck. Add 1 card among them to your hand and return the '
    + 'other cards to the bottom of your deck in any order.',
  effects: [{
    kind: 'lookAtDeck', count: 3, audience: 'self',
    take: { min: 1, max: 1 },
    to: 'hand', rest: 'bottom',
  }],
}

/**
 * LB Luso's ETB. "choose 1 Character you control" is a head choice over the `characters` zone (rung V1-A4) — Luso
 * himself included: the text does not exclude him, and choosing him (Light) finds nothing, since no Standard Unit is
 * Light. The search's `sameElementAsChosen` is resolved by the executor into the chosen card's printed Elements (rung
 * V1-A3). "You may search" is `take.min: 0`. The search is private, as for Leonora (see its MVP0-SIMPLIFICATION on
 * §15.1.1.8.1).
 */
const LUSO_LB_ETB: Ability = {
  id: '23-130H:etb',
  trigger: { kind: 'enterField' },
  text: 'When Luso enters the field, choose 1 Character you control. You may search for 1 Job Standard Unit of the '
    + 'same Element as the chosen Character and add it to your hand.',
  effects: [{
    kind: 'chooseTargets', min: 1, max: 1,
    from: { zone: 'characters', controller: 'self' },
    then: [{
      kind: 'lookAtDeck', count: 'all', audience: 'self',
      take: { min: 0, max: 1, filter: { job: 'Standard Unit', sameElementAsChosen: true } },
      to: 'hand', rest: 'shuffle',
    }],
  }],
}

/**
 * LB Luso's watcher: Hugh Yurg's `observesEnterField` with `whose: 'self'` ("your field"). `onSource` (rung V1-A4)
 * pumps LUSO, the watcher, not the card that arrived.
 *
 * `of: 'backup'` (plan R6) reads "a Job Standard Unit" as a Backup: `of` takes one type, and every Standard Unit that
 * can enter Luso's controller's field — the Vol. 1 decks' Warrior, Machinist and Geomancer — is one. Dragoon 1-147C
 * (Vol. 2) is a Forward Standard Unit this would miss; it reaches Luso's side only in a deck mixing the two sets (the
 * proof test in `abilities-vol1.test.ts` pins both facts).
 */
const LUSO_LB_STANDARD_UNIT: Ability = {
  id: '23-130H:standard-unit',
  trigger: { kind: 'observesEnterField', whose: 'self', of: 'backup', filter: { job: 'Standard Unit' } },
  text: 'When a Job Standard Unit enters your field, Luso gains +4000 power until the end of the turn.',
  effects: [{ kind: 'onSource', do: [{ kind: 'addPower', amount: 4000 }] }],
}

// ---------------------------------------------------------------------------
// The field
// ---------------------------------------------------------------------------

/**
 * Warrior's two action abilities: Noel's and Undead Princess's self-break shape. Both print the dull icon, so both need
 * an active Warrior that has been on the field since the turn began (§11.6.2.2), and "Choose 1 Forward" is either side.
 */
const WARRIOR_PUMP: Ability = {
  id: '11-010C:pump',
  trigger: { kind: 'activated', sourceZone: 'field', cost: { dull: true, selfToBreakZone: true } },
  text: '[Dull], put Warrior into the Break Zone: Choose 1 Forward. It gains +1000 power until the end of the turn.',
  effects: [{
    kind: 'chooseTargets', min: 1, max: 1,
    from: { zone: 'forwards', controller: 'any' },
    then: [{ kind: 'addPower', amount: 1000 }],
  }],
}

/**
 * `[Fire][1]` is TWO CP, one of them Fire: `amount` counts every CP and `requiredElements` names the ones that must be
 * a given Element (Red Mage 1-121C's shape plus a generic one). The Warrior's own dull pays the `[Dull]`, never a CP.
 */
const WARRIOR_BURN: Ability = {
  id: '11-010C:burn',
  trigger: { kind: 'activated', sourceZone: 'field', cost: { cp: { amount: 2, requiredElements: ['fire'] }, dull: true, selfToBreakZone: true } },
  text: '[Fire][1][Dull], put Warrior into the Break Zone: Choose 1 Forward. Deal it 5000 damage.',
  effects: [{
    kind: 'chooseTargets', min: 1, max: 1,
    from: { zone: 'forwards', controller: 'any' },
    then: [{ kind: 'damage', amount: 5000 }],
  }],
}

/**
 * Alphinaud's ETB. "your opponent selects" is a select made by the controller's OPPONENT (spec V1-D9): not a choice
 * (§11.3.3), so it is not declared at placement, never fires "when chosen", and over no dull Forward does nothing at all
 * — no prompt and no "no legal target". `from` stays relative to Alphinaud's controller: the opponent's own Forwards.
 * "Put it into the Break Zone" is not a break (§15.1.1.3.2): `cannotBeBroken` does not stop it.
 */
const ALPHINAUD_ETB: Ability = {
  id: '20-106R:etb',
  trigger: { kind: 'enterField' },
  text: 'When Alphinaud enters the field, your opponent selects 1 dull Forward they control. Put it into the Break Zone.',
  effects: [{
    kind: 'chooseTargets', select: 'opponent', min: 1, max: 1,
    from: { zone: 'forwards', controller: 'opponent', filter: { status: 'dull' } },
    then: [{ kind: 'putIntoBreakZone' }],
  }],
}

/**
 * "Damage 3 --" is the printed shorthand for "if you have received 3 points of damage or more": a continuous
 * `modifyPower` on Alphinaud alone (`self`), with the existing `damageReceived` condition, read for his controller.
 */
const ALPHINAUD_DAMAGE_3: Ability = {
  id: '20-106R:damage-3',
  trigger: { kind: 'static', effect: { kind: 'modifyPower', amount: 2000, to: { controller: 'self', self: true }, when: { kind: 'damageReceived', atLeast: 3 } } },
  text: 'Damage 3 -- Alphinaud gains +2000 power.',
  effects: [],   // a static makes something true; it has nothing to run
}

/**
 * Ultima Weapon's two ETBs, two printed clauses with two different shapes:
 *
 * - Clause 1 CHOOSES first and tests afterwards: the Forward is declared as the clause is placed on the stack, and the
 *   `if` is read as it resolves. Below 4 Fire Characters the choice was still made (a Prishe chosen still pumps) and
 *   nothing is dealt.
 * - Clause 2 tests first: "if you control 4 or more Water Characters, your opponent selects". The select sits under
 *   the `if`, made by the opponent at resolution, over their own Forwards (Alphinaud's shape without "dull").
 *
 * "Fire Characters" is `controlsAtLeast` with an `element` filter over Forwards and Backups; a Fire/Water card counts
 * for both, Ultima Weapon itself included — it is on the field when its own ETBs resolve.
 */
const ULTIMA_WEAPON_FIRE: Ability = {
  id: '24-126H:etb-fire',
  trigger: { kind: 'enterField' },
  text: 'When Ultima Weapon enters the field, choose 1 Forward. If you control 4 or more Fire Characters, deal it 9000 damage.',
  effects: [{
    kind: 'chooseTargets', min: 1, max: 1,
    from: { zone: 'forwards', controller: 'any' },
    then: [{
      kind: 'if', when: { kind: 'controlsAtLeast', count: 4, controller: 'self', filter: { element: 'fire' } },
      then: [{ kind: 'damage', amount: 9000 }],
    }],
  }],
}

const ULTIMA_WEAPON_WATER: Ability = {
  id: '24-126H:etb-water',
  trigger: { kind: 'enterField' },
  text: 'When Ultima Weapon enters the field, if you control 4 or more Water Characters, your opponent selects 1 Forward '
    + 'they control. Put it into the Break Zone.',
  effects: [{
    kind: 'if', when: { kind: 'controlsAtLeast', count: 4, controller: 'self', filter: { element: 'water' } },
    then: [{
      kind: 'chooseTargets', select: 'opponent', min: 1, max: 1,
      from: { zone: 'forwards', controller: 'opponent' },
      then: [{ kind: 'putIntoBreakZone' }],
    }],
  }],
}

/**
 * LB Vincent's ETB. "you may put 1 Fire Backup you control" is a select by the controller, `min: 0`; "When you do so" is
 * `onlyIfChosen` (spec V1-D10): declining skips the rest, including the damage choice. The damage target is then a
 * CHOICE made as the same ability resolves — see the MVP0-SIMPLIFICATION on `onlyIfChosen` (§11.8): the printed
 * reflexive trigger is not a separate stack item. First Strike is a keyword line, not a clause.
 */
const VINCENT_ETB: Ability = {
  id: '23-119R:etb',
  trigger: { kind: 'enterField' },
  text: 'When Vincent enters the field, you may put 1 Fire Backup you control into the Break Zone. When you do so, choose '
    + '1 Forward opponent controls. Deal it 9000 damage.',
  effects: [{
    kind: 'chooseTargets', select: 'self', onlyIfChosen: true, min: 0, max: 1,
    from: { zone: 'backups', controller: 'self', filter: { element: 'fire' } },
    then: [
      { kind: 'putIntoBreakZone' },
      {
        kind: 'chooseTargets', min: 1, max: 1,
        from: { zone: 'forwards', controller: 'opponent' },
        then: [{ kind: 'damage', amount: 9000 }],
      },
    ],
  }],
}

/** "Job Warrior or Card Name Warrior" — Taivas's two clauses share it. A multi-job card matches on any of its jobs (V1-D12). */
const WARRIOR_OR_WARRIOR = [{ job: 'Warrior' }, { name: 'Warrior' }] as const

/**
 * Taivas's ETB search: Leonora's shape. With no cost limit, a second Taivas is findable (Job Warrior) — the printed text
 * allows it.
 */
const TAIVAS_SEARCH: Ability = {
  id: '21-010H:search',
  trigger: { kind: 'enterField' },
  text: 'When Taivas enters the field, you may search for 1 Job Warrior or Card Name Warrior and add it to your hand.',
  effects: [{
    kind: 'lookAtDeck', count: 'all', audience: 'self',
    take: { min: 0, max: 1, filter: { anyOf: WARRIOR_OR_WARRIOR } },
    to: 'hand', rest: 'shuffle',
  }],
}

/**
 * Taivas's `[0]`: Sphene's `[0]` activation (`yourTurnOnly`, `oncePerTurn`) over Yuna's play-from-hand select. "Play 1"
 * is mandatory, so `min: 1`; a select with nothing to select does nothing, so the ability may be activated with no
 * Warrior in hand and still spends its once-per-turn (plan R5). The select is made at resolution: the activation
 * declares no target (rung V1-A3's `declarationNode` fix). `types: ['forward', 'backup']` keeps Summons out, which game
 * creation requires of a `playOntoField` binding (no Warrior Summon exists; the filter says so rather than relying on it).
 */
const TAIVAS_PLAY: Ability = {
  id: '21-010H:play',
  trigger: { kind: 'activated', sourceZone: 'field', cost: { cp: { amount: 0 } }, oncePerTurn: true, yourTurnOnly: true },
  text: '[0]: Play 1 Job Warrior or Card Name Warrior of cost 3 or less from your hand onto the field. You can only use '
    + 'this ability during your turn and only once per turn.',
  effects: [{
    kind: 'chooseTargets', select: 'self', min: 1, max: 1,
    from: { zone: 'hand', controller: 'self', filter: { types: ['forward', 'backup'], maxCost: 3, anyOf: WARRIOR_OR_WARRIOR } },
    then: [{ kind: 'playOntoField' }],
  }],
}

/** Implemented Vol. 1 clauses by card code, spread into `ABILITIES`. Printed order within each card. */
export const VOL1_ABILITIES: Record<string, readonly Ability[]> = {
  '1-170C': [FAIRY_SUMMON],
  '3-143C': [LEONORA_ETB],
  '11-010C': [WARRIOR_PUMP, WARRIOR_BURN],
  '12-005C': [IFRIT_SUMMON],
  '13-013C': [PALOM_ETB],
  '18-003C': [MACHINIST_DRAW],
  '18-094C': [GEOMANCER_WATER_DRAW],
  '20-106R': [ALPHINAUD_ETB, ALPHINAUD_DAMAGE_3],
  '21-001R': [WARD_ONLY_FIRE, WARD_ETB],
  '21-010H': [TAIVAS_SEARCH, TAIVAS_PLAY],
  '22-112R': [ZACK_LB_ETB],
  '22-123R': [LEO_ETB],
  '23-119R': [VINCENT_ETB],
  '23-130H': [LUSO_LB_ETB, LUSO_LB_STANDARD_UNIT],
  '24-126H': [ULTIMA_WEAPON_FIRE, ULTIMA_WEAPON_WATER],
  '27-129S': [YUNA_ETB, YUNA_ATTACK],
}

/** Vol. 1 clauses left unimplemented on purpose, spread into `INERT_CLAUSES` (each with its proof in `abilities.test.ts`). */
export const VOL1_INERT: Record<string, { readonly count: number; readonly why: string }> = {
}
