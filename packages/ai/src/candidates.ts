import { actingPlayer, attackCheck, castCheck, defOf, legalAttackSets, legalBlockers, legalPartyDamageAssignments, type CardId, type Command, type GameState, type PlayerId } from '@fftcg/engine'
import { cardValue } from './cardValue.js'
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
