import { describe, expect, it } from 'vitest'
import type { CardId, Event, FieldCard, GameState } from '@fftcg/engine'
import { activationCheck, checkInvariants, deckPickCandidates, findFieldCard, keywordsOf, legalCommands, powerOf, viewFor } from '@fftcg/engine'
import { VOL1_ABILITIES, VOL1_CLAUSES } from '../src/abilities-vol1.js'
import { DEFS, FIRE_BACKUP, LIGHTNING_BACKUP, WATER_BACKUP, applyNow, endPhase, makeGame, setPlayer, step, withCp, withDeckTops, withField, withHand } from './harness.js'

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
  // Paid with the Backups only: a payment that discards a hand card for CP would change what the hand holds.
  const cmd = legalCommands(s, 0).find((c) => (c.type === 'castCharacter' || c.type === 'castSummon') && c.card === card && c.payment.discards.length === 0)
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

// ---------------------------------------------------------------------------
// Burn: Palom, LB Zack (Ifrit and Ward are above, with the EX BURST cards)
// ---------------------------------------------------------------------------

describe('13-013C Palom — "When Palom enters the field, choose 1 Forward. Deal it 4000 damage. If you control a Card Name Porom Forward, deal it 8000 damage instead."', () => {
  /** A Porom FORWARD, which neither pool prints (the only Porom is the Backup 11-121C): the 8000 branch is tested synthetically (spec V1-D3). */
  const POROM_FORWARD = 'T-POROM-F'
  const withPoromForward = (s: GameState): GameState => ({
    ...s, defs: { ...s.defs, [POROM_FORWARD]: { ...def('11-121C'), code: POROM_FORWARD, type: 'forward', power: 5000, abilities: [], abilityClauses: 0 } },
  })

  function castPalom(s0: GameState) {
    let s = s0; let victim: CardId
    ;[s, victim] = withField(s, 1, 'forwards', '20-106R')   // Alphinaud, 6000 — survives 4000, not 8000
    const r = cast(s, '13-013C', [FIRE_BACKUP, FIRE_BACKUP])
    expect(r.state.pending).toEqual(expect.objectContaining({ kind: 'chooseTargets', player: 0, min: 1, max: 1 }))
    return { t: apply(r.state, { type: 'chooseTargets', player: 0, targets: [victim] }).state, victim }
  }

  it('deals 4000 without a Porom Forward — the Porom BACKUP does not count', () => {
    let s = makeGame()
    ;[s] = withField(s, 0, 'backups', '11-121C')
    const { t, victim } = castPalom(s)
    expect(fc(t, victim)?.damage).toBe(4000)
    ok(t)
  })

  it('deals 8000 instead while its controller controls a Card Name Porom Forward', () => {
    let s = withPoromForward(makeGame())
    ;[s] = withField(s, 0, 'forwards', POROM_FORWARD)
    const { t, victim } = castPalom(s)
    expect(fc(t, victim), '8000 ≥ 6000: §12.4.5').toBeUndefined()
  })

  it('an OPPONENT’s Porom Forward does not count ("you control")', () => {
    let s = withPoromForward(makeGame())
    ;[s] = withField(s, 1, 'forwards', POROM_FORWARD)
    const { t, victim } = castPalom(s)
    expect(fc(t, victim)?.damage).toBe(4000)
  })
})

describe('22-112R Zack — "Limit Break -- 1", "When Zack enters the field, choose 1 Forward. Deal it 3000 damage."', () => {
  it('parses to LB 1 with one clause; on entering it deals 3000 to the chosen Forward on either side', () => {
    const d = def('22-112R')
    expect([d.limitBreak, d.abilityClauses, (d.abilities ?? []).map((a) => a.id)]).toEqual([1, 1, ['22-112R:etb']])
    let s = makeGame(); let victim: CardId
    ;[s, victim] = withField(s, 1, 'forwards', '27-125S')   // Luso 27-125S, 3000
    const r = cast(s, '22-112R', Array<string>(3).fill(FIRE_BACKUP))
    const t = apply(r.state, { type: 'chooseTargets', player: 0, targets: [victim] }).state
    expect(fc(t, victim)).toBeUndefined()
    ok(t)
  })
})

// ---------------------------------------------------------------------------
// Draw and search: Machinist, Geomancer, Leo, Yuna, LB Luso (Leonora is above, with the EX BURST cards)
// ---------------------------------------------------------------------------

describe('C3-shaped hand draws, on the Vol. 1 Standard Units', () => {
  const offered = (s: GameState, source: CardId, abilityId: string) =>
    legalCommands(s, 0).filter((c) => c.type === 'activateAbility' && c.source === source && c.abilityId === abilityId)

  for (const [code, element, other] of [['18-003C', FIRE_BACKUP, WATER_BACKUP], ['18-094C', WATER_BACKUP, FIRE_BACKUP]] as const) {
    it(`${code} — "[${code === '18-003C' ? 'Fire' : 'Water'}], discard ${code === '18-003C' ? 'Machinist' : 'Geomancer'}: Draw 1 card. You can only use this ability if … is in your hand."`, () => {
      let s = makeGame(); let src: CardId
      ;[s, src] = withHand(s, 0, code)
      ;[s] = withCp(s, 0, [element])
      const before = s.players[0].hand.length
      const cmds = offered(s, src, `${code}:draw`)
      expect(cmds.length).toBeGreaterThan(0)
      const r = apply(s, cmds[0]!)
      expect(r.state.players[0].hand.length, '-1 for the discarded source, +1 for the draw').toBe(before)
      expect(r.state.players[0].breakZone).toContain(src)
      ok(r.state)
    })

    it(`${code} needs its own Element and is not usable from the field`, () => {
      let s = makeGame(); let inHand: CardId; let onField: CardId
      ;[s, inHand] = withHand(s, 0, code)
      ;[s] = withCp(s, 0, [other])
      expect(offered(s, inHand, `${code}:draw`), 'the other Element cannot pay').toEqual([])
      ;[s, onField] = withField(s, 0, 'backups', code)
      ;[s] = withCp(s, 0, [element])
      expect(offered(s, onField, `${code}:draw`)).toEqual([])
    })
  }
})

describe('22-123R Leo — "Limit Break -- 1", "When Leo enters the field, draw 1 card."', () => {
  it('parses to LB 1 with one clause; on entering its controller draws 1', () => {
    const d = def('22-123R')
    expect([d.limitBreak, d.abilityClauses, (d.abilities ?? []).map((a) => a.id)]).toEqual([1, 1, ['22-123R:etb']])
    const r = cast(makeGame(), '22-123R', Array<string>(3).fill(WATER_BACKUP))
    expect(r.state.players[0].hand.length, 'Leo left the hand, then one card was drawn').toBe(1)
    expect(r.events).toContainEqual({ type: 'drew', player: 0, count: 1 })
    ok(r.state)
  })
})

describe('27-129S Yuna — "When Yuna enters the field, you may play 1 Forward of cost 3 from your hand onto the field."', () => {
  function castYuna() {
    let s = makeGame(); let ward: CardId; let charlotte: CardId; let palom: CardId
    ;[s, ward] = withHand(s, 0, '21-001R')        // a Forward of cost 3
    ;[s, charlotte] = withHand(s, 0, '27-128S')   // a Forward of cost 4
    ;[s, palom] = withHand(s, 0, '13-013C')       // a Backup of cost 2
    const r = cast(s, '27-129S', Array<string>(4).fill(WATER_BACKUP))
    return { r, ward, charlotte, palom }
  }

  it('selects among the cost-3 Forwards in hand only; the opponent\u2019s view carries no hand id', () => {
    const { r, ward } = castYuna()
    expect(r.state.pending).toEqual({ kind: 'chooseTargets', player: 0, min: 0, max: 1, candidates: [ward] })
    expect(JSON.stringify(viewFor(r.state, 1).pending), 'the select is over a hidden hand').not.toContain(String(ward))
  })

  it('plays the selected Forward without a cast; its own ETB fires. Declining plays nothing', () => {
    const { r, ward } = castYuna()
    const played = apply(r.state, { type: 'chooseTargets', player: 0, targets: [ward] })
    expect(fc(played.state, ward)).toBeDefined()
    expect(played.events).toContainEqual({ type: 'playedFromHand', player: 0, card: ward })
    expect(played.events.some((e) => e.type === 'cast' && e.card === ward), 'playing is not casting (§15.1.1.7)').toBe(false)
    expect(played.state.pending, 'Ward\u2019s ETB chooses its target').toEqual(expect.objectContaining({ kind: 'chooseTargets', player: 0 }))
    const declined = apply(r.state, { type: 'chooseTargets', player: 0, targets: [] })
    expect(declined.state.players[0].hand).toContain(ward)
    ok(declined.state)
  })
})

describe('27-129S Yuna — "When Yuna attacks, look at the top 3 cards of your deck. Add 1 card among them to your hand …"', () => {
  it('fires on the attack declaration: a private look at three, one to hand, two to the bottom', () => {
    let s = endPhase(makeGame()); let yuna: CardId; let tops: CardId[]
    ;[s, yuna] = withField(s, 0, 'forwards', '27-129S')
    ;[s, tops] = withDeckTops(s, 0, ['13-013C', '11-121C', '18-003C'])
    const r = apply(s, { type: 'declareAttack', player: 0, attackers: [yuna] })
    const p = r.state.pending
    expect(p?.kind).toBe('chooseFromDeck')
    if (p?.kind !== 'chooseFromDeck') throw new Error('unreachable')
    expect([p.count, p.min, p.max]).toEqual([3, 1, 1])
    const done = apply(r.state, { type: 'chooseFromDeck', player: 0, picks: [2] })
    expect(done.state.players[0].hand).toContain(tops[2])
    expect(done.state.players[0].deck.slice(-2), 'the other two, to the bottom').toEqual([tops[0], tops[1]])
    ok(done.state)
  })
})

describe('23-130H Luso — "When Luso enters the field, choose 1 Character you control. You may search for 1 Job Standard Unit of the same Element as the chosen Character …"', () => {
  function castLuso(pick: 'fire' | 'water' | 'luso') {
    let s = makeGame(); let fire: CardId; let water: CardId; let found: CardId[]
    ;[s, fire] = withField(s, 0, 'forwards', '21-001R')     // Ward, a Fire Character to choose
    ;[s, water] = withField(s, 0, 'forwards', '20-106R')    // Alphinaud, a Water one
    ;[s, found] = withDeckTops(s, 0, ['11-010C', '18-094C', '13-013C'])          // Fire Standard Unit, Water Standard Unit, Fire Black Mage
    const r = cast(s, '23-130H', Array<string>(5).fill(FIRE_BACKUP))
    expect(r.state.pending).toEqual(expect.objectContaining({ kind: 'chooseTargets', player: 0, min: 1, max: 1 }))
    if (r.state.pending?.kind !== 'chooseTargets') throw new Error('unreachable')
    expect(r.state.pending.candidates, '"1 Character you control": Forwards and Backups, Luso included').toEqual(expect.arrayContaining([r.card, fire, water, ...r.state.players[0].backups.map((b) => b.id)]))
    const chosen = pick === 'fire' ? fire : pick === 'water' ? water : r.card
    return { t: apply(r.state, { type: 'chooseTargets', player: 0, targets: [chosen] }).state, found }
  }

  it('a Fire Character finds only the Fire Standard Unit; a Water one only the Water one', () => {
    for (const [pick, want] of [['fire', 0], ['water', 1]] as const) {
      const { t, found } = castLuso(pick)
      const p = t.pending
      if (p?.kind !== 'chooseFromDeck') throw new Error(`no search after choosing ${pick}`)
      expect([p.min, p.max], '"you may search"').toEqual([0, 1])
      expect(deckPickCandidates(t, p), pick).toEqual([want])
      const done = apply(t, { type: 'chooseFromDeck', player: 0, picks: [want] })
      expect(done.state.players[0].hand).toContain(found[want])
      ok(done.state)
    }
  })

  it('choosing Luso himself (Light) finds nothing, and the search still shuffles', () => {
    const { t } = castLuso('luso')
    const p = t.pending
    expect(p === null || (p.kind === 'chooseFromDeck' && deckPickCandidates(t, p).length === 0), 'no Light Standard Unit').toBe(true)
  })
})

describe('23-130H Luso — "When a Job Standard Unit enters your field, Luso gains +4000 power until the end of the turn."', () => {
  it('pumps Luso when a Standard Unit enters its controller\u2019s field, and not for another Backup or the opponent\u2019s', () => {
    let s = makeGame(); let luso: CardId
    ;[s, luso] = withField(s, 0, 'forwards', '23-130H')
    let r = cast(s, FIRE_BACKUP, [FIRE_BACKUP])
    expect(powerOfId(r.state, luso), 'Machinist is a Job Standard Unit').toBe(9000)
    r = cast(r.state, '13-013C', [FIRE_BACKUP, FIRE_BACKUP])   // Palom, a Black Mage — and the cast CP are only placed
    expect(powerOfId(r.state, luso), 'Palom is not').toBe(9000)
    ok(r.state)
  })

  it('a Standard Unit FORWARD entering pumps Luso too — Dragoon 1-147C (V1-A5: `of` is a list)', () => {
    let s = makeGame(); let luso: CardId
    ;[s, luso] = withField(s, 0, 'forwards', '23-130H')
    expect(def('1-147C').job, 'Dragoon is a Job Standard Unit').toBe('Standard Unit')
    expect(def('1-147C').type).toBe('forward')
    const r = cast(s, '1-147C', [LIGHTNING_BACKUP, LIGHTNING_BACKUP, LIGHTNING_BACKUP])
    expect(powerOfId(r.state, luso)).toBe(9000)
    ok(r.state)
  })
})

// ---------------------------------------------------------------------------
// The field: Warrior, Alphinaud, Ultima Weapon, Vincent, Taivas (Fairy is above, with the EX BURST cards)
// ---------------------------------------------------------------------------

const offered = (s: GameState, player: 0 | 1, source: CardId, abilityId: string) =>
  legalCommands(s, player).filter((c) => c.type === 'activateAbility' && c.source === source && c.abilityId === abilityId)

describe('11-010C Warrior — "[Dull], put Warrior into the Break Zone: Choose 1 Forward. It gains +1000 power until the end of the turn."', () => {
  it('pumps the chosen Forward by 1000, and the Warrior is paid into the Break Zone, not broken', () => {
    let s = makeGame(); let src: CardId; let ally: CardId
    ;[s, src] = withField(s, 0, 'backups', '11-010C')
    ;[s, ally] = withField(s, 0, 'forwards', '21-001R')
    const pick = offered(s, 0, src, '11-010C:pump').find((c) => c.type === 'activateAbility' && c.targets.includes(ally))
    expect(pick).toBeDefined()
    const r = apply(s, pick!)
    expect(powerOfId(r.state, ally)).toBe(9000)
    expect(r.state.players[0].breakZone).toContain(src)
    expect(r.events.some((e) => e.type === 'brokenByAbility')).toBe(false)
    ok(r.state)
  })
})

describe('11-010C Warrior — "[Fire][1][Dull], put Warrior into the Break Zone: Choose 1 Forward. Deal it 5000 damage."', () => {
  it('costs a Fire CP and one more, never its own dull; deals 5000', () => {
    let s = makeGame(); let src: CardId; let victim: CardId
    ;[s, src] = withField(s, 0, 'backups', '11-010C')
    ;[s, victim] = withField(s, 1, 'forwards', '27-125S')   // Luso 27-125S, 3000
    expect(offered(s, 0, src, '11-010C:burn'), 'no CP: not offered').toEqual([])
    ;[s] = withCp(s, 0, [WATER_BACKUP])
    expect(offered(s, 0, src, '11-010C:burn'), 'a Water CP and the Warrior itself cannot pay [Fire][1]').toEqual([])
    ;[s] = withCp(s, 0, [FIRE_BACKUP])
    const cmds = offered(s, 0, src, '11-010C:burn')
    expect(cmds.length).toBeGreaterThan(0)
    for (const c of cmds) if (c.type === 'activateAbility') expect(c.payment.dullBackups).not.toContain(src)
    const r = apply(s, cmds.find((c) => c.type === 'activateAbility' && c.targets.includes(victim))!)
    expect(fc(r.state, victim)).toBeUndefined()
    expect(r.state.players[0].breakZone).toContain(src)
    ok(r.state)
  })
})

describe('1-170C Fairy — the draw goes with the target (plan R9, §11.11.2)', () => {
  it('a Fairy whose only target was broken in response is cancelled whole: nothing is activated and nothing is drawn', () => {
    let s = makeGame(); let leo: CardId; let fairy: CardId; let cp: CardId[]; let warrior: CardId
    ;[s, leo] = withField(s, 0, 'forwards', '22-123R', { status: 'dull' })   // Leo, 3000
    ;[s, fairy] = withHand(s, 0, '1-170C')
    ;[s, cp] = withCp(s, 0, [WATER_BACKUP, WATER_BACKUP])
    ;[s, warrior] = withField(s, 1, 'backups', '11-010C')
    ;[s] = withCp(s, 1, [FIRE_BACKUP, FIRE_BACKUP])
    const log: Event[] = []
    s = step(log, s, { type: 'castSummon', player: 0, card: fairy, payment: { dullBackups: cp, discards: [] } })
    s = step(log, s, { type: 'chooseTargets', player: 0, targets: [leo] })
    const hand = s.players[0].hand.length
    s = step(log, s, { type: 'pass', player: 0 })
    const burn = offered(s, 1, warrior, '11-010C:burn').find((c) => c.type === 'activateAbility' && c.targets.includes(leo))
    expect(burn, 'the opponent may answer with the Warrior').toBeDefined()
    s = step(log, s, burn!)
    for (const p of [1, 0] as const) s = step(log, s, { type: 'pass', player: p })   // the burn resolves; Leo is broken
    expect(fc(s, leo)).toBeUndefined()
    for (const p of [0, 1] as const) s = step(log, s, { type: 'pass', player: p })   // the Fairy resolves
    expect(log).toContainEqual({ type: 'stackCancelled', item: { kind: 'summon', card: fairy }, reason: 'targetsGone' })
    expect(s.players[0].hand.length, 'no draw').toBe(hand)
    expect(log.some((e) => e.type === 'drew' && e.player === 0)).toBe(false)
    ok(s)
  })
})

describe('20-106R Alphinaud — "When Alphinaud enters the field, your opponent selects 1 dull Forward they control. Put it into the Break Zone."', () => {
  it('the OPPONENT selects among their own dull Forwards; the one selected is put, not broken', () => {
    let s = makeGame(); let a: CardId; let b: CardId; let active: CardId; let mine: CardId
    ;[s, a] = withField(s, 1, 'forwards', '27-124S', { status: 'dull' })
    ;[s, b] = withField(s, 1, 'forwards', '27-127S', { status: 'dull' })
    ;[s, active] = withField(s, 1, 'forwards', '22-068R')
    ;[s, mine] = withField(s, 0, 'forwards', '21-001R', { status: 'dull' })
    const r = cast(s, '20-106R', Array<string>(3).fill(WATER_BACKUP))
    expect(r.state.pending).toEqual({ kind: 'chooseTargets', player: 1, min: 1, max: 1, candidates: [a, b] })
    const t = apply(r.state, { type: 'chooseTargets', player: 1, targets: [b] })
    expect(t.state.players[1].breakZone).toContain(b)
    expect([fc(t.state, a)?.id, fc(t.state, active)?.id, fc(t.state, mine)?.id]).toEqual([a, active, mine])
    expect(t.events).toContainEqual({ type: 'putIntoBreakZone', card: b, reason: 'ability' })
    expect(t.events.some((e) => e.type === 'brokenByAbility' || e.type === 'broken')).toBe(false)
    ok(t.state)
  })

  it('with no dull Forward on the opponent\u2019s side it does nothing: no prompt, no "no legal target" event', () => {
    let s = makeGame()
    ;[s] = withField(s, 1, 'forwards', '27-124S')
    const r = cast(s, '20-106R', Array<string>(3).fill(WATER_BACKUP))
    expect(r.state.pending).toBeNull()
    expect(r.events.some((e) => e.type === 'abilityNoLegalTarget')).toBe(false)
    ok(r.state)
  })
})

describe('20-106R Alphinaud — "Damage 3 -- Alphinaud gains +2000 power."', () => {
  it('is +2000 while his controller has 3 points of damage or more, and only then', () => {
    let s = makeGame(); let alph: CardId
    ;[s, alph] = withField(s, 0, 'forwards', '20-106R')
    const damaged = (st: GameState, n: number): GameState => {
      const p0 = st.players[0]
      return setPlayer(st, 0, { ...p0, deck: p0.deck.slice(n), damageZone: [...p0.damageZone, ...p0.deck.slice(0, n)] })
    }
    expect(powerOfId(damaged(s, 2), alph)).toBe(6000)
    expect(powerOfId(damaged(s, 3), alph)).toBe(8000)
    const theirs = setPlayer(s, 1, { ...s.players[1], deck: s.players[1].deck.slice(3), damageZone: s.players[1].deck.slice(0, 3) })
    expect(powerOfId(theirs, alph), 'the opponent\u2019s damage does not count').toBe(6000)
  })
})

describe('24-126H Ultima Weapon — its two enters-the-field clauses, each with its own condition', () => {
  /** Cast Ultima Weapon (cost 6: five Backups and one discard for 2) with `fire` Fire and `5 - fire` Water Backups. */
  function castUltima(s0: GameState, fire: number) {
    let s = s0; let uw: CardId; let fodder: CardId; let cp: CardId[]
    ;[s, uw] = withHand(s, 0, '24-126H')
    ;[s, fodder] = withHand(s, 0, '12-005C')
    ;[s, cp] = withCp(s, 0, [...Array<string>(fire).fill(FIRE_BACKUP), ...Array<string>(5 - fire).fill(WATER_BACKUP)])
    const log: Event[] = []
    const t = step(log, s, { type: 'castCharacter', player: 0, card: uw, payment: { dullBackups: cp, discards: [{ card: fodder, element: 'fire' }] } })
    return { t, uw, log }
  }
  const stackIds = (s: GameState) => s.stack.map((i) => (i.kind === 'ability' ? i.frame.abilityId : 'summon'))

  it('both clauses trigger; the Fire one declares its target as it is placed, and resolves first — the §11.8.7 fixed-order simplification', () => {
    let s = makeGame(); let victim: CardId
    ;[s, victim] = withField(s, 1, 'forwards', '27-127S')
    const { t } = castUltima(s, 3)
    expect(t.pending, 'clause 1 chooses its Forward at placement').toEqual(expect.objectContaining({ kind: 'chooseTargets', player: 0 }))
    const placed = step([], t, { type: 'chooseTargets', player: 0, targets: [victim] })
    // MVP0-SIMPLIFICATION (§11.8.7): the controller should order their simultaneous triggers; the engine fixes the
    // order instead (the marker on `collectWatchers`; timing matrix `simplified`). The first-triggered is placed last,
    // so the printed-first Fire clause is on top. This pins the simplification, not a rule.
    expect(stackIds(placed)).toEqual(['24-126H:etb-water', '24-126H:etb-fire'])
  })

  it('Fire: 9000 with 4 Fire Characters, Ultima Weapon itself one of them; nothing with 3', () => {
    for (const [fire, dealt] of [[3, true], [2, false]] as const) {
      let s = makeGame(); let victim: CardId; let other: CardId
      ;[s, victim] = withField(s, 1, 'forwards', '27-127S')   // Lightning, 9000
      ;[s, other] = withField(s, 1, 'forwards', '27-124S')
      const { t } = castUltima(s, fire)
      const r = apply(t, { type: 'chooseTargets', player: 0, targets: [victim] })
      // With 2 Fire Backups there are 3 Water ones: clause 2's select comes up too, answered away from the victim.
      const done = r.state.pending ? apply(r.state, { type: 'chooseTargets', player: 1, targets: [other] }) : r
      const hits = [...r.events, ...done.events].filter((e) => e.type === 'abilityDamage' && e.target === victim)
      expect(hits.length > 0, `${fire} Fire Backups + Ultima Weapon`).toBe(dealt)
      expect(fc(done.state, victim) === undefined).toBe(dealt)
      ok(done.state)
    }
  })

  it('Water: with 4 Water Characters the OPPONENT selects one of their Forwards to put into the Break Zone; with 3, nothing', () => {
    for (const [fire, selects] of [[2, true], [3, false]] as const) {
      let s = makeGame(); let a: CardId; let b: CardId
      ;[s, a] = withField(s, 1, 'forwards', '27-127S')   // Lightning, 9000 — clause 1's target
      ;[s, b] = withField(s, 1, 'forwards', '22-068R')
      const { t } = castUltima(s, fire)
      const r = apply(t, { type: 'chooseTargets', player: 0, targets: [a] })
      if (selects) {
        expect(r.state.pending).toEqual({ kind: 'chooseTargets', player: 1, min: 1, max: 1, candidates: [a, b] })
        const done = apply(r.state, { type: 'chooseTargets', player: 1, targets: [b] })
        expect(done.state.players[1].breakZone).toContain(b)
        expect(done.events).toContainEqual({ type: 'putIntoBreakZone', card: b, reason: 'ability' })
        ok(done.state)
      } else {
        expect(r.state.pending, '3 Water Characters: no select').toBeNull()
        expect(fc(r.state, b), 'only the Fire clause acted').toBeDefined()
      }
    }
  })
})

describe('23-119R Vincent — "When Vincent enters the field, you may put 1 Fire Backup you control into the Break Zone. When you do so, …"', () => {
  function castVincent(s0: GameState) {
    let s = s0; let victim: CardId
    ;[s, victim] = withField(s, 1, 'forwards', '27-127S')   // Lightning, 9000
    const r = cast(s, '23-119R', Array<string>(5).fill(FIRE_BACKUP))
    return { r, victim }
  }

  it('prints First Strike as a keyword and one clause', () => {
    const d = def('23-119R')
    expect([d.limitBreak, d.keywords, d.abilityClauses, (d.abilities ?? []).map((a) => a.id)]).toEqual([2, ['firstStrike'], 1, ['23-119R:etb']])
  })

  it('putting a Fire Backup raises the 9000 damage choice over the opponent\u2019s Forwards', () => {
    const { r, victim } = castVincent(makeGame())
    expect(r.state.pending).toEqual(expect.objectContaining({ kind: 'chooseTargets', player: 0, min: 0, max: 1 }))
    if (r.state.pending?.kind !== 'chooseTargets') throw new Error('unreachable')
    const backup = r.state.pending.candidates[0]!
    const put = apply(r.state, { type: 'chooseTargets', player: 0, targets: [backup] })
    expect(put.state.players[0].breakZone).toContain(backup)
    expect(put.state.pending).toEqual({ kind: 'chooseTargets', player: 0, min: 1, max: 1, candidates: [victim] })
    const done = apply(put.state, { type: 'chooseTargets', player: 0, targets: [victim] })
    expect(fc(done.state, victim)).toBeUndefined()
    ok(done.state)
  })

  it('declining puts nothing and asks nothing more (onlyIfChosen)', () => {
    const { r, victim } = castVincent(makeGame())
    const done = apply(r.state, { type: 'chooseTargets', player: 0, targets: [] })
    expect(done.state.pending).toBeNull()
    expect(fc(done.state, victim)?.damage).toBe(0)
    expect(done.state.players[0].backups).toHaveLength(5)
    ok(done.state)
  })

  it('a Water Backup is not offered', () => {
    let s = makeGame(); let victim: CardId; let water: CardId[]
    ;[s, victim] = withField(s, 1, 'forwards', '27-127S')
    ;[s, water] = withCp(s, 0, [WATER_BACKUP])
    const r = cast(s, '23-119R', Array<string>(4).fill(FIRE_BACKUP))
    if (r.state.pending?.kind !== 'chooseTargets') throw new Error('no select')
    expect(r.state.pending.candidates).toHaveLength(4)
    expect(r.state.pending.candidates).not.toContain(water[0])
    void victim
  })
})

describe('21-010H Taivas — "When Taivas enters the field, you may search for 1 Job Warrior or Card Name Warrior and add it to your hand."', () => {
  it('finds a Job Warrior (multi-job included) or a card named Warrior, of any cost, and nothing else', () => {
    let s = makeGame()
    ;[s] = withDeckTops(s, 0, ['27-122S', '11-010C', '21-010H', '27-128S', '13-125R'])   // Wuk Lamat, Warrior, Taivas, Charlotte (Knight), Yuzuki
    const r = cast(s, '21-010H', Array<string>(5).fill(FIRE_BACKUP))
    const p = r.state.pending
    if (p?.kind !== 'chooseFromDeck') throw new Error('no search')
    expect([p.min, p.max]).toEqual([0, 1])
    expect(deckPickCandidates(r.state, p).filter((i) => i < 5), 'not Charlotte').toEqual([0, 1, 2, 4])
  })
})

describe('21-010H Taivas — "[0]: Play 1 Job Warrior or Card Name Warrior of cost 3 or less from your hand onto the field. …"', () => {
  function taivasWithHand(codes: string[]) {
    let s = makeGame(); let taivas: CardId; const hand: CardId[] = []
    ;[s, taivas] = withField(s, 0, 'forwards', '21-010H')
    for (const code of codes) { let id: CardId; [s, id] = withHand(s, 0, code); hand.push(id) }
    return { s, taivas, hand }
  }

  it('plays a Warrior of cost 3 or less — Wuk Lamat (Princess/Warrior) or the Warrior Backup — and not Taivas (5) or Charlotte (Knight)', () => {
    const { s, taivas, hand } = taivasWithHand(['27-122S', '11-010C', '21-010H', '27-128S'])
    const [wuk, warrior] = hand as [CardId, CardId]
    const cmds = offered(s, 0, taivas, '21-010H:play')
    expect(cmds, 'one activation, no declared targets: the play is a select made at resolution').toHaveLength(1)
    const r = apply(s, cmds[0]!)
    expect(r.state.pending).toEqual({ kind: 'chooseTargets', player: 0, min: 1, max: 1, candidates: [wuk, warrior] })
    const done = apply(r.state, { type: 'chooseTargets', player: 0, targets: [warrior] })
    expect(done.state.players[0].backups.map((b) => b.id)).toContain(warrior)
    expect(done.events).toContainEqual({ type: 'playedFromHand', player: 0, card: warrior })
    ok(done.state)
  })

  it('only during its controller\u2019s turn', () => {
    let s = makeGame(); let taivas: CardId
    ;[s, taivas] = withField(s, 1, 'forwards', '21-010H')
    ;[s] = withHand(s, 1, '11-010C')
    const handed = apply(s, { type: 'pass', player: 0 }).state
    expect(handed.priority, 'player 1 holds priority on player 0\u2019s turn').toBe(1)
    expect(activationCheck(handed, 1, taivas, '21-010H:play')).toBe('21-010H:play may only be used during your turn')
    expect(offered(handed, 1, taivas, '21-010H:play')).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Specials and statics: Jecht, Zack, Wuk Lamat, Charlotte, Porom, Yuzuki
// ---------------------------------------------------------------------------

const kw = (s: GameState, id: CardId) => [...keywordsOf(s, fc(s, id)!)].sort()

describe('18-129C Jecht — "[Fire][Water]: Until the end of the turn, Jecht gains Haste, First Strike and Brave. You can only use this ability during your turn."', () => {
  it('grants Jecht himself the three keywords, for a Fire and a Water CP, on his controller\u2019s turn only', () => {
    let s = makeGame(); let jecht: CardId
    ;[s, jecht] = withField(s, 0, 'forwards', '18-129C', { enteredTurn: s.turn })
    ;[s] = withCp(s, 0, [FIRE_BACKUP])
    expect(offered(s, 0, jecht, '18-129C:gains'), 'Fire alone cannot pay [Fire][Water]').toEqual([])
    ;[s] = withCp(s, 0, [WATER_BACKUP])
    const cmds = offered(s, 0, jecht, '18-129C:gains')
    expect(cmds, 'no dull icon: usable the turn he enters, and it declares no target').toHaveLength(1)
    const r = apply(s, cmds[0]!)
    expect(kw(r.state, jecht)).toEqual(['brave', 'firstStrike', 'haste'])
    ok(r.state)
    let theirs = makeGame(); let their: CardId
    ;[theirs, their] = withField(theirs, 1, 'forwards', '18-129C')
    ;[theirs] = withCp(theirs, 1, [FIRE_BACKUP, WATER_BACKUP])
    const handed = apply(theirs, { type: 'pass', player: 0 }).state
    expect(activationCheck(handed, 1, their, '18-129C:gains')).toBe('18-129C:gains may only be used during your turn')
  })
})

describe('18-129C Jecht — "Jecht Beam [S][Dull]: Choose 1 Forward. Deal it 8000 damage."', () => {
  it('a special ability: dull Jecht and discard another Jecht from hand; 8000 to the chosen Forward', () => {
    let s = makeGame(); let jecht: CardId; let victim: CardId
    ;[s, jecht] = withField(s, 0, 'forwards', '18-129C')
    ;[s, victim] = withField(s, 1, 'forwards', '27-124S')
    expect(offered(s, 0, jecht, '18-129C:jecht-beam'), 'no Jecht in hand: not offered (§11.7.1)').toEqual([])
    let other: CardId
    ;[s, other] = withHand(s, 0, '18-129C')
    const pick = offered(s, 0, jecht, '18-129C:jecht-beam').find((c) => c.type === 'activateAbility' && c.targets.includes(victim))
    expect(pick).toBeDefined()
    const r = apply(s, pick!)
    expect(r.state.players[0].breakZone, 'the same-name card was discarded').toContain(other)
    expect(fc(r.state, jecht)?.status).toBe('dull')
    expect(fc(r.state, victim)).toBeUndefined()
    ok(r.state)
  })
})

describe('27-123S Zack — "If your opponent controls 3 or more Forwards, Zack gains Haste."', () => {
  it('has Haste exactly while the opponent controls 3 or more Forwards; LB Zack beside him never does', () => {
    let s = makeGame(); let zack: CardId; let lbZack: CardId
    ;[s, zack] = withField(s, 0, 'forwards', '27-123S')
    ;[s, lbZack] = withField(s, 0, 'forwards', '22-112R')
    for (const code of ['27-124S', '27-125S']) [s] = withField(s, 1, 'forwards', code)
    expect(kw(s, zack), '2 Forwards').toEqual([])
    ;[s] = withField(s, 1, 'forwards', '22-068R')
    expect(kw(s, zack), '3 Forwards').toEqual(['haste'])
    expect(kw(s, lbZack), 'the Haste is Zack 27-123S\u2019s own, not every Zack\u2019s (StaticScope.self)').toEqual([])
    ;[s] = withField(s, 1, 'backups', EARTH)
    ;[s] = withField(s, 0, 'forwards', '21-001R')
    expect(kw(s, zack), 'Backups and his own side do not count').toEqual(['haste'])
  })
})

const EARTH = '18-064C'

describe('27-123S Zack — "When Zack enters the field or attacks, deal 1000 damage for each Backup you control to all the Forwards opponent control."', () => {
  it('on entering: 1000 per Backup its controller controls, to every opponent Forward, and to none of his own', () => {
    let s = makeGame(); let a: CardId; let b: CardId; let mine: CardId
    ;[s, a] = withField(s, 1, 'forwards', '27-124S')   // Cloud, 7000
    ;[s, b] = withField(s, 1, 'forwards', '27-127S')   // Lightning, 9000
    ;[s, mine] = withField(s, 0, 'forwards', '21-001R')
    ;[s] = withField(s, 1, 'backups', EARTH)            // the opponent's Backups do not count
    const r = cast(s, '27-123S', Array<string>(5).fill(FIRE_BACKUP))   // five Backups: 5000 each
    expect(r.state.pending, 'untargeted: no prompt').toBeNull()
    expect(r.events.filter((e) => e.type === 'abilityDamage').map((e) => e.type === 'abilityDamage' && [e.target, e.amount]))
      .toEqual([[a, 5000], [b, 5000]])
    expect(fc(r.state, a)?.damage).toBe(5000)
    expect(fc(r.state, b)?.damage).toBe(5000)
    expect(fc(r.state, mine)?.damage).toBe(0)
    ok(r.state)
  })

  it('on attacking: the same sweep; with no Backup it deals nothing and fires nothing', () => {
    for (const backups of [2, 0]) {
      let s = endPhase(makeGame()); let zack: CardId; let a: CardId
      ;[s, zack] = withField(s, 0, 'forwards', '27-123S')
      ;[s, a] = withField(s, 1, 'forwards', '27-124S')
      ;[s] = withCp(s, 0, Array<string>(backups).fill(FIRE_BACKUP))
      const r = apply(s, { type: 'declareAttack', player: 0, attackers: [zack] })
      expect(r.events.some((e) => e.type === 'abilityTriggered' && e.abilityId === '27-123S:attack'), `${backups} Backups: the clause triggers`).toBe(true)
      const hits = r.events.filter((e) => e.type === 'abilityDamage')
      expect(hits.map((e) => e.type === 'abilityDamage' && e.amount), `${backups} Backups`).toEqual(backups ? [backups * 1000] : [])
      expect(fc(r.state, a)?.damage).toBe(backups * 1000)
      ok(r.state)
    }
  })
})

describe('27-122S Wuk Lamat — "When Wuk Lamat enters the field or attacks, choose 1 Forward opponent controls. If you control 5 or more Characters, deal it 7000 damage."', () => {
  it('on entering: 7000 with 5 Characters, Wuk Lamat herself one of them; nothing with 4', () => {
    for (const [extra, dealt] of [[1, true], [0, false]] as const) {
      let s = makeGame(); let victim: CardId
      ;[s, victim] = withField(s, 1, 'forwards', '27-124S')   // Cloud, 7000
      for (let i = 0; i < extra; i++) [s] = withField(s, 0, 'forwards', '21-001R')
      const r = cast(s, '27-122S', Array<string>(3).fill(FIRE_BACKUP))   // Wuk Lamat + 3 Backups (+ the extra)
      expect(r.state.pending).toEqual({ kind: 'chooseTargets', player: 0, min: 1, max: 1, candidates: [victim] })
      const t = apply(r.state, { type: 'chooseTargets', player: 0, targets: [victim] })
      expect(fc(t.state, victim) === undefined, `${4 + extra} Characters`).toBe(dealt)
      ok(t.state)
    }
  })

  it('on attacking: the same, declared as the clause is placed in the declared window', () => {
    let s = endPhase(makeGame()); let wuk: CardId; let victim: CardId
    ;[s, wuk] = withField(s, 0, 'forwards', '27-122S')
    ;[s, victim] = withField(s, 1, 'forwards', '27-124S')
    ;[s] = withCp(s, 0, Array<string>(4).fill(FIRE_BACKUP))
    const r = apply(s, { type: 'declareAttack', player: 0, attackers: [wuk] })
    expect(r.state.pending).toEqual({ kind: 'chooseTargets', player: 0, min: 1, max: 1, candidates: [victim] })
    const t = apply(r.state, { type: 'chooseTargets', player: 0, targets: [victim] })
    expect(fc(t.state, victim)).toBeUndefined()
    ok(t.state)
  })

  it('still warns for its clause 1 (rung V2): the cast reports exactly one clause missing', () => {
    const r = cast(makeGame(), '27-122S', Array<string>(3).fill(FIRE_BACKUP))
    expect(r.events.filter((e) => e.type === 'unimplementedAbility').map((e) => e.type === 'unimplementedAbility' && e.clauses)).toEqual([1])
  })
})

describe('27-128S Charlotte — "The Forwards opponent controls cannot use action abilities."', () => {
  it('bans the opponent\u2019s Forwards\u2019 action abilities, not their special abilities, and not her own side\u2019s', () => {
    let s = makeGame(); let princess: CardId; let jecht: CardId
    ;[s] = withField(s, 1, 'forwards', '27-128S')                // Charlotte, on player 1's side
    ;[s, princess] = withField(s, 0, 'forwards', '19-052C')     // an action ability on player 0's Forward
    ;[s] = withField(s, 0, 'forwards', '21-001R')               // a second Forward, so the Princess's pump has a target
    ;[s, jecht] = withField(s, 0, 'forwards', '18-129C')        // and a special ability
    ;[s] = withHand(s, 0, '18-129C')
    expect(offered(s, 0, princess, '19-052C:pump'), 'an action ability of an opponent\u2019s Forward').toEqual([])
    expect(offered(s, 0, jecht, '18-129C:jecht-beam').length, 'a special ability is not an action ability (§11.6 vs §11.7)').toBeGreaterThan(0)
    let theirs: CardId
    ;[s, theirs] = withField(s, 1, 'forwards', '19-052C')
    const handed = apply(s, { type: 'pass', player: 0 }).state
    expect(offered(handed, 1, theirs, '19-052C:pump').length, 'Charlotte\u2019s own side is not banned').toBeGreaterThan(0)
  })

  it('still warns for its clause 1 (rung V2); clause 2 is inert, so exactly one clause is reported', () => {
    const r = cast(makeGame(), '27-128S', Array<string>(4).fill(WATER_BACKUP))
    expect(r.events.filter((e) => e.type === 'unimplementedAbility').map((e) => e.type === 'unimplementedAbility' && e.clauses)).toEqual([1])
  })
})

describe('11-121C Porom — "When Porom enters the field, discard 1 card from your hand. If the discarded card is not a Category IV card, draw 1 card. …"', () => {
  function castPorom(handCodes: string[]) {
    let s = makeGame(); const hand: CardId[] = []
    for (const code of handCodes) { let id: CardId; [s, id] = withHand(s, 0, code); hand.push(id) }
    const r = cast(s, '11-121C', [WATER_BACKUP, WATER_BACKUP])
    return { r, hand }
  }

  it('the discard is a select over its controller\u2019s own hand, hidden from the other seat', () => {
    const { r, hand } = castPorom(['21-001R', '13-013C'])
    expect(r.state.pending).toEqual({ kind: 'chooseTargets', player: 0, min: 1, max: 1, candidates: hand })
    const other = JSON.stringify(viewFor(r.state, 1).pending)
    for (const id of hand) expect(other, 'no hand id in the opposing view').not.toContain(String(id))
  })

  it('a card that is not Category IV: discard it, draw 1', () => {
    const { r, hand } = castPorom(['21-001R', '13-013C'])
    const t = apply(r.state, { type: 'chooseTargets', player: 0, targets: [hand[0]!] })   // Ward, VIII
    expect(t.state.players[0].breakZone).toContain(hand[0])
    expect(t.state.players[0].hand.length, '2 − 1 + 1').toBe(2)
    expect(t.state.pending).toBeNull()
    ok(t.state)
  })

  it('a Category IV card: discard it, draw 2, then discard 1 more — a second select over the hand', () => {
    const { r, hand } = castPorom(['21-001R', '13-013C'])
    const t = apply(r.state, { type: 'chooseTargets', player: 0, targets: [hand[1]!] })   // Palom, PICTLOGICA · IV
    expect(t.state.players[0].hand.length, '2 − 1 + 2').toBe(3)
    expect(t.state.pending).toEqual({ kind: 'chooseTargets', player: 0, min: 1, max: 1, candidates: t.state.players[0].hand })
    const other = JSON.stringify(viewFor(t.state, 1))
    for (const id of t.state.players[0].hand) expect(other, 'the nested select leaks no hand id (plan R7)').not.toContain(`"candidates":[${id}`)
    const done = apply(t.state, { type: 'chooseTargets', player: 0, targets: [hand[0]!] })
    expect(done.state.players[0].hand.length).toBe(2)
    expect(done.state.players[0].breakZone).toEqual(expect.arrayContaining([hand[0], hand[1]]))
    ok(done.state)
  })

  it('with an empty hand there is nothing to discard: no prompt and no draw', () => {
    const { r } = castPorom([])
    expect(r.state.pending).toBeNull()
    expect(r.state.players[0].hand).toEqual([])
    expect(r.events.some((e) => e.type === 'drew')).toBe(false)
  })

  it('still warns for its clause 2 (rung V2)', () => {
    const { r } = castPorom([])
    expect(r.events.filter((e) => e.type === 'unimplementedAbility').map((e) => e.type === 'unimplementedAbility' && e.clauses)).toEqual([1])
  })
})

describe('13-125R Yuzuki — both clauses are damage replacements (rung V2)', () => {
  it('implements nothing yet and says so at cast (a card with no clause implemented reports no count)', () => {
    expect(def('13-125R').abilities ?? []).toEqual([])
    expect(def('13-125R').abilityClauses).toBe(2)
    const r = cast(makeGame(), '13-125R', [WATER_BACKUP, FIRE_BACKUP, FIRE_BACKUP])
    expect(r.events.filter((e) => e.type === 'unimplementedAbility')).toEqual([{ type: 'unimplementedAbility', card: r.card, code: '13-125R' }])
  })
})
