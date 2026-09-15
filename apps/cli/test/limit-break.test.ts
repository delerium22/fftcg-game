import { describe, expect, it } from 'vitest'
import { apply, viewFor, type CardDef, type Payment } from '@fftcg/engine'
import { makeDef, makeGame, withHandSize, VANILLA_POOL } from '../../../packages/engine/test/helpers.js'
import { describeCommand, renderView } from '../src/render.js'

/** Rung J8 (spec J8-A6, J8-D7): the CLI names each LB deck's cards and face state, and a cast's flips. */
const DEFS: CardDef[] = [
  ...VANILLA_POOL,
  makeDef({ code: 'T-LB2', name: 'Noctis', cost: 0, power: 5000, limitBreak: 2, generic: false }),
  makeDef({ code: 'T-LB1', name: 'Maat', cost: 0, power: 3000, limitBreak: 1 }),
]
const LB = ['T-LB2', 'T-LB1', 'T-LB1']
const NO_CP: Payment = { dullBackups: [], discards: [] }

describe('render — the LB deck (rung J8)', () => {
  it('lists both LB decks with face state, and omits the line when a seat has none', () => {
    const s = withHandSize(makeGame({ defs: DEFS, lbDecks: [LB, LB] }), 0, 0)
    const out = renderView(viewFor(s, 0))
    const lines = out.split('\n').filter((l) => l.includes('LB deck:'))
    expect(lines).toHaveLength(2)
    expect(lines[1]).toMatch(/LB deck: {2}\[\d+\] Noctis \(T-LB2\) \(down\) {2}\[\d+\] Maat \(T-LB1\) \(down\) {2}\[\d+\] Maat \(T-LB1\) \(down\)/)
    expect(renderView(viewFor(makeGame({ defs: DEFS }), 0))).not.toContain('LB deck:')
  })

  it('a cast from the LB deck names the cards its Limit Break cost turns face up, and the flipped read UP after', () => {
    const s = withHandSize(withHandSize(makeGame({ defs: DEFS, lbDecks: [LB, LB] }), 0, 0), 1, 0)
    const lb = s.players[0].lbDeck
    const noctis = lb[0]!.id
    const flips = [lb[1]!.id, lb[2]!.id]
    const cmd = { type: 'castCharacter' as const, player: 0 as const, card: noctis, payment: { ...NO_CP, lbFlip: flips } }
    expect(describeCommand(viewFor(s, 0), cmd)).toBe('Cast Noctis (T-LB2) turning Maat (T-LB1), Maat (T-LB1) face up, paying: nothing')
    const after = renderView(viewFor(apply(s, cmd).state, 0))
    expect(after).toMatch(/LB deck: {2}\[\d+\] Maat \(T-LB1\) \(UP\) {2}\[\d+\] Maat \(T-LB1\) \(UP\)/)
  })
})
