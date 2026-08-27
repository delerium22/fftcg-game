import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { RandomAgent, type Agent } from '@fftcg/ai'
import { loadCards } from '@fftcg/cards'
import type { Command, PlayerView } from '@fftcg/engine'
import { parseDeckFile } from '../src/deck.js'
import { mirrorTournament, pairedBootstrapCi, type MirrorReport } from '../src/mirror.js'
import { newGameStats, playGame, readSearchCounters, selfPlay } from '../src/selfplay.js'

const deck = (): string[] => parseDeckFile(readFileSync(new URL('../../../decks/starter-2025-vol2.txt', import.meta.url), 'utf8'))
const decks = (): [string[], string[]] => { const d = deck(); return [d, d] }

describe('self-play with the real Vol. 2 pool', () => {
  it('20 random games complete without engine errors', () => {
    const r = selfPlay({ games: 20, seed: 100, decks: decks(), defs: loadCards() })
    expect(r.failures).toEqual([])
    expect(r.completed).toBe(20)
    expect(r.wins[0] + r.wins[1] + r.draws).toBe(20)
    expect(r.unimplementedAbilities).toBeGreaterThan(0)   // proves the warning path fires on real cards
    expect(r.agents).toEqual(['random', 'random'])
    expect(r.search).toEqual([null, null])                // D-A4: no search ran, so no counters — not zeros
  })

  it('greedy beats random decisively (30 games, depth 1, both seats)', () => {
    const a = selfPlay({ games: 15, seed: 500, decks: decks(), defs: loadCards(), agents: [{ kind: 'greedy' }, { kind: 'random' }], strict: false })
    const b = selfPlay({ games: 15, seed: 600, decks: decks(), defs: loadCards(), agents: [{ kind: 'random' }, { kind: 'greedy' }], strict: false })
    expect(a.failures).toEqual([]); expect(b.failures).toEqual([])
    expect(a.wins[0] + b.wins[1]).toBeGreaterThanOrEqual(21)          // ≥ 70 % of 30
    expect(Math.max(a.msPerDecision[0], b.msPerDecision[1])).toBeLessThan(80)   // spec A8 says < 50 ms average; 80 leaves CI headroom — the CLI run reports the real figure
    expect(a.decisions[0]).toBeGreaterThan(0); expect(b.decisions[1]).toBeGreaterThan(0)
    expect(a.msPerDecision[0]).toBeGreaterThan(0); expect(b.msPerDecision[1]).toBeGreaterThan(0)   // guards against a broken timer/counter passing vacuously
  }, 180_000)

  it('greedy vs greedy terminates', () => {
    const r = selfPlay({ games: 5, seed: 700, decks: decks(), defs: loadCards(), agents: [{ kind: 'greedy' }, { kind: 'greedy' }], strict: false })
    expect(r.failures).toEqual([]); expect(r.completed).toBe(5)
  }, 180_000)

  it('W5: 5 greedy-vs-greedy games under strict (invariants/mutation/dead-end checks) complete without engine errors', () => {
    const r = selfPlay({ games: 5, seed: 800, decks: decks(), defs: loadCards(), agents: [{ kind: 'greedy' }, { kind: 'greedy' }], strict: true })
    expect(r.failures).toEqual([]); expect(r.completed).toBe(5)
  }, 180_000)
})

// ---------------------------------------------------------------------------
// D-A4: search cost counters
// ---------------------------------------------------------------------------

const DIAG = { determinisations: 1, treeApplies: 2, rolloutApplies: 3, evaluations: 4, nodes: 5, maxCommandDepth: 6, rootChildren: [] as unknown[] }

/** A `RandomAgent` that also publishes search diagnostics, so the accumulation path can be exercised without
 *  depending on the search lane's timing or on real ISMCTS cost. `maxCommandDepth` rises every decision, which
 *  is what makes "summed a depth instead of maxing it" visible. */
class CountingAgent implements Agent {
  readonly needsLegalCommands = true
  decisions = 0
  lastDiagnostics = { ...DIAG, maxCommandDepth: 0 }
  private readonly inner: RandomAgent
  constructor(seed: number) { this.inner = new RandomAgent(seed) }
  decide(view: PlayerView, legal: Command[]): Command {
    this.decisions++
    this.lastDiagnostics = { ...DIAG, maxCommandDepth: this.decisions }
    return this.inner.decide(view, legal)
  }
}

describe('readSearchCounters', () => {
  it('returns null for an agent that publishes nothing', () => {
    expect(readSearchCounters(new RandomAgent(1))).toBeNull()
  })
  it('reads a complete diagnostics object', () => {
    const agent = new CountingAgent(1)
    expect(readSearchCounters(agent)).toEqual({ determinisations: 1, treeApplies: 2, rolloutApplies: 3, evaluations: 4, nodes: 5, maxCommandDepth: 0 })
  })
  it('accepts the `diagnostics` spelling as well as `lastDiagnostics`', () => {
    const agent = Object.assign(new RandomAgent(1), { diagnostics: { ...DIAG } })
    expect(readSearchCounters(agent)?.nodes).toBe(5)
  })
  // The point of the whole reader: a renamed or dropped counter must surface as "no data", never as a zero
  // that reads like "the search did no work". A silently-zeroed cost report is exactly the defect that would
  // let D2 pick a browser budget from a number that means nothing.
  it('returns null when a counter is missing, non-numeric or NaN', () => {
    for (const broken of [
      { ...DIAG, nodes: undefined },
      { ...DIAG, treeApplies: '7' },
      { ...DIAG, evaluations: Number.NaN },
      { ...DIAG, maxCommandDepth: Number.POSITIVE_INFINITY },
      {},
      null,
    ]) {
      const agent = Object.assign(new RandomAgent(1), { lastDiagnostics: broken })
      expect(readSearchCounters(agent), JSON.stringify(broken)).toBeNull()
    }
  })
})

describe('playGame accumulates search cost per seat', () => {
  it('sums the counters and MAXES the depth', () => {
    const agents = [new CountingAgent(11), new CountingAgent(12)] as const
    const stats = newGameStats()
    // seed 100 is inside the range the 20-random-game test above already proves terminates
    playGame({ seed: 100, decks: decks(), defs: loadCards(), agents, maxCommands: 2000, strict: false }, stats)
    for (const seat of [0, 1] as const) {
      const cost = stats.search[seat]
      expect(cost).not.toBeNull()
      const n = stats.decisions[seat]
      expect(n).toBeGreaterThan(1)
      expect(cost?.decisions).toBe(n)
      expect(cost?.determinisations).toBe(n)          // 1 per decision
      expect(cost?.treeApplies).toBe(2 * n)           // 2 per decision
      expect(cost?.maxCommandDepth).toBe(n)           // the LAST (largest) depth, not the sum
      expect(cost?.maxCommandDepth).toBeLessThan((n * (n + 1)) / 2)
    }
  }, 60_000)
})

describe('D-A4: the report carries the real search agent counters', () => {
  it('reports ismcts cost for its own seat and nothing for the other', () => {
    const r = selfPlay({ games: 1, seed: 340, decks: decks(), defs: loadCards(), agents: [{ kind: 'ismcts', iterations: 8 }, { kind: 'greedy' }], strict: false })
    expect(r.failures).toEqual([])
    const cost = r.search[0]
    expect(cost).not.toBeNull()
    expect(r.search[1]).toBeNull()                                    // greedy publishes none — null, not zeros
    // One determinisation per iteration is the search's own contract; anything else means the counter and the
    // loop have drifted apart, and every ms/decision extrapolation D2 makes from this report is then wrong.
    expect(cost?.decisions).toBe(r.decisions[0])
    expect(cost?.determinisations).toBe(8 * (cost?.decisions ?? 0))
    expect(cost?.nodes).toBeGreaterThan(0)
    expect(cost?.rolloutApplies).toBeGreaterThan(0)
    expect(cost?.maxCommandDepth).toBeGreaterThan(0)
    expect(r.msPerDecision[0]).toBeGreaterThan(0)
  }, 120_000)
})

// ---------------------------------------------------------------------------
// D-A1: the mirrored tournament
// ---------------------------------------------------------------------------

describe('pairedBootstrapCi', () => {
  it('collapses to the point when every pair agrees', () => {
    expect(pairedBootstrapCi([1, 1, 1, 1], 200, 7)).toEqual([1, 1])
    expect(pairedBootstrapCi([0.5, 0.5, 0.5], 200, 7)).toEqual([0.5, 0.5])
    expect(pairedBootstrapCi([0, 0, 0], 200, 7)).toEqual([0, 0])
  })
  it('is deterministic for a given seed and varies with the seed', () => {
    const scores = [1, 0.5, 0, 1, 0.5, 1, 0, 0.5, 1, 1]
    expect(pairedBootstrapCi(scores, 500, 1)).toEqual(pairedBootstrapCi(scores, 500, 1))
    expect(pairedBootstrapCi(scores, 500, 1)).not.toEqual(pairedBootstrapCi(scores, 500, 2))
  })
  it('brackets the sample mean and stays inside the data range', () => {
    const scores = [1, 0.5, 0, 1, 0.5, 1, 0, 0.5, 1, 1]
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length
    const [lo, hi] = pairedBootstrapCi(scores, 2000, 3)
    expect(lo).toBeLessThanOrEqual(mean)
    expect(hi).toBeGreaterThanOrEqual(mean)
    expect(lo).toBeGreaterThanOrEqual(Math.min(...scores))
    expect(hi).toBeLessThanOrEqual(Math.max(...scores))
  })
  it('narrows as pairs are added — a wide interval from more data would mean the resampling unit is wrong', () => {
    const few = Array.from({ length: 10 }, (_, i) => (i % 4 === 0 ? 0 : 1))
    const many = Array.from({ length: 200 }, (_, i) => (i % 4 === 0 ? 0 : 1))
    const w = (ci: [number, number]) => ci[1] - ci[0]
    expect(w(pairedBootstrapCi(many, 2000, 5))).toBeLessThan(w(pairedBootstrapCi(few, 2000, 5)))
  })
  it('rejects an empty sample and a nonsense sample count', () => {
    expect(() => pairedBootstrapCi([], 100, 1)).toThrow()
    expect(() => pairedBootstrapCi([1], 0, 1)).toThrow()
    expect(() => pairedBootstrapCi([1], 1.5, 1)).toThrow()
  })
})

/** Timing is wall-clock, so it can never take part in an equality comparison. */
const stripTiming = (r: MirrorReport) => ({ ...r, msPerDecision: [0, 0] as [number, number] })

describe('mirrorTournament', () => {
  it('plays every seed twice, once in each seat', () => {
    const r = mirrorTournament({ pairs: 3, seed: 300, decks: decks(), defs: loadCards(), agents: [{ kind: 'random' }, { kind: 'random' }], strict: false, bootstrapSamples: 200 })
    expect(r.games).toBe(6)
    expect(r.results).toHaveLength(6)
    for (const seed of [300, 301, 302]) {
      const pair = r.results.filter((g) => g.seed === seed)
      expect(pair.map((g) => g.seatOfA).sort()).toEqual([0, 1])
    }
    // The aggregates must be exactly the games: a mis-attributed credit shows up here and nowhere else.
    expect(r.perSeat[0].games + r.perSeat[1].games).toBe(6)
    expect(r.perSeat[0].points + r.perSeat[1].points).toBe(r.points)
    expect(r.record.wins + r.record.draws + r.record.losses).toBe(6)
    expect(r.pointScore).toBe(r.points / 6)
    expect(r.seatBias).toBeCloseTo(r.perSeat[0].points / 3 - r.perSeat[1].points / 3, 12)
    expect(r.agents).toEqual(['random', 'random'])
  }, 60_000)

  it('is deterministic', () => {
    const opts = { pairs: 3, seed: 310, decks: decks(), defs: loadCards(), agents: [{ kind: 'greedy' as const }, { kind: 'random' as const }] as [{ kind: 'greedy' }, { kind: 'random' }], strict: false, bootstrapSamples: 300 }
    expect(stripTiming(mirrorTournament(opts))).toEqual(stripTiming(mirrorTournament(opts)))
  }, 180_000)

  it('charges a harness failure to A as a loss, in both seats', () => {
    // `maxCommands: 1` guarantees "no result after 1 commands" — a harness failure, not a game outcome.
    const r = mirrorTournament({ pairs: 2, seed: 320, decks: decks(), defs: loadCards(), agents: [{ kind: 'random' }, { kind: 'random' }], strict: false, maxCommands: 1, bootstrapSamples: 200 })
    expect(r.failures).toHaveLength(4)
    expect(r.completed).toBe(0)
    expect(r.points).toBe(0)
    expect(r.pointScore).toBe(0)
    expect(r.record.losses).toBe(4)
    expect(r.record.draws).toBe(0)
    expect(r.record.failures).toBe(4)
    expect(r.ci95).toEqual([0, 0])
    // charged to A whichever seat A held — otherwise a crash in one seat would look like a seat effect
    for (const seat of [0, 1] as const) {
      expect(r.perSeat[seat].losses).toBe(2)
      expect(r.perSeat[seat].failures).toBe(2)
    }
    expect(r.seatBias).toBe(0)
    expect(new Set(r.failures.map((f) => f.seatOfA))).toEqual(new Set([0, 1]))
  }, 60_000)

  it('attributes a lopsided matchup to the AGENT, not to a seat', () => {
    const common = { pairs: 6, seed: 330, decks: decks(), defs: loadCards(), strict: false, bootstrapSamples: 1000 }
    const greedyFirst = mirrorTournament({ ...common, agents: [{ kind: 'greedy' }, { kind: 'random' }] })
    const randomFirst = mirrorTournament({ ...common, agents: [{ kind: 'random' }, { kind: 'greedy' }] })
    expect(greedyFirst.failures).toEqual([]); expect(randomFirst.failures).toEqual([])
    expect(greedyFirst.games).toBe(12); expect(randomFirst.games).toBe(12)

    // greedy is the agent under test: near 100 %, with the lower bound clear of the 50 % gate line (D-A1)
    expect(greedyFirst.pointScore).toBeGreaterThanOrEqual(0.85)
    expect(greedyFirst.ci95[0]).toBeGreaterThan(0.5)
    expect(greedyFirst.ci95[1]).toBeLessThanOrEqual(1)

    // Same 12 games, A and B swapped: the score must invert. If the harness were reporting SEAT 0 rather than
    // agent A, both runs would report roughly the same number.
    // (not exactly `1 - greedyFirst.pointScore`: agent seeds are keyed on the A/B slot, so swapping the specs
    // also swaps which RNG stream each agent draws from — the two runs are different games, not one mirrored.)
    expect(randomFirst.pointScore).toBeLessThanOrEqual(0.15)
    expect(randomFirst.ci95[1]).toBeLessThan(0.5)

    // Both seats were played and greedy won from both, so the result cannot be a seat artefact.
    expect(greedyFirst.perSeat[0].points + greedyFirst.perSeat[1].points).toBe(greedyFirst.points)
    expect(greedyFirst.perSeat[0].wins).toBeGreaterThan(0)
    expect(greedyFirst.perSeat[1].wins).toBeGreaterThan(0)

    // D-A4 plumbing: neither agent searches, so there is no cost report to fabricate.
    expect(greedyFirst.search).toEqual([null, null])
    expect(greedyFirst.decisions[0]).toBeGreaterThan(0)
    expect(greedyFirst.msPerDecision[0]).toBeGreaterThan(0)
  }, 300_000)
})
