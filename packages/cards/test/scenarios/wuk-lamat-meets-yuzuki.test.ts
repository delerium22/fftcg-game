import { describe, expect, it } from 'vitest'
import type { CardId, Event, GameState } from '@fftcg/engine'
import { actingPlayer, checkInvariants, describeReplacementOrder, findFieldCard, legalCommands, viewFor } from '@fftcg/engine'
import { DEFS, FIRE_BACKUP, makeGame, step, trace, withCp, withField, withHand } from '../harness.js'

/**
 * Rung V2-B, Layer 3 — the ORDER scenario (§11.12.5.7): two replacement effects meet on one damage, their order changes
 * the result, and "the controller of the card which received the effects chooses the order".
 *
 * Wuk Lamat enters as her controller's 7th Character and her ability deals 7000 to the opponent's Ward — a Fire Forward
 * under Yuzuki. Her own increase ("a Forward you control deals damage … increases by 2000") and Yuzuki's "becomes 0"
 * (an opponent's ability) both apply. Ward's controller, the YUZUKI player, is asked before anything lands:
 *   Yuzuki first:    7000 → 0 → 2000   (an increase still applies to a 0 — the notice of 2020-03-18 puts both in one step)
 *   Wuk Lamat first: 7000 → 9000 → 0   (0 damage is not damage: no event, no mark)
 * Both answers are played.
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
  s = step(log, s, { type: 'pass', player: 0 }); s = step(log, s, { type: 'pass', player: 1 })   // the ability resolves — up to the choice
  return { s, log, names, wuk, yuzuki, ward }
}
const nameOf = (s: GameState) => (id: CardId): string => DEFS.find((d) => d.code === s.cards[id]?.code)?.name ?? String(id)

describe('scenario: Wuk Lamat meets Yuzuki — the affected Forward’s controller orders the replacements', () => {
  it('L3 wuk-lamat-meets-yuzuki — the Yuzuki player is asked before the damage lands, and is told what each order does', () => {
    const { s, log, wuk, yuzuki, ward } = board()
    if (s.pending?.kind !== 'chooseReplacementOrder') throw new Error(`expected the order choice, got ${s.pending?.kind ?? 'none'}`)
    expect(s.pending).toMatchObject({ player: 1, owner: 'frame', target: ward, original: 7000 })
    expect(actingPlayer(s), 'the non-turn player owes the answer').toBe(1)
    expect(s.pending.replacements.map((r) => [r.by, r.change])).toEqual(expect.arrayContaining([[wuk, { add: 2000 }], [yuzuki, { becomes: 0 }]]))
    expect(s.pending.replacements).toHaveLength(2)
    expect(s.pending.options.map((_, i) => describeReplacementOrder(s.pending as Extract<GameState['pending'], { kind: 'chooseReplacementOrder' }>, i, nameOf(s))).sort()).toEqual([
      'Wuk Lamat\'s +2000, then Yuzuki\'s reduction to 0 → 0',
      'Yuzuki\'s reduction to 0, then Wuk Lamat\'s +2000 → 2000',
    ])
    expect(findFieldCard(s, ward)?.card.damage, 'nothing has landed').toBe(0)
    expect(log.some((e) => e.type === 'abilityDamage' || e.type === 'damageReducedToZero')).toBe(false)
    expect(legalCommands(s, 1).filter((c) => c.type === 'chooseReplacementOrder')).toHaveLength(2)
    expect(legalCommands(s, 0).filter((c) => c.type !== 'concede'), 'the Wuk Lamat player waits').toEqual([])
    // The choice is over public effects on public cards: both seats see the same prompt.
    expect(viewFor(s, 0).pending).toEqual(viewFor(s, 1).pending)
    ok(s)
  })

  it('L3 wuk-lamat-meets-yuzuki — Yuzuki first: 0, then +2000 — Ward is dealt 2000', () => {
    const b = board(); let s = b.s
    if (s.pending?.kind !== 'chooseReplacementOrder') throw new Error('no order choice')
    const order = s.pending.outcomes.findIndex((o) => o.final === 2000)
    s = step(b.log, s, { type: 'chooseReplacementOrder', player: 1, order })
    expect(findFieldCard(s, b.ward)?.card.damage).toBe(2000)
    expect(b.log.filter((e) => e.type === 'abilityDamage')).toEqual([{
      type: 'abilityDamage', source: b.wuk, target: b.ward, original: 7000, amount: 2000,
      trace: [{ by: b.yuzuki, before: 7000, after: 0 }, { by: b.wuk, before: 0, after: 2000 }],
    }])
    expect(trace(b.log, b.names)).toEqual(['trigger:27-122S:etb', 'push:27-122S:etb', 'damage:ward:2000', 'resolve:27-122S:etb'])
    ok(s)
  })

  it('L3 wuk-lamat-meets-yuzuki — Wuk Lamat first: 9000, then 0 — Ward is dealt nothing', () => {
    const b = board(); let s = b.s
    if (s.pending?.kind !== 'chooseReplacementOrder') throw new Error('no order choice')
    const order = s.pending.outcomes.findIndex((o) => o.final === 0)
    s = step(b.log, s, { type: 'chooseReplacementOrder', player: 1, order })
    expect(findFieldCard(s, b.ward)?.card.damage).toBe(0)
    expect(b.log.filter((e) => e.type === 'abilityDamage')).toEqual([])
    expect(b.log.filter((e) => e.type === 'damageReducedToZero')).toEqual([{
      type: 'damageReducedToZero', target: b.ward, dealers: [b.wuk], original: 7000,
      trace: [{ by: b.wuk, before: 7000, after: 9000 }, { by: b.yuzuki, before: 9000, after: 0 }],
    }])
    expect(trace(b.log, b.names)).toEqual(['trigger:27-122S:etb', 'push:27-122S:etb', 'zero:ward', 'resolve:27-122S:etb'])
    ok(s)
  })
})
