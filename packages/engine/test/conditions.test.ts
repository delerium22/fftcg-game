import { describe, expect, it } from 'vitest'
import type { Ability, Condition, Effect, StaticCondition, StaticEffect } from '../src/abilities.js'
import { effectAtPath } from '../src/abilities.js'
import type { CardDef, PlayerId } from '../src/types.js'
import type { CardId, GameState } from '../src/state.js'
import { findFieldCard, keywordsOf } from '../src/state.js'
import { validateContinuousStatics } from '../src/setup.js'
import { checkInvariants } from '../src/invariants.js'
import { abilityOf, drainResolution, enqueueTrigger } from '../src/resolve.js'
import { declarationNode } from '../src/activate.js'
import { applyNow, makeDef, makeGame, VANILLA_POOL, withField, withHandSize } from './helpers.js'

/**
 * Rung V1-A1 (spec V1-D6/D7): conditions and amounts. `controlsAtLeast` counts field Characters by DEFINITION, so
 * a static reading it never reads the layer's own output. Synthetic cards.
 */

const ok = (s: GameState) => expect(checkInvariants(s)).toEqual([])
const fc = (s: GameState, id: CardId) => findFieldCard(s, id)!.card
const stat = (id: string, effect: StaticEffect): Ability => ({ id, trigger: { kind: 'static', effect }, text: `synthetic ${id}`, effects: [] })

const DEFS: CardDef[] = [
  ...VANILLA_POOL,
  // Zack 27-123S's shape: "If your opponent controls 3 or more Forwards, Zack gains Haste."
  makeDef({ code: 'T-ZACK', cost: 2, power: 7000, hasAbilities: true, abilityClauses: 1,
    abilities: [stat('T-ZACK:haste', { kind: 'grantKeyword', keyword: 'haste', to: { controller: 'self', self: true },
      when: { kind: 'controlsAtLeast', count: 3, controller: 'opponent', filter: { type: 'forward' } } })] }),
  // "If you control 2 or more Characters, <this> gains Brave." — no filter: any Character.
  makeDef({ code: 'T-CROWD', cost: 2, power: 5000, hasAbilities: true, abilityClauses: 1,
    abilities: [stat('T-CROWD:brave', { kind: 'grantKeyword', keyword: 'brave', to: { controller: 'self', self: true },
      when: { kind: 'controlsAtLeast', count: 2, controller: 'self' } })] }),
]

describe('V1-A1 — controlsAtLeast (a static condition)', () => {
  it('L1 §11.12.4.4 — "if your opponent controls 3 or more Forwards": 2 do not, 3 do, and their Backups never count', () => {
    let s = makeGame({ defs: DEFS }); let zack: CardId
    ;[s, zack] = withField(s, 0, 'forwards', 'T-ZACK')
    ;[s] = withField(s, 1, 'forwards', 'V-F1'); [s] = withField(s, 1, 'forwards', 'V-F2')
    ;[s] = withField(s, 1, 'backups', 'V-B1'); [s] = withField(s, 1, 'backups', 'V-B3')
    expect(keywordsOf(s, fc(s, zack)).has('haste'), 'two Forwards and two Backups: not three Forwards').toBe(false)
    ;[s] = withField(s, 1, 'forwards', 'V-F5')
    expect(keywordsOf(s, fc(s, zack)).has('haste')).toBe(true)
    ok(s)
  })

  it('counts relative to the source: the same three Forwards on its OWN side do not satisfy "your opponent controls"', () => {
    let s = makeGame({ defs: DEFS }); let zack: CardId
    ;[s, zack] = withField(s, 0, 'forwards', 'T-ZACK')
    ;[s] = withField(s, 0, 'forwards', 'V-F1'); [s] = withField(s, 0, 'forwards', 'V-F2'); [s] = withField(s, 0, 'forwards', 'V-F5')
    expect(keywordsOf(s, fc(s, zack)).has('haste')).toBe(false)
  })

  it('StaticScope.self: the grant reaches the source alone, not another Forward its controller has', () => {
    let s = makeGame({ defs: DEFS }); let zack: CardId, other: CardId
    ;[s, zack] = withField(s, 0, 'forwards', 'T-ZACK')
    ;[s, other] = withField(s, 0, 'forwards', 'V-F2')
    for (const code of ['V-F1', 'V-F2', 'V-F5']) [s] = withField(s, 1, 'forwards', code)
    expect(keywordsOf(s, fc(s, zack)).has('haste')).toBe(true)
    expect(keywordsOf(s, fc(s, other)).has('haste')).toBe(false)
  })

  it('with no filter counts any Character: a Forward and a Backup make 2 (the source itself counts)', () => {
    let s = makeGame({ defs: DEFS }); let crowd: CardId
    ;[s, crowd] = withField(s, 0, 'forwards', 'T-CROWD')
    expect(keywordsOf(s, fc(s, crowd)).has('brave'), 'the source alone is 1').toBe(false)
    ;[s] = withField(s, 0, 'backups', 'V-B1')
    expect(keywordsOf(s, fc(s, crowd)).has('brave')).toBe(true)
    ok(s)
  })

  it('game creation rejects a condition filter on an instance axis, a count below 1, and an unknown side', () => {
    // As data arriving through JSON would: the spreads carry what the types forbid.
    const bad = (when: StaticCondition) => makeDef({ code: 'T-BAD', hasAbilities: true, abilityClauses: 1,
      abilities: [stat('T-BAD:x', { kind: 'grantKeyword', keyword: 'haste', to: { controller: 'self', self: true }, when })] })
    expect(validateContinuousStatics([bad({ kind: 'controlsAtLeast', count: 2, controller: 'self', filter: { type: 'forward', ...({ minPower: 5000 } as object) } })]).join()).toMatch(/instance axis minPower/)
    expect(validateContinuousStatics([bad({ kind: 'controlsAtLeast', count: 0, controller: 'self' })]).join()).toMatch(/count/)
    expect(validateContinuousStatics([bad({ kind: 'controlsAtLeast', count: 1.5, controller: 'self' })]).join()).toMatch(/count/)
    expect(validateContinuousStatics([bad({ kind: 'controlsAtLeast', count: 2, controller: 'self', ...({ controller: 'any' } as object) })]).join()).toMatch(/controller/)
    expect(validateContinuousStatics(DEFS)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// The `if` effect and `subjectMatches` (spec V1-D6)
// ---------------------------------------------------------------------------

const etb = (id: string, effects: readonly Effect[]): Ability => ({ id, trigger: { kind: 'enterField' }, text: `synthetic ${id}`, effects })
const MARKED: Condition = { kind: 'controlsAtLeast', count: 1, controller: 'self', filter: { name: 'T-MARK' } }
const oneForward = (then: readonly Effect[]): Effect => ({ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'any' }, then })

// Palom 13-013C's shape: "Choose 1 Forward. If you control a Card Name Porom Forward, deal it 8000 damage. Otherwise, deal it 4000 damage."
const PALOM = etb('T-PALOM:etb', [oneForward([{ kind: 'if', when: MARKED, then: [{ kind: 'damage', amount: 8000 }], else: [{ kind: 'damage', amount: 4000 }] }])])
// A prompt INSIDE a branch: the chooser is raised at resolution, under the `if`.
const GATED = etb('T-GATED:etb', [{ kind: 'if', when: MARKED, then: [oneForward([{ kind: 'dull' }])] }])
const BY_ELEMENT = etb('T-ELEM:etb', [oneForward([{ kind: 'if', when: { kind: 'subjectMatches', filter: { element: 'fire' } }, then: [{ kind: 'damage', amount: 5000 }], else: [{ kind: 'damage', amount: 1000 }] }])])
// Porom 11-121C's shape, on a Forward: the subject has LEFT the field before the condition reads it.
const RETURN_THEN = etb('T-RET:etb', [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'self' }, then: [
  { kind: 'moveToHand' },
  { kind: 'if', when: { kind: 'subjectMatches', filter: { element: 'fire' } }, then: [{ kind: 'draw', count: 2 }], else: [{ kind: 'draw', count: 1 }] },
] }])
const IF_DEFS: CardDef[] = [
  ...VANILLA_POOL,
  makeDef({ code: 'T-MARK', type: 'backup', power: null, cost: 1 }),
  makeDef({ code: 'T-FIRE', elements: ['fire'], cost: 3, power: 9000 }),
  ...[PALOM, GATED, BY_ELEMENT, RETURN_THEN].map((a) => makeDef({ code: a.id.split(':')[0]!, cost: 2, power: 1000, hasAbilities: true, abilityClauses: 1, abilities: [a] })),
]

/** Put the clause on the agenda and run it until it asks its question, or to the end. */
const arm = (s: GameState, source: CardId, controller: PlayerId, a: Ability): GameState => drainResolution(enqueueTrigger(s, source, controller, a))[0]
const answer = (s: GameState, targets: CardId[]): GameState => applyNow(s, { type: 'chooseTargets', player: 0, targets }).state
const dmg = (s: GameState, id: CardId) => findFieldCard(s, id)?.card.damage

describe('V1-A1 — the if effect', () => {
  it('L1 §11.11 — a Palom-shaped clause deals 4000 without the named card and 8000 with it', () => {
    for (const [marked, expected] of [[false, 4000], [true, 8000]] as const) {
      let s = makeGame({ defs: IF_DEFS }); let src: CardId, big: CardId
      ;[s, src] = withField(s, 0, 'forwards', 'T-PALOM')
      ;[s, big] = withField(s, 1, 'forwards', 'V-F8')   // 9000: survives either hit, so the damage is readable
      if (marked) [s] = withField(s, 0, 'backups', 'T-MARK')
      s = arm(s, src, 0, PALOM)
      expect(s.pending?.kind).toBe('chooseTargets')
      s = answer(s, [big])
      expect(dmg(s, big), marked ? 'the then branch' : 'the else branch').toBe(expected)
      ok(s)
    }
  })

  it('a false condition with no else does nothing, and raises no prompt from the untaken branch', () => {
    let s = makeGame({ defs: IF_DEFS }); let src: CardId
    ;[s, src] = withField(s, 0, 'forwards', 'T-GATED')
    ;[s] = withField(s, 1, 'forwards', 'V-F2')
    s = arm(s, src, 0, GATED)
    expect(s.pending).toBeNull()
    expect(s.stack).toEqual([])
    ok(s)
  })

  it('a prompt inside a branch suspends on the program counter and resumes into the same branch even when the condition no longer holds', () => {
    let s = makeGame({ defs: IF_DEFS }); let src: CardId, mark: CardId, foe: CardId
    ;[s, src] = withField(s, 0, 'forwards', 'T-GATED')
    ;[s, mark] = withField(s, 0, 'backups', 'T-MARK')
    ;[s, foe] = withField(s, 1, 'forwards', 'V-F2')
    s = arm(s, src, 0, GATED)
    expect(s.pending?.kind).toBe('chooseTargets')
    const frame = s.resolution.active!
    expect(frame.path, 'if at 0, then-branch 0, chooser at 0').toEqual([0, 0, 0])
    expect(effectAtPath(abilityOf(s, frame)!.effects, frame.path, frame.modes)).toBe((GATED.effects[0] as Extract<Effect, { kind: 'if' }>).then[0])
    // The condition stops holding between the prompt and its answer: the branch was fixed when the prompt was raised.
    s = { ...s, players: [{ ...s.players[0], backups: s.players[0].backups.filter((c) => c.id !== mark), breakZone: [...s.players[0].breakZone, mark] }, s.players[1]] }
    s = answer(s, [foe])
    expect(findFieldCard(s, foe)?.card.status).toBe('dull')
    ok(s)
  })

  it('subjectMatches reads the chosen card: a Fire Forward takes 5000, an Earth one 1000', () => {
    let s = makeGame({ defs: IF_DEFS }); let src: CardId, fire: CardId, earth: CardId
    ;[s, src] = withField(s, 0, 'forwards', 'T-ELEM')
    ;[s, fire] = withField(s, 1, 'forwards', 'T-FIRE')
    ;[s, earth] = withField(s, 1, 'forwards', 'V-F8')
    const a = answer(arm(s, src, 0, BY_ELEMENT), [fire])
    expect(dmg(a, fire)).toBe(5000)
    const b = answer(arm(s, src, 0, BY_ELEMENT), [earth])
    expect(dmg(b, earth)).toBe(1000)
  })

  it('subjectMatches reads the chosen card wherever it now is: returned to hand, it is still Fire', () => {
    for (const [code, drawn] of [['T-FIRE', 2], ['V-F2', 1]] as const) {
      let s = withHandSize(makeGame({ defs: IF_DEFS }), 0, 0); let src: CardId, pick: CardId
      ;[s, src] = withField(s, 0, 'backups', 'T-RET')
      ;[s, pick] = withField(s, 0, 'forwards', code)
      s = answer(arm(s, src, 0, RETURN_THEN), [pick])
      expect(s.players[0].hand).toContain(pick)
      expect(s.players[0].hand.length, `${code}: the returned card plus ${drawn}`).toBe(1 + drawn)
      ok(s)
    }
  })

  it('an activated ability with a chooser under an if is rejected loudly (spec C3-1)', () => {
    const act: Ability = { id: 'T-ACT:x', trigger: { kind: 'activated', sourceZone: 'field', cost: { dull: true } }, text: 'synthetic', effects: [{ kind: 'draw', count: 1 }, { kind: 'if', when: MARKED, then: [oneForward([{ kind: 'dull' }])] }] }
    expect(() => declarationNode(act)).toThrow(/FIRST effect/)
    const nested: Ability = { ...act, effects: [oneForward([{ kind: 'if', when: MARKED, then: [], else: [oneForward([{ kind: 'dull' }])] }])] }
    expect(() => declarationNode(nested)).toThrow(/nested choices/)
  })
})

// ---------------------------------------------------------------------------
// Counted damage (spec V1-D7)
// ---------------------------------------------------------------------------

// Zack 27-123S's sweep: "deal each Forward opponent controls 1000 damage for each Backup you control."
const SWEEP = etb('T-SWEEP:etb', [{ kind: 'forEach', from: { zone: 'forwards', controller: 'opponent' },
  do: [{ kind: 'damage', amount: { per: { controller: 'self', filter: { type: 'backup' } }, times: 1000 } }] }])
const SWEEP_WATCH: Ability = { id: 'T-SWEEP:watch', trigger: { kind: 'dealtDamage', to: 'forward', whose: 'any' }, text: 'When this deals damage to a Forward, draw 1 card.', effects: [{ kind: 'draw', count: 1 }] }
const SWEEP_DEFS: CardDef[] = [...VANILLA_POOL, makeDef({ code: 'T-SWEEP', cost: 3, power: 7000, hasAbilities: true, abilityClauses: 2, abilities: [SWEEP, SWEEP_WATCH] })]

describe('V1-A1 — counted damage', () => {
  it('L1 §11.11 — 1000 per Backup you control: three Backups deal 3000 to each opponent Forward', () => {
    let s = withHandSize(makeGame({ defs: SWEEP_DEFS }), 0, 0); let src: CardId, a: CardId, b: CardId
    ;[s, src] = withField(s, 0, 'forwards', 'T-SWEEP')
    for (const code of ['V-B1', 'V-B3', 'V-B4']) [s] = withField(s, 0, 'backups', code)
    ;[s] = withField(s, 1, 'backups', 'V-B1')   // the opponent's Backup is not "you control"
    ;[s, a] = withField(s, 1, 'forwards', 'V-F8'); [s, b] = withField(s, 1, 'forwards', 'V-F7')
    const [t, events] = drainResolution(enqueueTrigger(s, src, 0, SWEEP))
    expect([dmg(t, a), dmg(t, b)]).toEqual([3000, 3000])
    expect(events.filter((e) => e.type === 'abilityDamage').map((e) => e.type === 'abilityDamage' && e.amount)).toEqual([3000, 3000])
    ok(t)
  })

  it('with no Backups the amount is 0: nothing is dealt, no abilityDamage event, no damage trigger', () => {
    let s = withHandSize(makeGame({ defs: SWEEP_DEFS }), 0, 0); let src: CardId, a: CardId
    ;[s, src] = withField(s, 0, 'forwards', 'T-SWEEP')
    ;[s, a] = withField(s, 1, 'forwards', 'V-F8')
    const [t, events] = drainResolution(enqueueTrigger(s, src, 0, SWEEP))
    expect(dmg(t, a)).toBe(0)
    expect(events.some((e) => e.type === 'abilityDamage')).toBe(false)
    expect(events.some((e) => e.type === 'abilityTriggered' && e.abilityId === 'T-SWEEP:watch'), 'the source dealt no damage').toBe(false)
    expect(t.resolution.queue).toEqual([])
    expect(t.players[0].hand).toEqual([])
    ok(t)
  })
})
