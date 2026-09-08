import { actingPlayer, apply, legalCommands, viewFor, type GameState, type PlayerId } from '@fftcg/engine'
import { GreedyAgent } from '../../src/greedy.js'
import { settleWindows, DEFAULT_DECK, makeGame } from '../../../engine/test/helpers.js'

/**
 * The corpus rung G1b-A1 freezes against.
 *
 * A1 asks whether `damageCurve: 0` leaves `evaluate` bitwise unchanged. Comparing the new evaluator to itself
 * proves nothing — the review named that as the way A1 passes vacuously — so the reference has to be scores
 * captured from the code as it was BEFORE the weight existed. `frozen-scores.json` holds exactly that, written
 * by `write-frozen-scores.ts` on the parent commit; this module only rebuilds the states it was taken from.
 *
 * The corpus is deliberately not random. A1 is trivially satisfied by states with no damage, symmetric damage,
 * or a decided result, so the states are walked out of real games and then stamped with UNEQUAL, NON-ZERO
 * damage on both sides — which is the only shape where a damage weight could hide a difference.
 */

/** Put `n` cards in a player's damage zone the way the engine does — off the top of their deck. */
export function withDamage(state: GameState, player: PlayerId, n: number): GameState {
  const taken = state.players[player].deck.slice(0, n)
  return {
    ...state,
    players: state.players.map((p, i) =>
      i === player ? { ...p, deck: p.deck.slice(n), damageZone: [...p.damageZone, ...taken] } : p,
    ) as GameState['players'],
  }
}

function walk(seed: number, steps: number): GameState {
  let s = makeGame({ seed })
  const agent = new GreedyAgent({ seed, decks: [DEFAULT_DECK, DEFAULT_DECK], depth: 1 })
  for (let i = 0; i < steps && !s.result; i++) {
    const p = actingPlayer(s)
    if (p === null) break
    // Forced windows are not decisions (rung J1): skipped, so the walk lands where it did before the stack.
    s = settleWindows(apply(s, agent.decide(viewFor(s, p), legalCommands(s, p))).state)
  }
  return s
}

export interface Case { readonly label: string; readonly state: GameState; readonly me: PlayerId; readonly aggression: number }

/**
 * Every case, in a fixed order, keyed by a label that survives a regeneration. Damage pairs cover 0…6 on both
 * sides and are mostly unequal, so the linear term and any curve term are separable in the data itself.
 */
export function corpus(): Case[] {
  const out: Case[] = []
  for (const seed of [3, 8, 17]) {
    for (const steps of [8, 16, 26]) {
      const base = walk(seed, steps)
      if (base.result) continue
      for (const [mine, theirs] of [[0, 0], [1, 0], [0, 3], [2, 5], [5, 2], [4, 4], [6, 1], [1, 6], [3, 6], [6, 5]] as const) {
        const state = withDamage(withDamage(base, 0, mine), 1, theirs)
        if (state.result) continue
        for (const me of [0, 1] as const) {
          for (const aggression of [0, 0.3, 0.5, 0.7, 1]) {
            out.push({ label: `s${seed}/t${steps}/d${mine}-${theirs}/me${me}/a${aggression}`, state, me, aggression })
          }
        }
      }
    }
  }
  return out
}
