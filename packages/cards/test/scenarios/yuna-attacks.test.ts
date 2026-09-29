import { describe, expect, it } from 'vitest'
import type { CardId, Event, GameState } from '@fftcg/engine'
import { checkInvariants, viewFor } from '@fftcg/engine'
import { endPhase, makeGame, step, trace, withDeckTops, withField } from '../harness.js'

/**
 * Rung V1-B, Layer 3: Yuna 27-129S — "When Yuna attacks, look at the top 3 cards of your deck. Add 1 card among them to
 * your hand and return the other cards to the bottom of your deck in any order." The clause is placed in the `declared`
 * window (§10.1.2.5) and resolves there, before blockers (plan R7); the look is private to Yuna's controller.
 */

const ok = (s: GameState) => expect(checkInvariants(s)).toEqual([])
const ids = (s: GameState) => s.stack.map((i) => (i.kind === 'ability' ? i.frame.abilityId : 'summon'))

describe('scenario: Yuna attacks', () => {
  it('L3 yuna-attacks — the look resolves inside the declared window: one of three to hand, two to the bottom, and the defender then declares a block', () => {
    let s = endPhase(makeGame())
    let yuna: CardId, tops: CardId[]
    ;[s, yuna] = withField(s, 0, 'forwards', '27-129S')
    ;[s, tops] = withDeckTops(s, 0, ['13-013C', '11-121C', '18-003C'])
    const names = { [yuna]: 'yuna' }
    const log: Event[] = []
    s = step(log, s, { type: 'declareAttack', player: 0, attackers: [yuna] })
    expect(ids(s)).toEqual(['27-129S:attack'])
    expect(s.attack?.step).toBe('declared')
    s = step(log, s, { type: 'pass', player: 0 }); s = step(log, s, { type: 'pass', player: 1 })
    expect(s.attack?.step, 'still the declared window').toBe('declared')
    expect(s.pending).toEqual(expect.objectContaining({ kind: 'chooseFromDeck', player: 0, count: 3, min: 1, max: 1 }))
    expect(viewFor(s, 1).cards[tops[0]!], 'a look is private').toBeUndefined()
    s = step(log, s, { type: 'chooseFromDeck', player: 0, picks: [1] })
    expect(s.players[0].hand).toContain(tops[1])
    expect(s.players[0].deck.slice(-2)).toEqual([tops[0], tops[2]])
    s = step(log, s, { type: 'pass', player: 0 }); s = step(log, s, { type: 'pass', player: 1 })
    expect(s.pending).toEqual({ kind: 'declareBlock', player: 1 })
    expect(trace(log, names)).toEqual([
      'attack:yuna', 'step:declared', 'trigger:27-129S:attack', 'push:27-129S:attack',
      'look:0:3', 'toHand:' + String(tops[1]), 'resolve:27-129S:attack', 'step:block',
    ])
    ok(s)
  })
})
