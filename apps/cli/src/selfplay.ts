import { actingPlayer, apply, checkInvariants, createGame, legalCommands, viewFor, type CardDef } from '@fftcg/engine'
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
}

const RANDOM_SPECS: [AgentSpec, AgentSpec] = [{ kind: 'random' }, { kind: 'random' }]

export function selfPlay(opts: SelfPlayOptions): SelfPlayReport {
  const specs = opts.agents ?? RANDOM_SPECS
  const strict = opts.strict ?? true
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
  }
  const max = opts.maxCommands ?? 2000
  let turns = 0
  const totalMs: [number, number] = [0, 0]
  for (let g = 0; g < opts.games; g++) {
    const seed = opts.seed + g
    try {
      // seat seed: `seed` here is already `opts.seed + g`, so this is `(opts.seed + g) * 2 + p + 1`.
      const agents = [
        makeAgent(specs[0], seed * 2 + 1, opts.decks),
        makeAgent(specs[1], seed * 2 + 2, opts.decks),
      ] as const
      let s = createGame({ seed, decks: opts.decks, defs: opts.defs })
      for (let i = 0; i < max && !s.result; i++) {
        const p = actingPlayer(s)
        if (p === null) break
        const before = strict ? JSON.stringify(s) : undefined
        const agent = agents[p]
        const t0 = performance.now()
        const view = viewFor(s, p)
        const legal = agent.needsLegalCommands === false ? [] : legalCommands(s, p)
        const cmd = agent.decide(view, legal)
        const t1 = performance.now()
        totalMs[p] += t1 - t0
        report.decisions[p]++
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
        report.unimplementedAbilities += r.events.filter((e) => e.type === 'unimplementedAbility').length
      }
      if (!s.result) throw new Error(`no result after ${max} commands`)
      if (!strict) {
        const problems = checkInvariants(s)
        if (problems.length) throw new Error(`invariants violated at game end: ${problems.join('; ')}`)
      }
      report.completed++
      if (s.result.winner === null) report.draws++; else report.wins[s.result.winner]++
      turns += s.turn
    } catch (e) {
      report.failures.push({ seed, error: e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e) })
    }
  }
  report.avgTurns = report.completed ? turns / report.completed : 0
  report.msPerDecision = [
    report.decisions[0] ? totalMs[0] / report.decisions[0] : 0,
    report.decisions[1] ? totalMs[1] / report.decisions[1] : 0,
  ]
  return report
}
