import { describe, expect, it } from 'vitest'
import type { CardId, Event, GameState } from '@fftcg/engine'
import { checkInvariants, deckPickCandidates, findFieldCard, powerOf } from '@fftcg/engine'
import { FIRE_BACKUP, WATER_BACKUP, LB_DECK, deckFile, makeGame, step, trace, withCp, withDeckTops, withField, withHand } from '../harness.js'

/**
 * Rung V1-B, Layer 3: LB Luso 23-130H, cast from a real Vol. 1 LB deck. "choose 1 Character you control. You may search for
 * 1 Job Standard Unit of the same Element as the chosen Character and add it to your hand." then "When a Job Standard Unit
 * enters your field, Luso gains +4000 power until the end of the turn." Luso is pure Light: any CP pays for him
 * (§11.2.1.1), and one other LB card is flipped (§15.2.8.3).
 */

const ok = (s: GameState) => expect(checkInvariants(s)).toEqual([])

describe('scenario: Luso searches', () => {
  it('L3 luso-searches — Ward (Fire) is chosen, so only the Fire Standard Unit is findable; casting it pumps Luso to 9000', () => {
    let s = makeGame([deckFile('starter-2025-vol1-lb.txt'), LB_DECK])
    let ward: CardId, palom: CardId, ifrit: CardId, cp: CardId[], found: CardId[]
    ;[s, ward] = withField(s, 0, 'forwards', '21-001R')
    ;[s, cp] = withCp(s, 0, [FIRE_BACKUP, FIRE_BACKUP, WATER_BACKUP, WATER_BACKUP])
    ;[s, palom] = withHand(s, 0, '13-013C')   // discarded for 2 Fire CP
    ;[s, ifrit] = withHand(s, 0, '12-005C')   // discarded for the Warrior's 2
    ;[s, found] = withDeckTops(s, 0, ['18-094C', '11-010C'])   // a Water Standard Unit on top, then the Fire one
    const lb = s.players[0].lbDeck
    const luso = lb.find((x) => s.cards[x.id]!.code === '23-130H')!.id
    const flip = lb.find((x) => s.cards[x.id]!.code === '22-123R')!.id
    const names = { [luso]: 'luso', [ward]: 'ward', [found[1]!]: 'warrior' }
    const log: Event[] = []
    s = step(log, s, { type: 'castCharacter', player: 0, card: luso, payment: { dullBackups: cp, discards: [{ card: palom, element: 'fire' }], lbFlip: [flip] } })
    expect(s.pending).toEqual(expect.objectContaining({ kind: 'chooseTargets', player: 0, min: 1, max: 1 }))
    s = step(log, s, { type: 'chooseTargets', player: 0, targets: [ward] })
    s = step(log, s, { type: 'pass', player: 0 }); s = step(log, s, { type: 'pass', player: 1 })
    const p = s.pending
    if (p?.kind !== 'chooseFromDeck') throw new Error('no search')
    expect(deckPickCandidates(s, p), 'the Fire Standard Unit only').toEqual([1])
    s = step(log, s, { type: 'chooseFromDeck', player: 0, picks: [1] })
    expect(s.players[0].hand).toContain(found[1])
    s = step(log, s, { type: 'castCharacter', player: 0, card: found[1]!, payment: { dullBackups: [], discards: [{ card: ifrit, element: 'fire' }] } })
    s = step(log, s, { type: 'pass', player: 0 }); s = step(log, s, { type: 'pass', player: 1 })
    expect(powerOf(s, findFieldCard(s, luso)!.card)).toBe(9000)
    expect(trace(log, names)).toEqual([
      'discard:' + String(palom), 'lbFlip:' + String(flip), 'trigger:23-130H:etb', 'push:23-130H:etb', 'look:0:' + String(p.count),
      'toHand:warrior', 'resolve:23-130H:etb',
      'discard:' + String(ifrit), 'trigger:23-130H:standard-unit', 'push:23-130H:standard-unit', 'power:luso:+4000', 'resolve:23-130H:standard-unit',
    ])
    ok(s)
  })
})
