import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { apply, isLegal, legalCommands, viewFor, type CardDef, type CardId, type GameState, type Payment } from '@fftcg/engine'
import { endPhase, makeDef, makeGame, withField, withHandSize, VANILLA_POOL } from '../../../packages/engine/test/helpers.js'
import { CARD_DEFS, DECKS, LB_DECKS } from '../src/deck.js'
import { buildChoiceSet, castBlockerText, describeChoice, paymentAlternatives, preferredChoices, samePayment } from '../src/game/commands.js'
import { completedChoice, extendable, flipCandidates, flipsNeeded, legalPaymentsOf, needsTray, withBackup, withFlip } from '../src/game/payment.js'
import { describeEvent } from '../src/game/useGame.js'
import { HUMAN } from '../src/game/types.js'
import { Card } from '../src/ui/Card.js'
import { PaymentTray } from '../src/ui/PaymentTray.js'

/**
 * Rung J8 (spec J8-A5, §15.2.8): the browser's side of Limit Break — the LB row's badges, the tray's flips, the
 * move line that names them, and the log lines for the flip and the return. Synthetic LB cards on the engine's
 * vanilla pool; the real starter LB deck is checked once, by shape.
 */

const DEFS: CardDef[] = [
  ...VANILLA_POOL,
  makeDef({ code: 'T-LB2', name: 'Noctis', cost: 0, power: 5000, limitBreak: 2, generic: false }),
  makeDef({ code: 'T-LB1', name: 'Maat', cost: 0, power: 3000, limitBreak: 1 }),
]
const LB = ['T-LB2', 'T-LB1', 'T-LB1', 'T-LB1']
const NO_CP: Payment = { dullBackups: [], discards: [] }

/** The human (player 0) in Main Phase 1 with an empty hand and a four-card LB deck; the free LB2 needs two flips. */
function position(): { s: GameState; lb2: CardId; maats: CardId[] } {
  const s = withHandSize(withHandSize(makeGame({ defs: DEFS, lbDecks: [LB, LB] }), 0, 0), 1, 0)
  const lb = s.players[HUMAN].lbDeck
  const lb2 = lb.find((x) => s.cards[x.id]!.code === 'T-LB2')!.id
  const maats = lb.filter((x) => s.cards[x.id]!.code === 'T-LB1').map((x) => x.id)
  return { s, lb2, maats }
}

describe('the LB deck in the browser (J8-A5)', () => {
  it('the browser game deals both seats the starter LB deck, face down', () => {
    const s = makeGame({ seed: 3, decks: DECKS, defs: CARD_DEFS, lbDecks: LB_DECKS })
    for (const p of [0, 1] as const) {
      expect(s.players[p].lbDeck.map((x) => s.cards[x.id]!.code)).toEqual(['23-125R', '23-125R', '22-119R', '22-119R'])
      expect(s.players[p].lbDeck.every((x) => !x.faceUp)).toBe(true)
    }
  })

  it('the card sheet explains an LB card that cannot be cast: the last face-down one, and a spent one (J8 second review L2)', () => {
    const { s, lb2, maats } = position()
    // Flip every other card face up: Noctis is spent, and the last face-down Maat has nothing left to flip.
    const lb = s.players[HUMAN].lbDeck.map((x) => (x.id === maats[2] ? x : { ...x, faceUp: true }))
    const t: GameState = { ...s, players: [{ ...s.players[HUMAN], lbDeck: lb }, s.players[1]] }
    const v = viewFor(t, HUMAN)
    expect(castBlockerText(v, maats[2]!, false)).toBe('Not enough face-down cards left in your LB deck for its Limit Break cost')
    expect(castBlockerText(v, lb2, false)).toBe('Spent — a face-up LB card is not cast again')
    expect(castBlockerText(viewFor(t, 1), lb2, false), "the opponent's LB row has no sheet refusals").toBeNull()
  })

  it('Auto casts with the PREFERRED flips, not the canonical subset: Maat flips a twin Maat, not Noctis (J8 second review M1)', () => {
    const { s, lb2, maats } = position()
    const v = viewFor(s, HUMAN)
    const legal = legalCommands(s, HUMAN)
    const canonical = legal.find((c) => c.type === 'castCharacter' && c.card === maats[0])
    expect(canonical?.type === 'castCharacter' && canonical.payment.lbFlip, 'the canonical subset is the first face-down other: Noctis').toEqual([lb2])
    const auto = preferredChoices(v, legal).find((c) => c.type === 'castCharacter' && c.card === maats[0])
    const flip = auto?.type === 'castCharacter' ? auto.payment.lbFlip ?? [] : []
    expect(flip).toHaveLength(1)
    expect(maats, 'a twin is worth least to keep').toContain(flip[0])
    expect(isLegal(s, auto!)).toBeNull()
  })

  it('a cast from the LB deck is a choice on the LB card, and its move line names the deck and the flips', () => {
    const { s, lb2, maats } = position()
    const v = viewFor(s, HUMAN)
    const legal = legalCommands(s, HUMAN)
    const set = buildChoiceSet(v, preferredChoices(v, legal), paymentAlternatives(legal))
    const choices = set.byCard.get(lb2) ?? []
    expect(choices, 'the face-down LB card is pressable').toHaveLength(1)
    const c = choices[0]!
    expect(c.command.type).toBe('castCharacter')
    expect(needsTray(c), 'a free cast with a Limit Break cost still opens the tray').toBe(true)
    const flip = c.command.type === 'castCharacter' ? c.command.payment.lbFlip ?? [] : []
    expect(flip).toHaveLength(2)
    expect(describeChoice(v, c.command, { payment: false })).toBe('Cast Noctis from your LB deck')
    expect(describeChoice(v, c.command)).toBe('Cast Noctis from your LB deck, turning Maat, Maat face up (free)')
    expect(describeChoice(viewFor(s, 1), { ...c.command }), "the AI's cast, from the human's view").toBe("Cast Noctis from the AI's LB deck, turning Maat, Maat face up (free)")
    expect(describeChoice(v, { ...c.command, payment: { dullBackups: [], discards: [{ card: lb2, element: 'earth' }], lbFlip: [maats[0]!] } } as typeof c.command)).toBe('Cast Noctis from your LB deck, turning Maat face up, paying: discard Noctis as earth')
    // ONE canonical flip subset is listed (review M2); any two of the three Maats are legal.
    const payments = legalPaymentsOf(c)
    expect(payments).toHaveLength(1)
    expect(flipsNeeded(payments)).toBe(2)
    expect(payments.every((p) => p.lbFlip?.length === 2 && p.lbFlip.every((id) => maats.includes(id)))).toBe(true)
  })

  it('the picker offers face-down LB cards as flips, stays inside a listed payment, and completes only with X flips', () => {
    const { s, lb2, maats } = position()
    const v = viewFor(s, HUMAN)
    const legal = legalCommands(s, HUMAN)
    const set = buildChoiceSet(v, preferredChoices(v, legal), paymentAlternatives(legal))
    const c = set.byCard.get(lb2)![0]!
    const payments = legalPaymentsOf(c)
    const flips = flipCandidates(v, lb2)
    expect([...flips].sort()).toEqual([...maats].sort())
    expect(flips.has(lb2), 'the cast card never flips itself').toBe(false)
    let sel: Payment = NO_CP
    expect(completedChoice(c, sel)).toBeNull()
    expect(extendable(payments, sel, { flip: maats[0]! })).toBe(true)
    sel = withFlip(sel, maats[0]!, true)
    expect(completedChoice(c, sel), 'one of two flips is not a payment').toBeNull()
    expect(extendable(payments, sel, { flip: maats[1]! })).toBe(true)
    // The player's OWN pair — not the listed canonical one — completes, and the engine accepts it.
    sel = withFlip(sel, maats[2]!, true)
    const done = completedChoice(c, sel)
    expect(done).not.toBeNull()
    expect(done!.command.type === 'castCharacter' && samePayment(done!.command.payment, { ...NO_CP, lbFlip: [maats[0]!, maats[2]!] })).toBe(true)
    expect(isLegal(s, done!.command), 'any X-subset is legal').toBeNull()
    expect(extendable(payments, sel, { flip: maats[1]! }), 'a third flip is one too many').toBe(false)
    // Taking a flip back, and a CP source toggled beside the flips, keeps the flips.
    expect(withFlip(sel, maats[2]!, false).lbFlip).toEqual([maats[0]])
    expect(withBackup(sel, lb2, true).lbFlip, 'a CP toggle keeps the flips').toEqual(sel.lbFlip)
    // samePayment sees the flips: the same CP with different flips is a different payment.
    expect(samePayment({ ...NO_CP, lbFlip: [maats[0]!] }, { ...NO_CP, lbFlip: [maats[1]!] })).toBe(false)
    expect(samePayment({ ...NO_CP, lbFlip: [maats[0]!, maats[1]!] }, { ...NO_CP, lbFlip: [maats[1]!, maats[0]!] })).toBe(true)
    expect(samePayment(NO_CP, { ...NO_CP, lbFlip: [] })).toBe(true)
  })

  it('the tray shows the Limit Break pips — chosen of needed', () => {
    const html = renderToStaticMarkup(<PaymentTray crystals={[]} complete={false} ask={null} flips={{ need: 2, chosen: 1 }} onAuto={() => {}} onClear={() => {}} onCancel={() => {}} onConfirm={() => {}} onDeclare={() => {}} />)
    expect(html).toContain('data-lb-flips="1/2"')
    expect(html).toContain('1 of 2 LB cards turned face up')
    const none = renderToStaticMarkup(<PaymentTray crystals={[]} complete={false} ask={null} flips={null} onAuto={() => {}} onClear={() => {}} onCancel={() => {}} onConfirm={() => {}} onDeclare={() => {}} />)
    expect(none).not.toContain('data-lb-flips')
  })

  it('an LB-deck card wears an LB badge face down and a Spent badge face up; a picked flip says so', () => {
    const base = { code: 'T-LB1', name: 'Maat', cost: 0, elements: ['earth' as const], type: 'forward' as const, power: 3000 }
    const down = renderToStaticMarkup(<Card {...base} lb="down" />)
    expect(down).toContain('>LB<')
    expect(down).toContain('in the LB deck, face down')
    const up = renderToStaticMarkup(<Card {...base} lb="up" />)
    expect(up).toContain('>Spent<')
    expect(up).toContain('face up — spent')
    const flip = renderToStaticMarkup(<Card {...base} lb="down" paying="flip" />)
    expect(flip).toContain('is-paying-flip')
    expect(flip).toContain('will be turned face up to pay the Limit Break cost')
  })

  it('the log narrates the flip and the return, from both seats', () => {
    const { s, lb2, maats } = position()
    const flips = [maats[0]!, maats[1]!]
    const r = apply(s, { type: 'castCharacter', player: HUMAN, card: lb2, payment: { ...NO_CP, lbFlip: flips } })
    const flipped = r.events.find((e) => e.type === 'lbFlipped')!
    expect(describeEvent(viewFor(r.state, HUMAN), flipped)?.text).toBe('You turn Maat and Maat face up (Limit Break cost)')
    expect(describeEvent(viewFor(r.state, 1), flipped)?.text).toBe('The AI turns Maat and Maat face up (Limit Break cost)')
    // Noctis (5000) attacks into a 5000 blocker and is broken: the Break Zone arrival, then the return face up.
    // Noctis entered this turn (§10.1.2.1.1): backdate its arrival so it may attack now.
    let t: GameState = { ...r.state, players: [{ ...r.state.players[0], forwards: r.state.players[0].forwards.map((f) => (f.id === lb2 ? { ...f, enteredTurn: 0 } : f)) }, r.state.players[1]] }
    const [u, big] = withField(t, 1, 'forwards', 'V-F2')
    t = u
    t = endPhase(t)
    t = apply(t, { type: 'declareAttack', player: HUMAN, attackers: [lb2] }).state
    t = apply(t, { type: 'pass', player: HUMAN }).state
    t = apply(t, { type: 'pass', player: 1 }).state
    t = apply(t, { type: 'declareBlock', player: 1, blocker: big }).state
    t = apply(t, { type: 'pass', player: HUMAN }).state
    const r2 = apply(t, { type: 'pass', player: 1 })
    const returned = r2.events.find((e) => e.type === 'lbReturned')
    expect(returned).toBeDefined()
    expect(describeEvent(viewFor(r2.state, HUMAN), returned!)?.text).toBe('Noctis goes back to your LB deck face up')
    expect(describeEvent(viewFor(r2.state, 1), returned!)?.text).toBe("Noctis goes back to the AI's LB deck face up")
  })
})
