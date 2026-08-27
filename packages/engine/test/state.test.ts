import { describe, expect, it } from 'vitest'
import { findFieldCard, forget, keywordsOf, knows, learn, powerOf, type CardId } from '../src/state.js'
import { viewFor } from '../src/view.js'
import { makeGame, withField } from './helpers.js'

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
    const hidden = s.players[1].deck[0] as CardId       // opponent's deck: invisible to player 0
    const visible = s.players[0].hand[0] as CardId      // player 0's own hand
    s = learn(s, [0, 1], [hidden, visible])

    const v = viewFor(s, 0)
    expect(v.knownBy[visible]).toBeDefined()
    expect(v.knownBy[hidden]).toBeUndefined()
    expect(Object.keys(v.knownBy).every((k) => v.cards[Number(k)] !== undefined)).toBe(true)
  })
})
