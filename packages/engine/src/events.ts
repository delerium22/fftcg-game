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
  /**
   * One entry per CP generated, each the SET of Elements that CP may count as (spec C6-5).
   *
   * A set rather than one Element because since C6 the engine never commits: a dulled Moogle may cover Earth
   * or Lightning, and which one it "was" is not a fact the rules produce. This used to record the printed
   * first Element, which after C6 was a guess — and a wrong-looking one, logging `earth` for a CP that had
   * just paid a Lightning cost.
   */
  | { type: 'cpGenerated'; player: PlayerId; cp: readonly (readonly Element[])[] }
  | { type: 'discarded'; player: PlayerId; card: CardId; reason: 'cp' | 'handSize' | 'cost' }
  | { type: 'cast'; player: PlayerId; card: CardId; cardType: CardType }
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
