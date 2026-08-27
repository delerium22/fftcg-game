import type { Agent } from '@fftcg/ai'
import { nextInt, seedRng, type CardDef, type PlayerId } from '@fftcg/engine'
import { describeAgentSpec, makeAgent, type AgentSpec } from './agents.js'
import { newGameStats, playGame, type SearchCostReport } from './selfplay.js'

/**
 * The mirrored tournament (spec D-A1).
 *
 * `selfPlay` pins each agent to a seat for a whole run, and the existing "both seats" coverage plays two runs
 * over DIFFERENT seed ranges. That cannot separate a seat advantage from a strength difference: going first is
 * worth something in FFTCG (CR 3.3 §4.1 — the first player skips their first draw; the net size of the effect
 * on this pool is unmeasured), and two different seed ranges deal two different sets of games. So every seed is
 * played TWICE from the identical opening state with the seats swapped, and the pair scores as one paired
 * observation.
 *
 * Everything in the report is stated from A's point of view — A is the agent under test, B the baseline.
 */

/** Points A scores in one game. A HARNESS FAILURE is a loss, charged to A whichever seat it sat in: a search
 *  that crashes the harness has not earned a half point (spec D-A1). */
export const WIN = 1
export const DRAW = 0.5
export const LOSS = 0

export interface MirrorOptions {
  /** Seed pairs. Each is two games, so the D-A1 gate is `pairs: 200` → 400 games. */
  pairs: number
  seed: number
  decks: [string[], string[]]
  defs: CardDef[]
  /** `[A, B]` — A is the agent under test. */
  agents: [AgentSpec, AgentSpec]
  maxCommands?: number
  strict?: boolean
  bootstrapSamples?: number
  bootstrapSeed?: number
}

export interface MirrorRecord {
  games: number
  wins: number
  draws: number
  losses: number
  /** Harness failures, ALSO counted in `losses` — reported separately so a 45 % score built out of crashes can
   *  never read as a 45 % score built out of play. */
  failures: number
  points: number
}

export interface MirrorGame {
  seed: number
  /** Which seat A occupied; the pair covers both over one identical opening state. */
  seatOfA: 0 | 1
  points: number
  winner: PlayerId | null
  turns: number
  failed: boolean
}

export interface MirrorReport {
  /** `[A, B]`, the same order as `options.agents`. */
  agents: [string, string]
  pairs: number
  games: number
  points: number
  /** A's mean points per game, in [0, 1]. The D-A1 gate is ≥ 0.55 with `ci95[0] > 0.5`. */
  pointScore: number
  /** Paired-bootstrap 95 % interval on `pointScore`, resampling PAIRS (not games). */
  ci95: [number, number]
  bootstrapSamples: number
  record: MirrorRecord
  /** `[A as player 0, A as player 1]` — the split the old harness could not produce. */
  perSeat: [MirrorRecord, MirrorRecord]
  /** A's score going first minus going second. Not a gate; the number that says whether the mirror was needed.
   *  Near 0 means seats do not matter on this pool; large means an unmirrored result was worthless. */
  seatBias: number
  completed: number
  avgTurns: number
  unimplementedAbilities: number
  /** Indexed by AGENT `[A, B]`, not by seat — the whole point is that the agents move between seats. */
  msPerDecision: [number, number]
  decisions: [number, number]
  /** D-A4: search cost per agent, `null` for an agent that publishes no counters. */
  search: [SearchCostReport | null, SearchCostReport | null]
  failures: { seed: number; seatOfA: 0 | 1; error: string }[]
  /** Every game, in play order — the raw material behind every aggregate above. */
  results: readonly MirrorGame[]
}

const emptyRecord = (): MirrorRecord => ({ games: 0, wins: 0, draws: 0, losses: 0, failures: 0, points: 0 })

function credit(rec: MirrorRecord, points: number, failed: boolean): void {
  rec.games++
  rec.points += points
  rec.failures += failed ? 1 : 0
  if (points === WIN) rec.wins++
  else if (points === DRAW) rec.draws++
  else rec.losses++
}

const seatScore = (r: MirrorRecord): number => (r.games ? r.points / r.games : 0)

/** Sums one game's per-seat cost into an agent's running total. Counters add; `maxCommandDepth` is a max. */
function addCost(into: SearchCostReport | null, one: SearchCostReport | null): SearchCostReport | null {
  if (!one) return into
  if (!into) return one
  return {
    decisions: into.decisions + one.decisions,
    determinisations: into.determinisations + one.determinisations,
    treeApplies: into.treeApplies + one.treeApplies,
    rolloutApplies: into.rolloutApplies + one.rolloutApplies,
    evaluations: into.evaluations + one.evaluations,
    nodes: into.nodes + one.nodes,
    maxCommandDepth: Math.max(into.maxCommandDepth, one.maxCommandDepth),
  }
}

/**
 * Nearest-rank quantile. The caller sorts with an explicit numeric comparator: `Array.prototype.sort` with no
 * comparator sorts by STRING, and while that happens to agree with numeric order for plain decimals in [0, 1],
 * it stops agreeing the moment a value reaches exponent notation (`1e-7` sorts above `0.5`). Total, explicit
 * comparators everywhere (D-8), not ones that are accidentally right for today's value range.
 */
function quantile(sorted: readonly number[], p: number): number {
  const i = Math.ceil(p * sorted.length) - 1
  return sorted[Math.min(sorted.length - 1, Math.max(0, i))] as number
}

/**
 * Paired bootstrap: resamples the PAIRS with replacement, not the games. The two games of a pair share an
 * opening state and differ only by the swap, so their outcomes are correlated; resampling games would treat
 * 400 correlated observations as 400 independent ones and report an interval that is too narrow — which is
 * exactly the kind of error a passing gate does not reveal.
 *
 * Deterministic: the engine's seeded RNG, never `Math.random`.
 */
export function pairedBootstrapCi(pairScores: readonly number[], samples: number, seed: number): [number, number] {
  const n = pairScores.length
  if (n === 0) throw new Error('pairedBootstrapCi: no pairs')
  if (!Number.isInteger(samples) || samples < 1) throw new Error(`pairedBootstrapCi: invalid samples ${samples}`)
  let rng = seedRng(seed)
  const means: number[] = []
  for (let b = 0; b < samples; b++) {
    let total = 0
    for (let i = 0; i < n; i++) {
      const [k, next] = nextInt(rng, n)
      rng = next
      total += pairScores[k] as number
    }
    means.push(total / n)
  }
  means.sort((a, b) => a - b)
  return [quantile(means, 0.025), quantile(means, 0.975)]
}

/**
 * Agent seeds are keyed on the AGENT and the pair, never on the seat. The two games of a pair must differ in
 * exactly one thing: which seat each agent occupies. Seeding by seat (as `selfPlay` does, correctly, for its
 * own purpose) would hand A a different RNG stream in the two halves of a pair, and the pairing would stop
 * isolating the seat effect it exists to isolate.
 */
const agentSeed = (gameSeed: number, which: 0 | 1): number => gameSeed * 2 + which + 1

export function mirrorTournament(opts: MirrorOptions): MirrorReport {
  if (!Number.isInteger(opts.pairs) || opts.pairs < 1) throw new Error(`mirrorTournament: invalid pairs ${opts.pairs}`)
  const strict = opts.strict ?? true
  const max = opts.maxCommands ?? 2000
  const samples = opts.bootstrapSamples ?? 2000
  const record = emptyRecord()
  const perSeat: [MirrorRecord, MirrorRecord] = [emptyRecord(), emptyRecord()]
  const failures: MirrorReport['failures'] = []
  const results: MirrorGame[] = []
  const pairScores: number[] = []
  const decisions: [number, number] = [0, 0]
  const ms: [number, number] = [0, 0]
  const search: [SearchCostReport | null, SearchCostReport | null] = [null, null]
  let completed = 0
  let turns = 0
  let unimplementedAbilities = 0

  for (let i = 0; i < opts.pairs; i++) {
    const seed = opts.seed + i
    let pairPoints = 0
    for (const seatOfA of [0, 1] as const) {
      const a = makeAgent(opts.agents[0], agentSeed(seed, 0), opts.decks)
      const b = makeAgent(opts.agents[1], agentSeed(seed, 1), opts.decks)
      const seated: readonly [Agent, Agent] = seatOfA === 0 ? [a, b] : [b, a]
      // One fresh accumulator per game: `playGame` indexes it by SEAT, and the seats mean different agents in
      // the two halves of a pair. It is also mutated on the throwing path, so a failed game still reports the
      // cost it incurred before failing.
      const stats = newGameStats()
      let points = LOSS
      let failed = false
      let winner: PlayerId | null = null
      let gameTurns = 0
      try {
        const out = playGame({ seed, decks: opts.decks, defs: opts.defs, agents: seated, maxCommands: max, strict }, stats)
        winner = out.winner
        gameTurns = out.turns
        points = winner === null ? DRAW : winner === seatOfA ? WIN : LOSS
        completed++
        turns += gameTurns
      } catch (e) {
        failed = true
        failures.push({ seed, seatOfA, error: e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e) })
      }
      for (const seat of [0, 1] as const) {
        const agent = seat === seatOfA ? 0 : 1
        decisions[agent] += stats.decisions[seat]
        ms[agent] += stats.totalMs[seat]
        search[agent] = addCost(search[agent], stats.search[seat])
      }
      unimplementedAbilities += stats.unimplementedAbilities
      credit(record, points, failed)
      credit(perSeat[seatOfA], points, failed)
      results.push({ seed, seatOfA, points, winner, turns: gameTurns, failed })
      pairPoints += points
    }
    pairScores.push(pairPoints / 2)
  }

  const games = opts.pairs * 2
  return {
    agents: [describeAgentSpec(opts.agents[0]), describeAgentSpec(opts.agents[1])],
    pairs: opts.pairs,
    games,
    points: record.points,
    pointScore: record.points / games,
    ci95: pairedBootstrapCi(pairScores, samples, opts.bootstrapSeed ?? opts.seed),
    bootstrapSamples: samples,
    record,
    perSeat,
    seatBias: seatScore(perSeat[0]) - seatScore(perSeat[1]),
    completed,
    avgTurns: completed ? turns / completed : 0,
    unimplementedAbilities,
    msPerDecision: [decisions[0] ? ms[0] / decisions[0] : 0, decisions[1] ? ms[1] / decisions[1] : 0],
    decisions,
    search,
    failures,
    results,
  }
}
