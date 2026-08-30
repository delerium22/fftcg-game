import { describe, expect, it } from 'vitest'
import { actingPlayer, apply, createGame, legalCommands, viewFor, type GameState, type PlayerView } from '@fftcg/engine'
import { CARD_DEFS, DECKS } from '../src/deck.js'
import { searchInputFor, type WorkerInit, type WorkerRequestMessage, type WorkerSearchRequest } from '../src/game/search/protocol.js'
import { SearchCoordinator, type SearchTransport, type TransportHandlers } from '../src/game/search/coordinator.js'
import { AI } from '../src/game/types.js'
import { SEARCH_BUDGET, createAiSearch } from '../src/game/useGame.js'
import { DEFAULT_ITERATIONS } from '@fftcg/ai'

/**
 * Rung F4-A1 — the budget reaches the worker.
 *
 * This test exists because the first version of F4 got it wrong in a way that would have shipped a feature
 * that did nothing. I put the budget on `SearchInput`, reasoning from the comment on that type saying it
 * crosses the boundary by `structuredClone`. **It does not cross.** The coordinator posts a
 * `WorkerSearchRequest`, and the worker rebuilds a `SearchInput` field by field in `searchInputFor`. A budget
 * on `SearchInput` alone is dropped in between, and the browser goes on running every iteration — while a test
 * that clones a locally-built `SearchInput` passes happily.
 *
 * So this asserts the whole path: what the coordinator POSTS, that it survives a real `structuredClone`, and
 * that the worker's translation carries it into the search's input.
 */

/** Records what the coordinator posts, and answers nothing — these tests are about the outbound message. */
function recordingTransport(): { posts: WorkerRequestMessage[]; factory: (h: TransportHandlers) => SearchTransport } {
  const posts: WorkerRequestMessage[] = []
  return {
    posts,
    factory: () => ({ post: (m) => { posts.push(m) }, terminate: () => {} }),
  }
}

/** A state where the AI is actually to move, so the coordinator posts a search at all. */
function aiToMove(): GameState {
  let s: GameState = createGame({ seed: 4, decks: DECKS, defs: CARD_DEFS })
  for (let i = 0; i < 200 && actingPlayer(s) !== AI; i++) {
    const p = actingPlayer(s)
    if (p === null) break
    // Answer whatever is owed with the first legal thing that is not conceding.
    const next = legalCommands(s, p).find((c) => c.type !== 'concede')
    if (!next) break
    s = apply(s, next).state
  }
  return s
}

/** A real request, because `as never` for the view is banned here — it once hid a genuine type error. */
const requestFor = (view: PlayerView): WorkerSearchRequest =>
  ({ type: 'search', requestId: 1, view, seed: 3, iterations: 200 })

const BUDGET = { ms: 500, minIterations: 8 } as const

describe('the budget on the wire (F4-A1)', () => {
  it('is POSTED by the coordinator, in the init message', () => {
    const t = recordingTransport()
    const state = aiToMove()
    const coordinator = new SearchCoordinator({
      decks: DECKS, gameSeed: 4, readState: () => state, stepMs: 600,
      budget: BUDGET, createTransport: t.factory,
    })
    coordinator.request(state, { onCommand: () => true, onWarning: () => {} })

    const init = t.posts.find((m): m is WorkerInit => m.type === 'init')
    expect(init, 'the coordinator posted no init message at all').not.toBe(undefined)
    expect(init!.budget, 'the budget never reached the wire').toEqual(BUDGET)
  })

  it('survives a real structuredClone — the thing that would throw for a function', () => {
    const t = recordingTransport()
    const state = aiToMove()
    new SearchCoordinator({
      decks: DECKS, gameSeed: 4, readState: () => state, stepMs: 600,
      budget: BUDGET, createTransport: t.factory,
    }).request(state, { onCommand: () => true, onWarning: () => {} })

    const init = t.posts.find((m): m is WorkerInit => m.type === 'init')!
    // The actual posted object, not a hand-built stand-in. `postMessage` throws synchronously on an
    // unclonable payload, and the coordinator reads that as worker death — permanent Greedy for the game.
    expect(() => structuredClone(init)).not.toThrow()
    expect(structuredClone(init).budget).toEqual(BUDGET)
  })

  it('is carried into the search input by the worker translation', () => {
    // The last link. Everything above can pass while `searchInputFor` silently drops the field.
    const state = aiToMove()
    const init: WorkerInit = {
      type: 'init', decks: DECKS, rolloutCommandCap: 12, explorationC: 1.4, budget: BUDGET,
    }
    expect(searchInputFor(init, requestFor(viewFor(state, AI))).budget,
      'searchInputFor dropped the budget').toEqual(BUDGET)
  })

  it('is ABSENT end to end when no budget is configured', () => {
    // The other direction, and it is what keeps every existing call site byte-identical: an absent budget must
    // be an absent KEY, not an explicit undefined, or `exactOptionalPropertyTypes` consumers see a difference.
    const t = recordingTransport()
    const state = aiToMove()
    new SearchCoordinator({
      decks: DECKS, gameSeed: 4, readState: () => state, stepMs: 600, createTransport: t.factory,
    }).request(state, { onCommand: () => true, onWarning: () => {} })

    const init = t.posts.find((m): m is WorkerInit => m.type === 'init')!
    expect('budget' in init, 'an unconfigured budget still put a key on the wire').toBe(false)
    const input = searchInputFor(init, requestFor(viewFor(state, AI)))
    expect('budget' in input, 'searchInputFor invented a budget key').toBe(false)
  })
})

/**
 * The SHIPPED configuration, not the mechanism.
 *
 * The four tests above pin that a budget given to the coordinator reaches the search. All four stay green if
 * `createAiSearch` stops passing one, or passes a different one — they construct their own `SearchCoordinator`
 * with a locally defined budget. The generic path was tested and the actual browser policy was not, which a
 * code review caught. This closes it: what `createAiSearch` really posts, and the value it really posts.
 */
describe('the box the browser actually ships (F4)', () => {
  it('is posted by createAiSearch, at the value in SEARCH_BUDGET', () => {
    const t = recordingTransport()
    const state = aiToMove()
    const search = createAiSearch(() => state, 4, { createTransport: t.factory })
    search.request(state, { onCommand: () => true, onWarning: () => {} })

    const init = t.posts.find((m): m is WorkerInit => m.type === 'init')
    expect(init, 'createAiSearch posted no init message').not.toBe(undefined)
    expect(init!.budget, 'the app ships no budget — the search is unboxed in the browser')
      .toEqual(SEARCH_BUDGET)
  })

  it('ships a budget that can actually bind', () => {
    // A floor at or above the iteration count means the deadline is never checked, so the agent runs unboxed
    // while its label claims otherwise. `searchTree` rejects that outright; this asserts the SHIPPED pair is
    // not the rejected shape, which no amount of validation elsewhere would tell us.
    expect(SEARCH_BUDGET.minIterations).toBeLessThanOrEqual(DEFAULT_ITERATIONS)
    expect(SEARCH_BUDGET.ms).toBeGreaterThan(0)
    expect(Number.isInteger(SEARCH_BUDGET.minIterations)).toBe(true)
  })

  it('ships a floor that has been MEASURED to play acceptably', () => {
    // The floor is what a slow machine plays, so its strength is the opponent's strength there. Measured
    // against greedy over mirrored seed pairs: 8 -> 12.5%, 16 -> 33.3%, 32 -> 63.3%, 64 -> 71.7%, and the
    // unboxed 200 -> 75.0%. A floor of 8 SHIPPED, and it loses seven games in eight to the agent the search
    // is supposed to beat, because eight iterations on a wide root tie at one visit each and the reward is
    // discarded entirely.
    //
    // 32 is the lowest measured value clearing greedy parity; this pins the floor at or above it so a later
    // "let's lower it for latency" cannot quietly reintroduce a reward-blind opponent. Lowering it means
    // re-running the sweep, which is the point.
    const LOWEST_MEASURED_ABOVE_PARITY = 32
    expect(SEARCH_BUDGET.minIterations,
      'the shipped floor is below the lowest value measured to beat greedy — re-run the floor sweep')
      .toBeGreaterThanOrEqual(LOWEST_MEASURED_ABOVE_PARITY)
  })
})
