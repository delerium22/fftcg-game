import type { CardDef, PlayerId } from './types.js'
import { KEYWORDS, opponentOf } from './types.js'
import type { Effect, TargetFilter, TargetSpec } from './abilities.js'
import { EMPTY_RESOLUTION, FIELD_FLAGS } from './abilities.js'
import type { CardId, CardInstance, GameState, PlayerState } from './state.js'
import { updatePlayer } from './state.js'
import { nextInt, seedRng, shuffle } from './rng.js'
import type { Event } from './events.js'
import { IllegalCommandError } from './errors.js'
import { startTurn } from './phases.js'

export interface CreateGameOptions { seed: number; decks: [string[], string[]]; defs: CardDef[]; skipDeckValidation?: boolean; /** Rung J8: each player's LB deck list (§7.14), none by default. */ lbDecks?: [string[], string[]] }

export function validateDeck(defs: Record<string, CardDef>, codes: string[]): string[] {
  const problems: string[] = []
  if (codes.length !== 50) problems.push(`main deck must have exactly 50 cards (§8.1.1.1), has ${codes.length}`)
  const counts = new Map<string, number>()
  for (const c of codes) {
    if (!defs[c]) { problems.push(`unknown card code ${c}`); continue }
    if (defs[c]?.limitBreak !== undefined) problems.push(`${c} has Limit Break and belongs in the LB deck, not the main deck (§8.1.3)`)
    counts.set(c, (counts.get(c) ?? 0) + 1)
  }
  for (const [c, n] of counts) if (n > 3) problems.push(`${c} appears ${n} times; max 3 copies (§8.1.1.2)`)
  return problems
}

/** §8.1.1.1–.3 (rung J8): up to eight cards, ≤3 copies, every one a Limit Break card. Empty is fine. */
export function validateLbDeck(defs: Record<string, CardDef>, codes: string[]): string[] {
  const problems: string[] = []
  if (codes.length > 8) problems.push(`an LB deck holds at most eight cards (§8.1.1.1), has ${codes.length}`)
  const counts = new Map<string, number>()
  for (const c of codes) {
    if (!defs[c]) { problems.push(`unknown card code ${c}`); continue }
    const x = defs[c]?.limitBreak
    if (x === undefined) problems.push(`${c} has no Limit Break and may not be in an LB deck (§8.1.3)`)
    else if (!Number.isInteger(x) || x < 1) problems.push(`${c} has LB cost ${String(x)}; it must be a whole number above 0 (§15.2.8.2)`)   // J8 second review L3
    counts.set(c, (counts.get(c) ?? 0) + 1)
  }
  for (const [c, n] of counts) if (n > 3) problems.push(`${c} appears ${n} times; max 3 copies (§8.1.1.2)`)
  return problems
}

function emptyPlayer(): PlayerState {
  return { deck: [], hand: [], lbDeck: [], forwards: [], backups: [], damageZone: [], breakZone: [], removedFromGame: [], putIntoBreakZoneFromFieldThisTurn: [], mulliganDecided: false }
}

/**
 * Rung J6-D9: a continuous static that arrived through JSON is checked once, here — a non-finite amount or an
 * instance axis in its scope would poison every reader of power, keywords and flags.
 */
export function validateContinuousStatics(defs: readonly CardDef[]): string[] {
  const problems: string[] = []
  // Rung V1-A3: `sameElementAsChosen` is refused here too — a continuous effect has no choice to resolve it against.
  const instanceAxes = ['minPower', 'maxPower', 'status', 'grantedKeyword', 'excludeSource', 'excludeSourceName', 'putIntoBreakZoneFromFieldThisTurn', 'sameElementAsChosen']
  for (const d of defs) {
    for (const a of d.abilities ?? []) {
      if (a.trigger.kind !== 'static') continue
      const e = a.trigger.effect
      if (e.kind === 'modifyPower' && !Number.isFinite(e.amount)) problems.push(`${d.code}: ${a.id} has a non-finite amount`)
      if (e.kind === 'grantKeyword' && !KEYWORDS.includes(e.keyword)) problems.push(`${d.code}: ${a.id} grants unknown keyword ${String(e.keyword)}`)
      if (e.kind === 'grantFlag' && !FIELD_FLAGS.includes(e.flag)) problems.push(`${d.code}: ${a.id} grants unknown flag ${String(e.flag)}`)
      if (e.kind === 'modifyPower' || e.kind === 'grantKeyword' || e.kind === 'grantFlag') {
        for (const k of filterKeys(e.to.filter)) if (instanceAxes.includes(k)) problems.push(`${d.code}: ${a.id} scopes on instance axis ${k}`)
        if (!['self', 'opponent', 'any'].includes(e.to.controller)) problems.push(`${d.code}: ${a.id} has an unknown scope controller`)
        if (e.to.self !== undefined && e.to.self !== true) problems.push(`${d.code}: ${a.id} has a scope \`self\` that is not true`)
      }
      // Rung V1-A1 (spec V1-D6): a condition's filter is definition-only, like a scope's, and its count a whole number ≥ 1.
      const when = e.kind === 'produceElement' ? undefined : e.when
      if (when?.kind === 'controlsAtLeast') {
        for (const k of filterKeys(when.filter)) if (instanceAxes.includes(k)) problems.push(`${d.code}: ${a.id} counts on instance axis ${k}`)
        if (!Number.isInteger(when.count) || when.count < 1) problems.push(`${d.code}: ${a.id} has a condition count ${String(when.count)}; it must be a whole number ≥ 1`)
        if (!['self', 'opponent'].includes(when.controller)) problems.push(`${d.code}: ${a.id} has an unknown condition controller`)
      }
    }
  }
  return problems
}

/**
 * Every key a filter uses, an `anyOf` member's included (rung V1-A3): a member is typed `DefFilter`, but data arriving
 * through JSON is not typed, and an instance axis inside a disjunction would read the state as surely as one outside.
 */
function filterKeys(filter: object | undefined): string[] {
  if (!filter) return []
  const anyOf = (filter as { anyOf?: unknown }).anyOf
  const members = Array.isArray(anyOf) ? anyOf.flatMap((m: unknown) => (typeof m === 'object' && m !== null ? filterKeys(m) : [])) : []
  return [...Object.keys(filter), ...members]
}

/** Does this filter carry the resolved axis `sameElementAsChosen`, at the top or inside an `anyOf` member? */
const resolvesChosen = (filter: TargetFilter | undefined): boolean => filterKeys(filter).includes('sameElementAsChosen')

/**
 * Rung V1-A2: the effect shapes the executor trusts, checked once at game creation for data arriving through JSON.
 * Walks every nesting — `then`, `do`, modes, `if` branches — since a node is as reachable deep as at the top.
 */
export function validateEffects(defs: readonly CardDef[]): string[] {
  const problems: string[] = []
  // `bound` is the spec the nearest enclosing chooser or `forEach` binds `chosen` from — null under `onSubject`.
  // `byChoice`: that binding is a `chooseTargets`'s (not a `forEach`'s). `resolving`: a node here is certainly reached
  // at RESOLUTION — under a select or an `if`, where declaration has ended — so a choice here is not declared.
  const walk = (code: string, id: string, effects: readonly Effect[], bound: TargetSpec | null, byChoice: boolean, resolving: boolean): void => {
    // Rung V1-A3 (R1): `sameElementAsChosen` resolves against a card an enclosing CHOICE bound, and only as the item
    // resolves — a declared choice is made before anything is bound for it to read.
    const sameElement = (where: string): void => { problems.push(`${code}: ${id} uses sameElementAsChosen ${where}`) }
    for (const e of effects) {
      switch (e.kind) {
        case 'chooseTargets':
          if (resolvesChosen(e.from.filter) && !(byChoice && (e.select !== undefined || resolving))) sameElement('on a choice declared before any card is bound')
          if (e.select !== undefined && !['self', 'opponent'].includes(e.select)) problems.push(`${code}: ${id} has an unknown select ${String(e.select)}`)
          if (e.onlyIfChosen !== undefined && e.onlyIfChosen !== true) problems.push(`${code}: ${id} has an \`onlyIfChosen\` that is not true`)
          // Spec V1-D11: a hand is private, so it is only ever your own, and only selected — never a declared choice,
          // which would name a hidden card on the stack for the whole of its wait.
          if (e.from.zone === 'hand' && e.from.controller !== 'self') problems.push(`${code}: ${id} targets a hand that is not your own`)
          if (e.from.zone === 'hand' && e.select !== 'self') problems.push(`${code}: ${id} targets a hand without being a select by its controller`)
          // V1-A2 review M2: while a picked HAND card is still in hand, a nested prompt would leave its id in the frame's
          // `chosen`/`declared` — public on the stack, and card ids name codes (they are minted in decklist order).
          // So a prompt under a hand select must come after the card has left (Porom discards first).
          if (e.from.zone === 'hand') {
            for (const t of e.then) {
              if (t.kind === 'discard' || t.kind === 'playOntoField') break
              if (suspends(t)) { problems.push(`${code}: ${id} prompts while a hand pick is still in hand`); break }
            }
          }
          walk(code, id, e.then, e.from, true, resolving || e.select !== undefined)
          break
        case 'chooseModes': for (const m of e.modes) walk(code, id, m.effects, bound, byChoice, resolving); break
        case 'forEach':
          if (e.from.zone === 'hand') problems.push(`${code}: ${id} iterates over a hand, which is private`)
          if (resolvesChosen(e.from.filter)) sameElement('on a forEach, which chooses nothing')
          walk(code, id, e.do, e.from, false, resolving); break
        case 'onSubject': walk(code, id, e.do, null, false, resolving); break
        case 'if':
          if (e.when.kind === 'subjectMatches' && resolvesChosen(e.when.filter)) sameElement('in a condition')
          walk(code, id, e.then, bound, byChoice, true); walk(code, id, e.else ?? [], bound, byChoice, true); break
        // Luso's search: resolved against the enclosing choice's card as the pending is raised (resolve.ts).
        case 'lookAtDeck':
          if (resolvesChosen(e.take.filter) && !byChoice) sameElement('in a search with no choice before it')
          break
        case 'damage':
          if (typeof e.amount !== 'number' && resolvesChosen(e.amount.per.filter)) sameElement('in a counted amount')
          break
        // Rung V1-A2 (R2): only a Character is played onto a field, so the binding's filter must rule a Summon out.
        case 'playOntoField': {
          const f = bound?.filter
          const characters = f?.type !== undefined ? f.type !== 'summon' : f?.types !== undefined && f.types.length > 0 && !f.types.includes('summon')
          if (!characters) problems.push(`${code}: ${id} plays a card whose filter admits a Summon`)
          break
        }
        // Leaves: nothing nested. Listed so a new CONTAINER kind fails to compile here instead of going unwalked.
        case 'dull': case 'freeze': case 'breakCard': case 'putIntoBreakZone': case 'activate': case 'discard': case 'addPower': case 'grantKeyword': case 'grantFlag':
        case 'moveToHand': case 'draw': break
        default: { const _exhaustive: never = e; return _exhaustive }
      }
    }
  }
  // An activated ability may open with a select since V1-A3 (R10): `declarationNode` leaves it to resolution.
  for (const d of defs) for (const a of d.abilities ?? []) {
    if (a.trigger.kind === 'observesEnterField' && resolvesChosen(a.trigger.filter)) problems.push(`${d.code}: ${a.id} uses sameElementAsChosen in a trigger condition`)
    walk(d.code, a.id, a.effects, null, false, false)
  }
  return problems
}

/** Can this effect (or anything nested in it) raise a prompt? */
function suspends(e: Effect): boolean {
  switch (e.kind) {
    case 'chooseTargets': case 'chooseModes': case 'lookAtDeck': return true
    case 'forEach': case 'onSubject': return e.do.some(suspends)
    case 'if': return e.then.some(suspends) || (e.else ?? []).some(suspends)
    default: return false
  }
}

export function createGame(opts: CreateGameOptions): GameState {
  const bad = validateContinuousStatics(opts.defs)
  if (bad.length) throw new Error(`invalid continuous statics: ${bad.join('; ')}`)
  const badEffects = validateEffects(opts.defs)
  if (badEffects.length) throw new Error(`invalid effects: ${badEffects.join('; ')}`)
  const defs = Object.fromEntries(opts.defs.map((d) => [d.code, d]))
  if (!opts.skipDeckValidation) {
    for (const p of [0, 1] as const) {
      const problems = validateDeck(defs, opts.decks[p])
      if (problems.length) throw new Error(`player ${p} deck invalid: ${problems.join('; ')}`)
      const lbProblems = validateLbDeck(defs, opts.lbDecks?.[p] ?? [])
      if (lbProblems.length) throw new Error(`player ${p} LB deck invalid: ${lbProblems.join('; ')}`)
    }
  }
  let rng = seedRng(opts.seed)
  const cards: Record<CardId, CardInstance> = {}
  const players: [PlayerState, PlayerState] = [emptyPlayer(), emptyPlayer()]
  let id = 1
  for (const p of [0, 1] as const) {
    const ids: CardId[] = []
    for (const code of opts.decks[p]) { cards[id] = { id, code, owner: p }; ids.push(id++) }
    const [shuffled, r] = shuffle(rng, ids)   // §8.2.1.1
    rng = r
    players[p].deck = shuffled
    // §7.14 / §8.2.1.1 (rung J8): the LB deck, face down, in list order — not shuffled (§8.2.1.1 does not require it).
    for (const code of opts.lbDecks?.[p] ?? []) { cards[id] = { id, code, owner: p }; players[p].lbDeck.push({ id: id++, faceUp: false }) }
  }
  const [chooser, r2] = nextInt(rng, 2)     // §8.2.1.2
  return {
    rng: r2, turn: 0, turnPlayer: 0, firstPlayer: 0, phase: 'setup', attack: null, priority: chooser as PlayerId,
    pending: { kind: 'chooseFirst', player: chooser as PlayerId }, resolution: EMPTY_RESOLUTION,
    passes: 0, stack: [],
    players, cards, knownBy: {}, defs, result: null,
  }
}

/** Move n cards from top of deck to hand. Caller handles the empty-deck loss rule (§3.1.2) — see Task 5 drawCards. */
export function dealCards(state: GameState, p: PlayerId, n: number): GameState {
  return updatePlayer(state, p, (ps) => ({ ...ps, deck: ps.deck.slice(n), hand: [...ps.hand, ...ps.deck.slice(0, n)] }))
}

export function applyChooseFirst(state: GameState, player: PlayerId, goFirst: boolean): [GameState, Event[]] {
  if (state.pending?.kind !== 'chooseFirst' || state.pending.player !== player) throw new IllegalCommandError('no first-player choice owed by this player')
  const first = goFirst ? player : opponentOf(player)
  let s: GameState = { ...state, firstPlayer: first, turnPlayer: first, pending: { kind: 'mulligan', player: first }, priority: first }
  s = dealCards(s, 0, 5)   // §8.2.1.3
  s = dealCards(s, 1, 5)
  return [s, [{ type: 'firstPlayerChosen', player: first }]]
}

export function applyMulligan(state: GameState, player: PlayerId, redraw: boolean): [GameState, Event[]] {
  if (state.pending?.kind !== 'mulligan' || state.pending.player !== player) throw new IllegalCommandError('no mulligan decision owed by this player')
  let s = state
  if (redraw) {
    // §8.2.1.4: hand to the bottom of the deck, draw 5 new. MVP0-SIMPLIFICATION: the player may choose the order of the 5 cards; we keep hand order.
    s = updatePlayer(s, player, (ps) => ({ ...ps, deck: [...ps.deck, ...ps.hand], hand: [] }))
    s = dealCards(s, player, 5)
  }
  s = updatePlayer(s, player, (ps) => ({ ...ps, mulliganDecided: true }))
  const events: Event[] = [{ type: 'mulligan', player, redraw }]
  const other = opponentOf(player)
  if (!s.players[other].mulliganDecided) {
    return [{ ...s, pending: { kind: 'mulligan', player: other }, priority: other }, events]
  }
  const [started, more] = startTurn({ ...s, pending: null }, 1, s.firstPlayer)   // §8.2.1.5
  return [started, [...events, ...more]]
}
