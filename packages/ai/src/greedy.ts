import { actingPlayer, apply, determinise, legalCommands, seedRng, type Command, type GameState, type PlayerId, type PlayerView, type Rng } from '@fftcg/engine'
import type { Agent } from './agent.js'
import { candidateCommands } from './candidates.js'
import { DEFAULT_WEIGHTS, evaluate, type Weights } from './evaluate.js'

export interface GreedyOptions {
  seed: number
  decks: [string[], string[]]
  depth?: 0 | 1 | 2 | undefined
  weights?: Weights | undefined
  aggression?: number | undefined
  /**
   * Soft cap on the total number of `apply()` calls spent scoring and rolling out one `decide()`. It is charged
   * for every apply made anywhere while deciding — including inside `greedyStep`'s own candidate scoring and
   * `resolveCombat`'s combat playout, not just the applies that actually advance the chosen rollout. Every
   * top-level candidate is still guaranteed at least one apply regardless of the cap, so the true bound is
   * `lastSimulations <= maxSimulations + lastCandidates`.
   */
  maxSimulations?: number | undefined
}

interface Budget { used: number; cap: number }
const within = (b: Budget | undefined): boolean => !b || b.used < b.cap

/**
 * Fast-forward through a pending `declareBlock`/`assignPartyDamage` decision: while one is pending, the acting
 * player answers with `greedyStep` from their own perspective (`p === state.turnPlayer ? aggression : 1 -
 * aggression`), the answer is applied, and the loop repeats. Terminates because both pending kinds resolve within
 * at most two applied commands (a block decision, then optionally a party-damage split).
 */
export function resolveCombat(state: GameState, weights: Weights, aggression: number, budget?: Budget): GameState {
  let s = state
  while (!s.result && (s.pending?.kind === 'declareBlock' || s.pending?.kind === 'assignPartyDamage')) {
    if (!within(budget)) break
    const p = actingPlayer(s)
    if (p === null) break
    const perspective = p === s.turnPlayer ? aggression : 1 - aggression
    const c = greedyStep(s, p, weights, perspective, false, budget)
    if (!c) break
    s = apply(s, c).state
    if (budget) budget.used++
  }
  return s
}

/**
 * Score every legal command for `player` and return the best one (ties keep the earlier candidate). By default
 * each candidate is scored on `resolveCombat(apply(state, c).state, ...)` so that e.g. declaring an attack is
 * judged by its resolved outcome, not the mid-combat snapshot taken the instant it is declared (before any block
 * or damage has happened). Pass `resolveAfter: false` only when `greedyStep` itself is answering a pending combat
 * decision from inside `resolveCombat` — the immediate post-apply state already reflects that step's resolution
 * (or the next step of the same combat, which `resolveCombat`'s own loop will continue to walk), so recursing
 * into another `resolveCombat` there would just re-walk the same combat.
 */
export function greedyStep(state: GameState, player: PlayerId, weights: Weights, aggression: number, resolveAfter = true, budget?: Budget): Command | null {
  let best: Command | null = null
  let bestScore = -Infinity
  for (const c of candidateCommands(state, player)) {
    if (!within(budget)) break
    const after = apply(state, c).state
    if (budget) budget.used++
    const scored = resolveAfter ? resolveCombat(after, weights, aggression, budget) : after
    const score = evaluate(scored, player, weights, aggression)
    if (score > bestScore) { best = c; bestScore = score }
  }
  return best
}

/** Deterministically keep only the first `max` candidates, but always keep `pass` (moved to the end) if it was present. */
export function pruneCandidates(cands: Command[], max: number): Command[] {
  if (cands.length <= max) return cands
  const passIdx = cands.findIndex((c) => c.type === 'pass')
  if (passIdx === -1 || passIdx < max) return cands.slice(0, max)
  return [...cands.slice(0, max - 1), cands[passIdx] as Command]
}

export class GreedyAgent implements Agent {
  private rng: Rng
  private readonly decks: [string[], string[]]
  private readonly depth: 0 | 1 | 2
  private readonly weights: Weights
  private readonly aggression: number
  private readonly maxSimulations: number
  lastSimulations = 0
  lastCandidates = 0
  lastDepth: 0 | 1 | 2 = 0
  readonly needsLegalCommands = false
  constructor(opts: GreedyOptions) {
    this.rng = seedRng(opts.seed); this.decks = opts.decks; this.depth = opts.depth ?? 1
    this.weights = opts.weights ?? DEFAULT_WEIGHTS; this.aggression = opts.aggression ?? 0.5; this.maxSimulations = opts.maxSimulations ?? 2000
  }
  decide(view: PlayerView, legal: Command[]): Command {
    this.lastSimulations = 0; this.lastCandidates = 0; this.lastDepth = 0
    const me = view.me
    const [det, rng] = determinise({ view, decks: this.decks, rng: this.rng })
    this.rng = rng
    let cands = candidateCommands(det, me)   // pass is last by contract
    if (!cands.length) {
      // legal may be [] here (needsLegalCommands is false, so a caller may skip generating it on the hot
      // path); compute it ourselves rather than relying on the argument, but reuse a non-empty one as-is.
      const pool = legal.length ? legal : legalCommands(det, me)
      const fallback = pool.find((c) => c.type !== 'concede')
      if (!fallback) throw new Error('GreedyAgent.decide: no legal command to choose or fall back to')
      return fallback
    }
    cands = pruneCandidates(cands, Math.max(1, this.maxSimulations))
    this.lastCandidates = cands.length
    const atDeclaration = det.phase === 'attack' && det.attack?.step === 'declaration'
    // F5: setup (chooseFirst/mulligan) is scored at depth 0 — evaluate() already prices hand quality directly.
    const depth: 0 | 1 | 2 = det.phase === 'setup' ? 0 : atDeclaration ? (Math.max(this.depth, 2) as 2) : this.depth   // spec A2
    const owner = det.turnPlayer
    const budget: Budget = { used: 0, cap: this.maxSimulations }
    let best = cands[0] as Command
    let bestScore = -Infinity
    for (const cand of cands) {
      let s = apply(det, cand).state
      budget.used++   // floor: every candidate gets at least one apply regardless of budget
      s = resolveCombat(s, this.weights, this.aggression, budget)
      const rollout = (until: (t: GameState) => boolean) => {
        while (!s.result && until(s) && within(budget)) {
          const p = actingPlayer(s)!
          const c = greedyStep(s, p, this.weights, p === me ? this.aggression : 1 - this.aggression, true, budget)
          if (!c) break
          s = apply(s, c).state; budget.used++
        }
      }
      if (depth >= 1) rollout((t) => t.turnPlayer === owner)    // finish the current turn (mine, or the opponent's when I am blocking)
      if (depth >= 2) rollout((t) => t.turnPlayer !== owner)    // and the following turn
      const score = evaluate(s, me, this.weights, this.aggression)
      if (score > bestScore) { best = cand; bestScore = score }
    }
    this.lastSimulations = budget.used; this.lastDepth = depth
    return best
  }
}
