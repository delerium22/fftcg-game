import type { CardDef, PlayerId } from './types.js'
import { opponentOf } from './types.js'
import type { AttackState, CardId, CardInstance, FieldCard, GameResult, GameState, LbCard, Pending, Phase, StackItem } from './state.js'
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
  /**
   * Rung J8 (spec J8-D5): BOTH LB decks, identities and face state, for either viewer. A deliberate deviation
   * from §7.14.2 (a face-down card is its owner's to see): this app plays open decklists (spec B4), so the
   * face-down SET is exactly the list minus the face-up and the cast cards, and which face-down card is which
   * has no meaning the rules give it (the owner chooses any). Nothing a real opponent lacks is created.
   */
  lbDeck: readonly LbCard[]
  /** One entry per card, top first. Replaces a bare count: the count is `deck.length`. */
  deck: DeckSlot[]
  handCount: number
  /**
   * Rung V1-E (E-D1): the cards in THIS player's hand the viewer knows — revealed by a search (§15.1.1.8.1) or by
   * Miner, or returned from a public zone — in hand order. Empty for the viewer's own seat, whose hand is `hand`.
   * The rest of the hand stays a count: a card the viewer does not know is never named.
   */
  knownHand: CardId[]
  /**
   * Public (spec C10-2): the Break Zone is public and everyone saw the card leave the field, so this is
   * unredacted for both seats. It is on the view because `determinise` rebuilds `PlayerState` field by
   * field — without it a simulated world forgets what its own Break Zone did this turn and offers, or
   * refuses, an ability the real game would not.
   */
  putIntoBreakZoneFromFieldThisTurn: readonly CardId[]
}
export interface PlayerView {
  me: PlayerId; turn: number; turnPlayer: PlayerId; phase: Phase; attack: AttackState | null; priority: PlayerId
  pending: Pending | null; result: GameResult | null; hand: CardId[]; fields: [FieldView, FieldView]
  /** Carried so `determinise` can rebuild the SAME agenda: the AI must simulate the ability game it is playing (spec C1-2/C1-A6). Every id in it is already public. */
  resolution: Resolution
  /** The stack and the forfeit count (rung J1), public (§7.12.2) and carried verbatim for the same reason as `resolution`. */
  stack: readonly StackItem[]
  passes: 0 | 1
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
    return { forwards: ps.forwards, backups: ps.backups, damageZone: ps.damageZone, breakZone: ps.breakZone, removedFromGame: ps.removedFromGame, lbDeck: ps.lbDeck, deck: deckSlotsFor(state, p, me), handCount: ps.hand.length, knownHand: knownHandFor(state, p, me), putIntoBreakZoneFromFieldThisTurn: ps.putIntoBreakZoneFromFieldThisTurn }
  }
  const visibleIds = new Set<CardId>(state.players[me].hand)
  for (const p of [0, 1] as const) {
    const ps = state.players[p]
    for (const c of ps.forwards) visibleIds.add(c.id)
    for (const c of ps.backups) visibleIds.add(c.id)
    for (const id of ps.damageZone) visibleIds.add(id)
    for (const id of ps.breakZone) visibleIds.add(id)
    for (const id of ps.removedFromGame) visibleIds.add(id)   // public, and visible to BOTH players (spec C7-1)
    for (const x of ps.lbDeck) visibleIds.add(x.id)             // rung J8-D5: both LB decks, open lists
    // Deck cards this viewer has legitimately seen (spec C9-5) — their instances must be in `cards`, or the
    // id in the slot names nothing.
    for (const id of ps.deck) if (knows(state, me, id)) visibleIds.add(id)
    // ...and the other player's hand cards this viewer knows (rung V1-E): the same rule, one zone on. `determinise`
    // pins them into that hand rather than sampling it whole.
    for (const id of knownHandFor(state, p, me)) visibleIds.add(id)
  }
  // A Summon on the stack is in no player zone and is public (§7.12.2): it must be in `cards`, or the stack
  // names an id the view cannot resolve and `determinise` deals its code a second time (rung J1).
  for (const item of state.stack) if (item.kind === 'summon') visibleIds.add(item.card)
  // ...and one still declaring on its way there (rung J1-D5): already off the hand, public since it was cast.
  if (state.resolution.placing?.item.kind === 'summon') visibleIds.add(state.resolution.placing.item.card)
  const cards: Record<CardId, CardInstance> = {}
  for (const id of visibleIds) { const inst = state.cards[id]; if (inst) cards[id] = inst }
  // Rung V1-A2 (spec V1-D11): a select over cards this viewer cannot see — the other player's hand — keeps its bounds
  // and loses its candidates, whoever owes it. The ids alone would say which cards in that hand match the filter.
  // Keyed on the ZONE as well as on visibility (rung V1-E, R1): a known hand card is visible now, and a select whose
  // candidates were all known ones would otherwise show them — and so say that every unknown card fails the filter.
  const pending: Pending | null = state.pending?.kind === 'chooseTargets' && state.pending.candidates.some((id) => !visibleIds.has(id) || state.players[opponentOf(me)].hand.includes(id))
    ? { ...state.pending, candidates: [], hidden: true } : state.pending
  return structuredClone({
    me, turn: state.turn, turnPlayer: state.turnPlayer, phase: state.phase, attack: state.attack, priority: state.priority,
    pending, resolution: state.resolution, stack: state.stack, passes: state.passes, result: state.result, hand: state.players[me].hand, fields: [field(0), field(1)], cards, knownBy: visibleKnownBy(state, cards), defs: state.defs,
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
 * The cards in `owner`'s hand that `viewer` knows (rung V1-E, E-D1) — none for the viewer's own hand, which the view
 * carries whole as `hand`.
 *
 * EXPORTED for the reason `deckSlotsFor` is: `searchView` is the second copy of this projection.
 */
export function knownHandFor(state: GameState, owner: PlayerId, viewer: PlayerId): CardId[] {
  if (owner === viewer) return []
  return state.players[owner].hand.filter((id) => knows(state, viewer, id))
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
