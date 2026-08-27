import { DAMAGE_TO_LOSE, HAND_SIZE_LIMIT, MAX_BACKUPS, defOf, keywordsOf, opponentOf, powerOf, type FieldCard, type GameState, type PlayerId } from '@fftcg/engine'
import { cardValue } from './cardValue.js'

export interface Weights {
  damage: number
  forwardPower: number
  forwardPresence: number
  dullFactor: number
  backup: number
  hand: number
  handQuality: number
  deck: number
  threat: number
  terminal: number
  /** Rung C1. All three are worth exactly zero on a board with no granted keywords and no flags. */
  haste: number
  brave: number
  protection: number
  /**
   * Rung C3. The rate at which `powerBonus` — power that EXPIRES at end of turn — counts toward material,
   * against `forwardPower` for power the card actually has.
   *
   * Without this the two are identical, and the arithmetic worked out exactly wrong. Losing an active
   * 2000-power Undead Princess costs `2×1.2 + 4 + 2×0.8 = 8.0`; giving another Forward +4000 gains
   * `4×1.2 + 4×0.8 = 8.0`. A dead heat — and `greedyStep` keeps the EARLIER command on a tie, so it would
   * sacrifice a permanent body for a bonus that vanishes at end of turn, whether or not anything came of it.
   * The bonus still counts fully toward `threat`, because a temporary bonus really does swing combat THIS
   * turn; what it must not do is masquerade as a permanent gain.
   */
  temporaryPower: number
  /**
   * The fraction of a temporary bonus that still counts as `threat` once it provably cannot reach combat —
   * this player's own Main Phase 2, where the attack phase is behind them and the bonus expires at end of
   * turn. `0` is the honest value; `1` is the pre-C3 behaviour, and exists so the change is A/B-able through
   * `weights-ab.ts` rather than being an unmeasurable code edit.
   */
  expiredThreat: number
}

export const DEFAULT_WEIGHTS: Weights = {
  damage: 30,
  forwardPower: 1.2,
  forwardPresence: 4,
  dullFactor: 0.6,
  backup: 5,
  hand: 2,
  handQuality: 0.5,
  deck: 0.1,
  threat: 0.8,
  terminal: 100_000,
  haste: 1.0,
  brave: 0.6,
  protection: 0.5,
  temporaryPower: 0.4,
  expiredThreat: 0,
}

/**
 * What Haste (§15.2.3) is worth on this card RIGHT NOW, in power/1000 units and ignoring whether the card
 * already has it: exactly what it unlocks — an attack this turn by a Forward that entered this turn. On a
 * Forward that is dull, has already attacked, is not this turn's, or was already attack-eligible (§10.1.2.1.1),
 * Haste changes nothing and this is 0, so it can never outrank a real option (spec C1, "The AI").
 *
 * Exported because `evaluate` prices Haste a card HAS and the target policy prices Haste a card WOULD BE GIVEN;
 * they must agree, or the AI picks a target whose value it then fails to see.
 */
export function hasteUnlock(state: GameState, controller: PlayerId, c: FieldCard, isForward: boolean): number {
  if (!isForward || state.turnPlayer !== controller) return 0   // Backups never attack; on the opponent's turn it is eligible next turn regardless
  if (c.status !== 'active' || c.attackedThisTurn || c.enteredTurn < state.turn) return 0
  return 1 + powerOf(state, c) / 1000
}

/**
 * What `cannotBeBroken` (spec C1-7) is worth on this card, in `cardValue` units: the break it prevents, priced
 * by current exposure. A Forward already carrying damage is a §12.4.5 break waiting to happen; an undamaged one
 * only gains the right to block something bigger. It does NOT stop the §12.4.4 zero-power process, so a Forward
 * below 1000 power is beyond saving; a Backup is not subject to either rule process and is only being protected
 * from a direct break effect, hence the bare floor.
 */
export function protectionValue(state: GameState, c: FieldCard, isForward: boolean): number {
  const power = powerOf(state, c)
  if (isForward && power < 1000) return 0
  const exposure = power >= 1000 ? Math.min(1, c.damage / power) : 0
  return (0.25 + 0.75 * exposure) * (cardValue(defOf(state, c.id)) + power / 1000)
}

/**
 * Rung C1: the until-end-of-turn qualities `material` cannot see. Without them every Haste target and every
 * `cannotBeBroken` target scores identically and the AI falls back to first-in-order (Codex MAJOR).
 *
 * Zero unless the card actually carries a keyword or a flag, so a vanilla board — no card in the C1 pool prints
 * a keyword — evaluates to exactly the pre-C1 number and the seed-1 gate is untouched. `powerBonus` needs no
 * term of its own: `powerOf` already delegates to `effectivePower` (spec C1-7).
 */
function abilityTerms(state: GameState, p: PlayerId, c: FieldCard, isForward: boolean, w: Weights): number {
  const def = defOf(state, c.id)
  if (!c.granted.length && !c.flags.length && !def.keywords.length) return 0
  const kw = keywordsOf(state, c)
  let v = 0
  // `enteredTurn` and `attackedThisTurn` enter the evaluation here, and only here.
  if (kw.has('haste')) v += w.haste * hasteUnlock(state, p, c, isForward)
  // Brave (§15.2.1): does not dull to attack, so it threatens and still blocks. Flat — a standing quality.
  if (kw.has('brave') && isForward) v += w.brave
  if (c.flags.includes('cannotBeBroken')) v += w.protection * protectionValue(state, c, isForward)
  return v
}

function material(state: GameState, p: PlayerId, w: Weights): number {
  const ps = state.players[p]
  let v = (DAMAGE_TO_LOSE - ps.damageZone.length) * w.damage
  for (const c of ps.forwards) {
    // Split permanent from until-end-of-turn power: `powerOf` is printed + `powerBonus`, and the two are not
    // worth the same. `threat` deliberately keeps using the full figure — a temporary bonus does swing combat
    // this turn, which is exactly what `threat` measures.
    const total = powerOf(state, c)
    const permanent = Math.max(0, total - c.powerBonus)
    const temporary = total - permanent
    v += ((permanent / 1000) * w.forwardPower + (temporary / 1000) * w.temporaryPower) * (c.status === 'dull' ? w.dullFactor : 1) + w.forwardPresence
    // Active-power tempo: this side's own attack-ready threat. A temporary bonus counts here — it really does
    // swing a fight — EXCEPT where it provably cannot reach one. In this player's OWN Main Phase 2 the attack
    // phase is behind them and the bonus expires at end of turn, so scoring it as threat rewards pumping a
    // Forward that will never use it. Every other phase still has combat ahead: attacking on their own turn,
    // or blocking on the opponent's.
    const spent = state.turnPlayer === p && state.phase === 'main2'
    const threatPower = spent ? permanent + temporary * w.expiredThreat : total
    if (c.status === 'active') v += (threatPower / 1000) * w.threat
    v += abilityTerms(state, p, c, true, w)
  }
  for (const c of ps.backups) v += abilityTerms(state, p, c, false, w)
  v += Math.min(ps.backups.length, MAX_BACKUPS) * w.backup
  v += Math.min(ps.hand.length, HAND_SIZE_LIMIT) * w.hand + Math.max(0, ps.hand.length - HAND_SIZE_LIMIT) * w.hand * 0.25
  for (const id of ps.hand) v += cardValue(defOf(state, id)) * w.handQuality
  v += ps.deck.length * w.deck
  return v
}

export function evaluate(state: GameState, me: PlayerId, weights: Weights = DEFAULT_WEIGHTS, aggression = 0.5): number {
  if (aggression < 0 || aggression > 1) throw new RangeError(`aggression must be within [0, 1], got ${aggression}`)
  const opp = opponentOf(me)
  if (state.result) return state.result.winner === me ? weights.terminal : state.result.winner === opp ? -weights.terminal : 0
  const mine = material(state, me, weights) * 2 * (1 - aggression)
  const theirs = material(state, opp, weights) * 2 * aggression
  return mine - theirs
}
