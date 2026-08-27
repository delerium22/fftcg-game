import type { PlayerId } from './types.js'
import type { CardId, GameState } from './state.js'
import { MAX_BACKUPS, defOf, updatePlayer } from './state.js'
import type { Payment } from './commands.js'
import type { Event } from './events.js'
import { IllegalCommandError } from './errors.js'
import { canPay, castRequirement, generateCp, pay } from './cp.js'
import { dispatchTrigger, putOntoField, warnUnimplemented } from './resolve.js'

export function castCheck(state: GameState, player: PlayerId, card: CardId): string | null {
  if (state.result) return 'game is over'
  // MVP0-SIMPLIFICATION: Summons are also castable in the Attack Phase (§9.3.1.6); that window needs the stack (MVP3)
  if (state.phase !== 'main1' && state.phase !== 'main2') return 'characters and summons can only be cast in a main phase (§11.4.1; MVP0 restriction for summons)'
  const ps = state.players[player]
  if (!ps.hand.includes(card)) return 'card is not in your hand'
  if (state.priority !== player) return 'you do not have priority'
  if (state.pending) return 'a decision is pending'
  const def = defOf(state, card)
  if (def.type === 'monster') return 'monsters unsupported in MVP0'   // MVP0-SIMPLIFICATION: Monster-type cards are entirely out of scope (pool has none); §7.7 Monster-specific casting rules are unimplemented
  // MVP0-SIMPLIFICATION: §7.7.4 is normally a rule process (§12.4.8) that keeps a 6th Backup off the field; here casting one is simply illegal.
  if (def.type === 'backup' && ps.backups.length >= MAX_BACKUPS) return `you already control ${MAX_BACKUPS} backups (§7.7.4)`
  if (def.type !== 'summon' && !def.generic) {
    // MVP0-SIMPLIFICATION: §7.7.3 only prohibits *simultaneous* deployment; casting a second non-generic
    // same-name Character is legal and §12.4.6 then puts ALL copies into the Break Zone as a rule process.
    // Here the cast is simply illegal. §12.4.6/§12.4.7 are MVP3 work.
    const clash = [...ps.forwards, ...ps.backups].some((c) => { const d = defOf(state, c.id); return !d.generic && d.name === def.name })
    if (clash) return `you already control a non-generic character with the same name (§7.7.3)`
  }
  return null
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
  const fromHand = updatePlayer(paid, player, (ps) => ({ ...ps, hand: ps.hand.filter((id) => id !== card) }))
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
  // MVP0-SIMPLIFICATION: no stack (§7.10.1) — the summon goes straight to the break zone and its effect, if
  // implemented, resolves immediately from there. `Frame.source` is allowed to be a card that has left the field.
  let s = updatePlayer(paid, player, (ps) => ({ ...ps, hand: ps.hand.filter((id) => id !== card), breakZone: [...ps.breakZone, card] }))
  events.push({ type: 'cast', player, card, cardType: 'summon' })
  warnUnimplemented(def, card, events)
  const resolves = (def.abilities ?? []).some((a) => a.trigger.kind === 'summonResolve')
  s = dispatchTrigger(s, def, card, player, 'summonResolve')
  if (!resolves) events.push({ type: 'summonResolvedNoEffect', card })
  return [s, events]
}
