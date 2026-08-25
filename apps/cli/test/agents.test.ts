import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { GreedyAgent, RandomAgent } from '@fftcg/ai'
import { loadCards } from '@fftcg/cards'
import { parseDeckFile } from '../src/deck.js'
import { describeAgentSpec, makeAgent, parseAgentSpec, parseDepth, type AgentSpec } from '../src/agents.js'
import { selfPlay } from '../src/selfplay.js'

describe('parseAgentSpec', () => {
  it('accepts random', () => { expect(parseAgentSpec('random')).toEqual({ kind: 'random' }) })
  it('accepts greedy with no depth', () => { expect(parseAgentSpec('greedy')).toEqual({ kind: 'greedy' }) })
  it('accepts greedy:0', () => { expect(parseAgentSpec('greedy:0')).toEqual({ kind: 'greedy', depth: 0 }) })
  it('accepts greedy:2', () => { expect(parseAgentSpec('greedy:2')).toEqual({ kind: 'greedy', depth: 2 }) })
  it('throws on greedy:3', () => { expect(() => parseAgentSpec('greedy:3')).toThrow() })
  it('throws on unknown spec', () => { expect(() => parseAgentSpec('foo')).toThrow() })
})

describe('C7: parseDepth (shared by greedy:N and --depth)', () => {
  it('accepts 0, 1, 2', () => {
    expect(parseDepth('0')).toBe(0)
    expect(parseDepth('1')).toBe(1)
    expect(parseDepth('2')).toBe(2)
  })
  it('throws on out-of-range, non-integer, or malformed input', () => {
    for (const bad of ['3', '-1', '1.5', 'abc', '', '01', ' 1']) expect(() => parseDepth(bad)).toThrow()
  })
})

describe('describeAgentSpec', () => {
  it('round-trips random', () => { expect(describeAgentSpec(parseAgentSpec('random'))).toBe('random') })
  it('round-trips bare greedy', () => { expect(describeAgentSpec(parseAgentSpec('greedy'))).toBe('greedy') })
  it('round-trips greedy:0', () => { expect(describeAgentSpec(parseAgentSpec('greedy:0'))).toBe('greedy:0') })
  it('round-trips greedy:2', () => { expect(describeAgentSpec(parseAgentSpec('greedy:2'))).toBe('greedy:2') })
})

describe('makeAgent', () => {
  it('builds a RandomAgent for a random spec', () => {
    const agent = makeAgent({ kind: 'random' }, 1, [['A-1'], ['A-1']])
    expect(agent).toBeInstanceOf(RandomAgent)
    expect(agent.needsLegalCommands).toBe(true)
  })
  it('builds a GreedyAgent for a greedy spec with needsLegalCommands false', () => {
    const agent = makeAgent({ kind: 'greedy', depth: 2 }, 1, [['A-1'], ['A-1']])
    expect(agent).toBeInstanceOf(GreedyAgent)
    expect(agent.needsLegalCommands).toBe(false)
  })
  it('builds a GreedyAgent without an explicit depth', () => {
    const agent = makeAgent({ kind: 'greedy' }, 1, [['A-1'], ['A-1']])
    expect(agent).toBeInstanceOf(GreedyAgent)
  })
})

describe('selfPlay determinism', () => {
  it('two identical runs produce identical reports (ignoring timing)', () => {
    const deck = parseDeckFile(readFileSync(new URL('../../../decks/starter-2025-vol2.txt', import.meta.url), 'utf8'))
    const opts = { games: 5, seed: 900, decks: [deck, deck] as [string[], string[]], defs: loadCards(), agents: [{ kind: 'greedy' as const }, { kind: 'random' as const }] as [AgentSpec, AgentSpec], strict: false }
    const r1 = selfPlay(opts)
    const r2 = selfPlay(opts)
    // timing is inherently non-deterministic (wall clock); neutralize it before comparing the rest of the report
    const strip = (r: typeof r1) => ({ ...r, msPerDecision: [0, 0] as [number, number] })
    expect(strip(r1)).toEqual(strip(r2))
  }, 60_000)
})
