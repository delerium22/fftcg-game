import { DAMAGE_TO_LOSE, HAND_SIZE_LIMIT, MAX_BACKUPS, defOf, keywordsOf, opponentOf, powerOf, type FieldCard, type GameState, type PlayerId, flagsOf } from '@fftcg/engine'
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
  /**
   * Rung G1b. How much MORE the next damage costs than the last one — the increasing marginal, alone.
   *
   * `material` prices damage linearly, so 0 → 1 and 5 → 6 both cost the same 30.1 (the damage weight plus the
   * deck card it consumes). The basis here is the CENTRED one, `n(n−1)`, not `n²`: since `n² = n + n(n−1)`, a
   * quadratic penalty would also raise the price of the FIRST damage, and a win could then mean either "the
   * approach to seven needs curvature" or merely "the linear weight is too small". With `n(n−1)`, 0 → 1 is
   * untouched for every value of this weight and each later marginal rises by exactly `2 × damageCurve`.
   *
   * `n = 7` never reaches here: a seven-damage state is terminal and `evaluate` returns before `material`.
   *
   * Zero by default, like `expiredThreat` — a no-op until a measurement earns it a value, and a weight that
   * can only be changed by editing source cannot be A/B'd at all.
   */
  damageCurve: number
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
  damageCurve: 0,
}

/**
 * Rung G1a — DEFAULT_WEIGHTS with a sparse override laid over it, so a caller can vary ONE weight and leave
 * the rest alone. That is what makes a weights A/B possible at all: the search used to hardcode
 * `DEFAULT_WEIGHTS` for every rollout, so the only way to change a weight was to edit the source, and a
 * comparison whose two arms are different checkouts is not a comparison anyone should ship on.
 *
 * Both checks below are load-bearing rather than defensive:
 *
 *  - a non-finite weight does not fail, it POISONS. `evaluate` returns NaN, every comparison against it is
 *    false, and the agent silently keeps whichever candidate it happened to score first. That would look like
 *    "the curve made it play badly" instead of "the weight was a typo".
 *  - an unknown key does nothing at all, which is worse: a run named `damageCurv` would report the control's
 *    numbers under the treatment's name. The CLI already carries an unknown-flag guard for exactly this.
 *
 * A key present but `undefined` is treated as absent, and `WeightOverrides` admits one rather than using
 * `Partial<Weights>`: under `exactOptionalPropertyTypes` a `Partial` claims the key can only be absent, while
 * `structuredClone` cheerfully preserves an explicit `undefined` across the worker boundary. The type says
 * what can actually arrive, so the runtime guard below is not guarding against something the types deny.
 */
export type WeightOverrides = { readonly [K in keyof Weights]?: number | undefined }

export function resolveWeights(overrides?: WeightOverrides | undefined): Weights {
  if (!overrides) return DEFAULT_WEIGHTS
  for (const key of Object.keys(overrides)) {
    if (!(key in DEFAULT_WEIGHTS)) {
      throw new RangeError(`unknown weight "${key}" — it would silently do nothing, so it is refused`)
    }
  }
  const out: Weights = { ...DEFAULT_WEIGHTS }
  for (const key of Object.keys(DEFAULT_WEIGHTS) as (keyof Weights)[]) {
    const v = overrides[key]
    if (v === undefined) continue
    if (!Number.isFinite(v)) throw new RangeError(`weight "${key}" is ${String(v)}, which would make every score NaN`)
    out[key] = v
  }
  return out
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
  // Through the readers (rung J6): a Haste or a protection the LAYER grants is worth what a stamped one is.
  const kw = keywordsOf(state, c)
  const fl = flagsOf(state, c)
  if (kw.size === 0 && fl.size === 0) return 0
  let v = 0
  // `enteredTurn` and `attackedThisTurn` enter the evaluation here, and only here.
  if (kw.has('haste')) v += w.haste * hasteUnlock(state, p, c, isForward)
  // Brave (§15.2.1): does not dull to attack, so it threatens and still blocks. Flat — a standing quality.
  if (kw.has('brave') && isForward) v += w.brave
  if (fl.has('cannotBeBroken')) v += w.protection * protectionValue(state, c, isForward)
  return v
}

function material(state: GameState, p: PlayerId, w: Weights): number {
  const ps = state.players[p]
  const taken = ps.damageZone.length
  let v = (DAMAGE_TO_LOSE - taken) * w.damage
  // G1b: the increasing marginal. Subtracted rather than folded into the line above so the linear term stays
  // exactly what it was and the two are separable in any measurement of either.
  v -= taken * (taken - 1) * w.damageCurve
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
