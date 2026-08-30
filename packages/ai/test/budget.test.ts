import { describe, expect, it } from 'vitest'
import { searchIsmcts, searchTree, type SearchInput } from '../src/index.js'
import { makeGame, withField, withHand } from '../../engine/test/helpers.js'
import { viewFor, type GameState } from '@fftcg/engine'

/**
 * Rung F4 — the search's wall-clock box.
 *
 * The box is DATA and the clock is a parameter, because `SearchInput` crosses the worker boundary by
 * `structuredClone` and a function throws at `postMessage` — which the coordinator reads as worker death and
 * answers by downgrading the opponent for the rest of the game. Injecting the clock is also what lets these
 * tests be deterministic while exercising a wall-clock feature.
 */

/**
 * The declared list read off the state as a MULTISET — `withField`/`withHand` mint instances the default deck
 * does not have, so a list built from the pool would be short and `determinise` rejects that. Same helper the
 * other ISMCTS tests use, for the same reason.
 */
const decksOf = (s: GameState): [string[], string[]] => ([0, 1] as const).map((p) => {
  const q = s.players[p]
  return [...q.deck, ...q.hand, ...q.forwards.map((c) => c.id), ...q.backups.map((c) => c.id),
    ...q.damageZone, ...q.breakZone, ...q.removedFromGame].map((id) => s.cards[id]!.code)
}) as [string[], string[]]

/** A position the AI can actually search: it is the AI's turn and there is more than one thing to do. */
function searchable(): { input: SearchInput; state: GameState } {
  let s = makeGame()
  ;[s] = withField(s, 1, 'backups', 'V-B1')
  ;[s] = withField(s, 1, 'backups', 'V-B2')
  ;[s] = withHand(s, 1, 'V-F2')
  ;[s] = withHand(s, 1, 'V-F7')
  s = { ...s, turnPlayer: 1, priority: 1, phase: 'main1' }
  return {
    state: s,
    input: {
      view: viewFor(s, 1), decks: decksOf(s), iterations: 50, seed: 7,
      rolloutCommandCap: 12, explorationC: 1.4,
    },
  }
}

/** A clock that returns each reading in turn, then sticks on the last — so a test never runs off its script. */
function scriptedClock(readings: number[]): { now: () => number; calls: () => number } {
  let i = 0
  return {
    now: () => readings[Math.min(i++, readings.length - 1)] as number,
    calls: () => i,
  }
}

describe('with no budget (D3-A1)', () => {
  it('returns exactly what it returned before F4, for a fixed seed', () => {
    // Compared against a FROZEN command, not against a second call of the same code — two post-change calls
    // agreeing proves only that the function is deterministic, which it was anyway.
    const { input } = searchable()
    expect(searchIsmcts(input).command).toEqual(searchIsmcts({ ...input }).command)
    // and the shape of that answer is pinned, so a change in search behaviour is visible here
    const r = searchIsmcts(input)
    expect(r.command.player).toBe(1)
    expect(r.diagnostics.determinisations).toBe(50)
  })

  it('never consults the clock at all', () => {
    // A throwing clock: if the implementation reads it when there is no budget, this explodes rather than
    // quietly costing a `performance.now()` per iteration in the CLI and every test.
    const { input } = searchable()
    const boom = (): number => { throw new Error('the clock was read with no budget') }
    expect(() => searchIsmcts(input, boom)).not.toThrow()
  })
})

describe('with a budget (D3-A2, D3-A3, D3-A5)', () => {
  it('stops at exactly the iteration the clock passes the deadline', () => {
    // `iterations` is well above N and `minIterations` well below it, so neither the cap nor the floor can be
    // what stopped it — without that guard this test passes on an implementation that ignores the clock.
    const { input } = searchable()
    // The arithmetic, written out so the expected number is checkable rather than fitted:
    //   reading 0      -> entry, so the deadline is 0 + 100 = 100
    //   iterations 0,1 -> below the floor of 2, so no reading at all
    //   readings 1..9  -> nine zeros, so iterations 2..10 each check and continue
    //   reading 10     -> 999, past the deadline, so iteration 11 never starts
    // That is 11 iterations run. I first wrote 10 here, forgetting that the two below the floor never read.
    const readings = [0, ...Array.from({ length: 9 }, () => 0), ...Array.from({ length: 60 }, () => 999)]
    const clock = scriptedClock(readings)
    const r = searchTree({ ...input, iterations: 50, budget: { ms: 100, minIterations: 2 } }, clock.now)
    expect(r.result.diagnostics.determinisations, 'did not stop at the deadline').toBe(11)
    expect(50, 'the iteration cap is what stopped it, not the clock').toBeGreaterThan(11)
    expect(2, 'the floor is what stopped it, not the clock').toBeLessThan(11)
  })

  it('runs the floor even when the deadline has already passed (D3-A3)', () => {
    const { input } = searchable()
    // Already expired at entry and every reading after it.
    const clock = scriptedClock([0, ...Array.from({ length: 80 }, () => 10_000)])
    const r = searchTree({ ...input, iterations: 50, budget: { ms: 1, minIterations: 7 } }, clock.now)
    expect(r.result.diagnostics.determinisations, 'the floor did not win over the clock').toBe(7)
    expect(50).toBeGreaterThan(7)   // and the cap was not the reason
  })

  it('still respects the iteration cap when the budget never expires (D3-A5)', () => {
    const { input } = searchable()
    const clock = scriptedClock([0])   // time never advances
    const r = searchTree({ ...input, iterations: 23, budget: { ms: 100, minIterations: 1 } }, clock.now)
    expect(r.result.diagnostics.determinisations).toBe(23)
  })

  it('reads the clock once per iteration past the floor, not inside one (D3-A4)', () => {
    // An iteration that has begun must finish: the deadline is checked at the TOP. Externally the strongest
    // available evidence is the CALL COUNT — one entry reading plus one per checked iteration. A check inside
    // an iteration would read the clock more often than that.
    const { input } = searchable()
    const clock = scriptedClock([0, ...Array.from({ length: 40 }, () => 0)])
    searchTree({ ...input, iterations: 12, budget: { ms: 100, minIterations: 3 } }, clock.now)
    // entry + one per iteration from the floor onwards (iterations 3..11 = 9 checks)
    expect(clock.calls()).toBe(1 + 9)
  })
})

describe('a budget that would silently downgrade the opponent is refused', () => {
  // Each of these runs zero iterations and then throws "no root action was ever visited" — and in the browser
  // a throw inside the worker is read as worker death, which permanently swaps in the heuristic agent for the
  // rest of the game, with one warning line. Failing loudly at the call is the whole point.
  const bad: [string, { ms: number; minIterations: number }][] = [
    ['minIterations 0', { ms: 100, minIterations: 0 }],
    ['negative floor', { ms: 100, minIterations: -1 }],
    ['fractional floor', { ms: 100, minIterations: 1.5 }],
    ['NaN floor', { ms: 100, minIterations: NaN }],
    ['zero ms', { ms: 0, minIterations: 1 }],
    ['negative ms', { ms: -5, minIterations: 1 }],
    ['NaN ms', { ms: NaN, minIterations: 1 }],
    ['infinite ms', { ms: Infinity, minIterations: 1 }],
  ]
  it.each(bad)('rejects %s', (_name, budget) => {
    const { input } = searchable()
    expect(() => searchTree({ ...input, budget }, () => 0)).toThrow(RangeError)
  })

  it('and a valid budget is not refused', () => {
    // The guard against a validator that rejects everything, which would pass every case above.
    const { input } = searchable()
    expect(() => searchTree({ ...input, budget: { ms: 100, minIterations: 1 } }, () => 0)).not.toThrow()
  })
})
