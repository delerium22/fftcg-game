import { describe, expect, it } from 'vitest'
import { createGame, validateDeck, applyChooseFirst, applyMulligan } from '../src/setup.js'
import { IllegalCommandError } from '../src/errors.js'
import { DEFAULT_DECK as DECK, VANILLA_POOL } from './helpers.js'

const defs = Object.fromEntries(VANILLA_POOL.map((d) => [d.code, d]))
const opts = { seed: 3, decks: [DECK, DECK] as [string[], string[]], defs: VANILLA_POOL }

describe('§8.1 deck construction', () => {
  it('requires exactly 50 cards', () => {
    expect(validateDeck(defs, DECK.slice(0, 49))).toEqual([expect.stringMatching(/50/)])
  })
  it('allows at most 3 copies of a card number', () => {
    const bad = [...DECK.slice(0, 46), 'V-F1', 'V-F1', 'V-F1', 'V-F1']
    expect(validateDeck(defs, bad).some((m) => /V-F1.*3/.test(m))).toBe(true)
  })
  it('rejects unknown codes', () => {
    expect(validateDeck(defs, [...DECK.slice(0, 49), 'NOPE'])).toEqual([expect.stringMatching(/NOPE/)])
  })
  it('the default fixture deck is legal and createGame enforces validation', () => {
    expect(validateDeck(defs, DECK)).toEqual([])
    expect(() => createGame({ ...opts, decks: [DECK.slice(0, 49), DECK] })).toThrow(/50/)
  })
})

describe('§8.2 setup', () => {
  it('creates 100 card instances, shuffled decks of 50, and asks a random player to choose first', () => {
    const s = createGame(opts)
    expect(Object.keys(s.cards)).toHaveLength(100)
    expect(s.players[0].deck).toHaveLength(50)
    expect(s.players[1].deck).toHaveLength(50)
    expect(s.players[0].deck.map((id) => s.cards[id]!.code)).not.toEqual(DECK)
    expect(s.phase).toBe('setup')
    expect(s.pending?.kind).toBe('chooseFirst')
    expect(s.players[0].hand).toHaveLength(0)
  })
  it('is deterministic per seed', () => {
    expect(createGame(opts)).toEqual(createGame(opts))
    expect(createGame({ ...opts, seed: 4 })).not.toEqual(createGame(opts))
  })
  it('§8.2.1.3–4: after choosing, both draw 5 and the first player decides mulligan first', () => {
    let s = createGame(opts)
    const chooser = (s.pending as { player: 0 | 1 }).player
    ;[s] = applyChooseFirst(s, chooser, false)
    const first = chooser === 0 ? 1 : 0
    expect(s.firstPlayer).toBe(first)
    expect(s.players[0].hand).toHaveLength(5)
    expect(s.players[1].hand).toHaveLength(5)
    expect(s.pending).toEqual({ kind: 'mulligan', player: first })
  })
  it('§8.2.1.4: mulligan puts the 5 cards on the bottom and draws 5 new', () => {
    let s = createGame(opts)
    ;[s] = applyChooseFirst(s, (s.pending as { player: 0 | 1 }).player, true)
    const p = s.firstPlayer
    const oldHand = [...s.players[p].hand]
    ;[s] = applyMulligan(s, p, true)
    expect(s.players[p].hand).toHaveLength(5)
    expect(s.players[p].hand.some((id) => oldHand.includes(id))).toBe(false)
    expect(s.players[p].deck.slice(-5).sort()).toEqual([...oldHand].sort())
    expect(s.pending).toEqual({ kind: 'mulligan', player: p === 0 ? 1 : 0 })
  })
  it('after both mulligan decisions the game leaves setup (turn 1 details are tested with the draw phase in cr9)', () => {
    let s = createGame(opts)
    ;[s] = applyChooseFirst(s, (s.pending as { player: 0 | 1 }).player, true)
    const p = s.firstPlayer
    ;[s] = applyMulligan(s, p, false)
    ;[s] = applyMulligan(s, p === 0 ? 1 : 0, false)
    expect(s.phase).not.toBe('setup'); expect(s.pending).toBeNull(); expect(s.turn).toBe(1); expect(s.turnPlayer).toBe(p)
  })
  it('decisions are validated: wrong player or wrong pending kind throws', () => {
    let s = createGame(opts)
    const chooser = (s.pending as { player: 0 | 1 }).player
    expect(() => applyChooseFirst(s, chooser === 0 ? 1 : 0, true)).toThrow(IllegalCommandError)
    expect(() => applyMulligan(s, chooser, false)).toThrow(IllegalCommandError)
    ;[s] = applyChooseFirst(s, chooser, true)
    expect(() => applyChooseFirst(s, chooser, true)).toThrow(IllegalCommandError)
    expect(() => applyMulligan(s, s.firstPlayer === 0 ? 1 : 0, false)).toThrow(IllegalCommandError)
  })
})
