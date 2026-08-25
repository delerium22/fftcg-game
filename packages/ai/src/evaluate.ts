import { DAMAGE_TO_LOSE, HAND_SIZE_LIMIT, MAX_BACKUPS, defOf, opponentOf, powerOf, type GameState, type PlayerId } from '@fftcg/engine'
import { cardValue } from './cardValue.js'

export interface Weights {
  damage: number
  forwardPower: number
  forwardPresence: number
  dullFactor: number
  backup: number
  hand: number
  handQuality: number
  deck: number
  threat: number
  terminal: number
}

export const DEFAULT_WEIGHTS: Weights = {
  damage: 30,
  forwardPower: 1.2,
  forwardPresence: 4,
  dullFactor: 0.6,
  backup: 5,
  hand: 2,
  handQuality: 0.5,
  deck: 0.1,
  threat: 0.8,
  terminal: 100_000,
}

function material(state: GameState, p: PlayerId, w: Weights): number {
  const ps = state.players[p]
  let v = (DAMAGE_TO_LOSE - ps.damageZone.length) * w.damage
  for (const c of ps.forwards) {
    v += (powerOf(state, c) / 1000) * w.forwardPower * (c.status === 'dull' ? w.dullFactor : 1) + w.forwardPresence
    if (c.status === 'active') v += (powerOf(state, c) / 1000) * w.threat   // active-power tempo: this side's own attack-ready threat
  }
  v += Math.min(ps.backups.length, MAX_BACKUPS) * w.backup
  v += Math.min(ps.hand.length, HAND_SIZE_LIMIT) * w.hand + Math.max(0, ps.hand.length - HAND_SIZE_LIMIT) * w.hand * 0.25
  for (const id of ps.hand) v += cardValue(defOf(state, id)) * w.handQuality
  v += ps.deck.length * w.deck
  return v
}

export function evaluate(state: GameState, me: PlayerId, weights: Weights = DEFAULT_WEIGHTS, aggression = 0.5): number {
  if (aggression < 0 || aggression > 1) throw new RangeError(`aggression must be within [0, 1], got ${aggression}`)
  const opp = opponentOf(me)
  if (state.result) return state.result.winner === me ? weights.terminal : state.result.winner === opp ? -weights.terminal : 0
  const mine = material(state, me, weights) * 2 * (1 - aggression)
  const theirs = material(state, opp, weights) * 2 * aggression
  return mine - theirs
}
