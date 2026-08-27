import { describe, expect, it } from 'vitest'
import { canPay, enumeratePayments, generateCp, pay, requiredElements } from '../src/cp.js'
import { applyCastCharacter } from '../src/cast.js'
import { IllegalCommandError } from '../src/errors.js'
import { VANILLA_POOL, makeDef, makeGame, withField, withHand } from './helpers.js'

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
      // C6: a dulled Backup carries the SET of Elements it may count as; a discard declares one and yields two.
      .toEqual([{ elements: ['earth'], source: b1 }, { elements: ['lightning'], source: h1 }, { elements: ['lightning'], source: h1 }])
  })
  it('a dull backup cannot generate CP', () => {
    const { s, b2, target } = setup()
    expect(() => generateCp(s, 0, { dullBackups: [b2], discards: [] }, target)).toThrow(IllegalCommandError)
  })
  it('a multi-element discard must declare one of its own elements', () => {
    const { s, h2, target } = setup()
    expect(generateCp(s, 0, { dullBackups: [], discards: [{ card: h2, element: 'earth' }] }, target)[0]?.elements).toEqual(['earth'])
    expect(() => generateCp(s, 0, { dullBackups: [], discards: [{ card: h2, element: 'fire' }] }, target)).toThrow(IllegalCommandError)
  })
  it('the card being cast cannot be discarded to pay for itself', () => {
    const { s, target } = setup()
    expect(() => generateCp(s, 0, { dullBackups: [], discards: [{ card: target, element: 'earth' }] }, target)).toThrow(IllegalCommandError)
  })
})

describe('§11.2.2 paying a cost', () => {
  const E = (e: 'earth' | 'lightning', n = 1) => Array.from({ length: n }, (_, i) => ({ elements: [e], source: 100 + i }))
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

describe('required Elements are a MULTISET, not a set', () => {
  const E = (e: 'earth' | 'lightning', n = 1) => Array.from({ length: n }, (_, i) => ({ elements: [e], source: 100 + i }))

  // `[Lightning][Lightning]` needs TWO Lightning CP. Under `elements.every(e => cp.some(...))` the same single
  // Lightning satisfied both entries, so one Lightning plus one Earth paid a doubled cost. No card in the
  // MVP0 pool prints a repeated Element, so this was latent — but the requirement type now describes ability
  // costs too, which is exactly where repeated Elements turn up.
  it('one Lightning does not pay [Lightning][Lightning]', () => {
    expect(canPay(2, ['lightning', 'lightning'], [...E('lightning'), ...E('earth')])).toBe(false)
    expect(canPay(2, ['lightning', 'lightning'], E('lightning', 2))).toBe(true)
  })

  it('still accepts one CP per DISTINCT element when the requirement is not repeated', () => {
    expect(canPay(2, ['lightning', 'earth'], [...E('lightning'), ...E('earth')])).toBe(true)
  })

  it('counts surplus of the wrong element as no help', () => {
    expect(canPay(3, ['lightning', 'lightning'], [...E('lightning'), ...E('earth', 2)])).toBe(false)
    expect(canPay(3, ['lightning', 'lightning'], [...E('lightning', 2), ...E('earth')])).toBe(true)
  })
})

describe('enumeratePayments', () => {
  it('lists only minimal payments and never uses the cast card, dull backups or the wrong element alone', () => {
    const { s, b1, h1, h2, target } = setup()
    const ps = enumeratePayments(s, 0, target)   // earth, cost 2
    // legal minimal: {b1 + discard h1 as lightning}, {discard h2 as earth}, {b1 + discard h2 as lightning}; {b1 + h2 as earth} is NOT minimal (h2 alone pays)
    expect(ps).toContainEqual({ dullBackups: [b1], discards: [{ card: h1, element: 'lightning' }] })
    expect(ps).toContainEqual({ dullBackups: [], discards: [{ card: h2, element: 'earth' }] })
    expect(ps).toContainEqual({ dullBackups: [b1], discards: [{ card: h2, element: 'lightning' }] })
    expect(ps).not.toContainEqual({ dullBackups: [], discards: [{ card: h1, element: 'lightning' }] })   // no earth CP
    expect(ps).not.toContainEqual({ dullBackups: [b1], discards: [{ card: h1, element: 'lightning' }, { card: h2, element: 'earth' }] }) // not minimal
    expect(ps).not.toContainEqual({ dullBackups: [b1], discards: [{ card: h2, element: 'earth' }] })   // h2-as-earth alone already pays → not minimal
    for (const p of ps) expect(p.discards.some((d) => d.card === target)).toBe(false)
  })
  it('returns [] when the cost cannot be met', () => {
    let s = makeGame(); let t: number
    s = { ...s, players: [{ ...s.players[0], hand: [] }, s.players[1]] }
    ;[s, t] = withHand(s, 0, 'V-F3')   // cost 3, nothing else in hand, no backups
    expect(enumeratePayments(s, 0, t)).toEqual([])
  })
})

describe('C3: requiredElements — §11.2.1.1/§11.2.2 Light/Dark same-element exemption', () => {
  it('is [] for a pure Light or pure Dark card, unchanged elements otherwise', () => {
    expect(requiredElements(makeDef({ code: 'V-L1', elements: ['light'], cost: 2, power: 5000 }))).toEqual([])
    expect(requiredElements(makeDef({ code: 'V-D1', elements: ['dark'], cost: 2, power: 5000 }))).toEqual([])
    expect(requiredElements(makeDef({ code: 'V-E1', elements: ['earth'], cost: 2, power: 5000 }))).toEqual(['earth'])
    expect(requiredElements(makeDef({ code: 'V-EL1', elements: ['earth', 'lightning'], cost: 2, power: 5000 }))).toEqual(['earth', 'lightning'])
  })
  it('a cost-2 Light forward is castable with two off-element (earth) backups', () => {
    const defs = [...VANILLA_POOL, makeDef({ code: 'V-L1', elements: ['light'], cost: 2, power: 5000 })]
    let s = makeGame({ defs }); let b1: number, b2: number, card: number
    ;[s, b1] = withField(s, 0, 'backups', 'V-B1')   // earth
    ;[s, b2] = withField(s, 0, 'backups', 'V-B3')   // earth
    ;[s, card] = withHand(s, 0, 'V-L1')
    const [t] = applyCastCharacter(s, 0, card, { dullBackups: [b1, b2], discards: [] })
    expect(t.players[0].forwards.some((c) => c.id === card)).toBe(true)
  })
  it('Light/Dark cards still cannot be discarded for CP (§11.2.1.1) even though they need no same-element CP', () => {
    const defs = [...VANILLA_POOL, makeDef({ code: 'V-L1', elements: ['light'], cost: 2, power: 5000 })]
    let s = makeGame({ defs }); let light: number, target: number
    ;[s, light] = withHand(s, 0, 'V-L1')
    ;[s, target] = withHand(s, 0, 'V-F2')   // earth cost 2
    expect(() => generateCp(s, 0, { dullBackups: [], discards: [{ card: light, element: 'earth' }] }, target)).toThrow(IllegalCommandError)
  })
})

describe('pay', () => {
  it('dulls backups and moves discards to the break zone', () => {
    const { s, b1, h1 } = setup()
    const [t, events] = pay(s, 0, { dullBackups: [b1], discards: [{ card: h1, element: 'lightning' }] })
    expect(t.players[0].backups.find((c) => c.id === b1)?.status).toBe('dull')
    expect(t.players[0].hand).not.toContain(h1)
    expect(t.players[0].breakZone).toContain(h1)
    // C6: one entry per CP, each the SET that CP may count as. These sources are all single-Element, so each
    // set is a singleton — a Moogle would show ['earth', 'lightning'].
    expect(events[0]).toEqual({ type: 'cpGenerated', player: 0, cp: [['earth'], ['lightning'], ['lightning']] })
    expect(events[1]).toEqual({ type: 'discarded', player: 0, card: h1, reason: 'cp' })
    expect(events).toHaveLength(2)
  })
})
