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
  '23-119R': 2,   // ETB put a Fire Backup | when you do so 9000 — one printed clause, two AST units (First Strike is a keyword line)
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
 * MVP0-SIMPLIFICATION (§15.1.1.8.1, rung V1-E): a search REVEALS the card it finds. `lookAtDeck` has no "reveal the taken
 * card only" audience — `all` would show the opponent the whole deck — so the found card goes to hand unseen by the
 * opponent.
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
 * Ward's first clause: a static read by `castRequirement` wherever Ward is cast from (rung V1-A3, V1-D14). A card PLAYED
 * onto the field (Taivas's `[0]`) is not cast and pays nothing, so the clause does not reach it. It restricts the CP
 * spent, not the CP generated (§11.2.2.3, rung V1-D): Water CP may be generated beside enough Fire CP and go unspent.
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

/**
 * Yuna's attack trigger (§10.1.2.5): Reeve's look, word for word, fired on the declaration rather than on entering.
 *
 * MVP0-SIMPLIFICATION (spec C9, rung V1-D): "return the other cards to the bottom of your deck in any order" keeps the
 * exposed order; the controller does not choose it (the `rest: 'bottom'` marker in the engine's `resolve.ts`).
 */
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
 * V1-A3). "You may search" is `take.min: 0`.
 *
 * MVP0-SIMPLIFICATION (§15.1.1.8.1, rung V1-E): the search does not reveal the found card, as for Leonora.
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
 * pumps LUSO, the watcher, not the card that arrived. "a Job Standard Unit" is any Character with that Job: a Backup
 * (Warrior, Machinist, Geomancer) or a Forward (Dragoon 1-147C), so `of` lists both (rung V1-A5).
 */
const LUSO_LB_STANDARD_UNIT: Ability = {
  id: '23-130H:standard-unit',
  trigger: { kind: 'observesEnterField', whose: 'self', of: ['forward', 'backup'], filter: { job: 'Standard Unit' } },
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
 * - Clause 2 is a CONDITIONAL auto-ability (§11.8.13, rung V1-D): "When …, if you control 4 or more Water Characters,
 *   your opponent selects". The condition is `triggerIf`: read as Ultima Weapon enters (below 4, the clause does not
 *   trigger at all) and again as it resolves (§11.11.3: below 4 then, it is removed from the stack). The select is made
 *   by the opponent at resolution, over their own Forwards (Alphinaud's shape without "dull").
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
  triggerIf: { kind: 'controlsAtLeast', count: 4, controller: 'self', filter: { element: 'water' } },
  text: 'When Ultima Weapon enters the field, if you control 4 or more Water Characters, your opponent selects 1 Forward '
    + 'they control. Put it into the Break Zone.',
  effects: [{
    kind: 'chooseTargets', select: 'opponent', min: 1, max: 1,
    from: { zone: 'forwards', controller: 'opponent' },
    then: [{ kind: 'putIntoBreakZone' }],
  }],
}

/**
 * LB Vincent's ETB. "you may put 1 Fire Backup you control" is a select by the controller, `min: 0`; `onlyIfChosen` (spec
 * V1-D10): declining puts nothing and triggers nothing. First Strike is a keyword line, not a clause.
 *
 * "When you do so, …" is a separate auto-ability (rung V1-D): the official ruling of 2019-07-19 (Fusilier 9-013C) puts
 * it on the stack after the first part resolves, and players may respond. So the put fires `VINCENT_WHEN_YOU_DO_SO`
 * with `triggerReflexive`, and the printed clause is two AST units (`VOL1_CLAUSES` counts 2).
 */
const VINCENT_ETB: Ability = {
  id: '23-119R:etb',
  trigger: { kind: 'enterField' },
  text: 'When Vincent enters the field, you may put 1 Fire Backup you control into the Break Zone.',
  effects: [{
    kind: 'chooseTargets', select: 'self', onlyIfChosen: true, min: 0, max: 1,
    from: { zone: 'backups', controller: 'self', filter: { element: 'fire' } },
    then: [{ kind: 'putIntoBreakZone' }, { kind: 'triggerReflexive', abilityId: '23-119R:when-you-do-so' }],
  }],
}

/**
 * Vincent's "When you do so": a `reflexive` clause, fired only by his ETB's put. Its "choose" is declared as it is placed
 * on the stack — with no opposing Forward then, it is removed (§11.8.4) — and a Forward that has left by the time it
 * resolves cancels it (§11.11.2).
 */
const VINCENT_WHEN_YOU_DO_SO: Ability = {
  id: '23-119R:when-you-do-so',
  trigger: { kind: 'reflexive' },
  text: 'When you do so, choose 1 Forward opponent controls. Deal it 9000 damage.',
  effects: [{
    kind: 'chooseTargets', min: 1, max: 1,
    from: { zone: 'forwards', controller: 'opponent' },
    then: [{ kind: 'damage', amount: 9000 }],
  }],
}

/** "Job Warrior or Card Name Warrior" — Taivas's two clauses share it. A multi-job card matches on any of its jobs (V1-D12). */
const WARRIOR_OR_WARRIOR = [{ job: 'Warrior' }, { name: 'Warrior' }] as const

/**
 * Taivas's ETB search: Leonora's shape. With no cost limit, a second Taivas is findable (Job Warrior) — the printed text
 * allows it.
 *
 * MVP0-SIMPLIFICATION (§15.1.1.8.1, rung V1-E): the search does not reveal the found card, as for Leonora.
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

// ---------------------------------------------------------------------------
// Specials and statics
// ---------------------------------------------------------------------------

/**
 * Jecht's first clause: an action ability with no dull icon, so it is usable the turn he enters and while dull.
 * "Jecht gains" is `onSource` (rung V1-A4): the text names the card, so there is no choice to make. `[Fire][Water]` is
 * two CP, one of each.
 */
const JECHT_GAINS: Ability = {
  id: '18-129C:gains',
  trigger: { kind: 'activated', sourceZone: 'field', cost: { cp: { amount: 2, requiredElements: ['fire', 'water'] } }, yourTurnOnly: true },
  text: '[Fire][Water]: Until the end of the turn, Jecht gains Haste, First Strike and Brave. You can only use this '
    + 'ability during your turn.',
  effects: [{
    kind: 'onSource',
    do: [
      { kind: 'grantKeyword', keyword: 'haste' },
      { kind: 'grantKeyword', keyword: 'firstStrike' },
      { kind: 'grantKeyword', keyword: 'brave' },
    ],
  }],
}

/**
 * Jecht Beam, a SPECIAL ability (§11.7, rung V1-A3): the S icon is `discardSameName` — discard another card named Jecht
 * from hand — and the dull icon is his own. Not an action ability, so Charlotte's ban does not reach it.
 *
 * "Choose 1 Forward" is `controller: 'any'`, Jecht included. Open reading (plan R10): §11.7.5 says a special ability's
 * source "cannot choose themselves"; whether that removes the source card from "Choose 1 Forward" is not settled here,
 * and the engine does not exclude it (as for every other "Choose 1 Forward" in the pool).
 */
const JECHT_BEAM: Ability = {
  id: '18-129C:jecht-beam',
  trigger: { kind: 'activated', sourceZone: 'field', cost: { dull: true, discardSameName: true }, special: { name: 'Jecht Beam' } },
  text: 'Jecht Beam [S][Dull]: Choose 1 Forward. Deal it 8000 damage.',
  effects: [{
    kind: 'chooseTargets', min: 1, max: 1,
    from: { zone: 'forwards', controller: 'any' },
    then: [{ kind: 'damage', amount: 8000 }],
  }],
}

/**
 * Zack's Haste: a continuous `grantKeyword` on Zack alone (`self`, not a name filter — LB Zack 22-112R shares the name,
 * and this Haste is not his), while the OPPONENT controls 3 or more Forwards, read by the layer each time it is asked.
 */
const ZACK_HASTE: Ability = {
  id: '27-123S:haste',
  trigger: {
    kind: 'static',
    effect: { kind: 'grantKeyword', keyword: 'haste', to: { controller: 'self', self: true }, when: { kind: 'controlsAtLeast', count: 3, controller: 'opponent', filter: { type: 'forward' } } },
  },
  text: 'If your opponent controls 3 or more Forwards, Zack gains Haste.',
  effects: [],   // a static makes something true; it has nothing to run
}

/**
 * "deal 1000 damage for each Backup you control to all the Forwards opponent control": untargeted (`forEach`, no
 * prompt), counted as each hit resolves (spec V1-D7) — every hit of one sweep reads the same count, since breaks are
 * rule processes between frames. With no Backup the amount is 0 and each hit is skipped: no damage, no event.
 */
const ZACK_SWEEP = [{
  kind: 'forEach',
  from: { zone: 'forwards', controller: 'opponent' },
  do: [{ kind: 'damage', amount: { per: { controller: 'self', filter: { type: 'backup' } }, times: 1000 } }],
}] as const satisfies Ability['effects']

/** "When Zack enters the field or attacks" — one printed clause, two triggers sharing one effect list (plan R2). */
const ZACK_ETB: Ability = {
  id: '27-123S:etb',
  trigger: { kind: 'enterField' },
  text: 'When Zack enters the field or attacks, deal 1000 damage for each Backup you control to all the Forwards opponent control.',
  effects: ZACK_SWEEP,
}

const ZACK_ATTACK: Ability = {
  id: '27-123S:attack',
  trigger: { kind: 'attacks' },
  text: ZACK_ETB.text,
  effects: ZACK_SWEEP,
}

/**
 * Wuk Lamat's clause 2, the same two-trigger split as Zack. The Forward is CHOSEN as the clause is placed; "If you control
 * 5 or more Characters" is read as it resolves (Palom's shape), over Forwards and Backups, Wuk Lamat included.
 *
 * Her clause 1 ("If you control 7 or more Characters, Wuk Lamat gains 'If a Forward you control deals damage to a
 * Forward, the damage increases by 2000 instead.'") is a replacement effect: rung V2 (spec V1-D4). It stays
 * unimplemented, not inert — it would change play — so she warns about it and `pool-coverage` lists the gap.
 */
const WUK_LAMAT_CLAUSE_2 = [{
  kind: 'chooseTargets', min: 1, max: 1,
  from: { zone: 'forwards', controller: 'opponent' },
  then: [{ kind: 'if', when: { kind: 'controlsAtLeast', count: 5, controller: 'self' }, then: [{ kind: 'damage', amount: 7000 }] }],
}] as const satisfies Ability['effects']

const WUK_LAMAT_ETB: Ability = {
  id: '27-122S:etb',
  trigger: { kind: 'enterField' },
  text: 'When Wuk Lamat enters the field or attacks, choose 1 Forward opponent controls. If you control 5 or more Characters, deal it 7000 damage.',
  effects: WUK_LAMAT_CLAUSE_2,
}

const WUK_LAMAT_ATTACK: Ability = {
  id: '27-122S:attack',
  trigger: { kind: 'attacks' },
  text: WUK_LAMAT_ETB.text,
  effects: WUK_LAMAT_CLAUSE_2,
}

/**
 * Charlotte's clause 3 (rung V1-A3, V1-D15): a continuous `grantFlag` over the opponent's Forwards, read by
 * `activationCheck`. An action ability only; a special ability (Jecht Beam) stays usable. Clause 1 (damage −1000) is a
 * replacement effect for rung V2; clause 2 is inert (`VOL1_INERT`).
 */
const CHARLOTTE_BAN: Ability = {
  id: '27-128S:no-action-abilities',
  trigger: {
    kind: 'static',
    effect: { kind: 'grantFlag', flag: 'cannotUseActionAbilities', to: { controller: 'opponent', filter: { type: 'forward' } } },
  },
  text: 'The Forwards opponent controls cannot use action abilities.',
  effects: [],   // a static makes something true; it has nothing to run
}

/**
 * Porom's clause 1. "discard 1 card from your hand" is a select by Porom's controller over their own hand (V1-D9/D11);
 * `subjectMatches` then reads the discarded card where it now is, in the Break Zone (V1-D6). The Category IV branch
 * ends in a second hand select. Palom is PICTLOGICA · IV, so she is Category IV; Porom and Leonora are IV too.
 *
 * Reading: with an empty hand nothing is discarded, so there is no "discarded card" for either sentence to test, and
 * nothing is drawn — the select with no candidate skips its `then`. Clause 2 ("the next damage dealt to it is reduced
 * by 2000") is a replacement effect for rung V2.
 */
const POROM_ETB: Ability = {
  id: '11-121C:etb',
  trigger: { kind: 'enterField' },
  text: 'When Porom enters the field, discard 1 card from your hand. If the discarded card is not a Category IV card, draw '
    + '1 card. If the discarded card is a Category IV card, draw 2 cards then discard 1 card from your hand.',
  effects: [{
    kind: 'chooseTargets', select: 'self', min: 1, max: 1,
    from: { zone: 'hand', controller: 'self' },
    then: [
      { kind: 'discard' },
      {
        kind: 'if', when: { kind: 'subjectMatches', filter: { category: 'IV' } },
        then: [
          { kind: 'draw', count: 2 },
          { kind: 'chooseTargets', select: 'self', min: 1, max: 1, from: { zone: 'hand', controller: 'self' }, then: [{ kind: 'discard' }] },
        ],
        else: [{ kind: 'draw', count: 1 }],
      },
    ],
  }],
}

/** Implemented Vol. 1 clauses by card code, spread into `ABILITIES`. Printed order within each card. */
export const VOL1_ABILITIES: Record<string, readonly Ability[]> = {
  '1-170C': [FAIRY_SUMMON],
  '3-143C': [LEONORA_ETB],
  '11-010C': [WARRIOR_PUMP, WARRIOR_BURN],
  // Clause 1 only; clause 2 (the next damage −2000) is rung V2.
  '11-121C': [POROM_ETB],
  '12-005C': [IFRIT_SUMMON],
  '13-013C': [PALOM_ETB],
  '18-003C': [MACHINIST_DRAW],
  '18-094C': [GEOMANCER_WATER_DRAW],
  '18-129C': [JECHT_GAINS, JECHT_BEAM],
  '20-106R': [ALPHINAUD_ETB, ALPHINAUD_DAMAGE_3],
  '21-001R': [WARD_ONLY_FIRE, WARD_ETB],
  '21-010H': [TAIVAS_SEARCH, TAIVAS_PLAY],
  '22-112R': [ZACK_LB_ETB],
  '22-123R': [LEO_ETB],
  '23-119R': [VINCENT_ETB, VINCENT_WHEN_YOU_DO_SO],
  '23-130H': [LUSO_LB_ETB, LUSO_LB_STANDARD_UNIT],
  '24-126H': [ULTIMA_WEAPON_FIRE, ULTIMA_WEAPON_WATER],
  // Clause 1 (the +2000 replacement) is rung V2; clause 2 is the `:etb` and `:attack` pair.
  '27-122S': [WUK_LAMAT_ETB, WUK_LAMAT_ATTACK],
  '27-123S': [ZACK_HASTE, ZACK_ETB, ZACK_ATTACK],
  // Clause 3 only: clause 1 (damage −1000) is rung V2 and clause 2 is inert (`VOL1_INERT`).
  '27-128S': [CHARLOTTE_BAN],
  '27-129S': [YUNA_ETB, YUNA_ATTACK],
}

/** Vol. 1 clauses left unimplemented on purpose, spread into `INERT_CLAUSES` (each with its proof in `abilities.test.ts`). */
export const VOL1_INERT: Record<string, { readonly count: number; readonly why: string }> = {
  // Charlotte's clause 2, "The Forwards you control cannot be chosen by your opponent's Summons of cost 1." Neither pool
  // prints a Summon of cost 1 (Vol. 2: Shiva 3, Odin 5, Ramuh 2; Vol. 1: Fairy 2, Ifrit 5), and nothing changes a
  // card's printed cost (Odin's reduction is of what casting it costs).
  '27-128S': { count: 1, why: 'no Summon of cost 1 exists in either pool, so no opponent Summon of cost 1 can choose anything' },
}
