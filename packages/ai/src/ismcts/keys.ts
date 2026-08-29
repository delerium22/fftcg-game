import { ELEMENTS, matchesDefFilter, type CardId, type Command, type Element, type FieldCard, type Frame, type Pending, type PlayerId, type PlayerView, type Resolution, type TriggerEvent } from '@fftcg/engine'
import type { RolloutProfile } from '../greedy.js'

/**
 * Canonical, cross-determinisation identity for search (spec D-2). **This is the crux of the rung.**
 *
 * `Command` embeds `CardId` everywhere, and `determinise()` mints fresh sequential synthetic ids for hidden
 * cards on every iteration. So raw commands cannot key a tree in either direction:
 *   - the same numeric id can mean a DIFFERENT card in a different world  → false matches, and the search
 *     pools statistics for two unrelated moves;
 *   - the same semantic card gets a DIFFERENT id in another world         → false splits, and the search
 *     never accumulates enough visits on anything to choose well.
 * Neither shows up as a crash or an illegal move. Both just make the search quietly worse than greedy,
 * which is why `ActionKey` correctness is pinned by unit tests and not by a win-rate gate.
 *
 * The rule: **a key names what a human would name.** Public cards are identified by where they sit, because
 * both players can see that and it survives redeterminisation. Private cards are identified by what they
 * are, because their id is meaningless outside one world.
 */

/**
 * A card reference that means the same thing in every determinisation.
 *
 *  - `f0:2`  — player 0's forwards, index 2 (public: position is observable and stable)
 *  - `b1:0`  — player 1's backups, index 0
 *  - `z0:3`  — player 0's break zone, index 3 (public and ordered)
 *  - `h:9-074C#1` — the SECOND copy of 9-074C in the root player's own hand. Hand cards are private, so
 *    position in a determinised hand is meaningless; the card CODE plus an occurrence counter is what a
 *    player actually distinguishes. Two copies of one code are interchangeable, which is why the counter is
 *    by code and not by id.
 *  - `?`     — a hidden card with no canonical identity (an opponent hand card the root player cannot name).
 *    A key containing `?` must never be used to pool statistics; see `isOpaque`.
 */
export type CardRef = string

/** Canonical identity of one action, stable across determinisations. */
export type ActionKey = string

/**
 * Canonical digest of what the ROOT player can observe after an action. Nodes are
 * `(parent history, ActionKey, ObservationKey)`, because an action alone does not identify the resulting
 * information set: turn advancement draws cards automatically (`phases.ts`), so two identical actions can
 * leave the root player in observably different positions. Every id inside — including in `attack`,
 * `pending` and `resolution` — is replaced by a `CardRef`.
 */
export type ObservationKey = string

/** A key is opaque if any part of it names a card the root player cannot identify. */
export function isOpaque(key: string): boolean {
  return key.includes('?')
}

/**
 * The contract the implementation must satisfy. Written here as documentation-with-teeth: the tests in
 * `test/keys.test.ts` assert exactly these properties, and they are the ones a tournament cannot check.
 *
 *  1. DETERMINISM     — `actionKey(v, c)` depends only on `v` and `c`, never on iteration order or a Map.
 *  2. NO FALSE MATCH  — two commands naming different card CODES never share a key, even when their
 *                       `CardId`s collide across worlds.
 *  3. NO FALSE SPLIT  — the same semantic action in two determinisations shares a key, even though its
 *                       `CardId`s differ.
 *  4. TOTALITY        — every `Command` variant produces a key; sets (attackers, targets, payment sources,
 *                       assignments, modes) are normalised by sorting, because order is not semantic.
 *  5. ROUND TRIP      — `decodeAction(view, key)` returns a command that is legal in THIS determinisation,
 *                       or null when the key names something absent from this world. The tree stores keys;
 *                       only the root returns a real `Command`.
 */
export interface KeyContract {
  actionKey(view: PlayerView, command: Command): ActionKey
  observationKey(view: PlayerView): ObservationKey
  decodeAction(view: PlayerView, key: ActionKey): Command | null
  cardRef(view: PlayerView, id: number, root: PlayerId): CardRef
}

// ---------------------------------------------------------------------------
// Grammar
// ---------------------------------------------------------------------------

/** The one ref that names nothing, and the only place `?` is minted — so `isOpaque` and the index agree. */
const OPAQUE: CardRef = '?'

/** `|` separates a key's fields, `,` its list items, `@` binds a scalar to a ref. No `CardRef` contains any
 *  of the three: zone refs are `[a-z]\d:\d+` and hand refs are `h:<code>#<n>` over this pool's code alphabet. */
const FIELD = '|'

/** Code-unit comparison. `localeCompare` is locale- and ICU-version-dependent, i.e. not deterministic (D-8). */
const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/** Total order on `ActionKey`/`ObservationKey` for every caller that has to sort keys (D-8). */
export function compareKeys(a: string, b: string): number {
  return cmpStr(a, b)
}

/** Zone refs split into `(zone, index)` so they compare by index NUMERICALLY: plain string order puts `f0:10`
 *  before `f0:2`, which would silently make a sorted attacker list depend on how full the field is. */
function refParts(ref: CardRef): readonly [string, number] {
  const i = ref.lastIndexOf(':')
  const tail = ref.slice(i + 1)
  if (i < 0 || !/^\d+$/.test(tail)) return [ref, -1]
  return [ref.slice(0, i), Number(tail)]
}

function compareRefs(a: CardRef, b: CardRef): number {
  const [za, ia] = refParts(a)
  const [zb, ib] = refParts(b)
  return cmpStr(za, zb) || ia - ib
}

const splitList = (s: string): string[] => (s === '' ? [] : s.split(','))
const joinRefs = (refs: readonly CardRef[]): string => [...refs].sort(compareRefs).join(',')

/** `ref@tag` items — payment discards (element) and party-damage assignments (amount). Sorted by ref first,
 *  so the tag only ever breaks a tie between two refs that cannot both occur in a legal command anyway. */
function joinTagged(items: readonly (readonly [CardRef, string])[]): string {
  return [...items]
    .sort((a, b) => compareRefs(a[0], b[0]) || cmpStr(a[1], b[1]))
    .map(([ref, tag]) => `${ref}@${tag}`)
    .join(',')
}

function splitTagged(s: string): (readonly [CardRef, string])[] | null {
  const out: (readonly [CardRef, string])[] = []
  for (const item of splitList(s)) {
    const at = item.lastIndexOf('@')
    if (at < 0) return null
    out.push([item.slice(0, at), item.slice(at + 1)] as const)
  }
  return out
}

// ---------------------------------------------------------------------------
// cardRef
// ---------------------------------------------------------------------------

interface RefIndex {
  readonly byId: ReadonlyMap<CardId, CardRef>
  /** A ref can name SEVERAL ids: two copies of one code in hand are interchangeable and share a ref. */
  readonly byRef: ReadonlyMap<CardRef, readonly CardId[]>
}

/**
 * One index per `(view, root)`. Sound to cache because `viewFor` returns a `structuredClone` nothing mutates,
 * and the index is a pure function of the view. The `Map`s are only ever LOOKED UP, never iterated, so no
 * insertion order can leak into a key (D-8) — the ordering that does appear in keys comes from `sort`.
 */
const INDEX_CACHE = new WeakMap<PlayerView, [RefIndex | undefined, RefIndex | undefined]>()

function buildIndex(view: PlayerView, root: PlayerId): RefIndex {
  const byId = new Map<CardId, CardRef>()
  const byRef = new Map<CardRef, CardId[]>()
  const put = (id: CardId, ref: CardRef): void => {
    byId.set(id, ref)
    const bucket = byRef.get(ref)
    if (bucket) bucket.push(id)
    else byRef.set(ref, [id])
  }
  // Public zones, in a fixed order over arrays — position IS the identity, and it is identical in every
  // determinisation of one view because `determinise` copies the fields across verbatim.
  for (const p of [0, 1] as const) {
    const f = view.fields[p]
    f.forwards.forEach((c, i) => put(c.id, `f${p}:${i}`))
    f.backups.forEach((c, i) => put(c.id, `b${p}:${i}`))
    f.damageZone.forEach((id, i) => put(id, `d${p}:${i}`))
    f.breakZone.forEach((id, i) => put(id, `z${p}:${i}`))
  }
  // Deck slots this viewer has LOOKED at, by code and by owner. A deck position is an artefact of one world
  // exactly as a hand position is — `determinise` samples every slot the viewer does not know — so a card the
  // viewer HAS seen must be named by what it is, like a hand card, and one it has not stays unnameable.
  for (const p of [0, 1] as const) {
    for (const sl of view.fields[p].deck) {
      const code = sl.card === null ? undefined : view.cards[sl.card]?.code
      if (sl.card !== null && code !== undefined) put(sl.card, `d${p}:${code}`)
    }
  }
  // The root's own hand is the only private zone it can name, and it names it by CODE: a hand position is an
  // artefact of one world, and `determinise` is free to hand the same numeric id to a different code in the next.
  if (root === view.me) {
    for (const id of view.hand) {
      const code = view.cards[id]?.code
      if (code === undefined) continue   // a hand card whose instance the view omits cannot be named at all
      // No occurrence counter: two copies of one code in hand are INTERCHANGEABLE, so casting "the second Red
      // Mage" is the same move as casting the first. Numbering them split one semantic action into two tree
      // edges, halving the visits on each — a false split of exactly the kind D-2 exists to prevent, and one
      // that no win-rate gate would show. Lists keep repeats, so a two-copy discard is still a multiset.
      put(id, `h:${code}`)
    }
  }
  return { byId, byRef }
}

function indexFor(view: PlayerView, root: PlayerId): RefIndex {
  let slots = INDEX_CACHE.get(view)
  if (!slots) {
    slots = [undefined, undefined]
    INDEX_CACHE.set(view, slots)
  }
  const hit = slots[root]
  if (hit) return hit
  const built = buildIndex(view, root)
  slots[root] = built
  return built
}

export function cardRef(view: PlayerView, id: CardId, root: PlayerId): CardRef {
  return indexFor(view, root).byId.get(id) ?? OPAQUE
}

// ---------------------------------------------------------------------------
// actionKey
// ---------------------------------------------------------------------------

export function actionKey(view: PlayerView, command: Command): ActionKey {
  const r = (id: CardId): CardRef => cardRef(view, id, view.me)
  const head = `${command.type}${FIELD}p${command.player}`
  switch (command.type) {
    case 'chooseFirst':
      return `${head}${FIELD}${command.goFirst ? 'first' : 'second'}`
    case 'mulligan':
      return `${head}${FIELD}${command.redraw ? 'redraw' : 'keep'}`
    case 'castCharacter':
    case 'castSummon': {
      // Payment sources are a SET: `generateCp` and `pay` are both order-insensitive, and `enumeratePayments`
      // emits backups in field order but hand discards in hand order, which differs between worlds.
      const dull = joinRefs(command.payment.dullBackups.map(r))
      const discards = joinTagged(command.payment.discards.map((d) => [r(d.card), d.element] as const))
      return `${head}${FIELD}${r(command.card)}${FIELD}${dull}${FIELD}${discards}`
    }
    case 'declareAttack':
      // `applyDeclareAttack` sorts the party itself, so attacker order carries no meaning to normalise away.
      return `${head}${FIELD}${joinRefs(command.attackers.map(r))}`
    case 'declareBlock':
      return `${head}${FIELD}${command.blocker === null ? '-' : r(command.blocker)}`
    case 'assignPartyDamage':
      return `${head}${FIELD}${joinTagged(command.assignments.map((a) => [r(a.target), String(a.amount)] as const))}`
    case 'discardToHandSize':
      return `${head}${FIELD}${joinRefs(command.cards.map(r))}`
    case 'chooseTargets':
      return `${head}${FIELD}${joinRefs(command.targets.map(r))}`
    case 'chooseMode':
      // Mode answers are indices into the pending's printed `labels`, not ids — already world-independent.
      return `${head}${FIELD}${[...command.modes].sort((a, b) => a - b).join(',')}`
    case 'chooseFromDeck': {
      // The CARD, not the position — the same rule the rest of this file follows, and for the same reason.
      //
      // Keys are built from the ACTOR's view (see `searchTree`), justified there by every command in this pool
      // having a public effect. A PRIVATE deck pick is the one that does not, and keying it by index made the
      // actor's own choice meaningless across worlds: `chooseFromDeck|p1|0` is Cloud in a world that sampled
      // Cloud on top and Undead Princess in the next (a false match), while "take the Cloud" is index 0 in one
      // and index 1 in the other (a false split). The chooser has always LOOKED at these cards before being
      // asked — `lookAtDeck` learns them for the controller before it suspends — so the actor's view can
      // always name them, and copies of one code are interchangeable exactly as they are in hand.
      const slots = view.fields[command.player].deck
      return `${head}${FIELD}${joinRefs(command.picks.map((i) => { const c = slots[i]?.card; return c == null ? OPAQUE : r(c) }))}`
    }
    case 'activateAbility': {
      // `abilityId` is a printed-clause identity, already world-independent — unlike a card id, it needs no
      // canonicalisation. The source and every CP source do, exactly as for a cast.
      const dull = joinRefs(command.payment.dullBackups.map(r))
      const discards = joinTagged(command.payment.discards.map((d) => [r(d.card), d.element] as const))
      const targets = joinRefs(command.targets.map(r))
      return `${head}${FIELD}${r(command.source)}${FIELD}${command.abilityId}${FIELD}${dull}${FIELD}${discards}${FIELD}${targets}`
    }
    case 'pass':
    case 'concede':
      return head
    // A new `Command` variant must fail to compile here rather than collapse into some other action's key.
    default: { const _exhaustive: never = command; return _exhaustive }
  }
}

// ---------------------------------------------------------------------------
// decodeAction
// ---------------------------------------------------------------------------

interface DecodeCtx {
  readonly view: PlayerView
  readonly player: PlayerId
  /** Key fields after `<type>|p<n>`, so `args[0]` is the first argument of every variant. */
  readonly args: readonly string[]
  /** The id this world gives a ref, or null when this world has no such card (an opaque ref included). */
  id(ref: string | undefined): CardId | null
  ids(field: string | undefined): CardId[] | null
  /** Does this world owe exactly the decision the key answers? A world that diverged does not. */
  pendingIs<K extends Pending['kind']>(kind: K): Extract<Pending, { kind: K }> | null
}

type Decoder = (ctx: DecodeCtx) => Command | null

const isElement = (s: string): s is Element => (ELEMENTS as readonly string[]).includes(s)

const distinct = (xs: readonly number[]): boolean => new Set(xs).size === xs.length

/**
 * One decoder per `Command` variant. A `Record` keyed on `Command['type']` rather than a switch with a `never`
 * default: the switch subject here is an untrusted string off a key, so it cannot carry the exhaustiveness
 * check itself — but a missing entry in this record does stop the file compiling.
 */
const DECODERS: Record<Command['type'], Decoder> = {
  chooseFirst: ({ player, args, pendingIs }) => {
    if (!pendingIs('chooseFirst')) return null
    const v = args[0]
    return v === 'first' || v === 'second' ? { type: 'chooseFirst', player, goFirst: v === 'first' } : null
  },
  mulligan: ({ player, args, pendingIs }) => {
    if (!pendingIs('mulligan')) return null
    const v = args[0]
    return v === 'redraw' || v === 'keep' ? { type: 'mulligan', player, redraw: v === 'redraw' } : null
  },
  chooseFromDeck: ({ player, args, pendingIs, view, ids }) => {
    const pending = pendingIs('chooseFromDeck')
    if (!pending || pending.player !== player) return null
    const raw = args[0] ?? ''
    if (raw === '') return pending.min === 0 ? { type: 'chooseFromDeck', player, picks: [] } : null
    // Contract 5 is "legal in THIS determinisation, or null" — so every check `applyChooseFromDeck` makes has
    // to be made here too. It used to make none of them: an index past the exposed slice, a repeat, more picks
    // than `max`, or a card the printed filter does not allow all decoded happily and threw inside `apply`.
    const wanted = ids(raw)
    if (wanted === null) return null
    const slots = view.fields[player].deck.slice(0, pending.count)
    const picks: number[] = []
    for (const id of wanted) {
      const i = slots.findIndex((sl, k) => sl.card === id && !picks.includes(k))
      if (i < 0) return null
      picks.push(i)
    }
    if (!distinct(picks) || picks.length < pending.min || picks.length > pending.max) return null
    for (const i of picks) {
      const code = slots[i]?.card == null ? undefined : view.cards[slots[i]!.card as CardId]?.code
      const def = code === undefined ? undefined : view.defs[code]
      if (!def || !matchesDefFilter(def, pending.filter)) return null
    }
    return { type: 'chooseFromDeck', player, picks }
  },
  castCharacter: (ctx) => decodeCast(ctx, 'castCharacter'),
  castSummon: (ctx) => decodeCast(ctx, 'castSummon'),
  activateAbility: ({ view, player, args, id, ids }) => {
    if (view.pending) return null
    const source = id(args[0])
    const abilityId = args[1]
    const dullBackups = ids(args[2])
    const items = splitTagged(args[3] ?? '')
    const targets = ids(args[4])
    if (source === null || !abilityId || !dullBackups || !items || !targets) return null
    const discards: { card: CardId; element: Element }[] = []
    for (const [ref, tag] of items) {
      const src = id(ref)
      if (src === null || !isElement(tag)) return null
      discards.push({ card: src, element: tag })
    }
    return { type: 'activateAbility', player, source, abilityId, payment: { dullBackups, discards }, targets }
  },
  declareAttack: ({ view, player, args, ids }) => {
    if (view.pending) return null
    const attackers = ids(args[0])
    return attackers && attackers.length > 0 ? { type: 'declareAttack', player, attackers } : null
  },
  declareBlock: ({ player, args, id, pendingIs }) => {
    if (!pendingIs('declareBlock')) return null
    if (args[0] === '-') return { type: 'declareBlock', player, blocker: null }
    const blocker = id(args[0])
    return blocker === null ? null : { type: 'declareBlock', player, blocker }
  },
  assignPartyDamage: ({ player, args, id, pendingIs }) => {
    if (!pendingIs('assignPartyDamage')) return null
    const items = splitTagged(args[0] ?? '')
    if (!items) return null
    const assignments: { target: CardId; amount: number }[] = []
    for (const [ref, tag] of items) {
      const target = id(ref)
      const amount = Number(tag)
      if (target === null || !/^\d+$/.test(tag) || !Number.isSafeInteger(amount)) return null
      assignments.push({ target, amount })
    }
    return { type: 'assignPartyDamage', player, assignments }
  },
  discardToHandSize: ({ player, args, ids, pendingIs }) => {
    const pending = pendingIs('discardToHandSize')
    const cards = ids(args[0])
    if (!pending || !cards || cards.length !== pending.count || !distinct(cards)) return null
    return { type: 'discardToHandSize', player, cards }
  },
  chooseTargets: ({ player, args, ids, pendingIs }) => {
    const pending = pendingIs('chooseTargets')
    const targets = ids(args[0])
    if (!pending || !targets || !distinct(targets)) return null
    if (targets.length < pending.min || targets.length > pending.max) return null
    // `apply` re-checks membership anyway (spec C1-6); checking it here is what makes a key naming a target
    // this world does not offer decode to null instead of to a command that throws.
    if (targets.some((t) => !pending.candidates.includes(t))) return null
    return { type: 'chooseTargets', player, targets }
  },
  chooseMode: ({ player, args, pendingIs }) => {
    const pending = pendingIs('chooseMode')
    if (!pending) return null
    const modes: number[] = []
    for (const s of splitList(args[0] ?? '')) {
      if (!/^\d+$/.test(s)) return null
      modes.push(Number(s))
    }
    if (modes.length < pending.min || modes.length > pending.max || !distinct(modes)) return null
    if (modes.some((m) => m >= pending.labels.length)) return null
    return { type: 'chooseMode', player, modes }
  },
  pass: ({ view, player }) => (view.pending ? null : { type: 'pass', player }),
  concede: ({ player }) => ({ type: 'concede', player }),   // §2.1: always legal
}

function decodeCast({ view, player, args, id, ids }: DecodeCtx, type: 'castCharacter' | 'castSummon'): Command | null {
  if (view.pending) return null
  const card = id(args[0])
  const dullBackups = ids(args[1])
  const items = splitTagged(args[2] ?? '')
  if (card === null || !dullBackups || !items) return null
  const discards: { card: CardId; element: Element }[] = []
  for (const [ref, tag] of items) {
    const src = id(ref)
    if (src === null || !isElement(tag)) return null
    discards.push({ card: src, element: tag })
  }
  return { type, player, card, payment: { dullBackups, discards } }
}

export function decodeAction(view: PlayerView, key: ActionKey): Command | null {
  const parts = key.split(FIELD)
  const decoder = (DECODERS as Record<string, Decoder | undefined>)[parts[0] ?? '']
  const player: PlayerId | null = parts[1] === 'p0' ? 0 : parts[1] === 'p1' ? 1 : null
  if (!decoder || player === null) return null
  const idx = indexFor(view, view.me)
  // Consumption spans the WHOLE command, not one list: interchangeable copies share a ref, so a cast whose
  // payment discards another copy of the card being cast would otherwise decode both to the same id and be
  // rejected as "cannot discard the card you are casting". Decoding in field order hands out distinct copies.
  const taken = new Map<CardRef, number>()
  const take = (ref: CardRef): CardId | null => {
    const n = taken.get(ref) ?? 0
    const v = idx.byRef.get(ref)?.[n]
    if (v === undefined) return null
    taken.set(ref, n + 1)
    return v
  }
  const ctx: DecodeCtx = {
    view,
    player,
    args: parts.slice(2),
    id: (ref) => (ref === undefined ? null : take(ref)),
    ids: (field) => {
      if (field === undefined) return null
      const out: CardId[] = []
      for (const ref of splitList(field)) {
        const v = take(ref)
        if (v === null) return null
        out.push(v)
      }
      return out
    },
    pendingIs: (kind) => {
      const p = view.pending
      return p !== null && p.kind === kind && p.player === player ? (p as Extract<Pending, { kind: typeof kind }>) : null
    },
  }
  return decoder(ctx)
}

// ---------------------------------------------------------------------------
// observationKey
// ---------------------------------------------------------------------------

function fieldDigest(view: PlayerView, p: PlayerId): string {
  const f = view.fields[p]
  const code = (id: CardId): string => view.cards[id]?.code ?? OPAQUE
  // Position is carried by array order, so the digest holds only what a card IS and what has happened to it —
  // no id survives, which is what makes two worlds that differ only in synthetic numbering agree here.
  const card = (c: FieldCard): string => [
    code(c.id), c.status, c.damage, c.enteredTurn, c.attackedThisTurn ? 1 : 0,
    [...c.granted].sort(cmpStr).join('+'), c.powerBonus, [...c.flags].sort(cmpStr).join('+'),
    // SORTED: `usedThisTurn` is semantically a set (spec C10-1), and two positions that differ only in the
    // order two abilities were spent are the same information set. Unsorted, they would split the tree.
    [...c.usedThisTurn].sort(cmpStr).join('+'),
  ].join('/')
  // Break Zone entries carry an eligibility BIT beside the code, positionally (spec C10-2). By code alone,
  // two copies of one card in the Break Zone digest identically while only one is retrievable — and `z0:0`
  // and `z0:1` are then different legal actions the key could not tell apart.
  const bzEntry = (id: CardId, p: PlayerId): string =>
    `${code(id)}${view.fields[p].putIntoBreakZoneFromFieldThisTurn.includes(id) ? '!' : ''}`
  // Deck SLOTS, not a bare count (spec C9-5). A position this viewer knows digests as its code — stable
  // across determinisations, because a known slot is pinned rather than sampled. One it does not know digests
  // as the mask alone, so "the opponent knows their top three" is a different information set from "they do
  // not", while never naming a card the viewer cannot see.
  // The mask travels in BOTH branches. It used to be dropped whenever the card was visible, so a top card the
  // root alone knows and the same card the OPPONENT also knows digested identically — two positions the root
  // can plainly tell apart, and which imply different things about what the opponent will do next.
  const slot = (sl: { card: CardId | null; knownBy: number }): string => `${sl.card !== null ? code(sl.card) : '?'}${sl.knownBy}`
  return [
    `dk[${f.deck.map(slot).join(',')}]`, `hd${f.handCount}`,
    `fw[${f.forwards.map(card).join(',')}]`, `bk[${f.backups.map(card).join(',')}]`,
    `dz[${f.damageZone.map(code).join(',')}]`, `bz[${f.breakZone.map((id) => bzEntry(id, p)).join(',')}]`,
    // Removed cards are public and permanent; two states differing in what has left the game are different.
    `rm[${f.removedFromGame.map(code).join(',')}]`,
  ].join(';')
}

function triggerDigest(view: PlayerView, e: TriggerEvent | null): string {
  const r = (id: CardId): CardRef => cardRef(view, id, view.me)
  if (e === null) return '-'
  switch (e.kind) {
    case 'damage':
      return `dmg.${r(e.source)}.${e.sourceController}.${e.target === null ? '-' : r(e.target)}.${e.victim ?? '-'}.${e.amount}`
    case 'zoneChange':
      return `zc.${r(e.card)}.${e.from}.${e.to}.${e.controller}.${e.owner}`
    case 'enteredField':
      return `ef.${r(e.card)}.${e.controller}`
    default: { const _exhaustive: never = e; return _exhaustive }
  }
}

function frameDigest(view: PlayerView, f: Frame | null): string {
  if (f === null) return '-'
  const r = (id: CardId): CardRef => cardRef(view, id, view.me)
  // `path` and `modes` are program-counter indices, already world-independent. `chosen` is a binding whose
  // order no effect depends on, so it normalises like every other set.
  return [f.abilityId, r(f.source), f.controller, f.path.join('.'), joinRefs(f.chosen.map(r)), triggerDigest(view, f.triggerEvent), f.modes.join('.')].join('/')
}

function resolutionDigest(view: PlayerView, res: Resolution): string {
  // `steps` is real, observable resource state (it is what `MAX_RESOLUTION_STEPS` bounds), so two positions
  // that differ only in how much agenda budget is left are genuinely different positions.
  return `${frameDigest(view, res.active)}~[${res.queue.map((f) => frameDigest(view, f)).join(',')}]~${res.continuation ?? '-'}~${res.steps}`
}

function pendingDigest(view: PlayerView, pending: Pending | null): string {
  if (pending === null) return '-'
  const r = (id: CardId): CardRef => cardRef(view, id, view.me)
  const head = `${pending.kind}/${pending.player}`
  switch (pending.kind) {
    case 'chooseFirst':
    case 'mulligan':
    case 'declareBlock':
    case 'assignPartyDamage':
      return head
    case 'discardToHandSize':
      return `${head}/${pending.count}`
    case 'chooseTargets':
      return `${head}/${pending.min}-${pending.max}/${joinRefs(pending.candidates.map(r))}`
    case 'chooseMode':
      // Labels are printed wording, and JSON-quoted so a label containing a separator cannot forge one.
      return `${head}/${pending.min}-${pending.max}/${pending.labels.map((l) => JSON.stringify(l)).join(',')}`
    case 'chooseFromDeck': {
      // Counts and the printed FILTER — no card ids, and nothing that differs between two determinisations of
      // the same position. It digested the resolved index list until the C9 review, which was neither: those
      // positions were computed against the real deck, so two worlds sampling different decks under one
      // information set produced different keys, splitting the tree on something no observer can see.
      const f = pending.filter
      const filter = f === undefined ? '-' : JSON.stringify(Object.keys(f).sort().map((k) => [k, (f as Record<string, unknown>)[k]]))
      return `${head}/${pending.min}-${pending.max}/n${pending.count}/f${filter}/${pending.to}`
    }
    default: { const _exhaustive: never = pending; return _exhaustive }
  }
}

export function observationKey(view: PlayerView): ObservationKey {
  const r = (id: CardId): CardRef => cardRef(view, id, view.me)
  const at = view.attack
  // The root's own hand is a MULTISET of codes: hand position is not observable to anyone (`h:` refs are by
  // code and occurrence), so two worlds that drew the same cards in a different order are the same information set.
  const hand = view.hand.map((id) => view.cards[id]?.code ?? OPAQUE).sort(cmpStr).join(',')
  return [
    `me${view.me}`, `t${view.turn}`, `tp${view.turnPlayer}`, view.phase, `pr${view.priority}`,
    `fp${view.firstPlayer}`, `mu${view.mulliganDecided.map((b) => (b ? 1 : 0)).join('')}`,
    // Rung E6 added a structured `cause` beside `reason`. Either would serve here — `winner` is already in
    // this key, so the two are equivalent discriminators — and `reason` is kept only because changing a key
    // STRING changes information-set identity, and with it the search tree and every measured win rate, for
    // no gain. What matters is that the terminal state carries more than "over": two endings that differ
    // only in how they ended are different information sets.
    `end:${view.result === null ? '-' : `${view.result.winner ?? 'draw'}/${view.result.reason}`}`,
    `hand[${hand}]`,
    `F0:${fieldDigest(view, 0)}`,
    `F1:${fieldDigest(view, 1)}`,
    `atk:${at === null ? '-' : `${at.step}/${joinRefs(at.attackers.map(r))}/${at.blocker === null ? '-' : r(at.blocker)}`}`,
    `pend:${pendingDigest(view, view.pending)}`,
    `res:${resolutionDigest(view, view.resolution)}`,
  ].join(FIELD)
}

/** Pins the implementations to the documented contract — a signature drift stops compiling here. */
export const KEY_CONTRACT: KeyContract = { cardRef, actionKey, observationKey, decodeAction }

// ---------------------------------------------------------------------------
// The worker-safe search seam (spec D-7)
// ---------------------------------------------------------------------------

/**
 * Everything the search needs, and nothing it must not have (spec D-9). There is deliberately no
 * `GameState` here: the search derives every simulated world from a `PlayerView` plus the two publicly
 * declared deck lists, so it cannot read the live game even by accident.
 *
 * Structured-cloneable by construction, so D2 can post it to a Web Worker unchanged.
 */
export interface SearchInput {
  readonly view: PlayerView
  /** Both players' publicly declared lists. Semantically a MULTISET — sort a copy before sampling. */
  readonly decks: readonly [readonly string[], readonly string[]]
  readonly iterations: number
  /** Seeds the world sampling, expansion and tie-breaking streams — kept separate (spec D-8). */
  readonly seed: number
  readonly rolloutCommandCap: number
  readonly explorationC: number
  /**
   * D7: collect the rollout apply ATTRIBUTION for this search. Diagnostic only — it changes nothing about
   * which command comes back, and is off unless a measurement asks for it. A plain boolean because
   * `SearchInput` crosses the worker boundary by `structuredClone`, which cannot carry a function.
   */
  readonly profile?: boolean
}

/** Counters that make cost measurable rather than guessed (spec D-A4). */
export interface SearchDiagnostics {
  /**
   * D7: where the rollout applies went, present only when `SearchInput.profile` asked for it. The four apply
   * buckets sum to `rolloutApplies`; see `RolloutProfile`.
   */
  readonly rollout?: RolloutProfile
  readonly determinisations: number
  readonly treeApplies: number
  readonly rolloutApplies: number
  readonly evaluations: number
  readonly nodes: number
  readonly maxCommandDepth: number
  /** Root children as `[ActionKey, visits, meanReward]`, best first — the search's own explanation. */
  readonly rootChildren: readonly (readonly [ActionKey, number, number])[]
}

export interface SearchResult {
  readonly command: Command
  readonly diagnostics: SearchDiagnostics
}
