import { actingPlayer, apply, checkInvariants, createGame, legalCommands, viewFor, type CardDef } from '@fftcg/engine'
import { RandomAgent } from '@fftcg/ai'

export interface SelfPlayReport { games: number; completed: number; wins: [number, number]; draws: number; avgTurns: number; unimplementedAbilities: number; failures: { seed: number; error: string }[] }

export function selfPlay(opts: { games: number; seed: number; decks: [string[], string[]]; defs: CardDef[]; maxCommands?: number }): SelfPlayReport {
  const report: SelfPlayReport = { games: opts.games, completed: 0, wins: [0, 0], draws: 0, avgTurns: 0, unimplementedAbilities: 0, failures: [] }
  const max = opts.maxCommands ?? 2000
  let turns = 0
  for (let g = 0; g < opts.games; g++) {
    const seed = opts.seed + g
    try {
      const agents = [new RandomAgent(seed * 2 + 1), new RandomAgent(seed * 2 + 2)] as const
      let s = createGame({ seed, decks: opts.decks, defs: opts.defs })
      for (let i = 0; i < max && !s.result; i++) {
        const p = actingPlayer(s)
        if (p === null) break
        const before = JSON.stringify(s)
        const cmd = agents[p].decide(viewFor(s, p), legalCommands(s, p))
        const r = apply(s, cmd)
        if (JSON.stringify(s) !== before) throw new Error(`apply mutated its input at step ${i}`)
        s = r.state
        const problems = checkInvariants(s)
        if (problems.length) throw new Error(`invariants violated after step ${i} (${cmd.type}): ${problems.join('; ')}`)
        report.unimplementedAbilities += r.events.filter((e) => e.type === 'unimplementedAbility').length
      }
      if (!s.result) throw new Error(`no result after ${max} commands`)
      report.completed++
      if (s.result.winner === null) report.draws++; else report.wins[s.result.winner]++
      turns += s.turn
    } catch (e) {
      report.failures.push({ seed, error: e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e) })
    }
  }
  report.avgTurns = report.completed ? turns / report.completed : 0
  return report
}
