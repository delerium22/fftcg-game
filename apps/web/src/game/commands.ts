import {
  HAND_SIZE_LIMIT, seedRng,
  type CardId, type Command, type GameState, type Payment, type PlayerId, type PlayerState, type PlayerView,
} from '@fftcg/engine'
import { preferredPayment } from '@fftcg/ai'
import type { Choice, ChoiceSet } from './types.js'

const PHASE_LABEL: Record<string, string> = {
  setup: 'Setup', active: 'Active Phase', draw: 'Draw Phase',
  main1: 'Main Phase 1', attack: 'Attack Phase', main2: 'Main Phase 2', end: 'End Phase',
}

/** Card names only — the board already shows the art and the id, so the CLI's `Name (CODE)` is noise in a GUI. */
function name(v: PlayerView, id: CardId): string {
  const inst = v.cards[id]
  if (!inst) return `#${id}`
  return v.defs[inst.code]?.name ?? inst.code
}

/** English label for one command, from the acting player's point of view. Ported from `apps/cli/src/render.ts`. */
export function describeChoice(v: PlayerView, c: Command): string {
  switch (c.type) {
    case 'chooseFirst': return c.goFirst ? 'Take the first turn' : 'Let the opponent go first'
    case 'mulligan': return c.redraw ? 'Mulligan (redraw 5)' : 'Keep hand'
    case 'castCharacter':
    case 'castSummon': {
      const pay = [...c.payment.dullBackups.map((id) => `dull ${name(v, id)}`), ...c.payment.discards.map((d) => `discard ${name(v, d.card)} as ${d.element}`)]
      return pay.length ? `Cast ${name(v, c.card)} paying: ${pay.join(', ')}` : `Cast ${name(v, c.card)} (free)`
    }
    case 'declareAttack': return `Attack with ${c.attackers.map((id) => name(v, id)).join(' + ')}`
    case 'declareBlock': return c.blocker === null ? "Don't block" : `Block with ${name(v, c.blocker)}`
    case 'assignPartyDamage': return `Assign damage: ${c.assignments.map((a) => `${a.amount} → ${name(v, a.target)}`).join(', ')}`
    case 'discardToHandSize': return `Discard ${c.cards.map((id) => name(v, id)).join(', ')}`
    case 'pass': return 'Pass'
    case 'concede': return 'Concede'
  }
}

/** Mirrors `legalCommands`/`actingPlayer` against the view: `pending` outranks `priority` (see engine `legal.ts`). */
function actingIn(v: PlayerView): PlayerId | null {
  if (v.result) return null
  return v.pending?.player ?? v.priority
}

/** One line stating what the game is waiting for, derived from `pending` first, then `phase`/`attack.step`. */
export function promptFor(v: PlayerView): string {
  if (v.result) return v.result.winner === null ? 'Game over — a draw' : v.result.winner === v.me ? 'Game over — you win' : 'Game over — the AI wins'
  if (actingIn(v) !== v.me) return 'Waiting for the opponent…'
  if (v.pending) {
    switch (v.pending.kind) {
      case 'chooseFirst': return 'Choose who goes first'
      case 'mulligan': return 'Keep your hand or mulligan'
      case 'discardToHandSize': return `Discard down to ${HAND_SIZE_LIMIT} cards`
      case 'declareBlock': return 'Choose a blocker'
      case 'assignPartyDamage': return 'Assign combat damage'
    }
  }
  switch (v.phase) {
    case 'main1': return 'Main Phase 1 — cast, attack, or pass'
    case 'main2': return 'Main Phase 2 — cast or pass'
    case 'attack': return v.attack?.step === 'declaration' ? 'Attack Phase — declare an attack or pass' : `Attack Phase — ${v.attack?.step ?? 'resolving'}`
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
    case 'chooseFirst': case 'mulligan': case 'pass': case 'concede': return []
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
export function buildChoiceSet(v: PlayerView, legal: Command[]): ChoiceSet {
  const all: Choice[] = []
  const byCard = new Map<CardId, Choice[]>()
  const loose: Choice[] = []
  for (const command of legal) {
    const subjects = subjectsOf(command)
    const choice: Choice = { command, label: describeChoice(v, command), card: subjects[0] ?? null }
    all.push(choice)
    if (!subjects.length) { loose.push(choice); continue }
    for (const id of subjects) byCard.set(id, [...(byCard.get(id) ?? []), choice])
  }
  return { all, byCard, loose, prompt: promptFor(v) }
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
    case 'pass': case 'concede': return true
    default: { const _exhaustive: never = a; return _exhaustive }
  }
}

type CastCommand = Extract<Command, { type: 'castCharacter' | 'castSummon' }>
const isCast = (c: Command): c is CastCommand => c.type === 'castCharacter' || c.type === 'castSummon'

/**
 * `preferredPayment` reads only the acting player's own backups, hand and the shared card/def tables — all of it
 * already in the human's own `PlayerView` — but its signature takes a `GameState`. Rebuild the minimum of one
 * rather than threading `GameState` into the view layer (spec B3: the React tree never sees it). Both decks and
 * the opponent's hand stay empty: nothing hidden goes in, so nothing hidden can come back out in a payment.
 */
function stateShim(v: PlayerView): GameState {
  const side = (p: PlayerId): PlayerState => ({
    deck: [], hand: p === v.me ? [...v.hand] : [],
    forwards: v.fields[p].forwards, backups: v.fields[p].backups,
    damageZone: v.fields[p].damageZone, breakZone: v.fields[p].breakZone,
    mulliganDecided: v.mulliganDecided[p],
  })
  return {
    rng: seedRng(0), turn: v.turn, turnPlayer: v.turnPlayer, firstPlayer: v.firstPlayer, phase: v.phase,
    attack: v.attack, priority: v.priority, pending: v.pending, players: [side(0), side(1)],
    cards: v.cards, defs: v.defs, result: v.result,
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
  const casts = legal.filter(isCast)
  if (!casts.length) return legal
  const keep = new Map<CardId, Command>()
  for (const c of casts) if (!keep.has(c.card)) keep.set(c.card, c)
  const shim = stateShim(v)
  for (const card of [...keep.keys()]) {
    const preferred = preferredPayment(shim, v.me, card)
    if (!preferred) continue
    const match = casts.find((c) => c.card === card && samePayment(c.payment, preferred))
    if (match) keep.set(card, match)
  }
  const seen = new Set<CardId>()
  const out: Command[] = []
  for (const c of legal) {
    if (!isCast(c)) { out.push(c); continue }
    if (seen.has(c.card)) continue
    seen.add(c.card)
    out.push(keep.get(c.card) ?? c)
  }
  return out
}
