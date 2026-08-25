import { describe, expect, it } from 'vitest'
import { actingPlayer, apply, createGame, legalCommands, viewFor, type Command, type GameState } from '@fftcg/engine'
import { GreedyAgent, greedyStep } from '../src/greedy.js'
import { candidateCommands } from '../src/candidates.js'
import { DEFAULT_WEIGHTS, type Weights } from '../src/evaluate.js'
import { DEFAULT_DECK, VANILLA_POOL, makeGame, withField, withHandSize } from '../../engine/test/helpers.js'

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
const ZERO_WEIGHTS: Weights = { damage: 0, forwardPower: 0, forwardPresence: 0, dullFactor: 0, backup: 0, hand: 0, handQuality: 0, deck: 0, threat: 0, terminal: 0 }

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
  it('adaptive depth 2 at declaration: does not attack a 3000 into an active 7000 blocker for no gain (F1)', () => {
    let s = withHandSize(makeGame(), 0, 5)
    ;[s] = withField(s, 0, 'forwards', 'V-F1')   // 3000
    ;[s] = withField(s, 1, 'forwards', 'V-F3')   // 7000 active blocker
    s = toAttackDeclaration(s)
    const a1 = agent(s)
    expect(a1.decide(viewFor(s, 0), legalCommands(s, 0)).type).toBe('pass')
    expect(a1.lastDepth).toBe(2)   // declaration forces depth >= 2 regardless of the configured depth
    const a2 = agent(s, 1, 2)
    expect(a2.decide(viewFor(s, 0), legalCommands(s, 0)).type).toBe('pass')   // depth 2 agrees
    expect(a2.lastDepth).toBe(2)
  })
  it('F1: greedyStep has the opponent attack with an unblockable 7000 rather than pass', () => {
    // Rollouts must fight: before the fix, greedyStep scored apply(declareAttack) immediately (a dulled forward,
    // no damage yet), which always looked worse than pass, so simulated attackers never attacked.
    let s = withHandSize(makeGame(), 0, 0)
    s = withHandSize(s, 1, 0)
    ;[s] = withField(s, 1, 'forwards', 'V-F3')   // opponent's active 7000; my board is empty (no blockers)
    s = apply(s, { type: 'pass', player: 0 }).state   // main1 -> attack declaration
    s = apply(s, { type: 'pass', player: 0 }).state   // attack declaration -> main2
    s = apply(s, { type: 'pass', player: 0 }).state   // main2 -> end phase -> player 1's turn
    s = apply(s, { type: 'pass', player: 1 }).state   // player 1's main1 -> attack declaration
    const cmd = greedyStep(s, 1, DEFAULT_WEIGHTS, 0.5)
    expect(cmd?.type).toBe('declareAttack')
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
  it('F2: honours the documented simulation budget lastSimulations <= maxSimulations + lastCandidates', () => {
    let s = withHandSize(makeGame(), 0, 5)
    ;[s] = withField(s, 0, 'forwards', 'V-F1')
    s = toAttackDeclaration(s)
    const a = new GreedyAgent({ seed: 1, decks: decksOf(s), depth: 1, maxSimulations: 6 })
    a.decide(viewFor(s, 0), legalCommands(s, 0))
    expect(a.lastDepth).toBe(2)
    expect(a.lastSimulations).toBeLessThanOrEqual(6 + a.lastCandidates)
  })
  it('F2: prunes an oversized candidate list to maxSimulations, keeping pass among the candidates', () => {
    let s = withHandSize(makeGame(), 0, 5)
    for (let i = 0; i < 8; i++) [s] = withField(s, 0, 'forwards', 'V-F1')
    s = toAttackDeclaration(s)
    const full = candidateCommands(s, 0)
    expect(full.length).toBeGreaterThan(5)   // 8 singles + at least 1 same-element party + pass
    const a = new GreedyAgent({ seed: 1, decks: decksOf(s), depth: 1, maxSimulations: 5 })
    a.decide(viewFor(s, 0), legalCommands(s, 0))
    expect(a.lastCandidates).toBeLessThanOrEqual(5)
  })
  it('F5: at createGame (chooseFirst pending) both candidates are scored at depth 0, without a rollout', () => {
    const s = createGame({ seed: 1, decks: [DEFAULT_DECK, DEFAULT_DECK], defs: VANILLA_POOL })
    const a = new GreedyAgent({ seed: 1, decks: [DEFAULT_DECK, DEFAULT_DECK] })
    a.decide(viewFor(s, s.pending?.kind === 'chooseFirst' ? s.pending.player : 0), legalCommands(s, s.pending?.kind === 'chooseFirst' ? s.pending.player : 0))
    expect(a.lastDepth).toBe(0)
    expect(a.lastSimulations).toBe(a.lastCandidates)
  })
  it('honors configured depth outside declaration: depth 1 stops at end of my turn, depth 2 continues through the opponent\'s turn', () => {
    const s = withHandSize(makeGame(), 0, 5)   // fresh main1, not attack declaration
    const a1 = new GreedyAgent({ seed: 1, decks: decksOf(s), depth: 1 })
    a1.decide(viewFor(s, 0), legalCommands(s, 0))
    expect(a1.lastDepth).toBe(1)
    const a2 = new GreedyAgent({ seed: 1, decks: decksOf(s), depth: 2 })
    a2.decide(viewFor(s, 0), legalCommands(s, 0))
    expect(a2.lastDepth).toBe(2)
  })
  it('minor (a): breaks score ties in favor of the earlier candidate', () => {
    const s = withHandSize(makeGame(), 0, 5)
    const cands = candidateCommands(s, 0)
    expect(cands.length).toBeGreaterThan(1)
    const cmd = greedyStep(s, 0, ZERO_WEIGHTS, 0.5)
    expect(cmd).toEqual(cands[0])
    expect(cmd?.type).not.toBe('pass')   // pass is always last by contract, so the first candidate is a real move here
  })
  it('minor (b): falls back to a non-concede legal command when candidates are empty', () => {
    const s = makeGame()   // player 0 is the acting player, so decide()-as-player-1 has no candidates
    const a = agent(s)
    const fakeLegal: Command[] = [{ type: 'concede', player: 1 }, { type: 'pass', player: 1 }]
    expect(a.decide(viewFor(s, 1), fakeLegal)).toEqual({ type: 'pass', player: 1 })
  })
  it('minor (b): throws when neither candidates nor a non-concede legal command exist', () => {
    const s = makeGame()
    const a = agent(s)
    expect(() => a.decide(viewFor(s, 1), [{ type: 'concede', player: 1 }])).toThrow()
  })
  it('F7: is deterministic over a whole game — two fresh agents with the same seed produce identical traces', () => {
    const play = (): Command[] => {
      let s = makeGame({ seed: 5 })
      const agents = [new GreedyAgent({ seed: 11, decks: decksOf(s), maxSimulations: 15 }), new GreedyAgent({ seed: 11, decks: decksOf(s), maxSimulations: 15 })]
      const trace: Command[] = []
      for (let step = 0; step < 40 && !s.result; step++) {
        const p = actingPlayer(s)
        if (p === null) break
        const cmd = agents[p]!.decide(viewFor(s, p), legalCommands(s, p))
        trace.push(cmd)
        s = apply(s, cmd).state
      }
      return trace
    }
    expect(play()).toEqual(play())
  })
})
