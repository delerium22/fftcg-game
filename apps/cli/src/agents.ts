import { DEFAULT_WEIGHTS, GreedyAgent, IsmctsAgent, RandomAgent, type Agent, type WeightOverrides, type Weights } from '@fftcg/ai'

export type AgentSpec =
  | { kind: 'random' }
  | { kind: 'greedy'; depth?: 0 | 1 | 2 }
  | {
      kind: 'ismcts'; iterations?: number; rolloutCap?: number; profile?: boolean
      budgetMs?: number; minIterations?: number
      /** G1a: sparse weight overrides for THIS arm's rollouts, so an A/B names the one weight it varies. */
      weights?: WeightOverrides
    }

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

/**
 * F4: the search's wall-clock box, and its floor. BOTH are exposed, because a report that names only the
 * milliseconds cannot identify the policy that produced it — the floor changes what a slow machine actually
 * plays, and on a fast one it may be what stops the search rather than the clock.
 *
 * One minute is the typo guard, on the same grounds as `MAX_ITERATIONS`: a box measured in minutes is a
 * mistyped flag, not an intent.
 */
export const MAX_BUDGET_MS = 60_000
export const parseBudgetMs = (s: string): number => parsePositiveInt(s, 'budget ms', MAX_BUDGET_MS)
export const parseMinIterations = (s: string): number => parsePositiveInt(s, 'min iterations', MAX_ITERATIONS)

/**
 * G1a: `name=value` weight overrides on an ISMCTS arm, comma-separated — `ismcts:200+damageCurve=8,damage=25`.
 *
 * The value regex, not `Number()`, does the work, for the same reason `parsePositiveInt` says so: `Number`
 * turns `''`, `' 1'`, `'1e3'` and `'0x10'` into perfectly good numbers, and a silently-coerced weight is a
 * measurement bug that reads as a strength difference. Decimals and negatives ARE allowed — real weights
 * include 1.2 and 0.6, and a negative weight is a legitimate hypothesis — but `Infinity` and `NaN` are not
 * spellable by this grammar, and `resolveWeights` refuses them again on the far side.
 *
 * An unknown name throws here as well as in `resolveWeights`, so a mistyped arm fails at the flag rather than
 * silently running the control's policy under the treatment's name.
 */
export function parseWeightOverrides(s: string): WeightOverrides {
  const out: Partial<Weights> = {}
  for (const part of s.split(',')) {
    const m = /^([A-Za-z][A-Za-z0-9]*)=(-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?)$/.exec(part)
    if (!m) throw new Error(`invalid weight override "${part}" (expected name=number)`)
    const name = m[1] as string
    const value = m[2] as string
    if (!(name in DEFAULT_WEIGHTS)) {
      throw new Error(`unknown weight "${name}" (expected one of ${Object.keys(DEFAULT_WEIGHTS).join(', ')})`)
    }
    if (name in out) throw new Error(`weight "${name}" given twice in "${s}"`)
    out[name as keyof Weights] = Number(value)
  }
  if (Object.keys(out).length === 0) throw new Error('empty weight override')
  return out
}

/** Serialises overrides back into the spec's own syntax, sorted so one arm has ONE name across runs. */
const describeWeights = (w: WeightOverrides): string =>
  Object.keys(w).sort().map((k) => `${k}=${String(w[k as keyof Weights])}`).join(',')

/** Parses `random | greedy | greedy:0..2 | ismcts | ismcts:N | ismcts[:N]+name=value[,name=value]`. */
export function parseAgentSpec(s: string): AgentSpec {
  if (s === 'random') return { kind: 'random' }
  if (s === 'greedy') return { kind: 'greedy' }
  const g = /^greedy:(.*)$/s.exec(s)
  if (g) return { kind: 'greedy', depth: parseDepth(g[1] as string) }
  // The weight suffix is split off FIRST, so `ismcts:200+damageCurve=8` still validates its iteration count
  // through `parseIterations` rather than handing `200+damageCurve=8` to a regex that would reject it as a
  // bad integer and hide which half was actually wrong.
  const plus = s.indexOf('+')
  const head = plus === -1 ? s : s.slice(0, plus)
  const weights = plus === -1 ? undefined : parseWeightOverrides(s.slice(plus + 1))
  const i = /^ismcts:(.*)$/s.exec(head)
  if (head !== 'ismcts' && !i) {
    throw new Error(`unknown agent spec "${s}" (expected random | greedy[:0-2] | ismcts[:N][+name=value,...])`)
  }
  const base = i ? { kind: 'ismcts' as const, iterations: parseIterations(i[1] as string) } : { kind: 'ismcts' as const }
  return weights === undefined ? base : { ...base, weights }
}

export function describeAgentSpec(spec: AgentSpec): string {
  if (spec.kind === 'random') return 'random'
  if (spec.kind === 'greedy') return spec.depth === undefined ? 'greedy' : `greedy:${spec.depth}`
  // The rollout cap is part of the agent's IDENTITY, not a hidden setting: a tournament that cannot say
  // which cap produced its number is a measurement nobody can compare against another one.
  const base = spec.iterations === undefined ? 'ismcts' : `ismcts:${spec.iterations}`
  const capped = spec.rolloutCap === undefined ? base : `${base}/cap${spec.rolloutCap}`
  // The box is part of the identity for the same reason the cap is, and BOTH halves of it are: "ismcts:200
  // boxed at 500 ms" describes two different agents depending on whether its floor is 8 or 80.
  const boxed = spec.budgetMs === undefined ? capped
    : `${capped}/box${spec.budgetMs}ms+min${spec.minIterations ?? 1}`
  // G1a: and the WEIGHTS most of all. An arm that varies a weight and reports itself as plain "ismcts:200" is
  // indistinguishable from its own control in the output, which is how an A/B silently reports one arm twice.
  return spec.weights === undefined ? boxed : `${boxed}+${describeWeights(spec.weights)}`
}

/**
 * Applies `--depth`/`--iterations` to a BARE spec (no explicit `:N`); an explicit suffix always wins. The
 * iteration default is the SEARCH's `DEFAULT_ITERATIONS`, not a number this CLI invented — a bare `ismcts`
 * must run the budget its own defaults describe, and resolving it here means `describeAgentSpec` labels the
 * run with the budget that actually produced its ms/decision (D-A4) instead of a bare "ismcts".
 */
export function withDefaults(
  spec: AgentSpec, depth: 0 | 1 | 2, iterations: number, rolloutCap: number | null,
  budget: { ms: number; minIterations: number } | null = null,
): AgentSpec {
  if (spec.kind === 'greedy' && spec.depth === undefined) return { kind: 'greedy', depth }
  if (spec.kind !== 'ismcts') return spec
  // SPREAD the parsed spec and override only the fields a default applies to. This used to rebuild the object
  // field by field, which silently DROPPED every field the list forgot — and G1a's `weights` was one, so
  // `--a ismcts:200+damage=25` reached the tournament as plain `ismcts:200`. That is the worst shape a bug
  // can have here: the treatment arm runs the CONTROL's policy while the report names it as the treatment, so
  // an A/B reports one arm twice and reads as "no effect" no matter what the weight would really have done.
  // An explicit `undefined` is not an absent key under exactOptionalPropertyTypes, hence the conditionals.
  return {
    ...spec,
    ...(spec.iterations === undefined ? { iterations } : {}),
    ...(spec.rolloutCap === undefined && rolloutCap !== null ? { rolloutCap } : {}),
    ...(budget === null ? {} : { budgetMs: budget.ms, minIterations: budget.minIterations }),
  }
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
    ...(spec.budgetMs === undefined ? {} : { budget: { ms: spec.budgetMs, minIterations: spec.minIterations ?? 1 } }),
    ...(spec.weights === undefined ? {} : { weights: spec.weights }),
  })
}
