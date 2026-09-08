import type { PlayerId } from './types.js'
import type { CardId, GameState } from './state.js'
import { defOf } from './state.js'
import type { Command } from './commands.js'
import { enumeratePayments, enumeratePaymentsFor } from './cp.js'
import { abilityCpRequirement, activationCheck, activationTargetSets } from './activate.js'
import { castCheck, instantSpeedAllowed } from './cast.js'
import { deckPickCandidates } from './resolve.js'
import { legalAttackSets, legalBlockers, legalPartyDamageAssignments } from './attack.js'

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

const NOTHING: ActionMenu = { castable: [], abilities: false, attack: false, pass: false }

export function actionMenu(state: GameState, player: PlayerId): ActionMenu {
  if (state.result || state.pending || state.priority !== player) return NOTHING
  const castable = (): CardId[] => state.players[player].hand.filter((card) => castCheck(state, player, card) === null)
  switch (state.phase) {
    case 'main1':
    case 'main2':
      return { castable: castable(), abilities: true, attack: false, pass: true }
    case 'attack':
      // Declaration is the turn player's decision; a window (§10.1.1.2 and, from slice 5, the rest) admits
      // Summons and action abilities from the priority holder (§9.3.1.6–7).
      if (state.attack?.step === 'declaration') return { castable: [], abilities: false, attack: true, pass: true }
      if (instantSpeedAllowed(state)) return { castable: castable(), abilities: true, attack: false, pass: true }
      return NOTHING
    default:
      return NOTHING   // setup/active/draw/end never wait for a non-pending command
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
  const menu = actionMenu(state, player)
  if (!menu.pass || menu.attack || menu.castable.length > 0) return null
  if (menu.abilities && activationsFor(state, player).length > 0) return null
  return { type: 'pass', player }
}


function combinations<T>(items: T[], k: number): T[][] {
  if (k === 0) return [[]]
  return items.flatMap((x, i) => combinations(items.slice(i + 1), k - 1).map((rest) => [x, ...rest]))
}

export function legalCommands(state: GameState, player: PlayerId): Command[] {
  if (state.result) return []
  const out: Command[] = [{ type: 'concede', player }]   // §2.1: always allowed
  if (actingPlayer(state) !== player) return out
  const pending = state.pending
  if (pending) {
    switch (pending.kind) {
      case 'chooseFirst':
        out.push({ type: 'chooseFirst', player, goFirst: true }, { type: 'chooseFirst', player, goFirst: false }); break
      case 'mulligan':
        out.push({ type: 'mulligan', player, redraw: false }, { type: 'mulligan', player, redraw: true }); break
      case 'discardToHandSize':
        for (const cards of combinations(state.players[player].hand, pending.count)) out.push({ type: 'discardToHandSize', player, cards })
        break
      case 'declareBlock':
        out.push({ type: 'declareBlock', player, blocker: null })
        for (const blocker of legalBlockers(state, player)) out.push({ type: 'declareBlock', player, blocker })
        break
      case 'assignPartyDamage':
        for (const assignments of legalPartyDamageAssignments(state)) out.push({ type: 'assignPartyDamage', player, assignments })
        break
      case 'chooseTargets':
        // Σ C(N, k) for k in min..max. `max` is the printed "up to N" (≤ 2 everywhere in the C1 pool) and N is
        // one zone of one or both fields, so the bound is ~C(20,2) = 190 commands. A clause printing "up to 4"
        // over a large Break Zone would need a candidate cap here — spec C1-6 flagged the combinatorics.
        for (let k = pending.min; k <= pending.max; k++) {
          for (const targets of combinations([...pending.candidates], k)) out.push({ type: 'chooseTargets', player, targets })
        }
        break
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
    return out
  }
  const menu = actionMenu(state, player)
  for (const card of menu.castable) {
    const type = defOf(state, card).type === 'summon' ? 'castSummon' : 'castCharacter'
    for (const payment of enumeratePayments(state, player, card)) out.push({ type, player, card, payment })
  }
  if (menu.abilities) for (const c of activationsFor(state, player)) out.push(c)
  if (menu.attack) for (const attackers of legalAttackSets(state, player)) out.push({ type: 'declareAttack', player, attackers })
  if (menu.pass) out.push({ type: 'pass', player })
  return out
}

/**
 * Every legal activation for `player`, one per (source card, clause, minimal payment).
 *
 * Scans the three zones an activated ability can live in rather than just the field: `sourceZone` is a
 * declared precondition on the ability (spec C3-3), so Geomancer's hand-only ability and a future Break-Zone
 * ability enumerate through this same path instead of needing their own.
 */
export function activationsFor(state: GameState, player: PlayerId): Command[] {
  const out: Command[] = []
  const ps = state.players[player]
  const sources = [...ps.hand, ...ps.breakZone, ...ps.forwards.map((c) => c.id), ...ps.backups.map((c) => c.id)]
  for (const source of sources) {
    for (const ability of defOf(state, source).abilities ?? []) {
      if (ability.trigger.kind !== 'activated') continue
      const req = abilityCpRequirement(source, ability.trigger.cost)
      // Payment x declared target set. Both are part of the command now, because an activation declares its
      // choices before it pays (spec C3-1) — so both have to be enumerated for the choice to be offered.
      const targetSets = activationTargetSets(state, player, source, ability)
      for (const payment of enumeratePaymentsFor(state, player, req)) {
        for (const targets of targetSets) {
          if (activationCheck(state, player, source, ability.id, targets) !== null) continue
          out.push({ type: 'activateAbility', player, source, abilityId: ability.id, payment, targets })
        }
      }
    }
  }
  return out
}
