import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { loadCards } from '@fftcg/cards'
import { parseDeckFile } from '../src/deck.js'
import { selfPlay } from '../src/selfplay.js'

describe('self-play with the real Vol. 2 pool', () => {
  it('20 random games complete without engine errors', () => {
    const deck = parseDeckFile(readFileSync(new URL('../../../decks/starter-2025-vol2.txt', import.meta.url), 'utf8'))
    const r = selfPlay({ games: 20, seed: 100, decks: [deck, deck], defs: loadCards() })
    expect(r.failures).toEqual([])
    expect(r.completed).toBe(20)
    expect(r.wins[0] + r.wins[1] + r.draws).toBe(20)
    expect(r.unimplementedAbilities).toBeGreaterThan(0)   // proves the warning path fires on real cards
  })
})
