import type { Rng } from './rng.js'
import type { PlayerId, CardDef, Keyword } from './types.js'
import type { FieldFlag, Resolution, TargetFilter } from './abilities.js'

export type CardId = number
export interface CardInstance { id: CardId; code: string; owner: PlayerId }
export type Status = 'active' | 'dull'
export interface FieldCard {
  id: CardId; status: Status; damage: number; enteredTurn: number; attackedThisTurn: boolean
  granted: Keyword[]
  /** Until-end-of-turn power modifier (spec C1-7). Cleared in the End Phase; only `effectivePower` reads it. */
  powerBonus: number
  /** Until-end-of-turn protection `granted` cannot express, e.g. `cannotBeBroken` (spec C1-7). */
  flags: readonly FieldFlag[]
}
export interface PlayerState {
  deck: CardId[]        // index 0 = top
  hand: CardId[]
  forwards: FieldCard[]
  backups: FieldCard[]
  damageZone: CardId[]
  breakZone: CardId[]
  /**
   * Removed from the game (spec C7-1). PUBLIC and inert: both players see it, nothing returns from it, and
   * no rule reads it. Unlike the deck it needs no information model, which is what makes it cheap.
   */
  removedFromGame: CardId[]
  mulliganDecided: boolean
}
export type Phase = 'setup' | 'active' | 'draw' | 'main1' | 'attack' | 'main2' | 'end'
export type AttackStep = 'preparation' | 'declaration' | 'block' | 'damage'
export interface AttackState { step: AttackStep; attackers: CardId[]; blocker: CardId | null }
/** Decisions owed by a specific player that are NOT priority actions (§11.1): setup choices, the defender's step actions in the Attack Phase, and the choices an ability suspends on (spec C1-6). */
export type Pending =
  | { kind: 'chooseFirst'; player: PlayerId }
  | { kind: 'mulligan'; player: PlayerId }
  | { kind: 'discardToHandSize'; player: PlayerId; count: number }
  | { kind: 'declareBlock'; player: PlayerId }          // §10.1.3.1
  | { kind: 'assignPartyDamage'; player: PlayerId }     // §10.1.4.2.1
  /** `candidates` is the exact legal set the executor computed; `apply` re-checks membership rather than trusting it. */
  | { kind: 'chooseTargets'; player: PlayerId; min: number; max: number; candidates: readonly CardId[] }
  /** `labels` are the printed mode wordings, in listed order; an answer is a set of indices into them. */
  | { kind: 'chooseMode'; player: PlayerId; min: number; max: number; labels: readonly string[] }
  /**
   * Pick from cards exposed off the top of your own deck (spec C9-1), answered by INDEX — never by card id.
   *
   * That is the decision the whole rung turns on. A pending naming CARDS would have to be redacted for the
   * opponent, rebuilt by `determinise` after it re-mints hidden ids, and keyed by a card the searcher cannot
   * know. Carrying a COUNT instead makes it valid in every world at once, exactly as `chooseMode` carries
   * labels and is answered by index.
   *
   * `count` is how many are exposed; `filter` is the restriction the printed text puts on what may be taken.
   * The QUESTION travels, not the ANSWER: which indices satisfy the filter is computed from the deck, by
   * whoever holds one — `legalCommands` and `applyChooseFromDeck` on the real state, and the search on each
   * determinised state.
   *
   * It carried the resolved index list until the C9 code review, and that leaked. This very comment used to
   * say the shape was safe "because no clause in the pool is both PRIVATE and FILTERED" — and then Hugh
   * Yurg's search arrived as exactly that, private and filtered, so `eligible: [4,12,16,31,37]` handed the
   * opponent the positions of every cost-1 Earth Forward in a deck they cannot see. `viewFor` copies the
   * pending into BOTH seats verbatim, so a precondition about the card pool was never going to hold it.
   *
   * Carrying the filter fixes it by construction rather than by redaction, and fixes the search too: the
   * indices were computed against the REAL deck, so in a determinised world they named cards that did not
   * match the filter at all, and the observation key split on positions no observer could see.
   */
  // `to` is where a picked card GOES. It is on the pending, not just on the effect, because the button the
  // player clicks has to say it: "Take Undead Princess" for a card that is about to be put onto the field
  // is a label that describes the wrong move.
  | { kind: 'chooseFromDeck'; player: PlayerId; min: number; max: number; count: number; filter?: TargetFilter; to: 'hand' | 'field' }
export interface GameResult { winner: PlayerId | null; reason: string }   // winner null = draw
export interface GameState {
  rng: Rng
  turn: number                 // 1-based; 0 during setup
  turnPlayer: PlayerId
  firstPlayer: PlayerId
  phase: Phase
  attack: AttackState | null   // non-null only while phase === 'attack'
  priority: PlayerId           // CR §11.1 priority holder. MVP0-SIMPLIFICATION: always the turn player (no stack, no passing)
  pending: Pending | null      // a decision owed by `pending.player`; takes precedence over priority for who acts
  /** Ability work the engine owes itself (spec C1-3). `pending` stays the ONE visible decision; this is the queue behind it. */
  resolution: Resolution
  players: [PlayerState, PlayerState]
  cards: Record<CardId, CardInstance>
  /**
   * Who KNOWS what a hidden card is (spec C9-5) — a bitmask per card, bit `p` set when player `p` has
   * legitimately seen it. Absent means nobody beyond the ordinary rules (your own hand is knowledge you have
   * by holding it, and is not recorded here).
   *
   * This exists because knowledge OUTLIVES the moment it was gained. After Reeve looks at three cards and
   * puts two on the bottom, its controller still knows what is down there, and no zone records that. It also
   * has to express "unknown to me, known to them", which is what a root determinisation must preserve about
   * an opponent who has looked at their own deck: the sampler may invent those cards freely, but it must not
   * forget that the opponent is not guessing.
   */
  knownBy: Record<CardId, number>
  defs: Record<string, CardDef>
  result: GameResult | null
}
export const HAND_SIZE_LIMIT = 5      // §9.5.1.2
export const MAX_BACKUPS = 5          // §7.7.4
export const DAMAGE_TO_LOSE = 7       // §3.1.1
export function defOf(state: GameState, id: CardId): CardDef {
  const inst = state.cards[id]
  if (!inst) throw new Error(`unknown card id ${id}`)
  const def = state.defs[inst.code]
  if (!def) throw new Error(`unknown card code ${inst.code}`)
  return def
}

export function findFieldCard(state: GameState, id: CardId) {
  for (const owner of [0, 1] as const) {
    for (const zone of ['forwards', 'backups'] as const) {
      const card = state.players[owner][zone].find((c) => c.id === id)
      if (card) return { owner, zone, card }
    }
  }
  return null
}

/**
 * THE single power authority (spec C1-7). Nothing may add `powerBonus` anywhere else — `powerOf` delegates here,
 * and the web board imports it so a pumped Forward displays the power combat actually uses.
 * Power floors at 0: a −9000 debuff on a 3000-power Forward deals no negative damage, it is put into the Break
 * Zone by the §12.4.4 zero-power rule process instead.
 */
export function effectivePower(def: CardDef, card: FieldCard): number {
  return Math.max(0, (def.power ?? 0) + card.powerBonus)
}

export function powerOf(state: GameState, card: FieldCard): number {
  return effectivePower(defOf(state, card.id), card)
}

export function keywordsOf(state: GameState, card: FieldCard): Set<Keyword> {
  return new Set([...defOf(state, card.id).keywords, ...card.granted])
}

export function updatePlayer(state: GameState, p: PlayerId, f: (ps: PlayerState) => PlayerState): GameState {
  const players: [PlayerState, PlayerState] = [state.players[0], state.players[1]]
  players[p] = f(state.players[p])
  return { ...state, players }
}

/** The bit for one player in a `knownBy` mask. */
export const knowsBit = (p: PlayerId): number => 1 << p

/** Does `p` know what card `id` is? Cards in `p`'s OWN hand are known by holding them, not by this mask. */
export function knows(state: GameState, p: PlayerId, id: CardId): boolean {
  return ((state.knownBy[id] ?? 0) & knowsBit(p)) !== 0
}

/** Record that each of `ids` is now known to every player in `to`. Additive: knowledge is never lost. */
export function learn(state: GameState, to: readonly PlayerId[], ids: readonly CardId[]): GameState {
  if (!ids.length || !to.length) return state
  const mask = to.reduce<number>((m, p) => m | knowsBit(p), 0)
  const knownBy = { ...state.knownBy }
  for (const id of ids) knownBy[id] = (knownBy[id] ?? 0) | mask
  return { ...state, knownBy }
}

/**
 * Forget everything anyone knew about `ids` — a shuffle destroys positional knowledge (§8.1.2).
 *
 * Deliberately NOT called when a card merely moves: knowing what a card IS survives it going to the bottom of
 * the deck, which is the whole reason this mask exists rather than a per-zone flag.
 */
export function forget(state: GameState, ids: readonly CardId[]): GameState {
  if (!ids.length) return state
  const knownBy = { ...state.knownBy }
  for (const id of ids) delete knownBy[id]
  return { ...state, knownBy }
}
