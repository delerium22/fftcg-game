import type { CardDef, PlayerId } from './types.js'
import type { AbilityTrigger } from './abilities.js'
import type { CardId, FieldCard, GameState } from './state.js'
import { MAX_BACKUPS, defOf, updatePlayer } from './state.js'
import type { Payment } from './commands.js'
import type { Event } from './events.js'
import { IllegalCommandError } from './errors.js'
import { canPay, generateCp, pay, requiredElements } from './cp.js'
import { enqueueTrigger } from './resolve.js'

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

function checkedPay(state: GameState, player: PlayerId, card: CardId, payment: Payment): [GameState, Event[]] {
  const def = defOf(state, card)
  const cp = generateCp(state, player, payment, card)
  if (!canPay(def.cost, requiredElements(def), cp)) throw new IllegalCommandError(`payment does not cover cost ${def.cost} ${def.elements.join('/')}`)
  return pay(state, player, payment)
}

/**
 * Coverage is per CLAUSE (spec C1-9). A card with an AST for 1 of its 3 printed clauses must still warn about
 * the other 2, so the log stays honest about what the player is actually getting. `clauses` is omitted when
 * nothing at all is implemented — the vanilla-pool log line keeps the shape it has had since rung A.
 */
function warnUnimplemented(def: CardDef, card: CardId, events: Event[]): void {
  const printed = def.abilityClauses ?? (def.hasAbilities ? 1 : 0)
  const implemented = def.abilities?.length ?? 0
  const missing = Math.max(0, printed - implemented)
  if (missing === 0) return
  if (implemented === 0) events.push({ type: 'unimplementedAbility', card, code: def.code })
  else events.push({ type: 'unimplementedAbility', card, code: def.code, clauses: missing })
}

/** Queue every implemented clause with this trigger, in printed order (spec C1-4: no stack, they drain immediately). */
function dispatch(state: GameState, def: CardDef, card: CardId, controller: PlayerId, trigger: AbilityTrigger): GameState {
  let s = state
  for (const ability of def.abilities ?? []) if (ability.trigger.kind === trigger.kind) s = enqueueTrigger(s, card, controller, ability)
  return s
}

export function applyCastCharacter(state: GameState, player: PlayerId, card: CardId, payment: Payment): [GameState, Event[]] {
  const why = castCheck(state, player, card)
  if (why) throw new IllegalCommandError(why)
  const def = defOf(state, card)
  if (def.type === 'summon') throw new IllegalCommandError('use castSummon for summons')
  const [paid, events] = checkedPay(state, player, card, payment)
  const fc: FieldCard = { id: card, status: def.type === 'backup' ? 'dull' : 'active', damage: 0, enteredTurn: state.turn, attackedThisTurn: false, granted: [], powerBonus: 0, flags: [] }
  let s = updatePlayer(paid, player, (ps) => ({
    ...ps,
    hand: ps.hand.filter((id) => id !== card),
    forwards: def.type === 'forward' ? [...ps.forwards, fc] : ps.forwards,
    backups: def.type === 'backup' ? [...ps.backups, fc] : ps.backups,
  }))
  events.push({ type: 'cast', player, card, cardType: def.type })
  warnUnimplemented(def, card, events)
  // `enterField`, not `cast`: C2's Hugh Yurg puts a Character onto the field without casting it (spec C1-2).
  s = dispatch(s, def, card, player, { kind: 'enterField' })
  return [s, events]
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
  s = dispatch(s, def, card, player, { kind: 'summonResolve' })
  if (!resolves) events.push({ type: 'summonResolvedNoEffect', card })
  return [s, events]
}
