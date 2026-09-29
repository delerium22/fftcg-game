import { describe, expect, it } from 'vitest'
import type { Ability } from '../src/abilities.js'
import type { CardDef } from '../src/types.js'
import type { CardId, GameState } from '../src/state.js'
import type { Command, Payment } from '../src/commands.js'
import { apply } from '../src/apply.js'
import { isLegal, legalCommands } from '../src/legal.js'
import { canAffordCast, castRequirement } from '../src/cp.js'
import { validateContinuousStatics } from '../src/setup.js'
import { deckOf, makeDef, makeGame, VANILLA_POOL, withField, withHand, withHandSize } from './helpers.js'

/**
 * Rung V1-A3 (spec V1-D14, R3): "You can only pay with Fire CP to cast Ward" (Ward 21-001R). Read by `castRequirement` into
 * `CpRequirement.onlyElement`. A source that can be Fire (a Moogle-style Backup that also produces Fire) counts, as Fire.
 *
 * Rung V1-D (plan D-D4, reversing the V1-A3 reading): §11.2.2.3 lets a player generate as much CP as they like and then
 * choose which of it pays; the card restricts the CP USED, not the CP generated. So Water CP may be generated alongside
 * enough Fire CP — it is unspent and ceases to exist (§11.2.2.3.1) — but it never counts toward the cost.
 */

const ONLY_FIRE: Ability = { id: 'T-WARD:only', trigger: { kind: 'static', effect: { kind: 'onlyCp', element: 'fire' } }, text: 'You can only pay with Fire CP to cast Ward.', effects: [] }
const DEFS: CardDef[] = [
  ...VANILLA_POOL,
  makeDef({ code: 'T-WARD', name: 'Ward', elements: ['fire'], cost: 3, power: 7000, hasAbilities: true, abilityClauses: 1, abilities: [ONLY_FIRE] }),
  makeDef({ code: 'T-BF', type: 'backup', elements: ['fire'], cost: 2, power: null }),
  makeDef({ code: 'T-BW', type: 'backup', elements: ['water'], cost: 2, power: null }),
  // A Water Backup that can also produce Fire CP (Moogle's shape, spec C6-3): flexible, so it may pay — as Fire.
  makeDef({ code: 'T-BWF', type: 'backup', elements: ['water'], cost: 2, power: null, hasAbilities: true, abilityClauses: 1,
    abilities: [{ id: 'T-BWF:fire', trigger: { kind: 'static', effect: { kind: 'produceElement', element: 'fire' } }, text: 'T-BWF can produce Fire CP.', effects: [] }] }),
  makeDef({ code: 'T-FIRE', elements: ['fire'], cost: 2, power: 5000 }),
  makeDef({ code: 'T-WATER', elements: ['water'], cost: 2, power: 5000 }),
  makeDef({ code: 'T-FW', elements: ['fire', 'water'], cost: 2, power: 5000 }),
]

function board(backups: readonly string[], hand: readonly string[]): { s: GameState; ward: CardId; ids: Record<string, CardId[]> } {
  let s = withHandSize(makeGame({ defs: DEFS, decks: [deckOf(VANILLA_POOL.map((d) => d.code)), deckOf(VANILLA_POOL.map((d) => d.code))] }), 0, 0)
  const ids: Record<string, CardId[]> = {}
  const note = (code: string, id: CardId) => { ids[code] = [...(ids[code] ?? []), id] }
  for (const code of backups) { let id: CardId; [s, id] = withField(s, 0, 'backups', code); note(code, id) }
  for (const code of hand) { let id: CardId; [s, id] = withHand(s, 0, code); note(code, id) }
  let ward: CardId
  ;[s, ward] = withHand(s, 0, 'T-WARD')
  return { s, ward, ids }
}
const casts = (s: GameState, ward: CardId): Payment[] =>
  legalCommands(s, 0).flatMap((c) => (c.type === 'castCharacter' && c.card === ward ? [c.payment] : []))
const cast = (ward: CardId, payment: Payment): Command => ({ type: 'castCharacter', player: 0, card: ward, payment })

describe('V1-A3 — "you can only pay with Fire CP" (Ward)', () => {
  it('L1 §11.2.2.3 — the requirement carries the restriction, read off the static on the card itself', () => {
    const { s, ward } = board([], [])
    expect(castRequirement(s, ward, 0).onlyElement).toBe('fire')
  })

  it('L1 §11.2.2.3 — with a Fire Backup, a Water Backup and a Fire card to discard, every listed payment is Fire-only', () => {
    const { s, ward, ids } = board(['T-BF', 'T-BW'], ['T-FIRE'])
    const listed = casts(s, ward)
    expect(listed).toEqual([{ dullBackups: [ids['T-BF']![0]], discards: [{ card: ids['T-FIRE']![0], element: 'fire' }] }])
  })

  it('L1 §11.2.2.3 — Water CP never counts toward the cost: a payment short of Fire CP throws', () => {
    const { s, ward, ids } = board(['T-BF', 'T-BW'], ['T-FIRE', 'T-WATER'])
    const fire = { card: ids['T-FIRE']![0]!, element: 'fire' as const }
    for (const payment of [
      { dullBackups: [ids['T-BW']![0]!], discards: [fire] },                     // 3 generated, 2 of them Fire
      { dullBackups: [ids['T-BF']![0]!], discards: [{ card: ids['T-WATER']![0]!, element: 'water' as const }] },   // 1 Fire
    ]) {
      expect(isLegal(s, cast(ward, payment)), JSON.stringify(payment)).toMatch(/only fire CP/)
      expect(() => apply(s, cast(ward, payment))).toThrow(/only fire CP/)
    }
    expect(isLegal(s, cast(ward, { dullBackups: [ids['T-BF']![0]!], discards: [fire] }))).toBeNull()
  })

  it('L1 §11.2.2.3 — 3 Fire CP and 1 unused Water CP generated: legal; the Water Backup is dulled and the Fire CP pay (Review Focus 4)', () => {
    const { s, ward, ids } = board(['T-BF', 'T-BW'], ['T-FIRE'])
    const water = ids['T-BW']![0]!
    const payment = { dullBackups: [ids['T-BF']![0]!, water], discards: [{ card: ids['T-FIRE']![0]!, element: 'fire' as const }] }
    expect(isLegal(s, cast(ward, payment))).toBeNull()
    const r = apply(s, cast(ward, payment))
    expect(r.state.players[0].forwards.map((f) => f.id)).toContain(ward)
    expect(r.state.players[0].backups.find((b) => b.id === water)?.status, 'the CP was generated').toBe('dull')
    // Listed payments stay minimal: a pointless Water source is never offered.
    expect(casts(s, ward)).toEqual([{ dullBackups: [ids['T-BF']![0]], discards: [{ card: ids['T-FIRE']![0], element: 'fire' }] }])
  })

  it('L1 §11.2.2.3 — 2 Fire CP and 1 Water CP generated: refused, the Water CP does not pay (Review Focus 4)', () => {
    const { s, ward, ids } = board(['T-BF', 'T-BF', 'T-BW'], [])
    const payment = { dullBackups: [...ids['T-BF']!, ids['T-BW']![0]!], discards: [] }
    expect(isLegal(s, cast(ward, payment))).toMatch(/payment does not cover cost 3 fire \(only fire CP may pay it\)/)
    expect(() => apply(s, cast(ward, payment))).toThrow(/only fire CP/)
  })

  it('L1 §11.2.2.3 — with one Fire card and otherwise Water sources it is unaffordable, and no cast is listed', () => {
    // Without the restriction the Fire discard plus a Water Backup pays 3 with Fire among it; with it, 2 Fire CP is all.
    const { s, ward } = board(['T-BW', 'T-BW'], ['T-FIRE', 'T-WATER'])
    expect(canAffordCast(s, 0, ward)).toBe(false)
    expect(casts(s, ward)).toEqual([])
  })

  it('L1 §11.2.2.3 — a Backup that can also produce Fire pays as Fire, and a Fire/Water card is discarded as Fire only', () => {
    const { s, ward, ids } = board(['T-BWF'], ['T-FW'])
    expect(canAffordCast(s, 0, ward)).toBe(true)
    const fw = ids['T-FW']![0]!
    expect(casts(s, ward)).toEqual([{ dullBackups: [ids['T-BWF']![0]], discards: [{ card: fw, element: 'fire' }] }])
    expect(isLegal(s, cast(ward, { dullBackups: [ids['T-BWF']![0]!], discards: [{ card: fw, element: 'water' }] }))).not.toBeNull()
  })

  it('an onlyCp static with an unknown element is refused at game creation', () => {
    const bad = makeDef({ code: 'T-BAD', hasAbilities: true, abilityClauses: 1, abilities: [{ ...ONLY_FIRE, id: 'T-BAD:only', trigger: { kind: 'static', effect: JSON.parse('{"kind":"onlyCp","element":"mud"}') as { kind: 'onlyCp'; element: 'fire' } } }] })
    expect(validateContinuousStatics([bad]).join()).toMatch(/T-BAD:only/)
  })
})
