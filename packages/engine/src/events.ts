import type { PlayerId, Element, CardType } from './types.js'
import type { Phase, AttackStep, GameResult, CardId } from './state.js'

export type Event =
  | { type: 'firstPlayerChosen'; player: PlayerId }
  | { type: 'mulligan'; player: PlayerId; redraw: boolean }
  | { type: 'turnStarted'; turn: number; player: PlayerId }
  | { type: 'phaseStarted'; phase: Phase; step?: AttackStep }
  | { type: 'activated'; player: PlayerId; cards: CardId[] }
  | { type: 'drew'; player: PlayerId; count: number }
  | { type: 'cpGenerated'; player: PlayerId; cp: Element[] }
  | { type: 'discarded'; player: PlayerId; card: CardId; reason: 'cp' | 'handSize' }
  | { type: 'cast'; player: PlayerId; card: CardId; cardType: CardType }
  | { type: 'summonResolvedNoEffect'; card: CardId }
  | { type: 'unimplementedAbility'; card: CardId; code: string }
  | { type: 'attackDeclared'; player: PlayerId; attackers: CardId[] }
  | { type: 'blockDeclared'; player: PlayerId; blocker: CardId | null }
  | { type: 'battleDamage'; source: CardId; target: CardId; amount: number }
  | { type: 'playerDamaged'; player: PlayerId; card: CardId }
  | { type: 'exBurstSkipped'; player: PlayerId; card: CardId }
  | { type: 'broken'; card: CardId }                                   // §12.4.5 damage ≥ power
  | { type: 'putIntoBreakZone'; card: CardId; reason: 'zeroPower' }     // §12.4.4
  | { type: 'gameOver'; result: GameResult }
