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
  it('implements every printed clause of every card', () => {
    const short = loadCards()
      .map((d) => ({ code: d.code, name: d.name, missing: unimplementedClauseCount(d) }))
      .filter((r) => r.missing > 0)
    expect(short, 'a card prints clauses this build does not implement — the details panel will now caveat it, and the log warns at cast time').toEqual([])
  })

  it('has cards to check in the first place', () => {
    // Without this, deleting the pool would make the invariant above pass over an empty list. An invariant
    // that holds vacuously is the same defect as a negative test that does not contain the thing it excludes.
    expect(loadCards().length).toBeGreaterThan(10)
  })
})
