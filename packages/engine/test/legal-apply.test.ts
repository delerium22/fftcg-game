import { describe, expect, it } from 'vitest'
import { createGame } from '../src/setup.js'
import { apply } from '../src/apply.js'
import { actingPlayer, legalCommands } from '../src/legal.js'
import { checkInvariants } from '../src/invariants.js'
import { IllegalCommandError } from '../src/errors.js'
import { nextInt, seedRng } from '../src/rng.js'
import { DEFAULT_DECK, VANILLA_POOL, makeGame, withField, withHand, withHandSize } from './helpers.js'

describe('legalCommands', () => {
  it('during setup only the chooser may act; concede is legal for both', () => {
    const s = createGame({ seed: 1, decks: [DEFAULT_DECK, DEFAULT_DECK], defs: VANILLA_POOL })
    const p = actingPlayer(s)!
    expect(legalCommands(s, p).map((c) => c.type).sort()).toEqual(['chooseFirst', 'chooseFirst', 'concede'])
    expect(legalCommands(s, p === 0 ? 1 : 0)).toEqual([{ type: 'concede', player: p === 0 ? 1 : 0 }])
  })
  it('in main phase: pass, concede, and one castCharacter per affordable card × minimal payment', () => {
    let s = makeGame()
    s = withHandSize(s, 0, 0)
    let b: number, f: number
    ;[s, b] = withField(s, 0, 'backups', 'V-B1')
    ;[s, f] = withHand(s, 0, 'V-F1')   // earth cost 1
    const cmds = legalCommands(s, 0)
    expect(cmds).toContainEqual({ type: 'pass', player: 0 })
    expect(cmds).toContainEqual({ type: 'castCharacter', player: 0, card: f, payment: { dullBackups: [b], discards: [] } })
    expect(cmds.filter((c) => c.type === 'castCharacter')).toHaveLength(1)
  })
  it('at the block step only the defender acts: declareBlock(null) plus one per active forward', () => {
    let s = makeGame(); let a: number, d: number
    ;[s, a] = withField(s, 0, 'forwards', 'V-F2'); [s, d] = withField(s, 1, 'forwards', 'V-F2')
    s = apply(s, { type: 'pass', player: 0 }).state
    s = apply(s, { type: 'declareAttack', player: 0, attackers: [a] }).state
    expect(actingPlayer(s)).toBe(1)
    expect(legalCommands(s, 0)).toEqual([{ type: 'concede', player: 0 }])
    expect(legalCommands(s, 1).map((c) => c.type).sort()).toEqual(['concede', 'declareBlock', 'declareBlock'])
    expect(legalCommands(s, 1)).toContainEqual({ type: 'declareBlock', player: 1, blocker: d })
  })
  it('when a discard is pending, only discardToHandSize with exactly `count` cards is legal', () => {
    let s = makeGame()   // player 0: 6 cards
    for (let i = 0; i < 3; i++) s = apply(s, { type: 'pass', player: 0 }).state
    expect(s.pending?.kind).toBe('discardToHandSize')
    const cmds = legalCommands(s, 0)
    expect(cmds.every((c) => c.type === 'concede' || (c.type === 'discardToHandSize' && c.cards.length === 1))).toBe(true)
    expect(cmds.filter((c) => c.type === 'discardToHandSize')).toHaveLength(6)
  })
})

describe('apply', () => {
  it('rejects a command from the wrong player and a semantically illegal command', () => {
    const s = makeGame()
    expect(() => apply(s, { type: 'pass', player: 1 })).toThrow(IllegalCommandError)
    expect(() => apply(s, { type: 'declareAttack', player: 0, attackers: [1] })).toThrow(IllegalCommandError)
    expect(() => apply(s, { type: 'declareBlock', player: 0, blocker: null })).toThrow(IllegalCommandError)
  })
  it('accepts a legal command that legalCommands does not list (non-minimal payment, §11.2.2.3)', () => {
    let s = withHandSize(makeGame(), 0, 0); let b1: number, b2: number, f: number
    ;[s, b1] = withField(s, 0, 'backups', 'V-B1'); [s, b2] = withField(s, 0, 'backups', 'V-B3')
    ;[s, f] = withHand(s, 0, 'V-F1')   // cost 1, but pay with two backups
    const overpay = { type: 'castCharacter' as const, player: 0 as const, card: f, payment: { dullBackups: [b1, b2], discards: [] } }
    expect(legalCommands(s, 0)).not.toContainEqual(overpay)
    const t = apply(s, overpay).state
    expect(t.players[0].forwards.map((c) => c.id)).toEqual([f])
    expect(t.players[0].backups.every((c) => c.status === 'dull')).toBe(true)
  })
  it('does not mutate its input', () => {
    const s = makeGame()
    const frozen = JSON.stringify(s)
    apply(s, { type: 'pass', player: 0 })
    expect(JSON.stringify(s)).toBe(frozen)
  })
  it('concede ends the game for either player, at any time', () => {
    const { state, events } = apply(makeGame(), { type: 'concede', player: 1 })
    expect(state.result).toEqual({ winner: 0, reason: expect.stringMatching(/conced/i) })
    expect(events.at(-1)?.type).toBe('gameOver')
    expect(legalCommands(state, 0)).toEqual([]); expect(legalCommands(state, 1)).toEqual([])
    expect(() => apply(state, { type: 'pass', player: 0 })).toThrow(/over/)
  })
})

describe('invariant: random walks over legalCommands never throw and keep the state well-formed', () => {
  it('50 seeds × up to 600 commands', () => {
    for (let seed = 1; seed <= 50; seed++) {
      let s = createGame({ seed, decks: [DEFAULT_DECK, DEFAULT_DECK], defs: VANILLA_POOL })
      let rng = seedRng(seed * 7919)
      for (let i = 0; i < 600 && !s.result; i++) {
        const p = actingPlayer(s)!
        const cmds = legalCommands(s, p).filter((c) => c.type !== 'concede')
        expect(cmds.length, `seed ${seed} step ${i}: acting player has no legal non-concede command in ${s.phase}/${s.attack?.step}/${s.pending?.kind}`).toBeGreaterThan(0)
        const [k, r] = nextInt(rng, cmds.length); rng = r
        s = apply(s, cmds[k] as (typeof cmds)[number]).state
        expect(checkInvariants(s), `seed ${seed} step ${i}`).toEqual([])
      }
    }
  })
})
