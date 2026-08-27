import type { PlayerId } from './types.js'
import { opponentOf } from './types.js'
import type { CardId, GameState } from './state.js'
import { HAND_SIZE_LIMIT, updatePlayer } from './state.js'
import type { Event } from './events.js'
import { IllegalCommandError } from './errors.js'
import { runRuleProcesses } from './rules.js'
import { enqueueAttackPhaseTriggers, enterAttackPreparation } from './resolve.js'
// Re-exported so every existing importer of `drawCards` from this module keeps working (spec C3-9).
export { drawCards } from './draw.js'
import { drawCards } from './draw.js'


export function startTurn(state: GameState, turn: number, player: PlayerId): [GameState, Event[]] {
  const events: Event[] = [{ type: 'turnStarted', turn, player }]
  let s: GameState = { ...state, turn, turnPlayer: player, priority: player, attack: null, pending: null }
  // The turn's Break-Zone arrival history clears HERE, at the actual boundary — not in `finishEndPhase`'s
  // per-turn reset, which runs BEFORE a final rule-process pass (§9.5.1.4). A card broken by that pass would
  // be recorded after the clear and stay retrievable into the next turn (spec C10-3).
  //
  // No card in THIS pool can be broken by that pass — damage is removed first (§9.5.1.3.1), and clearing a
  // `powerBonus` cannot drop a printed power to zero — so the two placements are behaviourally identical
  // today and no game-level test can tell them apart. It is still written at the boundary that is correct
  // rather than the one that happens to work, and `startTurn` is pinned directly by a unit test.
  s = { ...s, players: [
    { ...s.players[0], putIntoBreakZoneFromFieldThisTurn: [] },
    { ...s.players[1], putIntoBreakZoneFromFieldThisTurn: [] },
  ] }
  // §9.1 Active Phase
  s = { ...s, phase: 'active' }; events.push({ type: 'phaseStarted', phase: 'active' })
  const dulled: CardId[] = []
  s = updatePlayer(s, player, (ps) => ({
    ...ps,
    forwards: ps.forwards.map((c) => { if (c.status === 'dull') dulled.push(c.id); return { ...c, status: 'active' } }),
    backups: ps.backups.map((c) => { if (c.status === 'dull') dulled.push(c.id); return { ...c, status: 'active' } }),
  }))
  if (dulled.length) events.push({ type: 'activated', player, cards: dulled })
  // §9.2 Draw Phase
  s = { ...s, phase: 'draw' }; events.push({ type: 'phaseStarted', phase: 'draw' })
  const n = turn === 1 ? 1 : 2   // §9.2.1.3
  const [drawn, drawEvents] = drawCards(s, player, n)
  s = drawn; events.push(...drawEvents)
  if (s.result) return [s, events]
  // §9.3 Main Phase 1
  s = { ...s, phase: 'main1' }; events.push({ type: 'phaseStarted', phase: 'main1' })
  return [s, events]
}

export function applyPass(state: GameState, player: PlayerId): [GameState, Event[]] {
  if (state.result) throw new IllegalCommandError('game is over')
  if (state.pending) throw new IllegalCommandError('a decision is pending')
  if (state.priority !== player) throw new IllegalCommandError('you do not hold priority')
  if (state.phase === 'attack' && state.attack?.step !== 'declaration') throw new IllegalCommandError('cannot pass during this attack step')
  switch (state.phase) {
    case 'main1':
      // §10.1.1 Attack Preparation Step, then §10.1.2 Declaration — the two-step transition C2 left the seam
      // for (spec C5-1). Enter preparation, queue the beginning-of-phase clauses, and hand the move into
      // declaration to the agenda's continuation. With nothing queued the continuation runs immediately, so a
      // board with no such clause still reaches declaration in the same `pass`.
      //
      // Doing it in one hop, as this used to, would resolve any such trigger while the state still said Main
      // Phase 1: the clause would fire at a moment its own printed text says it does not.
      {
        const [prepared, events] = enterAttackPreparation(state, player)
        const queued = enqueueAttackPhaseTriggers(prepared, player)
        return [{ ...queued, resolution: { ...queued.resolution, continuation: 'enterAttackDeclaration' } }, events]
      }
    case 'attack':   // declaration step, checked above; §10.1.4.6
      return [{ ...state, phase: 'main2', attack: null, priority: player }, [{ type: 'phaseStarted', phase: 'main2' }]]
    case 'main2':
      return beginEndPhase(state)
    default:
      throw new IllegalCommandError(`pass not applicable in phase ${state.phase}`)
  }
}

function beginEndPhase(state: GameState): [GameState, Event[]] {
  const p = state.turnPlayer
  const events: Event[] = [{ type: 'phaseStarted', phase: 'end' }]
  const s: GameState = { ...state, phase: 'end' }
  const excess = s.players[p].hand.length - HAND_SIZE_LIMIT   // §9.5.1.2
  if (excess > 0) return [{ ...s, pending: { kind: 'discardToHandSize', player: p, count: excess }, priority: p }, events]
  const [t, more] = finishEndPhase(s)
  return [t, [...events, ...more]]
}

export function applyDiscardToHandSize(state: GameState, player: PlayerId, cards: CardId[]): [GameState, Event[]] {
  const pending = state.pending
  if (pending?.kind !== 'discardToHandSize' || pending.player !== player) throw new IllegalCommandError('no discard decision owed by this player')
  if (cards.length !== pending.count || new Set(cards).size !== cards.length) throw new IllegalCommandError(`discard exactly ${pending.count} distinct cards`)
  for (const id of cards) if (!state.players[player].hand.includes(id)) throw new IllegalCommandError(`${id} is not in your hand`)
  let s = updatePlayer(state, player, (ps) => ({ ...ps, hand: ps.hand.filter((id) => !cards.includes(id)), breakZone: [...ps.breakZone, ...cards] }))
  const events: Event[] = cards.map((card) => ({ type: 'discarded', player, card, reason: 'handSize' }))
  s = { ...s, pending: null }
  const [t, more] = finishEndPhase(s)
  return [t, [...events, ...more]]
}

export function finishEndPhase(state: GameState): [GameState, Event[]] {
  // §9.5.1.3.1 remove damage; §9.5.1.3.2 end EVERY "until end of turn" effect — granted keywords, `powerBonus`
  // and the protection `flags` (spec C1-7) all expire together; reset per-turn flags
  let s = state
  for (const p of [0, 1] as const) {
    s = updatePlayer(s, p, (ps) => ({
      ...ps,
      forwards: ps.forwards.map((c) => ({ ...c, damage: 0, attackedThisTurn: false, granted: [], powerBonus: 0, flags: [], usedThisTurn: [] })),
      backups: ps.backups.map((c) => ({ ...c, granted: [], powerBonus: 0, flags: [], usedThisTurn: [] })),
    }))
  }
  const [ruled, events] = runRuleProcesses(s)   // §9.5.1.4
  if (ruled.result) return [ruled, events]
  const [next, more] = startTurn(ruled, ruled.turn + 1, opponentOf(ruled.turnPlayer))   // §9.5.1.5
  return [next, [...events, ...more]]
}
