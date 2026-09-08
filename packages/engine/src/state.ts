import type { Rng } from './rng.js'
import type { PlayerId, CardDef, Keyword } from './types.js'
import type { FieldFlag, Frame, Resolution, TargetFilter } from './abilities.js'
import { layerFor } from './layer.js'

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
  /**
   * Ability ids this INSTANCE has activated this turn, for `oncePerTurn` (spec C10-1).
   *
   * On the FieldCard rather than the player: "you can only use this ability once per turn" limits the
   * ability of that card object, so two copies have separate allowances — and under CR §7.4 a card that
   * leaves the field and comes back is a NEW object in the destination zone, which a fresh `FieldCard`
   * models for free. Cleared with the other per-turn flags in the End Phase.
   */
  usedThisTurn: readonly string[]
}
export interface PlayerState {
  deck: CardId[]        // index 0 = top
  hand: CardId[]
  /**
   * Cards that moved FIELD → Break Zone under this player's control this turn (spec C10-2), for Sphene's
   * "put in your Break Zone from the field during this turn".
   *
   * NOT "broken": a card paid there as a cost is expressly not a break (CR §15.1.1.3.2, and this engine
   * already distinguishes `reason: 'cost'` from `'ability'`), but the printed text says "put … from the
   * field" and admits both. Recorded in `enqueueZoneChangeTriggers`, the one function every field → Break
   * Zone path already calls, and PRUNED when a card leaves the Break Zone — a card that goes Break Zone →
   * hand → Break Zone in one turn is a new object under CR §7.4 and is not retrievable again.
   *
   * Public: the Break Zone is public and everyone saw the card leave the field, so nothing is redacted.
   */
  putIntoBreakZoneFromFieldThisTurn: CardId[]
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
/**
 * One thing on the stack (rung J1, CR §7.12). A Summon is the CARD — it sits here, in no player zone, from
 * casting until it resolves (§11.3.2, §11.11.10) — with zero or more `summonResolve` frames to run; an
 * ability is its frame. The top of the stack is the LAST element, and it stays there while it resolves,
 * prompts included, so a suspended Summon is never in no zone at all.
 */
export type StackItem =
  | { readonly kind: 'summon'; readonly card: CardId; readonly controller: PlayerId; readonly frames: readonly Frame[] }
  | { readonly kind: 'ability'; readonly frame: Frame }

export type Phase = 'setup' | 'active' | 'draw' | 'main1' | 'attack' | 'main2' | 'end'
/**
 * The Attack Phase as six states (rung J1-D10, CR §10.1). Four are WINDOWS in which priority is held —
 * `preparation` (§10.1.1.2), `declared` (§10.1.2.6), `blocked` (§10.1.3.6) and `damage` (§10.1.4.4, after the
 * damage is dealt) — and two are decisions: `declaration` (the turn player attacks or passes to Main Phase 2)
 * and `block` (the defender owes `declareBlock`).
 */
export type AttackStep = 'preparation' | 'declaration' | 'declared' | 'block' | 'blocked' | 'damage'
export interface AttackState { step: AttackStep; attackers: CardId[]; blocker: CardId | null }
/** Decisions owed by a specific player that are NOT priority actions (§11.1): setup choices, the defender's step actions in the Attack Phase, and the choices an ability suspends on (spec C1-6). */
export type Pending =
  | { kind: 'chooseFirst'; player: PlayerId }
  | { kind: 'mulligan'; player: PlayerId }
  | { kind: 'discardToHandSize'; player: PlayerId; count: number }
  /** §12.4.8 (rung J4): this player controls more than five Backups and must put `count` of them into the Break Zone. */
  | { kind: 'breakExcessBackups'; player: PlayerId; count: number }
  | { kind: 'declareBlock'; player: PlayerId }          // §10.1.3.1
  | { kind: 'assignPartyDamage'; player: PlayerId }     // §10.1.4.2.1
  /**
   * Rung G3, §11.10: a card printing EX BURST was just dealt as damage, and its owner may use the marked
   * clause. `card` is the damage card and `abilityId` the clause that would run.
   *
   * PRE-FRAME, and that is the whole reason it is its own kind. Every other ability pending here is a
   * projection of a suspended `resolution.active` frame — `applyChooseMode` even requires the frame's current
   * AST node to be `chooseModes` — whereas this is asked BEFORE any frame exists, to decide whether one
   * should. It therefore stays out of the invariant pairing ability pendings with an active frame, or every
   * offer would report as an orphan.
   *
   * Nor can Noel's `min: 0` stand in for it: "use the clause and choose no targets" is a different answer from
   * "decline the burst", and the log has to be able to tell them apart.
   *
   * Naming the card leaks nothing — a damage zone is public (§7.8.2) and `viewFor` already shows every card in
   * both players'. The reveal happens BEFORE the offer for exactly that reason.
   */
  | { kind: 'chooseExBurst'; player: PlayerId; card: CardId; abilityId: string }
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
  //
  // `scope` is the SEMANTIC shape of the look — a whole-deck search or a top-N peek. It is carried for the same
  // reason `to` is: it cannot be recovered downstream. The UI read `count === deck.length` as "a search", which
  // is equally true of a top-3 peek at a 3-card deck, so a peek was described as a search on exactly the turns
  // a deck is running out (Codex MAJOR). Mirrors `deckExposed.scope`, and comes from the same `eff.count`.
  | { kind: 'chooseFromDeck'; player: PlayerId; min: number; max: number; count: number; scope: 'deck' | 'top'; filter?: TargetFilter; to: 'hand' | 'field' }
/**
 * How a game ended, as a fact rather than as prose.
 *
 * `reason` is the precise internal string, citation and all — the terminal prints it, and its whole
 * vocabulary is `P0`/`P1`, so "player 0 has 7 damage (§12.4.1)" reads correctly there. A browser that says
 * "You" everywhere else must not show it to the person who just lost, and it cannot rewrite it either:
 * `cause` exists because the ending is NOT recoverable from the final position. A loser sitting on seven
 * damage with an empty deck could have arrived by §12.4.1, §3.1.3 or §3.1.2, and a concede leaves no trace
 * in the state at all.
 *
 * Discriminated so the impossible combinations cannot be written. A draw is exactly `bothReachedSeven`
 * (§3.3, simultaneous defeat), and every other ending has exactly one winner — which is what makes
 * `opponentOf(winner)` sound for naming the loser, and why it is never called on the draw.
 */
export type GameEndCause = 'damage' | 'concede' | 'deckOut' | 'damageWithEmptyDeck' | 'bothReachedSeven'
export type GameResult =
  | { winner: PlayerId; cause: Exclude<GameEndCause, 'bothReachedSeven'>; reason: string }
  | { winner: null; cause: 'bothReachedSeven'; reason: string }
export interface GameState {
  rng: Rng
  turn: number                 // 1-based; 0 during setup
  turnPlayer: PlayerId
  firstPlayer: PlayerId
  phase: Phase
  attack: AttackState | null   // non-null only while phase === 'attack'
  /** CR §11.1 priority holder (rung J1): either player, handed over by a forfeit (`applyPass`) or an action. */
  priority: PlayerId
  /** Consecutive forfeits of priority (§11.1.7): 0, or 1 after one player has passed and the other now holds it. */
  passes: 0 | 1
  /** The stack (§7.12), top LAST. Public. Empty until J1's slice 3 places anything on it. */
  stack: readonly StackItem[]
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
 * THE single power authority (spec C1-7, rung J6): printed power, plus the until-end-of-turn stamp
 * (`powerBonus`, §11.12.4.2), plus what the field abilities in play add through the layer (§11.12.4.4–5).
 * Nothing may read `powerBonus` anywhere else — `powerOf` delegates here, and the web board reads through it
 * (via `stateShim`) so a pumped Forward displays the power combat actually uses.
 * Power floors at 0: a −9000 debuff on a 3000-power Forward deals no negative damage, it is put into the Break
 * Zone by the §12.4.4 zero-power rule process instead.
 */
export function effectivePower(state: GameState, card: FieldCard): number {
  const def = defOf(state, card.id)
  return Math.max(0, (def.power ?? 0) + card.powerBonus + layerFor(state, card, controllerOf(state, card)).power)
}

export function powerOf(state: GameState, card: FieldCard): number {
  return effectivePower(state, card)
}

/** Printed keywords, plus the granted stamps, plus the layer (rung J6). The ONE keyword authority. */
export function keywordsOf(state: GameState, card: FieldCard): Set<Keyword> {
  return new Set([...defOf(state, card.id).keywords, ...card.granted, ...layerFor(state, card, controllerOf(state, card)).keywords])
}

/** The flag stamps plus the layer (rung J6). The ONE flag authority — `cannotBeBroken` is asked here, nowhere else. */
export function flagsOf(state: GameState, card: FieldCard): Set<FieldFlag> {
  return new Set([...card.flags, ...layerFor(state, card, controllerOf(state, card)).flags])
}

/** Whose field a card sits on — the layer's scopes are relative to the source's controller. Falls back to the owner. */
function controllerOf(state: GameState, card: FieldCard): PlayerId {
  for (const p of [0, 1] as const) {
    const ps = state.players[p]
    if (ps.forwards.some((c) => c.id === card.id) || ps.backups.some((c) => c.id === card.id)) return p
  }
  return state.cards[card.id]?.owner ?? 0
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
