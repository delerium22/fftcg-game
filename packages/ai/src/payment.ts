import { canPay, defOf, generateCp, type CardId, type Element, type GameState, type Payment, type PlayerId } from '@fftcg/engine'
import { cardValue } from './cardValue.js'

interface Source { kind: 'backup' | 'discard'; id: CardId; elements: Element[]; cp: number; cost: number }

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
  sources.sort((a, b) => a.cost - b.cost)
  const chosen = new Set<Source>()
  const declared = new Map<CardId, Element>()
  let total = 0
  const take = (s: Source, element: Element) => { chosen.add(s); total += s.cp; if (s.kind === 'discard') declared.set(s.id, element) }
  const provides = (s: Source, e: Element) => (s.kind === 'backup' ? s.elements[0] === e : declared.get(s.id) === e)
  for (const e of def.elements) {                       // §11.2.2.1: at least one CP of each required element
    if ([...chosen].some((s) => provides(s, e))) continue
    const s = sources.find((x) => !chosen.has(x) && (x.kind === 'backup' ? x.elements[0] === e : x.elements.includes(e)))   // backups produce elements[0] only (cp.ts)
    if (!s) return null
    take(s, e)
  }
  for (const s of sources) { if (total >= def.cost) break; if (!chosen.has(s)) take(s, s.elements[0] as Element) }
  if (total < def.cost) return null
  const payment: Payment = {
    dullBackups: [...chosen].filter((s) => s.kind === 'backup').map((s) => s.id),
    discards: [...chosen].filter((s) => s.kind === 'discard').map((s) => ({ card: s.id, element: declared.get(s.id) as Element })),
  }
  return canPay(def.cost, def.elements, generateCp(state, player, payment, card)) ? payment : null
}
