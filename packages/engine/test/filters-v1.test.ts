import { describe, expect, it } from 'vitest'
import type { Ability, Effect } from '../src/abilities.js'
import type { CardDef } from '../src/types.js'
import type { CardId, GameState } from '../src/state.js'
import { apply } from '../src/apply.js'
import { deckPickCandidates, matchesDefFilter } from '../src/resolve.js'
import { determinise } from '../src/determinise.js'
import { viewFor } from '../src/view.js'
import { seedRng } from '../src/rng.js'
import { validateContinuousStatics, validateEffects } from '../src/setup.js'
import { deckOf, makeDef, makeGame, VANILLA_POOL, withField, withHand } from './helpers.js'

/**
 * Rung V1-A3 (spec V1-D12): the filter vocabulary the Vol. 1 pool adds — `anyOf` (Leonora's "Card Name Palom or Card
 * Name Porom", Taivas's "Job Warrior or Card Name Warrior"), multi-job cards (SE writes them `"Princess/Warrior"`), and
 * Luso's "of the same Element as the chosen Character", which the executor resolves into a concrete `elementIn`
 * before anything filters, so the pending a search carries is the same question in every determinised world.
 */

const FREE = { dullBackups: [], discards: [] }
const pass = (s: GameState, p: 0 | 1): GameState => apply(s, { type: 'pass', player: p }).state

describe('V1-A3 — anyOf and multi-job, read off the printing', () => {
  const card = (name: string, job?: string): CardDef => makeDef({ code: `T-${name}`, name, ...(job === undefined ? {} : { job }) })

  it('L1 §5.2.2 — anyOf matches a card that satisfies at least one member, and nothing else', () => {
    const f = { anyOf: [{ name: 'Palom' }, { name: 'Porom' }] }
    expect(matchesDefFilter(card('Palom'), f)).toBe(true)
    expect(matchesDefFilter(card('Porom'), f)).toBe(true)
    expect(matchesDefFilter(card('Tellah'), f)).toBe(false)
    expect(matchesDefFilter(card('Palom'), { anyOf: [] }), 'no member, no match').toBe(false)
    expect(matchesDefFilter(card('Palom'), { type: 'backup', anyOf: [{ name: 'Palom' }] }), 'anyOf conjoins with the other axes').toBe(false)
  })

  it('L1 §6.6.2 — a job filter matches one of the jobs a multi-job card prints, never a longer job that contains it', () => {
    expect(matchesDefFilter(card('Wuk Lamat', 'Princess/Warrior'), { job: 'Warrior' })).toBe(true)
    expect(matchesDefFilter(card('Wuk Lamat', 'Princess/Warrior'), { job: 'Princess' })).toBe(true)
    expect(matchesDefFilter(card('Warrior', 'Warrior'), { job: 'Warrior' })).toBe(true)
    expect(matchesDefFilter(card('Galuf', 'Warrior of Light'), { job: 'Warrior' })).toBe(false)
    expect(matchesDefFilter(card('Galuf', 'Warrior of Light'), { job: 'Warrior of Light' })).toBe(true)
    expect(matchesDefFilter(card('Nobody'), { job: 'Warrior' }), 'an unknown job matches nothing').toBe(false)
  })

  it('L1 §6.6.2 — Taivas: "Job Warrior or Card Name Warrior" over a multi-job card', () => {
    const taivas = { anyOf: [{ job: 'Warrior' }, { name: 'Warrior' }] }
    expect(matchesDefFilter(card('Wuk Lamat', 'Princess/Warrior'), taivas)).toBe(true)
    expect(matchesDefFilter(card('Warrior', 'Standard Unit'), taivas), 'by name').toBe(true)
    expect(matchesDefFilter(card('Galuf', 'Warrior of Light'), taivas)).toBe(false)
  })

  it('L1 §5.2.1.1 — elementIn matches a card with any listed Element; an empty list matches nothing', () => {
    const dual = makeDef({ code: 'T-DUAL', elements: ['fire', 'water'] })
    expect(matchesDefFilter(dual, { elementIn: ['water'] })).toBe(true)
    expect(matchesDefFilter(dual, { elementIn: ['ice', 'fire'] })).toBe(true)
    expect(matchesDefFilter(dual, { elementIn: ['ice'] })).toBe(false)
    expect(matchesDefFilter(dual, { elementIn: [] })).toBe(false)
  })
})

// Luso 23-130H's shape: "choose 1 Character you control. Search for 1 Job Standard Unit of the same Element as the chosen
// Character and add it to your hand." Luso is FIRE here so a resolution that read the source instead would show.
// The min-0 SELECT variant reaches the search with nothing bound: a declared choice of none is skipped at resolution
// (§11.11.2), but a select's `then` runs on zero picks.
const search = (min: number): Effect => ({ kind: 'chooseTargets', min, max: 1, ...(min === 0 ? { select: 'self' as const } : {}), from: { zone: 'forwards', controller: 'self', filter: { excludeSource: true } }, then: [
  { kind: 'lookAtDeck', count: 'all', audience: 'self', take: { min: 0, max: 1, filter: { job: 'Standard Unit', sameElementAsChosen: true } }, to: 'hand', rest: 'shuffle' },
] })
const etb = (id: string, effects: readonly Effect[]): Ability => ({ id, trigger: { kind: 'enterField' }, text: `synthetic ${id}`, effects })
const DEFS: CardDef[] = [
  ...VANILLA_POOL,
  makeDef({ code: 'T-LUSO', elements: ['fire'], cost: 0, power: 5000, hasAbilities: true, abilityClauses: 1, abilities: [etb('T-LUSO:etb', [search(1)])] }),
  makeDef({ code: 'T-LUSO0', elements: ['fire'], cost: 0, power: 5000, hasAbilities: true, abilityClauses: 1, abilities: [etb('T-LUSO0:etb', [search(0)])] }),
  makeDef({ code: 'T-WAT', elements: ['water'], cost: 2, power: 5000 }),
  makeDef({ code: 'T-SUW', elements: ['water'], cost: 2, power: 5000, job: 'Standard Unit' }),
  makeDef({ code: 'T-SUF', elements: ['fire'], cost: 2, power: 5000, job: 'Standard Unit' }),
  makeDef({ code: 'T-SUWF', type: 'backup', elements: ['wind', 'water'], cost: 2, power: null, job: 'Standard Unit' }),
]
const DECK = deckOf(['T-SUW', 'T-SUF', 'T-SUWF', ...VANILLA_POOL.map((d) => d.code)])

/** Cast the Luso-shaped Forward with a Water Forward beside it, choose that Forward (or select none), and resolve. */
function lusoSearch(code: 'T-LUSO' | 'T-LUSO0'): { s: GameState; wat: CardId } {
  let s = makeGame({ defs: DEFS, decks: [DECK, DECK] })
  let wat: CardId, luso: CardId
  ;[s, wat] = withField(s, 0, 'forwards', 'T-WAT')
  ;[s, luso] = withHand(s, 0, code)
  s = apply(s, { type: 'castCharacter', player: 0, card: luso, payment: FREE }).state
  if (code === 'T-LUSO') {
    expect(s.pending?.kind, 'the choice is declared as the clause is placed').toBe('chooseTargets')
    s = apply(s, { type: 'chooseTargets', player: 0, targets: [wat] }).state
    s = pass(pass(s, 0), 1)
  } else {
    s = pass(pass(s, 0), 1)
    expect(s.pending?.kind, 'the select is made as the item resolves').toBe('chooseTargets')
    s = apply(s, { type: 'chooseTargets', player: 0, targets: [] }).state
  }
  return { s, wat }
}

describe('V1-A3 — sameElementAsChosen is resolved by the executor, never read by a filter', () => {
  it('L1 §5.2.1.1 — Luso: with a Water Character chosen the search offers only Water Standard Units, and the pending says so concretely', () => {
    const { s } = lusoSearch('T-LUSO')
    const pending = s.pending
    if (pending?.kind !== 'chooseFromDeck') throw new Error(`expected a deck choice, got ${pending?.kind}`)
    expect(pending.filter).toEqual({ job: 'Standard Unit', elementIn: ['water'] })
    const deck = s.players[0].deck
    const eligible = deckPickCandidates(s, pending)
    expect(eligible.length).toBeGreaterThan(0)
    for (const i of eligible) {
      const def = s.defs[s.cards[deck[i]!]!.code]!
      expect(def.job).toBe('Standard Unit')
      expect(def.elements).toContain('water')
    }
    // Every Water Standard Unit in the deck is offered — the dual Wind/Water Backup included, the Fire one never.
    const water = deck.flatMap((id, i) => (s.cards[id]!.code === 'T-SUW' || s.cards[id]!.code === 'T-SUWF' ? [i] : []))
    expect(eligible).toEqual(water)
  })

  it('L1 §5.2.1.1 — a determinised world asks the same question and gets the same indices (Review Focus 3)', () => {
    const { s } = lusoSearch('T-LUSO')
    const pending = s.pending
    if (pending?.kind !== 'chooseFromDeck') throw new Error('expected a deck choice')
    const live = deckPickCandidates(s, pending)
    // Derived from the state: `withField`/`withHand` mint instances the printed lists do not name.
    const decks = ([0, 1] as const).map((p) => {
      const q = s.players[p]
      return [...q.deck, ...q.hand, ...q.forwards.map((c) => c.id), ...q.backups.map((c) => c.id), ...q.damageZone, ...q.breakZone, ...q.removedFromGame]
        .map((id) => s.cards[id]!.code)
    }) as [string[], string[]]
    for (const seed of [1, 2, 3]) {
      const [det] = determinise({ view: viewFor(s, 0), decks, rng: seedRng(seed) })
      const p = det.pending
      if (p?.kind !== 'chooseFromDeck') throw new Error('the determinised world lost the pending')
      expect(p.filter, 'the pending carries only concrete axes').toEqual({ job: 'Standard Unit', elementIn: ['water'] })
      expect(deckPickCandidates(det, p)).toEqual(live)
    }
  })

  it('L1 §5.2.1.1 — with nothing chosen the search matches nothing: it settles without a prompt', () => {
    const { s } = lusoSearch('T-LUSO0')
    expect(s.pending, 'elementIn [] offers no card, so there is no deck choice').toBeNull()
    expect(s.stack).toEqual([])
  })
})

describe('V1-A3 — game creation admits sameElementAsChosen only where the executor resolves it (R1)', () => {
  const def = (effects: readonly Effect[]): CardDef => makeDef({ code: 'T-X', hasAbilities: true, abilityClauses: 1, abilities: [etb('T-X:etb', effects)] })
  const SAME = { sameElementAsChosen: true } as const
  const look = (filter = SAME): Effect => ({ kind: 'lookAtDeck', count: 'all', audience: 'self', take: { min: 0, max: 1, filter }, to: 'hand', rest: 'shuffle' })
  const choose = (then: readonly Effect[], filter?: typeof SAME, select?: 'self'): Effect => ({ kind: 'chooseTargets', min: 0, max: 1, from: { zone: 'forwards', controller: 'self', ...(filter ? { filter } : {}) }, then, ...(select ? { select } : {}) })

  it('admits a search under a choice, and a select or an `if` under one', () => {
    expect(validateEffects([def([choose([look()])])])).toEqual([])
    expect(validateEffects([def([choose([choose([{ kind: 'dull' }], SAME, 'self')])])])).toEqual([])
    expect(validateEffects([def([choose([{ kind: 'if', when: { kind: 'controlsAtLeast', count: 1, controller: 'self' }, then: [choose([{ kind: 'dull' }], SAME)] }])])])).toEqual([])
  })

  it('refuses it with nothing chosen before it, on a declared choice, on a forEach and in a condition', () => {
    expect(validateEffects([def([look()])]).join()).toMatch(/sameElementAsChosen/)
    expect(validateEffects([def([choose([{ kind: 'dull' }], SAME)])]).join(), 'a head choice is declared, and nothing is chosen yet').toMatch(/sameElementAsChosen/)
    expect(validateEffects([def([choose([choose([{ kind: 'dull' }], SAME)])])]).join(), 'a nested choice is declared at placement too').toMatch(/sameElementAsChosen/)
    expect(validateEffects([def([{ kind: 'forEach', from: { zone: 'forwards', controller: 'self' }, do: [look()] }])]).join(), 'a forEach binding is not a choice').toMatch(/sameElementAsChosen/)
    expect(validateEffects([def([{ kind: 'forEach', from: { zone: 'forwards', controller: 'self', filter: SAME }, do: [{ kind: 'dull' }] }])]).join()).toMatch(/sameElementAsChosen/)
    expect(validateEffects([def([choose([{ kind: 'if', when: { kind: 'subjectMatches', filter: SAME }, then: [{ kind: 'dull' }] }])])]).join()).toMatch(/sameElementAsChosen/)
  })

  it('refuses it inside an anyOf member, which the executor does not resolve (review M1)', () => {
    const nested = { anyOf: [{ name: 'A' }, { sameElementAsChosen: true }] } as unknown as typeof SAME
    expect(validateEffects([def([choose([look(nested)])])]).join()).toMatch(/sameElementAsChosen inside an anyOf member/)
    expect(validateEffects([def([choose([choose([{ kind: 'dull' }], nested, 'self')])])]).join()).toMatch(/sameElementAsChosen inside an anyOf member/)
  })

  it('a continuous scope refuses it, and an instance axis inside an anyOf member', () => {
    // Data arriving through JSON is untyped: parse it, as the card data is, rather than cast a literal past the type.
    const scoped = (filter: object): CardDef => JSON.parse(JSON.stringify(makeDef({ code: 'T-S', hasAbilities: true, abilityClauses: 1, abilities: [
      { id: 'T-S:st', trigger: { kind: 'static', effect: { kind: 'modifyPower', amount: 1000, to: { controller: 'self' } } }, text: 'synthetic', effects: [] },
    ] })).replace('"controller":"self"', `"controller":"self","filter":${JSON.stringify(filter)}`)) as CardDef
    expect(validateContinuousStatics([scoped({ anyOf: [{ name: 'A' }, { job: 'B' }] })])).toEqual([])
    expect(validateContinuousStatics([scoped({ anyOf: [{ name: 'A' }, { minPower: 5000 }] })]).join()).toMatch(/minPower/)
    expect(validateContinuousStatics([scoped({ sameElementAsChosen: true })]).join()).toMatch(/sameElementAsChosen/)
  })
})
