import { describe, expect, it } from 'vitest'
import type { CardId, Event, GameState, PlayerView } from '@fftcg/engine'
import { checkInvariants, viewFor } from '@fftcg/engine'
import { WATER_BACKUP, makeGame, step, trace, withCp, withHand } from '../harness.js'

/**
 * Rung V1-B, Layer 3: Porom 11-121C's ETB — "discard 1 card from your hand. If the discarded card is not a Category IV
 * card, draw 1 card. If the discarded card is a Category IV card, draw 2 cards then discard 1 card from your hand." Both
 * discards are selects over the controller's own hand (V1-D11); the other seat must not learn any hand id, including
 * while the nested select waits (plan R7).
 */

const ok = (s: GameState) => expect(checkInvariants(s)).toEqual([])

/** Every card id the view exposes in a prompt, a frame binding or a stack item. */
function exposedIds(v: PlayerView): number[] {
  const out: number[] = []
  if (v.pending && 'candidates' in v.pending && Array.isArray(v.pending.candidates)) out.push(...(v.pending.candidates as number[]))
  const frames = [v.resolution.active, ...v.resolution.queue, ...v.stack.flatMap((i) => (i.kind === 'ability' ? [i.frame] : []))]
  for (const f of frames) if (f) out.push(...f.chosen, ...(f.declared ?? []).flatMap((d) => d.targets))
  return out
}

describe('scenario: Porom discards', () => {
  it('L3 porom-discards — Palom (Category IV) is discarded, two are drawn, and the second select over the hand leaks no hand id to the opponent', () => {
    let s = makeGame()
    let porom: CardId, palom: CardId, ward: CardId, cp: CardId[]
    ;[s, palom] = withHand(s, 0, '13-013C')
    ;[s, ward] = withHand(s, 0, '21-001R')
    ;[s, porom] = withHand(s, 0, '11-121C')
    ;[s, cp] = withCp(s, 0, [WATER_BACKUP, WATER_BACKUP])
    const names = { [porom]: 'porom', [palom]: 'palom', [ward]: 'ward' }
    const log: Event[] = []
    s = step(log, s, { type: 'castCharacter', player: 0, card: porom, payment: { dullBackups: cp, discards: [] } })
    s = step(log, s, { type: 'pass', player: 0 }); s = step(log, s, { type: 'pass', player: 1 })
    expect(s.pending).toEqual({ kind: 'chooseTargets', player: 0, min: 1, max: 1, candidates: [palom, ward] })
    for (const id of s.players[0].hand) expect(exposedIds(viewFor(s, 1)), 'the first select').not.toContain(id)
    s = step(log, s, { type: 'chooseTargets', player: 0, targets: [palom] })
    expect(s.players[0].hand).toHaveLength(3)
    expect(s.pending).toEqual({ kind: 'chooseTargets', player: 0, min: 1, max: 1, candidates: s.players[0].hand })
    const v = viewFor(s, 1)
    for (const id of s.players[0].hand) {
      expect(v.cards[id], 'the opponent sees no hand card').toBeUndefined()
      expect(exposedIds(v), 'the nested select, and the frame that waits on it').not.toContain(id)
    }
    s = step(log, s, { type: 'chooseTargets', player: 0, targets: [ward] })
    expect(s.players[0].breakZone).toEqual(expect.arrayContaining([palom, ward]))
    expect(s.players[0].hand).toHaveLength(2)
    expect(trace(log, names)).toEqual([
      'trigger:11-121C:etb', 'push:11-121C:etb', 'discard:palom', 'drew:0:2', 'discard:ward', 'resolve:11-121C:etb',
    ])
    ok(s)
  })
})
