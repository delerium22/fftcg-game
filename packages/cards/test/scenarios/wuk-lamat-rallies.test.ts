import { describe, expect, it } from 'vitest'
import type { CardId, Event, GameState } from '@fftcg/engine'
import { checkInvariants, findFieldCard } from '@fftcg/engine'
import { FIRE_BACKUP, makeGame, step, trace, withCp, withField, withHand } from '../harness.js'

/**
 * Rung V2-B, Layer 3: Wuk Lamat 27-122S — "If you control 7 or more Characters, Wuk Lamat gains 'If a Forward you
 * control deals damage to a Forward, the damage increases by 2000 instead.'"
 *
 * Ward and five Backups are six Characters; Wuk Lamat is the seventh. Her own entering ability is a Forward's, so its
 * 7000 is 9000 and breaks Zack. In the Attack Phase Ward (8000) is blocked by Charlotte, who reduces by 1000: +2000 and
 * −1000 give 9000 in either order, so nobody is asked (§11.12.5.7), and 9000 breaks her. Her 8000 back breaks Ward.
 */

const ok = (s: GameState) => expect(checkInvariants(s)).toEqual([])

describe('scenario: Wuk Lamat rallies', () => {
  it('L3 wuk-lamat-rallies — the 7th Character adds 2000 to her own ability’s damage and to Ward’s battle damage', () => {
    let s = makeGame()
    let wuk: CardId, ward: CardId, cp: CardId[], zack: CardId, charlotte: CardId
    ;[s, ward] = withField(s, 0, 'forwards', '21-001R')
    ;[s, cp] = withCp(s, 0, Array<string>(5).fill(FIRE_BACKUP))
    ;[s, wuk] = withHand(s, 0, '27-122S')
    ;[s, zack] = withField(s, 1, 'forwards', '27-123S')
    ;[s, charlotte] = withField(s, 1, 'forwards', '27-128S')
    const names = { [wuk]: 'wuk', [ward]: 'ward', [zack]: 'zack', [charlotte]: 'charlotte' }
    const log: Event[] = []
    const both = () => { s = step(log, s, { type: 'pass', player: 0 }); s = step(log, s, { type: 'pass', player: 1 }) }

    s = step(log, s, { type: 'castCharacter', player: 0, card: wuk, payment: { dullBackups: cp.slice(0, 3), discards: [] } })
    s = step(log, s, { type: 'chooseTargets', player: 0, targets: [zack] })
    both()
    expect(findFieldCard(s, zack), '7000 + 2000 on Zack’s 9000').toBeNull()

    for (let i = 0; i < 4 && s.attack?.step !== 'declaration'; i++) both()   // Main Phase 1 ends; through §10.1.1 to the declaration step
    s = step(log, s, { type: 'declareAttack', player: 0, attackers: [ward] })
    both()
    s = step(log, s, { type: 'declareBlock', player: 1, blocker: charlotte })
    both()
    expect(s.pending, '+2000 and −1000 commute: no order to choose').toBeNull()
    expect(findFieldCard(s, charlotte), '8000 + 2000 − 1000 = 9000 on her 8000').toBeNull()
    expect(findFieldCard(s, ward), 'her 8000 on his 8000').toBeNull()
    expect(trace(log, names)).toEqual([
      'trigger:27-122S:etb', 'push:27-122S:etb', 'damage:zack:9000', 'resolve:27-122S:etb', 'broken:zack',
      'step:preparation', 'step:declaration',
      'attack:ward', 'step:declared', 'step:block', 'block:charlotte', 'step:blocked',
      'step:damage', 'battle:ward>charlotte:9000', 'battle:charlotte>ward:8000', 'broken:ward', 'broken:charlotte',
    ])
    ok(s)
  })
})
