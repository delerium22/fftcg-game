import { describe, expect, it } from 'vitest'
import { unimplementedClauseCount, type Ability, type CardDef } from '../src/index.js'

/**
 * The rule behind the game log's "played as vanilla" warning, and — since rung E3a — behind the browser's
 * card details panel telling the player which printed text this build will not honour. Both consume this
 * one function, so the cases below are what stops the panel and the log telling two stories about one card.
 *
 * Hand-built defs throughout. The current pool cannot exercise any of this: all 18 cards are fully
 * implemented, so `unimplementedClauseCount` returns 0 for every real card. That is what E3a-A7 is for.
 */

const CLAUSE = { id: 'a', text: 'whatever', trigger: { kind: 'onCast' }, effects: [] } as unknown as Ability
const def = (over: Partial<CardDef>): CardDef => ({
  code: 'X-001', name: 'Fixture', type: 'forward', elements: ['fire'], cost: 1,
  power: 1000, keywords: [], generic: false, exBurst: false, text: '', hasAbilities: false,
  ...over,
})

describe('unimplementedClauseCount', () => {
  it('counts a card that prints an ability and implements none of it', () => {
    // No `abilityClauses`, so "unknown" falls back to `hasAbilities ? 1 : 0` — the vanilla-pool shape the
    // log has had since rung A, where the whole card is played as a body with no text.
    expect(unimplementedClauseCount(def({ hasAbilities: true, text: 'Does something.' }))).toBe(1)
  })

  it('counts only the clauses that are neither implemented nor inert', () => {
    expect(unimplementedClauseCount(def({
      hasAbilities: true, abilityClauses: 3, inertClauses: 1, abilities: [CLAUSE],
    }))).toBe(1)
  })

  it('is zero for a fully implemented card', () => {
    expect(unimplementedClauseCount(def({
      hasAbilities: true, abilityClauses: 2, abilities: [CLAUSE, CLAUSE],
    }))).toBe(0)
  })

  it('is zero, not negative, when the AST covers more clauses than the card prints', () => {
    // An AST that splits one printed clause in two. Without the clamp this is -1, and every caller reads
    // "> 0" as "warn the player" — so the sign is what decides whether a lie gets printed.
    expect(unimplementedClauseCount(def({
      hasAbilities: true, abilityClauses: 1, abilities: [CLAUSE, CLAUSE],
    }))).toBe(0)
  })

  it('is zero for a card with no printed abilities at all', () => {
    expect(unimplementedClauseCount(def({ hasAbilities: false }))).toBe(0)
  })
})
