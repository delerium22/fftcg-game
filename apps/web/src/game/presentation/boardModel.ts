import type { AttackStep, CardId, CardType, Element, FieldCard, FieldFlag, GameResult, Keyword, Pending, Phase, PlayerId, PlayerView } from '@fftcg/engine'
import { displayName, fieldCardDisplay, stackItemLabel, stateShim } from '../commands.js'

/**
 * The render projection (UI overhaul spec section 4.1): a flat model of everything the board SHOWS, computed from a
 * complete `PlayerView`. The board draws its zones and seats from this; U3's director diffs two of them, one per side of
 * an apply, and releases the differences beat by beat.
 *
 * Why a model and not the view: several displayed values are COMPUTED — a Forward's power runs the continuous-effect
 * layer over the whole field through `stateShim`, and a name's occurrence marker ("Luso (2)") counts copies across
 * zones. Both are correct only on a complete, real view; on a half-applied one they are wrong or throw. So every such
 * value is computed here, once, and a record never needs another record to render.
 *
 * Only what the human's view carries: an id the view does not carry never appears (ids follow decklist order, so a
 * hidden id would name the card).
 */
export type ZoneKey = 'hand' | 'forwards' | 'backups' | 'lbDeck' | 'knownHand' | 'breakZone' | 'damageZone' | 'removedFromGame' | 'elsewhere'

/** The display half of `CardProps`: everything a card SHOWS, nothing about what pressing it does. */
export interface CardFace {
  code: string; name: string; cost: number; elements: Element[]; type: CardType; power: number | null
  powerBonus?: number; granted?: readonly Keyword[]; flags?: readonly FieldFlag[]
  damage?: number; dull?: boolean; frozen?: boolean; text?: string
}

export interface CardModel {
  id: CardId
  /** Whose side of the table the card is on (the owner for a card in no zone). */
  side: PlayerId
  zone: ZoneKey
  /** Position in its zone; 0 for `elsewhere`. */
  index: number
  face: CardFace
  /** Only for a card in an LB deck: turned face up (spent) or not. From the zone, never from `view.cards`. */
  lbFaceUp?: boolean
}

export interface SeatModel {
  deckCount: number
  handCount: number
  forwards: CardId[]
  backups: CardId[]
  lbDeck: CardId[]
  knownHand: CardId[]
  breakZone: CardId[]
  damageZone: CardId[]
  removedFromGame: CardId[]
}

/**
 * One stack entry (spec section 4.3), keyed so U3 can diff the stack as inserts and removes: a Summon by its card, an
 * ability by source and clause, with an occurrence count for the rare same ability twice. Bottom first.
 */
export interface StackEntryModel {
  key: string
  kind: 'summon' | 'ability'
  /** The Summon card, or the ability's source. */
  card: CardId
  controller: PlayerId
  label: string
}

export interface BoardModel {
  cards: Record<CardId, CardModel>
  hand: CardId[]
  seats: [SeatModel, SeatModel]
  stack: StackEntryModel[]
  /** Whose seat is highlighted: holds priority or owes the pending decision. */
  active: [boolean, boolean]
  turn: number
  turnPlayer: PlayerId
  phase: Phase
  attackStep: AttackStep | null
  priority: PlayerId
  pending: { kind: Pending['kind']; player: PlayerId } | null
  result: GameResult | null
}

const SEATS = [0, 1] as const

/** The face every card that is not on the field shows: its printing, named as the view names it. */
function printedFace(v: PlayerView, id: CardId): CardFace {
  const inst = v.cards[id]
  const d = inst ? v.defs[inst.code] : undefined
  return {
    code: d?.code ?? '?', name: displayName(v, id), cost: d?.cost ?? 0, elements: d?.elements ?? [], type: d?.type ?? 'forward',
    power: d?.power ?? null,
    ...(d?.text === undefined ? {} : { text: d.text }),
  }
}

/** A field card's face: layered power, keywords and flags through the engine's readers, and its board state. */
function fieldFace(v: PlayerView, c: FieldCard, shim: ReturnType<typeof stateShim>): CardFace {
  const shown = fieldCardDisplay(v, c, shim)
  return {
    ...printedFace(v, c.id),
    power: shown.power, powerBonus: shown.powerBonus, granted: shown.granted, flags: shown.flags,
    damage: c.damage, dull: c.status === 'dull', frozen: c.frozen === true,
  }
}

export function project(v: PlayerView): BoardModel {
  // One shim for every field card — the engine's readers want a GameState, built once from the whole view.
  const shim = stateShim(v)
  const cards: Record<CardId, CardModel> = {}
  const put = (id: CardId, side: PlayerId, zone: ZoneKey, index: number, face: CardFace, lbFaceUp?: boolean): void => {
    cards[id] = { id, side, zone, index, face, ...(lbFaceUp === undefined ? {} : { lbFaceUp }) }
  }
  v.hand.forEach((id, i) => put(id, v.me, 'hand', i, printedFace(v, id)))
  const seats = SEATS.map((p): SeatModel => {
    const f = v.fields[p]
    f.forwards.forEach((c, i) => put(c.id, p, 'forwards', i, fieldFace(v, c, shim)))
    f.backups.forEach((c, i) => put(c.id, p, 'backups', i, fieldFace(v, c, shim)))
    f.lbDeck.forEach((x, i) => put(x.id, p, 'lbDeck', i, printedFace(v, x.id), x.faceUp))
    f.knownHand.forEach((id, i) => put(id, p, 'knownHand', i, printedFace(v, id)))
    f.breakZone.forEach((id, i) => put(id, p, 'breakZone', i, printedFace(v, id)))
    f.damageZone.forEach((id, i) => put(id, p, 'damageZone', i, printedFace(v, id)))
    f.removedFromGame.forEach((id, i) => put(id, p, 'removedFromGame', i, printedFace(v, id)))
    return {
      deckCount: f.deck.length, handCount: p === v.me ? v.hand.length : f.handCount,
      forwards: f.forwards.map((c) => c.id), backups: f.backups.map((c) => c.id), lbDeck: f.lbDeck.map((x) => x.id),
      knownHand: [...f.knownHand], breakZone: [...f.breakZone], damageZone: [...f.damageZone], removedFromGame: [...f.removedFromGame],
    }
  }) as [SeatModel, SeatModel]
  // Every other card the view carries — a revealed deck card, a Summon on the stack, a pending candidate — so the
  // orphan row and the sheet can still draw it (Review Focus 1).
  for (const key of Object.keys(v.cards)) {
    const id = Number(key) as CardId
    const inst = v.cards[id]
    if (cards[id] === undefined && inst) put(id, inst.owner, 'elsewhere', 0, printedFace(v, id))
  }
  const owes = (p: PlayerId): boolean => v.priority === p || v.pending?.player === p
  const seen = new Map<string, number>()
  const stack = v.stack.map((item): StackEntryModel => {
    const card = item.kind === 'summon' ? item.card : item.frame.source
    const controller = item.kind === 'summon' ? item.controller : item.frame.controller
    const base = item.kind === 'summon' ? `s:${card}` : `a:${card}:${item.frame.abilityId}`
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    return { key: n === 0 ? base : `${base}#${n}`, kind: item.kind, card, controller, label: stackItemLabel(v, item) }
  })
  return {
    cards, hand: [...v.hand], seats, stack, active: [owes(0), owes(1)],
    turn: v.turn, turnPlayer: v.turnPlayer, phase: v.phase, attackStep: v.attack?.step ?? null,
    priority: v.priority, pending: v.pending ? { kind: v.pending.kind, player: v.pending.player } : null, result: v.result,
  }
}
