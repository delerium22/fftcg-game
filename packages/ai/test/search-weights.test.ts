import { describe, expect, it } from 'vitest'
import { actingPlayer, apply, legalCommands, viewFor, type GameState } from '@fftcg/engine'
import { GreedyAgent } from '../src/greedy.js'
import { DEFAULT_WEIGHTS, resolveWeights, type WeightOverrides } from '../src/evaluate.js'
import { searchIsmcts, DEFAULT_ROLLOUT_COMMAND_CAP } from '../src/ismcts/search.js'
import { IsmctsAgent } from '../src/ismcts/agent.js'
import { DEFAULT_DECK, makeGame } from '../../engine/test/helpers.js'

/**
 * Rung G1a — the search takes its weights as data.
 *
 * Its whole purpose is to make an `ismcts(a)` vs `ismcts(b)` tournament possible: the rollouts hardcoded
 * `DEFAULT_WEIGHTS`, so the only way to change one was to edit source, and a comparison whose two arms are
 * different checkouts is not one anybody should ship on. Two things therefore have to be true — an override
 * must actually REACH the rollouts, and no override must leave the search exactly as it was.
 */

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

const inputFor = (s: GameState, seed: number) => ({
  view: viewFor(s, 0), decks: [DEFAULT_DECK, DEFAULT_DECK] as [string[], string[]],
  iterations: 80, seed, rolloutCommandCap: DEFAULT_ROLLOUT_COMMAND_CAP, explorationC: 1.4,
})

describe('resolveWeights lays a sparse override over the defaults (G1a)', () => {
  it('changes only the named weight', () => {
    const w = resolveWeights({ damage: 99 })
    expect(w.damage).toBe(99)
    expect({ ...w, damage: DEFAULT_WEIGHTS.damage }).toEqual(DEFAULT_WEIGHTS)
  })

  it('returns the defaults themselves when nothing is overridden', () => {
    expect(resolveWeights()).toBe(DEFAULT_WEIGHTS)
    expect(resolveWeights({})).toEqual(DEFAULT_WEIGHTS)
  })

  it('treats an explicitly undefined value as absent, because `structuredClone` preserves one', () => {
    // A worker-posted `{ damage: undefined }` spread into the defaults would set the weight to `undefined`,
    // and `undefined * anything` is NaN — the poisoning case below, arriving by a route no validation sees.
    expect(resolveWeights({ damage: undefined })).toEqual(DEFAULT_WEIGHTS)
  })

  it('refuses a non-finite weight, which would not fail but POISON', () => {
    // NaN does not throw anywhere: `evaluate` returns NaN, every `>` against it is false, and the agent keeps
    // whichever candidate it scored first. That surfaces as "the new weight plays badly", not as a typo.
    expect(() => resolveWeights({ damage: NaN })).toThrow(/every score NaN/)
    expect(() => resolveWeights({ damage: Infinity })).toThrow(/every score NaN/)
  })

  it('refuses an unknown weight, which would silently do nothing', () => {
    // The dangerous failure: a run named `damageCurv` reports the CONTROL's numbers under the treatment's name.
    expect(() => resolveWeights({ damageCurv: 8 } as WeightOverrides)).toThrow(/unknown weight/)
  })
})

describe('the search actually uses the weights it is given (G1a)', () => {
  it('validates them at ENTRY, before any rollout runs', () => {
    // Inside a Worker a throw reads as worker death and permanently downgrades the opponent to the heuristic
    // agent, silently, for the rest of the game. Failing on iteration one rather than one thousand is the
    // difference between a visible error and a game that just gets easier.
    const s = midGame(3, 12)
    expect(() => searchIsmcts({ ...inputFor(s, 5), weights: { damage: NaN } })).toThrow(/every score NaN/)
    expect(() => searchIsmcts({ ...inputFor(s, 5), weights: { nope: 1 } as WeightOverrides }))
      .toThrow(/unknown weight/)
  })

  it('an absent override leaves the search bit-for-bit what it was', () => {
    // The regression that matters most: G1a must be pure plumbing. If this ever fails, every measurement taken
    // before it — every mirror number in docs/superpowers/measurements — describes a different search.
    const s = midGame(3, 12)
    const plain = searchIsmcts(inputFor(s, 11))
    const empty = searchIsmcts({ ...inputFor(s, 11), weights: {} })
    expect(empty.command).toEqual(plain.command)
    expect(empty.diagnostics.rolloutApplies).toBe(plain.diagnostics.rolloutApplies)
    expect(empty.diagnostics.evaluations).toBe(plain.diagnostics.evaluations)
  })

  it('a weight big enough to dominate CHANGES the command, so the override provably reaches the rollouts', () => {
    // Not a claim about play strength — a claim about wiring. An override that reached nothing would leave
    // every one of these identical, which is exactly the defect a `weights` field can have while typechecking.
    const differed: number[] = []
    let examined = 0
    for (let seed = 1; seed <= 12; seed++) {
      const s = midGame(seed, 12)
      // `searchIsmcts` refuses to move for anyone but the acting player, and twelve greedy commands do not
      // land on the same seat for every seed. Skipping is right; not counting what was skipped is not.
      if (s.result || actingPlayer(s) !== 0) continue
      examined++
      const base = searchIsmcts(inputFor(s, 40 + seed))
      const loud = searchIsmcts({ ...inputFor(s, 40 + seed), weights: { damage: 5000, forwardPower: -50 } })
      if (JSON.stringify(loud.command) !== JSON.stringify(base.command)) differed.push(seed)
    }
    expect(examined, 'no seed was ever searched, so this asserts nothing').toBeGreaterThan(2)
    expect(differed.length, 'no seed changed its command under a dominating weight — the override reaches nothing')
      .toBeGreaterThan(0)
  })

  it('IsmctsAgent carries the override into its SearchInput', () => {
    // The agent is what a tournament actually constructs, so the plumbing has to be end-to-end and not just
    // present on the pure function underneath.
    const s = midGame(3, 12)
    const view = viewFor(s, 0)
    const opts = { seed: 4, decks: [DEFAULT_DECK, DEFAULT_DECK] as [string[], string[]], iterations: 60 }
    expect(() => new IsmctsAgent({ ...opts, weights: { damage: NaN } }).decide(view, legalCommands(s, 0)))
      .toThrow(/every score NaN/)
    expect(() => new IsmctsAgent(opts).decide(view, legalCommands(s, 0))).not.toThrow()
  })
})
