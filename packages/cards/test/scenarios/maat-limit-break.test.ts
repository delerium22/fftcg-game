import { describe, expect, it } from 'vitest'
import type { CardId, Event, GameState } from '@fftcg/engine'
import { checkInvariants, findFieldCard, isLegal, keywordsOf, legalCommands, powerOf } from '@fftcg/engine'
import { EARTH_BACKUP, endPhase, makeGame, step, trace, withCp, withField } from '../harness.js'

/**
 * Rung J8, Layer 3 (spec J8-A3): Limit Break on the shipped cards. Maat is cast FROM the LB deck in Main Phase 1 for
 * four earth CP plus one flip (Noctis turns face up, §15.2.8.3.1–2); its ETB gives every Forward +1000 and Brave
 * until the end of the turn, so Scarmiglione attacks and stays active (§15.2.1). Next turn Luso attacks, Maat
 * blocks: Luso's "break what I damaged" breaks Maat, which reaches the Break Zone (§15.2.8.4.2) and is in the LB
 * deck face up when the command returns (§15.2.8.4.1) — the Break Zone never holds it.
 */

const ok = (s: GameState) => expect(checkInvariants(s)).toEqual([])
const lbOf = (s: GameState) => s.players[0].lbDeck.map((x) => [s.cards[x.id]!.code, x.faceUp])

describe('scenario: Maat from the LB deck — cast for CP plus a flip, pumps the team, and comes back face up when broken', () => {
  it('L3 maat-limit-break — the flip is the cost; the ETB is a trigger; Brave keeps the attacker active; the return skips the Break Zone', () => {
    let s = makeGame()
    let cp: CardId[], luso: CardId, scar: CardId
    ;[s, cp] = withCp(s, 0, [EARTH_BACKUP, EARTH_BACKUP, EARTH_BACKUP, EARTH_BACKUP])
    ;[s, scar] = withField(s, 0, 'forwards', '2-085H')      // 5000, on the field since the start of the turn
    ;[s, luso] = withField(s, 1, 'forwards', '27-125S')     // 3000
    const lb = s.players[0].lbDeck
    const maat = lb.find((x) => s.cards[x.id]!.code === '22-119R')!.id
    const noctis = lb.find((x) => s.cards[x.id]!.code === '23-125R')!.id
    expect(lbOf(s), '§7.14: dealt face down in list order').toEqual([['22-119R', false], ['22-119R', false], ['23-125R', false], ['23-125R', false]])
    const names = { [maat]: 'maat', [noctis]: 'noctis', [luso]: 'luso', [scar]: 'scar' }
    const log: Event[] = []

    // §15.2.8.3: one listed cast — the four Geomancers, one canonical flip; flipping Noctis instead is legal too.
    const casts = legalCommands(s, 0).filter((c) => c.type === 'castCharacter' && c.card === maat)
    expect(casts).toHaveLength(1)
    for (const c of casts) if (c.type === 'castCharacter') { expect(c.payment.dullBackups).toEqual(cp); expect(c.payment.lbFlip).toHaveLength(1) }
    expect(isLegal(s, { type: 'castCharacter', player: 0, card: maat, payment: { dullBackups: cp, discards: [], lbFlip: [noctis] } })).toBeNull()
    s = step(log, s, { type: 'castCharacter', player: 0, card: maat, payment: { dullBackups: cp, discards: [], lbFlip: [noctis] } })
    expect(lbOf(s), 'the cast card left; Noctis is face up').toEqual([['22-119R', false], ['23-125R', true], ['23-125R', false]])
    expect(findFieldCard(s, maat)?.owner, '§15.2.8.4: an ordinary Character on the field').toBe(0)
    s = step(log, s, { type: 'pass', player: 0 }); s = step(log, s, { type: 'pass', player: 1 })   // the ETB resolves
    expect(powerOf(s, findFieldCard(s, maat)!.card)).toBe(9000)
    expect(powerOf(s, findFieldCard(s, scar)!.card)).toBe(6000)
    expect(keywordsOf(s, findFieldCard(s, scar)!.card).has('brave')).toBe(true)

    s = endPhase(s)                                                                              // → attack declaration
    s = step(log, s, { type: 'declareAttack', player: 0, attackers: [scar] })
    expect(findFieldCard(s, scar)!.card.status, '§15.2.1: Brave — attacking does not dull it').toBe('active')
    s = step(log, s, { type: 'pass', player: 0 }); s = step(log, s, { type: 'pass', player: 1 })
    s = step(log, s, { type: 'declareBlock', player: 1, blocker: null })
    s = step(log, s, { type: 'pass', player: 0 }); s = step(log, s, { type: 'pass', player: 1 })   // damage
    expect(s.players[1].damageZone).toHaveLength(1)
    s = endPhase(endPhase(s))                                                                    // → main2
    s = step(log, s, { type: 'pass', player: 0 }); s = step(log, s, { type: 'pass', player: 1 })   // End Phase → turn 2
    expect([s.turn, s.turnPlayer, s.phase]).toEqual([2, 1, 'main1'])
    expect(powerOf(s, findFieldCard(s, maat)!.card), '§9.5.1.4: the pump expired').toBe(8000)
    expect(keywordsOf(s, findFieldCard(s, scar)!.card).has('brave'), 'the granted Brave expired').toBe(false)
    expect(keywordsOf(s, findFieldCard(s, maat)!.card).has('brave'), "Maat's own Brave is printed").toBe(true)

    s = endPhase(s)
    s = step(log, s, { type: 'declareAttack', player: 1, attackers: [luso] })
    s = step(log, s, { type: 'pass', player: 1 }); s = step(log, s, { type: 'pass', player: 0 })
    s = step(log, s, { type: 'declareBlock', player: 0, blocker: maat })
    s = step(log, s, { type: 'pass', player: 1 }); s = step(log, s, { type: 'pass', player: 0 })   // damage
    expect(s.stack.map((i) => (i.kind === 'ability' ? i.frame.abilityId : 'summon')), 'Luso damaged Maat before it broke').toEqual(['27-125S:damages-forward'])
    const r = step(log, s, { type: 'pass', player: 1 }); s = step(log, r, { type: 'pass', player: 0 })   // it resolves
    expect(findFieldCard(s, maat), 'broken by the ability').toBeNull()
    expect(findFieldCard(s, luso), '8000 ≥ 3000').toBeNull()
    expect(s.players[0].breakZone, '§15.2.8.4.1: not in the Break Zone when the command returns').toEqual([])
    expect(lbOf(s), 'back in the LB deck face up, at the end').toEqual([['22-119R', false], ['23-125R', true], ['23-125R', false], ['22-119R', true]])
    expect(trace(log, names)).toEqual([
      'lbFlip:noctis', 'trigger:22-119R:etb', 'push:22-119R:etb',
      'power:scar:+1000', 'keyword:scar:brave', 'power:maat:+1000', 'keyword:maat:brave', 'resolve:22-119R:etb',
      'attack:scar', 'step:declared', 'step:block', 'block:none', 'step:blocked', 'step:damage', 'playerDamaged:1',
      'phase:end', 'phase:active', 'phase:draw', 'drew:1:2', 'phase:main1',
      'attack:luso', 'step:declared', 'step:block', 'block:maat', 'step:blocked', 'step:damage',
      'battle:luso>maat:3000', 'battle:maat>luso:8000', 'broken:luso',
      'trigger:27-125S:damages-forward', 'push:27-125S:damages-forward',
      'abilityBroken:maat', 'resolve:27-125S:damages-forward', 'lbReturn:maat:breakZone',
    ])
    ok(s)
  })
})
