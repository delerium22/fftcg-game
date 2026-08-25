import type { PlayerId } from './types.js'
import { opponentOf } from './types.js'
import type { CardId, GameState } from './state.js'
import { HAND_SIZE_LIMIT, updatePlayer } from './state.js'
import type { Event } from './events.js'
import { IllegalCommandError } from './errors.js'
import { runRuleProcesses } from './rules.js'

export function drawCards(state: GameState, p: PlayerId, n: number): [GameState, Event[]] {
  const ps = state.players[p]
  if (ps.deck.length < n) {
    // §3.1.2 — attempt to draw from an empty deck loses; the cards that could be drawn are still drawn
    const s = updatePlayer(state, p, (q) => ({ ...q, deck: [], hand: [...q.hand, ...q.deck] }))
    return [{ ...s, result: { winner: opponentOf(p), reason: `player ${p} could not draw a card (§3.1.2)` } }, [{ type: 'drew', player: p, count: ps.deck.length }]]
  }
  const s = updatePlayer(state, p, (q) => ({ ...q, deck: q.deck.slice(n), hand: [...q.hand, ...q.deck.slice(0, n)] }))
  return [s, [{ type: 'drew', player: p, count: n }]]
}

export function startTurn(state: GameState, turn: number, player: PlayerId): [GameState, Event[]] {
  const events: Event[] = [{ type: 'turnStarted', turn, player }]
  let s: GameState = { ...state, turn, turnPlayer: player, priority: player, attack: null, pending: null }
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
    case 'main1': {
      // §10.1.1 Attack Preparation Step — MVP0-SIMPLIFICATION: nothing can trigger here yet, so advance straight to declaration
      const s: GameState = { ...state, phase: 'attack', attack: { step: 'declaration', attackers: [], blocker: null }, priority: player }
      return [s, [{ type: 'phaseStarted', phase: 'attack', step: 'preparation' }, { type: 'phaseStarted', phase: 'attack', step: 'declaration' }]]
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
  // §9.5.1.3.1 remove damage; §9.5.1.3.2 end "until end of turn" effects (granted keywords); reset per-turn flags
  let s = state
  for (const p of [0, 1] as const) {
    s = updatePlayer(s, p, (ps) => ({
      ...ps,
      forwards: ps.forwards.map((c) => ({ ...c, damage: 0, attackedThisTurn: false, granted: [] })),
      backups: ps.backups.map((c) => ({ ...c, granted: [] })),
    }))
  }
  const [ruled, events] = runRuleProcesses(s)   // §9.5.1.4
  if (ruled.result) return [ruled, events]
  const [next, more] = startTurn(ruled, ruled.turn + 1, opponentOf(ruled.turnPlayer))   // §9.5.1.5
  return [next, [...events, ...more]]
}
