import { GreedyAgent, IsmctsAgent, RandomAgent, type Agent } from '@fftcg/ai'

export type AgentSpec =
  | { kind: 'random' }
  | { kind: 'greedy'; depth?: 0 | 1 | 2 }
  | { kind: 'ismcts'; iterations?: number; rolloutCap?: number; profile?: boolean }

/** Upper bound on `ismcts:N`. Not a performance claim — a typo guard, so `ismcts:100000000` fails at the flag
 *  rather than after an hour of wall clock. D1's measured floor is ~107 µs per determinisation. */
export const MAX_ITERATIONS = 1_000_000

/** C7: parses a bare depth string ("0"|"1"|"2"); throws on anything else (including "3", negatives, decimals,
 *  leading zeros/whitespace, or non-numeric input). Shared by parseAgentSpec's `greedy:N` suffix and main.ts's
 *  `--depth` flag so both are validated identically. */
export function parseDepth(s: string): 0 | 1 | 2 {
  if (!/^[0-2]$/.test(s)) throw new Error(`invalid depth "${s}" (expected 0, 1, or 2)`)
  return Number(s) as 0 | 1 | 2
}

/**
 * D1: the same strictness `parseDepth` applies, for the unbounded-domain flags. The regex — not `Number()` —
 * is what does the work: `Number` coerces `''`, `' 1'`, `'1.0'`, `'1e3'` and `'0x10'` into perfectly good
 * numbers, and a silently-coerced iteration count is a measurement bug that reads as a strength difference.
 */
export function parsePositiveInt(s: string, what: string, max: number): number {
  if (!/^[1-9][0-9]*$/.test(s)) throw new Error(`invalid ${what} "${s}" (expected a positive integer)`)
  const n = Number(s)
  if (n > max) throw new Error(`invalid ${what} "${s}" (max ${max})`)
  return n
}

export const parseIterations = (s: string): number => parsePositiveInt(s, 'iterations', MAX_ITERATIONS)

/**
 * Upper bound on `--rollout-cap`. A rollout walks COMMANDS, and a game is over long before 4096 of them, so
 * anything larger is a typo rather than an intent — the same typo-guard role `MAX_ITERATIONS` plays.
 */
export const MAX_ROLLOUT_CAP = 4096
export const parseRolloutCap = (s: string): number => parsePositiveInt(s, 'rollout cap', MAX_ROLLOUT_CAP)

/** Parses `random | greedy | greedy:0..2 | ismcts | ismcts:N`; throws on anything else. */
export function parseAgentSpec(s: string): AgentSpec {
  if (s === 'random') return { kind: 'random' }
  if (s === 'greedy') return { kind: 'greedy' }
  if (s === 'ismcts') return { kind: 'ismcts' }
  const g = /^greedy:(.*)$/s.exec(s)
  if (g) return { kind: 'greedy', depth: parseDepth(g[1] as string) }
  const i = /^ismcts:(.*)$/s.exec(s)
  if (i) return { kind: 'ismcts', iterations: parseIterations(i[1] as string) }
  throw new Error(`unknown agent spec "${s}" (expected random | greedy[:0-2] | ismcts[:N])`)
}

export function describeAgentSpec(spec: AgentSpec): string {
  if (spec.kind === 'random') return 'random'
  if (spec.kind === 'greedy') return spec.depth === undefined ? 'greedy' : `greedy:${spec.depth}`
  // The rollout cap is part of the agent's IDENTITY, not a hidden setting: a tournament that cannot say
  // which cap produced its number is a measurement nobody can compare against another one.
  const base = spec.iterations === undefined ? 'ismcts' : `ismcts:${spec.iterations}`
  return spec.rolloutCap === undefined ? base : `${base}/cap${spec.rolloutCap}`
}

/**
 * Builds a fresh agent for one seat. Self-play constructs one of these per game per seat, seeded
 * `(seed + g) * 2 + p + 1` (see `selfplay.ts`) so seat and game vary the stream independently of the
 * legacy `seed * 2 + 1/2` random-vs-random scheme. The mirrored tournament seeds by AGENT instead of by
 * seat — see `mirror.ts`, which explains why.
 */
export function makeAgent(spec: AgentSpec, seed: number, decks: [string[], string[]]): Agent {
  if (spec.kind === 'random') return new RandomAgent(seed)
  if (spec.kind === 'greedy') {
    return new GreedyAgent(spec.depth === undefined ? { seed, decks } : { seed, decks, depth: spec.depth })
  }
  // exactOptionalPropertyTypes: an explicit `iterations: undefined` is not the same as an absent key, so the
  // default has to come from the search's own options rather than from a spread of a possibly-undefined field.
  return new IsmctsAgent({
    seed, decks,
    ...(spec.iterations === undefined ? {} : { iterations: spec.iterations }),
    ...(spec.rolloutCap === undefined ? {} : { rolloutCommandCap: spec.rolloutCap }),
    ...(spec.profile === true ? { profile: true } : {}),
  })
}
