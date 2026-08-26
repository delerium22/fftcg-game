import {
  HAND_SIZE_LIMIT, effectivePower, seedRng,
  type Ability, type CardDef, type CardId, type Command, type Effect, type FieldCard, type FieldFlag, type Frame,
  type GameState, type Keyword, type Payment, type Pending, type PlayerId, type PlayerState, type PlayerView,
} from '@fftcg/engine'
import { preferredPayment } from '@fftcg/ai'
import type { Choice, ChoiceSet } from './types.js'

const PHASE_LABEL: Record<string, string> = {
  setup: 'Setup', active: 'Active Phase', draw: 'Draw Phase',
  main1: 'Main Phase 1', attack: 'Attack Phase', main2: 'Main Phase 2', end: 'End Phase',
}

const KEYWORD_LABEL: Record<Keyword, string> = { haste: 'Haste', brave: 'Brave', firstStrike: 'First Strike', backAttack: 'Back Attack' }
const FLAG_PURPOSE: Record<FieldFlag, string> = { cannotBeBroken: 'to protect from being broken' }
const signed = (n: number): string => (n >= 0 ? `+${n}` : `${n}`)
const only = <T,>(s: Set<T>): T | null => (s.size === 1 ? ([...s][0] as T) : null)

function defFor(v: PlayerView, id: CardId): CardDef | undefined {
  const code = v.cards[id]?.code
  return code === undefined ? undefined : v.defs[code]
}

/** Card names only — the board already shows the art and the id, so the CLI's `Name (CODE)` is noise in a GUI. */
function name(v: PlayerView, id: CardId): string {
  return defFor(v, id)?.name ?? v.cards[id]?.code ?? `#${id}`
}

/** "A", "A and B", "A, B and C" — target sets are read aloud off a button, so a bare comma list reads badly. */
function listNames(v: PlayerView, ids: readonly CardId[]): string {
  const names = ids.map((id) => name(v, id))
  return names.length <= 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`
}

/** The printed wording of mode `i`, from the `chooseMode` pending the command answers. */
const modeLabel = (v: PlayerView, i: number): string => (v.pending?.kind === 'chooseMode' ? v.pending.labels[i] ?? `mode ${i + 1}` : `mode ${i + 1}`)

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
  return active ? `${name(v, active.frame.source)}: ${text.charAt(0).toLowerCase()}${text.slice(1)}` : text
}

/**
 * The effect node `path` points at, mirroring `effectAt` in the engine's resolve.ts. Duplicated rather than
 * imported because the engine keeps it private, and the cost of drift is bounded: this drives WORDING only,
 * and every caller falls back to neutral phrasing when it returns null.
 */
function nodeAt(effects: readonly Effect[], path: readonly number[], modes: readonly number[], depth: number): Effect | null {
  const i = path[depth]
  if (i === undefined) return null
  const eff = effects[i]
  if (!eff) return null
  if (depth === path.length - 1) return eff
  if (eff.kind === 'chooseTargets') return nodeAt(eff.then, path, modes, depth + 1)
  if (eff.kind === 'chooseModes') {
    // `chooseModes` owns two levels: the ordinal of the chosen mode, then the effect index inside it.
    const k = path[depth + 1]
    if (k === undefined) return null
    const mode = eff.modes[modes[k] ?? -1]
    return mode ? nodeAt(mode.effects, path, modes, depth + 2) : null
  }
  return null
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
  const exact = nodeAt(active.ability.effects, active.frame.path, active.frame.modes, 0)
  let node: Extract<Effect, { kind: 'chooseTargets' }> | null = exact?.kind === 'chooseTargets' ? exact : null
  if (!node) { walk(active.ability.effects); node = found.length === 1 ? found[0] ?? null : null }
  if (!node) return null
  for (const e of node.then) { const w = verbOf(e); if (w) return w }
  return null
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
    // A mode has no card subject, so its button IS the printed wording — never a paraphrase of it.
    case 'chooseMode': return c.modes.length ? c.modes.map((i) => modeLabel(v, i)).join(' + ') : 'None of these'
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
      // Both ability prompts name the card that is asking and what the choice is FOR — "choose 2 targets" tells
      // the player nothing they can act on. The wording is derived from the clause's own AST, never hard-coded.
      case 'chooseTargets': {
        const { min, max, candidates } = v.pending
        const purpose = targetVerb(v, v.pending)?.purpose
        return sourced(v, `Choose ${countPhrase(min, max)} ${candidateNoun(v, candidates, max !== 1)}${purpose ? ` ${purpose}` : ''}`)
      }
      case 'chooseMode': {
        const { min, max, labels } = v.pending
        return sourced(v, `Choose ${countPhrase(min, max)} of the ${labels.length} following effect${labels.length === 1 ? '' : 's'}`)
      }
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
    // Spec B-A4 + C1-6: the subjects of a target answer are exactly its targets, so the board lights up the
    // legal candidates and nothing else — clicking one is how the set gets picked.
    case 'chooseTargets': return [...c.targets]
    // `chooseMode` has no card subject at all: its options are printed wordings, so they are strip buttons.
    case 'chooseFirst': case 'mulligan': case 'chooseMode': case 'pass': case 'concede': return []
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
    case 'chooseTargets': return sameIds([...a.targets], [...(b as typeof a).targets])
    case 'chooseMode': return sameIds([...a.modes], [...(b as typeof a).modes])
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
    attack: v.attack, priority: v.priority, pending: v.pending, resolution: v.resolution, players: [side(0), side(1)],
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
