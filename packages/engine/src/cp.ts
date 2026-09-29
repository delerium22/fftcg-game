import { staticApplies } from './layer.js'
import type { CardDef, Element, PlayerId } from './types.js'

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
export function canPay(req: CpToPay, generated: readonly GeneratedCp[]): boolean {
  const { amount: cost, requiredElements: elements } = req
  if (cost === 0) return generated.length === 0   // §11.2.2.4 / §11.2.2.1 last sentence
  const cp = onlyAdmissible(req, generated)
  if (cp.length < cost) return false
  // Each REQUIREMENT needs its own distinct source that can produce it (§11.2.2.1–2). With flexible sources
  // that is a matching problem, not a count: assigning greedily can strand a later requirement on a source an
  // earlier one took, when swapping the two works. Requirements are 1–3 and sources single digits, so a plain
  // backtracking search is the right size of tool.
  return assignable([...elements], cp, new Set())
}

/**
 * The CP that may be USED under `onlyElement` (rung V1-A3, spec V1-D14, R3; rung V1-D, plan D-D4): the entries that can be
 * that Element, each narrowed to it, so a flexible source (a Moogle-style Backup that can also produce Fire) counts as
 * Fire and nothing else. The rest are dropped, not refused: §11.2.2.3 lets a player generate as much CP as they like and
 * choose which pays, and "You can only pay with Fire CP" restricts the CP used — an off-Element CP is generated, unspent,
 * and ceases to exist (§11.2.2.3.1). Without the restriction, the CP as generated.
 */
export function onlyAdmissible(req: Pick<CpRequirement, 'onlyElement'>, cp: readonly GeneratedCp[]): readonly GeneratedCp[] {
  const only = req.onlyElement
  if (only === undefined) return cp
  return cp.filter((c) => c.elements.includes(only)).map((c) => (c.elements.length === 1 ? c : { ...c, elements: [only] }))
}

/** Why a payment does not cover `req`, for an error: the cost, and the restriction when there is one. */
export function payShortfall(req: CpToPay): string {
  return `payment does not cover cost ${req.amount} ${req.requiredElements.join('/')}${req.onlyElement ? ` (only ${req.onlyElement} CP may pay it)` : ''}`
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
  /** "You can only pay with <Element> CP" (rung V1-A3): only CP that can be this Element pays; others may be generated, unspent (rung V1-D, §11.2.2.3). */
  readonly onlyElement?: Element
}

/** The half of a requirement `canPay` reads — no exclusions, which `generateCp` has already applied. */
export type CpToPay = Pick<CpRequirement, 'amount' | 'requiredElements' | 'onlyElement'>

/** The requirement for CASTING `card` — the Light/Dark exemption applied (§11.2.1.1). */
export function castRequirement(state: GameState, card: CardId, caster: PlayerId): CpRequirement {
  const def = defOf(state, card)
  const only = onlyCpOf(def)
  return {
    amount: Math.max(0, def.cost - costReduction(state, def, caster)),
    requiredElements: requiredElements(def),
    excluded: [card],
    ...(only === undefined ? {} : { onlyElement: only }),
  }
}

/** The card's OWN "you can only pay with <Element> CP" (rung V1-A3), read wherever it is cast from, like `costReduction`. */
function onlyCpOf(def: CardDef): Element | undefined {
  for (const ability of def.abilities ?? []) {
    if (ability.trigger.kind === 'static' && ability.trigger.effect.kind === 'onlyCp') return ability.trigger.effect.element
  }
  return undefined
}

/** Can this source's CP be spent under `req`'s restriction? Filters the sources the enumerators and `canAffordCast` try. */
const admits = (req: Pick<CpRequirement, 'onlyElement'>, elements: readonly Element[]): boolean =>
  req.onlyElement === undefined || elements.includes(req.onlyElement)

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
    if (!staticApplies({ state, source: null, controller: caster }, effect.when)) continue
    total += effect.amount
  }
  return total
}

// `staticApplies` lives in layer.ts since rung J6 (source-aware context); re-exported for its existing importers.
export { staticApplies } from './layer.js'

/** Every *minimal* legal payment for `card` (no source can be removed and still pay). Used by legalCommands as the canonical choice list; `apply` accepts any payment that `canPay` — overpaying is legal (§11.2.2.3). */
export function enumeratePayments(state: GameState, player: PlayerId, card: CardId): Payment[] {
  const base = enumeratePaymentsFor(state, player, castRequirement(state, card, player))
  // Rung J8 (§15.2.8.3.2): a card cast from the LB deck also turns X OTHER face-down cards face up. ONE canonical
  // subset (the first X face-down others, in LB-deck order) is listed per CP payment — every X-subset is legal and
  // `isLegal`/`apply` accept any through `lbFlipCheck`, as J7 does for built target sets. Listing them all
  // multiplied the list by C(7,X) per CP payment (review M2: 240 casts on turn 1 with a four-card deck).
  const ps = state.players[player]
  const need = defOf(state, card).limitBreak
  if (need === undefined || !ps.lbDeck.some((x) => x.id === card && !x.faceUp)) return base
  const lbFlip = ps.lbDeck.filter((x) => !x.faceUp && x.id !== card).map((x) => x.id).slice(0, need)
  return base.map((p) => ({ ...p, lbFlip }))
}

/**
 * Is there ANY payment for casting `card`? A first-hit check for `forcedPass` and the browser's Smart auto-pass
 * (J2 second review M1): an unaffordable card is not a decision. Overpaying is legal (§11.2.2.3), so the most
 * the player can generate decides it — every active Backup and every other hand card discarded. Only the
 * Element of each multi-Element discard is a choice; those are tried in turn (the pool has almost none).
 */
export function canAffordCast(state: GameState, player: PlayerId, card: CardId): boolean {
  const req = castRequirement(state, card, player)
  if (req.amount === 0) return true
  const ps = state.players[player]
  // Under `onlyElement` (rung V1-A3) only sources that can be that Element are tried, and a discard declares it. An
  // inadmissible source would be legal to add (rung V1-D, §11.2.2.3) but pays nothing, so leaving it out loses nothing.
  const dullBackups = ps.backups.filter((b) => b.status === 'active' && !req.excluded.includes(b.id) && admits(req, backupElements(state, b.id))).map((b) => b.id)
  const options = ps.hand
    .filter((id) => !req.excluded.includes(id))
    .map((id) => ({ card: id, elements: defOf(state, id).elements.filter((e) => admits(req, [e])) }))
    .filter((o) => !defOf(state, o.card).elements.includes('light') && !defOf(state, o.card).elements.includes('dark') && o.elements.length > 0)
  const walk = (i: number, discards: Payment['discards']): boolean => {
    if (i === options.length) return canPay(req, generateCp(state, player, { dullBackups, discards }, req.excluded))
    const o = options[i]!
    return o.elements.some((element) => walk(i + 1, [...discards, { card: o.card, element }]))
  }
  return walk(0, [])
}

/** As `enumeratePayments`, for any requirement — an ability cost as readily as a card's printed cost. */
export function enumeratePaymentsFor(state: GameState, player: PlayerId, req: CpRequirement): Payment[] {
  const card = req.excluded
  if (req.amount === 0) return [{ dullBackups: [], discards: [] }]
  const ps = state.players[player]
  // Rung V1-A3: under `onlyElement`, only sources that can be that Element, and discards declaring it, are tried — an
  // off-Element source may be generated (rung V1-D) but pays nothing, so no minimal payment includes one.
  const backups = ps.backups.filter((b) => b.status === 'active' && !card.includes(b.id) && admits(req, backupElements(state, b.id))).map((b) => b.id)
  const discardOptions = ps.hand
    .filter((id) => !card.includes(id))
    .flatMap((id) => defOf(state, id).elements.filter((e) => e !== 'light' && e !== 'dark' && admits(req, [e])).map((element) => ({ card: id, element })))
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
      if (!canPay(req, cp)) return
      // minimality: removing any single source must break payment
      for (let k = 0; k < dullBackups.length; k++) {
        const less = { ...payment, dullBackups: dullBackups.filter((_, j) => j !== k) }
        if (canPay(req, generateCp(state, player, less, card))) return
      }
      for (let k = 0; k < discards.length; k++) {
        const less = { ...payment, discards: discards.filter((_, j) => j !== k) }
        if (canPay(req, generateCp(state, player, less, card))) return
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
