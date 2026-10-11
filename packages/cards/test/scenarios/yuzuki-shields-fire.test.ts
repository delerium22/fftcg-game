import { describe, expect, it } from 'vitest'
import type { CardId, Event, GameState } from '@fftcg/engine'
import { checkInvariants, findFieldCard, legalCommands } from '@fftcg/engine'
import { FIRE_BACKUP, makeGame, step, trace, withCp, withField, withHand } from '../harness.js'

/**
 * Rung V2-B, Layer 3: Yuzuki 13-125R — "If a Fire Forward you control is dealt damage by your opponent's abilities, the
 * damage becomes 0 instead." and "If a Water Forward you control is dealt damage, reduce the damage by 2000 instead."
 *
 * The opponent's Jecht Beam (a special ability, 8000) at the Ward she protects deals nothing. Their Ifrit is a Summon,
 * not an ability (spec V2-D6), so the Fire clause does not see it: aimed at Yuzuki herself — Water and Fire — only the
 * Water clause applies, 9000 becomes 7000, and 7000 is her power.
 */

const ok = (s: GameState) => expect(checkInvariants(s)).toEqual([])

describe('scenario: Yuzuki shields Fire', () => {
  it('L3 yuzuki-shields-fire — an ability’s 8000 on her Fire Forward is 0; a Summon’s 9000 on her is 7000 and breaks her', () => {
    let s = makeGame()
    let jecht: CardId, spare: CardId, ifrit: CardId, cp: CardId[], yuzuki: CardId, ward: CardId
    ;[s, jecht] = withField(s, 0, 'forwards', '18-129C')
    ;[s, spare] = withHand(s, 0, '18-129C')                  // the Jecht that Jecht Beam discards (§11.7.1)
    ;[s, ifrit] = withHand(s, 0, '12-005C')
    ;[s, cp] = withCp(s, 0, Array<string>(5).fill(FIRE_BACKUP))
    ;[s, yuzuki] = withField(s, 1, 'forwards', '13-125R')
    ;[s, ward] = withField(s, 1, 'forwards', '21-001R')
    const names = { [jecht]: 'jecht', [spare]: 'spare', [ifrit]: 'ifrit', [yuzuki]: 'yuzuki', [ward]: 'ward' }
    const log: Event[] = []
    const both = () => { s = step(log, s, { type: 'pass', player: 0 }); s = step(log, s, { type: 'pass', player: 1 }) }

    const beam = legalCommands(s, 0).find((c) => c.type === 'activateAbility' && c.abilityId === '18-129C:jecht-beam' && c.targets.includes(ward))
    expect(beam, 'Jecht Beam may choose the Ward').toBeDefined()
    s = step(log, s, beam!)
    both()
    expect(findFieldCard(s, ward)?.card.damage, 'the opponent’s ability dealt nothing').toBe(0)

    s = step(log, s, { type: 'castSummon', player: 0, card: ifrit, payment: { dullBackups: cp, discards: [] } })
    s = step(log, s, { type: 'chooseTargets', player: 0, targets: [yuzuki] })
    both()
    expect(findFieldCard(s, yuzuki), '9000 − 2000 = 7000, her power').toBeNull()
    expect(s.players[1].breakZone).toContain(yuzuki)
    expect(trace(log, names)).toEqual([
      'activate:18-129C:jecht-beam', 'discard:spare', 'push:18-129C:jecht-beam', 'zero:ward', 'resolve:18-129C:jecht-beam',
      'push:summon:ifrit', 'damage:yuzuki:7000', 'resolve:summon:ifrit', 'broken:yuzuki',
    ])
    ok(s)
  })
})
