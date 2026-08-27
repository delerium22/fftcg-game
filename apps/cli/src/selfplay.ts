import type { Agent } from '@fftcg/ai'
import { actingPlayer, apply, checkInvariants, createGame, legalCommands, viewFor, type CardDef, type PlayerId } from '@fftcg/engine'
import type { AgentSpec } from './agents.js'
import { describeAgentSpec, makeAgent } from './agents.js'

export interface SelfPlayOptions {
  games: number
  seed: number
  decks: [string[], string[]]
  defs: CardDef[]
  maxCommands?: number
  agents?: [AgentSpec, AgentSpec]
  strict?: boolean
}

/**
 * The search's own cost counters, accumulated over a run (spec D-A4) so D2 can size a browser budget from
 * measurement rather than a guess.
 *
 * Structurally typed here rather than imported as `SearchDiagnostics` from `@fftcg/ai`: the harness must build
 * and run whether or not the search module exists yet, and — more importantly — must never quietly report
 * zeros when it does exist but stops publishing counters. `readSearchCounters` returns `null` in that case and
 * the report carries `null`, which is a visibly different thing from "the search did no work".
 */
export interface SearchCounters {
  readonly determinisations: number
  readonly treeApplies: number
  readonly rolloutApplies: number
  readonly evaluations: number
  readonly nodes: number
  readonly maxCommandDepth: number
}

const COUNTER_KEYS = ['determinisations', 'treeApplies', 'rolloutApplies', 'evaluations', 'nodes', 'maxCommandDepth'] as const

/** Per-seat totals. Counters sum; `maxCommandDepth` is a MAX, because summing depths across decisions means
 *  nothing — the browser budget cares about the deepest single line the search walked. */
export interface SearchCostReport extends SearchCounters {
  decisions: number
}

/** Property names the search wrapper may publish its last decision's diagnostics under. The search lane owns
 *  the name; accepting both plausible spellings costs one line and is cheaper than a run that silently reports
 *  no cost data at all. `lastDiagnostics` matches `GreedyAgent`'s `lastSimulations`/`lastScores` convention. */
const DIAGNOSTIC_PROPS = ['lastDiagnostics', 'diagnostics'] as const

/**
 * Reads one decision's counters off an agent, or `null` when it publishes none (`RandomAgent`, `GreedyAgent`).
 * Every counter must be present and finite — a partial object is treated as absent, so a renamed or dropped
 * field surfaces as `null` in the report instead of as a plausible-looking zero.
 */
export function readSearchCounters(agent: Agent): SearchCounters | null {
  const bag = agent as unknown as Record<string, unknown>
  for (const prop of DIAGNOSTIC_PROPS) {
    const d = bag[prop]
    if (typeof d !== 'object' || d === null) continue
    const rec = d as Record<string, unknown>
    if (!COUNTER_KEYS.every((k) => typeof rec[k] === 'number' && Number.isFinite(rec[k]))) continue
    return {
      determinisations: rec.determinisations as number,
      treeApplies: rec.treeApplies as number,
      rolloutApplies: rec.rolloutApplies as number,
      evaluations: rec.evaluations as number,
      nodes: rec.nodes as number,
      maxCommandDepth: rec.maxCommandDepth as number,
    }
  }
  return null
}

function addCounters(into: SearchCostReport | null, c: SearchCounters): SearchCostReport {
  if (!into) return { ...c, decisions: 1 }
  return {
    decisions: into.decisions + 1,
    determinisations: into.determinisations + c.determinisations,
    treeApplies: into.treeApplies + c.treeApplies,
    rolloutApplies: into.rolloutApplies + c.rolloutApplies,
    evaluations: into.evaluations + c.evaluations,
    nodes: into.nodes + c.nodes,
    maxCommandDepth: Math.max(into.maxCommandDepth, c.maxCommandDepth),
  }
}

/** Cost accumulators, indexed by SEAT. Mutated in place by `playGame` — including on the path that throws, so a
 *  game that fails halfway still contributes the work it actually did. */
export interface GameStats {
  decisions: [number, number]
  totalMs: [number, number]
  unimplementedAbilities: number
  search: [SearchCostReport | null, SearchCostReport | null]
}

export const newGameStats = (): GameStats => ({
  decisions: [0, 0],
  totalMs: [0, 0],
  unimplementedAbilities: 0,
  search: [null, null],
})

export interface PlayGameOptions {
  seed: number
  decks: [string[], string[]]
  defs: CardDef[]
  agents: readonly [Agent, Agent]
  maxCommands: number
  strict: boolean
}

/**
 * Plays one game to a result, or throws — a throw is a HARNESS FAILURE (invariant violation, dead end, mutated
 * input, or no result inside the command cap), never a game outcome. Callers decide what a failure costs;
 * `mirrorTournament` charges it to the agent under test as a loss (spec D-A1).
 */
export function playGame(opts: PlayGameOptions, stats: GameStats): { winner: PlayerId | null; turns: number } {
  const { strict } = opts
  let s = createGame({ seed: opts.seed, decks: opts.decks, defs: opts.defs })
  for (let i = 0; i < opts.maxCommands && !s.result; i++) {
    const p = actingPlayer(s)
    if (p === null) break
    const before = strict ? JSON.stringify(s) : undefined
    const agent = opts.agents[p] as Agent
    const t0 = performance.now()
    const view = viewFor(s, p)
    const legal = agent.needsLegalCommands === false ? [] : legalCommands(s, p)
    const cmd = agent.decide(view, legal)
    const t1 = performance.now()
    stats.totalMs[p] += t1 - t0
    stats.decisions[p]++
    const counters = readSearchCounters(agent)
    if (counters) stats.search[p] = addCounters(stats.search[p], counters)
    const r = apply(s, cmd)
    if (strict && JSON.stringify(s) !== before) throw new Error(`apply mutated its input at step ${i}`)
    s = r.state
    if (strict) {
      const problems = checkInvariants(s)
      if (problems.length) throw new Error(`invariants violated after step ${i} (${cmd.type}): ${problems.join('; ')}`)
      if (!s.result && !legalCommands(s, actingPlayer(s)!).some((c) => c.type !== 'concede')) {
        throw new Error(`dead end after step ${i}: acting player has only concede in ${s.phase}/${s.attack?.step}/${s.pending?.kind}`)
      }
    }
    stats.unimplementedAbilities += r.events.filter((e) => e.type === 'unimplementedAbility').length
  }
  if (!s.result) throw new Error(`no result after ${opts.maxCommands} commands`)
  if (!strict) {
    const problems = checkInvariants(s)
    if (problems.length) throw new Error(`invariants violated at game end: ${problems.join('; ')}`)
  }
  return { winner: s.result.winner, turns: s.turn }
}

export interface SelfPlayReport {
  games: number
  completed: number
  wins: [number, number]
  draws: number
  avgTurns: number
  unimplementedAbilities: number
  failures: { seed: number; error: string }[]
  agents: [string, string]
  msPerDecision: [number, number]
  decisions: [number, number]
  /** D-A4: per-seat search cost, `null` for a seat whose agent publishes no counters. */
  search: [SearchCostReport | null, SearchCostReport | null]
}

const RANDOM_SPECS: [AgentSpec, AgentSpec] = [{ kind: 'random' }, { kind: 'random' }]

export function selfPlay(opts: SelfPlayOptions): SelfPlayReport {
  const specs = opts.agents ?? RANDOM_SPECS
  const strict = opts.strict ?? true
  const stats = newGameStats()
  const report: SelfPlayReport = {
    games: opts.games,
    completed: 0,
    wins: [0, 0],
    draws: 0,
    avgTurns: 0,
    unimplementedAbilities: 0,
    failures: [],
    agents: [describeAgentSpec(specs[0]), describeAgentSpec(specs[1])],
    msPerDecision: [0, 0],
    decisions: [0, 0],
    search: [null, null],
  }
  const max = opts.maxCommands ?? 2000
  let turns = 0
  for (let g = 0; g < opts.games; g++) {
    const seed = opts.seed + g
    try {
      // seat seed: `seed` here is already `opts.seed + g`, so this is `(opts.seed + g) * 2 + p + 1`.
      const agents = [
        makeAgent(specs[0], seed * 2 + 1, opts.decks),
        makeAgent(specs[1], seed * 2 + 2, opts.decks),
      ] as const
      const { winner, turns: t } = playGame({ seed, decks: opts.decks, defs: opts.defs, agents, maxCommands: max, strict }, stats)
      report.completed++
      if (winner === null) report.draws++; else report.wins[winner]++
      turns += t
    } catch (e) {
      report.failures.push({ seed, error: e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e) })
    }
  }
  report.avgTurns = report.completed ? turns / report.completed : 0
  report.unimplementedAbilities = stats.unimplementedAbilities
  report.decisions = [stats.decisions[0], stats.decisions[1]]
  report.search = [stats.search[0], stats.search[1]]
  report.msPerDecision = [
    stats.decisions[0] ? stats.totalMs[0] / stats.decisions[0] : 0,
    stats.decisions[1] ? stats.totalMs[1] / stats.decisions[1] : 0,
  ]
  return report
}
