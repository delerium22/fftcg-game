import { describe, expect, it } from 'vitest'
import { apply, attackCheck, defOf, legalCommands, type Command } from '@fftcg/engine'
import { candidateCommands } from '../src/candidates.js'
import { cardValue } from '../src/cardValue.js'
import { VANILLA_POOL, makeDef, makeGame, withField, withHand, withHandSize } from '../../engine/test/helpers.js'

describe('candidateCommands', () => {
  it('collapses casts to one per card and never includes concede', () => {
    let s = withHandSize(makeGame(), 0, 0); let f: number
    ;[s] = withField(s, 0, 'backups', 'V-B1'); [s] = withField(s, 0, 'backups', 'V-B3')
    ;[s] = withHand(s, 0, 'V-S2'); [s] = withHand(s, 0, 'V-B4')
    ;[s, f] = withHand(s, 0, 'V-F1')
    const c = candidateCommands(s, 0)
    expect(c.filter((x) => x.type === 'castCharacter' && x.card === f)).toHaveLength(1)
    expect(c.some((x) => x.type === 'concede')).toBe(false)
    expect(c.some((x) => x.type === 'pass')).toBe(true)
    expect(legalCommands(s, 0).filter((x) => x.type === 'castCharacter' && x.card === f).length).toBeGreaterThan(1)   // the point
    for (const x of c) expect(() => apply(s, x)).not.toThrow()   // every candidate is legal
  })
  it('chooses discards by value and mirrors legalCommands for decisions', () => {
    let s = makeGame()   // 6 cards → discard pending at end of turn
    s = apply(s, { type: 'pass', player: 0 }).state; s = apply(s, { type: 'pass', player: 0 }).state; s = apply(s, { type: 'pass', player: 0 }).state
    const c = candidateCommands(s, 0)
    expect(c).toHaveLength(1); expect(c[0]!.type).toBe('discardToHandSize')
    expect(() => apply(s, c[0]!)).not.toThrow()
    const cmd = c[0]! as Extract<Command, { type: 'discardToHandSize' }>
    const byValue = [...s.players[0].hand].sort((a, b) => cardValue(defOf(s, a)) - cardValue(defOf(s, b)))
    const pending = s.pending
    expect(cmd.cards).toEqual(byValue.slice(0, pending?.kind === 'discardToHandSize' ? pending.count : 0))
    expect(cmd.cards).toHaveLength(1)
    expect(candidateCommands(s, 1)).toEqual([])
  })
  it('F3/C5: bounds attack candidates when more than 6 forwards are eligible (singles + pairs + per-element parties), every candidate legal and deduplicated', () => {
    const defs = [...VANILLA_POOL, makeDef({ code: 'V-DUAL', elements: ['earth', 'lightning'], cost: 1, power: 3000 })]
    let s = withHandSize(makeGame({ defs }), 0, 0)
    for (let i = 0; i < 8; i++) [s] = withField(s, 0, 'forwards', 'V-DUAL')
    s = apply(s, { type: 'pass', player: 0 }).state   // main1 -> attack declaration
    const c = candidateCommands(s, 0)
    const attacks = c.filter((x): x is Extract<Command, { type: 'declareAttack' }> => x.type === 'declareAttack')
    // 8 singles + up to C(8,2)=28 pairs + 1 party per shared element (earth, lightning) = up to 8 + 28 + 2 = 38
    expect(attacks.length).toBeLessThanOrEqual(8 + 28 + 2)
    for (const a of attacks) expect(attackCheck(s, 0, a.attackers)).toBeNull()
    const signatures = attacks.map((a) => [...a.attackers].sort((x, y) => x - y).join(','))
    expect(new Set(signatures).size).toBe(signatures.length)   // no duplicate attacker sets
    expect(attacks.filter((a) => a.attackers.length === 2).length).toBeGreaterThan(0)   // pairs are present
    expect(attacks.filter((a) => a.attackers.length === 1).length).toBe(8)   // every single is a candidate
    expect(c.some((x) => x.type === 'pass')).toBe(true)
  })
})
