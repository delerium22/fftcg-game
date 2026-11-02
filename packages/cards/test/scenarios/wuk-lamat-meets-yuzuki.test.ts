import { describe, expect, it } from 'vitest'
import type { CardId, Event, GameState } from '@fftcg/engine'
import { actingPlayer, checkInvariants, findFieldCard, legalCommands, viewFor } from '@fftcg/engine'
import { FIRE_BACKUP, makeGame, step, trace, withCp, withField, withHand } from '../harness.js'

/**
 * Rung V2-B, Layer 3 — Wuk Lamat meets Yuzuki on one damage (section 11.12.5.7 asks the affected Forward's controller to
 * order replacement effects only when the order changes the result).
 *
 * Wuk Lamat enters as her controller's 7th Character and her ability deals 7000 to the opponent's Ward — a Fire Forward
 * under Yuzuki. Her own increase ("a Forward you control deals damage … increases by 2000") and Yuzuki's "becomes 0"
 * (an opponent's ability) both apply. Once the damage is 0 no replacement applies any more, so both orders end at 0
 * (the notice of 2020-03-18: "becomes 0" before a "+1000" means the Forward incurs no damage) and nobody is asked:
 *   Yuzuki first:    7000 → 0, and the increase is not applied
 *   Wuk Lamat first: 7000 → 9000 → 0   (0 damage is not damage: no event, no mark)
 */

const ok = (s: GameState) => expect(checkInvariants(s)).toEqual([])

function board() {
  let s = makeGame()
  let wuk: CardId, cp: CardId[], yuzuki: CardId, ward: CardId
  ;[s, cp] = withCp(s, 0, Array<string>(5).fill(FIRE_BACKUP))
  ;[s] = withField(s, 0, 'forwards', '27-129S')              // Yuna: with the five Backups, six Characters before Wuk Lamat
  ;[s, wuk] = withHand(s, 0, '27-122S')
  ;[s, yuzuki] = withField(s, 1, 'forwards', '13-125R')
  ;[s, ward] = withField(s, 1, 'forwards', '21-001R')        // Fire only: Yuzuki's Water clause does not reach him
  const names = { [wuk]: 'wuk', [yuzuki]: 'yuzuki', [ward]: 'ward' }
  const log: Event[] = []
  s = step(log, s, { type: 'castCharacter', player: 0, card: wuk, payment: { dullBackups: cp.slice(0, 3), discards: [] } })
  s = step(log, s, { type: 'chooseTargets', player: 0, targets: [ward] })
  s = step(log, s, { type: 'pass', player: 0 }); s = step(log, s, { type: 'pass', player: 1 })   // the ability resolves — to its end
  return { s, log, names, wuk, yuzuki, ward }
}
describe('scenario: Wuk Lamat meets Yuzuki — "becomes 0" and +2000 give 0 in either order, so nobody is asked', () => {
  it('L3 wuk-lamat-meets-yuzuki — no order is asked of the Yuzuki player: the increase cannot revive a 0', () => {
    const { s, log, ward } = board()
    expect(s.pending, 'no order prompt: both orders end at 0').toBeNull()
    expect(s.resolution.active, 'the ability has resolved').toBeNull()
    expect(actingPlayer(s), 'the turn player acts again').toBe(0)
    expect(legalCommands(s, 1).filter((c) => c.type === 'chooseReplacementOrder')).toEqual([])
    expect(legalCommands(s, 0).filter((c) => c.type === 'chooseReplacementOrder')).toEqual([])
    expect(findFieldCard(s, ward)?.card.damage, 'nothing is marked').toBe(0)
    expect(log.some((e) => e.type === 'abilityDamage'), 'and no damage was dealt').toBe(false)
    expect(log.some((e) => e.type === 'damageReducedToZero'), 'the hit became 0').toBe(true)
    expect(findFieldCard(s, ward), 'Ward stands').toBeDefined()
    expect(viewFor(s, 0).pending).toEqual(viewFor(s, 1).pending)
    ok(s)
  })

  it('L3 wuk-lamat-meets-yuzuki — the damage is replaced to 0 in the canonical order: 7000 → 9000 → 0, one event', () => {
    const b = board()
    expect(b.log.filter((e) => e.type === 'abilityDamage')).toEqual([])
    expect(b.log.filter((e) => e.type === 'damageReducedToZero')).toEqual([{
      type: 'damageReducedToZero', target: b.ward, dealers: [b.wuk], original: 7000,
      trace: [{ by: b.wuk, before: 7000, after: 9000 }, { by: b.yuzuki, before: 9000, after: 0 }],
    }])
    expect(findFieldCard(b.s, b.ward)?.card.damage).toBe(0)
    ok(b.s)
  })

  it('L3 wuk-lamat-meets-yuzuki — Ward is dealt nothing', () => {
    const b = board()
    expect(findFieldCard(b.s, b.ward)?.card.damage).toBe(0)
    expect(b.log.filter((e) => e.type === 'abilityDamage')).toEqual([])
    expect(b.log.filter((e) => e.type === 'damageReducedToZero')).toHaveLength(1)
    expect(trace(b.log, b.names)).toEqual(['trigger:27-122S:etb', 'push:27-122S:etb', 'zero:ward', 'resolve:27-122S:etb'])
    ok(b.s)
  })
})
