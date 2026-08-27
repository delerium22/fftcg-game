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
   * Answers a `chooseFromDeck` pending: INDICES into the exposed cards, never ids (spec C9-1).
   *
   * World-independent by construction, which is what makes the search key trivial: `chooseFromDeck:2` asks
   * the same question in every determinisation while the card it lands on differs per world — precisely the
   * information-set semantics ISMCTS wants.
   */
  | { type: 'chooseFromDeck'; player: PlayerId; picks: readonly number[] }
  /**
   * Use an activated ability (spec C3-1).
   *
   * `targets` answers the ability's leading `chooseTargets` and is DECLARED HERE, before any cost is paid.
   *
   * An earlier revision preflighted them instead — checking, at activation time, that a legal target would
   * exist once costs were paid — and let the choice happen afterwards as an ordinary `Pending`. The code
   * review broke that with an executed counterexample: an ability whose targeting is not its FIRST effect
   * passed the check, paid its cost, and then resolved to nothing. Preflighting also could not survive the
   * cost's own triggers, which resolve BEFORE the action frame and can move the board out from under the set
   * that was checked, and it let the opponent answer a cost-fired trigger before the activating player had
   * chosen anything.
   *
   * Declaring first is what makes activation one transaction (§11.6.5): choices, then validation, then
   * payment, then resolution — never a cost paid for a choice not yet made.
   *
   * `abilityId` is the clause's stable id, never an index into the card's ability array: a card's implemented
   * clauses arrive across different rungs, so indices shift under it.
   */
  | { type: 'activateAbility'; player: PlayerId; source: CardId; abilityId: string; payment: Payment; targets: readonly CardId[] }
  | { type: 'pass'; player: PlayerId }
  | { type: 'concede'; player: PlayerId }
