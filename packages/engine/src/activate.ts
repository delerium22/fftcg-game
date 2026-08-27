import type { PlayerId } from './types.js'
import type { CardId, FieldCard, GameState } from './state.js'
import { defOf, findFieldCard, updatePlayer } from './state.js'
import type { Ability, AbilityCost } from './abilities.js'
import type { Payment } from './commands.js'
import type { Event } from './events.js'
import { IllegalCommandError } from './errors.js'
import { canPay, generateCp, pay, type CpRequirement } from './cp.js'
import type { ZoneTransition } from './rules.js'
import { enqueueTrigger, enqueueZoneChangeTriggers, removeFromField, targetCandidates } from './resolve.js'

/**
 * Activated abilities (spec C3): the transaction from declaration through simultaneous costs, cost triggers,
 * and the queued action frame.
 *
 * The order in here is the whole point and is not arbitrary:
 *
 *   1. check legality — including a PREFLIGHT of the ability's targets against the POST-cost state;
 *   2. pay every cost at once (§11.6.10) — there is no partial payment;
 *   3. enqueue the triggers the COSTS fired;
 *   4. enqueue the action frame LAST.
 *
 * Step 3 before step 4 because `drainResolution` is FIFO: an ability whose cost puts its own source into the
 * Break Zone fires observers that must resolve above the action that paid for them.
 */

/** The CP half of an ability's cost, as a requirement independent of the card's printed cost (spec C3-4). */
export function abilityCpRequirement(source: CardId, cost: AbilityCost): CpRequirement {
  return {
    amount: cost.cp?.amount ?? 0,
    requiredElements: cost.cp?.requiredElements ?? [],
    // The source can never help pay for itself — see `generateCp`.
    excluded: [source],
  }
}

/** Locate an activated clause by its stable id. Returns null when the card has no such clause. */
export function activatedAbility(state: GameState, source: CardId, abilityId: string): Ability | null {
  const def = defOf(state, source)
  const ability = (def.abilities ?? []).find((a) => a.id === abilityId)
  if (!ability || ability.trigger.kind !== 'activated') return null
  return ability
}

/** Where the card actually is, from the activating player's side only. */
function sourceZoneOf(state: GameState, player: PlayerId, source: CardId): 'field' | 'hand' | 'breakZone' | null {
  const ps = state.players[player]
  if (ps.hand.includes(source)) return 'hand'
  if (ps.breakZone.includes(source)) return 'breakZone'
  const loc = findFieldCard(state, source)
  if (loc && loc.owner === player) return 'field'
  return null
}

function hasHaste(state: GameState, card: FieldCard): boolean {
  return card.granted.includes('haste') || defOf(state, card.id).keywords.includes('haste')
}

/**
 * Why this activation is illegal, or null. Mirrors `castCheck`: `legalCommands` uses it to enumerate and
 * `apply` uses it to reject, so the two can never disagree.
 */
export function activationCheck(state: GameState, player: PlayerId, source: CardId, abilityId: string): string | null {
  if (state.result) return 'the game is over'
  // A decision is owed; nothing else may happen until it is answered.
  if (state.pending) return 'a decision is pending'
  // MVP0-SIMPLIFICATION (spec C3-11): action abilities are sorcery-speed here — the turn player, in a Main
  // Phase, only. The real rules (§9.3.1.7) also allow the Attack Phase, so this DOES cost something: Undead
  // Princess cannot be used as a combat trick after blockers are declared. `priority` is always the turn
  // player in MVP0, so no non-turn-player window is being lost, but that is not the same as losing nothing.
  if (state.turnPlayer !== player) return 'you may only use abilities on your own turn'
  if (state.phase !== 'main1' && state.phase !== 'main2') return 'you may only use abilities in a Main Phase'

  const ability = activatedAbility(state, source, abilityId)
  if (!ability || ability.trigger.kind !== 'activated') return `${abilityId} is not an activated ability of ${source}`
  const { sourceZone, cost } = ability.trigger

  const where = sourceZoneOf(state, player, source)
  if (where === null) return `you do not have ${source}`
  if (where !== sourceZone) return `${abilityId} may only be used from your ${sourceZone}`

  if (cost.dull) {
    // §11.6.2.2 — the dull icon, and ONLY the dull icon, brings the active/entered-this-turn/Haste rule with
    // it. An ability without it (Undead Princess) is usable while dulled and on the turn its source arrives.
    const loc = findFieldCard(state, source)
    if (!loc) return 'only a card on the field can be dulled'
    if (loc.card.status !== 'active') return `${source} is already dull`
    if (loc.card.enteredTurn === state.turn && !hasHaste(state, loc.card)) {
      return `${source} entered the field this turn (§11.6.2.2)`
    }
  }
  if (cost.selfToBreakZone && !findFieldCard(state, source)) return 'only a card on the field can be put into the Break Zone'
  if (cost.selfDiscard && !state.players[player].hand.includes(source)) return 'only a card in your hand can be discarded'

  // Preflight the targets against the state as it will be AFTER the costs are paid (§11.6.5).
  const [post] = applyCosts(state, player, source, cost, { dullBackups: [], discards: [] }, /* validate */ false)
  const first = ability.effects[0]
  if (first?.kind === 'chooseTargets') {
    const candidates = targetCandidates(post, source, player, first.from)
    if (candidates.length === 0 || first.min > candidates.length) return `${abilityId} has no legal target`
  }
  return null
}

/**
 * Apply every non-CP cost, plus (when `validate`) the CP payment. Returns the new state, its events, and any
 * zone transitions the cost produced.
 *
 * Used twice: once with an empty payment and `validate: false` to preflight targets, and once for real. The
 * preflight deliberately skips CP because CP does not move the source card and so cannot change who is a
 * legal target.
 */
function applyCosts(
  state: GameState, player: PlayerId, source: CardId, cost: AbilityCost, payment: Payment, validate: boolean,
): [GameState, Event[], ZoneTransition[]] {
  let s = state
  const events: Event[] = []
  const transitions: ZoneTransition[] = []

  if (validate) {
    const req = abilityCpRequirement(source, cost)
    const cp = generateCp(s, player, payment, req.excluded)
    if (!canPay(req.amount, req.requiredElements, cp)) {
      throw new IllegalCommandError(`payment does not cover cost ${req.amount} ${req.requiredElements.join('/')}`)
    }
    const [paid, payEvents] = pay(s, player, payment)
    s = paid
    events.push(...payEvents)
  }

  if (cost.dull) {
    s = setStatus(s, source, 'dull')
    events.push({ type: 'activated', player, cards: [source] })
  }
  if (cost.selfToBreakZone) {
    const loc = findFieldCard(s, source)
    if (loc) {
      // NOT a break (§15.1.1.3.2): `cannotBeBroken` is not consulted and no `broken` event is emitted. It IS
      // a zone movement, so the transition is produced and observers of "put from the field into the Break
      // Zone" — which is the printed wording the implemented watcher encodes — still see it (spec C3-7).
      const owner = s.cards[source]?.owner ?? loc.owner
      transitions.push({
        card: source, controller: loc.owner, owner,
        from: loc.zone === 'backups' ? 'backups' : 'forwards', to: 'breakZone', reason: 'cost',
        cause: source, causeController: player, snapshot: loc.card,
      })
      s = updatePlayer(removeFromField(s, source), owner, (ps) => ({ ...ps, breakZone: [...ps.breakZone, source] }))
      events.push({ type: 'paidToBreakZone', player, card: source })
    }
  }
  if (cost.selfDiscard) {
    const owner = s.cards[source]?.owner ?? player
    s = updatePlayer(s, player, (ps) => ({ ...ps, hand: ps.hand.filter((id) => id !== source) }))
    s = updatePlayer(s, owner, (ps) => ({ ...ps, breakZone: [...ps.breakZone, source] }))
    events.push({ type: 'discarded', player, card: source, reason: 'cp' })
  }
  return [s, events, transitions]
}

function setStatus(state: GameState, card: CardId, status: 'active' | 'dull'): GameState {
  const loc = findFieldCard(state, card)
  if (!loc) return state
  return updatePlayer(state, loc.owner, (ps) => ({
    ...ps,
    forwards: ps.forwards.map((c) => (c.id === card ? { ...c, status } : c)),
    backups: ps.backups.map((c) => (c.id === card ? { ...c, status } : c)),
  }))
}

export function applyActivateAbility(
  state: GameState, player: PlayerId, source: CardId, abilityId: string, payment: Payment,
): [GameState, Event[]] {
  const why = activationCheck(state, player, source, abilityId)
  if (why) throw new IllegalCommandError(why)
  const ability = activatedAbility(state, source, abilityId)
  if (!ability || ability.trigger.kind !== 'activated') throw new IllegalCommandError('unreachable: checked above')

  const pre = state   // observers are read PRE-move, exactly as `breakCard` does
  const [paid, events, transitions] = applyCosts(state, player, source, ability.trigger.cost, payment, true)
  events.unshift({ type: 'abilityActivated', player, card: source, abilityId })

  // Cost triggers BEFORE the action frame: `drainResolution` is FIFO, and the observers a cost fires resolve
  // above the ability that paid them (spec C3-8).
  let s = enqueueZoneChangeTriggers(pre, paid, transitions)
  s = enqueueTrigger(s, source, player, ability)
  return [s, events]
}
