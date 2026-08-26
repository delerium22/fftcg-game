import type { PlayerId, Element, CardType, Keyword } from './types.js'
import type { Phase, AttackStep, GameResult, CardId } from './state.js'
import type { FieldFlag } from './abilities.js'

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
  /**
   * Coverage is per CLAUSE (spec C1-9). `clauses` counts the printed clauses still unimplemented; it is OMITTED
   * when nothing on the card is implemented, which keeps the shape of the vanilla-pool log line unchanged.
   */
  | { type: 'unimplementedAbility'; card: CardId; code: string; clauses?: number }
  | { type: 'attackDeclared'; player: PlayerId; attackers: CardId[] }
  | { type: 'blockDeclared'; player: PlayerId; blocker: CardId | null }
  | { type: 'battleDamage'; source: CardId; target: CardId; amount: number }
  | { type: 'playerDamaged'; player: PlayerId; card: CardId }
  | { type: 'exBurstSkipped'; player: PlayerId; card: CardId }
  | { type: 'broken'; card: CardId }                                   // §12.4.5 damage ≥ power
  | { type: 'putIntoBreakZone'; card: CardId; reason: 'zeroPower' }     // §12.4.4
  // --- ability resolution (spec C1-3) ---
  | { type: 'abilityTriggered'; player: PlayerId; card: CardId; abilityId: string }
  /** The clause had no legal target, so it did nothing. Never an error — half the pool can find itself here. */
  | { type: 'abilityNoLegalTarget'; card: CardId; abilityId: string }
  | { type: 'dulled'; card: CardId }
  | { type: 'abilityDamage'; source: CardId; target: CardId; amount: number }
  | { type: 'powerModified'; card: CardId; amount: number }
  | { type: 'keywordGranted'; card: CardId; keyword: Keyword }
  | { type: 'flagGranted'; card: CardId; flag: FieldFlag }
  | { type: 'returnedToHand'; player: PlayerId; card: CardId }
  | { type: 'brokenByAbility'; card: CardId; source: CardId }
  | { type: 'breakPrevented'; card: CardId; flag: FieldFlag }
  | { type: 'gameOver'; result: GameResult }
