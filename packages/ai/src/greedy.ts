import { SYNTHETIC_ID_BASE, actingPlayer, apply, determinise, legalCommands, seedRng, type CardId, type Command, type GameState, type PlayerId, type PlayerView, type Rng } from '@fftcg/engine'
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
   * Soft cap on the number of `apply()` calls spent on the *rollout* portion of scoring one candidate. Each
   * candidate gets its own fresh budget, `perCandidate = max(1, floor(maxSimulations / candidates))`, so scoring
   * is invariant under candidate reordering (C1) — a shared budget would let early candidates starve later ones.
   * The top-level apply and the full combat resolution that follows it (`resolveCombat`) are exempt from the cap
   * — they always run to completion (W1) — but their applies still count against the budget, so the rollout loop
   * that follows may already be over cap before it starts. `lastSimulations` sums `used` across all per-candidate
   * budgets; the documented (loose) bound is `lastSimulations <= maxSimulations + lastCandidates` (the per-candidate
   * floor plus the always-applied top-level apply account for the `+ lastCandidates` term; combat-resolution
   * applies push some candidates further over their own cap, which the floor already tolerates).
   */
  maxSimulations?: number | undefined
}

interface Budget { used: number; cap: number }
const within = (b: Budget | undefined): boolean => !b || b.used < b.cap

/**
 * Fast-forward through a pending `declareBlock`/`assignPartyDamage` decision: while one is pending, the acting
 * player `p` answers with `greedyStep`, scored from `p === perspective ? aggression : 1 - aggression` (C4 — keyed
 * on the explicit `perspective` player, not `state.turnPlayer`, so the agent's own defensive decisions are scored
 * from its own viewpoint even though the attacker holds `turnPlayer`/priority throughout the Attack Phase). Never
 * exits early because the budget is exhausted (W1) — every apply here still counts against it, but combat
 * resolution itself always runs to completion. Terminates because both pending kinds strictly advance the attack
 * (a block decision, then optionally a party-damage split, then neither).
 */
export function resolveCombat(state: GameState, weights: Weights, aggression: number, perspective: PlayerId, budget?: Budget): GameState {
  let s = state
  while (!s.result && (s.pending?.kind === 'declareBlock' || s.pending?.kind === 'assignPartyDamage')) {
    const p = actingPlayer(s)
    if (p === null) break
    const localAggression = p === perspective ? aggression : 1 - aggression
    const c = greedyStep(s, p, weights, localAggression, budget)
    if (!c) break
    s = apply(s, c).state
    if (budget) budget.used++
  }
  return s
}

/**
 * Score every legal command for `player` and return the best one (ties keep the earlier candidate). Always
 * guarantees at least the first candidate is applied and scored, even with an exhausted budget (W1) — only
 * subsequent candidates are gated by `within(budget)`. Every candidate is scored on `resolveCombat(apply(state,
 * c).state, weights, aggression, player, budget)` — `player` doubles as the perspective, so a nested call here
 * (e.g. scoring a `declareBlock` candidate from inside `resolveCombat`'s own loop) resolves that candidate's
 * combat all the way through (a party's damage split included, W2) before it is evaluated, not on the mid-combat
 * snapshot taken the instant it is applied. The recursion this creates is bounded: each pending kind strictly
 * advances the attack, so a block decision recurses into at most one further (party-damage) decision.
 */
export function greedyStep(state: GameState, player: PlayerId, weights: Weights, aggression: number, budget?: Budget): Command | null {
  let best: Command | null = null
  let bestScore = -Infinity
  let i = 0
  for (const c of candidateCommands(state, player)) {
    if (i > 0 && !within(budget)) break
    i++
    const after = apply(state, c).state
    if (budget) budget.used++
    const scored = resolveCombat(after, weights, aggression, player, budget)
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

export interface CandidateScoreOptions {
  me: PlayerId
  weights: Weights
  aggression: number
  depth: 0 | 1 | 2
  owner: PlayerId
  maxSimulations: number
}

export interface CandidateScore { command: Command; score: number; turn: number; used: number }

/**
 * Score every top-level candidate independently (C1): each gets its own fresh `Budget` sized
 * `max(1, floor(maxSimulations / cands.length))`, so the result — and therefore the argmax `decide` picks — is
 * invariant under the order `cands` is given in (a shared budget is not: early candidates would consume rollout
 * work that later ones then lack). For each candidate: apply it and fully resolve any combat it opens (both
 * exempt from the budget cap, W1); then, per `depth`, roll out greedily to the end of the acting turn owner's
 * turn (depth >= 1) and/or the following turn (depth >= 2), bounded by the budget. `turn` records the scored
 * state's turn number (for asserting where a rollout stopped); `used` is that candidate's own budget spend.
 */
export function scoreCandidates(det: GameState, cands: Command[], opts: CandidateScoreOptions): CandidateScore[] {
  const perCandidate = Math.max(1, Math.floor(opts.maxSimulations / cands.length))
  return cands.map((cand) => {
    const budget: Budget = { used: 0, cap: perCandidate }
    let s = apply(det, cand).state
    budget.used++   // floor: every candidate gets at least one apply regardless of budget
    s = resolveCombat(s, opts.weights, opts.aggression, opts.me, budget)
    const rollout = (until: (t: GameState) => boolean) => {
      while (!s.result && until(s) && within(budget)) {
        const p = actingPlayer(s)!
        const c = greedyStep(s, p, opts.weights, p === opts.me ? opts.aggression : 1 - opts.aggression, budget)
        if (!c) break
        s = apply(s, c).state; budget.used++
      }
    }
    if (opts.depth >= 1) rollout((t) => t.turnPlayer === opts.owner)   // finish the current turn (mine, or the opponent's when I am blocking)
    if (opts.depth >= 2) rollout((t) => t.turnPlayer !== opts.owner)   // and the following turn
    const score = evaluate(s, opts.me, opts.weights, opts.aggression)
    return { command: cand, score, turn: s.turn, used: budget.used }
  })
}

/** All `CardId`s a command references — used by `decide`'s W4 guard to reject a chosen command that leaked a synthetic id. */
function commandCardIds(c: Command): CardId[] {
  switch (c.type) {
    case 'castCharacter': case 'castSummon': return [c.card, ...c.payment.dullBackups, ...c.payment.discards.map((d) => d.card)]
    case 'declareAttack': return c.attackers
    case 'declareBlock': return c.blocker === null ? [] : [c.blocker]
    case 'assignPartyDamage': return c.assignments.map((a) => a.target)
    case 'discardToHandSize': return c.cards
    case 'chooseFirst': case 'mulligan': case 'pass': case 'concede': return []
    default: { const _exhaustive: never = c; return _exhaustive }
  }
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
  /** Test/diagnostic hook: each top-level candidate's final score, resolved-state turn number, and budget spend from the most recent `decide`. */
  lastScores: CandidateScore[] = []
  readonly needsLegalCommands = false
  constructor(opts: GreedyOptions) {
    this.rng = seedRng(opts.seed); this.decks = opts.decks; this.depth = opts.depth ?? 1
    this.weights = opts.weights ?? DEFAULT_WEIGHTS; this.aggression = opts.aggression ?? 0.5; this.maxSimulations = opts.maxSimulations ?? 2000
  }
  decide(view: PlayerView, legal: Command[]): Command {
    this.lastSimulations = 0; this.lastCandidates = 0; this.lastDepth = 0; this.lastScores = []
    const me = view.me
    const [det, rng] = determinise({ view, decks: this.decks, rng: this.rng })
    this.rng = rng
    let cands = candidateCommands(det, me)   // pass is last by contract
    if (!cands.length) {
      // legal may be [] here (needsLegalCommands is false, so a caller may skip generating it on the hot
      // path); compute it ourselves rather than relying on the argument, but reuse a non-empty one as-is. The
      // true legal set for a non-acting player is just [concede] (§2.1) — C6: return it rather than searching
      // for a non-concede move that cannot exist here.
      const pool = legal.length ? legal : legalCommands(det, me)
      const fallback = pool[0]
      if (!fallback) throw new Error('GreedyAgent.decide: no legal command to choose or fall back to')
      return fallback
    }
    cands = pruneCandidates(cands, Math.max(1, this.maxSimulations))
    this.lastCandidates = cands.length
    const atDeclaration = det.phase === 'attack' && det.attack?.step === 'declaration'
    // F5: setup (chooseFirst/mulligan) is scored at depth 0 — evaluate() already prices hand quality directly.
    const depth: 0 | 1 | 2 = det.phase === 'setup' ? 0 : atDeclaration ? (Math.max(this.depth, 2) as 2) : this.depth   // spec A2
    const owner = det.turnPlayer
    const scores = scoreCandidates(det, cands, { me, weights: this.weights, aggression: this.aggression, depth, owner, maxSimulations: this.maxSimulations })
    let best = scores[0]!.command
    let bestScore = -Infinity
    for (const sc of scores) { if (sc.score > bestScore) { best = sc.command; bestScore = sc.score } }
    this.lastSimulations = scores.reduce((n, sc) => n + sc.used, 0)
    this.lastScores = scores
    this.lastDepth = depth
    // W4: candidates are built from `me`'s own resources in the determinised state, which are always real
    // (visible) ids — a chosen command should never reference a hidden card's synthetic id.
    for (const id of commandCardIds(best)) if (id >= SYNTHETIC_ID_BASE) throw new Error(`GreedyAgent.decide: chosen command ${best.type} references synthetic id ${id}`)
    return best
  }
}
