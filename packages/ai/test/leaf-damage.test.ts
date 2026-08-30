import { describe, expect, it } from 'vitest'
import {
  actingPlayer, apply, legalCommands, viewFor,
  type GameState, type PlayerId,
} from '@fftcg/engine'
import { newRolloutProfile, GreedyAgent } from '../src/greedy.js'
import { rolloutToCap, searchIsmcts, DEFAULT_ROLLOUT_COMMAND_CAP } from '../src/ismcts/search.js'
import { DEFAULT_WEIGHTS } from '../src/evaluate.js'
import { DEFAULT_DECK, makeGame } from '../../engine/test/helpers.js'

/**
 * Rung G1's GATE, and the instrument has to be right before the number it produces is allowed to decide
 * anything. The whole point of the histogram is to say whether a damage curve could reprice enough leaves to
 * matter; an instrument that miscounts, or that records the wrong player's damage, would answer a different
 * question just as confidently. This repo has shipped a wrong measurement before — twice — so the recorder
 * gets an exactness test and an independent reconciliation, not a smoke test.
 */

/** Put `n` cards in a player's damage zone the way the engine does — off the top of their deck. */
function withDamage(state: GameState, player: PlayerId, n: number): GameState {
  const ps = state.players[player]
  const taken = ps.deck.slice(0, n)
  return {
    ...state,
    players: state.players.map((p, i) =>
      i === player ? { ...p, deck: p.deck.slice(n), damageZone: [...p.damageZone, ...taken] } : p,
    ) as GameState['players'],
  }
}

function midGame(seed: number, steps: number): GameState {
  let s = makeGame({ seed })
  const agent = new GreedyAgent({ seed, decks: [DEFAULT_DECK, DEFAULT_DECK], depth: 1 })
  for (let i = 0; i < steps && !s.result; i++) {
    const p = actingPlayer(s)
    if (p === null) break
    s = apply(s, agent.decide(viewFor(s, p), legalCommands(s, p))).state
  }
  return s
}

const total = (hist: readonly number[]): number => hist.reduce((a, b) => a + b, 0)

describe('the leaf-damage histogram is keyed on the ROOT player (G1 gate)', () => {
  it('records MY damage first and the opponent second, and swaps when the root swaps', () => {
    // A command cap of zero makes the leaf the position itself, so the recorded cell is a fact about this
    // state rather than about wherever a rollout wandered. The two damage counts are deliberately unequal:
    // with 3 and 3 the test would pass under a transposed index, which is the bug it exists to catch.
    const base = withDamage(withDamage(midGame(3, 12), 0, 2), 1, 5)
    expect(base.result, 'the fixture ended the game, so no heuristic leaf is recorded').toBeNull()

    for (const root of [0, 1] as const) {
      const profile = newRolloutProfile()
      rolloutToCap(base, root, 0, DEFAULT_WEIGHTS, undefined, 100_000, profile)
      const want = root === 0 ? 2 * 8 + 5 : 5 * 8 + 2
      expect(profile.leafDamage[want], `root ${root}: the leaf was not recorded at [mine=${root === 0 ? 2 : 5}, theirs=${root === 0 ? 5 : 2}]`).toBe(1)
      expect(total(profile.leafDamage), `root ${root}: more than one leaf was recorded for one rollout`).toBe(1)
      expect(profile.terminalLeaves, `root ${root}: a live position was counted as terminal`).toBe(0)
    }
  })

  it('counts a terminal leaf apart from the histogram, because no weight can reprice it', () => {
    // `leafReward` returns the exact terminal value without ever reaching `material`. Folding those into the
    // histogram would claim a curve could move states it cannot, inflating the share this gate measures.
    //
    // A REAL finished game, not a hand-stuffed damage zone: `result` is set by the engine's own state-based
    // check during `apply`, so writing seven cards into a damage zone produces a position that is lost but not
    // yet flagged — the rollout would play on from it and record a heuristic leaf, and the test would pass for
    // the wrong reason.
    const dead = midGame(3, 4000)
    expect(dead.result, 'the fixture game never finished, so no terminal leaf exists to count').not.toBeNull()
    const profile = newRolloutProfile()
    rolloutToCap(dead, 0, DEFAULT_ROLLOUT_COMMAND_CAP, DEFAULT_WEIGHTS, undefined, 100_000, profile)
    expect(profile.terminalLeaves + total(profile.leafDamage), 'the rollout recorded no leaf at all').toBe(1)
    expect(total(profile.leafDamage), 'a terminal leaf was folded into the repriceable histogram').toBe(0)
    expect(profile.terminalLeaves).toBe(1)
  })
})

describe('the recorded cell is the leaf that was actually priced (G1 gate)', () => {
  it('matches the damage of the state `leafReward` sees, not the state before settlement', () => {
    // The rollout does not stop where its command loop stops: `resolveForcedDecisions` runs afterwards, and it
    // can deal the damage of a declared attack and can END the game. Recording the pre-settlement position
    // therefore both misplaces damage and books a heuristic leaf for a state that is really terminal —
    // overstating exactly the repriceable share this gate exists to size. A mutation moving the recorder above
    // the tail passed the reconciliation tests below, so the property has to be asserted directly.
    let checked = 0
    for (const seed of [3, 5, 8, 11, 17]) {
      for (const steps of [6, 12, 18, 24]) {
        for (const cap of [0, 3, DEFAULT_ROLLOUT_COMMAND_CAP]) {
          const start = midGame(seed, steps)
          if (start.result) continue
          const profile = newRolloutProfile()
          const r = rolloutToCap(start, 0, cap, DEFAULT_WEIGHTS, undefined, 100_000, profile)
          checked++
          if (r.state.result) {
            expect(total(profile.leafDamage), `seed ${seed}/${steps}/${cap}: a finished leaf entered the histogram`).toBe(0)
            expect(profile.terminalLeaves).toBe(1)
            continue
          }
          const mine = Math.min(r.state.players[0].damageZone.length, 7)
          const theirs = Math.min(r.state.players[1].damageZone.length, 7)
          expect(profile.leafDamage[mine * 8 + theirs],
            `seed ${seed}/${steps}/${cap}: the histogram does not hold the priced leaf's damage (${mine},${theirs})`).toBe(1)
        }
      }
    }
    expect(checked, 'every fixture was already finished, so nothing was checked').toBeGreaterThan(20)
  })
})

describe('the histogram reconciles with the search’s own counters (G1 gate)', () => {
  it('every simulation ends in exactly one leaf, and the heuristic ones equal `evaluations`', () => {
    // Two independent reconciliations against counters the recorder does not touch. `evaluations` is
    // incremented inside `leafReward` and ONLY for non-terminal states, so it is the same quantity the
    // histogram claims to hold — counted at a different place, by different code.
    const s = midGame(3, 12)
    const r = searchIsmcts({
      view: viewFor(s, 0), decks: [DEFAULT_DECK, DEFAULT_DECK] as [string[], string[]],
      iterations: 120, seed: 99, rolloutCommandCap: DEFAULT_ROLLOUT_COMMAND_CAP, explorationC: 1.4, profile: true,
    })
    const prof = r.diagnostics.rollout
    expect(prof, 'a profiled search reported no attribution').toBeDefined()
    const heuristic = total(prof!.leafDamage)
    expect(heuristic, 'the histogram is empty, so it reconciles vacuously').toBeGreaterThan(0)
    expect(heuristic, 'the histogram disagrees with the search’s own evaluation counter')
      .toBe(r.diagnostics.evaluations)
    expect(heuristic + prof!.terminalLeaves, 'leaves recorded did not equal simulations run').toBe(120)
  })

  it('measuring damage does not move what is measured', () => {
    // The same guarantee D7 established for the apply attribution: the recorder is diagnostic, so the chosen
    // command must not depend on whether anyone is counting.
    const s = midGame(3, 12)
    const input = {
      view: viewFor(s, 0), decks: [DEFAULT_DECK, DEFAULT_DECK] as [string[], string[]],
      iterations: 60, seed: 7, rolloutCommandCap: DEFAULT_ROLLOUT_COMMAND_CAP, explorationC: 1.4,
    }
    expect(searchIsmcts({ ...input, profile: true }).command).toEqual(searchIsmcts(input).command)
  })
})
