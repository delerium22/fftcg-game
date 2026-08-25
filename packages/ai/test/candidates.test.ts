import { describe, expect, it } from 'vitest'
import { apply, attackCheck, defOf, legalCommands, type Command } from '@fftcg/engine'
import { candidateCommands } from '../src/candidates.js'
import { cardValue } from '../src/cardValue.js'
import { makeGame, withField, withHand, withHandSize } from '../../engine/test/helpers.js'

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
  it('F3: bounds attack candidates when more than 6 forwards are eligible, and every candidate is legal', () => {
    let s = withHandSize(makeGame(), 0, 0)
    for (let i = 0; i < 8; i++) [s] = withField(s, 0, 'forwards', 'V-F1')
    s = apply(s, { type: 'pass', player: 0 }).state   // main1 -> attack declaration
    const c = candidateCommands(s, 0)
    const attacks = c.filter((x): x is Extract<Command, { type: 'declareAttack' }> => x.type === 'declareAttack')
    expect(attacks.length).toBeLessThanOrEqual(8 + 1)   // 8 singles + 1 same-element (earth) party
    for (const a of attacks) expect(attackCheck(s, 0, a.attackers)).toBeNull()
    expect(c.some((x) => x.type === 'pass')).toBe(true)
  })
})
