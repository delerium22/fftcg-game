import { describe, expect, it } from 'vitest'
import { FILTER_AXES, type TargetFilter } from '../src/abilities.js'
import type { CardDef } from '../src/types.js'
import type { CardId, GameState } from '../src/state.js'
import { matchesDefFilter, targetCandidates } from '../src/resolve.js'
import { makeDef, makeGame, VANILLA_POOL, withField } from './helpers.js'

/**
 * Rung J5 — every `TargetFilter` axis, exercised by NAME from `FILTER_AXES` (spec J5-D3): a new axis without a
 * case here fails this file, and a new key without a home in `FILTER_AXES` fails to compile.
 */

const DRAGOON: CardDef = makeDef({ code: 'T-KAIN', name: 'Kain', job: 'Dragoon', categories: ['IV'], cost: 3, power: 7000, keywords: ['haste'], elements: ['wind'] })
const SOLDIER: CardDef = makeDef({ code: 'T-CLOUD', name: 'Cloud', job: 'SOLDIER', categories: ['VII', 'DFF'], cost: 4, power: 8000, elements: ['earth'] })
const UNKNOWN: CardDef = makeDef({ code: 'T-NOJOB', name: 'Nobody', cost: 1, power: 3000 })   // no job, no categories
const DEFS = [...VANILLA_POOL, DRAGOON, SOLDIER, UNKNOWN]

/** A board with Kain (active, +4000 later), Cloud (dull) and Nobody on player 0's field. */
function board(): { s: GameState; kain: CardId; cloud: CardId; nobody: CardId } {
  let s = makeGame({ defs: DEFS }); let kain: CardId, cloud: CardId, nobody: CardId
  ;[s, kain] = withField(s, 0, 'forwards', 'T-KAIN')
  ;[s, cloud] = withField(s, 0, 'forwards', 'T-CLOUD', { status: 'dull' })
  ;[s, nobody] = withField(s, 0, 'forwards', 'T-NOJOB')
  return { s, kain, cloud, nobody }
}
const pick = (s: GameState, filter: TargetFilter, source: CardId): CardId[] =>
  targetCandidates(s, source, 0, { zone: 'forwards', controller: 'self', filter })

/** One case per axis: a filter that keeps Kain out of {Kain, Cloud, Nobody} in the way the axis means. */
const CASES: Record<keyof TargetFilter, (b: ReturnType<typeof board>) => { filter: TargetFilter; expect: CardId[] }> = {
  type: (b) => ({ filter: { type: 'forward' }, expect: [b.kain, b.cloud, b.nobody] }),
  types: () => ({ filter: { types: ['backup', 'monster'] }, expect: [] }),
  element: (b) => ({ filter: { element: 'wind' }, expect: [b.kain] }),
  cost: (b) => ({ filter: { cost: 4 }, expect: [b.cloud] }),
  maxCost: (b) => ({ filter: { maxCost: 3 }, expect: [b.kain, b.nobody] }),
  job: (b) => ({ filter: { job: 'Dragoon' }, expect: [b.kain] }),
  category: (b) => ({ filter: { category: 'DFF' }, expect: [b.cloud] }),
  name: (b) => ({ filter: { name: 'Cloud' }, expect: [b.cloud] }),
  keyword: (b) => ({ filter: { keyword: 'haste' }, expect: [b.kain] }),
  minPower: (b) => ({ filter: { minPower: 8000 }, expect: [b.cloud] }),
  maxPower: (b) => ({ filter: { maxPower: 3000 }, expect: [b.nobody] }),
  status: (b) => ({ filter: { status: 'dull' }, expect: [b.cloud] }),
  grantedKeyword: () => ({ filter: { grantedKeyword: 'brave' }, expect: [] }),
  excludeSource: (b) => ({ filter: { excludeSource: true }, expect: [b.cloud, b.nobody] }),          // source is Kain
  excludeSourceName: (b) => ({ filter: { excludeSourceName: true }, expect: [b.cloud, b.nobody] }),
  putIntoBreakZoneFromFieldThisTurn: () => ({ filter: { putIntoBreakZoneFromFieldThisTurn: true }, expect: [] }),
  // Rung V1-A3 (spec V1-D12): any member matching is enough; `elementIn` is any of the listed Elements.
  anyOf: (b) => ({ filter: { anyOf: [{ name: 'Cloud' }, { job: 'Dragoon' }] }, expect: [b.kain, b.cloud] }),
  elementIn: (b) => ({ filter: { elementIn: ['earth', 'fire'] }, expect: [b.cloud, b.nobody] }),
  // A `resolved` axis: the executor replaces it before anything filters; asked unresolved, it throws (R1).
  sameElementAsChosen: () => ({ filter: { sameElementAsChosen: true }, expect: [] }),
}

describe('J5-A2 — every axis in FILTER_AXES has a case, and each case selects what the axis means', () => {
  for (const axis of Object.keys(FILTER_AXES) as (keyof TargetFilter)[]) {
    it(`${axis} (${FILTER_AXES[axis]})`, () => {
      const b = board()
      const c = CASES[axis](b)
      if (FILTER_AXES[axis] === 'resolved') {
        // Never fails open (V1-A3 R1): an unresolved axis matching everything would hand a search the whole deck.
        expect(() => pick(b.s, c.filter, b.kain)).toThrow(/sameElementAsChosen/)
        expect(() => matchesDefFilter(DRAGOON, c.filter)).toThrow(/sameElementAsChosen/)
        return
      }
      expect(pick(b.s, c.filter, b.kain)).toEqual(c.expect)
      // A def-only axis must answer the same through `matchesDefFilter`, which is what the search's decoder asks of a view.
      if (FILTER_AXES[axis] === 'def') {
        for (const id of [b.kain, b.cloud, b.nobody]) {
          expect(matchesDefFilter(b.s.defs[b.s.cards[id]!.code]!, c.filter), `${axis} on ${id}`).toBe(c.expect.includes(id))
        }
      }
    })
  }
  it('has a case for every axis and no case for an axis that does not exist', () => {
    expect(Object.keys(CASES).sort()).toEqual(Object.keys(FILTER_AXES).sort())
  })
})

describe('J5-A3 — the instance axes read the field, the def axes read the printing', () => {
  it('maxPower counts a bonus on the field and printed power off it; grantedKeyword sees a granted Haste', () => {
    let { s, kain, cloud } = board()
    expect(pick(s, { maxPower: 7000 }, cloud)).toEqual([kain, ...pick(s, { name: 'Nobody' }, cloud)])
    s = { ...s, players: [{ ...s.players[0], forwards: s.players[0].forwards.map((c) => (c.id === kain ? { ...c, powerBonus: 4000 } : c)) }, s.players[1]] }
    expect(pick(s, { maxPower: 7000 }, cloud), 'Kain is 11000 on the field now').not.toContain(kain)
    expect(matchesDefFilter(DRAGOON, { maxPower: 7000 }), 'off the field the printing is what there is').toBe(true)
    expect(pick(s, { grantedKeyword: 'brave' }, kain)).toEqual([])
    s = { ...s, players: [{ ...s.players[0], forwards: s.players[0].forwards.map((c) => (c.id === cloud ? { ...c, granted: ['brave'] } : c)) }, s.players[1]] }
    expect(pick(s, { grantedKeyword: 'brave' }, kain)).toEqual([cloud])
    expect(pick(s, { grantedKeyword: 'haste' }, cloud), 'a printed keyword counts as granted too').toEqual([kain])
    expect(pick(s, { keyword: 'brave' }, kain), '`keyword` is the printing only').toEqual([])
  })

  it('a card with no known job or category never matches a job or category filter, and matches everything else', () => {
    const { s, nobody, cloud } = board()
    expect(pick(s, { job: 'Standard Unit' }, cloud)).toEqual([])
    expect(pick(s, { category: 'XI' }, cloud)).toEqual([])
    expect(pick(s, { maxCost: 1 }, cloud)).toEqual([nobody])
  })

  it('axes conjoin', () => {
    const { s, kain, cloud } = board()
    expect(pick(s, { job: 'Dragoon', minPower: 8000 }, cloud)).toEqual([])
    expect(pick(s, { job: 'Dragoon', minPower: 7000, element: 'wind' }, cloud)).toEqual([kain])
  })
})
