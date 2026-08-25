import type { PlayerId } from './types.js'
import type { CardId, FieldCard, GameState } from './state.js'
import { MAX_BACKUPS, defOf, updatePlayer } from './state.js'
import type { Payment } from './commands.js'
import type { Event } from './events.js'
import { IllegalCommandError } from './errors.js'
import { canPay, generateCp, pay, requiredElements } from './cp.js'

export function castCheck(state: GameState, player: PlayerId, card: CardId): string | null {
  if (state.result) return 'game is over'
  // MVP0-SIMPLIFICATION: Summons are also castable in the Attack Phase (§9.3.1.6); that window needs the stack (MVP3)
  if (state.phase !== 'main1' && state.phase !== 'main2') return 'characters and summons can only be cast in a main phase (§11.4.1; MVP0 restriction for summons)'
  const ps = state.players[player]
  if (!ps.hand.includes(card)) return 'card is not in your hand'
  if (state.priority !== player) return 'you do not have priority'
  if (state.pending) return 'a decision is pending'
  const def = defOf(state, card)
  if (def.type === 'monster') return 'monsters unsupported in MVP0'
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

export function applyCastCharacter(state: GameState, player: PlayerId, card: CardId, payment: Payment): [GameState, Event[]] {
  const why = castCheck(state, player, card)
  if (why) throw new IllegalCommandError(why)
  const def = defOf(state, card)
  if (def.type === 'summon') throw new IllegalCommandError('use castSummon for summons')
  const [paid, events] = checkedPay(state, player, card, payment)
  const fc: FieldCard = { id: card, status: def.type === 'backup' ? 'dull' : 'active', damage: 0, enteredTurn: state.turn, attackedThisTurn: false, granted: [] }
  const s = updatePlayer(paid, player, (ps) => ({
    ...ps,
    hand: ps.hand.filter((id) => id !== card),
    forwards: def.type === 'forward' ? [...ps.forwards, fc] : ps.forwards,
    backups: def.type === 'backup' ? [...ps.backups, fc] : ps.backups,
  }))
  events.push({ type: 'cast', player, card, cardType: def.type })
  if (def.hasAbilities) events.push({ type: 'unimplementedAbility', card, code: def.code })
  return [s, events]
}

export function applyCastSummon(state: GameState, player: PlayerId, card: CardId, payment: Payment): [GameState, Event[]] {
  const why = castCheck(state, player, card)
  if (why) throw new IllegalCommandError(why)
  const def = defOf(state, card)
  if (def.type !== 'summon') throw new IllegalCommandError('not a summon')
  const [paid, events] = checkedPay(state, player, card, payment)
  // MVP0-SIMPLIFICATION: no stack, no effect — the summon resolves immediately into the break zone (§7.10.1)
  const s = updatePlayer(paid, player, (ps) => ({ ...ps, hand: ps.hand.filter((id) => id !== card), breakZone: [...ps.breakZone, card] }))
  events.push({ type: 'cast', player, card, cardType: 'summon' })
  if (def.hasAbilities) events.push({ type: 'unimplementedAbility', card, code: def.code })
  events.push({ type: 'summonResolvedNoEffect', card })
  return [s, events]
}
