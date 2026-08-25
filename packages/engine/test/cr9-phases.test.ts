import { describe, expect, it } from 'vitest'
import { applyPass, applyDiscardToHandSize, drawCards, startTurn } from '../src/phases.js'
import { IllegalCommandError } from '../src/errors.js'
import { makeGame, withField, withHandSize } from './helpers.js'

describe('§9.1 active phase', () => {
  it('activates all of the turn player\'s dull cards and only theirs', () => {
    let s = makeGame(); let a: number, b: number
    ;[s, a] = withField(s, 0, 'backups', 'V-B1', { status: 'dull' })
    ;[s, b] = withField(s, 1, 'forwards', 'V-F2', { status: 'dull' })
    const [t, events] = startTurn(s, 2, 0)
    expect(t.players[0].backups[0]?.status).toBe('active')
    expect(t.players[1].forwards[0]?.status).toBe('dull')
    expect(events).toContainEqual({ type: 'activated', player: 0, cards: [a] })
    void b
  })
})

describe('§9.2 draw phase', () => {
  it('draws 2 on a normal turn', () => {
    const s = makeGame()
    const before = s.players[1].hand.length
    const [t] = startTurn(s, 2, 1)
    expect(t.players[1].hand).toHaveLength(before + 2)
    expect(t.phase).toBe('main1'); expect(t.priority).toBe(1); expect(t.turn).toBe(2)
  })
  it('§8.2.1.5 / §9.2.1.3: after setup, turn 1 starts in main1 and the first player has drawn only 1 card', () => {
    const s = makeGame()   // helpers resolve setup; player 0 is first
    expect(s.turn).toBe(1); expect(s.turnPlayer).toBe(0); expect(s.phase).toBe('main1'); expect(s.priority).toBe(0); expect(s.pending).toBeNull()
    expect(s.players[0].hand).toHaveLength(6)
    expect(s.players[1].hand).toHaveLength(5)
  })
  it('§3.1.2: drawing from an empty deck loses the game', () => {
    let s = makeGame()
    s = { ...s, players: [{ ...s.players[0], deck: s.players[0].deck.slice(0, 1) }, s.players[1]] }
    const [t] = drawCards(s, 0, 2)
    expect(t.result).toEqual({ winner: 1, reason: expect.stringMatching(/draw/i) })
  })
})

describe('§9.3–9.5 passing through phases', () => {
  it('main1 → attack declaration → main2 → end → next turn', () => {
    let s = withHandSize(makeGame(), 0, 5)   // avoid the hand-size discard decision
    expect(s.phase).toBe('main1')
    ;[s] = applyPass(s, 0)
    expect(s.phase).toBe('attack'); expect(s.attack?.step).toBe('declaration'); expect(s.priority).toBe(0)
    ;[s] = applyPass(s, 0)
    expect(s.phase).toBe('main2'); expect(s.attack).toBeNull()
    ;[s] = applyPass(s, 0)
    expect(s.turn).toBe(2); expect(s.turnPlayer).toBe(1); expect(s.phase).toBe('main1'); expect(s.priority).toBe(1)
  })
  it('§9.5.1.2: with more than 5 cards in hand, the end phase asks for discards', () => {
    let s = makeGame()   // player 0 has 6 cards
    ;[s] = applyPass(s, 0); [s] = applyPass(s, 0); [s] = applyPass(s, 0)
    expect(s.phase).toBe('end')
    expect(s.pending).toEqual({ kind: 'discardToHandSize', player: 0, count: 1 })
    const victim = s.players[0].hand[0]!
    ;[s] = applyDiscardToHandSize(s, 0, [victim])
    expect(s.players[0].breakZone).toContain(victim)
    expect(s.players[0].hand).toHaveLength(5)
    expect(s.turn).toBe(2)
  })
  it('§9.5.1.3: damage on forwards and attacked flags are cleared at end of turn', () => {
    let s = withHandSize(makeGame(), 0, 5); let f: number
    ;[s, f] = withField(s, 0, 'forwards', 'V-F2', { damage: 3000, attackedThisTurn: true, granted: ['haste'] })
    ;[s] = applyPass(s, 0); [s] = applyPass(s, 0); [s] = applyPass(s, 0)
    const fc = s.players[0].forwards.find((c) => c.id === f)!
    expect(fc.damage).toBe(0); expect(fc.attackedThisTurn).toBe(false); expect(fc.granted).toEqual([])
  })
  it('pass and discard validate their preconditions', () => {
    let s = makeGame()
    expect(() => applyPass(s, 1)).toThrow(IllegalCommandError)                       // not the priority holder
    ;[s] = applyPass(s, 0); [s] = applyPass(s, 0); [s] = applyPass(s, 0)             // → end phase, discard pending
    expect(() => applyPass(s, 0)).toThrow(IllegalCommandError)                       // decision pending
    expect(() => applyDiscardToHandSize(s, 1, [s.players[1].hand[0]!])).toThrow(IllegalCommandError)
    expect(() => applyDiscardToHandSize(s, 0, [])).toThrow(/exactly 1/)
    expect(() => applyDiscardToHandSize(s, 0, [12345])).toThrow(/hand/)
  })
})
