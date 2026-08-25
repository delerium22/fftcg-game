import type { PlayerId } from './types.js'
import { opponentOf } from './types.js'
import type { CardId, GameState } from './state.js'
import { DAMAGE_TO_LOSE, defOf, powerOf, updatePlayer } from './state.js'
import type { Event } from './events.js'

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

export function runRuleProcesses(state: GameState): [GameState, Event[]] {
  const events: Event[] = []
  let s = state
  if (s.result) return [s, events]
  // §12.4.4 (zero power → break zone) and §12.4.5 (power ≥ 1000, damage ≥ power → broken), simultaneously, then re-check
  for (;;) {
    const zero: CardId[] = [], broken: CardId[] = []
    for (const p of [0, 1] as const) {
      for (const c of s.players[p].forwards) {
        const power = powerOf(s, c)
        if (power <= 0) zero.push(c.id)
        else if (c.damage >= power) broken.push(c.id)
      }
    }
    const leaving = [...zero, ...broken]
    if (!leaving.length) break
    for (const p of [0, 1] as const) {
      s = updatePlayer(s, p, (ps) => ({
        ...ps,
        forwards: ps.forwards.filter((c) => !leaving.includes(c.id)),
        breakZone: [...ps.breakZone, ...ps.forwards.filter((c) => leaving.includes(c.id)).map((c) => c.id)],
      }))
    }
    for (const id of zero) events.push({ type: 'putIntoBreakZone', card: id, reason: 'zeroPower' })
    for (const id of broken) events.push({ type: 'broken', card: id })
  }
  // §12.4.1 seven damage; §3.3 simultaneous → draw
  const dead = ([0, 1] as const).filter((p) => s.players[p].damageZone.length >= DAMAGE_TO_LOSE)
  if (dead.length === 2) s = { ...s, result: { winner: null, reason: 'both players reached 7 damage (§3.3)' } }
  else if (dead.length === 1) s = { ...s, result: { winner: opponentOf(dead[0] as PlayerId), reason: `player ${dead[0]} has 7 damage (§12.4.1)` } }
  return [s, events]
}
