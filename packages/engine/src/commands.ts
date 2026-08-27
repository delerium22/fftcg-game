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
  /** Answers a `chooseTargets` pending (spec C1-6). `apply` re-validates uniqueness, min/max and membership. */
  | { type: 'chooseTargets'; player: PlayerId; targets: readonly CardId[] }
  /** Answers a `chooseMode` pending: indices into the pending's `labels`. Chosen modes run in listed order. */
  | { type: 'chooseMode'; player: PlayerId; modes: readonly number[] }
  /**
   * Use an activated ability (spec C3-1).
   *
   * Targets are NOT carried here. Activating PREFLIGHTS them instead: the ability's target set is computed
   * against the state as it will be once the costs are paid, and the activation is illegal unless a legal
   * target exists (§11.6.5). Otherwise a player could pay a cost — usually putting the source card itself
   * into the Break Zone — for an ability that then finds nothing to target and resolves as a no-op.
   *
   * Preflighting POST-cost is what makes this exact, and two things fall out of it for free: Undead Princess
   * has already left the field by then and so cannot be her own target, and the candidate set the player is
   * subsequently offered is precisely the one that was preflighted. Choosing stays a separate `Pending`,
   * exactly as it already is for every targeted triggered ability.
   *
   * `abilityId` is the clause's stable id, never an index into the card's ability array: a card's implemented
   * clauses arrive across different rungs, so indices shift under it.
   */
  | { type: 'activateAbility'; player: PlayerId; source: CardId; abilityId: string; payment: Payment }
  | { type: 'pass'; player: PlayerId }
  | { type: 'concede'; player: PlayerId }
