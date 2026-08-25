import type { PlayerId } from './types.js'
import type { GameState } from './state.js'
import type { Event } from './events.js'

/** STUB until Task 5: enters turn `turn` for `player` without the Active/Draw phases. */
export function startTurn(state: GameState, turn: number, player: PlayerId): [GameState, Event[]] {
  return [{ ...state, turn, turnPlayer: player, phase: 'main1', priority: player, pending: null, attack: null }, [{ type: 'turnStarted', turn, player }]]
}
