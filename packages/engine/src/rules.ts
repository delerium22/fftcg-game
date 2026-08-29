import type { PlayerId } from './types.js'
import { opponentOf } from './types.js'
import { EMPTY_RESOLUTION } from './abilities.js'
import type { ZoneTransitionReason } from './abilities.js'
import type { CardId, FieldCard, GameState } from './state.js'
import { DAMAGE_TO_LOSE, defOf, powerOf, updatePlayer } from './state.js'
import type { Event } from './events.js'
import type { DamageOccurrence } from './resolve.js'
import { enqueueDamageTriggers, enqueueZoneChangeTriggers } from './resolve.js'

/**
 * §10.1.4.1. `sources` is EVERY card dealing this one point of damage — for an unblocked party, all of it, because
 * attribution is by party MEMBERSHIP and never by array position (spec C2-8): `at.attackers` is sorted by card id,
 * so singling out one member would make a Luso trigger or not depending on where its id happened to sort. The
 * occurrences share the single point of damage, they do not multiply it. `null` means nothing is attributable.
 */
export function dealPlayerDamage(state: GameState, victim: PlayerId, sources: readonly DamageOccurrence[] | null): [GameState, Event[]] {
  const ps = state.players[victim]
  const top = ps.deck[0]
  if (top === undefined) {
    return [{ ...state, result: { winner: opponentOf(victim), cause: 'damageWithEmptyDeck', reason: `player ${victim} took damage with an empty deck (§3.1.3)` } }, []]
  }
  let s = updatePlayer(state, victim, (q) => ({ ...q, deck: q.deck.slice(1), damageZone: [...q.damageZone, top] }))
  const events: Event[] = [{ type: 'playerDamaged', player: victim, card: top }]
  if (defOf(s, top).exBurst) events.push({ type: 'exBurstSkipped', player: victim, card: top })   // MVP0-SIMPLIFICATION: §11.10 EX Burst not resolved
  // Dispatched only once the damage has LANDED: the empty-deck branch above ends the game instead (§3.1.3), and
  // `checkInvariants` forbids anything staying queued after game over.
  if (sources) s = enqueueDamageTriggers(s, sources)
  return [s, events]
}

/**
 * A card leaving a zone, recorded with a PRE-transition snapshot (spec C1-8). Rule processing removes every
 * affected Forward simultaneously and only then emits events; scanning the resulting field would lose the
 * trigger of a card that died at the same instant, so triggers must be discovered from these records instead.
 * `cause`/`causeController` is what C2 needs for Cloud's "cannot be returned by your OPPONENT's abilities".
 */
export interface ZoneTransition {
  readonly card: CardId
  /**
   * The player whose field the card was on — the CONTROLLER. C1 called this field `owner`, which it never was:
   * "a Forward OPPONENT CONTROLS" is a statement about the field array the card sat in (spec C2-2).
   */
  readonly controller: PlayerId
  /** Real ownership, `CardInstance.owner` (§7.10) — where the card belongs, not who was playing it. */
  readonly owner: PlayerId
  readonly from: 'forwards' | 'backups'
  readonly to: 'breakZone'
  /**
   * `ability` is a direct `breakCard`; `zeroPower`/`damage` are the §12.4.4/§12.4.5 rule processes; `cost` is
   * a card put into the Break Zone to PAY for its own activated ability (spec C3-7).
   *
   * `cost` is not a break (§15.1.1.3.2): `cannotBeBroken` does not prevent it and no `broken` event is
   * emitted. It is still a zone MOVEMENT, so observers of "put from the field into the Break Zone" — which is
   * the printed wording the implemented watcher encodes — must see it. Anything that means "was broken"
   * specifically must filter on this field rather than assume every transition is a break.
   */
  readonly reason: ZoneTransitionReason
  /** The card whose ability caused the transition; null for a rule process, which has no source. */
  readonly cause: CardId | null
  readonly causeController: PlayerId | null
  readonly snapshot: FieldCard
}

/**
 * The Forwards §12.4.4/§12.4.5 would remove RIGHT NOW, snapshotted before anything moves.
 * `cannotBeBroken` (spec C1-7) blocks the §12.4.5 damage break but NOT the §12.4.4 zero-power process.
 */
export function pendingBreakTransitions(state: GameState): ZoneTransition[] {
  const out: ZoneTransition[] = []
  for (const p of [0, 1] as const) {
    for (const c of state.players[p].forwards) {
      const owner = state.cards[c.id]?.owner ?? p
      const base = { card: c.id, controller: p, owner, from: 'forwards', to: 'breakZone', cause: null, causeController: null, snapshot: c } as const
      const power = powerOf(state, c)
      if (power <= 0) out.push({ ...base, reason: 'zeroPower' })
      else if (power >= 1000 && c.damage >= power && !c.flags.includes('cannotBeBroken')) out.push({ ...base, reason: 'damage' })
    }
  }
  return out
}


/**
 * §12.4.1 ends the game, and nothing resolves afterwards. `apply` skips `settle` entirely once `result` is set, so
 * whatever a rule process queued on its way here — the seventh point of player damage triggers its dealer's
 * `dealtDamage` clause like any other (spec C2-8) — would otherwise outlive game over and trip `checkInvariants`.
 */
function stopped(state: GameState): GameState {
  return state.result ? { ...state, resolution: EMPTY_RESOLUTION } : state
}

export function runRuleProcesses(state: GameState): [GameState, Event[]] {
  const events: Event[] = []
  let s = state
  if (s.result) return [stopped(s), events]
  // §12.4.4 (zero power → break zone) and §12.4.5 (power ≥ 1000, damage ≥ power → broken), simultaneously, then re-check
  for (;;) {
    const transitions = pendingBreakTransitions(s)
    if (!transitions.length) break
    const pre = s   // watchers must be read while `s` still holds every pre-removal field card (spec C2-4)
    const leaving = transitions.map((t) => t.card)
    // §12.4.4/§15.1.1.3: a broken card goes to its OWNER's Break Zone, which is not the same player as the
    // controller whose field it was removed from. Owner and controller coincide for the whole MVP0 pool (nothing
    // changes control yet), so this is unobservable today — but the transitions already carry both, and taking
    // the controller here was the bug that made "capture owner properly" only half-done.
    for (const p of [0, 1] as const) {
      s = updatePlayer(s, p, (ps) => ({ ...ps, forwards: ps.forwards.filter((c) => !leaving.includes(c.id)) }))
    }
    for (const t of transitions) {
      s = updatePlayer(s, t.owner, (ps) => ({ ...ps, breakZone: [...ps.breakZone, t.card] }))
    }
    for (const t of transitions) {
      if (t.reason === 'zeroPower') events.push({ type: 'putIntoBreakZone', card: t.card, reason: 'zeroPower' })
    }
    for (const t of transitions) {
      if (t.reason === 'damage') events.push({ type: 'broken', card: t.card })
    }
    s = enqueueZoneChangeTriggers(pre, s, transitions)
  }
  // §12.4.1 seven damage; §3.3 simultaneous → draw
  const dead = ([0, 1] as const).filter((p) => s.players[p].damageZone.length >= DAMAGE_TO_LOSE)
  if (dead.length === 2) s = { ...s, result: { winner: null, cause: 'bothReachedSeven', reason: 'both players reached 7 damage (§3.3)' } }
  else if (dead.length === 1) s = { ...s, result: { winner: opponentOf(dead[0] as PlayerId), cause: 'damage', reason: `player ${dead[0]} has 7 damage (§12.4.1)` } }
  return [stopped(s), events]
}
