import { canPay, defOf, generateCp, requiredElements, type CardId, type Element, type GameState, type Payment, type PlayerId } from '@fftcg/engine'
import { cardValue } from './cardValue.js'

interface Source { kind: 'backup' | 'discard'; id: CardId; elements: Element[]; cp: number; cost: number }

/**
 * Find the least valuable way to cover every required element with one source each (cheapest by `Source.cost` —
 * see R1 below — not by CP generated), via bounded backtracking (required
 * elements ≤ 8 per CardDef, sources ≤ ~12 in practice — trivially small to search exhaustively). A single greedy
 * pass — even scarcest-element-first — can still strand a later element: spending a flexible source on an element
 * a less flexible (but pricier) source could also have covered, only to find nothing left for the element only
 * the flexible source could pay (Codex: sources {earth}(expensive), {earth,lightning}(cheap), {lightning,fire} —
 * greedy spends the cheap dual source on earth, then has nothing for lightning once the fire-only source is
 * spent on fire). Backtracking explores every source-to-element assignment (not just the first that fits) and
 * keeps the cheapest complete one, so it finds a covering assignment whenever one exists.
 */
function assignRequiredElements(elements: Element[], sources: Source[], canSupply: (s: Source, e: Element) => boolean): Map<Element, Source> | null {
  // Processing scarcest elements first prunes the search fastest but doesn't change correctness — every branch
  // below tries every remaining candidate for the current element and recurses, so it finds a covering
  // assignment (the cheapest one) whenever one exists, regardless of element order.
  const order = [...elements].sort((a, b) => sources.filter((s) => canSupply(s, a)).length - sources.filter((s) => canSupply(s, b)).length)
  const used = new Set<Source>()
  const rec = (i: number): { assignment: Map<Element, Source>; cost: number } | null => {
    if (i === order.length) return { assignment: new Map(), cost: 0 }
    const e = order[i] as Element
    let best: { assignment: Map<Element, Source>; cost: number } | null = null
    for (const s of sources) {
      if (used.has(s) || !canSupply(s, e)) continue
      used.add(s)
      const rest = rec(i + 1)
      used.delete(s)
      if (!rest) continue
      // R1: minimise `Source.cost` (what spending the source is WORTH giving up — 1 for a backup, 2 + cardValue
      // for a discard), not `Source.cp` (how much CP it generates). Every discard generates 2 CP, so ranking by
      // `cp` cannot separate two discards and silently falls back to hand order — which threw away an 8000-power
      // forward where a cost-1 summon would do. `cost` also still prefers backups (1) over any discard (>= 2),
      // which is why the pre-backtracking greedy pass sorted by it.
      const cost = s.cost + rest.cost
      if (!best || cost < best.cost) {
        const assignment = new Map(rest.assignment)
        assignment.set(e, s)
        best = { assignment, cost }
      }
    }
    return best
  }
  const result = rec(0)
  return result ? result.assignment : null
}

export function preferredPayment(state: GameState, player: PlayerId, card: CardId): Payment | null {
  const def = defOf(state, card)
  if (def.cost === 0) return { dullBackups: [], discards: [] }
  const ps = state.players[player]
  const sources: Source[] = []
  for (const b of ps.backups) if (b.status === 'active') sources.push({ kind: 'backup', id: b.id, elements: defOf(state, b.id).elements, cp: 1, cost: 1 })
  for (const id of ps.hand) {
    if (id === card) continue
    const d = defOf(state, id)
    if (d.elements.includes('light') || d.elements.includes('dark')) continue
    sources.push({ kind: 'discard', id, elements: d.elements, cp: 2, cost: 2 + cardValue(d) })
  }
  const chosen = new Set<Source>()
  const declared = new Map<CardId, Element>()
  let total = 0
  const take = (s: Source, element: Element) => { chosen.add(s); total += s.cp; if (s.kind === 'discard') declared.set(s.id, element) }
  const canSupply = (s: Source, e: Element) => (s.kind === 'backup' ? s.elements[0] === e : s.elements.includes(e))   // backups produce elements[0] only (cp.ts)

  // §11.2.2.1 / §11.2.1.1: at least one CP of each required element (requiredElements exempts pure Light/Dark).
  const elements = requiredElements(def)
  const assignment = assignRequiredElements(elements, sources, canSupply)
  if (elements.length && !assignment) return null
  if (assignment) for (const [e, s] of assignment) take(s, e)

  for (const s of [...sources].sort((a, b) => a.cost - b.cost)) { if (total >= def.cost) break; if (!chosen.has(s)) take(s, s.elements[0] as Element) }
  if (total < def.cost) return null
  const payment: Payment = {
    dullBackups: [...chosen].filter((s) => s.kind === 'backup').map((s) => s.id),
    discards: [...chosen].filter((s) => s.kind === 'discard').map((s) => ({ card: s.id, element: declared.get(s.id) as Element })),
  }
  return canPay(def.cost, elements, generateCp(state, player, payment, card)) ? payment : null
}
