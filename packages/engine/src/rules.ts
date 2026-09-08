import type { PlayerId } from './types.js'
import { opponentOf } from './types.js'
import { EMPTY_RESOLUTION } from './abilities.js'
import type { ZoneTransitionReason } from './abilities.js'
import { IllegalCommandError } from './errors.js'
import type { Ability } from './abilities.js'
import type { CardId, FieldCard, GameState } from './state.js'
import { DAMAGE_TO_LOSE, MAX_BACKUPS, defOf, powerOf, updatePlayer } from './state.js'
import type { Event } from './events.js'
import type { DamageOccurrence } from './resolve.js'
import { enqueueDamageTriggers, enqueueZoneChangeTriggers, registerRuleProcesses } from './resolve.js'

/**
 * The clause the printed EX BURST tag prefixes, or null. Read off the ability list rather than off `text`, so
 * a reworded comment cannot change which clause fires (spec G3).
 *
 * A card whose def says `exBurst` but which marks no clause returns null and is simply not offered — that is a
 * coverage hole, and `pool-coverage` is where it is caught, not here at damage time.
 */
export function exBurstAbility(state: GameState, card: CardId): Ability | null {
  const def = defOf(state, card)
  // BOTH must agree. The def's `exBurst` is what the card actually prints (it comes from the card data), and
  // the ability flag is which clause the tag prefixes. Reading only the ability would let a mistakenly marked
  // clause on a card that prints no EX BURST fire in play; reading only the def would leave a card with the
  // tag and no marked clause silently doing nothing. `pool-coverage` asserts the two never disagree, so this
  // is the runtime half of a contract the pool test states.
  if (!def.exBurst) return null
  return def.abilities?.find((a) => a.exBurst === true) ?? null
}

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
  // §11.10 (rung G3): a card printing EX BURST that is dealt as damage lets its owner use the marked clause.
  //
  // Offered only when the damage was NOT the seventh. The alternative — offer, then withdraw once
  // `runRuleProcesses` sets the result — would put an `exBurstOffered` in the log for a burst nobody could
  // ever answer, and the accounting in G3-A1 depends on every offer reaching exactly one terminal state. The
  // check mirrors the rule rather than duplicating the loss condition: this is "was that the seventh", and
  // `runRuleProcesses` remains the only thing that ends the game.
  const burst = exBurstAbility(s, top)
  if (burst && s.players[victim].damageZone.length < DAMAGE_TO_LOSE) {
    s = { ...s, pending: { kind: 'chooseExBurst', player: victim, card: top, abilityId: burst.id } }
    events.push({ type: 'exBurstOffered', player: victim, card: top, abilityId: burst.id })
  }
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
 * The cards the field rule processes would remove RIGHT NOW, snapshotted before anything moves: §12.4.4 (zero
 * power) and §12.4.5 (damage ≥ power) for Forwards; §12.4.6 (two or more non-generic Characters of one name)
 * and §12.4.7 (two or more Light/Dark Characters) for Forwards and Backups alike (rung J4). One batch, so a
 * name clash and a lethal damage on the same card is one transition, not two.
 * `cannotBeBroken` (spec C1-7) blocks the §12.4.5 damage break and nothing else — the other three are not breaks.
 */
export function pendingBreakTransitions(state: GameState): ZoneTransition[] {
  const out: ZoneTransition[] = []
  for (const p of [0, 1] as const) {
    const ps = state.players[p]
    const clashing = fieldLimitClashes(state, p)
    for (const zone of ['forwards', 'backups'] as const) {
      for (const c of ps[zone]) {
        const owner = state.cards[c.id]?.owner ?? p
        const base = { card: c.id, controller: p, owner, from: zone, to: 'breakZone', cause: null, causeController: null, snapshot: c } as const
        if (zone === 'forwards') {
          const power = powerOf(state, c)
          if (power <= 0) { out.push({ ...base, reason: 'zeroPower' }); continue }
          if (power >= 1000 && c.damage >= power && !c.flags.includes('cannotBeBroken')) { out.push({ ...base, reason: 'damage' }); continue }
        }
        const clash = clashing.get(c.id)
        if (clash) out.push({ ...base, reason: clash })
      }
    }
  }
  return out
}

/** Every card on `p`'s field that §12.4.6 (same non-generic name) or §12.4.7 (Light/Dark) removes, with the reason. */
function fieldLimitClashes(state: GameState, p: PlayerId): Map<CardId, 'sameName' | 'lightDark'> {
  const ps = state.players[p]
  const field = [...ps.forwards, ...ps.backups]
  const byName = new Map<string, CardId[]>()
  const lightDark: CardId[] = []
  for (const c of field) {
    const def = defOf(state, c.id)
    if (!def.generic) byName.set(def.name, [...(byName.get(def.name) ?? []), c.id])
    if (def.elements.some((e) => e === 'light' || e === 'dark')) lightDark.push(c.id)
  }
  const out = new Map<CardId, 'sameName' | 'lightDark'>()
  for (const ids of byName.values()) if (ids.length >= 2) for (const id of ids) out.set(id, 'sameName')
  if (lightDark.length >= 2) for (const id of lightDark) if (!out.has(id)) out.set(id, 'lightDark')
  return out
}

/** §7.7.5 for the cast check: does `p` already control a Light or Dark Character? */
export function controlsLightOrDark(state: GameState, p: PlayerId): boolean {
  const ps = state.players[p]
  return [...ps.forwards, ...ps.backups].some((c) => defOf(state, c.id).elements.some((e) => e === 'light' || e === 'dark'))
}


/**
 * §12.4.1 ends the game, and nothing resolves afterwards. `apply` skips `settle` entirely once `result` is set, so
 * whatever a rule process queued on its way here — the seventh point of player damage triggers its dealer's
 * `dealtDamage` clause like any other (spec C2-8) — would otherwise outlive game over and trip `checkInvariants`.
 */
function stopped(state: GameState): GameState {
  // `pending` as well as the agenda, and the omission was a real hole rather than a theoretical one. G3's EX
  // Burst offer is raised when the VICTIM survives the damage, which says nothing about whether the OTHER
  // player is already at seven: P0 at seven, P1 below it and dealt an EX card, and this returned a finished
  // game with an offer nobody could ever answer — exactly what `checkInvariants` forbids. The attack path
  // happened to clear it a moment later in `finishDamageStep`, so only `runRuleProcesses` itself could show
  // the invalid state, which is why no game-level test caught it.
  return state.result ? { ...state, resolution: EMPTY_RESOLUTION, pending: null } : state
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
      s = updatePlayer(s, p, (ps) => ({ ...ps, forwards: ps.forwards.filter((c) => !leaving.includes(c.id)), backups: ps.backups.filter((c) => !leaving.includes(c.id)) }))
    }
    for (const t of transitions) {
      s = updatePlayer(s, t.owner, (ps) => ({ ...ps, breakZone: [...ps.breakZone, t.card] }))
    }
    for (const t of transitions) {
      if (t.reason === 'zeroPower' || t.reason === 'sameName' || t.reason === 'lightDark') events.push({ type: 'putIntoBreakZone', card: t.card, reason: t.reason })
    }
    for (const t of transitions) {
      if (t.reason === 'damage') events.push({ type: 'broken', card: t.card })
    }
    s = enqueueZoneChangeTriggers(pre, s, transitions)
  }
  // §12.4.8 (rung J4): more than five Backups — the CONTROLLER chooses which extra ones go, so it is a pending
  // rather than a transition. Raised only when nothing else is owed: a rule process comes before anything an
  // effect would ask (§12.3), and `settle` stops on it like any other pending.
  if (!s.result && !s.pending) {
    for (const p of [0, 1] as const) {
      const excess = s.players[p].backups.length - MAX_BACKUPS
      if (excess > 0) { s = { ...s, pending: { kind: 'breakExcessBackups', player: p, count: excess } }; break }
    }
  }
  // §12.4.1 seven damage; §3.3 simultaneous → draw
  const dead = ([0, 1] as const).filter((p) => s.players[p].damageZone.length >= DAMAGE_TO_LOSE)
  if (dead.length === 2) s = { ...s, result: { winner: null, cause: 'bothReachedSeven', reason: 'both players reached 7 damage (§3.3)' } }
  else if (dead.length === 1) s = { ...s, result: { winner: opponentOf(dead[0] as PlayerId), cause: 'damage', reason: `player ${dead[0]} has 7 damage (§12.4.1)` } }
  return [stopped(s), events]
}

// The late binding `drainResolution` uses to run rule processes between frames without a runtime import cycle.
registerRuleProcesses(runRuleProcesses)

/**
 * The answer to §12.4.8 (rung J4): exactly `count` of the player's own Backups go to their owner's Break Zone,
 * as a zone movement (not a break — no `broken` event, watchers of the movement fire), and the rule processes
 * run again in case the removal changed anything. The End Phase, if it was interrupted, resumes in `apply`.
 */
export function applyBreakExcessBackups(state: GameState, player: PlayerId, cards: readonly CardId[]): [GameState, Event[]] {
  const pending = state.pending
  if (pending?.kind !== 'breakExcessBackups' || pending.player !== player) throw new IllegalCommandError('no excess-Backup choice owed by this player')
  if (cards.length !== pending.count || new Set(cards).size !== cards.length) throw new IllegalCommandError(`choose exactly ${pending.count} distinct Backups (§12.4.8)`)
  const ps = state.players[player]
  const transitions: ZoneTransition[] = []
  for (const id of cards) {
    const fc = ps.backups.find((c) => c.id === id)
    if (!fc) throw new IllegalCommandError(`${id} is not a Backup you control`)
    transitions.push({ card: id, controller: player, owner: state.cards[id]?.owner ?? player, from: 'backups', to: 'breakZone', reason: 'backupLimit', cause: null, causeController: null, snapshot: fc })
  }
  const pre = state
  let s: GameState = { ...state, pending: null }
  s = updatePlayer(s, player, (q) => ({ ...q, backups: q.backups.filter((c) => !cards.includes(c.id)) }))
  for (const t of transitions) s = updatePlayer(s, t.owner, (q) => ({ ...q, breakZone: [...q.breakZone, t.card] }))
  const events: Event[] = transitions.map((t) => ({ type: 'putIntoBreakZone', card: t.card, reason: 'backupLimit' }))
  s = enqueueZoneChangeTriggers(pre, s, transitions)
  return [s, events]
}
