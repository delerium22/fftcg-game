import type { Rng } from './rng.js'
import type { PlayerId, CardDef, Keyword } from './types.js'

export type CardId = number
export interface CardInstance { id: CardId; code: string; owner: PlayerId }
export type Status = 'active' | 'dull'
export interface FieldCard { id: CardId; status: Status; damage: number; enteredTurn: number; attackedThisTurn: boolean; granted: Keyword[] }
export interface PlayerState {
  deck: CardId[]        // index 0 = top
  hand: CardId[]
  forwards: FieldCard[]
  backups: FieldCard[]
  damageZone: CardId[]
  breakZone: CardId[]
  mulliganDecided: boolean
}
export type Phase = 'setup' | 'active' | 'draw' | 'main1' | 'attack' | 'main2' | 'end'
export type AttackStep = 'preparation' | 'declaration' | 'block' | 'damage'
export interface AttackState { step: AttackStep; attackers: CardId[]; blocker: CardId | null }
/** Decisions owed by a specific player that are NOT priority actions (§11.1): setup choices and the defender's step actions in the Attack Phase. */
export type Pending =
  | { kind: 'chooseFirst'; player: PlayerId }
  | { kind: 'mulligan'; player: PlayerId }
  | { kind: 'discardToHandSize'; player: PlayerId; count: number }
  | { kind: 'declareBlock'; player: PlayerId }          // §10.1.3.1
  | { kind: 'assignPartyDamage'; player: PlayerId }     // §10.1.4.2.1
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
  players: [PlayerState, PlayerState]
  cards: Record<CardId, CardInstance>
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

export function powerOf(state: GameState, card: FieldCard): number {
  return defOf(state, card.id).power ?? 0
}

export function keywordsOf(state: GameState, card: FieldCard): Set<Keyword> {
  return new Set([...defOf(state, card.id).keywords, ...card.granted])
}

export function updatePlayer(state: GameState, p: PlayerId, f: (ps: PlayerState) => PlayerState): GameState {
  const players: [PlayerState, PlayerState] = [state.players[0], state.players[1]]
  players[p] = f(state.players[p])
  return { ...state, players }
}
