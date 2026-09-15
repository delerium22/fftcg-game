import { describe, expect, it } from 'vitest'
import type { CardId, Event, GameState } from '@fftcg/engine'
import { checkInvariants, findFieldCard, legalCommands } from '@fftcg/engine'
import { LIGHTNING_BACKUP, endPhase, makeGame, step, trace, withCp, withField, withHand } from '../harness.js'

/**
 * Rung J9, Layer 3 (spec J9-D3): the non-turn player's Summon in the `declared` window kills an attacker; the
 * attack goes on with what is left — on the shipped cards, as a golden order.
 */

const ok = (s: GameState) => expect(checkInvariants(s)).toEqual([])
const ids = (s: GameState) => s.stack.map((i) => (i.kind === 'ability' ? i.frame.abilityId : 'summon'))

describe('scenario: Ramuh in a window — the non-turn player’s Summon in the declared window kills an attacker', () => {
  it('L3 ramuh-in-a-window — modes and targets are declared at cast; the chosen Prishe triggers above Ramuh; Ramuh resolves after both forfeit; the party shrinks to one at the window exit', () => {
    let s = endPhase(makeGame())
    let luso: CardId, prishe: CardId, ramuh: CardId, cp: CardId[]
    ;[s, luso] = withField(s, 0, 'forwards', '27-125S')        // 3000
    ;[s, prishe] = withField(s, 0, 'forwards', '22-068R')      // 5000
    ;[s, ramuh] = withHand(s, 1, '20-103H')
    ;[s, cp] = withCp(s, 1, [LIGHTNING_BACKUP, LIGHTNING_BACKUP])
    const names = { [luso]: 'luso', [prishe]: 'prishe', [ramuh]: 'ramuh' }
    const log: Event[] = []
    s = step(log, s, { type: 'declareAttack', player: 0, attackers: [luso, prishe] })
    s = step(log, s, { type: 'pass', player: 0 })
    expect(s.priority, '§11.1.6: the defender holds the declared window').toBe(1)
    // §9.3.1.6: a Summon in an Attack Phase window. §11.3.4: the modes are declared at cast; §11.3.3: each
    // "choose" declares its target at cast (J1-D5). The cast is paid with the two Red Mages.
    expect(legalCommands(s, 1).some((c) => c.type === 'castSummon' && c.card === ramuh), 'Ramuh is castable here').toBe(true)
    s = step(log, s, { type: 'castSummon', player: 1, card: ramuh, payment: { dullBackups: cp, discards: [] } })
    expect(s.pending).toEqual(expect.objectContaining({ kind: 'chooseMode', player: 1 }))
    s = step(log, s, { type: 'chooseMode', player: 1, modes: [0, 1] })                // dull, then 5000 damage
    expect(s.pending).toEqual(expect.objectContaining({ kind: 'chooseTargets', player: 1 }))
    s = step(log, s, { type: 'chooseTargets', player: 1, targets: [prishe] })          // mode 0: dull Prishe (already dull: §15.1.1.2.2)
    s = step(log, s, { type: 'chooseTargets', player: 1, targets: [luso] })            // mode 1: 5000 to Luso
    // J1-D7: Prishe was CHOSEN by a Summon, so her trigger is placed above Ramuh and resolves first.
    expect(ids(s)).toEqual(['summon', '22-068R:chosen'])
    expect(s.priority, '§11.3.8: the caster regains priority').toBe(1)
    s = step(log, s, { type: 'pass', player: 1 }); s = step(log, s, { type: 'pass', player: 0 })   // Prishe +2000
    expect(ids(s)).toEqual(['summon'])
    expect(s.priority, '§11.1.5: the turn player').toBe(0)
    s = step(log, s, { type: 'pass', player: 0 }); s = step(log, s, { type: 'pass', player: 1 })   // Ramuh resolves
    expect(findFieldCard(s, luso), '5000 ≥ 3000: §12.4.5').toBeNull()
    expect(s.players[1].breakZone, '§11.11.10').toContain(ramuh)
    expect(s.attack?.step, 'still the declared window').toBe('declared')
    expect(s.attack?.attackers, 'combatants are recomputed only at the window EXIT (J1-A6)').toEqual([luso, prishe])
    expect(s.priority).toBe(0)
    s = step(log, s, { type: 'pass', player: 0 }); s = step(log, s, { type: 'pass', player: 1 })   // out of the window
    expect(s.attack?.attackers, '§15.1.1.9.5: Prishe alone, no longer a party').toEqual([prishe])
    expect(s.pending).toEqual({ kind: 'declareBlock', player: 1 })
    expect(trace(log, names)).toEqual([
      'attack:luso+prishe', 'step:declared',
      'push:summon:ramuh', 'trigger:22-068R:chosen', 'push:22-068R:chosen',
      'power:prishe:+2000', 'resolve:22-068R:chosen',
      'damage:luso:5000', 'resolve:summon:ramuh', 'broken:luso',
      'step:block',
    ])
    ok(s)
  })
})
