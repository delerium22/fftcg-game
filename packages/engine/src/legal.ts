import type { PlayerId } from './types.js'
import type { CardId, GameState } from './state.js'
import { defOf } from './state.js'
import { discardCheck } from './phases.js'
import { excessBackupsCheck } from './rules.js'
import type { Command, Payment } from './commands.js'
import { canPay, castRequirement, enumeratePayments, enumeratePaymentsFor, generateCp, type CpRequirement } from './cp.js'
import { IllegalCommandError } from './errors.js'
import { abilityCpRequirement, activatedAbility, activationCheck, activationTargetSets, hasAnyActivation } from './activate.js'
import { castCheck, instantSpeedAllowed } from './cast.js'
import { deckPickCandidates, chooseTargetsCheck } from './resolve.js'
import { attackCheck, legalBlockers, legalPartyDamageAssignments, partyDamageCheck } from './attack.js'

export function actingPlayer(state: GameState): PlayerId | null {
  if (state.result) return null
  return state.pending?.player ?? state.priority
}

/**
 * What the PRIORITY HOLDER may do here, by kind (rung J1-D8) — the one phase/step switch in the engine.
 *
 * `legalCommands` expands it into every exact command; the AI's `candidateCommands` expands it into its
 * pruned set. Before J1 each had its own copy of "which phases allow what", and the plan review found that
 * a response window would have had commands in one list and none in the other. The per-card checks
 * (`castBlocker`, `activationCheck`, `attackCheck`) still decide each candidate; this decides only which
 * kinds are on the table at all.
 */
export interface ActionMenu {
  /** Hand cards the holder may cast now (every check but CP passed). */
  readonly castable: readonly CardId[]
  /** Whether activated abilities may be used in this phase and step. */
  readonly abilities: boolean
  /** Whether an attack may be declared (the declaration step, turn player). */
  readonly attack: boolean
  /** Whether priority may be forfeited. */
  readonly pass: boolean
}


export function actionMenu(state: GameState, player: PlayerId): ActionMenu {
  const shape = menuShape(state, player)
  const castable = shape.casts ? state.players[player].hand.filter((card) => castCheck(state, player, card) === null) : []
  return { castable, abilities: shape.abilities, attack: shape.attack, pass: shape.pass }
}

/** The KINDS the priority holder may use here — `actionMenu` without the per-card cast enumeration. */
function menuShape(state: GameState, player: PlayerId): { casts: boolean; abilities: boolean; attack: boolean; pass: boolean } {
  const nothing = { casts: false, abilities: false, attack: false, pass: false }
  if (state.result || state.pending || state.priority !== player) return nothing
  switch (state.phase) {
    case 'main1':
    case 'main2':
      return { casts: true, abilities: true, attack: false, pass: true }
    case 'attack':
      // Declaration is the turn player's decision; a window (§10.1.1.2 and, from slice 5, the rest) admits
      // Summons and action abilities from the priority holder (§9.3.1.6–7).
      if (state.attack?.step === 'declaration') return { casts: false, abilities: false, attack: true, pass: true }
      // §15.2.3.3 (rung J3): between the two damage batches priority is held, but nothing may be cast or used.
      if (state.attack?.step === 'firstStrike') return { casts: false, abilities: false, attack: false, pass: true }
      if (instantSpeedAllowed(state)) return { casts: true, abilities: true, attack: false, pass: true }
      return nothing
    default:
      return nothing   // setup/active/draw/end never wait for a non-pending command
  }
}

/**
 * A RESPONSE window (rung J1-D15): priority is held while something is on the stack, or by the non-turn
 * player, or in an Attack Phase step that is a window rather than a decision. The browser auto-passes a
 * window whose only answer is `pass`; it never auto-passes the turn player's own empty-stack phase end,
 * which is the Pass that ends a Main Phase and stays a button.
 */
export function isResponseWindow(state: Pick<GameState, 'result' | 'pending' | 'stack' | 'priority' | 'turnPlayer' | 'phase' | 'attack'>): boolean {
  if (state.result || state.pending) return false
  if (state.stack.length > 0) return true
  if (state.priority !== state.turnPlayer) return true
  if (state.phase === 'attack' && state.attack !== null && state.attack.step !== 'declaration') return true
  return false
}

/** The one command a pass-only window admits, or null when the holder has a real decision (or none at all). */
export function forcedPass(state: GameState): Command | null {
  const player = actingPlayer(state)
  if (player === null || !isResponseWindow(state)) return null
  // First-hit checks, not enumerations: this is asked on every step of every AI rollout, and enumerating each
  // cast's payments and each activation's target sets here was a quarter of a rollout's time.
  const shape = menuShape(state, player)
  if (!shape.pass || shape.attack) return null
  if (shape.casts && state.players[player].hand.some((card) => castCheck(state, player, card) === null)) return null
  if (shape.abilities && hasAnyActivation(state, player)) return null
  return { type: 'pass', player }
}

/**
 * The one command a position with NO decision in it admits, or null when the holder has a real choice (rung
 * K2). `forcedPass` covers the pass-only response windows; this adds the two Attack Phase steps that are the
 * holder's own decision in name only, found by playing: the block declaration when no Forward of theirs is
 * active (the strip read "Choose a blocker" over a single "Don't block"), and the attack declaration when no
 * Forward can attack (a single "Pass"). The browser settles these in the same step as the move that reached
 * them; the AI's rollouts keep asking `forcedPass` — a combat step is a ply they price themselves.
 */
export function forcedDecision(state: GameState): Command | null {
  const forced = forcedPass(state)
  if (forced) return forced
  const player = actingPlayer(state)
  if (player === null) return null
  if (state.pending?.kind === 'declareBlock' && state.pending.player === player) {
    return legalBlockers(state, player).length === 0 ? { type: 'declareBlock', player, blocker: null } : null
  }
  if (!state.pending && state.phase === 'attack' && state.attack?.step === 'declaration' && state.priority === player) {
    const canAttack = state.players[player].forwards.some((c) => attackCheck(state, player, [c.id]) === null)
    return canAttack ? null : { type: 'pass', player }
  }
  return null
}


function combinations<T>(items: T[], k: number): T[][] {
  if (k === 0) return [[]]
  return items.flatMap((x, i) => combinations(items.slice(i + 1), k - 1).map((rest) => [x, ...rest]))
}

/**
 * Why `command` would be refused by `apply`, or null (rung J7-D1). The one legality authority the browser
 * asks before sending a command it BUILT (a target set picked card by card, a party of attackers) rather
 * than picked from `legalCommands`' list — which may be a capped sample. For the set-shaped commands this is
 * the exact predicate their `apply*` runs; for the rest, "listed by `legalCommands`" (their answer spaces
 * are small and fully enumerated).
 */
export function isLegal(state: GameState, command: Command): string | null {
  if (state.result) return 'game is over'
  if (command.type !== 'concede' && actingPlayer(state) !== command.player) return `player ${command.player} is not the acting player`
  switch (command.type) {
    case 'declareAttack': return attackCheck(state, command.player, command.attackers)
    case 'chooseTargets': return chooseTargetsCheck(state, command.player, command.targets)
    case 'assignPartyDamage': return partyDamageCheck(state, command.player, command.assignments)
    case 'discardToHandSize': return discardCheck(state, command.player, command.cards)
    case 'breakExcessBackups': return excessBackupsCheck(state, command.player, command.cards)
    case 'activateAbility': {
      const why = activationCheck(state, command.player, command.source, command.abilityId, command.targets)
      if (why) return why
      // The payment as `apply` validates it: the CP the sources generate covers the requirement. Any
      // payment, not only a minimal listed one (§11.2.2.3), and a non-listed set of sources too.
      const ability = activatedAbility(state, command.source, command.abilityId)
      if (!ability || ability.trigger.kind !== 'activated') return `${command.abilityId} is not an activated ability`
      return paymentCheck(state, command.player, command.payment, abilityCpRequirement(command.source, ability.trigger.cost))
    }
    case 'castCharacter':
    case 'castSummon': {
      const why = castCheck(state, command.player, command.card)
      if (why) return why
      return paymentCheck(state, command.player, command.payment, castRequirement(state, command.card, command.player))
    }
    default: {
      // The small-answer commands (setup, block, modes, deck picks, the burst, pass): listed by `legalCommands`,
      // compared structurally so an answer's set order never matters.
      const same = (a: Command, b: Command): boolean => {
        if (a.type !== b.type || a.player !== b.player) return false
        switch (a.type) {
          case 'chooseFirst': return a.goFirst === (b as typeof a).goFirst
          case 'mulligan': return a.redraw === (b as typeof a).redraw
          case 'declareBlock': return a.blocker === (b as typeof a).blocker
          case 'chooseExBurst': return a.use === (b as typeof a).use
          case 'chooseMode': return sameSet(a.modes, (b as typeof a).modes)
          case 'chooseFromDeck': return sameSet(a.picks, (b as typeof a).picks)
          case 'pass': case 'concede': return true
          default: return JSON.stringify(a) === JSON.stringify(b)
        }
      }
      return legalCommands(state, command.player).some((c) => same(c, command)) ? null : `${command.type} is not legal here`
    }
  }
}
const sameSet = (a: readonly number[], b: readonly number[]): boolean => a.length === b.length && [...a].sort((x, y) => x - y).every((v, i) => v === [...b].sort((x, y) => x - y)[i])

/** Does `payment` cover `req`, drawing on sources the player may spend? The engine's own generator decides; an illegal source is its refusal. */
function paymentCheck(state: GameState, player: PlayerId, payment: Payment, req: CpRequirement): string | null {
  try {
    const cp = generateCp(state, player, payment, req.excluded)
    return canPay(req.amount, req.requiredElements, cp) ? null : `payment does not cover cost ${req.amount} ${req.requiredElements.join('/')}`
  } catch (e) {
    if (e instanceof IllegalCommandError) return e.message
    throw e
  }
}

/**
 * Rung J7-D2: the most set-shaped commands one enumeration lists. Below it every legal set is listed as
 * before; above it the list is a SAMPLE — the singletons, the pairs, then larger sets in order until the cap,
 * plus the largest legal sets — and `capped` says so. `isLegal` is the authority for anything not listed.
 */
export const DEFAULT_SET_CAP = 64
export interface LegalList { readonly commands: Command[]; readonly capped: boolean }

/** Lazily every k-subset of `items`, in lexicographic order of positions. */
function* subsetsOf<T>(items: readonly T[], k: number, start = 0, acc: T[] = []): Generator<T[]> {
  if (acc.length === k) { yield [...acc]; return }
  for (let i = start; i <= items.length - (k - acc.length); i++) {
    acc.push(items[i] as T)
    yield* subsetsOf(items, k, i + 1, acc)
    acc.pop()
  }
}

/**
 * The legal subsets of `items` of sizes `min..max`, bounded by `cap` (J7-D2). `ok` says whether a set is
 * legal (attack parties must share an element); `largest` supplies the sets worth listing even when the cap
 * bites (a full party per element, the first `max` candidates). Deduplicated by sorted signature.
 */
function boundedSubsets<T extends number>(
  items: readonly T[], min: number, max: number, cap: number, ok: (set: T[]) => boolean, largest: () => T[][],
): { sets: T[][]; capped: boolean } {
  const hi = Math.min(max, items.length)
  const key = (set: readonly T[]): string => [...set].sort((a, b) => a - b).join(',')
  // The largest legal sets are RESERVED: they ride whatever the sample holds, and the sample fills the room
  // that is left, so the list never exceeds `cap` (Codex MEDIUM). Listed after the sample so a small,
  // complete list keeps its size order; the reserved ones are then duplicates the dedupe drops.
  const big = largest().filter(ok)
  const bigKeys = new Set(big.map(key))
  const room = Math.max(0, cap - bigKeys.size)
  const sets: T[][] = []
  const seen = new Set<string>()
  let capped = false
  // Legal sets are COUNTED as they are generated, not estimated from raw combinations: an attack over eight
  // Forwards of two elements has 255 subsets and a few dozen legal parties, and a complete list is not a
  // sample. The scan itself is bounded too — past `SCAN_LIMIT` subsets the list is a sample whatever it holds.
  let scanned = 0
  outer: for (let k = min; k <= hi; k++) {
    for (const set of subsetsOf(items, k)) {
      if (++scanned > SCAN_LIMIT) { capped = true; break outer }
      if (!ok(set)) continue
      const kk = key(set)
      if (seen.has(kk)) continue
      if (sets.length >= room && !bigKeys.has(kk)) { capped = true; break outer }
      seen.add(kk); sets.push(set)
    }
  }
  for (const set of big) { const kk = key(set); if (!seen.has(kk)) { seen.add(kk); sets.push(set) } }
  return { sets, capped }
}
/** How many subsets one enumeration may examine before the list is declared a sample regardless (2ⁿ over a wide field). */
const SCAN_LIMIT = 4096

export function legalCommands(state: GameState, player: PlayerId): Command[] {
  return legalCommandsWithMeta(state, player).commands
}

export function legalCommandsWithMeta(state: GameState, player: PlayerId, setCap = DEFAULT_SET_CAP): LegalList {
  if (state.result) return { commands: [], capped: false }
  const out: Command[] = [{ type: 'concede', player }]   // §2.1: always allowed
  let capped = false
  const bounded = <T extends number>(items: readonly T[], min: number, max: number, ok: (set: T[]) => boolean, largest: () => T[][]): T[][] => {
    const r = boundedSubsets(items, min, max, setCap, ok, largest)
    if (r.capped) capped = true
    return r.sets
  }
  if (actingPlayer(state) !== player) return { commands: out, capped }
  const pending = state.pending
  if (pending) {
    switch (pending.kind) {
      case 'chooseFirst':
        out.push({ type: 'chooseFirst', player, goFirst: true }, { type: 'chooseFirst', player, goFirst: false }); break
      case 'mulligan':
        out.push({ type: 'mulligan', player, redraw: false }, { type: 'mulligan', player, redraw: true }); break
      case 'discardToHandSize':
        for (const cards of bounded(state.players[player].hand, pending.count, pending.count, () => true, () => [])) out.push({ type: 'discardToHandSize', player, cards })
        break
      case 'breakExcessBackups':   // §12.4.8 (rung J4)
        for (const cards of bounded(state.players[player].backups.map((c) => c.id), pending.count, pending.count, () => true, () => [])) out.push({ type: 'breakExcessBackups', player, cards })
        break
      case 'declareBlock':
        out.push({ type: 'declareBlock', player, blocker: null })
        for (const blocker of legalBlockers(state, player)) out.push({ type: 'declareBlock', player, blocker })
        break
      case 'assignPartyDamage': {
        const all = legalPartyDamageAssignments(state, setCap + 1)
        if (all.length > setCap) capped = true
        for (const assignments of all.slice(0, setCap)) out.push({ type: 'assignPartyDamage', player, assignments })
        break
      }
      case 'chooseTargets': {
        // Σ C(N, k) for k in min..max, bounded (J7-D2): the singletons, the pairs, then larger sets up to the
        // cap, plus the first `max` candidates as one full set. Every subset within the size range is legal.
        const cands = [...pending.candidates]
        const full = () => (pending.max >= 1 && cands.length >= pending.min ? [cands.slice(0, Math.min(pending.max, cands.length))] : [])
        for (const targets of bounded(cands, pending.min, pending.max, () => true, full)) out.push({ type: 'chooseTargets', player, targets })
        break
      }
      case 'chooseFromDeck': {
        // Σ C(eligible, k) over min..max. The pool's clauses are "add 1 among 3", "add 1 among 5" and "up to 1
        // of a whole deck", so this is a handful of commands; a future "up to 3 of 5" would want the same cap
        // `chooseTargets` has. The candidates come from the DECK, because the pending carries the filter and
        // not the answer — see `deckPickCandidates`.
        const eligible = deckPickCandidates(state, pending)
        for (let k = pending.min; k <= Math.min(pending.max, eligible.length); k++) {
          for (const picks of combinations<number>(eligible, k)) out.push({ type: 'chooseFromDeck', player, picks })
        }
        break
      }
      // G3: both answers, always. An offer with only one legal reply is not a decision, and the AI reads this
      // list — see G3-A6, which requires the search to be able to pick either.
      case 'chooseExBurst':
        // DECLINE first, and the order is a policy rather than a detail. `greedyStep` scores candidates under
        // an apply budget and, once that budget is exhausted, keeps candidate ZERO without pricing the rest
        // (rung A's W1 floor). So whichever answer is listed first is what a budget-starved rollout does
        // blind — and "use" is not safe to do blind: Odin's clause targets a Forward of cost 5 or less
        // controlled by ANYONE, so with only your own Forward on the board, using the burst breaks it.
        // Declining only ever wastes the burst, which is the strictly recoverable mistake.
        out.push({ type: 'chooseExBurst', player, use: false }, { type: 'chooseExBurst', player, use: true })
        break
      case 'chooseMode':
        // Σ C(modes, k). `modes` is a printed list of 2–3, so this is a handful of commands.
        for (let k = pending.min; k <= pending.max; k++) {
          for (const modes of combinations(pending.labels.map((_, i) => i), k)) out.push({ type: 'chooseMode', player, modes })
        }
        break
    }
    return { commands: out, capped }
  }
  const menu = actionMenu(state, player)
  for (const card of menu.castable) {
    const type = defOf(state, card).type === 'summon' ? 'castSummon' : 'castCharacter'
    for (const payment of enumeratePayments(state, player, card)) out.push({ type, player, card, payment })
  }
  if (menu.abilities) {
    const r = activationsWithMeta(state, player, setCap)
    if (r.capped) capped = true
    out.push(...r.commands)
  }
  if (menu.attack) {
    // Every subset of the ready Forwards is 2ⁿ; bounded, the singles, the pairs and each element's full party.
    const eligible = state.players[player].forwards.map((c) => c.id).filter((id) => attackCheck(state, player, [id]) === null)
    const parties = () => {
      const byElement = new Map<string, CardId[]>()
      for (const id of eligible) for (const e of defOf(state, id).elements) byElement.set(e, [...(byElement.get(e) ?? []), id])
      return [...byElement.values()].filter((ids) => ids.length >= 2)
    }
    for (const attackers of bounded(eligible, 1, eligible.length, (set) => attackCheck(state, player, set) === null, parties)) out.push({ type: 'declareAttack', player, attackers })
  }
  if (menu.pass) out.push({ type: 'pass', player })
  return { commands: out, capped }
}

/**
 * Every legal activation for `player`, one per (source card, clause, minimal payment).
 *
 * Scans the three zones an activated ability can live in rather than just the field: `sourceZone` is a
 * declared precondition on the ability (spec C3-3), so Geomancer's hand-only ability and a future Break-Zone
 * ability enumerate through this same path instead of needing their own.
 */
export function activationsFor(state: GameState, player: PlayerId): Command[] {
  return activationsWithMeta(state, player, DEFAULT_SET_CAP).commands
}

function activationsWithMeta(state: GameState, player: PlayerId, setCap: number): LegalList {
  const out: Command[] = []
  let capped = false
  const ps = state.players[player]
  const sources = [...ps.hand, ...ps.breakZone, ...ps.forwards.map((c) => c.id), ...ps.backups.map((c) => c.id)]
  for (const source of sources) {
    for (const ability of defOf(state, source).abilities ?? []) {
      if (ability.trigger.kind !== 'activated') continue
      const req = abilityCpRequirement(source, ability.trigger.cost)
      // Payment x declared target set. Both are part of the command now, because an activation declares its
      // choices before it pays (spec C3-1) — so both have to be enumerated for the choice to be offered. The
      // target sets are bounded like every other set (J7-D2); the payments are the minimal ones and few.
      const all = activationTargetSets(state, player, source, ability, setCap + 1)   // one more than the cap: enough to know it bit
      let targetSets = all
      if (all.length > setCap) { targetSets = all.slice(0, setCap); capped = true }
      for (const payment of enumeratePaymentsFor(state, player, req)) {
        for (const targets of targetSets) {
          if (activationCheck(state, player, source, ability.id, targets) !== null) continue
          out.push({ type: 'activateAbility', player, source, abilityId: ability.id, payment, targets })
        }
      }
    }
  }
  return { commands: out, capped }
}
