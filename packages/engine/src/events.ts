import type { PlayerId, Element, CardType, Keyword } from './types.js'
import type { Phase, AttackStep, GameResult, CardId } from './state.js'
import type { FieldFlag, TriggerEvent } from './abilities.js'

/** How an event names a stack item: the Summon card, or the ability's source and clause. */
export type StackRef = { kind: 'summon'; card: CardId } | { kind: 'ability'; source: CardId; abilityId: string }

export type Event =
  | { type: 'firstPlayerChosen'; player: PlayerId }
  | { type: 'mulligan'; player: PlayerId; redraw: boolean }
  | { type: 'turnStarted'; turn: number; player: PlayerId }
  | { type: 'phaseStarted'; phase: Phase; step?: AttackStep }
  | { type: 'activated'; player: PlayerId; cards: CardId[] }
  | { type: 'drew'; player: PlayerId; count: number }
  /**
   * One entry per CP generated, each the SET of Elements that CP may count as (spec C6-5).
   *
   * A set rather than one Element because since C6 the engine never commits: a dulled Moogle may cover Earth
   * or Lightning, and which one it "was" is not a fact the rules produce. This used to record the printed
   * first Element, which after C6 was a guess — and a wrong-looking one, logging `earth` for a CP that had
   * just paid a Lightning cost.
   */
  | { type: 'cpGenerated'; player: PlayerId; cp: readonly (readonly Element[])[] }
  /** `ability` (rung V1-A2): an effect's "discard" (§15.1.1.4) — Porom. */
  | { type: 'discarded'; player: PlayerId; card: CardId; reason: 'cp' | 'handSize' | 'cost' | 'ability' }
  /** §15.2.8.3.2 (rung J8): the face-down LB-deck cards turned face up to pay a Limit Break cost. */
  | { type: 'lbFlipped'; player: PlayerId; cards: CardId[] }
  /** §15.2.8.4 (rung J8): an LB card that reached `from` went on to its owner's LB deck face up, at once. */
  | { type: 'lbReturned'; player: PlayerId; card: CardId; from: 'hand' | 'breakZone' | 'deck' | 'removedFromGame' }
  | { type: 'cast'; player: PlayerId; card: CardId; cardType: CardType; from?: 'hand' | 'lbDeck' }
  /** An activated ability was used (spec C3-1) — activated, NOT triggered; the log must not conflate them. */
  | { type: 'abilityActivated'; player: PlayerId; card: CardId; abilityId: string }
  /** Cards exposed off the top of a deck (spec C9). `audience` is who learned them, never which cards. */
  // `cards` is what was exposed, in exposed order. The narrator redacts it against the VIEW rather than
  // against `audience`: a card the viewer's `PlayerView` does not carry cannot be named, whatever the
  // audience said. Reading the top `count` of the deck instead would name the wrong cards once the
  // nothing-was-eligible path has already put them under (spec C9).
  // `scope` separates "the top N" from "the whole deck": a SEARCH exposes everything, and a log line that
  // called that "the top 37 cards" would be technically true and useless.
  | { type: 'deckExposed'; player: PlayerId; count: number; audience: 'self' | 'all'; cards: readonly CardId[]; scope: 'top' | 'deck' }
  /** A card put onto the field from the deck without being cast — Hugh Yurg's search (spec C9). */
  | { type: 'playedFromDeck'; player: PlayerId; card: CardId }
  /** A card put onto the field from its owner's hand by an effect, without being cast (rung V1-A2, §15.1.1.7). */
  | { type: 'playedFromHand'; player: PlayerId; card: CardId }
  /** A card taken from an exposure into its owner's hand. */
  | { type: 'addedToHand'; player: PlayerId; card: CardId }
  /** A card removed from the game (spec C7-3). Distinct from breaking and from discarding. */
  | { type: 'removedFromGame'; player: PlayerId; card: CardId }
  /**
   * A card put into the Break Zone to PAY for its own ability. Deliberately not `brokenByAbility`: this is not
   * a break (§15.1.1.3.2), so anything counting breaks must not count it.
   */
  | { type: 'paidToBreakZone'; player: PlayerId; card: CardId }
  | { type: 'summonResolvedNoEffect'; card: CardId }
  /**
   * Rung J1-D13, the stack's lifecycle. `item` is what went on (a Summon card, or an ability by source and
   * clause); `controller` who put it there. `stackResolved` fires when the item has finished — prompts
   * included — and `stackCancelled` when it was removed unresolved (no legal target at placement, §11.8.4;
   * every declared target gone at resolution, §11.11.2; a conditional auto-ability's condition no longer met as it
   * resolves, §11.11.3, rung V1-D).
   */
  | { type: 'stackPushed'; item: StackRef; controller: PlayerId }
  | { type: 'stackResolved'; item: StackRef }
  | { type: 'stackCancelled'; item: StackRef; reason: 'noTargetAtPlacement' | 'targetsGone' | 'condition' }
  /**
   * Coverage is per CLAUSE (spec C1-9). `clauses` counts the printed clauses still unimplemented; it is OMITTED
   * when nothing on the card is implemented, which keeps the shape of the vanilla-pool log line unchanged.
   */
  | { type: 'unimplementedAbility'; card: CardId; code: string; clauses?: number }
  | { type: 'attackDeclared'; player: PlayerId; attackers: CardId[] }
  | { type: 'blockDeclared'; player: PlayerId; blocker: CardId | null }
  | { type: 'battleDamage'; source: CardId; target: CardId; amount: number }
  | { type: 'playerDamaged'; player: PlayerId; card: CardId }
  /**
   * Rung G3, the EX Burst lifecycle (§11.10). `exBurstSkipped` is gone: it was the honest warning that the
   * rule was NOT applied, and deleting it without replacement would have left the new behaviour unnarrated
   * and the acceptance figures unauditable.
   *
   * Every revealed EX card ends in exactly one terminal state — declined, used, or neither because the damage
   * was lethal and the game ended first — which is what makes the accounting in G3-A1 a closed sum.
   */
  | { type: 'exBurstOffered'; player: PlayerId; card: CardId; abilityId: string }
  | { type: 'exBurstUsed'; player: PlayerId; card: CardId; abilityId: string }
  | { type: 'exBurstDeclined'; player: PlayerId; card: CardId; abilityId: string }
  | { type: 'broken'; card: CardId }                                   // §12.4.5 damage ≥ power
  /** §12.4.4, §12.4.6–8 (rung J4); `ability` is an effect that says "put into the Break Zone" (rung V1-A2, §15.1.1.3.2) — not a break. */
  | { type: 'putIntoBreakZone'; card: CardId; reason: 'zeroPower' | 'sameName' | 'lightDark' | 'backupLimit' | 'ability' }
  // --- ability resolution (spec C1-3) ---
  /** Emitted when a triggered clause is PLACED (rung J1-D13). `cause` is the frame's own trigger event, so the log never has to reconstruct it from event order. */
  | { type: 'abilityTriggered'; player: PlayerId; card: CardId; abilityId: string; cause?: TriggerEvent | null }
  /** The clause had no legal target, so it did nothing. Never an error — half the pool can find itself here. */
  /** `controller` is whose ability found nothing — an agent must not price the OPPONENT's wasted ability as
   *  its own loss, and a narrator that says "your ability" needs the same answer (Codex MAJOR). */
  | { type: 'abilityNoLegalTarget'; card: CardId; abilityId: string; controller: PlayerId }
  | { type: 'dulled'; card: CardId }
  /**
   * An effect activated a dull Character (rung V1-A2, §15.1.1.1). Not `activated`, which is the Active Phase's
   * whole-field untap (§9.1) and names a player; the log must not say a turn began.
   */
  | { type: 'activatedByAbility'; card: CardId }
  /** §15.2.4 (rung J3): the card will not activate in its controller's next Active Phase. */
  | { type: 'frozen'; card: CardId }
  /** That Active Phase came: the card was left as it was and the status cleared. */
  | { type: 'thawed'; card: CardId }
  | { type: 'abilityDamage'; source: CardId; target: CardId; amount: number }
  | { type: 'powerModified'; card: CardId; amount: number }
  | { type: 'keywordGranted'; card: CardId; keyword: Keyword }
  | { type: 'flagGranted'; card: CardId; flag: FieldFlag }
  | { type: 'returnedToHand'; player: PlayerId; card: CardId }
  | { type: 'brokenByAbility'; card: CardId; source: CardId }
  | { type: 'breakPrevented'; card: CardId; flag: FieldFlag }
  | { type: 'gameOver'; result: GameResult }
