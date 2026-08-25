import { opponentOf } from './types.js'
import type { GameState } from './state.js'
import type { Command } from './commands.js'
import type { Event } from './events.js'
import { IllegalCommandError } from './errors.js'
import { actingPlayer } from './legal.js'
import { applyChooseFirst, applyMulligan } from './setup.js'
import { applyDiscardToHandSize, applyPass } from './phases.js'
import { applyCastCharacter, applyCastSummon } from './cast.js'
import { applyAssignPartyDamage, applyDeclareAttack, applyDeclareBlock } from './attack.js'
import { runRuleProcesses } from './rules.js'

export interface ApplyResult { state: GameState; events: Event[] }

export function apply(state: GameState, command: Command): ApplyResult {
  if (state.result) throw new IllegalCommandError('game is over', command)
  if (command.type !== 'concede' && actingPlayer(state) !== command.player) throw new IllegalCommandError(`player ${command.player} is not the acting player`, command)

  let s: GameState; let events: Event[]
  try {
    switch (command.type) {
      case 'chooseFirst': [s, events] = applyChooseFirst(state, command.player, command.goFirst); break
      case 'mulligan': [s, events] = applyMulligan(state, command.player, command.redraw); break
      case 'castCharacter': [s, events] = applyCastCharacter(state, command.player, command.card, command.payment); break
      case 'castSummon': [s, events] = applyCastSummon(state, command.player, command.card, command.payment); break
      case 'declareAttack': [s, events] = applyDeclareAttack(state, command.player, command.attackers); break
      case 'declareBlock': [s, events] = applyDeclareBlock(state, command.player, command.blocker); break
      case 'assignPartyDamage': [s, events] = applyAssignPartyDamage(state, command.player, command.assignments); break
      case 'discardToHandSize': [s, events] = applyDiscardToHandSize(state, command.player, command.cards); break
      case 'pass': [s, events] = applyPass(state, command.player); break
      case 'concede':
        s = { ...state, result: { winner: opponentOf(command.player), reason: `player ${command.player} conceded (§2.1)` } }; events = []; break
    }
  } catch (e) {
    if (e instanceof IllegalCommandError) throw new IllegalCommandError(e.message, command)
    throw e
  }
  if (!s.result) {   // §12.3: rule processes whenever a player would gain priority
    const [r, more] = runRuleProcesses(s); s = r; events = [...events, ...more]
  }
  if (s.result && events.at(-1)?.type !== 'gameOver') events = [...events, { type: 'gameOver', result: s.result }]
  return { state: s, events }
}
