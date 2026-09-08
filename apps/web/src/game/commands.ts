import {
  HAND_SIZE_LIMIT, abilityCpRequirement, castBlocker, describeAbilityCost, describeAbilityEffect, effectAtPath, effectivePower, pickedDeckCards, seedRng,
  type Ability, type CardDef, type CardId, type Command, type Effect, type FieldCard, type FieldFlag, type Frame,
  type GameResult, type GameState, type Keyword, type Payment, type Pending, type PlayerId, type PlayerState, type PlayerView,
  type ZoneTransitionReason, type CastBlocker,
} from '@fftcg/engine'
import { preferredPayment, preferredPaymentFor } from '@fftcg/ai'
import type { Choice, ChoiceSet } from './types.js'

const PHASE_LABEL: Record<string, string> = {
  setup: 'Setup', active: 'Active Phase', draw: 'Draw Phase',
  main1: 'Main Phase 1', attack: 'Attack Phase', main2: 'Main Phase 2', end: 'End Phase',
}

const KEYWORD_LABEL: Record<Keyword, string> = { haste: 'Haste', brave: 'Brave', firstStrike: 'First Strike', backAttack: 'Back Attack' }
const FLAG_PURPOSE: Record<FieldFlag, string> = {
  cannotBeBroken: 'to protect from being broken',
  cannotBeReturnedByOpponent: "to protect from the opponent's return effects",
}
const signed = (n: number): string => (n >= 0 ? `+${n}` : `${n}`)
const only = <T,>(s: Set<T>): T | null => (s.size === 1 ? ([...s][0] as T) : null)

function defFor(v: PlayerView, id: CardId): CardDef | undefined {
  const code = v.cards[id]?.code
  return code === undefined ? undefined : v.defs[code]
}

/** Card names only — the board already shows the art and the id, so the CLI's `Name (CODE)` is noise in a GUI. */
function bareName(v: PlayerView, id: CardId): string {
  return defFor(v, id)?.name ?? v.cards[id]?.code ?? `#${id}`
}

/**
 * The card's name, qualified with whose it is when another VISIBLE card of the same name belongs to the
 * other player.
 *
 * Both seats play the same deck, so a mirror is the normal case, not an exotic one. Found by playing twice
 * over. The first time it was a choice — "Give Haste to Shantotto" with a Shantotto on each side. The second
 * time was worse, because it was combat:
 *
 *   Billy Bob deals 8000 damage to Billy Bob
 *   Billy Bob deals 8000 damage to Billy Bob
 *   Billy Bob is broken
 *   Billy Bob is broken
 *
 * Four lines, and no way to know which Billy Bob died. That case is also why this looks past the FIELDS, as
 * the first version did not: by the time a break is narrated the card has left the field for the Break Zone,
 * so a field-only rule goes quiet exactly when the player most needs it.
 *
 * A twin counts when it is on the TABLE — the other player's forwards, backups or Break Zone. All three are
 * public and available to narration (the Break Zone is shown as a count, not as cards, but its contents are
 * not secret). Hands and decks are excluded because their contents are hidden or irrelevant to a board
 * label; the damage zone and the removed-from-game pile are excluded because they are inert and permanent,
 * and counting them would qualify a card for the rest of the game to no purpose.
 *
 * KNOWN LIMIT: this keys on `owner`, which is sound only because nothing in this pool changes control, so a
 * card's owner and its holder always agree. A card that could steal a Forward would break it two ways —
 * `possessive` would say "your Forward" for one the opponent controls, and two copies owned by one player
 * but split across the fields would both qualify the same way, resolving nothing. Fixing that needs the
 * controller ON the event, not a lookup here: events are narrated after the fact, and a stolen Forward is
 * already back in its owner's Break Zone by then.
 */
/**
 * `p`'s side of the TABLE: their two field rows and their Break Zone.
 *
 * Public, game-relevant, and where a card can be confused with another of the same name. Hands and decks are
 * hidden or irrelevant to a board label; the damage zone and the removed pile are inert and permanent, so
 * counting them would qualify a card for the rest of the game to no purpose.
 */
const tableIds = (v: PlayerView, p: PlayerId): CardId[] =>
  [...v.fields[p].forwards.map((c) => c.id), ...v.fields[p].backups.map((c) => c.id), ...v.fields[p].breakZone]

const cardIsOnTable = (v: PlayerView, p: PlayerId, id: CardId): boolean => tableIds(v, p).includes(id)
const namedCardOnTable = (v: PlayerView, p: PlayerId, named: string): boolean =>
  tableIds(v, p).some((id) => bareName(v, id) === named)

/**
 * A card named with the possessive IN the phrase: "your Billy Bob", "the AI's Billy Bob".
 *
 * For a sentence that supplies whose it is ITSELF — a trigger cause, an activation, a cost line. Those must
 * use the bare name, and five call sites each composed `possessive` and `bareName` by hand, in two different
 * capitalisations. One of them then used `qualifiedName` instead and produced "Your your Billy Bob" the
 * moment the AI held a twin in play.
 *
 * Composing it once removes the duplication that caused that; it does NOT make the mistake impossible, and
 * the first draft of this comment overclaimed that it did. These return ordinary strings, so a caller can
 * still write `${'${whose}'} ${'${ownedCard(...)}'}`; preventing it outright would need whole-sentence builders.
 * What it does buy: `bareName` and `possessive` are no longer exported, so there is one obvious way to do it
 * and no half-built pattern inviting the other.
 *
 * Lower case: most uses are mid-sentence. `capitalise` is exported for the ones that start one.
 */
export const ownedCard = (v: PlayerView, owner: PlayerId, id: CardId): string =>
  `${possessive(v, owner)} ${bareName(v, id)}`

/**
 * Which copy this is, when a zone holds more than one card reading the same NAME — 1-based, or `null` when
 * the card is alone under its name where it sits.
 *
 * Two identical cards in hand produced two buttons reading "Discard Luso, Shantotto", and a player could not
 * tell which copy either one acted on. The first plan for this rung was to COLLAPSE them as equivalent. They
 * are not: `knownBy` is per instance and survives movement, so after Miner reveals five cards one copy can be
 * known to the opponent and the other not — discarding the known one is a real decision about what the
 * opponent still knows you hold. Two same-code Forwards likewise differ in damage, status and flags, and two
 * Break Zone copies differ by Sphene's per-instance eligibility.
 *
 * So the player is told which is which, rather than having the choice made for them.
 *
 * Keyed on the printed NAME and not on the code, which is the second half of this rung and was found the same
 * way as the first — by playing. This deck runs BOTH Red Mages, `1-121C` at two CP and `18-069C` at one, three
 * of each; they are different cards that print the same name. Keying on the code called each of them unique
 * and numbered neither, so the strip still offered two buttons reading "Discard Red Mage" for cards that cost
 * different amounts. The label a player reads is the name, so the name is what has to be made unambiguous.
 *
 * The number does not claim the two are the same card — it says which rendered card the button acts on, and
 * the card itself shows the cost. That is the whole guarantee this rung owes.
 *
 * Zone-scoped: a Cloud in hand and a Cloud on the field are already distinguished by everything around them,
 * and numbering across zones would attach "(2)" to cards nothing else in the interface separates.
 *
 * The BREAK ZONE counts as a zone here, and leaving it out was a defect. Billy Bob and Prishe both print
 * "choose 1 Character in your Break Zone" and both are in this deck; a Break Zone routinely holds several
 * cards of one name, so the strip offered "Target Cloud" twice — the exact defect this rung exists to remove.
 * It matters most for the two Red Mages, where the choice is between cards costing one CP and two.
 *
 * KNOWN LIMIT, and it is not small: the Break Zone is rendered as a COUNT, not as cards. So a number there
 * makes the two buttons different from each other, but there is no rendered card for it to point AT, and the
 * E9 ruling asked for an identifier that corresponds to something the player can see. Numbering is the floor,
 * not the fix. The fix is to render the candidates of a Break Zone choice as cards, which is a UI rung of its
 * own and is deliberately NOT smuggled in here.
 *
 * Which is why a Break Zone card is numbered ONLY while the player is being asked to choose among those very
 * cards. Numbering it always put "(1)" into the game log — `the AI's Prishe (1) is broken` — where it is
 * unverifiable noise: the reader cannot see the pile, the position refers to an instant that has passed, and
 * a later line about the same card can carry a different number. An existing test caught that, and the fix is
 * the rule and not the test. A number earns its place when the player can act on it; a hand or field card is
 * rendered, so it is numbered always, and a Break Zone card only when it is on offer.
 */
/**
 * The deck cards this view can actually see — non-empty only during a search or a look.
 *
 * A search names cards the player is choosing between, and this deck runs three Lusos and two Undead
 * Princesses, so Hugh Yurg's whole-deck search offered five commands under two labels: "Play Luso onto the
 * field" three times over. The deck is hidden the rest of the time, so nothing is numbered outside a search.
 */
const visibleDeck = (v: PlayerView, p: PlayerId): CardId[] =>
  v.fields[p].deck.flatMap((slot) => (slot.card === null ? [] : [slot.card]))

/** The zones the player can point at on the board: their hand, and either field. */
function shownZoneOf(v: PlayerView, id: CardId, owner: PlayerId): CardId[] | null {
  if (v.hand.includes(id)) return v.hand
  const field = [...v.fields[owner].forwards, ...v.fields[owner].backups]
  return field.some((c) => c.id === id) ? field.map((c) => c.id) : null
}

/** The zones that are named only INSIDE a choice: the Break Zone (rendered as a count) and the deck. */
function unshownZoneOf(v: PlayerView, id: CardId, owner: PlayerId): CardId[] | null {
  if (v.fields[owner].breakZone.includes(id)) return v.fields[owner].breakZone
  const deck = visibleDeck(v, owner)
  return deck.includes(id) ? deck : null
}

function nthIn(v: PlayerView, id: CardId, zone: CardId[] | null): number | null {
  if (zone === null) return null
  const sameName = zone.filter((other) => bareName(v, other) === bareName(v, id))
  if (sameName.length < 2) return null
  const i = sameName.indexOf(id)
  return i < 0 ? null : i + 1
}

/**
 * Which copy this is among the cards the player can SEE — the number the board renders and the log may use.
 *
 * Deliberately blind to the Break Zone and the deck. Numbering those put "(1)" into the game log — `the AI's
 * Prishe (1) is broken` — where it is unverifiable: the reader cannot see the pile, the position refers to an
 * instant that has passed, and a later line about the same card can carry a different number. An existing
 * test caught that, and the rule changed rather than the expectation.
 *
 * KNOWN LIMIT: a card is narrated from the state AFTER the command, so a card that just left the hand or the
 * field is already in the Break Zone and has lost its number. Discarding two Shantottos at the hand limit
 * therefore reads
 *
 *   Discard Shantotto (1), Shantotto (2)          <- the move line, from the view BEFORE
 *   You discard Shantotto to the hand limit       <- twice, from the view after
 *
 * and two same-name Forwards breaking together read alike the same way. Both lines are true and the move line
 * above them says which cards went, so nothing is misstated; what is lost is which instance each event line
 * concerned. Fixing it means narrating from the pre-command view, which is a change to how events are
 * rendered rather than to how cards are named, so it is not done here.
 */
export function occurrenceOf(v: PlayerView, id: CardId): number | null {
  const owner = v.cards[id]?.owner
  if (v.cards[id]?.code === undefined || owner === undefined) return null
  return nthIn(v, id, shownZoneOf(v, id, owner))
}

/**
 * Which copy this is for the purpose of a BUTTON — the same, plus the Break Zone and the deck.
 *
 * A choice may name cards the board does not draw. Billy Bob and Prishe both print "choose 1 Character in
 * your Break Zone"; Undead Princess's ability is usable while IN the Break Zone, so two copies there offered
 * two identical activations; and Hugh Yurg searches the whole deck, where three Lusos read alike. In each the
 * player is picking between them right now, so the number is the only thing telling the options apart.
 *
 * KNOWN LIMIT, and it is not small: the Break Zone renders as a COUNT and the deck is not rendered at all, so
 * here the number distinguishes the buttons but has no card to point AT. The E9 ruling asked for an
 * identifier corresponding to something visible. This is the floor. Rendering a choice's candidates as cards
 * is the fix, and it is a UI rung of its own rather than something to smuggle in here.
 */
function occurrenceForChoice(v: PlayerView, id: CardId): number | null {
  const owner = v.cards[id]?.owner
  if (v.cards[id]?.code === undefined || owner === undefined) return null
  return nthIn(v, id, shownZoneOf(v, id, owner) ?? unshownZoneOf(v, id, owner))
}

export function qualifiedName(v: PlayerView, id: CardId): string {
  return namedWith(v, id, occurrenceOf(v, id))
}

/**
 * The name to put on a BUTTON: the same as `qualifiedName`, but numbering also in the zones the board does
 * not draw. Every label a player clicks goes through this; narration goes through `qualifiedName`.
 */
export function choiceName(v: PlayerView, id: CardId): string {
  return namedWith(v, id, occurrenceForChoice(v, id))
}

/**
 * The name a rendered CARD shows: the printed name plus E9's occurrence marker, and never the possessive.
 *
 * Three namers now, and the third exists because the first two are both wrong here. A card sitting on the
 * board is not a sentence: "your Hugh Yurg (1)" reads as a label for a card the player is looking at, next to
 * their own Break Zone, where "your" is the one thing never in doubt. The hand and field rows already omitted
 * it — by writing the marker out by hand, in two places, which is how the orphan row came to lack it. One
 * function so a fourth row cannot land without one.
 *
 * The occurrence is the CHOICE-level one, which agrees with `occurrenceOf` for anything in the hand or on a
 * field and additionally numbers a card the row drew from the Break Zone or the deck.
 */
export function displayName(v: PlayerView, id: CardId): string {
  const nth = occurrenceForChoice(v, id)
  const bare = bareName(v, id)
  return nth === null ? bare : `${bare} (${nth})`
}

function namedWith(v: PlayerView, id: CardId, nth: number | null): string {
  const bare = nth === null ? bareName(v, id) : `${bareName(v, id)} (${nth})`
  const mine = v.cards[id]?.owner
  if (mine === undefined) return bare
  // BOTH sides of the confusion have to be on the table. The twin condition came first, and playing showed
  // the subject needs the same test: during "discard down to 5" every card in the list is in your own hand,
  // and the AI happening to hold a Prishe in play made the strip read
  //
  //   Discard Billy Bob, Cloud / Discard your Prishe, Cloud / Discard Cloud, your Reeve / Discard Cloud, Lightning
  //
  // — "your" on some entries and not others, in a prompt where every card is yours and none of the AI's is
  // selectable. A card in hand cannot be mistaken for one in play, whichever end of the comparison it is.
  if (!cardIsOnTable(v, mine, id)) return bare
  // The twin test compares against the OPPONENT's board by printed name, so it must use the bare name — a
  // numbered one would never match and the "your"/"the AI's" qualifier would silently stop appearing.
  return namedCardOnTable(v, (1 - mine) as PlayerId, bareName(v, id)) ? `${possessive(v, mine)} ${bare}` : bare
}

/** "A", "A and B", "A, B and C" — target sets are read aloud off a button, so a bare comma list reads badly. */
function listNames(v: PlayerView, ids: readonly CardId[]): string {
  const names = ids.map((id) => choiceName(v, id))
  return names.length <= 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`
}

/** The printed wording of mode `i`, from the `chooseMode` pending the command answers. */
const modeLabel = (v: PlayerView, i: number): string => (v.pending?.kind === 'chooseMode' ? v.pending.labels[i] ?? `mode ${i + 1}` : `mode ${i + 1}`)

// ---------------------------------------------------------------------------
// Why a clause fired (rung C2)
// ---------------------------------------------------------------------------

/**
 * The part of a `TriggerEvent` narration reads. A structural SUBSET of the engine's type, so a real
 * `Frame.triggerEvent` is assignable to it (spec C2-5) — while the log, which reconstructs a cause from the
 * event stream, is not forced to invent the fields it cannot know (`sourceController`, `from`/`to`, `owner`).
 */
export type TriggerCause =
  | { readonly kind: 'damage'; readonly source: CardId; readonly target: CardId | null; readonly victim: PlayerId | null; readonly amount: number }
  /**
   * `reason` is optional because the log RECONSTRUCTS causes from the event stream and cannot always know
   * one; absent, it means the ordinary case (the card was broken). `Frame.triggerEvent` always carries it.
   */
  | { readonly kind: 'zoneChange'; readonly card: CardId; readonly controller: PlayerId; readonly reason?: ZoneTransitionReason }
  /** A card arrived on a field (spec C8). `controller` is whose field, which is what the wording turns on. */
  | { readonly kind: 'enteredField'; readonly card: CardId; readonly controller: PlayerId }

const possessive = (v: PlayerView, p: PlayerId): string => (p === v.me ? 'your' : "the AI's")

/**
 * WHY a clause fired, as a phrase (spec C2-5). This is the whole point of C2's narration: an observer trigger
 * belongs to a card the event did NOT happen to — Lightning's clause fires because a different Forward was
 * broken — so "Lightning's ability triggers" alone leaves the player with no way to connect the prompt in
 * front of them to the board. Lower-case initial: it is used both mid-sentence in the log and, capitalised,
 * at the head of a prompt.
 */
export function describeTriggerCause(v: PlayerView, ev: TriggerCause): string {
  // Not every trip to the Break Zone is a break. A card put there to PAY for its own ability was not broken
  // (§15.1.1.3.2), and reporting it as one would tell the player something about the board that is false —
  // it also reads as though their own card had been destroyed by the opponent.
  // `bareName` here and below: the possessive is already in the sentence, and `name` would double it.
  if (ev.kind === 'enteredField') return `${ownedCard(v, ev.controller, ev.card)} entered the field`
  if (ev.kind === 'zoneChange') {
    const how = ev.reason === 'cost' ? 'was put into the Break Zone' : 'was broken'
    return `${ownedCard(v, ev.controller, ev.card)} ${how}`
  }
  if (ev.victim !== null) return `${qualifiedName(v, ev.source)} dealt damage to ${ev.victim === v.me ? 'you' : 'the AI'}`
  return `${qualifiedName(v, ev.source)} dealt ${ev.amount} damage to ${ev.target === null ? 'a Forward' : qualifiedName(v, ev.target)}`
}

export const capitalise = (s: string): string => `${s.charAt(0).toUpperCase()}${s.slice(1)}`

// ---------------------------------------------------------------------------
// Ability wording (rung C1)
// ---------------------------------------------------------------------------

/**
 * The clause the agenda is suspended on. It is readable from the view alone because the AST rides on `CardDef`
 * and `viewFor` already carries `defs` (spec C1-2) — the UI needs no new channel to say what a choice is FOR.
 * The source may sit in the Break Zone rather than on the field: a Summon resolves from there (spec C1-10).
 */
function activeAbility(v: PlayerView): { ability: Ability; frame: Frame } | null {
  const frame = v.resolution.active
  if (!frame) return null
  const ability = defFor(v, frame.source)?.abilities?.find((a) => a.id === frame.abilityId)
  return ability ? { ability, frame } : null
}

/** Prefix a prompt with the card that is asking, e.g. `Noel: choose up to 2 …`. */
function sourced(v: PlayerView, text: string): string {
  const active = activeAbility(v)
  return active ? `${qualifiedName(v, active.frame.source)}: ${text.charAt(0).toLowerCase()}${text.slice(1)}` : text
}

/**
 * Lead an ability prompt with what it is REACTING to, read straight off the frame the agenda is suspended on
 * (spec C2-5) — the authority, not a reconstruction. Cause first, then the ask: "The AI's Prishe was broken —
 * Lightning: choose 1 Forward you control to give Haste" says why the prompt appeared before it says what to
 * do. The dash is reserved for this: the strip's own trailing "click a highlighted card" hint uses "·".
 * Empty for `enterField`/`summonResolve`, which are about the source itself and need no explaining.
 */
function caused(v: PlayerView, text: string): string {
  const ev = v.resolution.active?.triggerEvent
  return ev ? `${capitalise(describeTriggerCause(v, ev))} — ${text}` : text
}

/**
 * What a clause does to the cards it picks, as an imperative for the button ("Dull") and a purpose clause for
 * the prompt ("to dull"). Read off the AST rather than hard-coded per card, so a clause the cards lane adds
 * tomorrow gets a real label with no change here.
 */
function verbOf(e: Effect): { imperative: string; purpose: string } | null {
  switch (e.kind) {
    case 'dull': return { imperative: 'Dull', purpose: 'to dull' }
    case 'damage': return { imperative: `Deal ${e.amount} damage to`, purpose: `to deal ${e.amount} damage to` }
    case 'breakCard': return { imperative: 'Break', purpose: 'to break' }
    case 'addPower': return { imperative: `Give ${signed(e.amount)} power to`, purpose: `to give ${signed(e.amount)} power` }
    case 'grantKeyword': return { imperative: `Give ${KEYWORD_LABEL[e.keyword]} to`, purpose: `to give ${KEYWORD_LABEL[e.keyword]}` }
    case 'grantFlag': return { imperative: 'Protect', purpose: FLAG_PURPOSE[e.flag] }
    case 'moveToHand': return { imperative: 'Return', purpose: 'to return to hand' }
    // chooseTargets/chooseModes/forEach describe a choice of their own, not what THIS one does to its picks.
    default: return null
  }
}

/**
 * The verb for the `chooseTargets` node the pending projects. The program counter names it exactly; a whole-AST
 * scan is the fallback for a frame whose path cannot be followed, and it only speaks when the match is
 * unambiguous — Shantotto and Ramuh both print several `1 Forward` clauses, so guessing between them would put
 * the wrong verb on the button.
 */
function targetVerb(v: PlayerView, pending: Extract<Pending, { kind: 'chooseTargets' }>): { imperative: string; purpose: string } | null {
  const active = activeAbility(v)
  if (!active) return null
  const found: Extract<Effect, { kind: 'chooseTargets' }>[] = []
  const walk = (effects: readonly Effect[]): void => {
    for (const e of effects) {
      if (e.kind === 'chooseTargets') {
        // `pending.max` is already clamped to the candidate count, so the node's printed max can only be larger.
        if (e.min === pending.min && e.max >= pending.max) found.push(e)
        walk(e.then)
      } else if (e.kind === 'chooseModes') for (const m of e.modes) walk(m.effects)
      else if (e.kind === 'forEach') walk(e.do)
    }
  }
  const exact = effectAtPath(active.ability.effects, active.frame.path, active.frame.modes)
  let node: Extract<Effect, { kind: 'chooseTargets' }> | null = exact?.kind === 'chooseTargets' ? exact : null
  if (!node) { walk(active.ability.effects); node = found.length === 1 ? found[0] ?? null : null }
  if (!node) return null
  // EVERY effect the choice applies, not just the first. Hugh Yurg's clause is "+2000 power AND Brave", and
  // naming only the power made the prompt understate what the player was deciding — Brave is the half that
  // changes whether the Forward dulls to attack, so a player picking purely on power is picking blind.
  const verbs = node.then.map(verbOf).filter((w): w is { imperative: string; purpose: string } => w !== null)
  if (!verbs.length) return null
  return {
    imperative: joinImperatives(verbs.map((w) => w.imperative)),
    // Every purpose is an infinitive; the "to" comes off all of them so the verbs line up for the collapse,
    // and goes back on once in front of the joined phrase.
    purpose: `to ${joinPurposes(verbs.map((w) => w.purpose.replace(/^to /, '')))}`,
  }
}

const leadVerb = (phrase: string): string => phrase.split(' ')[0]?.toLowerCase() ?? ''

/**
 * Join the purpose phrases of a multi-effect clause the way the printed text joins them.
 *
 * A repeated verb is said once: "give +2000 power" + "give Brave" is printed "gains +2000 power and Brave",
 * and Cloud's two protections read "protect from being broken and from the opponent's return effects". A
 * repeat with nothing after the verb adds nothing at all and is dropped rather than doubled. Differing verbs
 * both survive, the later one lower-cased because it is no longer starting a sentence: "dull and give Haste".
 */
function joinPurposes(phrases: readonly string[]): string {
  const out: string[] = []
  let lastVerb = ''
  for (const phrase of phrases) {
    const [verb, ...rest] = phrase.split(' ')
    // Against the last verb SEEN, not the last phrase kept — a collapsed phrase no longer starts with one.
    const same = leadVerb(phrase) === lastVerb
    lastVerb = leadVerb(phrase)
    if (same && !rest.length) continue
    if (same) { out.push(rest.join(' ')); continue }
    const lowered = `${verb!.charAt(0).toLowerCase()}${verb!.slice(1)}`
    out.push(out.length === 0 ? phrase : [lowered, ...rest].join(' '))
  }
  return out.join(' and ')
}

/**
 * The same join for the BUTTON, which has a seam the prompt does not: a transitive imperative ends in a
 * trailing "to" that `describeChoice` completes with the target names ("Give +2000 power to" + " Cloud").
 *
 * So only a shared verb can be fused. "Give Haste to" and "Dull" name the same card but not in the same
 * shape, and any fusion of them lies about which effect the target belongs to — "Give Haste and dull Cloud"
 * reads as though Cloud were the Haste. Nothing in the pool needs it (Hugh Yurg is Give + Give, Cloud is
 * Protect + Protect), so a mixed clause labels the button with its first effect and leaves the full list to
 * the prompt above it, which has no seam to get wrong.
 */
function joinImperatives(phrases: readonly string[]): string {
  const first = phrases[0]!
  if (phrases.some((p) => leadVerb(p) !== leadVerb(first))) return first
  const tail = phrases.at(-1)!.endsWith(' to') ? ' to' : ''
  const head = first.replace(/ to$/, '').split(' ')[0]!
  const objects = phrases.map((p) => p.replace(/ to$/, '').split(' ').slice(1).join(' ')).filter((o) => o !== '')
  return objects.length ? `${head} ${objects.join(' and ')}${tail}` : `${head}${tail}`
}

type Where = { p: PlayerId; zone: 'forwards' | 'backups' | 'breakZone' }
function whereIs(v: PlayerView, id: CardId): Where | null {
  for (const p of [0, 1] as const) {
    const f = v.fields[p]
    if (f.forwards.some((c) => c.id === id)) return { p, zone: 'forwards' }
    if (f.backups.some((c) => c.id === id)) return { p, zone: 'backups' }
    if (f.breakZone.includes(id)) return { p, zone: 'breakZone' }
  }
  return null
}

/**
 * What the legal candidates ARE, in English: "Forwards the AI controls", "cards in your Break Zone". Derived
 * from where the candidates actually sit rather than from the clause's `TargetSpec`, so it describes the set
 * the player can really click even when the filter narrowed it further.
 */
function candidateNoun(v: PlayerView, ids: readonly CardId[], plural: boolean): string {
  const spots = ids.map((id) => whereIs(v, id))
  const zone = only(new Set(spots.map((s) => s?.zone ?? null)))
  const seat = only(new Set(spots.map((s) => s?.p ?? null)))
  if (zone === 'breakZone') return `${plural ? 'cards' : 'card'} in ${seat === null ? 'a' : seat === v.me ? 'your' : "the AI's"} Break Zone`
  const noun = zone === 'forwards' ? (plural ? 'Forwards' : 'Forward')
    : zone === 'backups' ? (plural ? 'Backups' : 'Backup')
    : plural ? 'cards' : 'card'
  if (seat === null || zone === null) return noun
  return `${noun} ${seat === v.me ? 'you control' : 'the AI controls'}`
}

/** How many, as the printed wording says it: an exact count, or "up to N" for a `min` of 0 (spec C1-10). */
const countPhrase = (min: number, max: number): string => (min === max ? `${max}` : `up to ${max}`)

/** Everything the board must SHOW about a field card. */
export interface FieldCardDisplay {
  /**
   * EFFECTIVE power (spec C1-7), or null for anything with no printed power. Printed power becomes a lie the
   * moment a clause pumps a Forward, and the card's remaining power, its damage bar and its accessibility
   * label are all computed from whatever number goes in here.
   */
  power: number | null
  powerBonus: number
  granted: readonly Keyword[]
  flags: readonly FieldFlag[]
}

export function fieldCardDisplay(v: PlayerView, c: FieldCard): FieldCardDisplay {
  const def = defFor(v, c.id)
  return {
    power: def && def.power !== null ? effectivePower(def, c) : null,
    powerBonus: c.powerBonus,
    granted: c.granted,
    flags: c.flags,
  }
}

/** The card a `chooseExBurst` offer is about. The command carries only the answer, so the card comes from the
 *  pending — which is the authority, and is public in the damage zone either way. */
const exBurstCardOf = (v: PlayerView): CardId =>
  (v.pending?.kind === 'chooseExBurst' ? v.pending.card : 0) as CardId

/**
 * English label for one command, from the acting player's point of view. Ported from `apps/cli/src/render.ts`.
 *
 * `payment: false` (rung I1) is the HEADLINE of a payable command — "Cast Ramuh", the ability without its
 * "paying …" tail — for the card sheet's button, which opens the tray where the payment is then chosen.
 * Naming a payment the press will not make is the E4 defect; the full label is what the log prints after
 * the player has built one. An option rather than a regex over the finished English, so the two forms are
 * one function and cannot drift.
 */
export function describeChoice(v: PlayerView, c: Command, opts: { payment?: boolean } = {}): string {
  const withPayment = opts.payment !== false
  switch (c.type) {
    // G3. Two answers that must never read alike — E9 was a rung about exactly that. "Use" names the card so
    // the player knows WHICH burst; "Decline" names it too, because the strip shows both side by side and a
    // bare "Decline" beside a named "Use" reads as declining something else.
    case 'chooseExBurst':
      return c.use ? `Use the EX Burst on ${qualifiedName(v, exBurstCardOf(v))}` : `Decline the EX Burst on ${qualifiedName(v, exBurstCardOf(v))}`
    case 'chooseFirst': return c.goFirst ? 'Take the first turn' : 'Let the opponent go first'
    case 'mulligan': return c.redraw ? 'Mulligan (redraw 5)' : 'Keep hand'
    case 'castCharacter':
    case 'castSummon': {
      const pay = [...c.payment.dullBackups.map((id) => `dull ${choiceName(v, id)}`), ...c.payment.discards.map((d) => `discard ${choiceName(v, d.card)} as ${d.element}`)]
      if (!withPayment) return `Cast ${choiceName(v, c.card)}`
      return pay.length ? `Cast ${choiceName(v, c.card)} paying: ${pay.join(', ')}` : `Cast ${choiceName(v, c.card)} (free)`
    }
    /*
     * `legalCommands` pre-enumerates whole target SETS — one command per legal combination of `min..max`
     * candidates — so "up to 2" reaches the UI as a list of finished answers, not an incremental
     * pick-then-confirm. C1 accepts that (spec C1-6 flagged the combinatorics); what it costs is that the
     * label has to carry the entire set, so it names the effect too and the button states what the click does.
     */
    case 'chooseTargets': {
      if (!c.targets.length) return 'Choose no targets'
      const verb = v.pending?.kind === 'chooseTargets' ? targetVerb(v, v.pending) : null
      return `${verb?.imperative ?? 'Target'} ${listNames(v, c.targets)}`
    }
    /**
     * Names the cards ONLY if this viewer can see them — and that is the whole of blocker 4, solved by the
     * view rather than by narration logic. The player who looked has the ids in their own deck slots; the
     * opponent has `card: null` there, so the same code physically cannot name a card it must not reveal.
     */
    case 'chooseFromDeck': {
      // A search PLAYS what it finds; a look ADDS it to hand. The pending says which, so the button says it too.
      const field = v.pending?.kind === 'chooseFromDeck' && v.pending.to === 'field'
      if (!c.picks.length) return field ? 'Find nothing' : 'Take nothing'
      // Which cards those indices name is the engine's rule, not this renderer's — see `pickedDeckCards`.
      const named = pickedDeckCards(v, c.player, c.picks)
      const what = named ? listNames(v, named) : `${c.picks.length} card${c.picks.length === 1 ? '' : 's'}`
      return field ? `Play ${what} onto the field` : `Take ${what}`
    }
    // A mode has no card subject, so its button IS the printed wording — never a paraphrase of it.
    case 'chooseMode': return c.modes.length ? c.modes.map((i) => modeLabel(v, i)).join(' + ') : 'None of these'
    // The printed cost is part of the label: a player choosing to spend a card needs to see what it costs
    // before clicking, not after (spec C3-A7).
    case 'activateAbility': {
      const pay = [...c.payment.dullBackups.map((id) => `dull ${choiceName(v, id)}`), ...c.payment.discards.map((d) => `discard ${choiceName(v, d.card)} as ${d.element}`)]
      const cost = activatedCostOf(v, c.source, c.abilityId)
      const clause = defFor(v, c.source)?.abilities?.find((a) => a.id === c.abilityId)
      const does = clause ? describeAbilityEffect(clause) : null
      // Naming the targets is not decoration. `legalCommands` lists one activation per legal target, so
      // without them every target of one ability reads identically — and since `payableKey` now keeps them
      // apart, the player would face four buttons with the same words on them.
      const on = c.targets.length ? ` on ${listNames(v, c.targets)}` : ''
      return `${choiceName(v, c.source)}'s ${cost}${does ? `: ${does}` : ' ability'}${on}${withPayment && pay.length ? ` — paying ${pay.join(', ')}` : ''}`
    }
    case 'declareAttack': return `Attack with ${c.attackers.map((id) => choiceName(v, id)).join(' + ')}`
    case 'declareBlock': return c.blocker === null ? "Don't block" : `Block with ${choiceName(v, c.blocker)}`
    case 'assignPartyDamage': return `Assign damage: ${c.assignments.map((a) => `${a.amount} → ${choiceName(v, a.target)}`).join(', ')}`
    case 'discardToHandSize': return `Discard ${c.cards.map((id) => choiceName(v, id)).join(', ')}`
    case 'pass': return 'Pass'
    case 'concede': return 'Concede'
  }
}

/**
 * What is attacking, and how hard — the two facts a block decision turns on.
 *
 * The prompt used to read "Choose a blocker", full stop. Blocking WHAT? Found by playing: the AI cast
 * Lightning, broke my Forward with its ETB, gave itself Haste and swung, and the browser named neither the
 * attacker nor its power. That is the same complaint the `chooseTargets` case four lines below already
 * carries a comment about — "choose 2 targets" tells the player nothing they can act on — and this case
 * kept its hard-coded string.
 *
 * The power is the EFFECTIVE power (spec C1-7), through the same `fieldCardDisplay` the board renders from,
 * and it is NOT reduced by damage already marked on the attacker: marked damage does not lower a Forward's
 * power or the damage it deals. The card face shows a "remaining" number, which is a different quantity, and
 * reporting that here would understate what the blocker is about to eat.
 *
 * A party is listed member by member rather than summed. The total IS truthful — under CR 3.3 §10.1.4.2 each
 * attacker deals its own power to the blocker — but one number hides which Forward brings what, and reads
 * like the single point of damage an unblocked attack deals the PLAYER, which is a different thing entirely.
 *
 * Deliberately says nothing about the consequence of not blocking. "Take 1 damage" is a CR default rather
 * than anything the engine derives, and card text takes precedence over general rules, so printing it would
 * be a quiet lie the day a card changes it. The "Don't block" button already offers the alternative.
 */
function blockPrompt(v: PlayerView): string {
  const attackers = v.attack?.attackers ?? []
  const named = attackers.map((id) => {
    const fc = findFieldCardInView(v, id)
    const power = fc ? fieldCardDisplay(v, fc).power : null
    const name = qualifiedName(v, id)
    return power === null ? name : `${name} (power ${power})`
  })
  // No resolvable attacker is not reachable in play: a `declareBlock` pending is raised from attackers the
  // engine has just validated, and there is no priority window in which one could leave. Defensive only.
  if (!named.length) return 'Choose a blocker'
  return `Choose a blocker for ${listPhrase(named)}`
}

/** The attacking card as it sits on a field, wherever it sits. Attackers are always the turn player's. */
function findFieldCardInView(v: PlayerView, id: CardId): FieldCard | undefined {
  for (const p of [0, 1] as const) {
    const found = [...v.fields[p].forwards, ...v.fields[p].backups].find((c) => c.id === id)
    if (found) return found
  }
  return undefined
}

/** `a`, `a and b`, `a, b and c` — the party is listed, never summed. */
function listPhrase(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? ''
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1] as string}`
}

/** The sheet's button text for a choice: the full label, or the payment-free headline for a payable one (rung I1). */
export function headline(v: PlayerView, c: Choice): string {
  return describeChoice(v, c.command, { payment: false })
}

/**
 * Why a hand card cannot be cast right now, in the player's words (rung I1-D4) — or `null` when it can.
 *
 * The engine's `castBlocker` names every reason that is not about CP; when it passes and the card still has
 * no cast on offer, the only reason left is that no payment covers the cost. Phrased here, once, so the
 * sheet's greyed Cast always says why and never has to parse the engine's English.
 */
const CAST_BLOCKER_TEXT: Record<CastBlocker, string> = {
  gameOver: 'The game is over',
  phase: 'Only in your Main Phase',
  notInHand: 'Not in your hand',
  notTurnPlayer: 'Only on your own turn',
  priority: 'Not while the AI holds priority',
  pending: 'Answer the current prompt first',
  stackNotEmpty: 'Not while something is on the stack',
  monster: 'Monsters are not supported in this build',
  backupsFull: 'You already have five Backups',
  sameName: 'You already control a card with this name',
}
export function castBlockerText(v: PlayerView, card: CardId, castable: boolean): string | null {
  if (castable || !v.hand.includes(card)) return null
  const why = castBlocker(stateShim(v), v.me, card)
  return why === null ? 'Not enough CP' : CAST_BLOCKER_TEXT[why]
}

/**
 * How the game ended, said to a person.
 *
 * `result.reason` is the engine's own string and reads "player 0 has 7 damage (§12.4.1)". The terminal shows
 * it and should: its whole vocabulary is P0/P1. This UI says "You" everywhere else, so showing it here puts
 * a player index and a Comprehensive Rules citation in front of someone at the moment they lose.
 *
 * ONE formatter for both places this is shown — the banner and the game-over line in the event log. They
 * were written separately, and fixing only the banner would have left the identical leak a few pixels lower,
 * behind the overlay, in a log that is still in the DOM.
 *
 * Phrased from `cause` rather than parsed from `reason`, because the ending is not recoverable from the
 * final position either: a loser on seven damage with an empty deck could have got there four different
 * ways, and a concede leaves no trace in the state at all.
 */
export function describeResult(me: PlayerId, result: GameResult): string {
  if (result.cause === 'bothReachedSeven') return 'You both reached 7 damage — the game is a draw.'
  const youLost = result.winner !== me
  const who = youLost ? 'You' : 'The AI'
  switch (result.cause) {
    case 'damage': return `${who} ${youLost ? 'have' : 'has'} taken 7 damage.`
    case 'concede': return `${who} conceded.`
    case 'deckOut': return `${who} could not draw from an empty deck.`
    case 'damageWithEmptyDeck': return `${who} took damage with an empty deck.`
  }
}

/** Mirrors `legalCommands`/`actingPlayer` against the view: `pending` outranks `priority` (see engine `legal.ts`). */
function actingIn(v: PlayerView): PlayerId | null {
  if (v.result) return null
  return v.pending?.player ?? v.priority
}

/** One line stating what the game is waiting for, derived from `pending` first, then `phase`/`attack.step`. */
export function promptFor(v: PlayerView, legal: readonly Command[]): string {
  if (v.result) return v.result.winner === null ? 'Game over — a draw' : v.result.winner === v.me ? 'Game over — you win' : 'Game over — the AI wins'
  if (actingIn(v) !== v.me) return 'Waiting for the opponent…'
  if (v.pending) {
    switch (v.pending.kind) {
      case 'chooseFirst': return 'Choose who goes first'
      case 'mulligan': return 'Keep your hand or mulligan'
      case 'discardToHandSize': return `Discard down to ${HAND_SIZE_LIMIT} cards`
      case 'declareBlock': return blockPrompt(v)
      case 'assignPartyDamage': return 'Assign combat damage'
      // Both ability prompts name the card that is asking and what the choice is FOR — "choose 2 targets" tells
      // the player nothing they can act on. The wording is derived from the clause's own AST, never hard-coded.
      case 'chooseTargets': {
        const { min, max, candidates } = v.pending
        const purpose = targetVerb(v, v.pending)?.purpose
        return caused(v, sourced(v, `Choose ${countPhrase(min, max)} ${candidateNoun(v, candidates, max !== 1)}${purpose ? ` ${purpose}` : ''}`))
      }
      case 'chooseMode': {
        const { min, max, labels } = v.pending
        return caused(v, sourced(v, `Choose ${countPhrase(min, max)} of the ${labels.length} following effect${labels.length === 1 ? '' : 's'}`))
      }
      // Without this the strip fell through to the PHASE line and told the player to "cast, attack, or pass"
      // while the only legal answers were deck picks — a prompt instructing a move the engine would reject.
      // G3. Named rather than left to the phase line, for the reason the `chooseFromDeck` case below states:
      // a prompt must not instruct a move the engine would reject, and "Attack Phase — declare an attack" is
      // exactly what the strip would otherwise say while the only legal answers are use and decline.
      case 'chooseExBurst':
        return `${capitalise(qualifiedName(v, v.pending.card))} has EX Burst — use it?`
      case 'chooseFromDeck': {
        const { min, max, count, to } = v.pending
        const what = to === 'field' ? 'to play onto the field' : 'to add to your hand'
        // A SEARCH exposes the whole deck, and "among the 44 cards you looked at" is a true sentence nobody
        // would say. Which of the two it is comes from the pending's `scope`: inferring it from `count ===
        // deck.length` called a top-3 peek at a 3-card deck a search (Codex MAJOR).
        const among = v.pending.scope === 'deck' ? 'in your deck' : `among the ${count} card${count === 1 ? '' : 's'} you looked at`
        return caused(v, sourced(v, `Choose ${countPhrase(min, max)} card${max === 1 ? '' : 's'} ${among} ${what}`))
      }
    }
  }
  return phasePrompt(v, legal)
}

/**
 * The fallback, when no pending is asking for anything in particular — derived from the moves on offer rather
 * than from the phase alone.
 *
 * It used to be three constant strings, and they were wrong in most positions. Over seeds 1–6 with greedy
 * driving, **168 of the sampled human turns** carried a prompt naming a move the engine would have rejected.
 * On an empty or fully dull board that is the normal case, not an edge one.
 *
 * (The commit that landed this said 225, which was the count of VERB-INSTANCES: a prompt overclaiming both
 * "cast" and "attack" was counted twice. 92 casts + 133 attacks = 225 overclaims across 168 positions. A code
 * review caught the wrong noun.)
 *
 * The constants also said too LITTLE, which nothing measured until the test's oracle learned about
 * activations: in **32 positions** an activated ability was legal and no prompt mentioned abilities at all,
 * because none of the three constants ever did.
 *
 * `commands.ts` already had the principle written down one branch above — the `chooseFromDeck` case exists
 * because the strip "told the player to 'cast, attack, or pass' while the only legal answers were deck picks
 * — a prompt instructing a move the engine would reject". That fix gave the pending its own sentence and left
 * the fallback it was falling through TO untouched.
 *
 * The verbs come from the COMMANDS, never from a second opinion about legality. Recomputing "can I attack
 * here?" would be a second implementation of a rule the engine already owns, and this repo has been bitten by
 * exactly that divergence twice (`preferredPayment` against `canPay`, `backupElements` against `def.elements`).
 */
function phasePrompt(v: PlayerView, legal: readonly Command[]): string {
  const has = (f: (c: Command) => boolean): boolean => legal.some(f)
  const canCast = has((c) => c.type === 'castCharacter' || c.type === 'castSummon')
  const canActivate = has((c) => c.type === 'activateAbility')
  // Listed in the order a player would try them, and joined so the sentence reads as one offer rather than a
  // menu: "cast, use an ability, or pass".
  // The clause after the em dash is the OFFER; the words before it are the phase's NAME. That split is not
  // cosmetic — "Attack Phase" contains the word "attack" without offering one, so a reader (or a test) that
  // scans the whole sentence for verbs will find one that is not on the table. The no-offer wordings below
  // deliberately avoid restating the verb for the same reason.
  const offer = (verbs: string[], nothing: string): string =>
    verbs.length === 0 ? nothing : `${[...verbs, 'pass'].join(', ').replace(/, ([^,]*)$/, verbs.length > 1 ? ', or $1' : ' or $1')}`

  switch (v.phase) {
    // NOT "cast, attack, or pass". An attack is declared in the Attack Phase — `legalCommands` only ever emits
    // `declareAttack` under `case 'attack'` — so Main Phase 1 naming one is not merely unavailable in this
    // position, it is not a Main Phase 1 move at all. Passing is how you get there, which is what it now says.
    case 'main1': return `Main Phase 1 — ${offer(
      [...(canCast ? ['cast'] : []), ...(canActivate ? ['use an ability'] : [])],
      'pass to continue',
    )}`
    case 'main2': return `Main Phase 2 — ${offer(
      [...(canCast ? ['cast'] : []), ...(canActivate ? ['use an ability'] : [])],
      'pass to end your turn',
    )}`
    case 'attack': {
      if (v.attack?.step !== 'declaration') return `Attack Phase — ${v.attack?.step ?? 'resolving'}`
      return has((c) => c.type === 'declareAttack')
        ? 'Attack Phase — declare an attack or pass'
        : 'Attack Phase — no Forward of yours is ready; pass'
    }
    default: return `${PHASE_LABEL[v.phase] ?? v.phase} — nothing to do`
  }
}

/** Every card a command acts on. Order matters: the first is the click-target `Choice.card` hangs off. */
function subjectsOf(c: Command): CardId[] {
  switch (c.type) {
    case 'castCharacter':
    case 'castSummon': return [c.card]
    case 'declareAttack': return c.attackers
    case 'declareBlock': return c.blocker === null ? [] : [c.blocker]
    case 'assignPartyDamage': return c.assignments.map((a) => a.target)
    case 'discardToHandSize': return c.cards
    // Spec B-A4 + C1-6: the subjects of a target answer are exactly its targets, so the board lights up the
    // legal candidates and nothing else — clicking one is how the set gets picked.
    case 'chooseTargets': return [...c.targets]
    // An activation is an action taken BY a card, so its subject is the source — clicking the card is how you
    // use it. The CP sources are deliberately not subjects: they are payment, chosen for you.
    //
    // Its TARGETS are subjects too, and leaving them out hid a card the player was being asked to pick.
    // `legalCommands` pre-enumerates an activation's targets INTO the command (`activationTargetSets`), so
    // unlike a `chooseTargets` pending there is no later step at which those cards become subjects. Sphene
    // chooses a Forward in your Break Zone, which no row draws: the button named it and nothing on screen
    // did. Reachable on seed 6.
    //
    // Payment is still excluded, and the distinction is the same one the line above draws — a payment is
    // chosen FOR the player, a target is chosen BY them, and only the latter is a subject.
    // Deduplicated: the command model permits a Forward's activated ability to target ITSELF, which nothing
    // in this pool does yet. `[source, source]` would file the same choice twice under one card, and `pick`
    // reads a list of length two as "several ways to use this card" — so a sole action would stop executing
    // on click and open two identical buttons instead. Found by review, not by play, because no card reaches
    // it; the model allows it and the next card added could.
    case 'activateAbility': return [...new Set([c.source, ...c.targets])]
    // `chooseMode` and `chooseFromDeck` have no card subject at all — indices, not board cards — so they
    // are strip buttons.
    // G3's `chooseExBurst` is a strip button too: its card sits in the damage zone, which is not a pressable
    // row, so hanging the choice off a card would put it on nothing.
    case 'chooseFirst': case 'mulligan': case 'chooseMode': case 'chooseFromDeck': case 'chooseExBurst':
    case 'pass': case 'concede': return []
    default: { const _exhaustive: never = c; return _exhaustive }
  }
}

/**
 * Group `legal` into the click map the board renders from. Spec B-A4: a card is clickable IFF it is a key of
 * `byCard`, so an illegal click is unrepresentable rather than rejected after the fact. A command with several
 * subjects (a multi-forward attack party, a damage split, a multi-card discard) is listed under *every* one of
 * them — clicking any member of a party has to offer that party — while `Choice.card`, which is singular, keeps
 * the first as the label's anchor.
 */
/**
 * Every way to pay for each move, keyed the same way `preferredChoices` collapses them.
 *
 * Rung E11. `preferredChoices` picks one payment per move and discards the rest, so by the time the board
 * sees a cast, the four other ways to fund it no longer exist anywhere — the player could not choose which of
 * their own cards to spend, and 170 casts and 41 activations in a twelve-seed trace had at least two ways.
 *
 * Pass the RAW `legalCommands` here, and the collapsed list to `buildChoiceSet`. Splitting it this way is
 * what lets the alternatives ride along without the strip growing a button per payment — which is what spec
 * B6 collapsed them to avoid, and is not an interface worth trading for.
 */
export function paymentAlternatives(legal: Command[]): Map<string, Command[]> {
  const out = new Map<string, Command[]>()
  for (const c of legal) {
    if (!isPayable(c)) continue
    const key = payableKey(c)
    out.set(key, [...(out.get(key) ?? []), c])
  }
  return out
}

/**
 * `alternatives` is the map from `paymentAlternatives`, built from the RAW legal commands; omit it and every
 * choice comes back exactly as it did before rung E11.
 */
export function buildChoiceSet(v: PlayerView, legal: Command[], alternatives?: Map<string, Command[]>): ChoiceSet {
  const all: Choice[] = []
  const byCard = new Map<CardId, Choice[]>()
  const loose: Choice[] = []
  for (const command of legal) {
    const subjects = subjectsIn(v, command)
    const choice: Choice = { command, label: describeChoice(v, command), card: subjects[0] ?? null }
    // The other payments for this same move, preferred one excluded — it is already `choice` itself.
    const others = isPayable(command) ? (alternatives?.get(payableKey(command)) ?? [])
      .filter((o) => !sameCommand(o, command)) : []
    if (others.length) {
      choice.alternatives = others.map((o) => ({
        command: o, label: describeChoice(v, o), card: subjectsIn(v, o)[0] ?? null,
      }))
    }
    all.push(choice)
    if (!subjects.length) { loose.push(choice); continue }
    for (const id of subjects) byCard.set(id, [...(byCard.get(id) ?? []), choice])
  }
  return { all, byCard, loose, prompt: promptFor(v, legal) }
}

/**
 * `subjectsOf`, plus the one command whose subjects only a VIEW can resolve.
 *
 * A `chooseFromDeck` names deck INDICES, not card ids (`resolve.ts` reads the deck positionally, so the
 * command has to survive a card moving). `subjectsOf` is pure on the command and cannot turn an index into a
 * card, so a search had no card subject at all — it fell into `loose`, and the strongest effect in this pool
 * presented as a list of bare names for cards the player has never seen. Hugh Yurg puts ANY card in your deck
 * onto the field; picking one by name alone is not a decision a player can make.
 *
 * Resolving them here rather than in the board is what makes the rest free: they become ordinary `byCard`
 * keys, so the existing orphan row draws them, `pick` clicks them, and `displayName` numbers them — none of
 * which needed a line of new UI.
 *
 * `pickedDeckCards` returns null if any picked slot is hidden from this viewer, which is the guarantee that
 * this cannot show a card the player is not entitled to see. The eligible SET is the engine's rule and stays
 * there: only the picks `legalCommands` already computed are resolved, never a filter re-derived here.
 */
function subjectsIn(v: PlayerView, c: Command): CardId[] {
  if (c.type !== 'chooseFromDeck') return subjectsOf(c)
  return pickedDeckCards(v, c.player, c.picks) ?? []
}

function sameIds(a: readonly CardId[], b: readonly CardId[]): boolean {
  if (a.length !== b.length) return false
  const sortedB = [...b].sort((x, y) => x - y)
  return [...a].sort((x, y) => x - y).every((id, i) => id === sortedB[i])
}

/** Payments are sets of sources, not sequences — `legalCommands` and `preferredPayment` build them in different orders. */
export function samePayment(a: Payment, b: Payment): boolean {
  if (!sameIds(a.dullBackups, b.dullBackups)) return false
  if (a.discards.length !== b.discards.length) return false
  const key = (d: Payment['discards'][number]) => `${d.card}:${d.element}`
  const bKeys = b.discards.map(key).sort()
  return a.discards.map(key).sort().every((k, i) => k === bKeys[i])
}

/** Structural equality, used by `useGame.choose` to prove a command is in the current legal set before applying. */
export function sameCommand(a: Command, b: Command): boolean {
  if (a.type !== b.type || a.player !== b.player) return false
  switch (a.type) {
    case 'chooseFirst': return a.goFirst === (b as typeof a).goFirst
    case 'mulligan': return a.redraw === (b as typeof a).redraw
    case 'castCharacter':
    case 'castSummon': return a.card === (b as typeof a).card && samePayment(a.payment, (b as typeof a).payment)
    case 'declareAttack': return sameIds(a.attackers, (b as typeof a).attackers)
    case 'declareBlock': return a.blocker === (b as typeof a).blocker
    case 'assignPartyDamage': {
      const key = (x: { target: CardId; amount: number }) => `${x.target}:${x.amount}`
      const other = (b as typeof a).assignments.map(key).sort()
      return a.assignments.length === other.length && a.assignments.map(key).sort().every((k, i) => k === other[i])
    }
    case 'discardToHandSize': return sameIds(a.cards, (b as typeof a).cards)
    case 'chooseTargets': return sameIds([...a.targets], [...(b as typeof a).targets])
    case 'chooseMode': return sameIds([...a.modes], [...(b as typeof a).modes])
    case 'chooseFromDeck': return sameIds([...a.picks], [...(b as typeof a).picks])
    case 'activateAbility': {
      const o = b as typeof a
      // Targets included: this is the legality guard the browser and the AI both re-check a chosen command
      // against, and an activation aimed at a different Forward is a different command.
      return a.source === o.source && a.abilityId === o.abilityId
        && sameIds([...a.targets], [...o.targets]) && samePayment(a.payment, o.payment)
    }
    // Compares the ANSWER, not just the type — two chooseExBurst commands differ precisely in the boolean,
    // and treating them as the same command would let a click on "Decline" be matched against "Use".
    case 'chooseExBurst': return a.use === (b as typeof a).use
    case 'pass': case 'concede': return true
    default: { const _exhaustive: never = a; return _exhaustive }
  }
}

type CastCommand = Extract<Command, { type: 'castCharacter' | 'castSummon' }>
type ActivateCommand = Extract<Command, { type: 'activateAbility' }>
/**
 * Both kinds of command that carry a `Payment`, and therefore both kinds that `legalCommands` explodes into
 * one entry per minimal payment. C3 added the second; collapsing only casts would have put a separate button
 * on the board for every way of paying for the same Red Mage ability.
 */
type PayableCommand = CastCommand | ActivateCommand
const isCast = (c: Command): c is CastCommand => c.type === 'castCharacter' || c.type === 'castSummon'
const isPayable = (c: Command): c is PayableCommand => isCast(c) || c.type === 'activateAbility'
/**
 * What counts as "the same move, paid differently".
 *
 * The TARGETS are part of the identity of an activation, and leaving them out was the worst defect this rung
 * turned up — worse than the one it was opened for. `legalCommands` lists one activation per legal target, so
 * a key of source+ability collapsed all of them into a single button and the player never chose the target at
 * all. On seed 1, in ordinary play, Undead Princess's pump offered FOUR distinct targets and the strip showed
 * one button; whichever Forward happened to come first was pumped, silently.
 *
 * That is the exact operation this rung's plan review refused — a UI deciding a live choice on the player's
 * behalf and disclosing it only afterwards — and it was already shipping. Payments really are interchangeable
 * (that is what `preferredPayment` is for) so they stay out of the key; targets never are.
 */
const payableKey = (c: PayableCommand): string =>
  c.type === 'activateAbility' ? `a:${c.source}:${c.abilityId}:${[...c.targets].join(',')}` : `c:${c.card}`

/**
 * `preferredPayment` reads only the acting player's own backups, hand and the shared card/def tables — all of it
 * already in the human's own `PlayerView` — but its signature takes a `GameState`. Rebuild the minimum of one
 * rather than threading `GameState` into the view layer (spec B3: the React tree never sees it). Both decks and
 * the opponent's hand stay empty: nothing hidden goes in, so nothing hidden can come back out in a payment.
 */
export function stateShim(v: PlayerView): GameState {
  const side = (p: PlayerId): PlayerState => ({
    deck: [], hand: p === v.me ? [...v.hand] : [],
    forwards: v.fields[p].forwards, backups: v.fields[p].backups,
    damageZone: v.fields[p].damageZone, breakZone: v.fields[p].breakZone, removedFromGame: v.fields[p].removedFromGame,
    putIntoBreakZoneFromFieldThisTurn: [...v.fields[p].putIntoBreakZoneFromFieldThisTurn],
    mulliganDecided: v.mulliganDecided[p],
  })
  return {
    rng: seedRng(0), turn: v.turn, turnPlayer: v.turnPlayer, firstPlayer: v.firstPlayer, phase: v.phase,
    attack: v.attack, priority: v.priority, pending: v.pending, resolution: v.resolution, stack: v.stack, passes: v.passes, players: [side(0), side(1)],
    cards: v.cards, knownBy: v.knownBy, defs: v.defs, result: v.result,
  }
}

/**
 * Spec B6: `legalCommands` enumerates every *minimal* payment, so one castable card can appear dozens of times.
 * Collapse each card's casts to a single choice — the payment `preferredPayment` picks, falling back to that
 * card's first legal payment when it returns `null` or picks a non-minimal one `legalCommands` never listed.
 * Non-cast commands pass through untouched, and the surviving cast keeps the position of the card's first
 * payment, so the whole list stays in `legalCommands` order. Feed the result to `buildChoiceSet`.
 */
export function preferredChoices(v: PlayerView, legal: Command[]): Command[] {
  const payable = legal.filter(isPayable)
  if (!payable.length) return legal
  const keep = new Map<string, Command>()
  for (const c of payable) if (!keep.has(payableKey(c))) keep.set(payableKey(c), c)
  const shim = stateShim(v)
  for (const c of payable) {
    const key = payableKey(c)
    const preferred = preferredFor(shim, v, c)
    if (!preferred) continue
    const match = payable.find((o) => payableKey(o) === key && samePayment(o.payment, preferred))
    if (match) keep.set(key, match)
  }
  const seen = new Set<string>()
  const out: Command[] = []
  for (const c of legal) {
    if (!isPayable(c)) { out.push(c); continue }
    const key = payableKey(c)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(keep.get(key) ?? c)
  }
  return out
}

/** The payment the AI's own value-minimising chooser would pick for this move. */
function preferredFor(shim: GameState, v: PlayerView, c: PayableCommand): Payment | null {
  if (c.type !== 'activateAbility') return preferredPayment(shim, v.me, c.card)
  const ability = activatedAbilityOf(v, c.source, c.abilityId)
  if (!ability || ability.trigger.kind !== 'activated') return null
  return preferredPaymentFor(shim, v.me, abilityCpRequirement(c.source, ability.trigger.cost))
}

/** The activated clause `abilityId` names, read off the view's own definitions. */
export function activatedAbilityOf(v: PlayerView, source: CardId, abilityId: string): Ability | undefined {
  const def = v.defs[v.cards[source]?.code ?? '']
  return (def?.abilities ?? []).find((a) => a.id === abilityId)
}

/** The printed cost of one activated clause, for the button label. */
function activatedCostOf(v: PlayerView, source: CardId, abilityId: string): string {
  const ability = activatedAbilityOf(v, source, abilityId)
  return ability && ability.trigger.kind === 'activated' ? describeAbilityCost(ability.trigger.cost) : 'Ability'
}
