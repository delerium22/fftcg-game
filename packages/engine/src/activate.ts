import type { PlayerId } from './types.js'
import type { CardId, FieldCard, GameState } from './state.js'
import { defOf, findFieldCard, updatePlayer } from './state.js'
import type { Ability, AbilityCost, Effect, Frame } from './abilities.js'
import type { Payment } from './commands.js'
import type { Event } from './events.js'
import { IllegalCommandError } from './errors.js'
import { canPay, generateCp, pay, type CpRequirement } from './cp.js'
import type { ZoneTransition } from './rules.js'
import { enqueueZoneChangeTriggers, removeFromField, targetCandidates } from './resolve.js'

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
 * The one effect an activation may answer up front: a `chooseTargets` at the HEAD of the ability.
 *
 * Returns `undefined` when the ability declares nothing. Throws when the AST is a shape this rung cannot
 * declare atomically — targeting that is not the first effect, a second `chooseTargets`, or a mode choice.
 * That is deliberate and load-bearing: the code review's counterexample was exactly such an AST silently
 * passing validation, paying its cost and resolving to nothing. An unsupported shape must be impossible to
 * ship, not merely unlikely, so it fails loudly the moment anyone writes one.
 */
export function declarationNode(ability: Ability): Extract<Effect, { kind: 'chooseTargets' }> | undefined {
  const [head, ...rest] = ability.effects
  const declaresLater = (effects: readonly Effect[]): boolean => effects.some(needsChoice)
  if (rest.some(needsChoice)) {
    throw new Error(`${ability.id}: an activated ability may only choose at its FIRST effect (spec C3-1)`)
  }
  if (head?.kind === 'chooseModes') throw new Error(`${ability.id}: activated abilities cannot choose modes yet (spec C3-1)`)
  if (head?.kind !== 'chooseTargets') return undefined
  if (declaresLater(head.then)) throw new Error(`${ability.id}: nested choices inside an activated ability are not supported (spec C3-1)`)
  return head
}

/** Does this effect (or anything nested in it) suspend for a player decision? */
function needsChoice(eff: Effect): boolean {
  switch (eff.kind) {
    case 'chooseTargets': return true
    case 'chooseModes': return true
    case 'forEach': return eff.do.some(needsChoice)
    case 'onSubject': return eff.do.some(needsChoice)
    default: return false
  }
}

/**
 * Why this activation is illegal, or null — INCLUDING its declared targets, which is the whole point: a cost
 * must never be paid for a choice that has not been validated. `legalCommands` uses it to enumerate and
 * `apply` uses it to reject, so the two can never disagree.
 */
export function activationCheck(
  state: GameState, player: PlayerId, source: CardId, abilityId: string, targets: readonly CardId[] = [],
): string | null {
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
  if (cost.selfRemoveFromGame && !state.players[player].breakZone.includes(source)) return 'only a card in your Break Zone can be removed from the game'
  if (cost.selfDiscard && !state.players[player].hand.includes(source)) return 'only a card in your hand can be discarded'

  // Validate the DECLARED targets against the state as it will be once the costs are paid (§11.6.5). Post-cost
  // is what makes it exact: Undead Princess is already in the Break Zone by then, so she cannot be her own
  // target, and the set validated here is the set the frame will resolve against.
  const node = declarationNode(ability)
  if (!node) return targets.length ? `${abilityId} takes no targets` : null

  const [post] = applyCosts(state, player, source, cost, { dullBackups: [], discards: [] }, /* validate */ false)
  const candidates = targetCandidates(post, source, player, node.from)
  // `max` is clamped to what exists, exactly as `applyChooseTargets` clamps it. `min` is NOT: an "up to N"
  // clause with nothing to choose is legal and simply chooses nothing — an earlier revision rejected that
  // outright and would have made every "up to N" ability unactivatable on an empty board.
  const max = Math.min(node.max, candidates.length)
  if (node.min > max) return `${abilityId} has no legal target`
  if (new Set(targets).size !== targets.length) return 'duplicate target'
  if (targets.length < node.min || targets.length > max) return `${abilityId} needs ${node.min}..${max} targets`
  for (const id of targets) if (!candidates.includes(id)) return `${id} is not a legal target for ${abilityId}`
  return null
}

/** Every legal declaration of an activation's targets — the sets `legalCommands` must offer. */
export function activationTargetSets(state: GameState, player: PlayerId, source: CardId, ability: Ability): readonly CardId[][] {
  if (ability.trigger.kind !== 'activated') return []
  const node = declarationNode(ability)
  if (!node) return [[]]
  const [post] = applyCosts(state, player, source, ability.trigger.cost, { dullBackups: [], discards: [] }, false)
  const candidates = targetCandidates(post, source, player, node.from)
  const max = Math.min(node.max, candidates.length)
  if (node.min > max) return []
  const out: CardId[][] = []
  for (let k = node.min; k <= max; k++) out.push(...combinations(candidates, k))
  return out
}

function combinations(items: readonly CardId[], k: number): CardId[][] {
  if (k === 0) return [[]]
  const out: CardId[][] = []
  const walk = (start: number, acc: CardId[]): void => {
    if (acc.length === k) { out.push([...acc]); return }
    for (let i = start; i < items.length; i++) { acc.push(items[i] as CardId); walk(i + 1, acc); acc.pop() }
  }
  walk(0, [])
  return out
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
  if (cost.selfRemoveFromGame) {
    // Out of the Break Zone and out of the game. No `ZoneTransition`: a transition is `to: 'breakZone'` by
    // construction, and nothing in the pool watches removal — Sphene's static will get its own observer
    // rather than being retrofitted onto the break watcher (spec C7-3).
    const owner = s.cards[source]?.owner ?? player
    s = updatePlayer(s, player, (ps) => ({ ...ps, breakZone: ps.breakZone.filter((id) => id !== source) }))
    s = updatePlayer(s, owner, (ps) => ({ ...ps, removedFromGame: [...ps.removedFromGame, source] }))
    events.push({ type: 'removedFromGame', player, card: source })
  }
  if (cost.selfDiscard) {
    const owner = s.cards[source]?.owner ?? player
    s = updatePlayer(s, player, (ps) => ({ ...ps, hand: ps.hand.filter((id) => id !== source) }))
    s = updatePlayer(s, owner, (ps) => ({ ...ps, breakZone: [...ps.breakZone, source] }))
    // `cost`, not `cp`: this card was discarded to PAY for its own ability, and it generated no CP doing so.
    events.push({ type: 'discarded', player, card: source, reason: 'cost' })
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
  state: GameState, player: PlayerId, source: CardId, abilityId: string, payment: Payment, targets: readonly CardId[],
): [GameState, Event[]] {
  const why = activationCheck(state, player, source, abilityId, targets)
  if (why) throw new IllegalCommandError(why)
  const ability = activatedAbility(state, source, abilityId)
  if (!ability || ability.trigger.kind !== 'activated') throw new IllegalCommandError('unreachable: checked above')

  const pre = state   // observers are read PRE-move, exactly as `breakCard` does
  const [paid, events, transitions] = applyCosts(state, player, source, ability.trigger.cost, payment, true)
  events.unshift({ type: 'abilityActivated', player, card: source, abilityId })

  // Cost triggers BEFORE the action frame: `drainResolution` is FIFO, and the observers a cost fires resolve
  // above the ability that paid them (spec C3-8).
  let s = enqueueZoneChangeTriggers(pre, paid, transitions)

  // The action frame starts with its choice ALREADY MADE. `path: [0]` is the same marker `applyChooseTargets`
  // writes when a human answers a prompt — it says "the choice at this node is settled, resume inside `then`"
  // — so the declared targets travel with the frame and nothing re-prompts for them, whatever the cost's own
  // triggers did to the board in between.
  // `[0, 0]` is exactly the path `applyChooseTargets` leaves behind when a human answers a prompt: index 0 at
  // the top level, then "resume at index 0 inside that node's `then`". One entry short and the frame re-raises
  // the choice it was handed; `runEffects` treats a node as answered only when the path records a DEEPER index.
  const declares = declarationNode(ability) !== undefined
  const frame: Frame = {
    abilityId: ability.id, source, controller: player,
    path: declares ? [0, 0] : [], chosen: declares ? [...targets] : [], modes: [], triggerEvent: null,
    origin: 'activated',
  }
  s = { ...s, resolution: { ...s.resolution, queue: [...s.resolution.queue, frame] } }
  return [s, events]
}
