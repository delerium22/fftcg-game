import { opponentOf } from './types.js'
import type { GameState } from './state.js'
import { EMPTY_RESOLUTION } from './abilities.js'
import type { Command } from './commands.js'
import type { Event } from './events.js'
import { IllegalCommandError } from './errors.js'
import { actingPlayer } from './legal.js'
import { applyChooseFirst, applyMulligan } from './setup.js'
import { applyDiscardToHandSize, applyPass } from './phases.js'
import { applyCastCharacter, applyCastSummon } from './cast.js'
import { applyAssignPartyDamage, applyDeclareAttack, applyDeclareBlock } from './attack.js'
import { runRuleProcesses } from './rules.js'
import { applyChooseMode, applyChooseTargets, drainResolution } from './resolve.js'

export interface ApplyResult { state: GameState; events: Event[] }

/**
 * §12.3 rule processes and the ability agenda settle together: a rule process can enqueue a zone-change trigger
 * (spec C1-8) and a resolving ability can create work for a rule process (damage, a power debuff), so alternate
 * until both are quiet — or until an ability owes the player a choice, which ends the command.
 *
 * `resolution.steps` is only reset once the whole settlement is idle. Resetting it per drain would let a
 * rule-process ⇄ trigger cycle restart the counter every pass and never hit the cap (spec C1-5).
 */
function settle(state: GameState): [GameState, Event[]] {
  const events: Event[] = []
  let s = state
  // The SETTLED exit must come after a rule-process pass. Testing it before the drain (rather than after)
  // is what makes the loop run one more time once an ability finishes: previously the terminal break fired
  // the instant the agenda emptied, with no trailing rule process, so a Forward killed by ability damage
  // was never broken (§12.4.5) — Ramuh dealing 5000 to a 5000-power Forward left it standing.
  //
  // The pending exit must NOT: rule processes between raising a choice and answering it can break a card
  // that is already in `pending.candidates`, and the answer is then rejected as an illegal target.
  for (;;) {
    const [ruled, ruleEvents] = runRuleProcesses(s)
    s = ruled; events.push(...ruleEvents)
    if (s.result) break
    if (!s.resolution.active && s.resolution.queue.length === 0) break
    const [drained, drainEvents] = drainResolution(s)
    s = drained; events.push(...drainEvents)
    if (s.result || s.pending) break
  }
  if (s.result) s = { ...s, resolution: EMPTY_RESOLUTION }   // nothing may stay queued after game over
  else if (!s.pending && !s.resolution.active && !s.resolution.queue.length) s = { ...s, resolution: { ...s.resolution, steps: 0 } }
  return [s, events]
}

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
      case 'chooseTargets': [s, events] = applyChooseTargets(state, command.player, command.targets); break
      case 'chooseMode': [s, events] = applyChooseMode(state, command.player, command.modes); break
      case 'pass': [s, events] = applyPass(state, command.player); break
      case 'concede':
        s = { ...state, pending: null, resolution: EMPTY_RESOLUTION, result: { winner: opponentOf(command.player), reason: `player ${command.player} conceded (§2.1)` } }; events = []; break
    }
  } catch (e) {
    if (e instanceof IllegalCommandError) throw new IllegalCommandError(e.message, command)
    throw e
  }
  if (!s.result) { const [t, more] = settle(s); s = t; events = [...events, ...more] }
  if (s.result && events.at(-1)?.type !== 'gameOver') events = [...events, { type: 'gameOver', result: s.result }]
  return { state: s, events }
}
