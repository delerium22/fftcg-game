import { describe, expect, it } from 'vitest'
import { applyPass, applyDiscardToHandSize, drawCards, startTurn } from '../src/phases.js'
import { apply } from '../src/apply.js'
import type { GameState } from '../src/state.js'
import type { PlayerId } from '../src/types.js'
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

/**
 * A pass as the GAME performs one: through `apply`, which settles afterwards.
 *
 * Since C5 the Attack Phase is entered in two steps — preparation, then a continuation into declaration once
 * any beginning-of-phase clause has drained — and it is `settle` inside `apply` that runs the continuation.
 * `applyPass` on its own now stops in preparation, which is correct and which real play never observes.
 */
const pass = (state: GameState, player: PlayerId): GameState => apply(state, { type: 'pass', player }).state

describe("the turn's Break Zone history clears at the turn boundary (spec C10-3)", () => {
  it('startTurn clears it for BOTH players', () => {
    // Pinned on `startTurn` directly, not through a game, because no card in this pool can be broken by the
    // final End Phase rule-process pass: damage is removed first (§9.5.1.3.1) and clearing a `powerBonus`
    // cannot drop a printed power to zero. So clearing one phase too early — in `finishEndPhase`'s per-turn
    // reset, before that pass — is behaviourally identical TODAY and no game-level test can tell. It is
    // still wrong, and this is where it stops being wrong quietly.
    const base = makeGame()
    const seeded: GameState = { ...base, players: [
      { ...base.players[0], breakZone: [1], putIntoBreakZoneFromFieldThisTurn: [1] },
      { ...base.players[1], breakZone: [2], putIntoBreakZoneFromFieldThisTurn: [2] },
    ] }
    const [after] = startTurn(seeded, seeded.turn + 1, 1)
    expect(after.players[0].putIntoBreakZoneFromFieldThisTurn).toEqual([])
    expect(after.players[1].putIntoBreakZoneFromFieldThisTurn).toEqual([])
  })
})

describe('§9.3–9.5 passing through phases', () => {
  it('main1 → attack declaration → main2 → end → next turn', () => {
    let s = withHandSize(makeGame(), 0, 5)   // avoid the hand-size discard decision
    expect(s.phase).toBe('main1')
    s = pass(s, 0)
    expect(s.phase).toBe('attack'); expect(s.attack?.step).toBe('declaration'); expect(s.priority).toBe(0)
    s = pass(s, 0)
    expect(s.phase).toBe('main2'); expect(s.attack).toBeNull()
    s = pass(s, 0)
    expect(s.turn).toBe(2); expect(s.turnPlayer).toBe(1); expect(s.phase).toBe('main1'); expect(s.priority).toBe(1)
  })
  it('§9.5.1.2: with more than 5 cards in hand, the end phase asks for discards', () => {
    let s = makeGame()   // player 0 has 6 cards
    s = pass(pass(pass(s, 0), 0), 0)
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
    s = pass(pass(pass(s, 0), 0), 0)
    const fc = s.players[0].forwards.find((c) => c.id === f)!
    expect(fc.damage).toBe(0); expect(fc.attackedThisTurn).toBe(false); expect(fc.granted).toEqual([])
  })
  it('pass and discard validate their preconditions', () => {
    let s = makeGame()
    expect(() => applyPass(s, 1)).toThrow(IllegalCommandError)                       // not the priority holder
    s = pass(pass(pass(s, 0), 0), 0)             // → end phase, discard pending
    expect(() => applyPass(s, 0)).toThrow(IllegalCommandError)                       // decision pending
    expect(() => applyDiscardToHandSize(s, 1, [s.players[1].hand[0]!])).toThrow(IllegalCommandError)
    expect(() => applyDiscardToHandSize(s, 0, [])).toThrow(/exactly 1/)
    expect(() => applyDiscardToHandSize(s, 0, [12345])).toThrow(/hand/)
  })
})
