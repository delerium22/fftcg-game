import { abilityOf, actingPlayer, attackCheck, castCheck, defOf, effectivePower, findFieldCard, keywordsOf, legalAttackSets, legalBlockers, legalCommands, legalPartyDamageAssignments, targetCandidates, type CardId, type Command, type Effect, type GameState, type Pending, type PlayerId } from '@fftcg/engine'
import { cardValue } from './cardValue.js'
import { hasteUnlock, protectionValue } from './evaluate.js'
import { preferredPayment } from './payment.js'

const ATTACK_SET_EXPLOSION_THRESHOLD = 6

/**
 * `legalAttackSets` enumerates every subset of eligible attackers (2^n), which is fine for a handful of forwards
 * but explodes well before a 50-card deck's forward count is even reachable in practice. Above the threshold, fall
 * back to a bounded set of candidates (C5): every single attacker, every legal PAIR of attackers, and — per
 * element — the full party of every eligible forward sharing that element, deduplicated by sorted attacker-id
 * signature so e.g. two same-element pairs that happen to coincide, or a pair that equals a 2-forward "full
 * party", are only emitted once. This covers singles, small trading parties, and "attack with everything of one
 * element" without ever enumerating all 2^n combinations; every intermediate size above 2 is still not
 * considered — a deliberate bound, not full coverage.
 */
function boundedAttackSets(state: GameState, player: PlayerId): CardId[][] {
  const eligible = state.players[player].forwards.map((c) => c.id).filter((id) => attackCheck(state, player, [id]) === null)
  if (eligible.length <= ATTACK_SET_EXPLOSION_THRESHOLD) return legalAttackSets(state, player)
  const seen = new Set<string>()
  const out: CardId[][] = []
  const add = (set: CardId[]) => {
    const key = [...set].sort((a, b) => a - b).join(',')
    if (seen.has(key)) return
    seen.add(key)
    out.push(set)
  }
  for (const id of eligible) add([id])
  for (let i = 0; i < eligible.length; i++) {
    for (let j = i + 1; j < eligible.length; j++) {
      const pair = [eligible[i] as CardId, eligible[j] as CardId]
      if (attackCheck(state, player, pair) === null) add(pair)
    }
  }
  const byElement = new Map<string, CardId[]>()
  for (const id of eligible) for (const e of defOf(state, id).elements) byElement.set(e, [...(byElement.get(e) ?? []), id])
  for (const ids of byElement.values()) {
    if (ids.length < 2) continue
    if (attackCheck(state, player, ids) === null) add(ids)
  }
  return out
}

// ---------------------------------------------------------------------------
// The one-ply ability-target policy (spec C1, "The AI")
// ---------------------------------------------------------------------------

/**
 * `legalCommands` enumerates Σ C(N, k) answers for a `chooseTargets`/`chooseMode` pending — ~190 commands for
 * "up to 2" over both fields. Scoring all of them with a rollout each is the whole decision budget spent on one
 * ability. Instead the answers are RANKED by a cheap one-ply policy and only a handful of them are offered.
 */
const CHOICE_CANDIDATE_CAP = 6

/**
 * The `Effect` the active frame is suspended at. `resolve.ts` keeps its own `effectAt` private — it is the
 * authority `apply` re-validates against — so this is the AI's read-only copy of the same walk. Every caller
 * falls back to `legalCommands` when it returns null: being wrong here can only cost play strength, never
 * legality, because the engine re-derives the candidates itself.
 */
function effectAt(effects: readonly Effect[], path: readonly number[], modes: readonly number[], depth: number): Effect | null {
  const eff = effects[path[depth] ?? -1]
  if (!eff) return null
  if (depth === path.length - 1) return eff
  if (eff.kind === 'chooseTargets') return effectAt(eff.then, path, modes, depth + 1)
  if (eff.kind === 'chooseModes') {
    const k = path[depth + 1]
    const mode = k === undefined ? undefined : eff.modes[modes[k] ?? -1]
    return mode ? effectAt(mode.effects, path, modes, depth + 2) : null
  }
  return null
}

function suspendedEffect(state: GameState): Effect | null {
  const frame = state.resolution.active
  if (!frame) return null
  const ability = abilityOf(state, frame)
  return ability ? effectAt(ability.effects, frame.path, frame.modes, 0) : null
}

/** The side a target belongs to: its controller on the field, its owner in a Break Zone (§7.10). */
function sideOf(state: GameState, id: CardId): PlayerId {
  return findFieldCard(state, id)?.owner ?? state.cards[id]?.owner ?? 0
}

/**
 * How much better off the TARGET's own side is once `effects` resolve on it, in `evaluate`-ish units
 * (power/1000 and `cardValue`); harmful effects are negative. `targetScore` flips the sign for an opponent's
 * card, which is what turns one number into "how much I want to pick this".
 *
 * Only the effects directly under the chooser are priced. A nested chooser's value is not knowable one ply out
 * and every C1 clause is flat, so unknown shapes contribute 0 rather than a guess.
 */
function targetDelta(state: GameState, effects: readonly Effect[], id: CardId): number {
  const loc = findFieldCard(state, id)
  const def = defOf(state, id)
  const power = loc ? effectivePower(def, loc.card) : (def.power ?? 0)
  let d = 0
  for (const eff of effects) {
    switch (eff.kind) {
      case 'dull':
        // A dull Forward can neither attack (§10.1.2.1.1) nor block (§10.1.3.1.1); dulling an already-dull one
        // is a no-op, which is why an active target must OUTRANK a dull one rather than tie it.
        if (loc && loc.card.status === 'active') d -= power / 1000 + 1
        break
      case 'damage': {
        if (!loc || loc.zone !== 'forwards') break   // only Forwards carry damage
        // §12.4.5: damage ≥ power breaks. Damage that actually breaks is worth the whole card; damage that does
        // not is worth only the exposure it leaves behind.
        const breaks = power >= 1000 && loc.card.damage + eff.amount >= power && !loc.card.flags.includes('cannotBeBroken')
        d -= breaks ? cardValue(def) + power / 1000 : eff.amount / 1000
        break
      }
      case 'breakCard':
        if (loc && !loc.card.flags.includes('cannotBeBroken')) d -= cardValue(def) + power / 1000
        break
      case 'moveToHand':
        // From the field this is removal (that side loses a body and keeps the card); from the Break Zone it is
        // retrieval — pure gain, priced by the card itself.
        d += loc ? -(power / 1000) : cardValue(def)
        break
      case 'addPower':
        if (loc) d += eff.amount / 1000
        break
      case 'grantKeyword':
        // Priced by the SAME helpers `evaluate` uses, so the value the policy targets is the value the search
        // then sees. Granting a keyword the card already has is a no-op — score it as one.
        if (!loc || keywordsOf(state, loc.card).has(eff.keyword)) break
        d += eff.keyword === 'haste' ? hasteUnlock(state, loc.owner, loc.card, loc.zone === 'forwards') : 0.5
        break
      case 'grantFlag':
        if (loc && eff.flag === 'cannotBeBroken' && !loc.card.flags.includes('cannotBeBroken')) {
          d += protectionValue(state, loc.card, loc.zone === 'forwards')
        }
        break
      default: break   // chooseTargets / chooseModes / forEach: nested, deliberately unpriced
    }
  }
  return d
}

const targetScore = (state: GameState, me: PlayerId, effects: readonly Effect[], id: CardId): number =>
  (sideOf(state, id) === me ? 1 : -1) * targetDelta(state, effects, id)

/** Descending score, ties broken by ascending id/index — a total order, so ranking is deterministic. */
function rankBy(items: readonly number[], score: (x: number) => number): { ranked: number[]; scores: number[] } {
  const scored = items.map((x) => ({ x, s: score(x) })).sort((a, b) => b.s - a.s || a.x - b.x)
  return { ranked: scored.map((e) => e.x), scores: scored.map((e) => e.s) }
}

/** Best k in `min..max` by prefix sum of an already-descending score list, ties to the SMALLER k. */
function bestSize(scores: readonly number[], min: number, max: number): number {
  let best = min, bestSum = -Infinity, sum = 0
  for (let k = 0; k <= max; k++) {
    if (k > 0) sum += scores[k - 1] ?? 0
    if (k >= min && sum > bestSum) { best = k; bestSum = sum }
  }
  return best
}

/**
 * The bounded, deterministic answer set for a `min..max` choice over `ranked` (already best-first). The policy's
 * own pick comes FIRST — a budget-starved `greedyStep` scores only the first candidate, so the first candidate
 * has to be the answer the policy actually wants, not the smallest one. Then the other sizes, then a couple of
 * swap-variants at the best size so a well-resourced search can overrule a wrong ranking. Never enumerates
 * C(N, k).
 */
function policyChoices(ranked: readonly number[], scores: readonly number[], min: number, max: number): number[][] {
  const top = bestSize(scores, min, max)
  const out: number[][] = []
  const seen = new Set<string>()
  const push = (xs: number[]) => {
    const key = [...xs].sort((a, b) => a - b).join(',')
    if (seen.has(key) || out.length >= CHOICE_CANDIDATE_CAP) return
    seen.add(key)
    out.push(xs)
  }
  push(ranked.slice(0, top))
  for (let k = min; k <= max; k++) push(ranked.slice(0, k))
  for (let j = top; top >= 1 && j < ranked.length; j++) push([...ranked.slice(0, top - 1), ranked[j] as number])
  return out
}

/**
 * One-ply value of running `effects` for `me` — the same units as `targetDelta`, used to rank the MODES of a
 * `chooseModes` (they are only distinguishable by what their branches would do). A chooser inside a mode is
 * priced as the policy's own best answer to it.
 */
function effectsValue(state: GameState, me: PlayerId, source: CardId, controller: PlayerId, effects: readonly Effect[]): number {
  let v = 0
  for (const eff of effects) {
    if (eff.kind === 'chooseTargets') {
      const { scores } = rankBy(targetCandidates(state, source, controller, eff.from), (id) => targetScore(state, me, eff.then, id))
      const max = Math.min(eff.max, scores.length)
      if (eff.min > scores.length) continue   // cannot legally resolve: the executor no-ops it
      for (let k = 0; k < bestSize(scores, Math.min(eff.min, max), max); k++) v += scores[k] as number
    } else if (eff.kind === 'forEach') {
      for (const id of targetCandidates(state, source, controller, eff.from)) v += targetScore(state, me, eff.do, id)
    } else if (eff.kind === 'chooseModes') {
      const { scores } = rankBy(eff.modes.map((_, i) => i), (i) => effectsValue(state, me, source, controller, eff.modes[i]?.effects ?? []))
      const max = Math.min(eff.max, scores.length)
      for (let k = 0; k < bestSize(scores, Math.min(eff.min, max), max); k++) v += scores[k] as number
    }
    // Everything else needs a `chosen` binding it does not have at this level, so it contributes nothing.
  }
  return v
}

function chooseTargetsCandidates(state: GameState, player: PlayerId, pending: Extract<Pending, { kind: 'chooseTargets' }>): Command[] {
  const node = suspendedEffect(state)
  if (node?.kind !== 'chooseTargets') return legalCommands(state, player).filter((c) => c.type === 'chooseTargets')
  const { ranked, scores } = rankBy(pending.candidates, (id) => targetScore(state, player, node.then, id))
  const picks = policyChoices(ranked, scores, pending.min, Math.min(pending.max, ranked.length))
  return picks.map((targets) => ({ type: 'chooseTargets', player, targets }))
}

function chooseModeCandidates(state: GameState, player: PlayerId, pending: Extract<Pending, { kind: 'chooseMode' }>): Command[] {
  const frame = state.resolution.active
  const node = suspendedEffect(state)
  if (!frame || node?.kind !== 'chooseModes') return legalCommands(state, player).filter((c) => c.type === 'chooseMode')
  const { ranked, scores } = rankBy(node.modes.map((_, i) => i), (i) => effectsValue(state, player, frame.source, frame.controller, node.modes[i]?.effects ?? []))
  const picks = policyChoices(ranked, scores, pending.min, Math.min(pending.max, ranked.length))
  return picks.map((modes) => ({ type: 'chooseMode', player, modes: [...modes].sort((a, b) => a - b) }))
}

export function candidateCommands(state: GameState, player: PlayerId): Command[] {
  if (state.result || actingPlayer(state) !== player) return []
  const out: Command[] = []
  const pending = state.pending
  if (pending) {
    switch (pending.kind) {
      case 'chooseFirst': return [{ type: 'chooseFirst', player, goFirst: true }, { type: 'chooseFirst', player, goFirst: false }]
      case 'mulligan': return [{ type: 'mulligan', player, redraw: false }, { type: 'mulligan', player, redraw: true }]
      case 'discardToHandSize': {
        const byValue = [...state.players[player].hand].sort((a, b) => cardValue(defOf(state, a)) - cardValue(defOf(state, b)))
        return [{ type: 'discardToHandSize', player, cards: byValue.slice(0, pending.count) }]
      }
      case 'declareBlock': return [{ type: 'declareBlock', player, blocker: null }, ...legalBlockers(state, player).map((blocker) => ({ type: 'declareBlock' as const, player, blocker }))]
      case 'assignPartyDamage': return legalPartyDamageAssignments(state).map((assignments) => ({ type: 'assignPartyDamage' as const, player, assignments }))
      case 'chooseTargets': return chooseTargetsCandidates(state, player, pending)
      case 'chooseMode': return chooseModeCandidates(state, player, pending)
      // W3: exhaustive — a new Pending kind must fail to compile here rather than silently falling through to phase generation.
      default: { const _exhaustive: never = pending; return _exhaustive }
    }
  }
  if (state.phase === 'main1' || state.phase === 'main2') {
    for (const card of state.players[player].hand) {
      if (castCheck(state, player, card) !== null) continue
      const payment = preferredPayment(state, player, card)
      if (!payment) continue
      out.push({ type: defOf(state, card).type === 'summon' ? 'castSummon' : 'castCharacter', player, card, payment })
    }
    out.push({ type: 'pass', player })
  } else if (state.phase === 'attack' && state.attack?.step === 'declaration') {
    for (const attackers of boundedAttackSets(state, player)) out.push({ type: 'declareAttack', player, attackers })
    out.push({ type: 'pass', player })
  }
  return out
}
