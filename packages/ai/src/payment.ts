import { canPay, castRequirement, defOf, generateCp, type CardId, type CpRequirement, type Element, type GameState, type Payment, type PlayerId } from '@fftcg/engine'
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
/**
 * One distinct source per REQUIREMENT, not per element. The result was keyed `Map<Element, Source>`, which
 * silently collapsed a repeated requirement: `[Lightning][Lightning]` would consume two sources during the
 * search but return one entry, so only one was ever spent. Returning pairs keeps each requirement its own.
 */
function assignRequiredElements(elements: readonly Element[], sources: Source[], canSupply: (s: Source, e: Element) => boolean): [Element, Source][] | null {
  // Processing scarcest elements first prunes the search fastest but doesn't change correctness — every branch
  // below tries every remaining candidate for the current element and recurses, so it finds a covering
  // assignment (the cheapest one) whenever one exists, regardless of element order.
  const order = [...elements].sort((a, b) => sources.filter((s) => canSupply(s, a)).length - sources.filter((s) => canSupply(s, b)).length)
  const used = new Set<Source>()
  const rec = (i: number): { assignment: [Element, Source][]; cost: number } | null => {
    if (i === order.length) return { assignment: [], cost: 0 }
    const e = order[i] as Element
    let best: { assignment: [Element, Source][]; cost: number } | null = null
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
        best = { assignment: [...rest.assignment, [e, s] as [Element, Source]], cost }
      }
    }
    return best
  }
  const result = rec(0)
  return result ? result.assignment : null
}

export function preferredPayment(state: GameState, player: PlayerId, card: CardId): Payment | null {
  return preferredPaymentFor(state, player, castRequirement(state, card, player))
}

/**
 * As `preferredPayment`, for any requirement — an activated ability's cost as readily as a card's printed one
 * (spec C3-4). The value-minimising logic is the whole point of using this over `enumeratePaymentsFor`: it is
 * what stops the AI discarding an 8000-power Forward to pay for a draw.
 */
export function preferredPaymentFor(state: GameState, player: PlayerId, req: CpRequirement): Payment | null {
  const card = req.excluded
  if (req.amount === 0) return { dullBackups: [], discards: [] }
  const ps = state.players[player]
  const sources: Source[] = []
  for (const b of ps.backups) {
    if (b.status !== 'active' || card.includes(b.id)) continue
    sources.push({ kind: 'backup', id: b.id, elements: defOf(state, b.id).elements, cp: 1, cost: 1 })
  }
  for (const id of ps.hand) {
    if (card.includes(id)) continue
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
  const elements = req.requiredElements
  const assignment = assignRequiredElements(elements, sources, canSupply)
  if (elements.length && !assignment) return null
  if (assignment) for (const [e, s] of assignment) take(s, e)

  for (const s of [...sources].sort((a, b) => a.cost - b.cost)) { if (total >= req.amount) break; if (!chosen.has(s)) take(s, s.elements[0] as Element) }
  if (total < req.amount) return null

  // R5: emit sources in the engine's own order — `enumeratePayments` lists dullBackups in field order and
  // discards in hand order, so a payment built in *selection* order is the same payment but a different object,
  // and any caller matching preferredPayment's result against legalCommands by value would spuriously miss it
  // (which is most of them: the UI collapses a card's many legal payments down to this one). Canonical here,
  // not at every call site.
  const backupOrder = new Map(ps.backups.map((b, i) => [b.id, i]))
  const handOrder = new Map(ps.hand.map((id, i) => [id, i]))
  const build = (from: Iterable<Source>): Payment => {
    const list = [...from]
    return {
      dullBackups: list.filter((s) => s.kind === 'backup').map((s) => s.id).sort((a, b) => (backupOrder.get(a) ?? 0) - (backupOrder.get(b) ?? 0)),
      discards: list.filter((s) => s.kind === 'discard').map((s) => ({ card: s.id, element: declared.get(s.id) as Element }))
        .sort((a, b) => (handOrder.get(a.card) ?? 0) - (handOrder.get(b.card) ?? 0)),
    }
  }
  const pays = (from: Iterable<Source>): boolean => canPay(req.amount, elements, generateCp(state, player, build(from), card))

  // R5: the two phases above are each greedy in isolation, so together they can over-spend — the required-element
  // phase takes the cheapest source for the element (often a 1 CP backup), then the top-up phase adds a 2 CP
  // discard to reach the cost, when that discard alone would have paid exactly. That matters twice over:
  // `enumeratePayments` emits only MINIMAL payments, so a non-minimal result is not in `legalCommands` at all
  // (measured: 40.2% of results over real games), which makes it unusable as a move for the UI and wasteful for
  // the AI. Drop the most valuable redundant source until none can go, which is exactly enumeratePayments'
  // minimality condition: removing any single remaining source must break the payment.
  for (;;) {
    const droppable = [...chosen].filter((s) => pays([...chosen].filter((o) => o !== s))).sort((a, b) => b.cost - a.cost)
    const worst = droppable[0]
    if (!worst) break
    chosen.delete(worst)
  }

  const payment = build(chosen)
  return pays(chosen) ? payment : null
}
