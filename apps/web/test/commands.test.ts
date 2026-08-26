import { describe, expect, it } from 'vitest'
import {
  actingPlayer, apply, createGame, legalCommands, viewFor,
  type CardId, type Command, type GameState, type PlayerView,
} from '@fftcg/engine'
import { GreedyAgent, preferredPayment } from '@fftcg/ai'
import { CARD_DEFS, DECKS } from '../src/deck.js'
import { buildChoiceSet, describeChoice, preferredChoices, samePayment } from '../src/game/commands.js'
import { AI, HUMAN } from '../src/game/types.js'
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

  it('leaves non-cast commands untouched and preserves relative order', () => {
    const collapsed = preferredChoices(view, legal)
    const nonCast = (cs: Command[]) => cs.filter((c) => c.type !== 'castCharacter' && c.type !== 'castSummon')
    expect(nonCast(collapsed)).toEqual(nonCast(legal))
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
