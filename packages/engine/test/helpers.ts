import type { CardDef, PlayerId } from '../src/types.js'
import { opponentOf } from '../src/types.js'
import type { CardId, FieldCard, GameState } from '../src/state.js'
import { applyChooseFirst, applyMulligan, createGame } from '../src/setup.js'
import { apply } from '../src/apply.js'
import { actingPlayer, forcedPass, isResponseWindow } from '../src/legal.js'
import { drainResolution } from '../src/resolve.js'
import { hasResolutionWork } from '../src/abilities.js'
import type { Command } from '../src/commands.js'
import type { Event } from '../src/events.js'

export function makeDef(over: Partial<CardDef> & { code: string }): CardDef {
  return { name: over.code, type: 'forward', elements: ['earth'], cost: 2, power: 5000, keywords: [], generic: false, exBurst: false, text: '', hasAbilities: false, ...over }
}

/** 18 distinct codes so deckOf() can build a legal 50-card deck (≤3 copies each needs ≥17 codes). */
export const VANILLA_POOL: CardDef[] = [
  makeDef({ code: 'V-F1', cost: 1, power: 3000 }),
  makeDef({ code: 'V-F2', cost: 2, power: 5000 }),
  makeDef({ code: 'V-F3', elements: ['lightning'], cost: 3, power: 7000 }),
  makeDef({ code: 'V-F4', elements: ['earth', 'lightning'], cost: 2, power: 7000 }),
  makeDef({ code: 'V-F5', cost: 3, power: 7000 }),
  makeDef({ code: 'V-F6', elements: ['lightning'], cost: 1, power: 2000 }),
  makeDef({ code: 'V-F7', cost: 4, power: 8000 }),
  makeDef({ code: 'V-F8', elements: ['lightning'], cost: 5, power: 9000 }),
  makeDef({ code: 'V-B1', type: 'backup', cost: 1, power: null }),
  makeDef({ code: 'V-B2', type: 'backup', elements: ['lightning'], cost: 2, power: null }),
  makeDef({ code: 'V-B3', type: 'backup', cost: 1, power: null }),
  makeDef({ code: 'V-B4', type: 'backup', cost: 3, power: null }),
  makeDef({ code: 'V-B5', type: 'backup', elements: ['lightning'], cost: 1, power: null }),
  makeDef({ code: 'V-B6', type: 'backup', elements: ['lightning'], cost: 3, power: null }),
  makeDef({ code: 'V-S1', type: 'summon', elements: ['lightning'], cost: 2, power: null }),
  makeDef({ code: 'V-S2', type: 'summon', cost: 1, power: null }),
  makeDef({ code: 'V-S3', type: 'summon', elements: ['lightning'], cost: 4, power: null }),
  makeDef({ code: 'V-S4', type: 'summon', cost: 3, power: null }),
]

export function deckOf(codes: string[]): string[] {
  if (codes.length < 17) throw new Error(`deckOf needs ≥17 codes for a legal deck, got ${codes.length}`)
  const out: string[] = []
  for (let i = 0; out.length < 50; i++) out.push(codes[i % codes.length] as string)
  return out
}

export const DEFAULT_DECK = deckOf(VANILLA_POOL.map((d) => d.code))

export function makeGame(opts: { seed?: number; decks?: [string[], string[]]; defs?: CardDef[] } = {}): GameState {
  let s = createGame({ seed: opts.seed ?? 1, decks: opts.decks ?? [DEFAULT_DECK, DEFAULT_DECK], defs: opts.defs ?? VANILLA_POOL })
  const chooser = s.pending?.kind === 'chooseFirst' ? s.pending.player : 0
  ;[s] = applyChooseFirst(s, chooser, chooser === 0)   // player 0 always goes first
  ;[s] = applyMulligan(s, 0, false)
  ;[s] = applyMulligan(s, 1, false)
  return s
}

let nextTestId = 10_000
function addInstance(state: GameState, owner: PlayerId, code: string): [GameState, CardId] {
  const id = nextTestId++
  return [{ ...state, cards: { ...state.cards, [id]: { id, code, owner } } }, id]
}
function setPlayer(state: GameState, p: PlayerId, ps: GameState['players'][0]): GameState {
  const players: GameState['players'] = [state.players[0], state.players[1]]
  players[p] = ps
  return { ...state, players }
}

export function withField(state: GameState, player: PlayerId, zone: 'forwards' | 'backups', code: string, over: Partial<FieldCard> = {}): [GameState, CardId] {
  const [s, id] = addInstance(state, player, code)
  const fc: FieldCard = { id, status: 'active', damage: 0, enteredTurn: 0, attackedThisTurn: false, granted: [], powerBonus: 0, flags: [], usedThisTurn: [], ...over }
  const ps = s.players[player]
  return [setPlayer(s, player, { ...ps, [zone]: [...ps[zone], fc] }), id]
}

export function withHand(state: GameState, player: PlayerId, code: string): [GameState, CardId] {
  const [s, id] = addInstance(state, player, code)
  const ps = s.players[player]
  return [setPlayer(s, player, { ...ps, hand: [...ps.hand, id] }), id]
}

export function withHandSize(state: GameState, player: PlayerId, n: number): GameState {
  const ps = state.players[player]
  return setPlayer(state, player, { ...ps, hand: ps.hand.slice(0, n), deck: [...ps.deck, ...ps.hand.slice(n)] })
}

/**
 * Both players forfeit priority (rung J1, CR §11.1.7): from a Main Phase this is what ends it, and it is what a
 * single `pass` did before the stack existed. From the declaration step one pass suffices (§10.1.4.6) and the
 * second is not sent. Events of both applies are concatenated, so a test reading "the events of ending the
 * phase" sees the phase transition wherever it lands.
 */
export function passBoth(state: GameState): { state: GameState; events: Event[] } {
  const p = actingPlayer(state)
  if (p === null) throw new Error('passBoth: nobody is acting')
  const first = apply(state, { type: 'pass', player: p })
  const same = first.state.phase === state.phase && first.state.attack?.step === state.attack?.step
  const q = actingPlayer(first.state)
  if (!same || first.state.pending || first.state.result || q === null || q === p) return first
  const second = apply(first.state, { type: 'pass', player: q })
  return { state: second.state, events: [...first.events, ...second.events] }
}
/**
 * End the current phase or step the way a single pass did before the stack: both forfeit, and if that lands in
 * a WINDOW with nothing on the stack (Attack Preparation, §10.1.1.2), both forfeit again to reach the next
 * decision point (declaration).
 */
export function endPhase(state: GameState): GameState {
  let s = passBoth(state).state
  for (let i = 0; i < 4 && !s.pending && !s.result && isResponseWindow(s) && s.stack.length === 0 && s.phase === 'attack'; i++) s = passBoth(s).state
  return s
}

/**
 * `apply`, then resolve everything the command triggered or put on the stack — with no priority windows
 * (rung J1). The tests written before the stack asserted a clause's EFFECTS the moment its cause happened;
 * that is still what they test, and the window between placement and resolution is slice 3's own tests' job.
 */
export function applyNow(state: GameState, command: Command): { state: GameState; events: Event[] } {
  const r = apply(state, command)
  if (r.state.result) return r
  const [t, more] = drainResolution(r.state)
  // The settlement is over: end the step epoch as `settle` would have (spec J1-D12).
  const s = !t.result && !t.pending && !hasResolutionWork(t.resolution) && t.stack.length === 0 ? { ...t, resolution: { ...t.resolution, steps: 0 } } : t
  return { state: s, events: [...r.events, ...more] }
}

/**
 * Apply every pass-only response window (rung J1): the non-turn player holding priority with nothing to do.
 * A walk that counts DECISIONS must not count these, or every trajectory recorded before the stack existed
 * (the frozen-score corpus, the mid-game fixtures) lands somewhere else.
 */
export function settleWindows(state: GameState): GameState {
  let s = state
  for (let i = 0; i < 8; i++) {
    const c = forcedPass(s)
    if (!c) return s
    s = apply(s, c).state
  }
  return s
}

/**
 * Declare `attackers` and forfeit through the `declared` window (rung J1-D10, §10.1.2.6): the state is at the
 * defender's block decision — or back at declaration if nothing survived the window.
 */
export function attackInto(state: GameState, attackers: CardId[]): { state: GameState; events: Event[] } {
  const r = apply(state, { type: 'declareAttack', player: state.turnPlayer, attackers })
  const p = passBoth(r.state)
  return { state: p.state, events: [...r.events, ...p.events] }
}

/**
 * Answer the block and forfeit through the `blocked` window (§10.1.3.6): the damage is dealt and everything
 * it triggered is drained (`applyNow` semantics), unless a prompt or the party split is owed first. The state
 * is then in the post-damage window (§10.1.4.4); `exitWindowNow` leaves it.
 */
export function blockWith(state: GameState, blocker: CardId | null): { state: GameState; events: Event[] } {
  const r = applyNow(state, { type: 'declareBlock', player: opponentOf(state.turnPlayer), blocker })
  return exitWindowNow(r)
}

/** Both forfeit the current window and drain what the exit triggered — unless a prompt is owed or the game ended. */
export function exitWindowNow(r: { state: GameState; events: Event[] }): { state: GameState; events: Event[] } {
  if (r.state.pending || r.state.result) return r
  const p = passBoth(r.state)
  let s = p.state
  let events = [...r.events, ...p.events]
  if (!s.result && !s.pending && (hasResolutionWork(s.resolution) || s.stack.length)) {
    const [t, more] = drainResolution(s)
    s = t; events = [...events, ...more]
  }
  if (!s.result && !s.pending && !hasResolutionWork(s.resolution) && s.stack.length === 0) s = { ...s, resolution: { ...s.resolution, steps: 0 } }
  return { state: s, events }
}
