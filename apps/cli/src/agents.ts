import { GreedyAgent, RandomAgent, type Agent } from '@fftcg/ai'

export type AgentSpec = { kind: 'random' } | { kind: 'greedy'; depth?: 0 | 1 | 2 }

/** Parses `random | greedy | greedy:0 | greedy:1 | greedy:2`; throws on anything else. */
export function parseAgentSpec(s: string): AgentSpec {
  if (s === 'random') return { kind: 'random' }
  if (s === 'greedy') return { kind: 'greedy' }
  const m = /^greedy:([0-2])$/.exec(s)
  if (m) return { kind: 'greedy', depth: Number(m[1]) as 0 | 1 | 2 }
  throw new Error(`unknown agent spec "${s}" (expected random | greedy | greedy:0 | greedy:1 | greedy:2)`)
}

export function describeAgentSpec(spec: AgentSpec): string {
  if (spec.kind === 'random') return 'random'
  return spec.depth === undefined ? 'greedy' : `greedy:${spec.depth}`
}

/**
 * Builds a fresh agent for one seat. Self-play constructs one of these per game per seat, seeded
 * `(seed + g) * 2 + p + 1` (see `selfplay.ts`) so seat and game vary the stream independently of the
 * legacy `seed * 2 + 1/2` random-vs-random scheme.
 */
export function makeAgent(spec: AgentSpec, seed: number, decks: [string[], string[]]): Agent {
  if (spec.kind === 'random') return new RandomAgent(seed)
  return new GreedyAgent(spec.depth === undefined ? { seed, decks } : { seed, decks, depth: spec.depth })
}
