import { actingPlayer, apply, createGame, legalCommands, viewFor, type CardDef, type GameState } from '@fftcg/engine'
import { IsmctsAgent, GreedyAgent, profiledApplies, type RolloutProfile } from '@fftcg/ai'

/**
 * Rung D7 — where a rollout's `apply` calls actually go.
 *
 * A dedicated harness rather than a flag threaded through `selfplay`, because this answers one question and
 * the answer has a shape of its own. Rung D6 was refused for inferring this division instead of measuring it;
 * this is the measurement, and nothing here changes how the search plays.
 */
export interface ProfileReport {
  games: number
  decisions: number
  /** Summed across every decision. The six apply buckets sum to `applies` — that identity is the check. */
  loopGenerated: number
  loopScored: number
  loopScoringApplies: number
  resolverGenerated: number
  resolverScored: number
  resolverScoringApplies: number
  loopAdvanceApplies: number
  resolverAdvanceApplies: number
  applies: number
  refusals: number
  /** The EARLIEST policy command at which the apply cap ever bound, or null if it never did. */
  firstRefusalAtCommand: number | null
  /** Shares of `applies`, rounded — the whole point of the rung. */
  shares: Record<string, string>
  /**
   * Decisions where the buckets did NOT equal what the search reported spending on rollouts. Must be 0.
   *
   * A real reconciliation, but a narrow one: `budget.used` and these buckets are separate accumulators, so an
   * omitted or double-counted apply shows up here. They are incremented at the same sites, though, so this
   * cannot see an apply MOVED between buckets, nor a deleted `apply()` whose counters both survive. The tests
   * cover those; this catches arithmetic drift over a long run.
   */
  mismatchedDecisions: number
  /**
   * Rung G1's gate, and the reason it may not be built at all: how many backpropagated leaves a damage weight
   * could actually reprice, and where they sit on the road to seven.
   *
   * A terminal leaf bypasses `material` and is already priced exactly, so it is counted apart. `atFiveOrSix`
   * is the share of REPRICEABLE leaves where either player stands at five or six damage — the states a curve
   * exists to distinguish. If that share is small, a curve is tuning noise and G1 should be abandoned.
   */
  leaves: {
    terminal: number
    heuristic: number
    terminalShare: string
    /** Non-terminal leaves by the root player's own damage, then by the opponent's. Index is the count. */
    byRootDamage: number[]
    byOpponentDamage: number[]
    atFiveOrSix: string
    atSix: string
    bothUnderFive: string
  }
}

const ZERO = {
  loopGenerated: 0, loopScored: 0, loopScoringApplies: 0,
  resolverGenerated: 0, resolverScored: 0, resolverScoringApplies: 0,
  tailGenerated: 0, tailScored: 0, tailScoringApplies: 0,
  loopAdvanceApplies: 0, resolverAdvanceApplies: 0, tailAdvanceApplies: 0, refusals: 0,
}

const DAMAGE_SLOTS = 8

export function profileSearch(opts: {
  games: number; seed: number; decks: [string[], string[]]; defs: CardDef[]; iterations: number
}): ProfileReport {
  const total = { ...ZERO }
  let decisions = 0
  let mismatched = 0
  let firstRefusal: number | null = null
  const leafDamage = new Array<number>(DAMAGE_SLOTS * DAMAGE_SLOTS).fill(0)
  let terminalLeaves = 0

  for (let g = 0; g < opts.games; g++) {
    const seed = opts.seed + g
    let s: GameState = createGame({ seed, decks: opts.decks, defs: opts.defs })
    // Seat 0 searches and is profiled; seat 1 is the heuristic, so the run costs one search per pair of moves.
    const searcher = new IsmctsAgent({ seed, decks: opts.decks, iterations: opts.iterations, profile: true })
    const other = new GreedyAgent({ seed: seed + 1, decks: opts.decks, depth: 1 })

    for (let i = 0; i < 4000 && !s.result; i++) {
      const p = actingPlayer(s)
      if (p === null) break
      const agent = p === 0 ? searcher : other
      const legal = agent.needsLegalCommands === false ? [] : legalCommands(s, p)
      s = apply(s, agent.decide(viewFor(s, p), legal)).state
      const diag = searcher.lastDiagnostics
      const prof = diag?.rollout
      if (p === 0 && diag && prof) {
        decisions++
        // The check, per decision and against an independent counter: `rolloutApplies` is accumulated by the
        // search itself from `budget.used`, while these four are accumulated at the apply sites.
        if (profiledApplies(prof) !== diag.rolloutApplies) mismatched++
        add(total, prof)
        for (let k = 0; k < leafDamage.length; k++) leafDamage[k] = (leafDamage[k] ?? 0) + (prof.leafDamage[k] ?? 0)
        terminalLeaves += prof.terminalLeaves
        if (prof.firstRefusalAtCommand >= 0) {
          firstRefusal = firstRefusal === null ? prof.firstRefusalAtCommand : Math.min(firstRefusal, prof.firstRefusalAtCommand)
        }
      }
    }
  }

  const applies = total.loopScoringApplies + total.resolverScoringApplies + total.tailScoringApplies
    + total.loopAdvanceApplies + total.resolverAdvanceApplies + total.tailAdvanceApplies
  const share = (n: number): string => (applies === 0 ? '—' : `${((n / applies) * 100).toFixed(1)} %`)
  return {
    games: opts.games,
    decisions,
    ...total,
    applies,
    firstRefusalAtCommand: firstRefusal,
    shares: {
      loopScoring: share(total.loopScoringApplies),
      resolverScoring: share(total.resolverScoringApplies),
      tailScoring: share(total.tailScoringApplies),
      loopAdvance: share(total.loopAdvanceApplies),
      resolverAdvance: share(total.resolverAdvanceApplies),
      tailAdvance: share(total.tailAdvanceApplies),
      // What is established without any inference: scoring, wherever on the stack it happened.
      allScoring: share(total.loopScoringApplies + total.resolverScoringApplies + total.tailScoringApplies),
    },
    mismatchedDecisions: mismatched,
    leaves: summariseLeaves(leafDamage, terminalLeaves),
  }
}

/**
 * The histogram, read back. Every share is over HEURISTIC leaves, not over all of them — a curve cannot move a
 * terminal, so including terminals in the denominator would understate exactly the quantity being sized.
 */
function summariseLeaves(hist: readonly number[], terminal: number): ProfileReport['leaves'] {
  const heuristic = hist.reduce((a, b) => a + b, 0)
  const byRootDamage = new Array<number>(DAMAGE_SLOTS).fill(0)
  const byOpponentDamage = new Array<number>(DAMAGE_SLOTS).fill(0)
  let fiveOrSix = 0
  let six = 0
  let bothUnderFive = 0
  for (let mine = 0; mine < DAMAGE_SLOTS; mine++) {
    for (let theirs = 0; theirs < DAMAGE_SLOTS; theirs++) {
      const n = hist[mine * DAMAGE_SLOTS + theirs] ?? 0
      if (n === 0) continue
      byRootDamage[mine] = (byRootDamage[mine] ?? 0) + n
      byOpponentDamage[theirs] = (byOpponentDamage[theirs] ?? 0) + n
      const hi = mine > theirs ? mine : theirs
      if (hi >= 5) fiveOrSix += n
      if (hi >= 6) six += n
      if (hi < 5) bothUnderFive += n
    }
  }
  const pct = (n: number): string => (heuristic === 0 ? '—' : `${((n / heuristic) * 100).toFixed(1)} %`)
  const all = heuristic + terminal
  return {
    terminal, heuristic,
    terminalShare: all === 0 ? '—' : `${((terminal / all) * 100).toFixed(1)} %`,
    byRootDamage, byOpponentDamage,
    atFiveOrSix: pct(fiveOrSix), atSix: pct(six), bothUnderFive: pct(bothUnderFive),
  }
}

function add(t: typeof ZERO, p: RolloutProfile): void {
  t.loopGenerated += p.loopGenerated
  t.loopScored += p.loopScored
  t.loopScoringApplies += p.loopScoringApplies
  t.resolverGenerated += p.resolverGenerated
  t.resolverScored += p.resolverScored
  t.resolverScoringApplies += p.resolverScoringApplies
  t.tailGenerated += p.tailGenerated
  t.tailScored += p.tailScored
  t.tailScoringApplies += p.tailScoringApplies
  t.loopAdvanceApplies += p.loopAdvanceApplies
  t.resolverAdvanceApplies += p.resolverAdvanceApplies
  t.tailAdvanceApplies += p.tailAdvanceApplies
  t.refusals += p.refusals
}
