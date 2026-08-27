import type { CardDef, PlayerId } from './types.js'
import type { AttackState, CardId, CardInstance, FieldCard, GameResult, GameState, Pending, Phase } from './state.js'
import { knows, knowsBit } from './state.js'
import type { Resolution } from './abilities.js'

/**
 * One deck position, as this viewer sees it (spec C9-5).
 *
 * `card` is non-null ONLY when this viewer knows what is there; `knownBy` is the full mask either way. The
 * two are separate because the interesting state is "unknown to me, KNOWN TO THEM": after an opponent looks
 * at their own top three you cannot name those cards, but you do know they are not guessing, and a
 * determinisation that forgot it would model an opponent who had never looked.
 */
export interface DeckSlot { card: CardId | null; knownBy: number }

export interface FieldView {
  forwards: FieldCard[]; backups: FieldCard[]; damageZone: CardId[]; breakZone: CardId[]; removedFromGame: CardId[]
  /** One entry per card, top first. Replaces a bare count: the count is `deck.length`. */
  deck: DeckSlot[]
  handCount: number
}
export interface PlayerView {
  me: PlayerId; turn: number; turnPlayer: PlayerId; phase: Phase; attack: AttackState | null; priority: PlayerId
  pending: Pending | null; result: GameResult | null; hand: CardId[]; fields: [FieldView, FieldView]
  /** Carried so `determinise` can rebuild the SAME agenda: the AI must simulate the ability game it is playing (spec C1-2/C1-A6). Every id in it is already public. */
  resolution: Resolution
  cards: Record<CardId, CardInstance>; defs: Record<string, CardDef>
  /**
   * Who knows what, for the cards this view can see at all (spec C9-5). Restricted to keys present in
   * `cards`: a mask for a card whose id the viewer cannot see would be an id leak by itself.
   *
   * NOT yet able to express "the opponent knows their own top three, and you know that they do". That is
   * POSITIONAL knowledge about cards this viewer cannot see, so it needs a per-deck-position projection
   * rather than a per-id mask. It is deferred to the stage that lands Reeve, which is the first clause to
   * create it — recorded here so the gap is a decision rather than an oversight.
   */
  knownBy: Record<CardId, number>
  firstPlayer: PlayerId /* meaningful once chooseFirst has been decided; before that it is the setup default 0 */
  mulliganDecided: [boolean, boolean]
}

export function viewFor(state: GameState, me: PlayerId): PlayerView {
  const field = (p: PlayerId): FieldView => {
    const ps = state.players[p]
    return { forwards: ps.forwards, backups: ps.backups, damageZone: ps.damageZone, breakZone: ps.breakZone, removedFromGame: ps.removedFromGame, deck: deckSlotsFor(state, p, me), handCount: ps.hand.length }
  }
  const visibleIds = new Set<CardId>(state.players[me].hand)
  for (const p of [0, 1] as const) {
    const ps = state.players[p]
    for (const c of ps.forwards) visibleIds.add(c.id)
    for (const c of ps.backups) visibleIds.add(c.id)
    for (const id of ps.damageZone) visibleIds.add(id)
    for (const id of ps.breakZone) visibleIds.add(id)
    for (const id of ps.removedFromGame) visibleIds.add(id)   // public, and visible to BOTH players (spec C7-1)
    // Deck cards this viewer has legitimately seen (spec C9-5) — their instances must be in `cards`, or the
    // id in the slot names nothing.
    //
    // MVP0-SIMPLIFICATION (spec C9): knowledge is tracked for DECK positions only. A card publicly revealed by
    // Miner and then added to its controller's hand stays flagged in `knownBy`, but is deliberately NOT surfaced
    // here, so the opponent forgets it — where a real player would keep tracking it. Showing it would require
    // `determinise` to pin a known code into an opponent HAND slot (it samples the whole hand from the unseen
    // multiset today), which is its own rung. The error runs in the safe direction: the view never shows a card
    // it should hide, it only fails to remember one it could have shown.
    for (const id of ps.deck) if (knows(state, me, id)) visibleIds.add(id)
  }
  const cards: Record<CardId, CardInstance> = {}
  for (const id of visibleIds) { const inst = state.cards[id]; if (inst) cards[id] = inst }
  return structuredClone({
    me, turn: state.turn, turnPlayer: state.turnPlayer, phase: state.phase, attack: state.attack, priority: state.priority,
    pending: state.pending, resolution: state.resolution, result: state.result, hand: state.players[me].hand, fields: [field(0), field(1)], cards, knownBy: visibleKnownBy(state, cards), defs: state.defs,
    firstPlayer: state.firstPlayer, mulliganDecided: [state.players[0].mulliganDecided, state.players[1].mulliganDecided],
  })
}

/**
 * The `knownBy` entries for cards this view actually carries. See `PlayerView.knownBy`.
 *
 * EXPORTED so `searchView` — the search's copy of this projection — calls it rather than reimplementing it.
 * C7 added a zone to that copy's FieldView and not to its visible-cards loop, and the two silently diverged;
 * one shared function is the fix that does not depend on remembering.
 */
export function visibleKnownBy(state: GameState, cards: Record<CardId, CardInstance>): Record<CardId, number> {
  const out: Record<CardId, number> = {}
  for (const key of Object.keys(cards)) {
    const id = Number(key)
    const mask = state.knownBy[id]
    if (mask !== undefined && mask !== 0) out[id] = mask
  }
  return out
}

/**
 * The cards `picks` names in `player`'s deck, as this view sees them — or `null` when the viewer cannot see
 * every one of them and the answer must be given as a count instead.
 *
 * Here rather than in a renderer because BOTH renderers need it and both got it wrong the same two ways
 * (spec C9): they indexed the VIEWER's deck instead of the CHOOSER's, which names the wrong player's cards
 * outright, and they named a card the viewer had never been shown. The wording around it — "Take" versus
 * "Play … onto the field", and how each app spells a card name — stays with the renderer; the rule about
 * which cards a set of picks actually names does not.
 */
export function pickedDeckCards(view: PlayerView, player: PlayerId, picks: readonly number[]): CardId[] | null {
  const slots = view.fields[player].deck
  const out: CardId[] = []
  for (const i of picks) {
    const card = slots[i]?.card
    if (card === null || card === undefined) return null
    out.push(card)
  }
  return out
}

/**
 * One player's deck as `viewer` sees it (spec C9-5).
 *
 * EXPORTED for the same reason `visibleKnownBy` is: `searchView` is a second copy of this projection, and a
 * field added to one and not the other is how C7's zone silently diverged. One function, two callers.
 */
export function deckSlotsFor(state: GameState, owner: PlayerId, viewer: PlayerId): DeckSlot[] {
  return state.players[owner].deck.map((id) => {
    const mask = state.knownBy[id] ?? 0
    // The id is exposed only to a viewer who knows it. `knownBy` is exposed to everyone: that a player looked
    // is public even when what they saw is not, and it is the half a determinisation must preserve.
    return { card: (mask & knowsBit(viewer)) !== 0 ? id : null, knownBy: mask }
  })
}
