import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  actingPlayer, apply, createGame, drainResolution, enqueueTrigger, legalCommands, viewFor,
  type Ability, type CardDef, type CardId, type Command, type FieldCard, type GameState, type Payment, type Pending, type PlayerId, type PlayerView, type TriggerEvent,
} from '@fftcg/engine'
import { GreedyAgent, preferredPayment } from '@fftcg/ai'
import { CARD_DEFS, DECKS } from '../src/deck.js'
import { makeGame, withField } from '../../../packages/engine/test/helpers.js'
import { buildChoiceSet, describeChoice, describeTriggerCause, fieldCardDisplay, preferredChoices, promptFor, sameCommand, samePayment } from '../src/game/commands.js'
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
const GEOMANCER = '18-064C'   // '[Earth], discard Geomancer: Draw 1 card' — the clause that exposed the label defect

const fieldCard = (id: CardId, over: Partial<FieldCard> = {}): FieldCard =>
  ({ id, status: 'active', damage: 0, enteredTurn: 1, attackedThisTurn: false, granted: [], powerBonus: 0, flags: [], usedThisTurn: [], ...over })

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
    expect(out).toContain('unbreakable')
    // Found by playing: the spoken label read "power 11000 of 11000, plus 4000 power this turn", and the
    // "of" number ALREADY includes the bonus — so the sentence invited the reader to add it a second time and
    // arrive at 15000. It has to say the bonus is part of the number just given, and that it will go away.
    expect(out).toContain(`including 3000 that expires at the end of the turn`)
    expect(out).not.toContain('plus 3000 power this turn')
  })

  it('says nothing about a power modifier on a card that HAS no power', () => {
    // Codex MINOR: the prose is spoken as part of the power phrase, and a Backup has no power phrase — so it
    // read "backup, including 3000 that expires at the end of the turn", included in nothing. Nothing in the
    // pool pumps a Backup, but the component takes the props and must not produce a sentence about nothing.
    const def = v.defs[REEVE]!
    const shown = fieldCardDisplay(v, fieldCard(backup, { powerBonus: 3000 }))
    expect(shown.power, 'the fixture is not a powerless card, so it proves nothing').toBeNull()
    const out = renderToStaticMarkup(createElement(Card, {
      code: def.code, name: def.name, cost: def.cost, elements: def.elements, type: def.type,
      power: shown.power, powerBonus: shown.powerBonus,
    }))
    expect(out).not.toContain('including 3000')
    expect(out).not.toContain('+3000')
  })

  it('says a NEGATIVE power modifier is a reduction already applied, not one still to come', () => {
    const def = v.defs[NOEL]!
    const shown = fieldCardDisplay(v, fieldCard(forward, { powerBonus: -3000 }))
    const out = renderToStaticMarkup(createElement(Card, {
      code: def.code, name: def.name, cost: def.cost, elements: def.elements, type: def.type,
      power: shown.power, powerBonus: shown.powerBonus,
    }))
    expect(out).toContain(`power ${printed - 3000} of ${printed - 3000}`)
    expect(out).toContain('reduced by 3000 until the end of the turn')
    expect(out).not.toContain('minus 3000 power this turn')
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

  it("says a repeated verb ONCE — Cloud protects, it does not 'protect and protect'", () => {
    // Codex MINOR: the collapse only fired when the second phrase had something after the verb, so Cloud's two
    // flags — both bare "Protect" — rendered "Protect and protect Cloud" on the button.
    const TWO_FLAGS: Ability = {
      id: 'X:flags', trigger: { kind: 'attackPhaseBegins' },
      text: 'Choose 1 Forward you control. It cannot be broken and cannot be returned by your opponent.',
      effects: [{
        kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'any' },
        then: [{ kind: 'grantFlag', flag: 'cannotBeBroken' }, { kind: 'grantFlag', flag: 'cannotBeReturnedByOpponent' }],
      }],
    }
    const v = suspendedView(TWO_FLAGS, NOEL)
    const id = instance(v, 903, CLOUD, AI)
    v.fields[AI].forwards = [fieldCard(id)]
    v.pending = { kind: 'chooseTargets', player: HUMAN, min: 1, max: 1, candidates: [id] }
    expect(describeChoice(v, targets([903]))).toBe('Protect Cloud')
    // The prompt still distinguishes the two protections, because they differ after the verb.
    expect(promptFor(v)).toBe("Noel: choose 1 Forward the AI controls to protect from being broken and from the opponent's return effects")
  })

  it('an effect repeated with nothing to distinguish it is said once, not doubled', () => {
    // The bare-repeat case on the PROMPT side. Cloud does not reach it — its two protections differ after the
    // verb — so without this the line that drops the repeat is untested, and "to dull and dull" would ship the
    // first time a clause repeated a bare effect.
    const TWICE: Ability = {
      id: 'X:twice', trigger: { kind: 'enterField' },
      text: 'Choose 1 Forward. Dull it.',
      effects: [{
        kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'any' },
        then: [{ kind: 'dull' }, { kind: 'dull' }],
      }],
    }
    const v = suspendedView(TWICE, NOEL)
    const id = instance(v, 905, CLOUD, AI)
    v.fields[AI].forwards = [fieldCard(id)]
    v.pending = { kind: 'chooseTargets', player: HUMAN, min: 1, max: 1, candidates: [id] }
    expect(promptFor(v)).toBe('Noel: choose 1 Forward the AI controls to dull')
    expect(describeChoice(v, targets([905]))).toBe('Dull Cloud')
  })

  it('does not fuse DIFFERENT verbs around one target — the button says one, the prompt says both', () => {
    // Codex MINOR: the trailing "to" was stripped from every non-final phrase, which is only sound when a
    // later phrase shares the verb. "Give Haste to" + "Dull" fused into "Give Haste and dull Cloud", which
    // reads as though Cloud were the Haste. No card in the pool mixes verbs, so the button degrades to its
    // first effect rather than inventing a sentence; the prompt, which has no such seam, still names both.
    const MIXED: Ability = {
      id: 'X:mixed', trigger: { kind: 'enterField' },
      text: 'Choose 1 Forward. It gains Haste and is dulled.',
      effects: [{
        kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'any' },
        then: [{ kind: 'grantKeyword', keyword: 'haste' }, { kind: 'dull' }],
      }],
    }
    const v = suspendedView(MIXED, NOEL)
    const id = instance(v, 904, CLOUD, AI)
    v.fields[AI].forwards = [fieldCard(id)]
    v.pending = { kind: 'chooseTargets', player: HUMAN, min: 1, max: 1, candidates: [id] }
    expect(describeChoice(v, targets([904]))).toBe('Give Haste to Cloud')
    expect(promptFor(v)).toBe('Noel: choose 1 Forward the AI controls to give Haste and dull')
  })

  it('says WHOSE card when the same name is on both fields', () => {
    // Found by playing. Both seats play the same deck, so a mirror is ordinary: with a Shantotto on each side
    // the log read "Give Haste to Shantotto" and named neither. The clause was right — its own text says "a
    // Forward other than Shantotto", so it could only be the other copy — but nothing let the player check
    // that against the board.
    const HASTE: Ability = {
      id: 'X:haste', trigger: { kind: 'enterField' },
      text: 'Choose 1 Forward. It gains Haste.',
      effects: [{
        kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'any' },
        then: [{ kind: 'grantKeyword', keyword: 'haste' }],
      }],
    }
    const v = suspendedView(HASTE, NOEL)
    const theirs = instance(v, 906, CLOUD, AI)
    const mine = instance(v, 907, CLOUD, HUMAN)
    const lone = instance(v, 908, BILLY, AI)
    v.fields[AI].forwards = [fieldCard(theirs), fieldCard(lone)]
    v.fields[HUMAN].forwards = [fieldCard(mine)]
    v.pending = { kind: 'chooseTargets', player: HUMAN, min: 1, max: 1, candidates: [theirs, mine, lone] }

    expect(describeChoice(v, targets([906]))).toBe("Give Haste to the AI's Cloud")
    expect(describeChoice(v, targets([907]))).toBe('Give Haste to your Cloud')
    // A card with no twin is NOT qualified — the point is to separate a facing pair, not to annotate the board.
    expect(describeChoice(v, targets([908]))).toBe(`Give Haste to ${v.defs[BILLY]!.name}`)
  })

  it('does not say whose card TWICE when the sentence already does', () => {
    // `describeTriggerCause` leads with the possessive itself, so it reads the bare name — otherwise the
    // qualification the test above added would produce "your your Cloud was broken".
    const v = suspendedView(DULL_EXACTLY_1, NOEL)
    const theirs = instance(v, 909, CLOUD, AI)
    const mine = instance(v, 910, CLOUD, HUMAN)
    v.fields[AI].forwards = [fieldCard(theirs)]
    v.fields[HUMAN].forwards = [fieldCard(mine)]
    const line = describeTriggerCause(v, { kind: 'zoneChange', card: mine, controller: HUMAN })
    expect(line).toBe(`your ${v.defs[CLOUD]!.name} was broken`)
    expect(line).not.toContain('your your')
  })

  it('names EVERY effect the choice applies, not just the first', () => {
    // Found by playing: Hugh Yurg's watcher is "+2000 power AND Brave", and the prompt said only "+2000
    // power". Brave is the half that decides whether the Forward dulls to attack, so a player picking on
    // power alone was picking blind.
    const BOTH: Ability = {
      id: 'X:both', trigger: { kind: 'enterField' }, text: 'Choose 1 Forward. It gains +2000 power and Brave.',
      effects: [{
        kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'any' },
        then: [{ kind: 'addPower', amount: 2000 }, { kind: 'grantKeyword', keyword: 'brave' }],
      }],
    }
    const v = suspendedView(BOTH, NOEL)
    const id = instance(v, 902, CLOUD, AI)
    v.fields[AI].forwards = [fieldCard(id)]
    v.pending = { kind: 'chooseTargets', player: HUMAN, min: 1, max: 1, candidates: [id] }
    expect(promptFor(v)).toBe('Noel: choose 1 Forward the AI controls to give +2000 power and Brave')
    expect(describeChoice(v, targets([902]))).toBe('Give +2000 power and Brave to Cloud')
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
  const act = (source: CardId, abilityId: string, payment: Payment = { dullBackups: [], discards: [] }, targets: readonly CardId[] = []): Command =>
    ({ type: 'activateAbility', player: HUMAN, source, abilityId, payment, targets })

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

  it('says what the ability DOES, on the side of the colon the card prints it', () => {
    // Found by playing. The button read `[Earth], discard: Geomancer — paying discard Cloud as earth`. In
    // FFTCG's own notation a colon separates COST from EFFECT — Geomancer prints "[Earth], discard Geomancer:
    // Draw 1 card" — so the source name sat exactly where the effect belongs, and the effect, which is the
    // only part a player is actually deciding on, was nowhere: nothing in the UI renders rules text.
    const v = viewFor(dealtGame(1), HUMAN)
    // `instance` is all the label needs: it reads the ability off `defs` and the name off `cards`. Geomancer's
    // clause is usable from HAND (`sourceZone: 'hand'`), and the view carries a hand as a COUNT, so there is no
    // zone to put it in — which is exactly why the label cannot fall back to reading the board.
    const geo = instance(v, 920, GEOMANCER)
    const label = describeChoice(v, act(geo, `${GEOMANCER}:draw`, { dullBackups: [], discards: [{ card: 921, element: 'earth' }] }))
    expect(label).toBe("Geomancer's [Earth], discard: Draw 1 card — paying discard #921 as earth")
    expect(label, 'the source is on the effect side of the colon again').not.toMatch(/: Geomancer\b/)
  })

  it('every activated ability in the POOL gets a label shaped card / cost / effect', () => {
    // STRUCTURE only. What the effect text should SAY is pinned by a hand-written table in
    // `packages/cards/test/abilities.test.ts`, checked against the printed cards by eye — because the first
    // version of this sweep derived its expectation with the same `indexOf(': ')` and sentence split the
    // production function uses, which is the parser compared with itself. Codex mutated the function to keep
    // only the first sentence and this sweep stayed green while labels lost "It gains Haste until the end of
    // the turn" (MAJOR). So the shape is checked here, next to the labelling; the words are checked there,
    // next to the cards.
    const v = viewFor(dealtGame(1), HUMAN)
    let next = 950
    const activated = CARD_DEFS.flatMap((d) => (d.abilities ?? [])
      .filter((a) => a.trigger.kind === 'activated')
      .map((a) => ({ def: d, ability: a })))
    expect(activated.length, 'the pool has no activated abilities, so this sweeps nothing').toBeGreaterThan(4)

    for (const { def, ability } of activated) {
      const src = instance(v, next++, def.code)
      const label = describeChoice(v, act(src, ability.id))
      expect(label.startsWith(`${def.name}'s `), `${ability.id}: label does not open with the card — ${label}`).toBe(true)
      const colon = label.indexOf(': ')
      expect(colon, `${ability.id}: nothing separates cost from effect — ${label}`).toBeGreaterThan(0)
      expect(label.slice(colon + 2).trim().length, `${ability.id}: the effect side is empty — ${label}`).toBeGreaterThan(0)
      expect(label, `${ability.id}: it fell back to naming the clause instead of describing it`).not.toContain(' ability')
    }
  })

  it('splits on the FIRST colon, so an ability that grants an ability keeps its inner one', () => {
    // Nothing in the pool prints two colons, so `indexOf` and `lastIndexOf` are the same function here and the
    // rule is untestable against the shipped cards — a mutation to `lastIndexOf` passed everything. FFTCG does
    // print this shape though: a clause that grants another clause quotes a whole `cost: effect` inside its own
    // effect, and splitting on the LAST colon would then present the granted EFFECT as if it were this
    // ability's, dropping the part that says what is being granted.
    const GRANTS: Ability = {
      id: 'X-GRANT:grant',
      trigger: { kind: 'activated', sourceZone: 'field', cost: { dull: true } },
      text: '[Dull]: Choose 1 Forward you control. It gains "[Dull]: Draw 1 card." until the end of the turn.',
      effects: [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'self' }, then: [{ kind: 'dull' }] }],
    }
    const v = viewFor(dealtGame(1), HUMAN)
    const src = instance(v, 930, NOEL)
    v.defs[NOEL] = { ...(v.defs[NOEL] as CardDef), abilities: [GRANTS] }
    v.fields[HUMAN].forwards = [fieldCard(src)]
    const label = describeChoice(v, act(src, GRANTS.id))
    expect(label).toBe(`${v.defs[NOEL]!.name}'s [Dull]: Choose 1 Forward you control. It gains "[Dull]: Draw 1 card." until the end of the turn`)
    // The granted clause survives whole — splitting on the last colon would leave only "Draw 1 card."
    expect(label).toContain('It gains "[Dull]: Draw 1 card."')
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

const HUGH_YURG = '24-063H'   // "search for 1 Earth Forward of cost 1" — the pool's only whole-deck search (REEVE, the top-N look, is declared above)

/**
 * A REAL `chooseFromDeck` pending: the printed clause is enqueued on a real state and resolved by the real
 * executor, so the pending under test is the one the browser is actually handed — `scope` included.
 *
 * `deckSize` trims the deck first, which is the whole point of the Reeve case: a top-3 look at a 3-card deck
 * is the state where a count-based guess at "is this a search" goes wrong.
 */
function deckPending(code: string, deckSize?: number): PlayerView {
  // Read off the defs the APP ships, so the fixture cannot drift from the clause the browser resolves.
  const ability = CARD_DEFS.find((d) => d.code === code)?.abilities?.find((a) => a.effects[0]?.kind === 'lookAtDeck')
  if (!ability) throw new Error(`${code} has no lookAtDeck clause — the fixture is stale`)
  let s = makeGame({ seed: 1, decks: DECKS, defs: CARD_DEFS })
  let src: CardId
  ;[s, src] = withField(s, HUMAN, 'forwards', code)
  if (deckSize !== undefined) {
    const me = s.players[HUMAN]
    const players = [s.players[0], s.players[1]] as typeof s.players
    players[HUMAN] = { ...me, deck: me.deck.slice(0, deckSize) }
    s = { ...s, players }
  }
  s = drainResolution(enqueueTrigger(s, src, HUMAN, ability))[0]
  return viewFor(s, HUMAN)
}

describe('the prompt strip says what a deck choice is (rung C9)', () => {
  // Codex's C9 finding 5: `promptFor` had no `chooseFromDeck` branch, so it fell through to the PHASE line and
  // told the player to "cast, attack, or pass" while the only legal answers were deck picks.
  const withPending = (over: Partial<Extract<Pending, { kind: 'chooseFromDeck' }>>): PlayerView => {
    const v = viewFor(dealtGame(1), HUMAN)
    v.pending = { kind: 'chooseFromDeck', player: HUMAN, min: 1, max: 1, count: 3, scope: 'top', to: 'hand', ...over }
    return v
  }

  it('calls a whole-deck SEARCH "your deck" and a top-N look what it is — from the REAL engine', () => {
    // Found by playing: Hugh Yurg's search exposes the whole deck, and the prompt read "choose up to 1 card
    // among the 44 cards you looked at" — true, and nothing a person would say.
    //
    // Both pendings are raised by resolving the actual printed clauses, not hand-built. The first version of
    // this test set `count` to the deck length itself and so DEFINED the whole-deck case as the heuristic it
    // was testing (Codex MAJOR); it could not have caught the false positive the third case below pins.
    const search = deckPending(HUGH_YURG)
    expect(search.pending?.kind).toBe('chooseFromDeck')
    expect(promptFor(search)).toContain('in your deck')
    expect(promptFor(search)).not.toContain('you looked at')

    const look = deckPending(REEVE)
    expect(promptFor(look)).toContain('among the 3 cards you looked at')
  })

  it('a top-3 look at a 3-card deck is still a LOOK, not a search', () => {
    // The false positive `count === deck.length` could not see: Reeve exposes the top 3 of a deck with exactly
    // 3 cards left, so the count equals the deck length while the clause is a peek. A player at 3 cards is one
    // draw from losing and reads that prompt carefully — telling them they are searching their deck is the
    // worst possible moment to be wrong about which effect is running.
    const v = deckPending(REEVE, 3)
    expect(v.pending?.kind === 'chooseFromDeck' && v.pending.count).toBe(3)
    expect(v.fields[HUMAN].deck, 'the fixture no longer has count === deck length, so it proves nothing').toHaveLength(3)
    expect(promptFor(v)).toContain('among the 3 cards you looked at')
    expect(promptFor(v)).not.toContain('in your deck')
  })

  it('names the choice instead of falling through to the phase', () => {
    const line = promptFor(withPending({}))
    expect(line).not.toMatch(/cast, attack, or pass/)
    expect(line).toMatch(/^Choose /)
    expect(line).toContain('3 cards')
  })

  it('says where the card is going, because a search does not add it to hand', () => {
    expect(promptFor(withPending({ to: 'field', min: 0, count: 40 }))).toContain('play onto the field')
    expect(promptFor(withPending({ to: 'hand' }))).toContain('add to your hand')
  })
})

describe('a private deck look cannot be narrated by the wrong seat (rung C9)', () => {
  /**
   * Blocker 4 of the C9 review — "the browser log leaks the private choice outright" — solved by the VIEW
   * rather than by narration logic: a seat with `card: null` in those slots has no id to name.
   *
   * The C9 CODE REVIEW then found two holes in the fixture this block used to have, both worth keeping in
   * mind: it stacked three copies of ONE code (so naming the wrong index was invisible), and it populated the
   * HUMAN's deck while asserting from the AI's seat — a deck the code under test never reads. Distinct codes
   * and the chooser's own deck fix both.
   */
  const CODES = [CLOUD, '18-064C', '19-052C'] as const

  /** `looker`'s top three, known to `looker` alone, viewed from `seat`. */
  function lookedView(seat: PlayerId, looker: PlayerId = HUMAN): PlayerView {
    const v = viewFor(dealtGame(1), seat)
    const ids = [901, 902, 903]
    ids.forEach((id, i) => {
      v.cards[id] = { id, code: CODES[i] as string, owner: looker }
      v.fields[looker].deck[i] = { card: seat === looker ? id : null, knownBy: 1 << looker }
    })
    return v
  }

  const nameOf = (v: PlayerView, id: number): string => v.defs[v.cards[id]!.code]!.name

  it('names the card at the PICKED index — not merely some card', () => {
    const v = lookedView(HUMAN)
    // Distinct codes, so an off-by-one or a hard-coded slot shows up as the wrong NAME rather than passing.
    expect(describeChoice(v, { type: 'chooseFromDeck', player: HUMAN, picks: [1] })).toBe(`Take ${nameOf(v, 902)}`)
    expect(describeChoice(v, { type: 'chooseFromDeck', player: HUMAN, picks: [2] })).toBe(`Take ${nameOf(v, 903)}`)
    expect(describeChoice(v, { type: 'chooseFromDeck', player: HUMAN, picks: [0, 2] }))
      .toBe(`Take ${nameOf(v, 901)} and ${nameOf(v, 903)}`)
  })

  it('says only how many when the viewer is not the one who looked', () => {
    // The AI looked at ITS deck; the human is the viewer. The indices are positions in the AI's deck, which
    // this seat holds as `card: null` — so there is nothing to name and the count is the whole truth.
    const v = lookedView(HUMAN, AI)
    expect(describeChoice(v, { type: 'chooseFromDeck', player: AI, picks: [1] })).toBe('Take 1 card')
    expect(describeChoice(v, { type: 'chooseFromDeck', player: AI, picks: [0, 2] })).toBe('Take 2 cards')
  })

  it("reads the CHOOSER's deck, not the viewer's", () => {
    // Both seats have known top-three slots, holding different cards. Indexing `v.me`'s deck instead of
    // `c.player`'s would name the human's own card as the one the AI took.
    const v = lookedView(HUMAN)                       // the human's three, known to the human
    v.fields[AI].deck[1] = { card: 904, knownBy: 3 }  // a card BOTH seats can see, in the AI's deck
    v.cards[904] = { id: 904, code: '18-069C', owner: AI }
    expect(describeChoice(v, { type: 'chooseFromDeck', player: AI, picks: [1] })).toBe(`Take ${nameOf(v, 904)}`)
    // ...and the human's own slot 1 is a different card, which must NOT be what the AI's label names.
    expect(nameOf(v, 902)).not.toBe(nameOf(v, 904))
  })

  it('says so plainly when nothing is taken', () => {
    expect(describeChoice(lookedView(HUMAN), { type: 'chooseFromDeck', player: HUMAN, picks: [] })).toBe('Take nothing')
  })

  it('a SEARCH says it PLAYS the card, because that is where the card goes', () => {
    // Same command, same view, different destination — "Take Cloud" names the wrong move for a clause that
    // puts the card onto the field. The pending is what carries it.
    const v = lookedView(HUMAN)
    v.pending = { kind: 'chooseFromDeck', player: HUMAN, min: 0, max: 1, count: 3, scope: 'top', to: 'field' }
    expect(describeChoice(v, { type: 'chooseFromDeck', player: HUMAN, picks: [1] })).toBe(`Play ${nameOf(v, 902)} onto the field`)
    expect(describeChoice(v, { type: 'chooseFromDeck', player: HUMAN, picks: [] })).toBe('Find nothing')
  })
})
