import { actingPlayer, apply, determinise, seedRng, type Command, type GameState, type PlayerId, type PlayerView, type Rng } from '@fftcg/engine'
import type { Agent } from './agent.js'
import { candidateCommands } from './candidates.js'
import { DEFAULT_WEIGHTS, evaluate, type Weights } from './evaluate.js'

export interface GreedyOptions { seed: number; decks: [string[], string[]]; depth?: 0 | 1 | 2 | undefined; weights?: Weights | undefined; aggression?: number | undefined; maxSimulations?: number | undefined }

export function greedyStep(state: GameState, player: PlayerId, weights: Weights, aggression: number): Command | null {
  let best: Command | null = null
  let bestScore = -Infinity
  for (const c of candidateCommands(state, player)) {
    const score = evaluate(apply(state, c).state, player, weights, aggression)
    if (score > bestScore) { best = c; bestScore = score }
  }
  return best
}

export class GreedyAgent implements Agent {
  private rng: Rng
  private readonly decks: [string[], string[]]
  private readonly depth: 0 | 1 | 2
  private readonly weights: Weights
  private readonly aggression: number
  private readonly maxSimulations: number
  lastSimulations = 0
  constructor(opts: GreedyOptions) {
    this.rng = seedRng(opts.seed); this.decks = opts.decks; this.depth = opts.depth ?? 1
    this.weights = opts.weights ?? DEFAULT_WEIGHTS; this.aggression = opts.aggression ?? 0.5; this.maxSimulations = opts.maxSimulations ?? 2000
  }
  lastCandidates = 0
  lastDepth: 0 | 1 | 2 = 0
  decide(view: PlayerView, legal: Command[]): Command {
    const me = view.me
    const [det, rng] = determinise({ view, decks: this.decks, rng: this.rng })
    this.rng = rng
    const cands = candidateCommands(det, me)   // pass is last by contract
    if (!cands.length) return legal.find((c) => c.type !== 'concede') ?? (legal[0] as Command)
    const atDeclaration = det.phase === 'attack' && det.attack?.step === 'declaration'
    const depth: 0 | 1 | 2 = atDeclaration ? (Math.max(this.depth, 2) as 2) : this.depth   // spec A2
    const budget = Math.max(1, Math.floor(this.maxSimulations / cands.length))
    const owner = det.turnPlayer
    let sims = 0
    let best = cands[0] as Command
    let bestScore = -Infinity
    for (const cand of cands) {
      let s = apply(det, cand).state
      let used = 1
      const rollout = (until: (t: GameState) => boolean) => {
        while (!s.result && until(s) && used < budget) {
          const p = actingPlayer(s)!
          const c = greedyStep(s, p, this.weights, p === me ? this.aggression : 1 - this.aggression)
          if (!c) break
          s = apply(s, c).state; used++
        }
      }
      if (depth >= 1) rollout((t) => t.turnPlayer === owner)    // finish the current turn (mine, or the opponent's when I am blocking)
      if (depth >= 2) rollout((t) => t.turnPlayer !== owner)    // and the following turn
      const score = evaluate(s, me, this.weights, this.aggression)
      if (score > bestScore) { best = cand; bestScore = score }
      sims += used
    }
    this.lastSimulations = sims; this.lastCandidates = cands.length; this.lastDepth = depth
    return best
  }
}
