import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { GreedyAgent, IsmctsAgent, RandomAgent } from '@fftcg/ai'
import { loadCards } from '@fftcg/cards'
import { actingPlayer, apply, createGame, legalCommands, viewFor } from '@fftcg/engine'
import type { Agent } from '@fftcg/ai'
import { parseDeckFile } from '../src/deck.js'
import { MAX_ITERATIONS, describeAgentSpec, makeAgent, parseAgentSpec, parseDepth, parseIterations, parsePositiveInt, type AgentSpec } from '../src/agents.js'
import { selfPlay } from '../src/selfplay.js'

const deck = (): string[] => parseDeckFile(readFileSync(new URL('../../../decks/starter-2025-vol2.txt', import.meta.url), 'utf8'))
const decks = (): [string[], string[]] => { const d = deck(); return [d, d] }

describe('parseAgentSpec', () => {
  it('accepts random', () => { expect(parseAgentSpec('random')).toEqual({ kind: 'random' }) })
  it('accepts greedy with no depth', () => { expect(parseAgentSpec('greedy')).toEqual({ kind: 'greedy' }) })
  it('accepts greedy:0', () => { expect(parseAgentSpec('greedy:0')).toEqual({ kind: 'greedy', depth: 0 }) })
  it('accepts greedy:2', () => { expect(parseAgentSpec('greedy:2')).toEqual({ kind: 'greedy', depth: 2 }) })
  it('throws on greedy:3', () => { expect(() => parseAgentSpec('greedy:3')).toThrow() })
  it('throws on unknown spec', () => { expect(() => parseAgentSpec('foo')).toThrow() })

  // D1
  it('accepts ismcts with no iteration count', () => { expect(parseAgentSpec('ismcts')).toEqual({ kind: 'ismcts' }) })
  it('accepts ismcts:1', () => { expect(parseAgentSpec('ismcts:1')).toEqual({ kind: 'ismcts', iterations: 1 }) })
  it('accepts ismcts:1000', () => { expect(parseAgentSpec('ismcts:1000')).toEqual({ kind: 'ismcts', iterations: 1000 }) })
  it('accepts ismcts at the cap', () => { expect(parseAgentSpec(`ismcts:${MAX_ITERATIONS}`)).toEqual({ kind: 'ismcts', iterations: MAX_ITERATIONS }) })
  it('throws on every malformed iteration count', () => {
    // Each of these is a value `Number()` would have accepted (or silently turned into NaN) had the parser used
    // it: 0 iterations searches nothing, and '1e3'/' 1'/'0x10' are typos, not budgets.
    for (const bad of ['ismcts:0', 'ismcts:-1', 'ismcts:1.5', 'ismcts:1e3', 'ismcts:0x10', 'ismcts:abc', 'ismcts:', 'ismcts:01', 'ismcts: 1', 'ismcts:1 ', `ismcts:${MAX_ITERATIONS + 1}`]) {
      expect(() => parseAgentSpec(bad), bad).toThrow()
    }
  })
  it('throws on a spec that only looks like ismcts', () => {
    for (const bad of ['ISMCTS', 'ismcts2', 'ismcts::1', ' ismcts']) expect(() => parseAgentSpec(bad), bad).toThrow()
  })
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

describe('D1: parsePositiveInt (shared by ismcts:N, --iterations, --pairs, --games, --bootstrap)', () => {
  it('accepts positive integers up to the cap', () => {
    expect(parsePositiveInt('1', 'x', 10)).toBe(1)
    expect(parsePositiveInt('10', 'x', 10)).toBe(10)
  })
  it('rejects zero, negatives, decimals, exponents, hex, padding and blanks', () => {
    for (const bad of ['0', '-1', '1.5', '1e3', '0x10', '+1', '01', ' 1', '1 ', '', 'abc', 'Infinity', 'NaN']) {
      expect(() => parsePositiveInt(bad, 'x', 10), bad).toThrow()
    }
  })
  it('rejects above the cap and names what was wrong', () => {
    expect(() => parsePositiveInt('11', 'iterations', 10)).toThrow(/iterations/)
  })
  it('parseIterations applies the shared cap', () => {
    expect(parseIterations('500')).toBe(500)
    expect(() => parseIterations(String(MAX_ITERATIONS + 1))).toThrow()
  })
})

describe('describeAgentSpec', () => {
  it('round-trips random', () => { expect(describeAgentSpec(parseAgentSpec('random'))).toBe('random') })
  it('round-trips bare greedy', () => { expect(describeAgentSpec(parseAgentSpec('greedy'))).toBe('greedy') })
  it('round-trips greedy:0', () => { expect(describeAgentSpec(parseAgentSpec('greedy:0'))).toBe('greedy:0') })
  it('round-trips greedy:2', () => { expect(describeAgentSpec(parseAgentSpec('greedy:2'))).toBe('greedy:2') })
  it('round-trips bare ismcts', () => { expect(describeAgentSpec(parseAgentSpec('ismcts'))).toBe('ismcts') })
  it('round-trips ismcts:250', () => { expect(describeAgentSpec(parseAgentSpec('ismcts:250'))).toBe('ismcts:250') })
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
  it('D1: builds an IsmctsAgent, with and without an explicit iteration count', () => {
    expect(makeAgent({ kind: 'ismcts' }, 1, [['A-1'], ['A-1']])).toBeInstanceOf(IsmctsAgent)
    expect(makeAgent({ kind: 'ismcts', iterations: 16 }, 1, [['A-1'], ['A-1']])).toBeInstanceOf(IsmctsAgent)
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

// ---------------------------------------------------------------------------
// Rung C3 — the agents must actually USE activated abilities
// ---------------------------------------------------------------------------

describe('activated abilities reach the agents (C3-A1)', () => {
  // Being legal is not enough. `candidateCommands` hand-builds the list both agents search, so a command that
  // exists only in `legalCommands` is invisible to them — the plan review caught exactly that, and this is the
  // test that would have failed. It asserts the agents CHOOSE an activation over a real sweep, not merely that
  // one was offered.
  const chosen = new Map<string, number>()
  for (let seed = 1; seed <= 40 && chosen.size === 0; seed++) {
    const d = decks()
    const defs = loadCards()
    const agents: [Agent, Agent] = [
      new GreedyAgent({ seed, decks: d, depth: 1 }),
      new GreedyAgent({ seed: seed + 1000, decks: d, depth: 1 }),
    ]
    let s = createGame({ seed, decks: d, defs })
    for (let i = 0; i < 800 && !s.result; i++) {
      const p = actingPlayer(s)
      if (p === null) break
      const command = agents[p].decide(viewFor(s, p), legalCommands(s, p))
      if (command.type === 'activateAbility') chosen.set(command.abilityId, (chosen.get(command.abilityId) ?? 0) + 1)
      s = apply(s, command).state
    }
  }

  it('greedy chooses an activation at least once across the sweep', () => {
    expect(chosen.size, 'no agent ever used an activated ability — they are legal but unreachable').toBeGreaterThan(0)
  })

  it('every activation it chose is one of the six C3 clauses', () => {
    const C3 = ['1-121C:haste', '16-092C:dull-all', '18-064C:draw', '18-069C:draw', '19-052C:pump', '20-074C:draw']
    for (const id of chosen.keys()) expect(C3).toContain(id)
  })
})
