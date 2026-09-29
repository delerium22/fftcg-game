import { describe, expect, it } from 'vitest'
import type { CardId, Event, GameState } from '@fftcg/engine'
import { checkInvariants, findFieldCard, legalCommands } from '@fftcg/engine'
import { WATER_BACKUP, makeGame, step, trace, withCp, withField, withHand } from '../harness.js'

/**
 * Rung V1-B, Layer 3: Alphinaud 20-106R — "your opponent selects 1 dull Forward they control. Put it into the Break Zone."
 * A select, not a choice (§11.3.3): nothing is declared as the clause is placed; the OPPONENT answers as it resolves; the
 * Forward is put, not broken (§15.1.1.3.2), so `cannotBeBroken` does not save it and the LB sweep is not a break.
 */

const ok = (s: GameState) => expect(checkInvariants(s)).toEqual([])
const ids = (s: GameState) => s.stack.map((i) => (i.kind === 'ability' ? i.frame.abilityId : 'summon'))

describe('scenario: Alphinaud selects — the opponent picks which of their dull Forwards leaves', () => {
  it('L3 alphinaud-selects — placed with no prompt; at resolution player 1 selects among their dull Forwards only, even one that cannot be broken; it is put into the Break Zone, not broken', () => {
    let s = makeGame()
    let alph: CardId, cloud: CardId, lightning: CardId, prishe: CardId, cp: CardId[]
    ;[s, cloud] = withField(s, 1, 'forwards', '27-124S', { status: 'dull', flags: ['cannotBeBroken'] })
    ;[s, lightning] = withField(s, 1, 'forwards', '27-127S', { status: 'dull' })
    ;[s, prishe] = withField(s, 1, 'forwards', '22-068R')          // active: not a candidate
    ;[s, alph] = withHand(s, 0, '20-106R')
    ;[s, cp] = withCp(s, 0, [WATER_BACKUP, WATER_BACKUP, WATER_BACKUP])
    const names = { [alph]: 'alphinaud', [cloud]: 'cloud', [lightning]: 'lightning', [prishe]: 'prishe' }
    const log: Event[] = []
    s = step(log, s, { type: 'castCharacter', player: 0, card: alph, payment: { dullBackups: cp, discards: [] } })
    // §11.3.3: a select is not a choice, so nothing is declared at placement (V1-D9).
    expect(s.pending).toBeNull()
    expect(ids(s)).toEqual(['20-106R:etb'])
    s = step(log, s, { type: 'pass', player: 0 }); s = step(log, s, { type: 'pass', player: 1 })
    // It resolves: the pending is PLAYER 1's, over their own dull Forwards; Prishe (active) is not offered.
    expect(s.pending).toEqual({ kind: 'chooseTargets', player: 1, min: 1, max: 1, candidates: [cloud, lightning] })
    expect(legalCommands(s, 0).filter((c) => c.type !== 'concede'), 'player 0 has nothing to answer').toEqual([])
    s = step(log, s, { type: 'chooseTargets', player: 1, targets: [cloud] })
    expect(s.players[1].breakZone, '"cannot be broken" does not stop a put (§15.1.1.3.2)').toContain(cloud)
    expect(findFieldCard(s, lightning)).not.toBeNull()
    expect(findFieldCard(s, prishe)).not.toBeNull()
    expect(trace(log, names)).toEqual([
      'trigger:20-106R:etb', 'push:20-106R:etb', 'put:cloud', 'resolve:20-106R:etb',
    ])
    ok(s)
  })
})
