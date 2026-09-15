import { describe, expect, it } from 'vitest'
import type { CardId, Event, GameState } from '@fftcg/engine'
import { checkInvariants, findFieldCard, keywordsOf, legalCommands, powerOf } from '@fftcg/engine'
import { EARTH_BACKUP, makeGame, step, trace, withCp, withField, withHand } from '../harness.js'

/**
 * Rung J9, Layer 3 (spec J9-D3): the SHIPPED cards, a scripted turn, a golden order. Every event kind the
 * scenario is about is in the trace; the order is the claim, and each step of it is a numbered rule.
 */

const ok = (s: GameState) => expect(checkInvariants(s)).toEqual([])
const power = (s: GameState, id: CardId) => powerOf(s, findFieldCard(s, id)!.card)
const ids = (s: GameState) => s.stack.map((i) => (i.kind === 'ability' ? i.frame.abilityId : 'summon'))

describe('scenario: the Cloud turn — an ETB on the stack, answered from the other side, then the Attack Phase trigger', () => {
  it('L3 cloud-turn — Prishe’s chosen-trigger, the Princess’s pump and Cloud’s ETB resolve in that order; Cloud’s attack-phase clause asks for its target at preparation', () => {
    let s = makeGame()
    let luso: CardId, princess: CardId, prishe: CardId, cloud: CardId, cp: CardId[]
    ;[s, luso] = withField(s, 0, 'forwards', '27-125S')
    ;[s, princess] = withField(s, 1, 'forwards', '19-052C')
    ;[s, prishe] = withField(s, 1, 'forwards', '22-068R')
    ;[s, cloud] = withHand(s, 0, '27-124S')
    ;[s, cp] = withCp(s, 0, [EARTH_BACKUP, EARTH_BACKUP, EARTH_BACKUP])
    const names = { [luso]: 'luso', [princess]: 'princess', [prishe]: 'prishe', [cloud]: 'cloud' }
    const log: Event[] = []
    // §11.4.7: Cloud enters, its ETB goes on the stack, the turn player gains priority.
    s = step(log, s, { type: 'castCharacter', player: 0, card: cloud, payment: { dullBackups: cp, discards: [] } })
    expect(ids(s)).toEqual(['27-124S:etb'])
    expect(s.priority, '§11.4.7: the turn player').toBe(0)
    // §11.1.6: a forfeit hands priority to the opponent, who may answer (§9.3.1.7) with the Princess.
    s = step(log, s, { type: 'pass', player: 0 })
    const pump = legalCommands(s, 1).find((c) => c.type === 'activateAbility' && c.source === princess && c.targets[0] === prishe)
    expect(pump, 'the Princess may answer in the window').toBeDefined()
    s = step(log, s, pump!)
    // J1-D7: "when chosen" is a trigger placed ABOVE the chooser, so Prishe's +2000 lands before the +4000.
    expect(ids(s), 'Prishe’s trigger sits above the pump that chose her').toEqual(['27-124S:etb', '19-052C:pump', '22-068R:chosen'])
    expect(s.priority, '§11.6.11: the activator regains priority').toBe(1)
    // §11.1.7 three times: chosen → pump → ETB. After each resolution the turn player gains priority (§11.1.5).
    for (const p of [1, 0, 0, 1, 0, 1] as const) s = step(log, s, { type: 'pass', player: p })
    expect(s.stack).toEqual([])
    expect(power(s, prishe)).toBe(5000 + 2000 + 4000)
    expect(power(s, luso)).toBe(3000 + 3000)
    expect(power(s, cloud)).toBe(7000 + 3000)
    expect(keywordsOf(s, findFieldCard(s, luso)!.card).has('brave')).toBe(true)
    // §9.3.1.2 → §10.1.1.1: out of Main Phase 1, the Attack Phase begins and Cloud's clause is placed at the
    // preparation step, declaring its target as it is placed (J1-D3).
    s = step(log, s, { type: 'pass', player: 0 })
    s = step(log, s, { type: 'pass', player: 1 })
    expect(s.phase).toBe('attack')
    expect(s.attack?.step).toBe('preparation')
    expect(s.pending).toEqual(expect.objectContaining({ kind: 'chooseTargets', player: 0 }))
    s = step(log, s, { type: 'chooseTargets', player: 0, targets: [cloud] })
    expect(ids(s)).toEqual(['27-124S:attack-phase'])
    expect(s.priority, '§10.1.1.2: the turn player gains priority').toBe(0)
    expect(trace(log, names)).toEqual([
      'trigger:27-124S:etb', 'push:27-124S:etb',
      // C3-A2: the cost is paid before the ability is placed; the placement then fires Prishe's chosen-trigger.
      'activate:19-052C:pump', 'paid:princess', 'push:19-052C:pump', 'trigger:22-068R:chosen', 'push:22-068R:chosen',
      'power:prishe:+2000', 'resolve:22-068R:chosen',
      'power:prishe:+4000', 'resolve:19-052C:pump',
      'power:luso:+3000', 'keyword:luso:brave', 'power:cloud:+3000', 'keyword:cloud:brave', 'resolve:27-124S:etb',
      'step:preparation', 'trigger:27-124S:attack-phase', 'push:27-124S:attack-phase',
    ])
    ok(s)
  })
})
