import { describe, expect, it } from 'vitest'
import { apply, createGame, legalCommands, viewFor, type GameState, type PlayerId } from '@fftcg/engine'
import { GreedyAgent, searchIsmcts, type SearchInput } from '@fftcg/ai'
import { CARD_DEFS, DECKS } from '../src/deck.js'
import { AI } from '../src/game/types.js'
import { describeFailure, respond, searchInputFor, type WorkerInit, type WorkerSearchRequest } from '../src/game/search/protocol.js'

const ROLLOUT_COMMAND_CAP = 8
const EXPLORATION_C = 1

const INIT: WorkerInit = { type: 'init', decks: DECKS, rolloutCommandCap: ROLLOUT_COMMAND_CAP, explorationC: EXPLORATION_C }

/** Fast-forward a real game to the first position the AI actually owns; anything else is not a search input. */
function aiToAct(seed: number): GameState {
  let state: GameState = createGame({ seed, decks: DECKS, defs: CARD_DEFS })
  const agent = new GreedyAgent({ seed, decks: DECKS, depth: 1 })
  for (let i = 0; i < 400; i++) {
    const p: PlayerId | null = state.result ? null : (state.pending?.player ?? state.priority)
    if (p === null) break
    if (p === AI) return state
    state = apply(state, agent.decide(viewFor(state, p), legalCommands(state, p))).state
  }
  throw new Error(`seed ${seed} never reached an AI decision`)
}

const requestFor = (state: GameState, over: Partial<WorkerSearchRequest> = {}): WorkerSearchRequest =>
  ({ type: 'search', requestId: 7, view: viewFor(state, AI), seed: 12345, iterations: 12, ...over })

describe('search protocol', () => {
  // D2-A3: the boundary must be a pure translation. A `respond` that quietly re-derived caps or a seed would
  // make the browser play a different game from the headless gate that measured 90.0 %.
  it('respond returns exactly what a direct searchIsmcts call returns (D2-A3)', () => {
    const state = aiToAct(11)
    const request = requestFor(state)
    // Clone the request the way `postMessage` would, so the comparison is across a real serialization too.
    const direct = searchIsmcts(searchInputFor(INIT, structuredClone(request)))
    const viaProtocol = respond(INIT, request)
    expect(viaProtocol.type).toBe('result')
    expect(viaProtocol).toEqual({ type: 'result', requestId: 7, result: direct })
  })

  // The `requestId` is correlation only — it must never reach the search, or a retry of one position would
  // pick a different move (D2-3).
  it('the requestId does not influence the answer', () => {
    const state = aiToAct(11)
    const a = respond(INIT, requestFor(state, { requestId: 1 }))
    const b = respond(INIT, requestFor(state, { requestId: 9999 }))
    if (a.type !== 'result' || b.type !== 'result') throw new Error('expected results')
    expect(a.result).toEqual(b.result)
  })

  it('searchInputFor takes the caps from init and the position from the request', () => {
    const state = aiToAct(11)
    const input: SearchInput = searchInputFor(INIT, requestFor(state, { seed: 99, iterations: 5 }))
    expect(input.rolloutCommandCap).toBe(ROLLOUT_COMMAND_CAP)
    expect(input.explorationC).toBe(EXPLORATION_C)
    expect(input.decks).toBe(DECKS)
    expect(input.seed).toBe(99)
    expect(input.iterations).toBe(5)
  })

  it('a throwing search becomes an error message carrying its own requestId', () => {
    const state = aiToAct(11)
    const message = respond(INIT, requestFor(state, { requestId: 42, iterations: 0 }))
    expect(message.type).toBe('error')
    if (message.type !== 'error') throw new Error('unreachable')
    expect(message.requestId).toBe(42)
    expect(typeof message.message).toBe('string')
    expect(message.message).toMatch(/iterations/)
  })

  it('errors cross as plain strings, never as Error objects', () => {
    expect(describeFailure(new RangeError('boom'))).toBe('boom')
    expect(describeFailure('boom')).toBe('boom')
    expect(describeFailure(undefined)).toBe('undefined')
  })

  // Every message is posted, so every message must clone. `structuredClone` throws on anything that does not.
  it('every message is structured-cloneable', () => {
    const state = aiToAct(11)
    const request = requestFor(state)
    const result = respond(INIT, request)
    expect(() => structuredClone(INIT)).not.toThrow()
    expect(() => structuredClone(request)).not.toThrow()
    expect(() => structuredClone(result)).not.toThrow()
    expect(() => structuredClone({ type: 'error', requestId: null, message: 'init failed' })).not.toThrow()
    expect(structuredClone(result)).toEqual(result)
  })
})
