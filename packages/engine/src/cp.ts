import type { CardDef, Element, PlayerId } from './types.js'
import type { StaticCondition } from './abilities.js'
import type { CardId, GameState } from './state.js'
import { defOf, findFieldCard, updatePlayer } from './state.js'
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

/**
 * One CP, and the Elements it may count as (spec C6-1).
 *
 * A set, not a single Element: Moogle can produce Earth or Lightning, and the engine never has to commit to
 * which — the only question anyone asks of a payment is whether it covers a cost. One dull is still ONE CP;
 * the set is what that single CP may satisfy, never extra CP.
 */
export interface GeneratedCp { elements: readonly Element[]; source: CardId }

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
    cp.push({ elements: backupElements(state, id), source: id })
  }
  for (const { card, element } of payment.discards) {
    if (forbidden.includes(card)) throw new IllegalCommandError('cannot discard the card being paid for')
    if (!ps.hand.includes(card)) throw new IllegalCommandError(`${card} is not in your hand`)
    if (seen.has(card)) throw new IllegalCommandError(`card ${card} discarded twice`)
    seen.add(card)
    const def = defOf(state, card)
    if (def.elements.includes('light') || def.elements.includes('dark')) throw new IllegalCommandError('Light/Dark cards cannot be discarded for CP (§11.2.1.1)')
    if (!def.elements.includes(element)) throw new IllegalCommandError(`${card} cannot produce ${element} CP`)
    // A discard declares its Element on the `Payment` and yields TWO CP of it. That really is a choice with
    // consequences, unlike a dulled Backup, so it stays declared rather than becoming a set.
    cp.push({ elements: [element], source: card }, { elements: [element], source: card })
  }
  return cp
}

/**
 * §11.2.2.2–3: total ≥ cost, and the required Elements are covered; cost 0 → no CP may be generated
 * (§11.2.2.4).
 *
 * `elements` is a MULTISET, not a set. `['lightning', 'lightning']` needs TWO Lightning CP — under the old
 * `elements.every(e => cp.some(...))` the same single Lightning satisfied both entries, so one Lightning plus
 * one Earth would have paid a `[Lightning][Lightning]` cost. No card in the MVP0 pool prints a repeated
 * Element, so this was latent rather than live; it is fixed here because the requirement type now describes
 * ability costs too, which is exactly where repeated Elements show up.
 *
 * `elements` is expected to already be `requiredElements(def)` (Light/Dark exemption applied by the caller).
 */
export function canPay(cost: number, elements: readonly Element[], cp: GeneratedCp[]): boolean {
  if (cost === 0) return cp.length === 0   // §11.2.2.4 / §11.2.2.1 last sentence
  if (cp.length < cost) return false
  // Each REQUIREMENT needs its own distinct source that can produce it (§11.2.2.1–2). With flexible sources
  // that is a matching problem, not a count: assigning greedily can strand a later requirement on a source an
  // earlier one took, when swapping the two works. Requirements are 1–3 and sources single digits, so a plain
  // backtracking search is the right size of tool.
  return assignable([...elements], cp, new Set())
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
export function castRequirement(state: GameState, card: CardId, caster: PlayerId): CpRequirement {
  const def = defOf(state, card)
  return {
    amount: Math.max(0, def.cost - costReduction(state, def, caster)),
    requiredElements: requiredElements(def),
    excluded: [card],
  }
}

/**
 * How much this card's own static abilities take off its cost (spec C4-4).
 *
 * Clamped by the caller at 0: a reduction cannot make a card pay negative CP, and `canPay` already treats 0
 * as "no CP may be generated" (§11.2.2.4), so a fully-reduced card admits only the empty payment.
 *
 * Only the card's OWN statics are read. Nothing else in the pool reduces another card's cost, and inventing
 * a board-wide sweep for a case no card needs would be guessing at the shape of the next one.
 */
function costReduction(state: GameState, def: CardDef, caster: PlayerId): number {
  let total = 0
  for (const ability of def.abilities ?? []) {
    if (ability.trigger.kind !== 'static') continue
    const { effect } = ability.trigger
    if (effect.kind !== 'costReduction') continue
    if (!staticApplies(state, effect.when, caster)) continue
    total += effect.amount
  }
  return total
}

/** Whether a static's condition currently holds, from the perspective of `player`. */
export function staticApplies(state: GameState, when: StaticCondition, player: PlayerId): boolean {
  // Exhaustive by construction: one entry per `StaticCondition` kind, so adding a variant without handling it
  // fails to compile. A `switch` cannot carry that here — with a single-member union TypeScript does not
  // narrow the default branch to `never`, so the usual assertion would be a compile error today and a silent
  // gap the moment a second variant lands.
  const conditions: { readonly [K in StaticCondition['kind']]: (w: Extract<StaticCondition, { kind: K }>) => boolean } = {
    // §9.4 — damage is received by a PLAYER, and "you have received" is the CASTER, never the opponent. A
    // symmetric fixture cannot tell those apart, so this one has a test of its own.
    damageReceived: (w) => state.players[player].damageZone.length >= w.atLeast,
  }
  return conditions[when.kind](when as never)
}

/** Every *minimal* legal payment for `card` (no source can be removed and still pay). Used by legalCommands as the canonical choice list; `apply` accepts any payment that `canPay` — overpaying is legal (§11.2.2.3). */
export function enumeratePayments(state: GameState, player: PlayerId, card: CardId): Payment[] {
  return enumeratePaymentsFor(state, player, castRequirement(state, card, player))
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
  // Read through `backupElements`, exactly as `generateCp` does. Recomputing from `def.elements[0]` here was
  // the one reader left on the pre-C6 rule, and it made the event disagree with the payment the engine had
  // just accepted.
  const cp: readonly Element[][] = [
    ...payment.dullBackups.map((id) => backupElements(state, id)),
    ...payment.discards.flatMap((d) => [[d.element], [d.element]]),
  ]
  events.unshift({ type: 'cpGenerated', player, cp })
  return [s, events]
}

/** Every Element a dulled Backup may produce: its printed one, plus any granted by a field static (spec C6-3). */
export function backupElements(state: GameState, id: CardId): Element[] {
  const def = defOf(state, id)
  // A Backup printed with two Elements still produces only its first, and there is still none such in the
  // pool; the C6 change is that a STATIC can add one. When a printed multi-Element Backup arrives it becomes
  // a set here too.
  const out: Element[] = [def.elements[0] as Element]
  // Field-scoped: the card must actually be on the field for its static to apply, which is what Moogle prints.
  if (!findFieldCard(state, id)) return out
  for (const ability of def.abilities ?? []) {
    if (ability.trigger.kind !== 'static') continue
    const { effect } = ability.trigger
    if (effect.kind !== 'produceElement') continue
    if (!out.includes(effect.element)) out.push(effect.element)
  }
  return out
}

/** Can every remaining requirement be given its own distinct source? Backtracking over a handful of each. */
function assignable(need: readonly Element[], cp: readonly GeneratedCp[], used: Set<number>): boolean {
  const [first, ...rest] = need
  if (first === undefined) return true
  for (let i = 0; i < cp.length; i++) {
    if (used.has(i)) continue
    if (!(cp[i] as GeneratedCp).elements.includes(first)) continue
    used.add(i)
    if (assignable(rest, cp, used)) { used.delete(i); return true }
    used.delete(i)
  }
  return false
}
