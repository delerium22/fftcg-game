import { describe, expect, it } from 'vitest'
import { findFieldCard, forget, keywordsOf, knows, learn, powerOf, type CardId } from '../src/state.js'
import { viewFor } from '../src/view.js'
import { makeGame, withField, VANILLA_POOL } from './helpers.js'
import { checkInvariants } from '../src/invariants.js'
import type { Ability } from '../src/abilities.js'
import type { GameState } from '../src/state.js'

describe('state helpers', () => {
  it('findFieldCard locates a forward and a backup', () => {
    let s = makeGame()
    let f: number, b: number
    ;[s, f] = withField(s, 0, 'forwards', 'V-F2')
    ;[s, b] = withField(s, 1, 'backups', 'V-B1')
    expect(findFieldCard(s, f)).toMatchObject({ owner: 0, zone: 'forwards' })
    expect(findFieldCard(s, b)).toMatchObject({ owner: 1, zone: 'backups' })
    expect(findFieldCard(s, 9999)).toBeNull()
  })
  it('powerOf and keywordsOf read def plus granted', () => {
    let s = makeGame(); let f: number
    ;[s, f] = withField(s, 0, 'forwards', 'V-F2', { granted: ['haste'] })
    const fc = findFieldCard(s, f)!.card
    expect(powerOf(s, fc)).toBe(5000)
    expect(keywordsOf(s, fc)).toEqual(new Set(['haste']))
  })
})

// ---------------------------------------------------------------------------
// Rung C9 stage 1 — the knowledge mask
// ---------------------------------------------------------------------------

describe('knownBy: who knows what a hidden card is (spec C9-5)', () => {
  const game = () => makeGame()

  it('nobody knows anything until told', () => {
    const s = game()
    const id = s.players[0].deck[0] as CardId
    expect(knows(s, 0, id)).toBe(false)
    expect(knows(s, 1, id)).toBe(false)
    expect(s.knownBy).toEqual({})
  })

  it('learning is per player, and additive', () => {
    let s = game()
    const [a, b] = [s.players[0].deck[0] as CardId, s.players[0].deck[1] as CardId]
    s = learn(s, [0], [a, b])
    expect(knows(s, 0, a)).toBe(true)
    expect(knows(s, 1, a)).toBe(false)   // a PRIVATE look tells the opponent nothing
    s = learn(s, [1], [a])
    expect(knows(s, 0, a)).toBe(true)    // and does not overwrite what player 0 knew
    expect(knows(s, 1, a)).toBe(true)
    expect(knows(s, 1, b)).toBe(false)
  })

  it('a public reveal tells both at once', () => {
    let s = game()
    const id = s.players[0].deck[0] as CardId
    s = learn(s, [0, 1], [id])
    expect(knows(s, 0, id)).toBe(true)
    expect(knows(s, 1, id)).toBe(true)
  })

  it('knowledge SURVIVES the card moving — that is the whole point of the mask', () => {
    // Reeve looks at three and bottoms two. Its controller still knows what is down there, and no zone
    // records that. A per-zone flag could not express it; this is why the mask is per card.
    let s = game()
    const id = s.players[0].deck[0] as CardId
    s = learn(s, [0], [id])
    const ps = s.players[0]
    const players = [s.players[0], s.players[1]] as typeof s.players
    players[0] = { ...ps, deck: [...ps.deck.slice(1), id] }   // moved to the bottom
    s = { ...s, players }
    expect(knows(s, 0, id)).toBe(true)
  })

  it('a shuffle forgets it (§8.1.2)', () => {
    let s = game()
    const id = s.players[0].deck[0] as CardId
    s = learn(s, [0, 1], [id])
    s = forget(s, [id])
    expect(knows(s, 0, id)).toBe(false)
    expect(knows(s, 1, id)).toBe(false)
  })

  it('the view carries a mask only for cards it can SEE', () => {
    // A mask keyed by an id the viewer cannot see would be an id leak by itself.
    let s = game()
    const hidden = s.players[1].deck[0] as CardId       // opponent's deck, known only to THEM
    const visible = s.players[0].hand[0] as CardId      // player 0's own hand
    s = learn(s, [1], [hidden])
    s = learn(s, [0, 1], [visible])

    const v = viewFor(s, 0)
    expect(v.knownBy[visible]).toBeDefined()
    expect(v.knownBy[hidden]).toBeUndefined()
    expect(Object.keys(v.knownBy).every((k) => v.cards[Number(k)] !== undefined)).toBe(true)
  })
})

describe('checkInvariants catches the C10 bookkeeping it was added for', () => {
  /**
   * These branches are only reachable from a CORRUPT state, so every other test — which passes clean states —
   * leaves them deletable. Codex's C10 code review flagged exactly that: an invariant with no negative test
   * is an invariant that can be removed without anything going red.
   */
  const ONCE: Ability = {
    id: 'V-F1:once',
    trigger: { kind: 'activated', sourceZone: 'field', cost: {}, oncePerTurn: true },
    text: '[0]: nothing, once per turn.',
    effects: [],
  }
  const POOL = VANILLA_POOL.map((d) => (d.code === 'V-F1' ? { ...d, abilities: [ONCE] } : d))

  /** A clean state with one V-F1 on P0's field and one card in P0's Break Zone. */
  function fixture(): { s: GameState; card: CardId; inBz: CardId } {
    let s = makeGame({ defs: POOL })
    let card: CardId
    ;[s, card] = withField(s, 0, 'forwards', 'V-F1')
    const inBz = s.players[0].deck[0] as CardId
    const p0 = s.players[0]
    s = { ...s, players: [{ ...p0, deck: p0.deck.slice(1), breakZone: [...p0.breakZone, inBz] }, s.players[1]] }
    expect(checkInvariants(s), 'the fixture was not clean to begin with').toEqual([])
    return { s, card, inBz }
  }

  const withP0 = (s: GameState, over: Partial<GameState['players'][0]>): GameState =>
    ({ ...s, players: [{ ...s.players[0], ...over }, s.players[1]] })

  it('a tracked Break Zone arrival that is not in the Break Zone', () => {
    const { s } = fixture()
    const stray = s.players[0].deck[0] as CardId
    expect(checkInvariants(withP0(s, { putIntoBreakZoneFromFieldThisTurn: [stray] })))
      .toEqual([`card ${stray} is recorded as put into P0's Break Zone this turn but is not in it`])
  })

  it('a duplicated Break Zone arrival', () => {
    const { s, inBz } = fixture()
    expect(checkInvariants(withP0(s, { putIntoBreakZoneFromFieldThisTurn: [inBz, inBz] })))
      .toContain('P0 recorded a duplicate Break Zone arrival')
  })

  it('a duplicated per-turn ability use', () => {
    const { s, card } = fixture()
    const dup = withP0(s, { forwards: s.players[0].forwards.map((c) => (c.id === card ? { ...c, usedThisTurn: ['V-F1:once', 'V-F1:once'] } : c)) })
    expect(checkInvariants(dup)).toContain(`card ${card} in P0 forwards used an ability twice in one turn`)
  })

  it('a per-turn marker naming an ability the card does not have', () => {
    const { s, card } = fixture()
    const bogus = withP0(s, { forwards: s.players[0].forwards.map((c) => (c.id === card ? { ...c, usedThisTurn: ['V-F1:nonexistent'] } : c)) })
    expect(checkInvariants(bogus)).toContain(`card ${card} in P0 forwards recorded unknown ability V-F1:nonexistent as used`)
  })
})
