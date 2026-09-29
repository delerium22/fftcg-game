import { describe, expect, it } from 'vitest'
import type { Ability, Effect, TargetSpec } from '../src/abilities.js'
import type { CardDef } from '../src/types.js'
import type { CardId, FieldCard, GameState } from '../src/state.js'
import { findFieldCard } from '../src/state.js'
import { apply } from '../src/apply.js'
import { legalCommands } from '../src/legal.js'
import { checkInvariants } from '../src/invariants.js'
import { validateEffects } from '../src/setup.js'
import { makeDef, makeGame, VANILLA_POOL, withField, withHand, withHandSize } from './helpers.js'

/**
 * Rung V1-A2 (spec V1-D8..D11): selects, zone movements and hand targets. §11.3.3: "To select something is not
 * equivalent to to choose something" — a select is made as the ability RESOLVES, by its controller or by the
 * opponent, never declared as it is placed, never seen by a "when chosen" watcher, and never a castability gate.
 * Synthetic cards, driven through `apply` and real passes so the window between placement and resolution shows.
 */

const fc = (s: GameState, id: CardId) => findFieldCard(s, id)?.card
const ok = (s: GameState) => expect(checkInvariants(s)).toEqual([])
const pass = (s: GameState, p: 0 | 1): GameState => apply(s, { type: 'pass', player: p }).state
const stackIds = (s: GameState): string[] => s.stack.map((i) => (i.kind === 'ability' ? i.frame.abilityId : `summon:${i.card}`))
const FREE = { dullBackups: [], discards: [] }

const etb = (id: string, effects: readonly Effect[]): Ability => ({ id, trigger: { kind: 'enterField' }, text: `synthetic ${id}`, effects })
const bearer = (code: string, ...abilities: Ability[]): CardDef =>
  makeDef({ code, cost: 0, power: 1000, hasAbilities: true, abilityClauses: abilities.length, abilities })
const summonDef = (code: string, ...abilities: Ability[]): CardDef =>
  makeDef({ code, type: 'summon', power: null, cost: 0, hasAbilities: true, abilityClauses: abilities.length, abilities })

// Alphinaud 20-106R's shape: "your opponent selects 1 dull Forward they control. Put it into the Break Zone." — here
// dulling instead, so Task 1 needs no new effect.
const OPP_SELECT = etb('T-ALPH:etb', [{ kind: 'chooseTargets', select: 'opponent', min: 1, max: 1, from: { zone: 'forwards', controller: 'opponent' }, then: [{ kind: 'dull' }] }])
const PUMP: Ability = { id: 'T-PRISHE:chosen', trigger: { kind: 'observesChosen' }, text: 'synthetic: when chosen, +2000', effects: [{ kind: 'addPower', amount: 2000 }] }
// A Summon whose only node is a select over the caster's dull Forwards.
const SELECT_SUMMON: Ability = { id: 'T-SSEL:summon', trigger: { kind: 'summonResolve' }, text: 'synthetic: select 1 dull Forward you control, dull it',
  effects: [{ kind: 'chooseTargets', select: 'self', min: 1, max: 1, from: { zone: 'forwards', controller: 'self', filter: { status: 'dull' } }, then: [{ kind: 'dull' }] }] }
// Vincent 23-119R's shape: "you may select 1 Forward you control … When you do so, choose 1 Forward opponent controls".
const WHEN_YOU_DO = etb('T-VINC:etb', [{ kind: 'chooseTargets', select: 'self', onlyIfChosen: true, min: 0, max: 1, from: { zone: 'forwards', controller: 'self', filter: { excludeSource: true } }, then: [
  { kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'opponent' }, then: [{ kind: 'dull' }] },
] }])

// Alphinaud 20-106R as printed: "your opponent selects 1 dull Forward they control. Put it into the Break Zone."
const ALPHINAUD = etb('T-ALPHBZ:etb', [{ kind: 'chooseTargets', select: 'opponent', min: 1, max: 1, from: { zone: 'forwards', controller: 'opponent', filter: { status: 'dull' } }, then: [{ kind: 'putIntoBreakZone' }] }])
// Lightning's shape: "When a Forward opponent controls is put from the field into the Break Zone, draw 1 card."
const WATCH: Ability = { id: 'T-WATCH:draw', trigger: { kind: 'observesZoneChange', from: 'field', to: 'breakZone', whose: 'opponent', of: 'forward' },
  text: 'synthetic watcher', effects: [{ kind: 'draw', count: 1 }] }
// Fairy 1-170C's shape: "Choose 1 Forward. Activate it."
const FAIRY = etb('T-FAIRY:etb', [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'any' }, then: [{ kind: 'activate' }] }])

// Yuna 27-129S's shape: "you may play 1 Forward of cost 3 from your hand onto the field."
const YUNA = etb('T-YUNA:etb', [{ kind: 'chooseTargets', select: 'self', min: 0, max: 1, from: { zone: 'hand', controller: 'self', filter: { type: 'forward', cost: 3 } }, then: [{ kind: 'playOntoField' }] }])
const PLAY_BACKUP = etb('T-BKPLAY:etb', [{ kind: 'chooseTargets', select: 'self', min: 0, max: 1, from: { zone: 'hand', controller: 'self', filter: { type: 'backup' } }, then: [{ kind: 'playOntoField' }] }])
// Porom 11-121C's shape: "select 1 card in your hand. Discard it. If it is Category IV, draw 2 cards; otherwise draw 1."
const POROM = etb('T-POROM:etb', [{ kind: 'chooseTargets', select: 'self', min: 1, max: 1, from: { zone: 'hand', controller: 'self' }, then: [
  { kind: 'discard' },
  { kind: 'if', when: { kind: 'subjectMatches', filter: { category: 'IV' } }, then: [{ kind: 'draw', count: 2 }], else: [{ kind: 'draw', count: 1 }] },
] }])

const DEFS: CardDef[] = [
  ...VANILLA_POOL,
  bearer('T-ALPHBZ', ALPHINAUD),
  bearer('T-WATCH', WATCH),
  bearer('T-FAIRY', FAIRY),
  makeDef({ code: 'T-LB1', cost: 0, power: 3000, limitBreak: 1 }),
  bearer('T-YUNA', YUNA), bearer('T-BKPLAY', PLAY_BACKUP), bearer('T-POROM', POROM),
  makeDef({ code: 'T-ETB3', cost: 3, power: 7000, hasAbilities: true, abilityClauses: 1, abilities: [etb('T-ETB3:etb', [{ kind: 'draw', count: 1 }])] }),
  makeDef({ code: 'T-IV', cost: 2, power: 5000, categories: ['IV'] }),
  bearer('T-ALPH', OPP_SELECT),
  makeDef({ code: 'T-PRISHE', cost: 2, power: 5000, hasAbilities: true, abilityClauses: 1, abilities: [PUMP] }),
  summonDef('T-SSEL', SELECT_SUMMON),
  bearer('T-VINC', WHEN_YOU_DO),
]

describe('V1-A2 — a select is made at resolution, by whoever the text names', () => {
  it('L1 §11.3.3 — your opponent selects: nothing is asked as the clause is placed, and player 1 answers as it resolves', () => {
    let s = makeGame({ defs: DEFS })
    let alph: CardId, a: CardId, b: CardId
    ;[s, a] = withField(s, 1, 'forwards', 'V-F2')
    ;[s, b] = withField(s, 1, 'forwards', 'V-F7')
    ;[s, alph] = withHand(s, 0, 'T-ALPH')
    s = apply(s, { type: 'castCharacter', player: 0, card: alph, payment: FREE }).state
    expect(s.pending, 'placement declares nothing: a select is not a choice').toBeNull()
    expect(stackIds(s)).toEqual(['T-ALPH:etb'])
    s = pass(pass(s, 0), 1)
    expect(s.pending).toMatchObject({ kind: 'chooseTargets', player: 1, min: 1, max: 1, candidates: [a, b] })
    expect(s.resolution.active?.stage).toBe('resolve')
    expect(stackIds(s), 'the item is resolving, still on top of the stack').toEqual(['T-ALPH:etb'])
    ok(s)
    expect(legalCommands(s, 0).map((c) => c.type), 'the caster waits').toEqual(['concede'])
    expect(legalCommands(s, 1).filter((c) => c.type === 'chooseTargets')).toHaveLength(2)
    const r = apply(s, { type: 'chooseTargets', player: 1, targets: [b] })
    expect(fc(r.state, b)?.status).toBe('dull')
    expect(fc(r.state, a)?.status).toBe('active')
    expect(r.state.pending).toBeNull()
    expect(r.state.stack).toEqual([])
    expect(r.state.priority, 'priority returns to the turn player as after any resolution (§11.1.5)').toBe(0)
    expect(r.state.turnPlayer).toBe(0)
    ok(r.state)
  })

  it('L1 §11.3.3 — a select is not a choice: a "when chosen" watcher does not trigger', () => {
    let s = makeGame({ defs: DEFS })
    let alph: CardId, prishe: CardId
    ;[s, prishe] = withField(s, 1, 'forwards', 'T-PRISHE')
    ;[s, alph] = withHand(s, 0, 'T-ALPH')
    s = apply(s, { type: 'castCharacter', player: 0, card: alph, payment: FREE }).state
    s = pass(pass(s, 0), 1)
    const r = apply(s, { type: 'chooseTargets', player: 1, targets: [prishe] })
    expect(r.events.some((e) => e.type === 'abilityTriggered' && e.abilityId === 'T-PRISHE:chosen')).toBe(false)
    expect(stackIds(r.state)).toEqual([])
    expect(fc(r.state, prishe)?.powerBonus).toBe(0)
    ok(r.state)
  })

  it('L1 §11.3.3 — a Summon whose only node is a select with nothing to select is castable and resolves as a no-op', () => {
    let s = makeGame({ defs: DEFS })
    let card: CardId
    ;[s] = withField(s, 0, 'forwards', 'V-F2')   // active: the filter wants a dull one
    ;[s, card] = withHand(s, 0, 'T-SSEL')
    expect(legalCommands(s, 0).some((c) => c.type === 'castSummon' && c.card === card)).toBe(true)
    const cast = apply(s, { type: 'castSummon', player: 0, card, payment: FREE })
    expect(cast.state.pending, 'nothing is declared as it is cast').toBeNull()
    expect(stackIds(cast.state)).toEqual([`summon:${card}`])
    const r = apply(pass(cast.state, 0), { type: 'pass', player: 1 })
    expect(r.state.pending).toBeNull()
    expect(r.state.stack).toEqual([])
    expect(r.state.players[0].breakZone).toContain(card)
    expect(r.events.some((e) => e.type === 'abilityNoLegalTarget'), 'an empty select is not a failed choice').toBe(false)
    expect(r.events.some((e) => e.type === 'stackCancelled')).toBe(false)
    ok(r.state)
  })
})

describe('V1-A2 — onlyIfChosen: "when you do so" runs only after a pick', () => {
  function vincent(): { s: GameState; own: CardId; foe: CardId } {
    let s = makeGame({ defs: DEFS })
    let own: CardId, foe: CardId, card: CardId
    ;[s, own] = withField(s, 0, 'forwards', 'V-F2')
    ;[s, foe] = withField(s, 1, 'forwards', 'V-F7')
    ;[s, card] = withHand(s, 0, 'T-VINC')
    s = apply(s, { type: 'castCharacter', player: 0, card, payment: FREE }).state
    s = pass(pass(s, 0), 1)
    return { s, own, foe }
  }

  it('an empty answer skips everything nested: no second prompt', () => {
    const { s, foe } = vincent()
    expect(s.pending).toMatchObject({ kind: 'chooseTargets', player: 0, min: 0 })
    const r = apply(s, { type: 'chooseTargets', player: 0, targets: [] })
    expect(r.state.pending).toBeNull()
    expect(r.state.stack).toEqual([])
    expect(fc(r.state, foe)?.status).toBe('active')
    ok(r.state)
  })

  it('a pick runs the nested choice, which prompts the controller at resolution', () => {
    const { s, own, foe } = vincent()
    const picked = apply(s, { type: 'chooseTargets', player: 0, targets: [own] }).state
    expect(picked.pending).toMatchObject({ kind: 'chooseTargets', player: 0, candidates: [foe] })
    ok(picked)
    const done = apply(picked, { type: 'chooseTargets', player: 0, targets: [foe] }).state
    expect(fc(done, foe)?.status).toBe('dull')
    ok(done)
  })
})

describe('V1-A2 — game creation checks the select flags wherever they are nested', () => {
  it('rejects an unknown select and an onlyIfChosen that is not true, inside a mode and an if branch', () => {
    // As data arriving through JSON would: the spreads carry what the types forbid.
    const inMode = etb('T-BAD1:etb', [{ kind: 'chooseModes', min: 1, max: 1, modes: [{ label: 'x', effects: [
      { kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'any' }, then: [], ...({ select: 'anyone' } as object) },
    ] }] }])
    const inIf = etb('T-BAD2:etb', [{ kind: 'if', when: { kind: 'damageReceived', atLeast: 1 }, then: [], else: [
      { kind: 'chooseTargets', min: 0, max: 1, from: { zone: 'forwards', controller: 'any' }, then: [], ...({ onlyIfChosen: 1 } as object) },
    ] }])
    const problems = validateEffects([bearer('T-BAD1', inMode), bearer('T-BAD2', inIf)]).join('; ')
    expect(problems).toMatch(/T-BAD1:etb has an unknown select anyone/)
    expect(problems).toMatch(/T-BAD2:etb has an `onlyIfChosen` that is not true/)
    expect(validateEffects(DEFS)).toEqual([])
  })
})

describe('V1-A2 review — hidden hand ids never reach the stack', () => {
  const handPick = (then: readonly Effect[]): Effect => ({ kind: 'chooseTargets', select: 'self', min: 0, max: 1, from: { zone: 'hand', controller: 'self', filter: { type: 'forward' } }, then })
  const choose: Effect = { kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'opponent' }, then: [{ kind: 'dull' }] }
  it('refuses a prompt under a hand select while the pick is still in hand, and allows one after it has left', () => {
    const leaky = etb('T-LEAK:etb', [handPick([choose, { kind: 'playOntoField' }])])
    const porom = etb('T-POROM:etb', [handPick([{ kind: 'discard' }, choose])])
    const problems = validateEffects([bearer('T-LEAK', leaky), bearer('T-POROM', porom)]).join('; ')
    expect(problems).toMatch(/T-LEAK:etb prompts while a hand pick is still in hand/)
    expect(problems).not.toMatch(/T-POROM/)
  })
  it('refuses a forEach over a hand, and admits an activated ability that opens with a select (V1-A3 R10)', () => {
    const each = etb('T-EACH:etb', [{ kind: 'forEach', from: { zone: 'hand', controller: 'self' }, do: [{ kind: 'discard' }] }])
    const act: Ability = { id: 'T-ACT:play', trigger: { kind: 'activated', sourceZone: 'field', cost: { cp: { amount: 0 } } }, text: 'synthetic', effects: [handPick([{ kind: 'playOntoField' }])] }
    const problems = validateEffects([bearer('T-EACH', each), bearer('T-ACT', act)]).join('; ')
    expect(problems).toMatch(/T-EACH:etb iterates over a hand/)
    expect(problems).not.toMatch(/T-ACT/)
  })
})

describe('V1-A2 — put into the Break Zone is a zone movement, not a break (§15.1.1.3.2)', () => {
  function alphinaud(victimCode: string, over: Partial<FieldCard> = {}): { s: GameState; victim: CardId } {
    let s = makeGame({ defs: DEFS })
    let victim: CardId, card: CardId
    ;[s] = withField(s, 0, 'forwards', 'T-WATCH')
    ;[s, victim] = withField(s, 1, 'forwards', victimCode, { status: 'dull', ...over })
    ;[s, card] = withHand(s, 0, 'T-ALPHBZ')
    s = apply(s, { type: 'castCharacter', player: 0, card, payment: FREE }).state
    s = pass(pass(s, 0), 1)
    expect(s.pending).toMatchObject({ kind: 'chooseTargets', player: 1, candidates: [victim] })
    return { s, victim }
  }

  it('L1 §15.1.1.3.2 — a cannotBeBroken Forward still goes; no broken event; a field-to-Break-Zone watcher triggers', () => {
    const { s, victim } = alphinaud('V-F7', { flags: ['cannotBeBroken'] })
    const r = apply(s, { type: 'chooseTargets', player: 1, targets: [victim] })
    expect(fc(r.state, victim)).toBeUndefined()
    expect(r.state.players[1].breakZone).toContain(victim)
    expect(r.state.players[1].putIntoBreakZoneFromFieldThisTurn).toContain(victim)
    expect(r.events).toContainEqual({ type: 'putIntoBreakZone', card: victim, reason: 'ability' })
    expect(r.events.some((e) => e.type === 'broken' || e.type === 'brokenByAbility' || e.type === 'breakPrevented')).toBe(false)
    expect(r.events).toContainEqual(expect.objectContaining({ type: 'abilityTriggered', abilityId: 'T-WATCH:draw',
      cause: expect.objectContaining({ kind: 'zoneChange', card: victim, reason: 'putByAbility' }) }))
    ok(r.state)
  })

  it('L1 §15.2.8.4 — an LB Forward put into the Break Zone goes on to its LB deck face up', () => {
    const { s, victim } = alphinaud('T-LB1')
    const r = apply(s, { type: 'chooseTargets', player: 1, targets: [victim] })
    expect(r.state.players[1].breakZone).not.toContain(victim)
    expect(r.state.players[1].lbDeck).toContainEqual({ id: victim, faceUp: true })
    expect(r.events).toContainEqual({ type: 'lbReturned', player: 1, card: victim, from: 'breakZone' })
    ok(r.state)
  })
})

describe('V1-A2 — activate (§15.1.1.1)', () => {
  function fairy(status: 'active' | 'dull'): { s: GameState; target: CardId } {
    let s = makeGame({ defs: DEFS })
    let target: CardId, card: CardId
    ;[s, target] = withField(s, 1, 'forwards', 'V-F2', { status })
    ;[s, card] = withHand(s, 0, 'T-FAIRY')
    s = apply(s, { type: 'castCharacter', player: 0, card, payment: FREE }).state
    s = apply(s, { type: 'chooseTargets', player: 0, targets: [target] }).state
    return { s, target }
  }

  it('L1 §15.1.1.1.1 — activating a dull Forward turns it active', () => {
    const { s, target } = fairy('dull')
    const r = apply(pass(s, 0), { type: 'pass', player: 1 })
    expect(fc(r.state, target)?.status).toBe('active')
    expect(r.events).toContainEqual({ type: 'activatedByAbility', card: target })
    ok(r.state)
  })

  it('L1 §15.1.1.1.2 — activating an active Forward is legal and changes nothing', () => {
    const { s, target } = fairy('active')
    const r = apply(pass(s, 0), { type: 'pass', player: 1 })
    expect(fc(r.state, target)?.status).toBe('active')
    expect(r.events.some((e) => e.type === 'activatedByAbility')).toBe(false)
    expect(r.events).toContainEqual(expect.objectContaining({ type: 'stackResolved' }))
    ok(r.state)
  })
})

describe('V1-A2 — selecting from your own hand', () => {
  /** Player 0 with an empty hand but for `codes`, then `bearerCode` cast and its clause resolving: the select is owed. */
  function handSelect(bearerCode: string, codes: string[]): { s: GameState; hand: CardId[] } {
    let s = withHandSize(makeGame({ defs: DEFS }), 0, 0)
    const hand: CardId[] = []
    for (const code of codes) { let id: CardId; [s, id] = withHand(s, 0, code); hand.push(id) }
    let card: CardId
    ;[s, card] = withHand(s, 0, bearerCode)
    s = apply(s, { type: 'castCharacter', player: 0, card, payment: FREE }).state
    s = pass(pass(s, 0), 1)
    return { s, hand }
  }

  it('L1 §15.1.1.7 — play onto the field is not a cast: the Forward enters, its own ETB triggers, and no cast event', () => {
    const { s, hand } = handSelect('T-YUNA', ['T-ETB3', 'V-F2', 'V-F3'])
    const [etb3, , f3] = hand as [CardId, CardId, CardId]
    expect(s.pending, 'only the cost-3 Forwards are candidates').toMatchObject({ kind: 'chooseTargets', player: 0, min: 0, max: 1, candidates: [etb3, f3] })
    ok(s)
    const r = apply(s, { type: 'chooseTargets', player: 0, targets: [etb3] })
    expect(fc(r.state, etb3)).toBeDefined()
    expect(r.state.players[0].hand).not.toContain(etb3)
    expect(r.events).toContainEqual({ type: 'playedFromHand', player: 0, card: etb3 })
    expect(r.events.some((e) => e.type === 'cast' && e.card === etb3)).toBe(false)
    expect(stackIds(r.state), 'its enters-the-field clause went on the stack').toEqual(['T-ETB3:etb'])
    ok(r.state)
  })

  it('L1 §7.7.4 — a sixth Backup played from hand is put into the Break Zone by rule process: its controller picks which', () => {
    let { s, hand } = handSelect('T-BKPLAY', ['V-B1'])
    for (let i = 0; i < 5; i++) [s] = withField(s, 0, 'backups', 'V-B3', { status: 'dull' })
    const r = apply(s, { type: 'chooseTargets', player: 0, targets: [hand[0]!] })
    expect(r.state.players[0].backups).toHaveLength(6)
    expect(r.state.pending).toEqual({ kind: 'breakExcessBackups', player: 0, count: 1 })
    ok(r.state)
  })

  it('L1 §15.1.1.4 — discard moves the card from hand to the Break Zone, and an if reads it there', () => {
    for (const [code, draws] of [['T-IV', 2], ['V-F2', 1]] as const) {
      const { s, hand } = handSelect('T-POROM', [code])
      const before = s.players[0].hand.length
      const r = apply(s, { type: 'chooseTargets', player: 0, targets: [hand[0]!] })
      expect(r.state.players[0].breakZone).toContain(hand[0])
      expect(r.events).toContainEqual({ type: 'discarded', player: 0, card: hand[0], reason: 'ability' })
      expect(r.state.players[0].hand.length, code).toBe(before - 1 + draws)
      ok(r.state)
    }
  })

  it('game creation refuses a hand zone that is not your own, a hand zone that is not a select, and a play that could name a Summon', () => {
    const shaped = (code: string, from: TargetSpec, then: readonly Effect[] = [{ kind: 'discard' }], select?: 'self'): CardDef =>
      bearer(code, etb(`${code}:etb`, [{ kind: 'chooseTargets', min: 0, max: 1, from, then, ...(select ? { select } : {}) }]))
    const problems = validateEffects([
      shaped('T-OPPHAND', { zone: 'hand', controller: 'opponent' }, [{ kind: 'discard' }], 'self'),
      shaped('T-CHOOSEHAND', { zone: 'hand', controller: 'self' }),
      shaped('T-PLAYANY', { zone: 'hand', controller: 'self', filter: { cost: 3 } }, [{ kind: 'playOntoField' }], 'self'),
      shaped('T-PLAYSUMMON', { zone: 'hand', controller: 'self', filter: { types: ['forward', 'summon'] } }, [{ kind: 'playOntoField' }], 'self'),
    ]).join('; ')
    expect(problems).toMatch(/T-OPPHAND:etb .*hand.*your own/)
    expect(problems).toMatch(/T-CHOOSEHAND:etb .*hand.*select/)
    expect(problems).toMatch(/T-PLAYANY:etb .*Summon/)
    expect(problems).toMatch(/T-PLAYSUMMON:etb .*Summon/)
    expect(validateEffects(DEFS)).toEqual([])
  })
})
