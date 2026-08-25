import type { PlayerId, Element } from './types.js'
import type { CardId } from './state.js'

export interface Payment { dullBackups: CardId[]; discards: { card: CardId; element: Element }[] }
export type Command =
  | { type: 'chooseFirst'; player: PlayerId; goFirst: boolean }
  | { type: 'mulligan'; player: PlayerId; redraw: boolean }
  | { type: 'castCharacter'; player: PlayerId; card: CardId; payment: Payment }
  | { type: 'castSummon'; player: PlayerId; card: CardId; payment: Payment }
  | { type: 'declareAttack'; player: PlayerId; attackers: CardId[] }
  | { type: 'declareBlock'; player: PlayerId; blocker: CardId | null }
  | { type: 'assignPartyDamage'; player: PlayerId; assignments: { target: CardId; amount: number }[] }
  | { type: 'discardToHandSize'; player: PlayerId; cards: CardId[] }
  | { type: 'pass'; player: PlayerId }
  | { type: 'concede'; player: PlayerId }
