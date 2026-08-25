import type { PlayerId } from './types.js'
import type { CardId, GameState } from './state.js'
import { defOf } from './state.js'
import type { Command } from './commands.js'
import { enumeratePayments } from './cp.js'
import { castCheck } from './cast.js'
import { legalAttackSets, legalBlockers, legalPartyDamageAssignments } from './attack.js'

export function actingPlayer(state: GameState): PlayerId | null {
  if (state.result) return null
  return state.pending?.player ?? state.priority
}

function combinations(items: CardId[], k: number): CardId[][] {
  if (k === 0) return [[]]
  return items.flatMap((x, i) => combinations(items.slice(i + 1), k - 1).map((rest) => [x, ...rest]))
}

export function legalCommands(state: GameState, player: PlayerId): Command[] {
  if (state.result) return []
  const out: Command[] = [{ type: 'concede', player }]   // §2.1: always allowed
  if (actingPlayer(state) !== player) return out
  const pending = state.pending
  if (pending) {
    switch (pending.kind) {
      case 'chooseFirst':
        out.push({ type: 'chooseFirst', player, goFirst: true }, { type: 'chooseFirst', player, goFirst: false }); break
      case 'mulligan':
        out.push({ type: 'mulligan', player, redraw: false }, { type: 'mulligan', player, redraw: true }); break
      case 'discardToHandSize':
        for (const cards of combinations(state.players[player].hand, pending.count)) out.push({ type: 'discardToHandSize', player, cards })
        break
      case 'declareBlock':
        out.push({ type: 'declareBlock', player, blocker: null })
        for (const blocker of legalBlockers(state, player)) out.push({ type: 'declareBlock', player, blocker })
        break
      case 'assignPartyDamage':
        for (const assignments of legalPartyDamageAssignments(state)) out.push({ type: 'assignPartyDamage', player, assignments })
        break
    }
    return out
  }
  switch (state.phase) {
    case 'main1':
    case 'main2': {
      for (const card of state.players[player].hand) {
        if (castCheck(state, player, card) !== null) continue
        const type = defOf(state, card).type === 'summon' ? 'castSummon' : 'castCharacter'
        for (const payment of enumeratePayments(state, player, card)) out.push({ type, player, card, payment })
      }
      out.push({ type: 'pass', player })
      break
    }
    case 'attack': {
      if (state.attack?.step === 'declaration') {
        for (const attackers of legalAttackSets(state, player)) out.push({ type: 'declareAttack', player, attackers })
        out.push({ type: 'pass', player })
      }
      break
    }
    default:
      break   // setup/active/draw/end never wait for a non-pending command
  }
  return out
}
