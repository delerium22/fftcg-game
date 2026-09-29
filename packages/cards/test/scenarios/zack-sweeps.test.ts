import { describe, expect, it } from 'vitest'
import type { CardId, Event, GameState } from '@fftcg/engine'
import { checkInvariants, findFieldCard, keywordsOf } from '@fftcg/engine'
import { FIRE_BACKUP, endPhase, makeGame, step, trace, withCp, withField } from '../harness.js'

/**
 * Rung V1-B, Layer 3: Zack 27-123S attacks in a party. Only the member that prints "when … attacks" triggers (§10.1.2.5);
 * its sweep counts its controller's Backups as each hit resolves (spec V1-D7) and reaches every opponent Forward.
 */

const ok = (s: GameState) => expect(checkInvariants(s)).toEqual([])
const ids = (s: GameState) => s.stack.map((i) => (i.kind === 'ability' ? i.frame.abilityId : 'summon'))

describe('scenario: Zack sweeps — a party attack, one attack trigger, 1000 per Backup to every opponent Forward', () => {
  it('L3 zack-sweeps — Zack has Haste against 3 Forwards; the party of Zack and Ward places only Zack’s clause in the declared window; three Backups make 3000 per Forward; the one it kills is broken by §12.4.5 after it resolves', () => {
    let s = endPhase(makeGame())
    let zack: CardId, ward: CardId, cloud: CardId, luso: CardId, lightning: CardId
    ;[s, zack] = withField(s, 0, 'forwards', '27-123S', { enteredTurn: s.turn })   // entered THIS turn: attacks only with Haste
    ;[s, ward] = withField(s, 0, 'forwards', '21-001R')
    ;[s] = withCp(s, 0, [FIRE_BACKUP, FIRE_BACKUP, FIRE_BACKUP])
    ;[s, cloud] = withField(s, 1, 'forwards', '27-124S')       // 7000
    ;[s, luso] = withField(s, 1, 'forwards', '27-125S')        // 3000
    ;[s, lightning] = withField(s, 1, 'forwards', '27-127S')   // 9000
    const names = { [zack]: 'zack', [ward]: 'ward', [cloud]: 'cloud', [luso]: 'luso', [lightning]: 'lightning' }
    const log: Event[] = []
    // The static: the opponent controls 3 Forwards, so Zack has Haste and may attack the turn he entered (§15.2.1).
    expect([...keywordsOf(s, findFieldCard(s, zack)!.card)]).toEqual(['haste'])
    s = step(log, s, { type: 'declareAttack', player: 0, attackers: [zack, ward] })
    // §10.1.2.5: the attacking Forwards' "when … attacks" clauses go on the stack before the §10.1.2.6 grant. Ward prints
    // none, so the party places exactly one item.
    expect(ids(s)).toEqual(['27-123S:attack'])
    expect(s.priority, '§10.1.2.6: the turn player').toBe(0)
    s = step(log, s, { type: 'pass', player: 0 }); s = step(log, s, { type: 'pass', player: 1 })
    // §11.1.7: it resolves. Three Backups: 3000 to each opponent Forward, none to Zack's own side.
    expect(findFieldCard(s, cloud)?.card.damage).toBe(3000)
    expect(findFieldCard(s, lightning)?.card.damage).toBe(3000)
    expect(findFieldCard(s, luso), '3000 ≥ 3000: §12.4.5, after the item resolved').toBeNull()
    expect(findFieldCard(s, ward)?.card.damage).toBe(0)
    // Two Forwards left: the static no longer holds, and the attack goes on regardless (it was declared).
    expect([...keywordsOf(s, findFieldCard(s, zack)!.card)]).toEqual([])
    expect(s.attack?.attackers).toEqual([zack, ward].sort((a, b) => a - b))
    expect(trace(log, names)).toEqual([
      // V1-A1: the clause is placed at the declared window's grant, so the step is narrated first.
      'attack:zack+ward', 'step:declared', 'trigger:27-123S:attack', 'push:27-123S:attack',
      'damage:cloud:3000', 'damage:luso:3000', 'damage:lightning:3000', 'resolve:27-123S:attack', 'broken:luso',
    ])
    ok(s)
  })
})
