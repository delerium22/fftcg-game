import { describe, expect, it } from 'vitest'
import type { CardId, Event, GameState } from '@fftcg/engine'
import { checkInvariants, findFieldCard, keywordsOf, legalCommands } from '@fftcg/engine'
import { endPhase, makeGame, step, trace, withField } from '../harness.js'

/**
 * Rung J9, Layer 3 (spec J9-D3): a party, a block, a pump in the `blocked` window, and the triggers the pump's
 * COST and the damage fire — on the shipped cards, as a golden order.
 */

const ok = (s: GameState) => expect(checkInvariants(s)).toEqual([])
const ids = (s: GameState) => s.stack.map((i) => (i.kind === 'ability' ? i.frame.abilityId : 'summon'))

describe('scenario: combat with tricks — a party, a block, a pump in the blocked window, and the triggers a cost and damage fire', () => {
  it('L3 combat-tricks — the Princess’s cost is a zone movement Lightning watches; the pump lands before damage; the rule process breaks both; Luso’s trigger is placed first, Lightning’s on top', () => {
    let s = endPhase(makeGame())
    let luso: CardId, prishe: CardId, princess: CardId, sphene: CardId, lightning: CardId
    ;[s, luso] = withField(s, 0, 'forwards', '27-125S')        // 3000
    ;[s, prishe] = withField(s, 0, 'forwards', '22-068R')      // 5000
    ;[s, princess] = withField(s, 0, 'forwards', '19-052C')
    ;[s, sphene] = withField(s, 1, 'forwards', '27-126S')      // 7000, the blocker
    ;[s, lightning] = withField(s, 1, 'forwards', '27-127S')   // 9000, watching player 0's Forwards leave the field
    const names = { [luso]: 'luso', [prishe]: 'prishe', [princess]: 'princess', [sphene]: 'sphene', [lightning]: 'lightning' }
    const log: Event[] = []
    expect(s.attack?.step).toBe('declaration')
    // §10.1.2.1 / §15.1.1.9.1: an earth party. §10.1.2.6: the `declared` window; both forfeit (§11.1.7).
    s = step(log, s, { type: 'declareAttack', player: 0, attackers: [luso, prishe] })
    s = step(log, s, { type: 'pass', player: 0 }); s = step(log, s, { type: 'pass', player: 1 })
    expect(s.pending).toEqual({ kind: 'declareBlock', player: 1 })
    // §10.1.3.1 → §10.1.3.6: the block, then the `blocked` window with the turn player holding priority.
    s = step(log, s, { type: 'declareBlock', player: 1, blocker: sphene })
    expect(s.attack?.step).toBe('blocked'); expect(s.priority).toBe(0)
    const pump = legalCommands(s, 0).find((c) => c.type === 'activateAbility' && c.source === princess && c.targets[0] === luso)
    expect(pump, 'the Princess pumps Luso in the blocked window (§11.6, J1-A3)').toBeDefined()
    s = step(log, s, pump!)
    // §11.8.15 / C3-A3: paying the Princess into the Break Zone is not a break, but it IS "put from the field into
    // the Break Zone", so Lightning triggers and declares its target as it is placed (§11.8.4, J1-D3) — a prompt
    // for player 1 while player 0 holds priority.
    expect(s.pending).toEqual(expect.objectContaining({ kind: 'chooseTargets', player: 1 }))
    s = step(log, s, { type: 'chooseTargets', player: 1, targets: [lightning] })
    expect(ids(s), 'the non-turn player’s trigger sits above the turn player’s activation').toEqual(['19-052C:pump', '27-127S:opponent-forward-broken'])
    expect(s.priority, '§11.6.11: the activator regains priority').toBe(0)
    for (const p of [0, 1, 0, 1] as const) s = step(log, s, { type: 'pass', player: p })   // Lightning's Haste, then the pump
    expect(s.stack).toEqual([]); expect(s.attack?.step).toBe('blocked')
    // §10.1.4.2 / §10.1.4.2.1: both forfeit again; battle damage; Sphene splits its 7000 among the party.
    s = step(log, s, { type: 'pass', player: 0 }); s = step(log, s, { type: 'pass', player: 1 })
    expect(s.pending).toEqual({ kind: 'assignPartyDamage', player: 1 })
    s = step(log, s, { type: 'assignPartyDamage', player: 1, assignments: [{ target: luso, amount: 7000 }] })
    // §12.4.5 breaks Sphene (12000 ≥ 7000) and Luso (7000 ≥ 7000) as ONE rule process before any trigger is
    // placed (§11.1.3); then §11.8.7: Luso's (turn player) first, Lightning's (non-turn player) on top, which
    // declares its target at placement.
    expect(s.pending).toEqual(expect.objectContaining({ kind: 'chooseTargets', player: 1 }))
    s = step(log, s, { type: 'chooseTargets', player: 1, targets: [lightning] })
    expect(ids(s)).toEqual(['27-125S:damages-forward', '27-127S:opponent-forward-broken'])
    expect(s.attack?.step, '§10.1.4.4: the damage window').toBe('damage'); expect(s.priority).toBe(0)
    for (const p of [0, 1, 0, 1] as const) s = step(log, s, { type: 'pass', player: p })   // Lightning (already Haste), then Luso's (nothing left to break)
    expect(s.stack).toEqual([])
    expect(findFieldCard(s, sphene)).toBeNull(); expect(findFieldCard(s, luso)).toBeNull()
    expect(findFieldCard(s, prishe)).not.toBeNull()
    expect(keywordsOf(s, findFieldCard(s, lightning)!.card).has('haste')).toBe(true)
    expect(trace(log, names)).toEqual([
      'attack:luso+prishe', 'step:declared', 'step:block', 'block:sphene', 'step:blocked',
      'activate:19-052C:pump', 'paid:princess', 'push:19-052C:pump', 'trigger:27-127S:opponent-forward-broken', 'push:27-127S:opponent-forward-broken',
      'keyword:lightning:haste', 'resolve:27-127S:opponent-forward-broken',
      'power:luso:+4000', 'resolve:19-052C:pump',
      'step:damage',
      'battle:luso+prishe>sphene:12000', 'battle:sphene>luso:7000',   // the party's damage is one packet (§15.1.1.9.8, rung V2-A1)
      'broken:luso', 'broken:sphene',
      'trigger:27-125S:damages-forward', 'push:27-125S:damages-forward',
      'trigger:27-127S:opponent-forward-broken', 'push:27-127S:opponent-forward-broken',
      'resolve:27-127S:opponent-forward-broken',   // Haste again: a keyword grant is idempotent, so no second event
      'resolve:27-125S:damages-forward',           // Sphene is already in the Break Zone: the break no-ops (C2-A5)
    ])
    ok(s)
  })
})
