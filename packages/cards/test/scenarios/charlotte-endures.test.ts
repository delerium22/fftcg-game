import { describe, expect, it } from 'vitest'
import type { CardId, Event, GameState } from '@fftcg/engine'
import { checkInvariants, findFieldCard } from '@fftcg/engine'
import { FIRE_BACKUP, endPhase, makeGame, step, trace, withCp, withDeckTops, withField } from '../harness.js'

/**
 * Rung V2-B, Layer 3: Charlotte 27-128S — "If Charlotte is dealt damage, reduce the damage by 1000 instead."
 *
 * Ward (8000) attacks and Charlotte (8000) blocks: she takes 7000 and stands, and her 8000 breaks Ward. Zack then
 * attacks with one Backup behind him, so his sweep deals 1000 to each opposing Forward — the 1000 that would have
 * finished her (7000 + 1000 = 8000, §12.4.5). It becomes 0, and 0 damage is not damage (ruling 2021-08-19): nothing is
 * marked on her, and the log says so instead of naming a hit.
 */

const ok = (s: GameState) => expect(checkInvariants(s)).toEqual([])

describe('scenario: Charlotte endures', () => {
  it('L3 charlotte-endures — a blocked 8000 lands as 7000; the sweep’s 1000 becomes 0 and does not finish her', () => {
    let s = endPhase(makeGame())
    let ward: CardId, zack: CardId, charlotte: CardId, yuna: CardId
    ;[s, ward] = withField(s, 0, 'forwards', '21-001R')
    ;[s, zack] = withField(s, 0, 'forwards', '27-123S')
    ;[s] = withCp(s, 0, [FIRE_BACKUP])
    ;[s, charlotte] = withField(s, 1, 'forwards', '27-128S')
    ;[s, yuna] = withField(s, 1, 'forwards', '27-129S')
    ;[s] = withDeckTops(s, 1, ['18-003C'])   // a Machinist on top of P1's deck: the damage they take reveals no EX Burst
    const names = { [ward]: 'ward', [zack]: 'zack', [charlotte]: 'charlotte', [yuna]: 'yuna' }
    const log: Event[] = []
    const both = () => { s = step(log, s, { type: 'pass', player: 0 }); s = step(log, s, { type: 'pass', player: 1 }) }

    s = step(log, s, { type: 'declareAttack', player: 0, attackers: [ward] })
    both()
    s = step(log, s, { type: 'declareBlock', player: 1, blocker: charlotte })
    both()                                                        // the damage step
    expect(findFieldCard(s, charlotte)?.card.damage, '8000 − 1000').toBe(7000)
    expect(findFieldCard(s, ward), 'her 8000 broke Ward').toBeNull()
    both()                                                        // back to the declaration step

    s = step(log, s, { type: 'declareAttack', player: 0, attackers: [zack] })
    both()                                                        // Zack's sweep resolves in the declared window
    expect(findFieldCard(s, charlotte)?.card.damage, 'the 1000 was not damage').toBe(7000)
    expect(findFieldCard(s, yuna)?.card.damage).toBe(1000)
    both()
    s = step(log, s, { type: 'declareBlock', player: 1, blocker: null })
    both()
    expect(s.players[1].damageZone).toHaveLength(1)
    expect(trace(log, names)).toEqual([
      'attack:ward', 'step:declared', 'step:block', 'block:charlotte', 'step:blocked',
      'step:damage', 'battle:ward>charlotte:7000', 'battle:charlotte>ward:8000', 'broken:ward',
      'step:declaration',
      'attack:zack', 'step:declared', 'trigger:27-123S:attack', 'push:27-123S:attack',
      'zero:charlotte', 'damage:yuna:1000', 'resolve:27-123S:attack',
      'step:block', 'block:none', 'step:blocked',
      'step:damage', 'playerDamaged:1',
    ])
    ok(s)
  })
})
