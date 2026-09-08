import { opponentOf } from './types.js'
import type { GameState } from './state.js'
import { EMPTY_RESOLUTION, hasResolutionWork } from './abilities.js'
import type { Command } from './commands.js'
import type { Event } from './events.js'
import { IllegalCommandError } from './errors.js'
import { applyActivateAbility } from './activate.js'
import { actingPlayer } from './legal.js'
import { applyChooseFirst, applyMulligan } from './setup.js'
import { applyDiscardToHandSize, applyPass } from './phases.js'
import { applyCastCharacter, applyCastSummon } from './cast.js'
import { applyAssignPartyDamage, applyChooseExBurst, applyDeclareAttack, applyDeclareBlock } from './attack.js'
import { runRuleProcesses } from './rules.js'
import { advanceAgenda, applyChooseFromDeck, applyChooseMode, applyChooseTargets, clearStackAtGameOver } from './resolve.js'

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
  // Rule processes belong BETWEEN frames, never inside one — `resolution.active` is exactly the flag for
  // "a frame is mid-flight", so the loop runs them only when it is null. Three failures this ordering avoids,
  // each of which the other two orderings caused:
  //
  //  - Run them only at the top and exit straight after a drain, and a Forward killed by ability damage is
  //    never broken (§12.4.5): Ramuh dealing 5000 to a 5000-power Forward left it standing.
  //  - Run them on EVERY pass, and they fire between a choice being raised and answered, breaking a card that
  //    is already in `pending.candidates` so the answer is rejected as an illegal target.
  //  - Run them before RESUMING a frame, and they break a card the frame already chose: Ramuh may legally
  //    pick damage and Haste for the same Forward, and the Haste would silently skip a target the damage had
  //    just killed. A frame must be atomic across the commands that answer its prompts.
  //
  // Rung J1-D2/D4: what the loop advances is PLACEMENT (a triggered clause declaring its choices as it goes
  // onto the stack, §11.8.7) and the frames of the item RESOLVING on top (started by `applyPass` when both
  // players forfeit). It never resolves a waiting stack item itself: that is a response window's exit.
  for (;;) {
    if (!s.resolution.active) {
      const [ruled, ruleEvents] = runRuleProcesses(s)
      s = ruled; events.push(...ruleEvents)
      if (s.result) break
      if (!hasResolutionWork(s.resolution)) break   // settled, and rule processes have run
    }
    const [advanced, advanceEvents] = advanceAgenda(s)
    s = advanced; events.push(...advanceEvents)
    if (s.result || s.pending) break
  }
  if (s.result) s = { ...clearStackAtGameOver(s), resolution: EMPTY_RESOLUTION }   // nothing may stay queued after game over
  // Rung J1-D12: the step budget spans one whole settlement, stack items included — reset only when nothing
  // is running, placing, triggered or waiting, and no choice is owed.
  else if (!s.pending && !hasResolutionWork(s.resolution) && s.stack.length === 0) s = { ...s, resolution: { ...s.resolution, steps: 0 } }
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
      case 'chooseExBurst': [s, events] = applyChooseExBurst(state, command.player, command.use); break
      case 'chooseMode': [s, events] = applyChooseMode(state, command.player, command.modes); break
      case 'chooseFromDeck': [s, events] = applyChooseFromDeck(state, command.player, command.picks); break
      case 'activateAbility':
        [s, events] = applyActivateAbility(state, command.player, command.source, command.abilityId, command.payment, command.targets); break
      case 'pass': [s, events] = applyPass(state, command.player); break
      case 'concede':
        s = { ...clearStackAtGameOver(state), pending: null, resolution: EMPTY_RESOLUTION, result: { winner: opponentOf(command.player), cause: 'concede', reason: `player ${command.player} conceded (§2.1)` } }; events = []; break
    }
  } catch (e) {
    if (e instanceof IllegalCommandError) throw new IllegalCommandError(e.message, command)
    throw e
  }
  if (!s.result) { const [t, more] = settle(s); s = t; events = [...events, ...more] }
  // A result set by the command itself (a block whose damage is lethal) skips `settle`, so the stack is
  // emptied here too — one rule, every exit (rung J1-D1).
  else s = { ...clearStackAtGameOver(s), resolution: EMPTY_RESOLUTION }
  if (s.result && events.at(-1)?.type !== 'gameOver') events = [...events, { type: 'gameOver', result: s.result }]
  return { state: s, events }
}
