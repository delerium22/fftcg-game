import { describe, expect, it } from 'vitest'
import { unimplementedClauseCount } from '@fftcg/engine'
import { loadCards } from '../src/index.js'

/**
 * The alarm for rung E3a.
 *
 * The browser's card details panel prints a card's full printed text and, when this build does not implement
 * all of it, says so. That caveat is currently a branch no game can enter: every card in the pool is fully
 * implemented, so `unimplementedClauseCount` returns 0 for all of them and the engine's `unimplementedAbility`
 * event never fires. The panel's caveat is therefore tested against hand-built defs, which is correct — the
 * panel is a pure function of a def — but hand-built tests can only prove the branch WORKS, never whether it
 * is LIVE.
 *
 * This is what tells us. Today it records a fact about the pool. The day a card is added whose text prints a
 * clause the AST does not implement, this fires, and that is the day the panel's caveat starts mattering to
 * a real player rather than to a fixture.
 */
describe('the card pool', () => {
  /**
   * Rung V1-B (plan B-D3, R4): the gaps this build KNOWS about, by card, and nothing else. The Vol. 1 clauses that need
   * damage-modifying replacement effects (spec V1-D4) are finished in rung V2, which empties this table: Wuk Lamat's
   * clause 1, Charlotte's clause 1, Porom's clause 2 and both of Yuzuki's. Exact on purpose — a gap LARGER than listed is
   * an unimplemented clause nobody declared, and a gap SMALLER is a landed clause whose entry was not updated.
   */
  const EXPECTED_GAPS: Record<string, number> = {
    '27-122S': 3, '27-123S': 3, '27-128S': 3, '11-121C': 2, '13-125R': 2, '18-129C': 2,
  }

  it('implements every printed clause of every card, but for the expected gaps', () => {
    const short = Object.fromEntries(loadCards()
      .map((d) => [d.code, unimplementedClauseCount(d)] as const)
      .filter(([, missing]) => missing > 0))
    expect(short, 'a card prints clauses this build does not implement — the details panel will now caveat it, and the log warns at cast time').toEqual(EXPECTED_GAPS)
  })

  it('marks exactly one EX BURST clause on every card that prints one (rung G3)', () => {
    // The guard `exBurstAbility` says exists. It did not: I wrote the comment claiming the pool test asserts
    // this, shipped it, and a code review found the assertion was never added. `exBurstAbility` now refuses to
    // fire on a card whose def does not print EX BURST, and this is the other half — the two must agree.
    //
    // Both directions are defects, and neither shows up in play as an error:
    //   a card printing EX BURST with no marked clause silently loses its burst;
    //   a marked clause on a card that prints none fires a rule the card does not have;
    //   two marked clauses make `find` pick whichever was authored first, silently.
    const wrong = loadCards()
      .map((d) => ({ code: d.code, prints: d.exBurst, marked: (d.abilities ?? []).filter((a) => a.exBurst === true).length }))
      .filter((r) => (r.prints ? r.marked !== 1 : r.marked !== 0))
    expect(wrong, 'a card’s printed EX BURST and its marked clauses disagree').toEqual([])
  })

  it('has EX BURST cards to check, so the rule above is not vacuous', () => {
    // Same reason the count check below exists: an invariant over an empty set proves nothing, and this one
    // would hold perfectly on a pool where nobody had marked anything at all.
    expect(loadCards().filter((d) => d.exBurst).length, 'no card in the pool prints EX BURST').toBeGreaterThan(0)
  })

  it('carries a job and at least one category for every fetched card (rung J5-A1)', () => {
    // The four Starter Vol. 2 exclusives are absent from the SE endpoint and live in a hand-written patch; their
    // job and category are NOT invented, so they are the only cards allowed to lack the fields. A filter on job
    // or category never matches them — this list is what says so.
    const UNKNOWN = new Set(['27-124S', '27-125S', '27-126S', '27-127S'])
    // Summons print a category but no Job (a Job is a Character's); everything else prints both.
    const lacking = loadCards().filter((d) => !UNKNOWN.has(d.code) && ((d.type !== 'summon' && !d.job) || !d.categories?.length)).map((d) => d.code)
    expect(lacking, 'a fetched card lost its job or category — re-run `pnpm --filter @fftcg/cards fetch`').toEqual([])
    const known = loadCards().filter((d) => d.job && d.categories?.length)
    expect(known.length, 'no card carries the fields at all, so the axis has nothing to read').toBeGreaterThan(10)
    expect(known.find((d) => d.code === '18-064C'), 'Geomancer').toMatchObject({ job: 'Standard Unit', categories: ['XI'] })
  })

  it('has cards to check in the first place', () => {
    // Without this, deleting the pool would make the invariant above pass over an empty list. An invariant
    // that holds vacuously is the same defect as a negative test that does not contain the thing it excludes.
    expect(loadCards().length).toBeGreaterThan(10)
  })
})
