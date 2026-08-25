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
    expect(r.agents).toEqual(['random', 'random'])
  })

  it('greedy beats random decisively (30 games, depth 1, both seats)', () => {
    const deck = parseDeckFile(readFileSync(new URL('../../../decks/starter-2025-vol2.txt', import.meta.url), 'utf8'))
    const a = selfPlay({ games: 15, seed: 500, decks: [deck, deck], defs: loadCards(), agents: [{ kind: 'greedy' }, { kind: 'random' }], strict: false })
    const b = selfPlay({ games: 15, seed: 600, decks: [deck, deck], defs: loadCards(), agents: [{ kind: 'random' }, { kind: 'greedy' }], strict: false })
    expect(a.failures).toEqual([]); expect(b.failures).toEqual([])
    expect(a.wins[0] + b.wins[1]).toBeGreaterThanOrEqual(21)          // ≥ 70 % of 30
    expect(Math.max(a.msPerDecision[0], b.msPerDecision[1])).toBeLessThan(80)   // spec A8 says < 50 ms average; 80 leaves CI headroom — the CLI run reports the real figure
    expect(a.decisions[0]).toBeGreaterThan(0); expect(b.decisions[1]).toBeGreaterThan(0)
    expect(a.msPerDecision[0]).toBeGreaterThan(0); expect(b.msPerDecision[1]).toBeGreaterThan(0)   // guards against a broken timer/counter passing vacuously
  }, 180_000)

  it('greedy vs greedy terminates', () => {
    const deck = parseDeckFile(readFileSync(new URL('../../../decks/starter-2025-vol2.txt', import.meta.url), 'utf8'))
    const r = selfPlay({ games: 5, seed: 700, decks: [deck, deck], defs: loadCards(), agents: [{ kind: 'greedy' }, { kind: 'greedy' }], strict: false })
    expect(r.failures).toEqual([]); expect(r.completed).toBe(5)
  }, 180_000)
})
