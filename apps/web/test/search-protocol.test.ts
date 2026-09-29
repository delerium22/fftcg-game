import { describe, expect, it } from 'vitest'
import { apply, createGame, determinise, isLegal, legalCommands, seedRng, viewFor, type GameState, type PlayerId } from '@fftcg/engine'
import { GreedyAgent, searchIsmcts, type SearchInput } from '@fftcg/ai'
import { CARD_DEFS, DECK_CHOICES, DECKS, deckLists } from '../src/deck.js'
import { createWebGame } from '../src/game/useGame.js'
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

/**
 * Rung V1-C, review focus 1 (R9): the AI's determinisation needs the AI's OWN list for its hidden cards and the
 * HUMAN's list for the human's. With one list per seat that was the same list twice and a swap was invisible; with
 * the default pair — you Vol. 2, the AI Vol. 1 — the two are composition-distinct, so a swapped or mirrored init
 * would ask the search to sample cards that cannot exist. Driven through the worker protocol, not the coordinator
 * alone, because `respond` is what the browser's worker actually runs.
 */
describe('search protocol with a deck per seat (rung V1-C)', () => {
  const PAIR = ['vol2', 'vol1'] as const
  const { decks: PAIR_DECKS } = deckLists(PAIR)
  const PAIR_INIT: WorkerInit = { type: 'init', decks: PAIR_DECKS, rolloutCommandCap: ROLLOUT_COMMAND_CAP, explorationC: EXPLORATION_C }

  /** An AI decision past the deal and into turn 2, so both fields hold public cards the lists must account for. */
  function aiToActLater(seed: number): GameState {
    let state = createWebGame(seed, PAIR)
    const agent = new GreedyAgent({ seed, decks: PAIR_DECKS, depth: 1 })
    for (let i = 0; i < 600; i++) {
      const p: PlayerId | null = state.result ? null : (state.pending?.player ?? state.priority)
      if (p === null) break
      if (p === AI && state.turn >= 2) return state
      state = apply(state, agent.decide(viewFor(state, p), legalCommands(state, p))).state
    }
    throw new Error(`seed ${seed} never reached an AI decision in turn 2`)
  }

  const nonLb = (s: GameState, p: PlayerId, ids: readonly number[]): string[] =>
    ids.map((id) => s.cards[id]!.code).filter((code) => s.defs[code]?.limitBreak === undefined).sort()
  /** Every main-deck code a seat owns, in every zone — the conservation a determinisation must keep per seat. */
  function ownedMain(s: GameState, p: PlayerId): string[] {
    const ps = s.players[p]
    const onStack = s.stack.flatMap((item) => (item.kind === 'summon' && s.cards[item.card]?.owner === p ? [item.card] : []))
    return nonLb(s, p, [...ps.deck, ...ps.hand, ...ps.forwards.map((c) => c.id), ...ps.backups.map((c) => c.id), ...ps.damageZone, ...ps.breakZone, ...ps.removedFromGame, ...onStack])
  }

  it('the ground truth really holds a different list per seat, with public cards on both sides', () => {
    const state = aiToActLater(11)
    expect(ownedMain(state, 0)).toEqual([...DECK_CHOICES.vol2.main].sort())
    expect(ownedMain(state, 1)).toEqual([...DECK_CHOICES.vol1.main].sort())
    const publicCards = (p: PlayerId): number => state.players[p].forwards.length + state.players[p].backups.length + state.players[p].breakZone.length + state.players[p].damageZone.length
    expect(publicCards(0) + publicCards(1), 'nothing public yet, so a swapped list could not be caught').toBeGreaterThan(0)
  })

  it('a determinisation from the AI seat conserves each seat\'s own list', () => {
    const state = aiToActLater(11)
    for (let r = 1; r <= 5; r++) {
      const [world] = determinise({ view: viewFor(state, AI), decks: PAIR_DECKS, rng: seedRng(r) })
      expect(ownedMain(world, 0), 'the human was sampled from the wrong list').toEqual([...DECK_CHOICES.vol2.main].sort())
      expect(ownedMain(world, 1), 'the AI was sampled from the wrong list').toEqual([...DECK_CHOICES.vol1.main].sort())
    }
  })

  it('the worker answers the AI seat with a legal command', () => {
    const state = aiToActLater(11)
    const message = respond(PAIR_INIT, requestFor(state))
    if (message.type !== 'result') throw new Error(`the worker failed: ${message.message}`)
    expect(message.result.command.player).toBe(AI)
    expect(isLegal(state, message.result.command)).toBeNull()
  })

  it('a swapped pair is refused, so the test above is not passing by accident', () => {
    const state = aiToActLater(11)
    const swapped: WorkerInit = { ...PAIR_INIT, decks: [PAIR_DECKS[1], PAIR_DECKS[0]] }
    const message = respond(swapped, requestFor(state))
    expect(message.type, 'the search accepted lists that cannot have produced this board').toBe('error')
    if (message.type !== 'error') throw new Error('unreachable')
    expect(message.message).toMatch(/does not contain visible card/)
  })
})
