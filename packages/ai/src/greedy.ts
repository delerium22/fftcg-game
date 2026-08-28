import { SYNTHETIC_ID_BASE, actingPlayer, apply, determinise, hasResolutionWork, legalCommands, seedRng, type CardId, type Command, type Event, type GameState, type PlayerId, type PlayerView, type Rng } from '@fftcg/engine'
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
   * The top-level apply and the forced-decision resolution that follows it (`resolveForcedDecisions` — combat and
   * ability resolution alike) are exempt from the cap — they always run to completion (W1) — but their applies
   * still count against the budget, so the rollout loop that follows may already be over cap before it starts.
   * `lastSimulations` sums `used` across all per-candidate budgets.
   *
   * R3: this is a SOFT cap with no closed-form bound on `lastSimulations`. Budget-exempt combat resolution and
   * `greedyStep`'s always-score-the-first-candidate floor both overrun it by an amount that depends on the
   * position — a declareAttack at `maxSimulations: 50` was measured at 107 applies, so the bound this comment
   * previously claimed (`<= maxSimulations + lastCandidates`) is false. What the cap does guarantee is EQUAL
   * allocation across candidates (hence order-invariant scoring, C1) and proportionally more search as it rises.
   * A tight bound would need the rollout and combat portions counted separately; not worth it while the A8
   * budget (< 50 ms/decision) is met with ~200x headroom.
   */
  maxSimulations?: number | undefined
}

/**
 * Diagnostic-only attribution of a rollout's `apply` calls (rung D7). Absent in play, and absent by default.
 *
 * Rung D6 proposed a cheaper rollout policy and its plan review refused it, because the premise was inferred:
 * `budget.used` lumps together candidate scoring, the recursive scoring of forced block / party-damage / mode
 * / target choices, and the applies that merely advance.
 *
 * The scopes are named for the CALL SITE, not for a causal story, and that is deliberate — the first version
 * of this called them `policy` and `forced` and the code review showed the names claimed more than the
 * counters know:
 *
 *  - `loop` is the rollout's own `greedyStep`. It is NOT "the policy's own move": when a chosen command
 *    leaves a pending, the next turn of the rollout loop answers that FORCED decision, and it lands here.
 *  - `resolver` is `greedyStep` reached through `resolveForcedDecisions` while a candidate is being scored.
 *  - `tail` is the single settlement call after the command cap. It was previously mixed into `resolver`,
 *    which made "evaluation" and "trajectory" impossible to separate — the tail advances the real rollout.
 *
 * Every apply lands in exactly ONE bucket and the six sum to `used`. That identity is the point: it is the
 * one thing a miscount cannot satisfy by accident.
 */
export interface RolloutProfile {
  /** `greedyStep` called by the rollout LOOP — its own move, or a forced pending left by the last one. */
  loopGenerated: number
  loopScored: number
  loopScoringApplies: number
  /** `greedyStep` reached through `resolveForcedDecisions` while SCORING a candidate. */
  resolverGenerated: number
  resolverScored: number
  resolverScoringApplies: number
  /** `greedyStep` inside the final settlement call, after the command cap. */
  tailGenerated: number
  tailScored: number
  tailScoringApplies: number
  /** Applies that ADVANCE rather than score, by the same three scopes. */
  loopAdvanceApplies: number
  resolverAdvanceApplies: number
  tailAdvanceApplies: number
  /** How often `within(budget)` refused another candidate, and the loop command where it first did (-1: never). */
  refusals: number
  firstRefusalAtCommand: number
  /** Working state: resolver nesting, whether the tail is running, and which loop command is in flight. */
  depth: number
  inTail: boolean
  command: number
}

export const newRolloutProfile = (): RolloutProfile => ({
  loopGenerated: 0, loopScored: 0, loopScoringApplies: 0,
  resolverGenerated: 0, resolverScored: 0, resolverScoringApplies: 0,
  tailGenerated: 0, tailScored: 0, tailScoringApplies: 0,
  loopAdvanceApplies: 0, resolverAdvanceApplies: 0, tailAdvanceApplies: 0,
  refusals: 0, firstRefusalAtCommand: -1, depth: 0, inTail: false, command: 0,
})

/** The six apply buckets, which must equal `budget.used` for a rollout (spec D7-A1). */
export const profiledApplies = (p: RolloutProfile): number =>
  p.loopScoringApplies + p.resolverScoringApplies + p.tailScoringApplies
  + p.loopAdvanceApplies + p.resolverAdvanceApplies + p.tailAdvanceApplies

/** Which scope an apply belongs to right now, from the working state alone. */
const scopeOf = (p: RolloutProfile): 'loop' | 'resolver' | 'tail' =>
  p.depth > 0 ? 'resolver' : p.inTail ? 'tail' : 'loop'

export interface Budget { used: number; cap: number; profile?: RolloutProfile }
const within = (b: Budget | undefined): boolean => !b || b.used < b.cap

/**
 * The decisions that are part of finishing something already started, rather than a move of one's own: the two
 * combat steps, and (rung C1) the choices a resolving ability suspends on. `evaluate` may never see a state
 * owing one of these — a half-resolved attack prices an attack that dealt no damage (R4), and a half-resolved
 * ability prices an ability that did nothing (the same defect class, arriving by the new route).
 *
 * C2-6 opens a THIRD route to the same defect and it is the reason for the second clause. `drainResolution` now
 * completes ONE frame and yields, so `settle` interleaves §12.3 rule processes between frames — and a rule
 * process can enqueue an observer trigger (spec C2-4) BEHIND a decision that is already on the table. Settlement
 * then stops on a pending that is not one of the four, with frames still queued, and `evaluate` would price a
 * board whose queued clause has not done its work. So: the four kinds are forced unconditionally, and every
 * OTHER kind is forced exactly while the agenda still owes something. Setup choices (`mulligan`, `chooseFirst`)
 * are unaffected — nothing is ever queued during setup — so they stay the agent's own move to score.
 */
const isForcedDecision = (state: GameState): boolean => {
  const kind = state.pending?.kind
  if (kind === undefined) return false
  if (kind === 'declareBlock' || kind === 'assignPartyDamage' || kind === 'chooseTargets' || kind === 'chooseMode') return true
  return hasResolutionWork(state.resolution)
}

/**
 * Abilities the DECIDING player announced and could not carry out, while a candidate was simulated.
 *
 * It is a tally rather than a score component because `evaluate` prices a BOARD, and two modes of the same
 * ability can leave boards that are equal to the last bit: Shantotto's "give another Forward Haste" and
 * "protect a Forward you control" both come to exactly 0 when she is the only Forward and nothing threatens
 * her. The first is impossible, the second merely worthless, and with `>` keeping the earlier candidate the AI
 * announced its ability and then did nothing. Worth zero and impossible are not the same thing, and only the
 * second is visible to the player as a blunder.
 *
 * Kept OUT of the score and applied lexicographically (`better` below) so the guarantee is structural: a
 * fizzling rider can never talk the agent out of a play whose body is worth something, whatever the weights
 * are scaled to. Subtracting an epsilon instead only looked safe — `Weights` admits any magnitude, and a
 * candidate with a genuine +1e-7 advantage lost to a 1e-6 penalty (Codex MINOR).
 */
export interface Waste { fizzled: number }

/**
 * Count only the fizzles belonging to `me`.
 *
 * An ability of the OPPONENT'S that finds no target is not the agent's waste, and pricing it as one inverts the
 * sign: breaking an opponent's Forward can strand their observer trigger, and an unfiltered tally then made the
 * agent avoid the break for exactly that reason (Codex MAJOR). `controller` comes off the event, so a Summon
 * resolving from the Break Zone is attributed as correctly as a Forward on the field.
 */
const countFizzles = (events: readonly Event[], me: PlayerId, waste?: Waste): void => {
  if (!waste) return
  for (const e of events) if (e.type === 'abilityNoLegalTarget' && e.controller === me) waste.fizzled++
}

/** Evaluation first, and the wasted-ability tally ONLY to break an exact tie. Never the other way round. */
const better = (score: number, fizzled: number, bestScore: number, bestFizzled: number): boolean =>
  score !== bestScore ? score > bestScore : fizzled < bestFizzled

/**
 * Fast-forward through every forced decision: while one is pending, the acting player `p` answers with
 * `greedyStep`, scored from `p === perspective ? aggression : 1 - aggression` (C4 — keyed on the explicit
 * `perspective` player, not `state.turnPlayer`, so the agent's own defensive decisions are scored from its own
 * viewpoint even though the attacker holds `turnPlayer`/priority throughout the Attack Phase). Never exits early
 * because the budget is exhausted (W1) — every apply here still counts against it, but a combat and an ability
 * always run to completion.
 *
 * Terminates: the combat kinds strictly advance the attack (a block decision, then optionally a party-damage
 * split, then neither), and an ability choice strictly advances its frame's program counter — `resolution.steps`
 * persists across choices precisely so a clause that never finishes hits `MAX_RESOLUTION_STEPS` and throws
 * (spec C1-5) rather than spinning here. The C2-6 clause of `isForcedDecision` adds no new way to spin: it only
 * ever fires while the agenda is non-empty, and answering the pending lets `settle` drain a frame, so each pass
 * either shrinks the agenda or hits the step cap.
 */
export function resolveForcedDecisions(state: GameState, weights: Weights, aggression: number, perspective: PlayerId, budget?: Budget, waste?: Waste): GameState {
  let s = state
  // D7: everything under this call is a decision the policy did not choose to face. The depth is held for the
  // whole loop, so the `greedyStep` below sees it too — that is what makes the scope free of a parameter.
  const prof = budget?.profile
  if (prof) prof.depth++
  try {
    while (!s.result && isForcedDecision(s)) {
      const p = actingPlayer(s)
      if (p === null) break
      const localAggression = p === perspective ? aggression : 1 - aggression
      const c = greedyStep(s, p, weights, localAggression, budget)
      if (!c) break
      const r = apply(s, c)
      countFizzles(r.events, perspective, waste)
      s = r.state
      if (budget) budget.used++
      // Depth is already raised here, so an advancing apply inside the TAIL still reads as `resolver`; the
      // tail's own scope is decided by `inTail` only when depth returns to zero. Take the outer reading.
      if (prof) { if (prof.inTail && prof.depth === 1) prof.tailAdvanceApplies++; else prof.resolverAdvanceApplies++ }
    }
  } finally {
    // `finally` because `greedyStep` can throw (the engine's resolution-step cap), and a depth left raised
    // would misattribute every later apply in the run.
    if (prof) prof.depth--
  }
  return s
}

/**
 * Score every legal command for `player` and return the best one (ties keep the earlier candidate). Always
 * guarantees at least the first candidate is applied and scored, even with an exhausted budget (W1) — only
 * subsequent candidates are gated by `within(budget)`. Every candidate is scored on `resolveForcedDecisions(apply(state,
 * c).state, weights, aggression, player, budget)` — `player` doubles as the perspective, so a nested call here
 * (e.g. scoring a `declareBlock` candidate from inside `resolveForcedDecisions`'s own loop) resolves that candidate's
 * combat all the way through (a party's damage split included, W2) before it is evaluated, not on the mid-combat
 * snapshot taken the instant it is applied. The recursion this creates is bounded: each pending kind strictly
 * advances the attack, so a block decision recurses into at most one further (party-damage) decision.
 */
export function greedyStep(state: GameState, player: PlayerId, weights: Weights, aggression: number, budget?: Budget): Command | null {
  let best: Command | null = null
  let bestScore = -Infinity
  let bestFizzled = Infinity
  let i = 0
  const prof = budget?.profile
  // Read ONCE, before the loop: the nested `resolveForcedDecisions` below raises and lowers the depth inside
  // each iteration, so reading it per-iteration would be reading it at the wrong moment.
  const scope = prof ? scopeOf(prof) : 'loop'
  const cands = candidateCommands(state, player)
  if (prof) {
    if (scope === 'resolver') prof.resolverGenerated += cands.length
    else if (scope === 'tail') prof.tailGenerated += cands.length
    else prof.loopGenerated += cands.length
  }
  for (const c of cands) {
    if (i > 0 && !within(budget)) {
      if (prof) {
        prof.refusals++
        if (prof.firstRefusalAtCommand < 0) prof.firstRefusalAtCommand = prof.command
      }
      break
    }
    i++
    const waste: Waste = { fizzled: 0 }
    const r = apply(state, c)
    countFizzles(r.events, player, waste)
    if (budget) budget.used++
    if (prof) {
      if (scope === 'resolver') { prof.resolverScored++; prof.resolverScoringApplies++ }
      else if (scope === 'tail') { prof.tailScored++; prof.tailScoringApplies++ }
      else { prof.loopScored++; prof.loopScoringApplies++ }
    }
    const scored = resolveForcedDecisions(r.state, weights, aggression, player, budget, waste)
    const score = evaluate(scored, player, weights, aggression)
    if (better(score, waste.fizzled, bestScore, bestFizzled)) { best = c; bestScore = score; bestFizzled = waste.fizzled }
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

export interface CandidateScore {
  command: Command; score: number; turn: number; used: number
  /** R4 diagnostic: the pending kind of the state that was actually scored. It must never be a FORCED decision
   *  (`isForcedDecision`) — that would mean `evaluate` priced a mid-combat snapshot or a half-resolved ability,
   *  which inverts the value of an attack. It is routinely non-null otherwise: `mulligan`, `chooseFirst` and
   *  `discardToHandSize` show up on scored states in normal play (measured across 66,350 decisions) and are
   *  priced correctly. Exposed so the real invariant is directly assertable rather than inferred from a score. */
  pendingKind: string | null
  /** The C1 half of the same diagnostic: work still on the resolution agenda (active + queued + continuation).
   *  MUST be 0 — a scored state with an unfinished ability prices a clause that has not done its work yet.
   *  C2-6 couples the two fields: the benign non-null `pendingKind`s above are benign ONLY at a zero agenda, and
   *  `isForcedDecision`'s second clause is what keeps that true now that rule processes run between frames. */
  resolutionQueued: number
  /** Abilities `me` announced under this candidate and could not carry out. Deliberately NOT folded into
   *  `score`: it breaks an exact tie and nothing more (see `Waste`), so `score` stays the honest evaluation. */
  fizzled: number
}

/** Work the agenda still owes: the active frame, the queue, and a system continuation (which only
 *  `drainResolution` consumes, so a state carrying nothing but one is NOT settled). Zero on a settled state. */
const agendaSize = (s: GameState): number =>
  (s.resolution.active ? 1 : 0) + s.resolution.queue.length + (s.resolution.continuation ? 1 : 0)

/**
 * Score every top-level candidate independently (C1): each gets its own fresh `Budget` sized
 * `max(1, floor(maxSimulations / cands.length))`, so the result — and therefore the argmax `decide` picks — is
 * invariant under the order `cands` is given in (a shared budget is not: early candidates would consume rollout
 * work that later ones then lack). For each candidate: apply it and fully resolve every forced decision it opens
 * — combat and ability resolution alike (both exempt from the budget cap, W1); then, per `depth`, roll out greedily to the end of the acting turn owner's
 * turn (depth >= 1) and/or the following turn (depth >= 2), bounded by the budget. `turn` records the scored
 * state's turn number (for asserting where a rollout stopped); `used` is that candidate's own budget spend.
 */
export function scoreCandidates(det: GameState, cands: Command[], opts: CandidateScoreOptions): CandidateScore[] {
  const perCandidate = Math.max(1, Math.floor(opts.maxSimulations / cands.length))
  return cands.map((cand) => {
    const budget: Budget = { used: 0, cap: perCandidate }
    // Only the fizzles this candidate CAUSES are counted, not the ones a distant rollout turn stumbles into:
    // the tie-break is about the decision on the table. So the rollouts below deliberately pass no `waste`.
    const waste: Waste = { fizzled: 0 }
    const applied = apply(det, cand)
    countFizzles(applied.events, opts.me, waste)
    let s = applied.state
    budget.used++   // floor: every candidate gets at least one apply regardless of budget
    s = resolveForcedDecisions(s, opts.weights, opts.aggression, opts.me, budget, waste)
    const rollout = (until: (t: GameState) => boolean) => {
      while (!s.result && until(s) && within(budget)) {
        const p = actingPlayer(s)!
        const c = greedyStep(s, p, opts.weights, p === opts.me ? opts.aggression : 1 - opts.aggression, budget)
        if (!c) break
        s = apply(s, c).state; budget.used++
        // R4: resolve whatever this command opened BEFORE the loop can exit on an exhausted budget. Without
        // this, a rollout that declares an attack and then runs out of budget leaves `pending: declareBlock`
        // set, and `evaluate` prices a state where the attack was declared but no damage was dealt — which
        // inverts an attack's value. C1 adds the same hazard by a second route: a cast that triggers an ETB
        // clause leaves `pending: chooseMode`/`chooseTargets`, and the ability's effect is priced as nothing.
        // Both are budget-exempt (W1) precisely so this always completes.
        s = resolveForcedDecisions(s, opts.weights, opts.aggression, opts.me, budget)
      }
    }
    if (opts.depth >= 1) rollout((t) => t.turnPlayer === opts.owner)   // finish the current turn (mine, or the opponent's when I am blocking)
    if (opts.depth >= 2) rollout((t) => t.turnPlayer !== opts.owner)   // and the following turn
    const score = evaluate(s, opts.me, opts.weights, opts.aggression)
    return { command: cand, score, turn: s.turn, used: budget.used, pendingKind: s.pending?.kind ?? null, resolutionQueued: agendaSize(s), fizzled: waste.fizzled }
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
    // C1: ability targets are card ids like any other. `chooseMode` answers are indices into the pending's
    // printed labels, not ids, so it has none to check.
    case 'chooseTargets': return [...c.targets]
    // C3: the activation names its source AND every CP source it spends; all are ids that must be real.
    case 'activateAbility': return [c.source, ...c.payment.dullBackups, ...c.payment.discards.map((d) => d.card)]
    // `chooseFromDeck` answers with INDICES, so like `chooseMode` it carries no card id to check.
    case 'chooseFirst': case 'mulligan': case 'chooseMode': case 'chooseFromDeck': case 'pass': case 'concede': return []
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
      // R2: conceding is only ever the right answer when we are NOT the acting player — then [concede] genuinely
      // is the whole legal set (§2.1). When we ARE acting and candidate generation produced nothing, that is a gap
      // in `candidateCommands` (which mirrors `legalCommands`'s switch rather than deriving from it), and
      // `legalCommands` puts concede first — so falling back to `pool[0]` would silently throw the game rather
      // than surface the bug. Fail loudly instead, per 5e82a7e's "fail loudly on a dead end, don't silently
      // concede" policy; a genuine engine dead end is caught by self-play's strict invariant check.
      if (actingPlayer(det) === me) {
        throw new Error(`GreedyAgent.decide: no candidate commands while acting in ${det.phase}/${det.attack?.step ?? '-'}/${det.pending?.kind ?? '-'}`)
      }
      // legal may be [] here (needsLegalCommands is false, so a caller may skip generating it on the hot
      // path); compute it ourselves rather than relying on the argument, but reuse a non-empty one as-is.
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
    let bestFizzled = Infinity
    for (const sc of scores) {
      if (better(sc.score, sc.fizzled, bestScore, bestFizzled)) { best = sc.command; bestScore = sc.score; bestFizzled = sc.fizzled }
    }
    this.lastSimulations = scores.reduce((n, sc) => n + sc.used, 0)
    this.lastScores = scores
    this.lastDepth = depth
    // W4: candidates are built from `me`'s own resources in the determinised state, which are always real
    // (visible) ids — a chosen command should never reference a hidden card's synthetic id.
    for (const id of commandCardIds(best)) if (id >= SYNTHETIC_ID_BASE) throw new Error(`GreedyAgent.decide: chosen command ${best.type} references synthetic id ${id}`)
    return best
  }
}
