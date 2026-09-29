import {
  abilityCpRequirement, castRequirement, generateCp,
  type CardId, type CpRequirement, type Element, type GeneratedCp, type Payment, type PlayerView,
} from '@fftcg/engine'
import { activatedAbilityOf, samePayment, stateShim } from './commands.js'
import type { Choice } from './types.js'

/**
 * The payment picker's model (rung I2): pure functions over a `Choice` and the selection built so far.
 *
 * TWO INVARIANTS, and the whole design rests on them. (1) The picker offers a source only while the selection
 * plus that source is still a SUBSET of a payment `legalCommands` listed — the collapsed choice and its E11
 * alternatives are exactly that list. So the picker can only ever build a payment the engine enumerated, and
 * `useGame.choose`'s membership check holds by construction; nothing here decides legality. (2) The crystals
 * light by matching the engine's own `generateCp` output against the requirement, and "every crystal lit" is
 * pinned equal to the engine's `canPay` by a property test over real positions. Lighting is display; the
 * engine keeps the rule.
 */

export const EMPTY_PAYMENT: Payment = { dullBackups: [], discards: [] }

/**
 * A CP crystal in the tray: tinted with a required element, or untinted ("any") until paid, and lit once paid.
 * A generic crystal that IS paid takes the element of the CP that paid it — two earth backups dulled for an
 * earth Forward show two earth crystals, not one earth and one grey (user report, 2026-09-09); it stays
 * untinted only while unpaid, or when a flexible source (Moogle) could have been either element.
 */
export interface Crystal { element: Element | null; lit: boolean }

export type PayableCommand = Extract<Choice['command'], { payment: Payment }>
export const isPayableChoice = (c: Choice): c is Choice & { command: PayableCommand } =>
  c.command.type === 'castCharacter' || c.command.type === 'castSummon' || c.command.type === 'activateAbility'

/** Whether this choice goes through the tray at all: a CP cost with at least one source to pick. A free cast
 *  (cost 0, or Odin reduced to 0) has an empty payment and no alternatives, and commits directly. */
export function needsTray(c: Choice): boolean {
  if (!isPayableChoice(c)) return false
  const p = c.command.payment
  return p.dullBackups.length + p.discards.length + (p.lbFlip?.length ?? 0) > 0 || (c.alternatives?.length ?? 0) > 0
}

/** The cost the tray draws, from the engine — `castRequirement` folds in Odin's reduction, and an activation's
 *  CP half is its own requirement (spec C3-4). Null for a choice that carries no payment. */
export function requirementFor(v: PlayerView, c: Choice): CpRequirement | null {
  if (!isPayableChoice(c)) return null
  const shim = stateShim(v)
  if (c.command.type !== 'activateAbility') return castRequirement(shim, c.command.card, v.me)
  const ability = activatedAbilityOf(v, c.command.source, c.command.abilityId)
  if (!ability || ability.trigger.kind !== 'activated') return null
  return abilityCpRequirement(c.command.source, ability.trigger.cost)
}

/** Every payment the engine listed for this move: the preferred one first, then E11's alternatives. */
export function legalPaymentsOf(c: Choice): Payment[] {
  if (!isPayableChoice(c)) return []
  return [c.command.payment, ...(c.alternatives ?? []).flatMap((a) => (isPayableChoice(a) ? [a.command.payment] : []))]
}

/** `small` ⊆ `big`, as sets of CP sources (a discard's element is part of its identity). The Limit Break flips are
 *  not compared: the engine lists ONE canonical flip subset per CP payment and accepts any (rung J8, review M2). */
function subsumes(big: Payment, small: Payment): boolean {
  return small.dullBackups.every((b) => big.dullBackups.includes(b))
    && small.discards.every((d) => big.discards.some((o) => o.card === d.card && o.element === d.element))
}
const sameCp = (a: Payment, b: Payment): boolean => samePayment({ dullBackups: a.dullBackups, discards: a.discards }, { dullBackups: b.dullBackups, discards: b.discards })

/** A CP source — or, rung J8, an LB-deck card to turn face up for a Limit Break cost. */
export type SourceAdd = { backup: CardId } | { discard: CardId; element: Element } | { flip: CardId }

/** I2-D3: may this source be added — is the result still inside some listed payment? */
export function extendable(legal: readonly Payment[], sel: Payment, add: SourceAdd): boolean {
  // A flip is addable while fewer than X are picked; WHICH face-down card is the player's (any X-subset is legal).
  if ('flip' in add) return !(sel.lbFlip ?? []).includes(add.flip) && (sel.lbFlip?.length ?? 0) < flipsNeeded(legal)
  const next = 'backup' in add ? withBackup(sel, add.backup, true) : withDiscard(sel, add.discard, add.element)
  return legal.some((p) => subsumes(p, next))
}

/** Rung J8: the cards the Limit Break cost may turn face up — the viewer's OTHER face-down LB-deck cards. */
export function flipCandidates(v: PlayerView, card: CardId): Set<CardId> {
  return new Set(v.fields[v.me].lbDeck.filter((x) => !x.faceUp && x.id !== card).map((x) => x.id))
}

/** The union of sources across the listed payments — what the board may light as a candidate at all. */
export function candidateSources(legal: readonly Payment[]): { backups: Set<CardId>; discards: Map<CardId, Element[]> } {
  const backups = new Set<CardId>()
  const discards = new Map<CardId, Element[]>()
  for (const p of legal) {
    for (const b of p.dullBackups) backups.add(b)
    for (const d of p.discards) {
      const els = discards.get(d.card) ?? []
      if (!els.includes(d.element)) els.push(d.element)
      discards.set(d.card, els)
    }
  }
  return { backups, discards }
}

const keepFlips = (sel: Payment): Pick<Payment, 'lbFlip'> => (sel.lbFlip && sel.lbFlip.length ? { lbFlip: sel.lbFlip } : {})

export function withBackup(sel: Payment, id: CardId, on: boolean): Payment {
  const without = sel.dullBackups.filter((b) => b !== id)
  return { dullBackups: on ? [...without, id] : without, discards: sel.discards, ...keepFlips(sel) }
}

/** Set (element given) or clear (null) a hand card's discard. */
export function withDiscard(sel: Payment, card: CardId, element: Element | null): Payment {
  const without = sel.discards.filter((d) => d.card !== card)
  return { dullBackups: sel.dullBackups, discards: element === null ? without : [...without, { card, element }], ...keepFlips(sel) }
}

/** Rung J8: add or remove an LB-deck card from the ones the Limit Break cost turns face up. */
export function withFlip(sel: Payment, id: CardId, on: boolean): Payment {
  const without = (sel.lbFlip ?? []).filter((x) => x !== id)
  const lbFlip = on ? [...without, id] : without
  return { dullBackups: sel.dullBackups, discards: sel.discards, ...(lbFlip.length ? { lbFlip } : {}) }
}

/** Rung J8: how many LB-deck cards a listed payment turns face up (the same for every listed payment of one cast). */
export function flipsNeeded(legal: readonly Payment[]): number {
  return legal.reduce((m, p) => Math.max(m, p.lbFlip?.length ?? 0), 0)
}

/** The listed choice whose payment IS the selection, or null while it is incomplete. This — never the
 *  selection itself — is what Confirm submits, so the command is an object `legalCommands` produced. */
export function completedChoice(c: Choice, sel: Payment): Choice | null {
  if (!isPayableChoice(c)) return null
  const need = flipsNeeded(legalPaymentsOf(c))
  if (need === 0) {
    if (samePayment(c.command.payment, sel)) return c
    return (c.alternatives ?? []).find((a) => isPayableChoice(a) && samePayment(a.command.payment, sel)) ?? null
  }
  // Rung J8: the listed payment with this CP part, carrying the player's OWN X flips — `useGame.choose` runs it
  // through `isLegal`, which accepts any X-subset (review M2).
  if ((sel.lbFlip?.length ?? 0) !== need) return null
  const match = [c, ...(c.alternatives ?? [])].find((a) => isPayableChoice(a) && sameCp(a.command.payment, sel))
  if (!match || !isPayableChoice(match)) return null
  return { ...match, command: { ...match.command, payment: { ...match.command.payment, lbFlip: [...(sel.lbFlip ?? [])] } } }
}

/** The CP the selection generates, through the engine's own validator. Throws on an illegal source, which the
 *  picker never offers — so a throw here is a picker bug, not a player error. */
export function generatedFor(v: PlayerView, sel: Payment, req: CpRequirement): GeneratedCp[] {
  return generateCp(stateShim(v), v.me, sel, req.excluded)
}

/**
 * Which crystals light for this much CP. Required crystals are matched first, backtracking so a flexible
 * source (Moogle) yields its fixed element to a fixed source when that is the only way both can be met — the
 * same matching `canPay` does, but maximising rather than deciding, so a partial payment shows partial
 * progress. Whatever CP is left pours into the untinted crystals.
 */
export function crystals(req: CpRequirement, generated: readonly GeneratedCp[]): Crystal[] {
  // "You can only pay with Fire CP" (rung V1-A3): the same narrowing `canPay` applies (`onlyAdmissible`) — CP that cannot
  // be that Element pays nothing, and a flexible source counts as it alone. The engine accepts such CP generated and unspent
  // (rung V1-D, §11.2.2.3), but the picker never offers it — its payments are the engine's minimal ones — so this is only
  // what the tray would show if one were forced in.
  const only = req.onlyElement
  const cp = only === undefined ? generated
    : generated.filter((c) => c.elements.includes(only)).map((c) => ({ ...c, elements: [only] }))
  const need = [...req.requiredElements]
  const best = bestAssignment(need, cp)
  const taken = new Set(best.filter((i): i is number => i !== null))
  const leftover = cp.filter((_, i) => !taken.has(i))
  const generic = Math.max(0, req.amount - need.length)
  const out: Crystal[] = need.map((element, i) => ({ element, lit: best[i] !== null }))
  for (let i = 0; i < generic; i++) {
    const paidBy = leftover[i]
    out.push(paidBy
      ? { element: paidBy.elements.length === 1 ? paidBy.elements[0] as Element : null, lit: true }
      : { element: null, lit: false })
  }
  return out
}

/** The assignment of sources to required elements that covers the MOST requirements. Sizes are 1–3 needs over
 *  single-digit sources, so plain backtracking is right (spec C6-2). */
function bestAssignment(need: readonly Element[], cp: readonly GeneratedCp[]): (number | null)[] {
  let best: (number | null)[] = need.map(() => null)
  let bestCount = 0
  const current: (number | null)[] = need.map(() => null)
  const used = new Set<number>()
  const walk = (k: number, count: number): void => {
    if (k === need.length) {
      if (count > bestCount) { bestCount = count; best = [...current] }
      return
    }
    if (count + (need.length - k) <= bestCount) return
    const e = need[k] as Element
    for (let i = 0; i < cp.length; i++) {
      if (used.has(i) || !(cp[i] as GeneratedCp).elements.includes(e)) continue
      used.add(i); current[k] = i
      walk(k + 1, count + 1)
      used.delete(i); current[k] = null
    }
    walk(k + 1, count)
  }
  walk(0, 0)
  return best
}

export function paidText(lit: readonly Crystal[]): string {
  return `${lit.filter((c) => c.lit).length} of ${lit.length} CP paid`
}
