import { describe, expect, it } from 'vitest'
import type { CardId, Event, GameState } from '@fftcg/engine'
import { checkInvariants, findFieldCard, legalCommands } from '@fftcg/engine'
import { EARTH_BACKUP, endPhase, makeGame, step, trace, withCp, withField, withHand } from '../harness.js'

/**
 * Rung J2, Layer 3 (spec J2-A3): Back Attack on the shipped card. Luso attacks an empty board; in the `declared`
 * window the defender casts Scarmiglione (Back Attack) with two Geomancers, priority returns to the attacker
 * (§11.4.7), both forfeit, and Scarmiglione blocks. 5000 into 3000 breaks Luso by the rule process — and Luso's
 * "when Luso deals damage to a Forward, break it" breaks Scarmiglione back, dead source and all (C2-A4).
 */

const ok = (s: GameState) => expect(checkInvariants(s)).toEqual([])
const ids = (s: GameState) => s.stack.map((i) => (i.kind === 'ability' ? i.frame.abilityId : 'summon'))

describe('scenario: Scarmiglione blocks — a Back Attack Character cast in the attacker’s window becomes the blocker', () => {
  it('L3 scarmiglione-blocks — castable only once the attacker forfeits; on the field at once; the turn player regains priority; it blocks; both Forwards die', () => {
    let s = endPhase(makeGame())
    let luso: CardId, scar: CardId, cp: CardId[]
    ;[s, luso] = withField(s, 0, 'forwards', '27-125S')          // 3000
    ;[s, scar] = withHand(s, 1, '2-085H')                        // 5000, Back Attack
    ;[s, cp] = withCp(s, 1, [EARTH_BACKUP, EARTH_BACKUP])
    const names = { [luso]: 'luso', [scar]: 'scar' }
    const log: Event[] = []
    s = step(log, s, { type: 'declareAttack', player: 0, attackers: [luso] })
    expect(legalCommands(s, 1).some((c) => c.type === 'castCharacter' && c.card === scar), 'the attacker still holds the window').toBe(false)
    s = step(log, s, { type: 'pass', player: 0 })                                   // §11.1.6
    expect(legalCommands(s, 1).some((c) => c.type === 'castCharacter' && c.card === scar), '§15.2.5.2: the defender, with priority').toBe(true)
    s = step(log, s, { type: 'castCharacter', player: 1, card: scar, payment: { dullBackups: cp, discards: [] } })
    expect(findFieldCard(s, scar)?.owner, '§15.2.5.4: on the field at once, no stack').toBe(1)
    expect(s.stack).toEqual([])
    expect(s.attack?.step, 'the window is still open').toBe('declared')
    expect(s.priority, '§11.4.7: the turn player gains priority').toBe(0)
    s = step(log, s, { type: 'pass', player: 0 }); s = step(log, s, { type: 'pass', player: 1 })   // out of the window
    expect(s.pending).toEqual({ kind: 'declareBlock', player: 1 })
    expect(legalCommands(s, 1).some((c) => c.type === 'declareBlock' && c.blocker === scar), 'active, so it may block (§10.1.3.1.1)').toBe(true)
    s = step(log, s, { type: 'declareBlock', player: 1, blocker: scar })
    s = step(log, s, { type: 'pass', player: 0 }); s = step(log, s, { type: 'pass', player: 1 })   // damage
    expect(ids(s), 'Luso dealt damage before it broke: its trigger is placed').toEqual(['27-125S:damages-forward'])
    s = step(log, s, { type: 'pass', player: 0 }); s = step(log, s, { type: 'pass', player: 1 })   // it resolves
    expect(findFieldCard(s, luso), '§12.4.5: 5000 ≥ 3000').toBeNull()
    expect(findFieldCard(s, scar), 'C2-A4: Luso breaks what it damaged, though Luso itself is gone').toBeNull()
    expect(trace(log, names)).toEqual([
      'attack:luso', 'step:declared', 'step:block', 'block:scar', 'step:blocked',
      'step:damage', 'battle:luso>scar:3000', 'battle:scar>luso:5000', 'broken:luso',
      'trigger:27-125S:damages-forward', 'push:27-125S:damages-forward',
      'abilityBroken:scar', 'resolve:27-125S:damages-forward',
    ])
    ok(s)
  })
})
