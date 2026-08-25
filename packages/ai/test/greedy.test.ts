import { describe, expect, it } from 'vitest'
import { apply, legalCommands, viewFor, type GameState } from '@fftcg/engine'
import { GreedyAgent } from '../src/greedy.js'
import { makeGame, withField, withHandSize } from '../../engine/test/helpers.js'

/** withField/withHand MINT extra card instances, so deck lists must be derived from the state under test, not DEFAULT_DECK. */
const decksOf = (s: GameState): [string[], string[]] => ([0, 1] as const).map((p) => {
  const q = s.players[p]
  return [...q.deck, ...q.hand, ...q.forwards.map((c) => c.id), ...q.backups.map((c) => c.id), ...q.damageZone, ...q.breakZone].map((id) => s.cards[id]!.code)
}) as [string[], string[]]
const agent = (s: GameState, seed = 1, depth: 0 | 1 | 2 = 1) => new GreedyAgent({ seed, decks: decksOf(s), depth })
const hurt = (s: GameState, p: 0 | 1, n: number): GameState => {
  const ps = s.players[p]
  const players = [s.players[0], s.players[1]] as typeof s.players
  players[p] = { ...ps, damageZone: ps.deck.slice(0, n), deck: ps.deck.slice(n) }
  return { ...s, players }
}
const toAttackDeclaration = (s: GameState): GameState => apply(s, { type: 'pass', player: 0 }).state

describe('GreedyAgent', () => {
  it('is deterministic per seed and never concedes', () => {
    const s = makeGame()
    const a = agent(s, 7).decide(viewFor(s, 0), legalCommands(s, 0)), b = agent(s, 7).decide(viewFor(s, 0), legalCommands(s, 0))
    expect(a).toEqual(b); expect(a.type).not.toBe('concede')
  })
  it('takes lethal: attacks when the opponent is at 6 damage and cannot block', () => {
    let s = withHandSize(makeGame(), 0, 5); let f: number
    ;[s, f] = withField(s, 0, 'forwards', 'V-F2')
    s = toAttackDeclaration(hurt(s, 1, 6))
    expect(agent(s).decide(viewFor(s, 0), legalCommands(s, 0))).toEqual({ type: 'declareAttack', player: 0, attackers: [f] })
  })
  it('does not attack a 3000 into an active 7000 blocker for no gain (depth 1)', () => {
    let s = withHandSize(makeGame(), 0, 5)
    ;[s] = withField(s, 0, 'forwards', 'V-F1')   // 3000
    ;[s] = withField(s, 1, 'forwards', 'V-F3')   // 7000 active blocker
    s = toAttackDeclaration(s)
    expect(agent(s).decide(viewFor(s, 0), legalCommands(s, 0)).type).toBe('pass')
    expect(agent(s, 1, 2).decide(viewFor(s, 0), legalCommands(s, 0)).type).toBe('pass')   // depth 2 agrees
  })
  it('blocks a lethal attack when it can', () => {
    let s = withHandSize(makeGame(), 0, 5); let a: number, b: number
    ;[s, a] = withField(s, 0, 'forwards', 'V-F1')   // attacker 3000
    ;[s, b] = withField(s, 1, 'forwards', 'V-F3')   // blocker 7000
    s = toAttackDeclaration(hurt(s, 1, 6))
    s = apply(s, { type: 'declareAttack', player: 0, attackers: [a] }).state
    expect(agent(s).decide(viewFor(s, 1), legalCommands(s, 1))).toEqual({ type: 'declareBlock', player: 1, blocker: b })
  })
  it('returns a legal command on turn 1 and reports its simulation count', () => {
    const s = makeGame()
    const a = agent(s)
    const cmd = a.decide(viewFor(s, 0), legalCommands(s, 0))
    expect(() => apply(s, cmd)).not.toThrow()
    expect(a.lastSimulations).toBeGreaterThan(0); expect(a.lastCandidates).toBeGreaterThan(0)
  })
  it('uses depth 2 at the attack declaration step (spec A2) and honours the per-candidate budget', () => {
    let s = withHandSize(makeGame(), 0, 5)
    ;[s] = withField(s, 0, 'forwards', 'V-F1')
    s = toAttackDeclaration(s)
    const a = new GreedyAgent({ seed: 1, decks: decksOf(s), depth: 1, maxSimulations: 6 })
    a.decide(viewFor(s, 0), legalCommands(s, 0))
    expect(a.lastDepth).toBe(2)
    expect(a.lastSimulations).toBeLessThanOrEqual(a.lastCandidates * Math.max(1, Math.floor(6 / a.lastCandidates)))
  })
})
