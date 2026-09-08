import type { PlayerId } from './types.js'
import type { AttackStep, CardId, GameState, StackItem } from './state.js'
import type { Effect, Frame } from './abilities.js'
import { MAX_BACKUPS, defOf, updatePlayer } from './state.js'
import type { Payment } from './commands.js'
import type { Event } from './events.js'
import { IllegalCommandError } from './errors.js'
import { canPay, castRequirement, generateCp, pay } from './cp.js'
import { controlsLightOrDark } from './rules.js'
import { putOntoField, targetCandidates, warnUnimplemented } from './resolve.js'

/**
 * WHY a cast is refused, as a code (rung I1) — so the browser can grey a Cast button and say the reason in
 * its own words rather than pattern-matching the engine's English. `castCheck` is the English form of the
 * same decision, and is derived from this so the two cannot disagree. Neither says anything about CP: a
 * `null` here with no legal payment means "cannot afford it", which is the caller's to phrase.
 */
export type CastBlocker = 'gameOver' | 'phase' | 'notInHand' | 'notTurnPlayer' | 'priority' | 'pending' | 'stackNotEmpty' | 'monster' | 'backupsFull' | 'sameName' | 'lightDark' | 'noTarget'

/** The Attack Phase steps in which priority is held — where a Summon or an action ability may be used (§9.3.1.6–7, J1-D10). */
export const ATTACK_WINDOWS: readonly AttackStep[] = ['preparation', 'declared', 'blocked', 'damage']

/** Is this a moment the priority holder may cast a Summon or use an action ability? Main Phase, or an Attack Phase window. */
export function instantSpeedAllowed(state: GameState): boolean {
  if (state.phase === 'main1' || state.phase === 'main2') return true
  return state.phase === 'attack' && state.attack !== null && ATTACK_WINDOWS.includes(state.attack.step)
}

/**
 * §11.3.3: a Summon that "chooses" needs a legal target to be cast at all. A DRY declaration — walk the head
 * choice nodes exactly as placement will (rung J1-D3), raising nothing — says whether every declaration can
 * succeed: a `chooseTargets` needs at least `min` candidates; a `chooseModes` needs at least `min` modes
 * whose own head choices can succeed.
 */
export function canDeclare(state: GameState, source: CardId, controller: PlayerId, effects: readonly Effect[]): boolean {
  const head = effects[0]
  if (!head) return true
  if (head.kind === 'chooseTargets') {
    const candidates = targetCandidates(state, source, controller, head.from)
    if (candidates.length < head.min) return false
    return candidates.length === 0 || canDeclare(state, source, controller, head.then)
  }
  if (head.kind === 'chooseModes') {
    const declarable = head.modes.filter((m) => canDeclare(state, source, controller, m.effects)).length
    return declarable >= head.min
  }
  return true
}

export function castBlocker(state: GameState, player: PlayerId, card: CardId): CastBlocker | null {
  if (state.result) return 'gameOver'
  const ps = state.players[player]
  // Characters are cast in a Main Phase only (§11.4.1); Summons follow the priority holder, checked below.
  const summon = ps.hand.includes(card) && defOf(state, card).type === 'summon'
  if (!summon && state.phase !== 'main1' && state.phase !== 'main2') return 'phase'
  if (!ps.hand.includes(card)) return 'notInHand'
  const def = defOf(state, card)
  if (def.type === 'summon') {
    // §9.3.1.6, rung J1-D5/D8: the PRIORITY HOLDER, either player, in a Main Phase or an Attack Phase window.
    if (!instantSpeedAllowed(state)) return 'phase'
    if (state.priority !== player) return 'priority'
    if (state.pending) return 'pending'
    // §11.3.3: castable only if every choice it makes as it is cast can be made.
    for (const a of def.abilities ?? []) {
      if (a.trigger.kind === 'summonResolve' && !canDeclare(state, card, player, a.effects)) return 'noTarget'
    }
    return null
  }
  // A Character: the turn player's (§9.3.1.5), with priority, and only while the stack is empty (§11.4.1).
  if (state.turnPlayer !== player) return 'notTurnPlayer'
  if (state.priority !== player) return 'priority'
  if (state.pending) return 'pending'
  if (state.stack.length > 0) return 'stackNotEmpty'
  if (def.type === 'monster') return 'monster'   // MVP0-SIMPLIFICATION: Monster-type cards are entirely out of scope (pool has none); §7.7 Monster-specific casting rules are unimplemented
  // §7.7.3–5: an ACTION that would exceed a field limit is prohibited — the cast is refused. An EFFECT that
  // exceeds one is allowed and the §12.4.6–8 rule processes repair the field (rung J4, rules.ts).
  if (def.type === 'backup' && ps.backups.length >= MAX_BACKUPS) return 'backupsFull'
  if (!def.generic) {
    const clash = [...ps.forwards, ...ps.backups].some((c) => { const d = defOf(state, c.id); return !d.generic && d.name === def.name })
    if (clash) return 'sameName'
  }
  if (def.elements.some((e) => e === 'light' || e === 'dark') && controlsLightOrDark(state, player)) return 'lightDark'
  return null
}

const CAST_BLOCKER_TEXT: Record<CastBlocker, string> = {
  gameOver: 'game is over',
  phase: 'characters and summons can only be cast in a main phase (§11.4.1; MVP0 restriction for summons)',
  notInHand: 'card is not in your hand',
  notTurnPlayer: 'only the turn player may cast (§9.3.1.5)',
  priority: 'you do not have priority',
  pending: 'a decision is pending',
  stackNotEmpty: 'a Character can only be cast while the stack is empty (§11.4.1)',
  monster: 'monsters unsupported in MVP0',
  backupsFull: `you already control ${MAX_BACKUPS} backups (§7.7.4)`,
  sameName: 'you already control a non-generic character with the same name (§7.7.3)',
  lightDark: 'you already control a Light or Dark card (§7.7.5)',
  noTarget: 'this Summon has no legal target to choose (§11.3.3)',
}

export function castCheck(state: GameState, player: PlayerId, card: CardId): string | null {
  const why = castBlocker(state, player, card)
  return why === null ? null : CAST_BLOCKER_TEXT[why]
}

/**
 * Validate and spend a cast's payment.
 *
 * The cost comes from `castRequirement`, NOT from `def.cost` — the two must never be able to disagree.
 * `enumeratePayments`, `preferredPayment`, `legalCommands`, the AI's candidates and the browser's label all
 * derive from that one function, so reading the printed cost here would let the engine offer a payment it
 * then refuses. That is currently invisible because nothing modifies a cost yet; rung C4 adds the first card
 * that does (Odin's "reduced by 3"), and this is the seam it would have broken.
 */
function checkedPay(state: GameState, player: PlayerId, card: CardId, payment: Payment): [GameState, Event[]] {
  const req = castRequirement(state, card, player)
  const cp = generateCp(state, player, payment, req.excluded)
  if (!canPay(req.amount, req.requiredElements, cp)) {
    throw new IllegalCommandError(`payment does not cover cost ${req.amount} ${req.requiredElements.join('/')}`)
  }
  return pay(state, player, payment)
}

export function applyCastCharacter(state: GameState, player: PlayerId, card: CardId, payment: Payment): [GameState, Event[]] {
  const why = castCheck(state, player, card)
  if (why) throw new IllegalCommandError(why)
  const def = defOf(state, card)
  if (def.type === 'summon') throw new IllegalCommandError('use castSummon for summons')
  const [paid, events] = checkedPay(state, player, card, payment)
  const fromHand: GameState = { ...updatePlayer(paid, player, (ps) => ({ ...ps, hand: ps.hand.filter((id) => id !== card) })), passes: 0 }
  events.push({ type: 'cast', player, card, cardType: def.type })
  // Placement, the coverage warning and both trigger dispatches are `putOntoField`'s, not this function's:
  // C9's Hugh Yurg search puts a Character onto the field without casting it and shares every one of them.
  return [putOntoField(fromHand, card, player, events), events]
}

export function applyCastSummon(state: GameState, player: PlayerId, card: CardId, payment: Payment): [GameState, Event[]] {
  const why = castCheck(state, player, card)
  if (why) throw new IllegalCommandError(why)
  const def = defOf(state, card)
  if (def.type !== 'summon') throw new IllegalCommandError('not a summon')
  const [paid, events] = checkedPay(state, player, card, payment)
  // §11.3.2, rung J1-D5: the card moves from the hand to the STACK — a zone of its own, in no player's arrays
  // — and stays there until it resolves (§11.11.10) or is cancelled. Its `summonResolve` clauses are its
  // frames; each declares its choices now, as it is cast (§11.3.3–4), through the ordinary prompts.
  let s: GameState = { ...updatePlayer(paid, player, (ps) => ({ ...ps, hand: ps.hand.filter((id) => id !== card) })), passes: 0, priority: player }
  events.push({ type: 'cast', player, card, cardType: 'summon' })
  warnUnimplemented(def, card, events)
  const frames: Frame[] = (def.abilities ?? [])
    .filter((a) => a.trigger.kind === 'summonResolve')
    .map((a) => ({ abilityId: a.id, source: card, controller: player, path: [], chosen: [], modes: [], triggerEvent: null, stage: 'resolve' as const, declared: [] }))
  const item: StackItem = { kind: 'summon', card, controller: player, frames }
  if (frames.length === 0) {
    // A vanilla Summon: nothing to declare, straight onto the stack (§11.3.8).
    events.push({ type: 'stackPushed', item: { kind: 'summon', card }, controller: player })
    return [{ ...s, stack: [...s.stack, item] }, events]
  }
  const first = frames[0] as Frame
  s = { ...s, resolution: { ...s.resolution, placing: { item, frameIndex: 0 }, active: { ...first, stage: 'declare', declared: [], modesDeclared: false } } }
  return [s, events]
}
