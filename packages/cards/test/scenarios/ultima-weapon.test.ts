import { describe, expect, it } from 'vitest'
import type { CardId, Event, GameState } from '@fftcg/engine'
import { checkInvariants, findFieldCard } from '@fftcg/engine'
import { FIRE_BACKUP, WATER_BACKUP, makeGame, step, trace, withCp, withField, withHand } from '../harness.js'

/**
 * Rung V1-B, Layer 3: LB Ultima Weapon 24-126H, both enters-the-field clauses at once. Clause 1 chooses as it is placed
 * and reads "4 or more Fire Characters" as it resolves; clause 2 reads "4 or more Water Characters" as it triggers and
 * again as it resolves, then the opponent selects. Ultima Weapon (Water/Fire) counts for both. Clause 2 is a conditional auto-ability (§11.8.13,
 * rung V1-D): below 4 Water Characters as Ultima Weapon enters, it does not trigger at all. One simplification shows
 * here: the two clauses are placed in the engine's fixed order rather than one the controller chooses (§11.8.7).
 */

const ok = (s: GameState) => expect(checkInvariants(s)).toEqual([])
const ids = (s: GameState) => s.stack.map((i) => (i.kind === 'ability' ? i.frame.abilityId : 'summon'))

describe('scenario: Ultima Weapon — both conditions', () => {
  it('L3 ultima-weapon — Fire/Water Backups make 4 Fire and 4 Water Characters with Ultima Weapon; the Fire clause breaks Lightning, then the opponent selects Cloud for the Break Zone', () => {
    let s = makeGame()
    let uw: CardId, fodder: CardId, cp: CardId[], dual: CardId, lightning: CardId, cloud: CardId
    ;[s, lightning] = withField(s, 1, 'forwards', '27-127S')   // 9000
    ;[s, cloud] = withField(s, 1, 'forwards', '27-124S')
    ;[s, dual] = withField(s, 0, 'forwards', '18-129C')         // Jecht, Water/Fire: one Character of each
    ;[s, uw] = withHand(s, 0, '24-126H')
    ;[s, fodder] = withHand(s, 0, '12-005C')
    ;[s, cp] = withCp(s, 0, [FIRE_BACKUP, FIRE_BACKUP, WATER_BACKUP, WATER_BACKUP, WATER_BACKUP])
    // Fire: Ultima Weapon, Jecht, 2 Machinists = 4. Water: Ultima Weapon, Jecht, 3 Geomancers = 5.
    const names = { [uw]: 'ultima', [lightning]: 'lightning', [cloud]: 'cloud', [dual]: 'jecht', [fodder]: 'ifrit' }
    const log: Event[] = []
    s = step(log, s, { type: 'castCharacter', player: 0, card: uw, payment: { dullBackups: cp, discards: [{ card: fodder, element: 'fire' }] } })
    expect(s.pending, 'clause 1 declares its Forward as it is placed').toEqual(expect.objectContaining({ kind: 'chooseTargets', player: 0 }))
    s = step(log, s, { type: 'chooseTargets', player: 0, targets: [lightning] })
    // MVP0-SIMPLIFICATION (§11.8.7): a fixed order stands in for the controller's choice (timing matrix `simplified`).
    expect(ids(s), 'the fixed order: the printed-first clause resolves first').toEqual(['24-126H:etb-water', '24-126H:etb-fire'])
    s = step(log, s, { type: 'pass', player: 0 }); s = step(log, s, { type: 'pass', player: 1 })
    expect(findFieldCard(s, lightning)).toBeNull()
    s = step(log, s, { type: 'pass', player: 0 }); s = step(log, s, { type: 'pass', player: 1 })
    expect(s.pending).toEqual({ kind: 'chooseTargets', player: 1, min: 1, max: 1, candidates: [cloud] })
    s = step(log, s, { type: 'chooseTargets', player: 1, targets: [cloud] })
    expect(s.players[1].breakZone).toEqual(expect.arrayContaining([lightning, cloud]))
    expect(trace(log, names)).toEqual([
      // Each clause is narrated as it is placed: the Water one first (bottom), the Fire one last (top) — the fixed order.
      'discard:ifrit', 'trigger:24-126H:etb-water', 'push:24-126H:etb-water', 'trigger:24-126H:etb-fire', 'push:24-126H:etb-fire',
      'damage:lightning:9000', 'resolve:24-126H:etb-fire', 'broken:lightning',
      'put:cloud', 'resolve:24-126H:etb-water',
    ])
    ok(s)
  })

  it('L3 ultima-weapon — with 3 Water Characters the Water clause never triggers (§11.8.13); only the Fire clause goes on the stack', () => {
    let s = makeGame()
    let uw: CardId, fodder: CardId, cp: CardId[], lightning: CardId
    ;[s, lightning] = withField(s, 1, 'forwards', '27-127S')
    ;[s, uw] = withHand(s, 0, '24-126H')
    ;[s, fodder] = withHand(s, 0, '12-005C')
    ;[s, cp] = withCp(s, 0, [FIRE_BACKUP, FIRE_BACKUP, FIRE_BACKUP, WATER_BACKUP, WATER_BACKUP])
    // Fire: Ultima Weapon + 3 Machinists = 4. Water: Ultima Weapon + 2 Geomancers = 3.
    const log: Event[] = []
    s = step(log, s, { type: 'castCharacter', player: 0, card: uw, payment: { dullBackups: cp, discards: [{ card: fodder, element: 'fire' }] } })
    s = step(log, s, { type: 'chooseTargets', player: 0, targets: [lightning] })
    expect(ids(s)).toEqual(['24-126H:etb-fire'])
    s = step(log, s, { type: 'pass', player: 0 }); s = step(log, s, { type: 'pass', player: 1 })
    expect(trace(log, { [uw]: 'ultima', [lightning]: 'lightning', [fodder]: 'ifrit' })).toEqual([
      'discard:ifrit', 'trigger:24-126H:etb-fire', 'push:24-126H:etb-fire', 'damage:lightning:9000', 'resolve:24-126H:etb-fire', 'broken:lightning',
    ])
    ok(s)
  })
})
