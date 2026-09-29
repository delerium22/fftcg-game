import { describe, expect, it } from 'vitest'
import type { CardId, FieldCard, GameState } from '@fftcg/engine'
import { checkInvariants, deckPickCandidates, findFieldCard, legalCommands, powerOf } from '@fftcg/engine'
import { VOL1_ABILITIES, VOL1_CLAUSES } from '../src/abilities-vol1.js'
import { DEFS, FIRE_BACKUP, WATER_BACKUP, applyNow, makeGame, withCp, withDeckTops, withField, withHand } from './harness.js'

/**
 * Rung V1-B: the Starter Set 2025 Vol. 1 cards (spec 2026-09-29-rung-v1-vol1-pool.md, V1-D1/D3/D4), tested against the
 * REAL defs from `loadCards()` and the printed text quoted in each `describe`. The engine's own V1-A suites prove the
 * vocabulary on synthetic defs; this file proves the hand-written ASTs in `abilities-vol1.ts` encode what the cards say.
 */

const apply = applyNow
const fc = (s: GameState, id: CardId): FieldCard | undefined => findFieldCard(s, id)?.card
const ok = (s: GameState) => expect(checkInvariants(s)).toEqual([])
const powerOfId = (s: GameState, id: CardId) => powerOf(s, fc(s, id) as FieldCard)
const def = (code: string) => DEFS.find((d) => d.code === code)!

/** Put `code` in P0's hand with the given CP Backups, and cast it through `legalCommands` (reachability and behaviour). */
function cast(state: GameState, code: string, cp: string[]) {
  let s = state; let card: CardId
  ;[s, card] = withHand(s, 0, code)
  ;[s] = withCp(s, 0, cp)
  const cmd = legalCommands(s, 0).find((c) => (c.type === 'castCharacter' || c.type === 'castSummon') && c.card === card)
  expect(cmd, `${code} is not castable`).toBeDefined()
  return { ...apply(s, cmd!), card }
}

// ---------------------------------------------------------------------------
// The data: every Vol. 1 card as printed (SE endpoint; the four exclusives from the Materia Hunter patch)
// ---------------------------------------------------------------------------

describe('the Vol. 1 card data (spec V1-D1)', () => {
  /** code → type, elements, cost, power, generic, EX Burst, keywords, job, LB cost. Transcribed from the printed cards. */
  const PRINTED: Record<string, [string, string[], number, number | null, boolean, boolean, string[], string | undefined, number | undefined]> = {
    '27-122S': ['forward', ['fire'], 3, 7000, false, false, [], 'Princess/Warrior', undefined],
    '27-123S': ['forward', ['fire'], 5, 9000, false, false, [], 'SOLDIER', undefined],   // Haste is conditional, not innate (R10)
    '27-128S': ['forward', ['water'], 4, 8000, false, false, [], 'Knight', undefined],
    '27-129S': ['forward', ['water'], 4, 7000, false, false, [], 'Gullwings', undefined],
    '1-170C': ['summon', ['water'], 2, null, false, true, [], undefined, undefined],
    '3-143C': ['backup', ['water'], 3, null, false, true, [], 'Epopt', undefined],
    '11-010C': ['backup', ['fire'], 2, null, true, false, [], 'Standard Unit', undefined],
    '11-121C': ['backup', ['water'], 2, null, false, false, [], 'White Mage', undefined],
    '12-005C': ['summon', ['fire'], 5, null, false, true, [], undefined, undefined],
    '13-013C': ['backup', ['fire'], 2, null, false, false, [], 'Black Mage', undefined],
    '13-125R': ['forward', ['water', 'fire'], 3, 7000, false, false, [], 'Warrior', undefined],
    '18-003C': ['backup', ['fire'], 1, null, true, false, [], 'Standard Unit', undefined],
    '18-094C': ['backup', ['water'], 1, null, true, false, [], 'Standard Unit', undefined],
    '18-129C': ['forward', ['water', 'fire'], 4, 9000, false, false, [], 'Guardian', undefined],
    '20-106R': ['forward', ['water'], 3, 6000, false, false, [], 'Scion of the Seventh Dawn', undefined],
    '21-001R': ['forward', ['fire'], 3, 8000, false, true, [], 'Warrior', undefined],
    '21-010H': ['forward', ['fire'], 5, 9000, false, false, [], 'Warrior', undefined],
    '22-112R': ['forward', ['fire'], 3, 7000, false, false, [], 'SOLDIER', 1],
    '22-123R': ['forward', ['water'], 3, 3000, false, false, [], 'King', 1],
    '23-119R': ['forward', ['fire'], 5, 8000, false, false, ['firstStrike'], 'Galian Beast', 2],
    '23-130H': ['forward', ['light'], 5, 5000, false, false, [], 'Clan Gully Member', 1],
    '24-126H': ['forward', ['water', 'fire'], 6, 9000, false, false, [], 'Weapon', 2],
  }

  it('holds all 22 codes, each as printed', () => {
    for (const [code, [type, elements, cost, power, generic, exBurst, keywords, job, lb]] of Object.entries(PRINTED)) {
      const d = def(code)
      expect(d, code).toBeDefined()
      expect([d.type, d.elements, d.cost, d.power, d.generic, d.exBurst, d.keywords, d.job, d.limitBreak], code)
        .toEqual([type, elements, cost, power, generic, exBurst, keywords, job, lb])
      expect(d.hasAbilities, code).toBe(true)
      expect(d.categories?.length, `${code} has no category`).toBeGreaterThan(0)
    }
    expect(Object.keys(VOL1_CLAUSES).sort(), 'every Vol. 1 card declares its clause count').toEqual(Object.keys(PRINTED).sort())
  })

  it('the four exclusives are non-generic, carry their job and category, and are patched rather than fetched', () => {
    expect(['27-122S', '27-123S', '27-128S', '27-129S'].map((c) => [def(c).name, def(c).categories])).toEqual([
      ['Wuk Lamat', ['XIV']], ['Zack', ['VII']], ['Charlotte', ['FFBE']], ['Yuna', ['X']],
    ])
  })

  it('every Vol. 1 ability id is `<code>:<slug>` and quotes a verbatim slice of the printed text', () => {
    for (const [code, abilities] of Object.entries(VOL1_ABILITIES)) {
      for (const a of abilities) {
        expect(a.id.startsWith(`${code}:`), a.id).toBe(true)
        expect(def(code).text, a.id).toContain(a.text)
      }
      expect(VOL1_CLAUSES[code], `${code} implements more than it declares`).toBeGreaterThanOrEqual(abilities.length)
    }
  })
})

// ---------------------------------------------------------------------------
// The EX BURST cards (landed with the data: pool-coverage requires every printed EX BURST to be marked, R4)
// ---------------------------------------------------------------------------

describe('12-005C Ifrit — "EX BURST Choose 1 Forward. Deal it 9000 damage."', () => {
  it('is the marked EX Burst clause; cast, it deals 9000 to the chosen Forward on either side', () => {
    expect(def('12-005C').abilities?.filter((a) => a.exBurst).map((a) => a.id)).toEqual(['12-005C:summon'])
    let s = makeGame(); let victim: CardId
    ;[s, victim] = withField(s, 1, 'forwards', '27-124S')   // Cloud, 7000
    let r = cast(s, '12-005C', Array<string>(5).fill(FIRE_BACKUP))
    expect(r.state.pending).toEqual(expect.objectContaining({ kind: 'chooseTargets', player: 0, min: 1, max: 1 }))
    r = { ...apply(r.state, { type: 'chooseTargets', player: 0, targets: [victim] }), card: r.card }
    expect(fc(r.state, victim), '9000 ≥ 7000: §12.4.5').toBeUndefined()
    expect(r.state.players[0].breakZone).toContain(r.card)
    ok(r.state)
  })
})

describe('1-170C Fairy — "EX BURST Choose 1 Forward. Activate it. Draw 1 card."', () => {
  it('is the marked EX Burst clause; cast, it activates the chosen dull Forward and draws 1', () => {
    expect(def('1-170C').abilities?.filter((a) => a.exBurst).map((a) => a.id)).toEqual(['1-170C:summon'])
    let s = makeGame(); let mine: CardId
    ;[s, mine] = withField(s, 0, 'forwards', '27-124S', { status: 'dull' })
    let r = cast(s, '1-170C', [WATER_BACKUP, WATER_BACKUP])
    const hand = r.state.players[0].hand.length
    r = { ...apply(r.state, { type: 'chooseTargets', player: 0, targets: [mine] }), card: r.card }
    expect(fc(r.state, mine)?.status).toBe('active')
    expect(r.state.players[0].hand.length, 'draw 1').toBe(hand + 1)
    expect(r.events.map((e) => e.type)).toContain('activatedByAbility')
    ok(r.state)
  })
})

describe('3-143C Leonora — "EX BURST When Leonora enters the field, you may search for 1 Card Name Palom or Card Name Porom …"', () => {
  function castLeonora() {
    let s = makeGame(); let found: CardId[]
    ;[s, found] = withDeckTops(s, 0, ['13-013C', '11-121C', '18-003C'])   // Palom, Porom, and a Machinist that is neither
    const r = cast(s, '3-143C', Array<string>(3).fill(WATER_BACKUP))
    return { r, found }
  }

  it('is the marked EX Burst clause; the search offers Palom and Porom only, and may be declined', () => {
    expect(def('3-143C').abilities?.filter((a) => a.exBurst).map((a) => a.id)).toEqual(['3-143C:etb'])
    const { r } = castLeonora()
    const p = r.state.pending
    expect(p?.kind).toBe('chooseFromDeck')
    if (p?.kind !== 'chooseFromDeck') throw new Error('unreachable')
    expect([p.min, p.max], '"you may search for 1"').toEqual([0, 1])
    expect(deckPickCandidates(r.state, p), 'the two stacked on top, and not the Machinist').toEqual([0, 1])
  })

  it('adds the found card to hand and shuffles; declining adds nothing', () => {
    const { r, found } = castLeonora()
    const hand = r.state.players[0].hand.length
    const took = apply(r.state, { type: 'chooseFromDeck', player: 0, picks: [1] })
    expect(took.state.players[0].hand).toContain(found[1])
    expect(took.state.players[0].hand.length).toBe(hand + 1)
    ok(took.state)
    const declined = apply(r.state, { type: 'chooseFromDeck', player: 0, picks: [] })
    expect(declined.state.players[0].hand.length).toBe(hand)
    ok(declined.state)
  })
})

describe('21-001R Ward — "You can only pay with Fire CP to cast Ward." and "EX BURST When Ward enters the field, choose 1 Forward. Deal it 7000 damage."', () => {
  it('the EX Burst clause is the ETB; cast, it deals 7000 to the chosen Forward', () => {
    expect(def('21-001R').abilities?.filter((a) => a.exBurst).map((a) => a.id)).toEqual(['21-001R:etb'])
    let s = makeGame(); let victim: CardId
    ;[s, victim] = withField(s, 1, 'forwards', '27-124S')   // Cloud, 7000
    let r = cast(s, '21-001R', Array<string>(3).fill(FIRE_BACKUP))
    expect(r.state.pending).toEqual(expect.objectContaining({ kind: 'chooseTargets', player: 0 }))
    r = { ...apply(r.state, { type: 'chooseTargets', player: 0, targets: [victim] }), card: r.card }
    expect(fc(r.state, victim)).toBeUndefined()
    expect(powerOfId(r.state, r.card)).toBe(8000)
    ok(r.state)
  })

  it('only Fire CP may pay for it: a Water Backup in the payment is refused, and no such cast is offered', () => {
    let s = makeGame(); let ward: CardId; let fire: CardId[]; let water: CardId[]
    ;[s, ward] = withHand(s, 0, '21-001R')
    ;[s, fire] = withCp(s, 0, [FIRE_BACKUP, FIRE_BACKUP])
    ;[s, water] = withCp(s, 0, [WATER_BACKUP, WATER_BACKUP])
    const casts = legalCommands(s, 0).filter((c) => c.type === 'castCharacter' && c.card === ward)
    expect(casts, 'two Fire CP cannot pay 3, and the Water ones may not help').toEqual([])
    expect(() => apply(s, { type: 'castCharacter', player: 0, card: ward, payment: { dullBackups: [...fire, water[0]!], discards: [] } })).toThrow()
  })
})
