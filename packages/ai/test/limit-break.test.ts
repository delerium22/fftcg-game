import { describe, expect, it } from 'vitest'
import { legalCommands, type CardDef, type GameState } from '@fftcg/engine'
import { candidateCommands } from '../src/candidates.js'
import { preferredPayment } from '../src/payment.js'
import { VANILLA_POOL, makeDef, makeGame, withHandSize } from '../../engine/test/helpers.js'

/**
 * Rung J8 (spec J8-D8/J8-A4): the AI needs no Limit Break code — `actionMenu.castable` and `enumeratePayments`
 * reach the LB casts — and `preferredPayment` flips what it values least: a duplicate of the cast card before a
 * different card, and among different cards the one with the highest printed cost.
 */

const DEFS: CardDef[] = [
  ...VANILLA_POOL,
  makeDef({ code: 'T-LB2', cost: 0, power: 5000, limitBreak: 2, generic: false }),
  makeDef({ code: 'T-LB3', cost: 3, power: 3000, limitBreak: 1 }),
  makeDef({ code: 'T-LB1', cost: 0, power: 1000, limitBreak: 1 }),
]
const LB = ['T-LB2', 'T-LB2', 'T-LB3', 'T-LB1']

function position(): { s: GameState; ids: Record<string, number[]> } {
  const s = withHandSize(withHandSize(makeGame({ defs: DEFS, lbDecks: [LB, LB] }), 0, 0), 1, 0)
  const ids: Record<string, number[]> = {}
  for (const x of s.players[0].lbDeck) (ids[s.cards[x.id]!.code] ??= []).push(x.id)
  return { s, ids }
}

describe('the AI and the LB deck (J8-A4)', () => {
  it("greedy's candidates in a Main Phase include the cast from the LB deck", () => {
    const { s, ids } = position()
    const lb2 = ids['T-LB2']![0]!
    expect(legalCommands(s, 0).some((c) => c.type === 'castCharacter' && c.card === lb2)).toBe(true)
    const cands = candidateCommands(s, 0)
    expect(cands.some((c) => c.type === 'castCharacter' && c.card === lb2)).toBe(true)
  })

  it('preferredPayment flips the duplicate of the cast card first, then the costliest other card', () => {
    const { s, ids } = position()
    const [a, twin] = ids['T-LB2']!
    const p = preferredPayment(s, 0, a!)
    expect(p).not.toBeNull()
    expect(p!.lbFlip, 'the twin, then T-LB3 (cost 3) over T-LB1 (cost 0)').toEqual([twin, ids['T-LB3']![0]])
    // The single-copy T-LB1 has no twin: the costliest other card flips — T-LB3, not a free T-LB2.
    const q = preferredPayment(s, 0, ids['T-LB1']![0]!)
    expect(q!.lbFlip).toEqual([ids['T-LB3']![0]])
  })
})
