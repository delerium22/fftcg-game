import { describe, expect, it } from 'vitest'
import { legalCommands, viewFor, type GameState } from '@fftcg/engine'
import { GreedyAgent, scoreCandidates } from '../src/greedy.js'
import { DEFAULT_WEIGHTS } from '../src/evaluate.js'
import { VANILLA_POOL, attackInto, endPhase, makeDef, makeGame, withField, withHandSize } from '../../engine/test/helpers.js'

/**
 * Rung J3 (spec J3-D5/J3-A6): the AI needs no First Strike code of its own — it prices a block by APPLYING it
 * and scoring the result, and the engine's split damage step is what it applies. The positions below differ only
 * in whether the attacker has the keyword; the block's score, and where the outcome differs the decision, follow.
 */

const decksOf = (s: GameState): [string[], string[]] => ([0, 1] as const).map((p) => {
  const q = s.players[p]
  return [...q.deck, ...q.hand, ...q.forwards.map((c) => c.id), ...q.backups.map((c) => c.id), ...q.damageZone, ...q.breakZone, ...q.removedFromGame].map((id) => s.cards[id]!.code)
}) as [string[], string[]]

const DEFS = [
  ...VANILLA_POOL,
  makeDef({ code: 'T-FS6', cost: 0, power: 6000, keywords: ['firstStrike'] }),
  makeDef({ code: 'T-FS5', cost: 0, power: 5000, keywords: ['firstStrike'] }),
  makeDef({ code: 'T-5', cost: 0, power: 5000 }),
]

/** Player 0 attacks with `attacker` into player 1, who holds `blockerCode`; the block decision is player 1's. */
function blockDecision(attackerCode: string, blockerCode: string): GameState {
  let s = withHandSize(withHandSize(makeGame({ defs: DEFS }), 0, 5), 1, 5)
  let a: number
  ;[s, a] = withField(s, 0, 'forwards', attackerCode)
  ;[s] = withField(s, 1, 'forwards', blockerCode)
  s = attackInto(endPhase(s), [a]).state
  expect(s.pending).toEqual({ kind: 'declareBlock', player: 1 })
  return s
}
const decide = (s: GameState) => new GreedyAgent({ seed: 1, decks: decksOf(s), depth: 1 }).decide(viewFor(s, 1), legalCommands(s, 1))

describe('greedy prices First Strike through the engine (J3-A6)', () => {
  it('blocks a 5000 First Strike attacker with a 7000 Forward: the blocker survives the first batch and kills the attacker in the second', () => {
    const d = decide(blockDecision('T-FS5', 'V-F3'))
    expect(d.type).toBe('declareBlock')
    expect(d.type === 'declareBlock' && d.blocker, 'the block is free: 5000 into 7000, then 7000 back').not.toBeNull()
  })

  it('scores the same block lower when the attacker has First Strike: 5000 into 5000 is a trade without the keyword and a one-sided kill with it', () => {
    // Greedy chump-blocks in both positions (a point of damage outweighs the Forward for it), so the DECISION does
    // not flip — the SCORE does, and that is the engine's split step showing through: without the keyword both
    // Forwards die; with it, only the blocker does.
    const scoreOfBlock = (s: GameState): number => {
      const cands = legalCommands(s, 1).filter((c) => c.type === 'declareBlock')
      const scores = scoreCandidates(s, cands, { me: 1, weights: DEFAULT_WEIGHTS, aggression: 0.5, depth: 1, owner: s.turnPlayer, maxSimulations: 200 })
      return scores.find((sc) => sc.command.type === 'declareBlock' && sc.command.blocker !== null)!.score
    }
    const withKeyword = scoreOfBlock(blockDecision('T-FS5', 'V-F2'))
    const without = scoreOfBlock(blockDecision('T-5', 'V-F2'))
    expect(withKeyword, 'blocking a First Strike attacker must look worse than blocking the same power without it').toBeLessThan(without)
  })
})
