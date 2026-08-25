import { describe, expect, it } from 'vitest'
import { canPay, enumeratePayments, generateCp, pay } from '../src/cp.js'
import { IllegalCommandError } from '../src/errors.js'
import { makeGame, withField, withHand } from './helpers.js'

function setup() {
  let s = makeGame()
  s = { ...s, players: [{ ...s.players[0], hand: [] }, s.players[1]] }
  let b1: number, b2: number, h1: number, h2: number, target: number
  ;[s, b1] = withField(s, 0, 'backups', 'V-B1')                       // earth, active
  ;[s, b2] = withField(s, 0, 'backups', 'V-B2', { status: 'dull' })   // lightning, dull
  ;[s, h1] = withHand(s, 0, 'V-F3')                                   // lightning card in hand
  ;[s, h2] = withHand(s, 0, 'V-F4')                                   // earth/lightning card in hand
  ;[s, target] = withHand(s, 0, 'V-F2')                               // earth cost 2 — the card we are casting
  return { s, b1, b2, h1, h2, target }
}

describe('§11.2 generating CP', () => {
  it('dulling an active backup gives 1 CP of its element; discarding gives 2', () => {
    const { s, b1, h1, target } = setup()
    expect(generateCp(s, 0, { dullBackups: [b1], discards: [{ card: h1, element: 'lightning' }] }, target))
      .toEqual([{ element: 'earth', source: b1 }, { element: 'lightning', source: h1 }, { element: 'lightning', source: h1 }])
  })
  it('a dull backup cannot generate CP', () => {
    const { s, b2, target } = setup()
    expect(() => generateCp(s, 0, { dullBackups: [b2], discards: [] }, target)).toThrow(IllegalCommandError)
  })
  it('a multi-element discard must declare one of its own elements', () => {
    const { s, h2, target } = setup()
    expect(generateCp(s, 0, { dullBackups: [], discards: [{ card: h2, element: 'earth' }] }, target)[0]?.element).toBe('earth')
    expect(() => generateCp(s, 0, { dullBackups: [], discards: [{ card: h2, element: 'fire' }] }, target)).toThrow(IllegalCommandError)
  })
  it('the card being cast cannot be discarded to pay for itself', () => {
    const { s, target } = setup()
    expect(() => generateCp(s, 0, { dullBackups: [], discards: [{ card: target, element: 'earth' }] }, target)).toThrow(IllegalCommandError)
  })
})

describe('§11.2.2 paying a cost', () => {
  const E = (e: 'earth' | 'lightning', n = 1) => Array.from({ length: n }, (_, i) => ({ element: e, source: 100 + i }))
  it('needs at least one CP of the card\'s element', () => {
    expect(canPay(2, ['earth'], E('lightning', 2))).toBe(false)
    expect(canPay(2, ['earth'], [...E('earth'), ...E('lightning')])).toBe(true)
  })
  it('§11.2.2.3: excess CP is allowed and wasted', () => {
    expect(canPay(1, ['earth'], [...E('earth'), ...E('lightning', 2)])).toBe(true)
  })
  it('§11.2.2.1: multi-element cards need one CP of each element', () => {
    expect(canPay(2, ['earth', 'lightning'], E('earth', 2))).toBe(false)
    expect(canPay(2, ['earth', 'lightning'], [...E('earth'), ...E('lightning')])).toBe(true)
  })
  it('§11.2.2.4: cost 0 must not generate CP', () => {
    expect(canPay(0, ['earth'], [])).toBe(true)
    expect(canPay(0, ['earth'], E('earth'))).toBe(false)
  })
})

describe('enumeratePayments', () => {
  it('lists only minimal payments and never uses the cast card, dull backups or the wrong element alone', () => {
    const { s, b1, h1, h2, target } = setup()
    const ps = enumeratePayments(s, 0, target)   // earth, cost 2
    // legal minimal: {b1 + discard h1 as lightning}, {discard h2 as earth}, {b1 + discard h2 as lightning}; {b1 + h2 as earth} is NOT minimal (h2 alone pays)
    expect(ps).toContainEqual({ dullBackups: [b1], discards: [{ card: h1, element: 'lightning' }] })
    expect(ps).toContainEqual({ dullBackups: [], discards: [{ card: h2, element: 'earth' }] })
    expect(ps).not.toContainEqual({ dullBackups: [], discards: [{ card: h1, element: 'lightning' }] })   // no earth CP
    expect(ps).not.toContainEqual({ dullBackups: [b1], discards: [{ card: h1, element: 'lightning' }, { card: h2, element: 'earth' }] }) // not minimal
    for (const p of ps) expect(p.discards.some((d) => d.card === target)).toBe(false)
  })
  it('returns [] when the cost cannot be met', () => {
    let s = makeGame(); let t: number
    s = { ...s, players: [{ ...s.players[0], hand: [] }, s.players[1]] }
    ;[s, t] = withHand(s, 0, 'V-F3')   // cost 3, nothing else in hand, no backups
    expect(enumeratePayments(s, 0, t)).toEqual([])
  })
})

describe('pay', () => {
  it('dulls backups and moves discards to the break zone', () => {
    const { s, b1, h1 } = setup()
    const [t, events] = pay(s, 0, { dullBackups: [b1], discards: [{ card: h1, element: 'lightning' }] })
    expect(t.players[0].backups.find((c) => c.id === b1)?.status).toBe('dull')
    expect(t.players[0].hand).not.toContain(h1)
    expect(t.players[0].breakZone).toContain(h1)
    expect(events).toContainEqual({ type: 'discarded', player: 0, card: h1, reason: 'cp' })
  })
})
