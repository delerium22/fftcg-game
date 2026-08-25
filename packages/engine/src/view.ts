import type { CardDef, PlayerId } from './types.js'
import type { AttackState, CardId, CardInstance, FieldCard, GameResult, GameState, Pending, Phase } from './state.js'

export interface FieldView { forwards: FieldCard[]; backups: FieldCard[]; damageZone: CardId[]; breakZone: CardId[]; deckCount: number; handCount: number }
export interface PlayerView {
  me: PlayerId; turn: number; turnPlayer: PlayerId; phase: Phase; attack: AttackState | null; priority: PlayerId
  pending: Pending | null; result: GameResult | null; hand: CardId[]; fields: [FieldView, FieldView]
  cards: Record<CardId, CardInstance>; defs: Record<string, CardDef>
}

export function viewFor(state: GameState, me: PlayerId): PlayerView {
  const field = (p: PlayerId): FieldView => {
    const ps = state.players[p]
    return { forwards: ps.forwards, backups: ps.backups, damageZone: ps.damageZone, breakZone: ps.breakZone, deckCount: ps.deck.length, handCount: ps.hand.length }
  }
  const visibleIds = new Set<CardId>(state.players[me].hand)
  for (const p of [0, 1] as const) {
    const ps = state.players[p]
    for (const c of ps.forwards) visibleIds.add(c.id)
    for (const c of ps.backups) visibleIds.add(c.id)
    for (const id of ps.damageZone) visibleIds.add(id)
    for (const id of ps.breakZone) visibleIds.add(id)
  }
  const cards: Record<CardId, CardInstance> = {}
  for (const id of visibleIds) { const inst = state.cards[id]; if (inst) cards[id] = inst }
  return structuredClone({
    me, turn: state.turn, turnPlayer: state.turnPlayer, phase: state.phase, attack: state.attack, priority: state.priority,
    pending: state.pending, result: state.result, hand: state.players[me].hand, fields: [field(0), field(1)], cards, defs: state.defs,
  })
}
