import type { Element, PlayerId } from './types.js'
import type { CardId, GameState } from './state.js'
import { defOf, updatePlayer } from './state.js'
import type { Payment } from './commands.js'
import type { Event } from './events.js'
import { IllegalCommandError } from './errors.js'

export interface GeneratedCp { element: Element; source: CardId }

/** Validate the sources and compute the CP they generate. Throws IllegalCommandError on a bad source. */
export function generateCp(state: GameState, player: PlayerId, payment: Payment, casting: CardId): GeneratedCp[] {
  const ps = state.players[player]
  const cp: GeneratedCp[] = []
  const seen = new Set<CardId>()
  for (const id of payment.dullBackups) {
    const b = ps.backups.find((c) => c.id === id)
    if (!b) throw new IllegalCommandError(`${id} is not a backup you control`)
    if (b.status !== 'active') throw new IllegalCommandError(`backup ${id} is already dull`)
    if (seen.has(id)) throw new IllegalCommandError(`backup ${id} used twice`)
    seen.add(id)
    const def = defOf(state, id)
    cp.push({ element: def.elements[0] as Element, source: id })   // MVP0-SIMPLIFICATION: multi-element backups produce their first element; none in pool
  }
  for (const { card, element } of payment.discards) {
    if (card === casting) throw new IllegalCommandError('cannot discard the card being cast')
    if (!ps.hand.includes(card)) throw new IllegalCommandError(`${card} is not in your hand`)
    if (seen.has(card)) throw new IllegalCommandError(`card ${card} discarded twice`)
    seen.add(card)
    const def = defOf(state, card)
    if (def.elements.includes('light') || def.elements.includes('dark')) throw new IllegalCommandError('Light/Dark cards cannot be discarded for CP (§11.2.1.1)')
    if (!def.elements.includes(element)) throw new IllegalCommandError(`${card} cannot produce ${element} CP`)
    cp.push({ element, source: card }, { element, source: card })
  }
  return cp
}

/** §11.2.2.2–3: total ≥ cost, ≥1 CP of each of the card's elements; cost 0 → no CP may be generated (§11.2.2.4). */
export function canPay(cost: number, elements: Element[], cp: GeneratedCp[]): boolean {
  if (cost === 0) return cp.length === 0   // §11.2.2.4 / §11.2.2.1 last sentence
  if (cp.length < cost) return false
  // MVP0-SIMPLIFICATION: §11.2.2 Light/Dark same-element exemption not implemented (pool has none)
  return elements.every((e) => cp.some((c) => c.element === e))   // §11.2.2.1–2
}

/** Every *minimal* legal payment for `card` (no source can be removed and still pay). Used by legalCommands as the canonical choice list; `apply` accepts any payment that `canPay` — overpaying is legal (§11.2.2.3). */
export function enumeratePayments(state: GameState, player: PlayerId, card: CardId): Payment[] {
  const def = defOf(state, card)
  if (def.cost === 0) return [{ dullBackups: [], discards: [] }]
  const ps = state.players[player]
  const backups = ps.backups.filter((b) => b.status === 'active').map((b) => b.id)
  const discardOptions = ps.hand
    .filter((id) => id !== card)
    .flatMap((id) => defOf(state, id).elements.filter((e) => e !== 'light' && e !== 'dark').map((element) => ({ card: id, element })))
  // Each hand card may be discarded at most once, so choose ≤1 element option per card.
  const byCard = new Map<CardId, Element[]>()
  for (const o of discardOptions) byCard.set(o.card, [...(byCard.get(o.card) ?? []), o.element])
  const handCards = [...byCard.keys()]

  const results: Payment[] = []
  const nBackupSubsets = 1 << backups.length
  const choices = handCards.map((c) => byCard.get(c) as Element[])
  // iterate over backup subsets × per-card choice (none | element_i)
  const walk = (i: number, discards: Payment['discards'], backupMask: number) => {
    if (i === handCards.length) {
      const dullBackups = backups.filter((_, k) => backupMask & (1 << k))
      const payment = { dullBackups, discards }
      const cp = generateCp(state, player, payment, card)
      if (!canPay(def.cost, def.elements, cp)) return
      // minimality: removing any single source must break payment
      for (let k = 0; k < dullBackups.length; k++) {
        const less = { ...payment, dullBackups: dullBackups.filter((_, j) => j !== k) }
        if (canPay(def.cost, def.elements, generateCp(state, player, less, card))) return
      }
      for (let k = 0; k < discards.length; k++) {
        const less = { ...payment, discards: discards.filter((_, j) => j !== k) }
        if (canPay(def.cost, def.elements, generateCp(state, player, less, card))) return
      }
      results.push(payment)
      return
    }
    walk(i + 1, discards, backupMask)
    for (const element of choices[i] as Element[]) walk(i + 1, [...discards, { card: handCards[i] as CardId, element }], backupMask)
  }
  for (let mask = 0; mask < nBackupSubsets; mask++) walk(0, [], mask)
  return results
}

/** Execute a payment. INTERNAL — callers must have run generateCp + canPay first (cast.ts does). */
export function pay(state: GameState, player: PlayerId, payment: Payment): [GameState, Event[]] {
  const events: Event[] = []
  const s = updatePlayer(state, player, (ps) => ({
    ...ps,
    backups: ps.backups.map((b) => (payment.dullBackups.includes(b.id) ? { ...b, status: 'dull' } : b)),
    hand: ps.hand.filter((id) => !payment.discards.some((d) => d.card === id)),
    breakZone: [...ps.breakZone, ...payment.discards.map((d) => d.card)],
  }))
  for (const d of payment.discards) events.push({ type: 'discarded', player, card: d.card, reason: 'cp' })
  const cp = [...payment.dullBackups.map((id) => defOf(state, id).elements[0] as Element), ...payment.discards.flatMap((d) => [d.element, d.element])]
  events.unshift({ type: 'cpGenerated', player, cp })
  return [s, events]
}
