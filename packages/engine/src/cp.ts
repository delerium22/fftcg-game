import type { CardDef, Element, PlayerId } from './types.js'
import type { CardId, GameState } from './state.js'
import { defOf, updatePlayer } from './state.js'
import type { Payment } from './commands.js'
import type { Event } from './events.js'
import { IllegalCommandError } from './errors.js'

/** §11.2.1.1/§11.2.2: a pure Light or pure Dark card needs no CP of its own element — its cost may be paid entirely
 *  with off-element CP. Every other card (including a Light/Dark card combined with another element, none in the
 *  MVP0 pool) still requires ≥1 CP of each of its listed elements. Callers pass this — not `def.elements` directly
 *  — to `canPay` and to `preferredPayment`'s required-element phase. */
export function requiredElements(def: CardDef): Element[] {
  if (def.elements.length === 1 && (def.elements[0] === 'light' || def.elements[0] === 'dark')) return []
  return def.elements
}

export interface GeneratedCp { element: Element; source: CardId }

/**
 * Validate the sources and compute the CP they generate. Throws IllegalCommandError on a bad source.
 *
 * `excluded` is the card (or cards) that may not be a CP source for this payment. For a cast that is the card
 * being cast; for an activated ability it is the ability's own source (spec C3-5), and there it matters in a
 * way it never did for casting: Red Mage's `[Lightning][Dull]` would otherwise let Red Mage dull ITSELF to
 * produce its own Lightning CP while that same dull also paid the `[Dull]` cost — one action, two costs. The
 * exclusion used to be applied to discards only, which was invisible while the only caller was casting (the
 * card being cast is in hand, so it could never be a dulled Backup anyway).
 */
export function generateCp(state: GameState, player: PlayerId, payment: Payment, excluded: CardId | readonly CardId[]): GeneratedCp[] {
  const forbidden = typeof excluded === 'number' ? [excluded] : excluded
  const ps = state.players[player]
  const cp: GeneratedCp[] = []
  const seen = new Set<CardId>()
  for (const id of payment.dullBackups) {
    const b = ps.backups.find((c) => c.id === id)
    if (!b) throw new IllegalCommandError(`${id} is not a backup you control`)
    if (forbidden.includes(id)) throw new IllegalCommandError(`${id} cannot pay for its own ability`)
    if (b.status !== 'active') throw new IllegalCommandError(`backup ${id} is already dull`)
    if (seen.has(id)) throw new IllegalCommandError(`backup ${id} used twice`)
    seen.add(id)
    const def = defOf(state, id)
    cp.push({ element: def.elements[0] as Element, source: id })   // MVP0-SIMPLIFICATION: multi-element backups produce their first element; none in pool
  }
  for (const { card, element } of payment.discards) {
    if (forbidden.includes(card)) throw new IllegalCommandError('cannot discard the card being paid for')
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
export function canPay(cost: number, elements: readonly Element[], cp: GeneratedCp[]): boolean {
  if (cost === 0) return cp.length === 0   // §11.2.2.4 / §11.2.2.1 last sentence
  if (cp.length < cost) return false
  // `elements` is expected to already be `requiredElements(def)` (Light/Dark exemption applied by the caller).
  return elements.every((e) => cp.some((c) => c.element === e))   // §11.2.2.1–2
}

/**
 * What a payment has to cover, decoupled from any card's printed cost (spec C3-4).
 *
 * Casting derives this from the card definition, but an ability's cost is not the card's cost: Red Mage's
 * ability costs `[Lightning]` — one CP, Lightning — on a card whose printed cost is 2, and Miner's costs a
 * generic `[2]` on a card whose printed cost is 3. Deriving one from the other works only by coincidence.
 */
export interface CpRequirement {
  readonly amount: number
  readonly requiredElements: readonly Element[]
  /** Cards that may not be a source. See `generateCp`. */
  readonly excluded: readonly CardId[]
}

/** The requirement for CASTING `card` — the Light/Dark exemption applied (§11.2.1.1). */
export function castRequirement(state: GameState, card: CardId): CpRequirement {
  const def = defOf(state, card)
  return { amount: def.cost, requiredElements: requiredElements(def), excluded: [card] }
}

/** Every *minimal* legal payment for `card` (no source can be removed and still pay). Used by legalCommands as the canonical choice list; `apply` accepts any payment that `canPay` — overpaying is legal (§11.2.2.3). */
export function enumeratePayments(state: GameState, player: PlayerId, card: CardId): Payment[] {
  return enumeratePaymentsFor(state, player, castRequirement(state, card))
}

/** As `enumeratePayments`, for any requirement — an ability cost as readily as a card's printed cost. */
export function enumeratePaymentsFor(state: GameState, player: PlayerId, req: CpRequirement): Payment[] {
  const card = req.excluded
  if (req.amount === 0) return [{ dullBackups: [], discards: [] }]
  const elements = req.requiredElements
  const ps = state.players[player]
  const backups = ps.backups.filter((b) => b.status === 'active' && !card.includes(b.id)).map((b) => b.id)
  const discardOptions = ps.hand
    .filter((id) => !card.includes(id))
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
      if (!canPay(req.amount, elements, cp)) return
      // minimality: removing any single source must break payment
      for (let k = 0; k < dullBackups.length; k++) {
        const less = { ...payment, dullBackups: dullBackups.filter((_, j) => j !== k) }
        if (canPay(req.amount, elements, generateCp(state, player, less, card))) return
      }
      for (let k = 0; k < discards.length; k++) {
        const less = { ...payment, discards: discards.filter((_, j) => j !== k) }
        if (canPay(req.amount, elements, generateCp(state, player, less, card))) return
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
