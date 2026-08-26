import type { PlayerId } from './types.js'
import { opponentOf } from './types.js'
import type { AbilityTrigger } from './abilities.js'
import type { CardId, FieldCard, GameState } from './state.js'
import { DAMAGE_TO_LOSE, defOf, powerOf, updatePlayer } from './state.js'
import type { Event } from './events.js'
import { enqueueTrigger } from './resolve.js'

export function dealPlayerDamage(state: GameState, victim: PlayerId, source: CardId | null): [GameState, Event[]] {
  void source   // reserved for "deals damage to your opponent" triggers (MVP3+)
  const ps = state.players[victim]
  const top = ps.deck[0]
  if (top === undefined) {
    return [{ ...state, result: { winner: opponentOf(victim), reason: `player ${victim} took damage with an empty deck (§3.1.3)` } }, []]
  }
  const s = updatePlayer(state, victim, (q) => ({ ...q, deck: q.deck.slice(1), damageZone: [...q.damageZone, top] }))
  const events: Event[] = [{ type: 'playerDamaged', player: victim, card: top }]
  if (defOf(s, top).exBurst) events.push({ type: 'exBurstSkipped', player: victim, card: top })   // MVP0-SIMPLIFICATION: §11.10 EX Burst not resolved
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
  readonly owner: PlayerId
  readonly from: 'forwards' | 'backups'
  readonly to: 'breakZone'
  readonly reason: 'zeroPower' | 'damage'
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
      const power = powerOf(state, c)
      if (power <= 0) out.push({ card: c.id, owner: p, from: 'forwards', to: 'breakZone', reason: 'zeroPower', cause: null, causeController: null, snapshot: c })
      else if (power >= 1000 && c.damage >= power && !c.flags.includes('cannotBeBroken')) {
        out.push({ card: c.id, owner: p, from: 'forwards', to: 'breakZone', reason: 'damage', cause: null, causeController: null, snapshot: c })
      }
    }
  }
  return out
}

/** C1 declares no zone-change trigger, so this matches nothing yet; C2 adds one to `AbilityTrigger` and it fires. */
const ZONE_TRIGGERS: readonly AbilityTrigger[] = []

function enqueueZoneTriggers(state: GameState, transitions: readonly ZoneTransition[]): GameState {
  let s = state
  for (const t of transitions) {
    // The SNAPSHOT's def, looked up by id — the card has already left the field by the time this runs.
    const code = state.cards[t.card]?.code
    for (const ability of (code === undefined ? undefined : state.defs[code])?.abilities ?? []) {
      if (ZONE_TRIGGERS.includes(ability.trigger)) s = enqueueTrigger(s, t.card, t.owner, ability)
    }
  }
  return s
}

export function runRuleProcesses(state: GameState): [GameState, Event[]] {
  const events: Event[] = []
  let s = state
  if (s.result) return [s, events]
  // §12.4.4 (zero power → break zone) and §12.4.5 (power ≥ 1000, damage ≥ power → broken), simultaneously, then re-check
  for (;;) {
    const transitions = pendingBreakTransitions(s)
    if (!transitions.length) break
    const leaving = transitions.map((t) => t.card)
    for (const p of [0, 1] as const) {
      s = updatePlayer(s, p, (ps) => ({
        ...ps,
        forwards: ps.forwards.filter((c) => !leaving.includes(c.id)),
        breakZone: [...ps.breakZone, ...ps.forwards.filter((c) => leaving.includes(c.id)).map((c) => c.id)],
      }))
    }
    for (const t of transitions) {
      if (t.reason === 'zeroPower') events.push({ type: 'putIntoBreakZone', card: t.card, reason: 'zeroPower' })
    }
    for (const t of transitions) {
      if (t.reason === 'damage') events.push({ type: 'broken', card: t.card })
    }
    s = enqueueZoneTriggers(s, transitions)
  }
  // §12.4.1 seven damage; §3.3 simultaneous → draw
  const dead = ([0, 1] as const).filter((p) => s.players[p].damageZone.length >= DAMAGE_TO_LOSE)
  if (dead.length === 2) s = { ...s, result: { winner: null, reason: 'both players reached 7 damage (§3.3)' } }
  else if (dead.length === 1) s = { ...s, result: { winner: opponentOf(dead[0] as PlayerId), reason: `player ${dead[0]} has 7 damage (§12.4.1)` } }
  return [s, events]
}
