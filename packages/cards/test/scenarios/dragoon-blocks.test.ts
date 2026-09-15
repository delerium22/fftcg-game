import { describe, expect, it } from 'vitest'
import type { CardId, Event, GameState } from '@fftcg/engine'
import { checkInvariants, findFieldCard, legalCommands } from '@fftcg/engine'
import { endPhase, makeGame, step, trace, withField } from '../harness.js'

/**
 * Rung J3, Layer 3 (spec J3-A5): First Strike on the shipped cards. Luso (3000, "when Luso deals damage to a
 * Forward, break it") attacks into Dragoon (6000, First Strike). Dragoon deals first, Luso breaks before it can
 * deal, so Luso's trigger never fires — the whole point of the keyword — and Dragoon is untouched.
 */

const ok = (s: GameState) => expect(checkInvariants(s)).toEqual([])

describe('scenario: Dragoon blocks — First Strike kills the attacker before it deals, and its damage trigger never fires', () => {
  it('L3 dragoon-blocks — the damage step splits, Luso breaks in the first batch, the pass-only window opens, nothing is dealt in the second batch', () => {
    let s = endPhase(makeGame())
    let luso: CardId, dragoon: CardId
    ;[s, luso] = withField(s, 0, 'forwards', '27-125S')
    ;[s, dragoon] = withField(s, 1, 'forwards', '1-147C')
    const names = { [luso]: 'luso', [dragoon]: 'dragoon' }
    const log: Event[] = []
    s = step(log, s, { type: 'declareAttack', player: 0, attackers: [luso] })
    s = step(log, s, { type: 'pass', player: 0 }); s = step(log, s, { type: 'pass', player: 1 })      // §10.1.2.6
    s = step(log, s, { type: 'declareBlock', player: 1, blocker: dragoon })
    s = step(log, s, { type: 'pass', player: 0 }); s = step(log, s, { type: 'pass', player: 1 })      // §10.1.3.6 → the damage step
    // §15.2.3.2: Dragoon dealt first; §11.1.3: the rule process broke Luso before anyone gained priority; §15.2.3.3: the window.
    expect(s.attack?.step).toBe('firstStrike')
    expect(findFieldCard(s, luso)).toBeNull()
    expect(legalCommands(s, 0).map((c) => c.type).filter((t) => t !== 'concede'), 'nothing may be cast or used here').toEqual(['pass'])
    s = step(log, s, { type: 'pass', player: 0 }); s = step(log, s, { type: 'pass', player: 1 })      // out of the window: the second batch is empty
    expect(s.attack?.step, '§10.1.4.4').toBe('damage')
    expect(s.stack, 'Luso never dealt damage, so its trigger has nothing to fire on').toEqual([])
    s = step(log, s, { type: 'pass', player: 0 }); s = step(log, s, { type: 'pass', player: 1 })      // §10.1.4.6: back to the declaration step
    expect(s.attack?.step).toBe('declaration')
    expect(findFieldCard(s, dragoon)?.card.damage, 'Dragoon took nothing').toBe(0)
    expect(s.players[0].breakZone).toContain(luso)
    expect(trace(log, names)).toEqual([
      'attack:luso', 'step:declared', 'step:block', 'block:dragoon', 'step:blocked',
      'step:damage', 'battle:dragoon>luso:6000', 'broken:luso', 'step:firstStrike',
      'step:damage',
      'step:declaration',
    ])
    ok(s)
  })
})
