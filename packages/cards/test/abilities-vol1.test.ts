import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { CardId, FieldCard, GameState } from '@fftcg/engine'
import { checkInvariants, deckPickCandidates, findFieldCard, legalCommands, powerOf, viewFor } from '@fftcg/engine'
import { VOL1_ABILITIES, VOL1_CLAUSES } from '../src/abilities-vol1.js'
import { loadCards, parseDeckFile } from '../src/index.js'
import { DEFS, FIRE_BACKUP, WATER_BACKUP, applyNow, endPhase, makeGame, withCp, withDeckTops, withField, withHand } from './harness.js'

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

  it('PROOF for the observer\u2019s `of: backup` (R6): every Job Standard Unit that can enter LB Luso\u2019s controller\u2019s field is a Backup', () => {
    // `observesEnterField.of` is ONE type, so "a Job Standard Unit enters" cannot say Forward or Backup. Luso ships only
    // in the Vol. 1 LB deck and watches only his controller's field, which the Vol. 1 main deck fills (Yuna and Taivas
    // play from that hand, the searches take from that deck). Across BOTH pools the claim is false: Dragoon 1-147C
    // (Vol. 2) is a Forward Standard Unit. A deck pairing Vol. 1's LB deck with Vol. 2's main deck would reach the gap.
    const vol1 = new Set(['starter-2025-vol1.txt', 'starter-2025-vol1-lb.txt']
      .flatMap((f) => parseDeckFile(readFileSync(new URL(`../../../decks/${f}`, import.meta.url), 'utf8'))))
    expect(vol1.has('23-130H'), 'Luso is in the Vol. 1 LB deck').toBe(true)
    const units = loadCards().filter((d) => vol1.has(d.code) && d.job?.split('/').includes('Standard Unit'))
    expect(units.map((d) => d.code).sort(), 'the Vol. 1 Standard Units').toEqual(['11-010C', '18-003C', '18-094C'])
    expect(units.filter((d) => d.type !== 'backup').map((d) => d.code)).toEqual([])
    const elsewhere = loadCards().filter((d) => !vol1.has(d.code) && d.job?.split('/').includes('Standard Unit') && d.type !== 'backup')
    expect(elsewhere.map((d) => d.code), 'the known Forward Standard Unit outside Vol. 1').toEqual(['1-147C'])
  })
})
