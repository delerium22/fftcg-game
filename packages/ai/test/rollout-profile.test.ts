import { describe, expect, it } from 'vitest'
import { actingPlayer, apply, legalCommands, viewFor, type CardId, type GameState } from '@fftcg/engine'
import { newRolloutProfile, profiledApplies, GreedyAgent } from '../src/greedy.js'
import { rolloutToCap, searchIsmcts, DEFAULT_ROLLOUT_COMMAND_CAP } from '../src/ismcts/search.js'
import { DEFAULT_WEIGHTS } from '../src/evaluate.js'
import { DEFAULT_DECK, makeGame, withField, withHandSize } from '../../engine/test/helpers.js'

/**
 * Rung D7 — the attribution has to be trustworthy before anything is decided from it.
 *
 * The load-bearing property is not any single bucket, it is that the four buckets account for EVERY apply a
 * rollout spends, exactly once each. Rung D6 was refused for reasoning about this division from an arithmetic
 * identity; a division that does not reconcile would be the same mistake with more decimal places.
 */

/** Walk a real game a few decisions in, so rollouts start from a position with a board rather than turn 1. */
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

describe('rollout apply attribution (rung D7)', () => {
  it('the four buckets account for every apply a rollout spends — cap bound and unbound', () => {
    // Both regimes, because the interesting one is when `within(budget)` starts refusing candidates: that is
    // the path where `generated` and `scored` diverge, and where an apply is easiest to lose track of.
    const bound: boolean[] = []
    for (const applyCap of [16, 100_000]) {
      for (const steps of [6, 14, 22]) {
        const s = midGame(3, steps)
        if (s.result) continue
        const profile = newRolloutProfile()
        const r = rolloutToCap(s, 0, DEFAULT_ROLLOUT_COMMAND_CAP, DEFAULT_WEIGHTS, undefined, applyCap, profile)
        expect(profiledApplies(profile), `applyCap=${applyCap} steps=${steps}: attribution does not reconcile`).toBe(r.applies)
        bound.push(profile.refusals > 0)
      }
    }
    // The fixture must actually exercise both regimes, or "both" is a word rather than a test.
    expect(bound.some(Boolean), 'the apply cap never bound, so the refusal path is untested').toBe(true)
    expect(bound.some((b) => !b), 'the apply cap always bound, so the unrefused path is untested').toBe(true)
  })

  it('counts candidates generated separately from candidates scored', () => {
    // They differ exactly when the cap refuses one, which is the size of the work the existing cap already
    // declines to do — a number the next policy decision needs and that no counter reported before.
    const s = midGame(3, 14)
    const profile = newRolloutProfile()
    rolloutToCap(s, 0, DEFAULT_ROLLOUT_COMMAND_CAP, DEFAULT_WEIGHTS, undefined, 16, profile)
    expect(profile.loopGenerated).toBeGreaterThanOrEqual(profile.loopScored)
    expect(profile.resolverGenerated).toBeGreaterThanOrEqual(profile.resolverScored)
    const generated = profile.loopGenerated + profile.resolverGenerated
    const scored = profile.loopScored + profile.resolverScored
    expect(generated, 'nothing was generated, so the fixture proves nothing').toBeGreaterThan(0)
    expect(generated, 'generated never exceeded scored, so the two counters are indistinguishable here').toBeGreaterThan(scored)
  })

  it('a scored candidate costs exactly one apply in its own bucket', () => {
    // The identity D6 assumed for the WHOLE rollout, which is only true per candidate: one apply to try the
    // command, and then however many its forced resolution needs — which land in the forced buckets, not this
    // one. This is the assertion that pins that split rather than restating it.
    const s = midGame(3, 14)
    const profile = newRolloutProfile()
    rolloutToCap(s, 0, DEFAULT_ROLLOUT_COMMAND_CAP, DEFAULT_WEIGHTS, undefined, 100_000, profile)
    expect(profile.loopScoringApplies).toBe(profile.loopScored)
    expect(profile.resolverScoringApplies).toBe(profile.resolverScored)
  })

  it('the loop advances exactly once per command it chose — and the state really moved', () => {
    // `loopAdvanceApplies === r.commands` alone is satisfied by DELETING the transition it counts: both are
    // incremented next to each other, so a rollout that never advances still reports twelve commands and
    // twelve applies. Codex ran exactly that mutation and the equality held while the state came back
    // byte-identical. So the state has to be part of the assertion.
    const s = midGame(3, 10)
    const profile = newRolloutProfile()
    const r = rolloutToCap(s, 0, DEFAULT_ROLLOUT_COMMAND_CAP, DEFAULT_WEIGHTS, undefined, 100_000, profile)
    expect(profile.loopAdvanceApplies).toBe(r.commands)
    expect(r.commands, 'the rollout played nothing, so there is no advancing to check').toBeGreaterThan(0)
    expect(r.state, 'the rollout counted commands it never played').not.toEqual(s)
  })

  it('a forced pending answered by the LOOP is loop-scoped, and the settlement tail is its own scope', () => {
    // The convention the first version of this left unpinned. When a chosen command leaves a pending, the
    // next turn of the rollout loop answers it — that is a forced decision, but it is the LOOP doing it, and
    // the counters say so. Codex showed a mutation reading `depth > 0 || isForcedDecision(state)` survived
    // every other test here while moving all of that work into the resolver bucket.
    let s = withHandSize(makeGame({ seed: 4 }), 0, 5)
    let atk: CardId
    ;[s, atk] = withField(s, 0, 'forwards', 'V-F5')
    ;[s] = withField(s, 1, 'forwards', 'V-F3')
    s = apply(s, { type: 'pass', player: 0 }).state
    const attack = legalCommands(s, 0).find((c) => c.type === 'declareAttack' && c.attackers.includes(atk))
    expect(attack, 'the fixture cannot declare the attack it needs').toBeDefined()
    const before = s          // at the DECLARATION: one command later there is a block outstanding
    s = apply(s, attack!).state
    expect(s.pending?.kind, 'the fixture does not start on a forced pending').toBe('declareBlock')

    // cap 1: the loop answers the block as its single command. That is a FORCED decision done by the loop.
    const profile = newRolloutProfile()
    rolloutToCap(s, 0, 1, DEFAULT_WEIGHTS, undefined, 100_000, profile)
    expect(profile.loopScored, 'the block was not scored by the loop').toBeGreaterThan(0)

    // And the tail, which needs a rollout that STOPS with a pending outstanding: stop at the declaration, so
    // the one command the loop plays is the attack and the block is left for the settlement call. The tail is
    // counted apart from per-candidate resolution because it advances the real rollout — without that split
    // "evaluation" and "trajectory" cannot be told apart at all.
    const tail = newRolloutProfile()
    rolloutToCap(before, 0, 1, DEFAULT_WEIGHTS, undefined, 100_000, tail)
    expect(tail.tailScoringApplies + tail.tailAdvanceApplies, 'the settlement tail did no work, so its scope is untested').toBeGreaterThan(0)
  })

  it('resets its per-rollout working state when a profile is reused', () => {
    // One profile is shared by every rollout in a search. `command` used to survive into the next rollout, so
    // a refusal on the next rollout's FIRST command reported the previous rollout's length (Codex MINOR).
    const s = midGame(3, 14)
    const profile = newRolloutProfile()
    rolloutToCap(s, 0, DEFAULT_ROLLOUT_COMMAND_CAP, DEFAULT_WEIGHTS, undefined, 100_000, profile)
    expect(profile.firstRefusalAtCommand, 'the unbound rollout already refused, so the sequence proves nothing').toBe(-1)
    expect(profile.command, 'the first rollout played nothing').toBeGreaterThan(0)
    // Now a rollout that refuses immediately: the answer must be 0, not the previous rollout's command count.
    rolloutToCap(s, 0, DEFAULT_ROLLOUT_COMMAND_CAP, DEFAULT_WEIGHTS, undefined, 1, profile)
    expect(profile.refusals, 'the tight cap did not refuse anything').toBeGreaterThan(0)
    expect(profile.firstRefusalAtCommand, "the refusal was dated by the PREVIOUS rollout's command count").toBe(0)
  })

  it('separates the two scopes — a candidate that opens nothing costs nothing forced', () => {
    // The reconciliation test above cannot see this: moving every apply into one bucket keeps the SUM right,
    // and a mutation that did exactly that passed everything until this test existed. The split IS the
    // finding, so it needs a case where the right answer is known in advance.
    //
    // VANILLA_POOL has no abilities, so in the Main Phase a cast opens no pending at all: the candidates the
    // policy scores resolve to nothing, and every apply must land in the POLICY buckets.
    let s = withHandSize(makeGame({ seed: 4 }), 0, 5)
    expect(s.phase, 'the fixture is not in the phase it claims').toBe('main1')
    expect(s.pending, 'a pending here would be answered as a policy step and prove nothing').toBeNull()
    const quiet = newRolloutProfile()
    rolloutToCap(s, 0, 1, DEFAULT_WEIGHTS, undefined, 100_000, quiet)
    expect(quiet.loopScoringApplies, 'the policy scored nothing, so the fixture proves nothing').toBeGreaterThan(0)
    expect(quiet.resolverScoringApplies, 'a vanilla cast opened a forced decision, which it cannot').toBe(0)
    expect(quiet.resolverAdvanceApplies).toBe(0)

    // Now a position where scoring a candidate MUST open one: declaring an attack owes the defender a block,
    // and `greedyStep` resolves that before it can price the attack.
    let atk: number
    ;[s, atk] = withField(withHandSize(makeGame({ seed: 4 }), 0, 5), 0, 'forwards', 'V-F5')
    ;[s] = withField(s, 1, 'forwards', 'V-F3')
    s = apply(s, { type: 'pass', player: 0 }).state    // into the Attack Phase
    expect(s.phase).toBe('attack')
    expect(legalCommands(s, 0).some((c) => c.type === 'declareAttack'), 'no attack is available, so nothing forces a block').toBe(true)
    const combat = newRolloutProfile()
    rolloutToCap(s, 0, 1, DEFAULT_WEIGHTS, undefined, 100_000, combat)
    // `resolverScoringApplies` specifically, not the pair: `resolverAdvanceApplies` is counted inside
    // `resolveForcedDecisions` regardless of scope, so summing them would pass even if the scope were
    // collapsed — which is exactly the mutation that survived the first version of this test.
    expect(combat.resolverScoringApplies, 'the nested block choice was attributed to the policy').toBeGreaterThan(0)
    void atk
  })

  it('measuring does not move what is measured', () => {
    // D7-A3/A4 together: the profile is diagnostic, so the same seed and root must produce the same command
    // whether or not anyone is counting. If this ever fails the numbers above describe a different search.
    const s = midGame(3, 12)
    const input = {
      view: viewFor(s, 0), decks: [DEFAULT_DECK, DEFAULT_DECK] as [string[], string[]],
      iterations: 40, seed: 99, rolloutCommandCap: DEFAULT_ROLLOUT_COMMAND_CAP, explorationC: 1.4,
    }
    const plain = searchIsmcts(input)
    const profiled = searchIsmcts({ ...input, profile: true })
    expect(profiled.command).toEqual(plain.command)
    expect(profiled.diagnostics.rolloutApplies).toBe(plain.diagnostics.rolloutApplies)
    expect(plain.diagnostics.rollout, 'an unprofiled search reported an attribution').toBeUndefined()
    expect(profiled.diagnostics.rollout, 'a profiled search reported none').toBeDefined()
    // ...and the attribution reconciles with the search's own independent apply counter.
    expect(profiledApplies(profiled.diagnostics.rollout!)).toBe(profiled.diagnostics.rolloutApplies)
  })
})
