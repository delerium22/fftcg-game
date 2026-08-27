import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  actingPlayer, apply, createGame, legalCommands, viewFor,
  type Ability, type CardDef, type CardId, type Command, type FieldCard, type GameState, type Payment, type PlayerView, type TriggerEvent,
} from '@fftcg/engine'
import { GreedyAgent, preferredPayment } from '@fftcg/ai'
import { CARD_DEFS, DECKS } from '../src/deck.js'
import { buildChoiceSet, describeChoice, fieldCardDisplay, preferredChoices, promptFor, sameCommand, samePayment } from '../src/game/commands.js'
import { AI, HUMAN } from '../src/game/types.js'
import { Card } from '../src/ui/Card.js'
import { stepAi } from '../src/game/useGame.js'

const newGame = (seed: number): GameState => createGame({ seed, decks: DECKS, defs: CARD_DEFS })
/** `createGame` deals nothing — hands only exist once the first-player choice is answered (§8.2.1.3). */
function dealtGame(seed: number): GameState {
  const state = newGame(seed)
  return apply(state, { type: 'chooseFirst', player: actingPlayer(state)!, goFirst: true }).state
}
const isCastFor = (c: Command, card: CardId): boolean => (c.type === 'castCharacter' || c.type === 'castSummon') && c.card === card

/** Drive a game until the human is holding a cast decision worth collapsing: one card with several minimal
 *  payments, at least one of which is the payment `preferredPayment` would pick. */
function findMultiPaymentPosition(seed: number): { state: GameState; view: PlayerView; legal: Command[]; card: CardId } {
  let state = newGame(seed)
  const agent = new GreedyAgent({ seed, decks: DECKS, depth: 1 })
  for (let i = 0; i < 500 && !state.result; i++) {
    if (actingPlayer(state) === AI) { state = stepAi(state, agent).state; continue }
    const legal = legalCommands(state, HUMAN)
    const view = viewFor(state, HUMAN)
    for (const card of view.hand) {
      const payments = legal.filter((c) => isCastFor(c, card))
      if (payments.length < 2) continue
      const preferred = preferredPayment(state, HUMAN, card)
      if (!preferred) continue
      if (!payments.some((c) => (c.type === 'castCharacter' || c.type === 'castSummon') && samePayment(c.payment, preferred))) continue
      return { state, view, legal, card }
    }
    const next = legal.find((c) => c.type !== 'concede')
    if (!next) break
    state = apply(state, next).state
  }
  throw new Error(`no multi-payment cast position found for seed ${seed}`)
}

describe('describeChoice', () => {
  const view = viewFor(dealtGame(1), HUMAN)
  it('labels the setup and no-subject commands', () => {
    expect(describeChoice(view, { type: 'chooseFirst', player: HUMAN, goFirst: true })).toBe('Take the first turn')
    expect(describeChoice(view, { type: 'chooseFirst', player: HUMAN, goFirst: false })).toBe('Let the opponent go first')
    expect(describeChoice(view, { type: 'mulligan', player: HUMAN, redraw: true })).toBe('Mulligan (redraw 5)')
    expect(describeChoice(view, { type: 'mulligan', player: HUMAN, redraw: false })).toBe('Keep hand')
    expect(describeChoice(view, { type: 'pass', player: HUMAN })).toBe('Pass')
    expect(describeChoice(view, { type: 'concede', player: HUMAN })).toBe('Concede')
  })
  it("labels a null blocker as Don't block", () => {
    expect(describeChoice(view, { type: 'declareBlock', player: HUMAN, blocker: null })).toBe("Don't block")
  })
  it('names the cards it can see and falls back to #id for the ones it cannot', () => {
    const mine = view.hand[0] as CardId
    const label = describeChoice(view, { type: 'discardToHandSize', player: HUMAN, cards: [mine] })
    expect(label).toBe(`Discard ${view.defs[view.cards[mine]!.code]!.name}`)
    expect(describeChoice(view, { type: 'declareAttack', player: HUMAN, attackers: [99_999] })).toBe('Attack with #99999')
  })
})

describe('buildChoiceSet', () => {
  const view = viewFor(dealtGame(7), HUMAN)
  const [a, b, c] = view.hand as [CardId, CardId, CardId]
  const commands: Command[] = [
    { type: 'concede', player: HUMAN },
    { type: 'chooseFirst', player: HUMAN, goFirst: true },
    { type: 'mulligan', player: HUMAN, redraw: false },
    { type: 'castCharacter', player: HUMAN, card: a, payment: { dullBackups: [], discards: [] } },
    { type: 'castSummon', player: HUMAN, card: b, payment: { dullBackups: [], discards: [] } },
    { type: 'declareAttack', player: HUMAN, attackers: [a, b, c] },
    { type: 'declareBlock', player: HUMAN, blocker: null },
    { type: 'declareBlock', player: HUMAN, blocker: c },
    { type: 'assignPartyDamage', player: HUMAN, assignments: [{ target: a, amount: 1 }, { target: b, amount: 2 }] },
    { type: 'discardToHandSize', player: HUMAN, cards: [b, c] },
    { type: 'pass', player: HUMAN },
  ]
  const set = buildChoiceSet(view, commands)

  it('keeps every command, in legalCommands order', () => {
    expect(set.all).toHaveLength(commands.length)
    expect(set.all.map((ch) => ch.command)).toEqual(commands)
  })

  it('buckets the subject-less commands as loose', () => {
    expect(set.loose.map((ch) => ch.command.type)).toEqual(['concede', 'chooseFirst', 'mulligan', 'declareBlock', 'pass'])
    // the null-blocker "Don't block" is the loose declareBlock
    expect(set.loose.find((ch) => ch.command.type === 'declareBlock')?.label).toBe("Don't block")
  })

  it('files each command under its card subject', () => {
    const typesFor = (id: CardId) => (set.byCard.get(id) ?? []).map((ch) => ch.command.type)
    expect(typesFor(a)).toEqual(['castCharacter', 'declareAttack', 'assignPartyDamage'])
    expect(typesFor(b)).toEqual(['castSummon', 'declareAttack', 'assignPartyDamage', 'discardToHandSize'])
    expect(typesFor(c)).toEqual(['declareAttack', 'declareBlock', 'discardToHandSize'])
  })

  it('offers a multi-forward party under every one of its attackers', () => {
    const party = set.all.find((ch) => ch.command.type === 'declareAttack')!
    for (const id of [a, b, c]) expect(set.byCard.get(id)).toContain(party)
    expect(party.card).toBe(a)   // singular click-anchor is the first attacker
  })

  it('never lists a card with no legal command', () => {
    const clickable = new Set(set.all.flatMap((ch) => (ch.card === null ? [] : [ch.card])))
    for (const id of set.byCard.keys()) expect(clickable.has(id) || set.all.some((ch) => set.byCard.get(id)?.includes(ch))).toBe(true)
    // and nothing outside the commands' own subjects leaks in
    expect([...set.byCard.keys()].sort()).toEqual([a, b, c].sort())
  })

  it('states what the game is waiting for', () => {
    expect(buildChoiceSet(viewFor(dealtGame(7), HUMAN), []).prompt).toMatch(/Keep your hand or mulligan|Waiting for the opponent/)
  })
})

describe('promptFor via buildChoiceSet', () => {
  it('tracks the pending decision through setup', () => {
    let state = newGame(3)
    const seen = new Set<string>()
    const agent = new GreedyAgent({ seed: 3, decks: DECKS, depth: 1 })
    for (let i = 0; i < 200 && !state.result; i++) {
      const view = viewFor(state, HUMAN)
      seen.add(buildChoiceSet(view, legalCommands(state, HUMAN)).prompt)
      if (view.phase === 'main1' && actingPlayer(state) === HUMAN) break
      if (actingPlayer(state) === AI) { state = stepAi(state, agent).state; continue }
      state = apply(state, legalCommands(state, HUMAN).find((c) => c.type !== 'concede')!).state
    }
    expect([...seen]).toContain('Main Phase 1 — cast, attack, or pass')
    expect([...seen].some((p) => p === 'Choose who goes first' || p === 'Keep your hand or mulligan' || p === 'Waiting for the opponent…')).toBe(true)
  })
})

describe('preferredChoices', () => {
  const { state, view, legal, card } = findMultiPaymentPosition(11)

  it('collapses one card with many payments to exactly one choice', () => {
    expect(legal.filter((c) => isCastFor(c, card)).length).toBeGreaterThan(1)
    expect(preferredChoices(view, legal).filter((c) => isCastFor(c, card))).toHaveLength(1)
  })

  it('keeps the payment preferredPayment would pick', () => {
    const kept = preferredChoices(view, legal).find((c) => isCastFor(c, card))
    expect(kept?.type === 'castCharacter' || kept?.type === 'castSummon').toBe(true)
    const preferred = preferredPayment(state, HUMAN, card)!
    expect(samePayment((kept as Extract<Command, { type: 'castCharacter' }>).payment, preferred)).toBe(true)
  })

  it('leaves commands that carry no payment untouched and preserves relative order', () => {
    const collapsed = preferredChoices(view, legal)
    // C3 generalised the collapsing from casts to every command that carries a `Payment`, because
    // `legalCommands` explodes activations into one entry per minimal payment exactly as it does casts —
    // otherwise the board grows a separate button for each way of paying for the same Red Mage ability.
    const PAYABLE = ['castCharacter', 'castSummon', 'activateAbility']
    const unpayable = (cs: Command[]) => cs.filter((c) => !PAYABLE.includes(c.type))
    expect(unpayable(collapsed)).toEqual(unpayable(legal))
    // one entry per castable card, each sitting where that card's FIRST payment was
    const order = collapsed.filter((c) => c.type === 'castCharacter' || c.type === 'castSummon').map((c) => (c as Extract<Command, { type: 'castCharacter' }>).card)
    const firstSeen: CardId[] = []
    for (const c of legal) if ((c.type === 'castCharacter' || c.type === 'castSummon') && !firstSeen.includes(c.card)) firstSeen.push(c.card)
    expect(order).toEqual(firstSeen)
  })

  it('is a no-op when there is nothing to cast', () => {
    const nothing: Command[] = [{ type: 'concede', player: HUMAN }, { type: 'pass', player: HUMAN }]
    expect(preferredChoices(view, nothing)).toEqual(nothing)
  })

  it('feeds buildChoiceSet a board where each castable card is clickable once', () => {
    const set = buildChoiceSet(view, preferredChoices(view, legal))
    expect(set.byCard.get(card)?.filter((ch) => ch.command.type === 'castCharacter' || ch.command.type === 'castSummon')).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Abilities (rung C1)
// ---------------------------------------------------------------------------

const NOEL = '16-092C', CLOUD = '27-124S', SPHENE = '27-126S', BILLY = '18-124C', REEVE = '20-105C'

const fieldCard = (id: CardId, over: Partial<FieldCard> = {}): FieldCard =>
  ({ id, status: 'active', damage: 0, enteredTurn: 1, attackedThisTurn: false, granted: [], powerBonus: 0, flags: [], ...over })

/** Register a card instance in a view so the def tables can be looked up for it. */
function instance(v: PlayerView, id: CardId, code: string, owner = HUMAN): CardId {
  v.cards[id] = { id, code, owner }
  return id
}

const DULL_UP_TO_2: Ability = {
  id: 'test:dull2', trigger: { kind: 'enterField' },
  text: 'When Noel enters the field, choose up to 2 Forwards opponent controls. Dull them.',
  effects: [{ kind: 'chooseTargets', min: 0, max: 2, from: { zone: 'forwards', controller: 'opponent' }, then: [{ kind: 'dull' }] }],
}
const DULL_EXACTLY_1: Ability = {
  id: 'test:dull1', trigger: { kind: 'enterField' },
  text: 'When Noel enters the field, choose 1 Forward opponent controls. Dull it.',
  effects: [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'opponent' }, then: [{ kind: 'dull' }] }],
}
const RETURN_FROM_BREAK: Ability = {
  id: 'test:retrieve', trigger: { kind: 'enterField' },
  text: 'When Billy Bob enters the field, choose 1 Forward in your Break Zone. Return it to your hand.',
  effects: [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'breakZone', controller: 'self' }, then: [{ kind: 'moveToHand' }] }],
}
const MODE_LABELS = [
  'Deal 3000 damage to all the Forwards opponent controls.',
  'Choose 1 Forward. Dull it.',
  'All the Forwards you control gain Haste until the end of the turn.',
]
const THREE_MODES: Ability = {
  id: 'test:modes', trigger: { kind: 'summonResolve' },
  text: 'Select up to 2 of the 3 following.',
  effects: [{ kind: 'chooseModes', min: 0, max: 2, modes: MODE_LABELS.map((label) => ({ label, effects: [] })) }],
}

/**
 * A hand-built `PlayerView` holding one suspended clause. Everything the wording is derived from — the agenda,
 * the AST hanging off `defs`, and the zones the candidates sit in — is plain readonly data the view already
 * carries (spec C1-2/C1-3), so the fixture states exactly what the browser is handed at that instant.
 */
function suspendedView(ability: Ability, sourceCode: string): PlayerView {
  const v = viewFor(dealtGame(1), HUMAN)
  const source = instance(v, 900, sourceCode)
  v.defs[sourceCode] = { ...(v.defs[sourceCode] as CardDef), abilities: [ability] }
  v.resolution = {
    active: { abilityId: ability.id, source, controller: HUMAN, path: [], chosen: [], modes: [], triggerEvent: null },
    queue: [], continuation: null, steps: 1,
  }
  return v
}

/**
 * Noel's clause, suspended over its opponent Forwards. `min`/`max` are copied off the AST node exactly as
 * `resolve.ts` copies them into the pending — that correspondence is what lets the wording find the clause.
 */
function dullView(ability: Ability, candidateCodes: string[]): PlayerView {
  const node = ability.effects[0]
  if (node?.kind !== 'chooseTargets') throw new Error('fixture must lead with chooseTargets')
  const v = suspendedView(ability, NOEL)
  const ids = candidateCodes.map((code, i) => instance(v, 901 + i, code, AI))
  v.fields[AI].forwards = ids.map((id) => fieldCard(id))
  v.pending = { kind: 'chooseTargets', player: HUMAN, min: node.min, max: Math.min(node.max, ids.length), candidates: ids }
  return v
}
const upTo2 = (): PlayerView => dullView(DULL_UP_TO_2, [CLOUD, SPHENE])

function breakZoneView(): PlayerView {
  const v = suspendedView(RETURN_FROM_BREAK, BILLY)
  const id = instance(v, 901, CLOUD)
  v.fields[HUMAN].breakZone = [id]
  v.pending = { kind: 'chooseTargets', player: HUMAN, min: 1, max: 1, candidates: [id] }
  return v
}

function modeView(): PlayerView {
  const v = suspendedView(THREE_MODES, REEVE)
  v.pending = { kind: 'chooseMode', player: HUMAN, min: 0, max: 2, labels: MODE_LABELS }
  return v
}

const targets = (ids: CardId[]): Command => ({ type: 'chooseTargets', player: HUMAN, targets: ids })
const modes = (ms: number[]): Command => ({ type: 'chooseMode', player: HUMAN, modes: ms })

describe('effective power on the board (spec C1-7)', () => {
  const v = viewFor(dealtGame(1), HUMAN)
  const forward = instance(v, 800, NOEL)
  const backup = instance(v, 801, REEVE)
  const printed = v.defs[NOEL]!.power as number

  it('adds the until-end-of-turn bonus, so a pumped Forward is never shown at printed power', () => {
    expect(fieldCardDisplay(v, fieldCard(forward)).power).toBe(printed)
    expect(fieldCardDisplay(v, fieldCard(forward, { powerBonus: 3000 })).power).toBe(printed + 3000)
  })

  it('floors at 0 rather than showing negative power (§12.4.4 breaks it instead)', () => {
    expect(fieldCardDisplay(v, fieldCard(forward, { powerBonus: -99_000 })).power).toBe(0)
  })

  it('keeps a card with no printed power powerless, bonus or not', () => {
    expect(fieldCardDisplay(v, fieldCard(backup)).power).toBeNull()
    expect(fieldCardDisplay(v, fieldCard(backup, { powerBonus: 3000 })).power).toBeNull()
  })

  it('hands the board the bonus, the granted keywords and the protection flags to badge', () => {
    const shown = fieldCardDisplay(v, fieldCard(forward, { powerBonus: 3000, granted: ['haste'], flags: ['cannotBeBroken'] }))
    expect(shown).toEqual({ power: printed + 3000, powerBonus: 3000, granted: ['haste'], flags: ['cannotBeBroken'] })
  })

  it('renders the pumped power, the damage ratio and the badges on the card itself', () => {
    const def = v.defs[NOEL]!
    const pumped = fieldCard(forward, { damage: 2000, powerBonus: 3000, granted: ['haste'], flags: ['cannotBeBroken'] })
    const shown = fieldCardDisplay(v, pumped)
    const out = renderToStaticMarkup(createElement(Card, {
      code: def.code, name: def.name, cost: def.cost, elements: def.elements, type: def.type,
      power: shown.power, powerBonus: shown.powerBonus, granted: shown.granted, flags: shown.flags, damage: pumped.damage,
    }))
    // remaining/effective, NOT remaining/printed — and the damage bar is a fraction of effective power too
    expect(out).toContain(`${printed + 3000 - 2000}`)
    expect(out).toContain(`/${printed + 3000}`)
    expect(out).toContain(`--dmg:${(2000 / (printed + 3000)) * 100}`.slice(0, 10))
    // the player can see WHY it survived and why it hits harder than the printed number
    for (const badge of ['+3000', 'Haste', 'Unbreakable']) expect(out).toContain(badge)
    expect(out).toContain('plus 3000 power this turn')
    expect(out).toContain('unbreakable')
  })
})

describe('chooseTargets in the UI (spec C1-6)', () => {
  it('says what is wanted, read off the clause the agenda is suspended on', () => {
    expect(promptFor(upTo2())).toBe('Noel: choose up to 2 Forwards the AI controls to dull')
    expect(promptFor(dullView(DULL_EXACTLY_1, [CLOUD]))).toBe('Noel: choose 1 Forward the AI controls to dull')
    expect(promptFor(breakZoneView())).toBe('Billy Bob: choose 1 card in your Break Zone to return to hand')
  })

  it('labels a pre-enumerated target SET with the effect the click will have', () => {
    const v = upTo2()
    expect(describeChoice(v, targets([901, 902]))).toBe('Dull Cloud and Sphene')
    expect(describeChoice(v, targets([901]))).toBe('Dull Cloud')
    expect(describeChoice(v, targets([]))).toBe('Choose no targets')
    expect(describeChoice(breakZoneView(), targets([901]))).toBe('Return Cloud')
  })

  it('lights up exactly the legal candidates and nothing else (spec B-A4)', () => {
    const v = upTo2()
    // `legalCommands` enumerates Σ C(2, k) for k in 0..2, in that order — see engine legal.ts.
    const set = buildChoiceSet(v, [targets([]), targets([901]), targets([902]), targets([901, 902])])
    expect([...set.byCard.keys()].sort()).toEqual([901, 902])
    // "no targets" names no card, so it is a strip button rather than a click on the board
    expect(set.loose.map((ch) => ch.label)).toEqual(['Choose no targets'])
    expect(set.byCard.get(901)?.map((ch) => ch.label)).toEqual(['Dull Cloud', 'Dull Cloud and Sphene'])
  })
})

describe('chooseMode in the UI (spec C1-6)', () => {
  const v = modeView()

  it('names the card asking and how many of the printed effects to pick', () => {
    expect(promptFor(v)).toBe('Reeve: choose up to 2 of the 3 following effects')
  })

  it('puts the printed wording on the button verbatim', () => {
    expect(describeChoice(v, modes([1]))).toBe(MODE_LABELS[1])
    expect(describeChoice(v, modes([0, 2]))).toBe(`${MODE_LABELS[0]} + ${MODE_LABELS[2]}`)
    expect(describeChoice(v, modes([]))).toBe('None of these')
  })

  it('has no card subject at all, so every mode is a strip button', () => {
    const set = buildChoiceSet(v, [modes([]), modes([0]), modes([1]), modes([2]), modes([0, 1])])
    expect(set.byCard.size).toBe(0)
    expect(set.loose).toHaveLength(set.all.length)
  })
})

describe('a target choice nested inside a chosen mode (Shantotto, Ramuh)', () => {
  // Both printed modes choose "1 Forward", so scanning the AST for a matching node is ambiguous by
  // construction. The program counter is what says WHICH one is running, and the wording must follow it.
  const NESTED: Ability = {
    id: 'test:nested', trigger: { kind: 'enterField' },
    text: 'Select 1 of the 2 following actions.',
    effects: [{
      kind: 'chooseModes', min: 1, max: 1,
      modes: [
        { label: 'Choose 1 Forward. Dull it.', effects: [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'opponent' }, then: [{ kind: 'dull' }] }] },
        { label: 'Choose 1 Forward. It gains Haste.', effects: [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'opponent' }, then: [{ kind: 'grantKeyword', keyword: 'haste' }] }] },
      ],
    }],
  }

  const nestedView = (mode: 0 | 1): PlayerView => {
    const v = suspendedView(NESTED, NOEL)
    const id = instance(v, 901, CLOUD, AI)
    v.fields[AI].forwards = [fieldCard(id)]
    // `applyChooseMode` extends the path by [0, 0] and records the chosen mode; the target node is one deeper.
    v.resolution = { ...v.resolution, active: { ...v.resolution.active!, path: [0, 0, 0], modes: [mode] } }
    v.pending = { kind: 'chooseTargets', player: HUMAN, min: 1, max: 1, candidates: [id] }
    return v
  }

  it('takes the verb from the mode that is actually running', () => {
    expect(promptFor(nestedView(0))).toBe('Noel: choose 1 Forward the AI controls to dull')
    expect(promptFor(nestedView(1))).toBe('Noel: choose 1 Forward the AI controls to give Haste')
    expect(describeChoice(nestedView(0), targets([901]))).toBe('Dull Cloud')
    expect(describeChoice(nestedView(1), targets([901]))).toBe('Give Haste to Cloud')
  })
})

// ---------------------------------------------------------------------------
// Observer triggers (rung C2)
// ---------------------------------------------------------------------------

describe('a prompt raised by an observer trigger names its cause (spec C2-5)', () => {
  /*
   * The C2 shape, in fixture form: the clause belongs to a card the event did NOT happen to, so a prompt that
   * says only "choose 1 Forward you control" leaves the player with no way to connect it to the board. The
   * cause is read off `Frame.triggerEvent` — the authority, already in the view as plain data.
   */
  const HASTE_ON_BREAK: Ability = {
    id: 'test:watch', trigger: { kind: 'observesZoneChange', from: 'field', to: 'breakZone', whose: 'opponent', of: 'forward' },
    text: 'When a Forward opponent controls is put from the field into the Break Zone, choose 1 Forward you control. It gains Haste until the end of the turn.',
    effects: [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'self' }, then: [{ kind: 'grantKeyword', keyword: 'haste' }] }],
  }
  const MINE: CardId = 901, THEIRS: CardId = 902

  const watchView = (triggerEvent: TriggerEvent | null): PlayerView => {
    const v = suspendedView(HASTE_ON_BREAK, NOEL)
    instance(v, MINE, CLOUD, HUMAN)
    instance(v, THEIRS, SPHENE, AI)
    v.fields[HUMAN].forwards = [fieldCard(MINE)]
    v.fields[AI].breakZone = [THEIRS]
    v.resolution = { ...v.resolution, active: { ...v.resolution.active!, triggerEvent } }
    v.pending = { kind: 'chooseTargets', player: HUMAN, min: 1, max: 1, candidates: [MINE] }
    return v
  }
  const ask = 'Noel: choose 1 Forward you control to give Haste'

  it('leads with the cause, then the ask', () => {
    const broken: TriggerEvent = { kind: 'zoneChange', card: THEIRS, from: 'field', to: 'breakZone', controller: AI, owner: AI , reason: 'ability'}
    expect(promptFor(watchView(broken))).toBe(`The AI's Sphene was broken — ${ask}`)
  })

  it('C2-10: reads "opponent" from the ability controller, so it flips with the seat', () => {
    const mineBroken: TriggerEvent = { kind: 'zoneChange', card: MINE, from: 'field', to: 'breakZone', controller: HUMAN, owner: HUMAN , reason: 'ability'}
    expect(promptFor(watchView(mineBroken))).toBe(`Your Cloud was broken — ${ask}`)
  })

  it('names a damage cause, to a Forward or to a player', () => {
    const onForward: TriggerEvent = { kind: 'damage', source: MINE, sourceController: HUMAN, target: THEIRS, victim: null, amount: 3000 }
    expect(promptFor(watchView(onForward))).toBe(`Cloud dealt 3000 damage to Sphene — ${ask}`)
    const onPlayer: TriggerEvent = { kind: 'damage', source: MINE, sourceController: HUMAN, target: null, victim: AI, amount: 1 }
    expect(promptFor(watchView(onPlayer))).toBe(`Cloud dealt damage to the AI — ${ask}`)
  })

  it('says nothing extra for a clause about its own card', () => {
    // `enterField`/`summonResolve` carry no trigger event: rung C1's wording is unchanged, to the character.
    expect(promptFor(watchView(null))).toBe(ask)
  })
})

describe('wording degrades gracefully when the clause cannot be read', () => {
  it('falls back to neutral wording with no agenda frame behind the pending', () => {
    const v = upTo2()
    v.resolution = { active: null, queue: [], continuation: null, steps: 0 }
    expect(promptFor(v)).toBe('Choose up to 2 Forwards the AI controls')
    expect(describeChoice(v, targets([901]))).toBe('Target Cloud')
  })
})

describe('activated abilities on the board (C3-A7)', () => {
  /** A board with one Red Mage on the field, plus an unrelated Backup that could pay for its ability. */
  function redMageView(): { v: PlayerView; src: CardId; backup: CardId } {
    const v = viewFor(dealtGame(1), HUMAN)
    const src = instance(v, 910, '1-121C')
    const backup = instance(v, 911, '9-074C')
    v.fields[HUMAN].backups = [fieldCard(src), fieldCard(backup)]
    return { v, src, backup }
  }
  const act = (source: CardId, abilityId: string, payment: Payment = { dullBackups: [], discards: [] }): Command =>
    ({ type: 'activateAbility', player: HUMAN, source, abilityId, payment })

  it('belongs to its source card, so the board lights that card up', () => {
    // Not the CP sources: those are payment, chosen for the player, and making them clickable would imply
    // the click picks them.
    const { v, src, backup } = redMageView()
    const set = buildChoiceSet(v, [act(src, '1-121C:haste', { dullBackups: [backup], discards: [] })])
    expect(set.byCard.get(src)?.map((c) => c.command.type)).toEqual(['activateAbility'])
    expect(set.byCard.get(backup)).toBeUndefined()
  })

  it('labels the button with the printed cost', () => {
    const { v, src, backup } = redMageView()
    const label = describeChoice(v, act(src, '1-121C:haste', { dullBackups: [backup], discards: [] }))
    expect(label).toContain('[Lightning][Dull]')
  })

  it('tells two clauses of the SAME card apart', () => {
    // Miner and Undead Princess each print two clauses, so identity has to include the clause — the same
    // reason the command carries `abilityId` rather than an index into the card's ability array.
    const { src } = redMageView()
    expect(sameCommand(act(src, '16-092C:etb'), act(src, '16-092C:dull-all'))).toBe(false)
    expect(sameCommand(act(src, '16-092C:etb'), act(src, '16-092C:etb'))).toBe(true)
  })

  it('tells two payments of the same clause apart', () => {
    const { src } = redMageView()
    const a = act(src, '1-121C:haste', { dullBackups: [7], discards: [] })
    const b = act(src, '1-121C:haste', { dullBackups: [8], discards: [] })
    expect(sameCommand(a, b)).toBe(false)
    expect(sameCommand(a, act(src, '1-121C:haste', { dullBackups: [7], discards: [] }))).toBe(true)
  })
})
