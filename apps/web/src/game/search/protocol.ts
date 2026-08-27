import { searchIsmcts, type SearchInput, type SearchResult } from '@fftcg/ai'
import type { PlayerView } from '@fftcg/engine'

/**
 * The wire contract between the main thread and the search worker (spec D2-1).
 *
 * Every message here is structured-cloneable by construction: `PlayerView`, `SearchResult` and the declared
 * lists are plain data (spec D-7/D-9), and errors cross as **plain strings** — an `Error` clones as a bare
 * `{}` in some engines and loses its message in others, which turns a worker failure into a silent one.
 */

/**
 * Sent once per worker, before the first request. It carries the two declared lists AND the stable search
 * configuration: `SearchInput` requires `rolloutCommandCap` and `explorationC`, and neither varies by position,
 * so putting them on every request would be re-declaring a constant across the boundary 200 times a game.
 */
export interface WorkerInit {
  readonly type: 'init'
  /** Both players' publicly declared lists — the open-decklist assumption `determinise` documents. */
  readonly decks: readonly [readonly string[], readonly string[]]
  readonly rolloutCommandCap: number
  readonly explorationC: number
}

/** One search. `seed` is allocated per game POSITION by the coordinator (D2-3), never from `requestId`. */
export interface WorkerSearchRequest {
  readonly type: 'search'
  readonly requestId: number
  readonly view: PlayerView
  readonly seed: number
  readonly iterations: number
}

export interface WorkerResultMessage {
  readonly type: 'result'
  readonly requestId: number
  readonly result: SearchResult
}

/** `requestId` is `null` only for a failure that belongs to no request — init, or a message the worker cannot read. */
export interface WorkerErrorMessage {
  readonly type: 'error'
  readonly requestId: number | null
  readonly message: string
}

export type WorkerRequestMessage = WorkerInit | WorkerSearchRequest
export type WorkerResponseMessage = WorkerResultMessage | WorkerErrorMessage

/** Everything that crosses the boundary as a diagnostic is a string, so nothing depends on `Error` cloning. */
export function describeFailure(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export function searchInputFor(init: WorkerInit, request: WorkerSearchRequest): SearchInput {
  return {
    view: request.view,
    decks: init.decks,
    iterations: request.iterations,
    seed: request.seed,
    rolloutCommandCap: init.rolloutCommandCap,
    explorationC: init.explorationC,
  }
}

/**
 * Deterministic translation, and nothing else (spec D2-A3): the same `(view, seed, iterations, caps)` returns
 * exactly what a direct `searchIsmcts` call returns.
 *
 * It knows nothing about what is outstanding, which is the whole point — staleness is a property of the main
 * thread's game state, so it is decided by `SearchCoordinator` and cannot be tested here.
 */
export function respond(init: WorkerInit, request: WorkerSearchRequest): WorkerResultMessage | WorkerErrorMessage {
  try {
    return { type: 'result', requestId: request.requestId, result: searchIsmcts(searchInputFor(init, request)) }
  } catch (e) {
    return { type: 'error', requestId: request.requestId, message: describeFailure(e) }
  }
}
