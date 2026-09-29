import { describe, expect, it } from 'vitest'
import type { CardId, GameState } from '@fftcg/engine'
import { apply, canAffordCast, checkInvariants, enumeratePayments, legalCommands } from '@fftcg/engine'
import { FIRE_BACKUP, WATER_BACKUP, makeGame, withCp, withHand } from '../harness.js'

/**
 * Rung V1-B, Layer 3: Ward 21-001R — "You can only pay with Fire CP to cast Ward." (rung V1-A3, V1-D14). Every payment
 * reader admits only Fire CP for Ward, overpay included (§11.2.2.3 would otherwise allow it); a Water discard or Backup
 * never helps. The AI's candidates are checked on the real card in `apps/cli/test/selfplay.test.ts`.
 */

const ok = (s: GameState) => expect(checkInvariants(s)).toEqual([])

describe('scenario: Ward — only Fire CP', () => {
  it('L3 ward-fire-only — with two Fire and two Water Backups Ward is unaffordable and never listed; a third Fire Backup makes it castable, and every listed payment is Fire only', () => {
    let s = makeGame()
    let ward: CardId, fire: CardId[], water: CardId[], more: CardId[]
    ;[s, ward] = withHand(s, 0, '21-001R')
    ;[s, fire] = withCp(s, 0, [FIRE_BACKUP, FIRE_BACKUP])
    ;[s, water] = withCp(s, 0, [WATER_BACKUP, WATER_BACKUP])
    expect(canAffordCast(s, 0, ward)).toBe(false)
    expect(enumeratePayments(s, 0, ward)).toEqual([])
    expect(legalCommands(s, 0).some((c) => c.type === 'castCharacter' && c.card === ward)).toBe(false)
    expect(() => apply(s, { type: 'castCharacter', player: 0, card: ward, payment: { dullBackups: [...fire, water[0]!], discards: [] } }), 'a Water Backup in the payment')
      .toThrow(/fire/i)
    ;[s, more] = withCp(s, 0, [FIRE_BACKUP])
    const casts = legalCommands(s, 0).filter((c) => c.type === 'castCharacter' && c.card === ward)
    expect(casts.length).toBeGreaterThan(0)
    for (const c of casts) if (c.type === 'castCharacter') expect(c.payment.dullBackups.filter((b) => water.includes(b))).toEqual([])
    const r = apply(s, casts[0]!)
    expect(r.state.players[0].forwards.map((f) => f.id)).toContain(ward)
    void more
    ok(r.state)
  })
})
