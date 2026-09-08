import { describe, expect, it } from 'vitest'
import { apply, isLegal, legalCommands, viewFor, type Ability, type CardId, type GameState } from '@fftcg/engine'
import { boundsFor, candidatesFor, completedChoice, extendableWith, refusal, selectionText, setKindFor, toggled, type Selection } from '../src/game/selection.js'
import { stateShim } from '../src/game/commands.js'
import { HUMAN } from '../src/game/types.js'
import { VANILLA_POOL, endPhase, makeDef, makeGame, withField, withHand, withHandSize } from '../../../packages/engine/test/helpers.js'

/**
 * Rung J7 — the set picker's model, engine-checked: every set it lets Confirm submit is one `isLegal` accepts,
 * and a card is offered only while a legal completion is still reachable.
 */

const PICK3: Ability = {
  id: 'T-PICK3:etb', trigger: { kind: 'enterField' }, text: 'choose up to 3 Forwards, dull them',
  effects: [{ kind: 'chooseTargets', min: 0, max: 3, from: { zone: 'forwards', controller: 'any' }, then: [{ kind: 'dull' }] }],
}
const DEFS = [...VANILLA_POOL, makeDef({ code: 'T-PICK3', cost: 0, hasAbilities: true, abilityClauses: 1, abilities: [PICK3] })]
const sel = (kind: Selection['kind'], chosen: CardId[]): Selection => ({ kind, chosen })

describe('an attack party, built one Forward at a time', () => {
  function board(): { s: GameState; earth: CardId[]; lightning: CardId } {
    let s = endPhase(makeGame({ defs: DEFS })); const earth: CardId[] = []; let lightning: CardId
    for (const code of ['V-F1', 'V-F2', 'V-F5']) { let id: CardId; [s, id] = withField(s, 0, 'forwards', code); earth.push(id) }
    ;[s, lightning] = withField(s, 0, 'forwards', 'V-F3')
    return { s, earth, lightning }
  }
  it('is the decision at declaration with two or more ready Forwards; the candidates are the eligible ones', () => {
    const { s, earth, lightning } = board()
    const v = viewFor(s, HUMAN)
    expect(setKindFor(v)).toBe('attackers')
    expect(candidatesFor(v, 'attackers')).toEqual([...earth, lightning])
    expect(boundsFor(v, 'attackers')).toEqual({ min: 1, max: 4 })
  })
  it('offers only Forwards that keep the party legal, refuses an empty party, and submits a command the engine accepts', () => {
    const { s, earth, lightning } = board()
    const v = viewFor(s, HUMAN)
    let p = sel('attackers', [])
    expect(refusal(v, p)).toMatch(/choose 1 more/)
    p = toggled(p, earth[0]!)
    expect(extendableWith(v, p, earth[1]!)).toBe(true)
    expect(extendableWith(v, p, lightning), 'a lightning Forward cannot join an earth party').toBe(false)
    expect(extendableWith(v, p, earth[0]!), 'already chosen').toBe(false)
    p = toggled(p, earth[1]!)
    expect(refusal(v, p)).toBeNull()
    const choice = completedChoice(v, p)!
    expect(choice.command).toEqual({ type: 'declareAttack', player: HUMAN, attackers: [earth[0], earth[1]] })
    expect(isLegal(s, choice.command)).toBeNull()
    expect(choice.label).toMatch(/^Attack with /)
    expect(selectionText(v, p, (id) => `#${id}`)).toBe(`Attack with: #${earth[0]}, #${earth[1]} — 2 chosen (1–4)`)
    // The same command the list spells out, so nothing about the answer changed — only how it was picked.
    expect(legalCommands(s, HUMAN)).toContainEqual(choice.command)
  })
})

describe('"choose up to 3" targets', () => {
  it('bounds by max, allows the empty answer when min is 0, and refuses a fourth', () => {
    let s = makeGame({ defs: DEFS }); const fwd: CardId[] = []
    for (let i = 0; i < 5; i++) { let id: CardId; [s, id] = withField(s, i % 2 as 0 | 1, 'forwards', 'V-F1'); fwd.push(id) }
    let card: CardId
    ;[s, card] = withHand(s, 0, 'T-PICK3')
    s = apply(s, { type: 'castCharacter', player: 0, card, payment: { dullBackups: [], discards: [] } }).state
    const v = viewFor(s, HUMAN)
    expect(setKindFor(v)).toBe('targets')
    expect(boundsFor(v, 'targets')).toEqual({ min: 0, max: 3 })
    let p = sel('targets', [])
    expect(refusal(v, p), 'up to 3 includes none').toBeNull()
    for (const id of fwd.slice(0, 3)) { expect(extendableWith(v, p, id)).toBe(true); p = toggled(p, id) }
    expect(extendableWith(v, p, fwd[3]!), 'a fourth').toBe(false)
    expect(refusal(v, p)).toBeNull()
    expect(isLegal(stateShim(v), completedChoice(v, p)!.command)).toBeNull()
  })
})

describe('discard to hand size', () => {
  it('needs exactly `count`, refuses one more, and only hand cards', () => {
    let s = withHandSize(makeGame(), 0, 0)
    const hand: CardId[] = []
    for (let i = 0; i < 7; i++) { let id: CardId; [s, id] = withHand(s, 0, 'V-F1'); hand.push(id) }
    s = { ...s, phase: 'end', pending: { kind: 'discardToHandSize', player: 0, count: 2 } }
    const v = viewFor(s, HUMAN)
    expect(setKindFor(v)).toBe('discards')
    let p = sel('discards', [hand[0]!])
    expect(refusal(v, p)).toMatch(/1 more/)
    expect(extendableWith(v, p, 99_999), 'not a hand card').toBe(false)
    p = toggled(p, hand[1]!)
    expect(extendableWith(v, p, hand[2]!), 'a third').toBe(false)
    expect(refusal(v, p)).toBeNull()
    expect(selectionText(v, p, (id) => `#${id}`)).toBe(`Discard: #${hand[0]}, #${hand[1]} — 2 of 2 chosen`)
  })
  it('is not the decision when only one card is owed', () => {
    let s = withHandSize(makeGame(), 0, 3)
    s = { ...s, phase: 'end', pending: { kind: 'discardToHandSize', player: 0, count: 1 } }
    expect(setKindFor(viewFor(s, HUMAN))).toBeNull()
  })
})

describe('"choose 2" (min 2) targets — the only way through is the picker', () => {
  const PICK2: Ability = {
    id: 'T-PICK2:etb', trigger: { kind: 'enterField' }, text: 'choose 2 Forwards, dull them',
    effects: [{ kind: 'chooseTargets', min: 2, max: 2, from: { zone: 'forwards', controller: 'opponent' }, then: [{ kind: 'dull' }] }],
  }
  it('one chosen is refused, the second is offered, two are the answer; with a single candidate nothing is offered', () => {
    let s = makeGame({ defs: [...VANILLA_POOL, makeDef({ code: 'T-PICK2', cost: 0, hasAbilities: true, abilityClauses: 1, abilities: [PICK2] })] })
    const theirs: CardId[] = []
    for (let i = 0; i < 3; i++) { let id: CardId; [s, id] = withField(s, 1, 'forwards', 'V-F1'); theirs.push(id) }
    const [withCard, card] = withHand(s, 0, 'T-PICK2')
    s = apply(withCard, { type: 'castCharacter', player: 0, card, payment: { dullBackups: [], discards: [] } }).state
    const v = viewFor(s, HUMAN)
    expect(boundsFor(v, 'targets')).toEqual({ min: 2, max: 2 })
    let p = sel('targets', [theirs[0]!])
    expect(refusal(v, p)).toMatch(/choose 1 more/)
    expect(extendableWith(v, p, theirs[1]!)).toBe(true)
    p = toggled(p, theirs[1]!)
    expect(refusal(v, p)).toBeNull()
    expect(extendableWith(v, p, theirs[2]!), 'a third').toBe(false)
    // Fewer candidates than min: no completion exists, so nothing is offered.
    const starved: typeof v = { ...v, pending: { ...(v.pending as Extract<NonNullable<typeof v.pending>, { kind: 'chooseTargets' }>), candidates: [theirs[0]!] } }
    expect(extendableWith(starved, sel('targets', []), theirs[0]!)).toBe(false)
  })
})
