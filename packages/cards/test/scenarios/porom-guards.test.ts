import { describe, expect, it } from 'vitest'
import type { CardId, Event, GameState } from '@fftcg/engine'
import { checkInvariants, describeReplacementOrder, findFieldCard, legalCommands } from '@fftcg/engine'
import { DEFS, FIRE_BACKUP, makeGame, step, trace, withCp, withField, withHand } from '../harness.js'

/**
 * Rung V2-B, Layer 3: Porom 11-121C — "[Dull], put Porom into the Break Zone: Choose 1 Forward. During this turn, the next
 * damage dealt to it is reduced by 2000 instead." — used in RESPONSE, beside Yuzuki.
 *
 * The opponent aims Jecht Beam (8000) at Ward. With the Beam on the stack, Ward's controller answers with Porom's
 * shield; it resolves first. When the Beam resolves, two replacement effects wait for its damage: Yuzuki's "becomes 0"
 * (Ward is Fire; the Beam is an opponent's ability) and the shield. Ward's controller orders them (§11.12.5.7):
 *   Yuzuki first: 8000 → 0 — and with no damage left the shield has nothing to replace, so it is NOT used (V2-A2 reading).
 *   shield first: 8000 → 6000 → 0 — the same 0, the shield spent.
 * They keep the shield. The opponent's Ifrit — a Summon, which Yuzuki's Fire clause does not see — then deals 9000:
 * the shield makes it 7000, and Ward (8000) stands.
 */

const ok = (s: GameState) => expect(checkInvariants(s)).toEqual([])
const nameOf = (s: GameState) => (id: CardId): string => DEFS.find((d) => d.code === s.cards[id]?.code)?.name ?? String(id)

describe('scenario: Porom guards', () => {
  it('L3 porom-guards — a shield granted in response is kept by ordering Yuzuki first, and then saves Ward from Ifrit', () => {
    let s = makeGame()
    let jecht: CardId, spare: CardId, ifrit: CardId, cp: CardId[], porom: CardId, yuzuki: CardId, ward: CardId
    ;[s, jecht] = withField(s, 0, 'forwards', '18-129C')
    ;[s, spare] = withHand(s, 0, '18-129C')
    ;[s, ifrit] = withHand(s, 0, '12-005C')
    ;[s, cp] = withCp(s, 0, Array<string>(5).fill(FIRE_BACKUP))
    ;[s, porom] = withField(s, 1, 'backups', '11-121C')
    ;[s, yuzuki] = withField(s, 1, 'forwards', '13-125R')
    ;[s, ward] = withField(s, 1, 'forwards', '21-001R')
    const names = { [jecht]: 'jecht', [spare]: 'spare', [ifrit]: 'ifrit', [porom]: 'porom', [yuzuki]: 'yuzuki', [ward]: 'ward' }
    const log: Event[] = []

    const beam = legalCommands(s, 0).find((c) => c.type === 'activateAbility' && c.abilityId === '18-129C:jecht-beam' && c.targets.includes(ward))
    s = step(log, s, beam!)
    s = step(log, s, { type: 'pass', player: 0 })                                  // P1 may respond
    const shield = legalCommands(s, 1).find((c) => c.type === 'activateAbility' && c.abilityId === '11-121C:shield' && c.targets.includes(ward))
    expect(shield, 'an action ability may be used in response (§11.6)').toBeDefined()
    s = step(log, s, shield!)
    expect(s.players[1].breakZone, 'Porom is the cost').toContain(porom)
    s = step(log, s, { type: 'pass', player: 1 }); s = step(log, s, { type: 'pass', player: 0 })   // the shield resolves first
    expect(findFieldCard(s, ward)?.card.shields).toHaveLength(1)
    s = step(log, s, { type: 'pass', player: 0 }); s = step(log, s, { type: 'pass', player: 1 })   // the Beam resolves — up to the choice

    if (s.pending?.kind !== 'chooseReplacementOrder') throw new Error(`expected the order choice, got ${s.pending?.kind ?? 'none'}`)
    const pending = s.pending
    expect(pending).toMatchObject({ player: 1, target: ward, original: 8000 })
    expect(pending.options.map((_, i) => describeReplacementOrder(pending, i, nameOf(s))).sort()).toEqual([
      'Porom\'s shield −2000, then Yuzuki\'s reduction to 0 → 0',
      'Yuzuki\'s reduction to 0, then Porom\'s shield −2000 → 0 (Porom\'s shield kept)',
    ])
    const keep = pending.outcomes.findIndex((o) => o.consumes.length === 0)
    s = step(log, s, { type: 'chooseReplacementOrder', player: 1, order: keep })
    expect(findFieldCard(s, ward)?.card).toMatchObject({ damage: 0 })
    expect(findFieldCard(s, ward)?.card.shields, 'the shield was not used').toHaveLength(1)

    s = step(log, s, { type: 'castSummon', player: 0, card: ifrit, payment: { dullBackups: cp, discards: [] } })
    s = step(log, s, { type: 'chooseTargets', player: 0, targets: [ward] })
    s = step(log, s, { type: 'pass', player: 0 }); s = step(log, s, { type: 'pass', player: 1 })
    expect(findFieldCard(s, ward)?.card.damage, '9000 − 2000 on Ward’s 8000: he stands').toBe(7000)
    expect(findFieldCard(s, ward)?.card.shields, 'and now it is used').toBeUndefined()
    expect(trace(log, names)).toEqual([
      'activate:18-129C:jecht-beam', 'discard:spare', 'push:18-129C:jecht-beam',
      'activate:11-121C:shield', 'paid:porom', 'push:11-121C:shield',
      'shield:ward:2000', 'resolve:11-121C:shield',
      'zero:ward', 'resolve:18-129C:jecht-beam',
      'push:summon:ifrit', 'damage:ward:7000', 'resolve:summon:ifrit',
    ])
    ok(s)
  })
})
