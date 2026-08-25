import { actingPlayer, castCheck, defOf, legalAttackSets, legalBlockers, legalPartyDamageAssignments, type Command, type GameState, type PlayerId } from '@fftcg/engine'
import { cardValue } from './cardValue.js'
import { preferredPayment } from './payment.js'

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
    for (const attackers of legalAttackSets(state, player)) out.push({ type: 'declareAttack', player, attackers })
    out.push({ type: 'pass', player })
  }
  return out
}
