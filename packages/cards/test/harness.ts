import type { CardId, Command, Event, FieldCard, GameState, PlayerId } from '@fftcg/engine'
import { actingPlayer, apply as engineApply, applyChooseFirst, applyMulligan, createGame, drainResolution, hasResolutionWork, isResponseWindow } from '@fftcg/engine'
import { loadCards } from '../src/index.js'

/**
 * Rung J9: the real-card fixture helpers, shared by `abilities.test.ts` and the Layer 3 scenarios in `scenarios/`.
 * Moved here verbatim from `abilities.test.ts` (rung C1); the cards package may import the engine, never the reverse,
 * which is why the shipped ASTs can only be played from here.
 */

export const DEFS = loadCards()

/** 50 cards, ≤3 copies of each of the 18 codes (§8.1.1.1–2). */
export const DECK: string[] = (() => {
  const codes = DEFS.map((d) => d.code)
  const out: string[] = []
  for (let i = 0; out.length < 50; i++) out.push(codes[i % codes.length] as string)
  return out
})()

export function makeGame(): GameState {
  let s = createGame({ seed: 1, decks: [DECK, DECK], defs: DEFS })
  const chooser = s.pending?.kind === 'chooseFirst' ? s.pending.player : 0
  ;[s] = applyChooseFirst(s, chooser, chooser === 0)   // player 0 always goes first
  ;[s] = applyMulligan(s, 0, false)
  ;[s] = applyMulligan(s, 1, false)
  // An empty hand keeps payments unambiguous; the cards go under the deck so no instance leaves every zone.
  const p0 = s.players[0]
  return { ...s, players: [{ ...p0, hand: [], deck: [...p0.deck, ...p0.hand] }, s.players[1]] }
}

let nextId = 90_000
function addInstance(state: GameState, owner: PlayerId, code: string): [GameState, CardId] {
  const id = nextId++
  return [{ ...state, cards: { ...state.cards, [id]: { id, code, owner } } }, id]
}
export function setPlayer(state: GameState, p: PlayerId, ps: GameState['players'][0]): GameState {
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
/** Stack `codes` on top of `player`'s deck, TOP FIRST, and return their ids in that order. */
export function withDeckTops(state: GameState, player: PlayerId, codes: string[]): [GameState, CardId[]] {
  let s = state
  const ids: CardId[] = []
  for (const code of codes) { let id: CardId; [s, id] = addInstance(s, player, code); ids.push(id) }
  const ps = s.players[player]
  return [setPlayer(s, player, { ...ps, deck: [...ids, ...ps.deck] }), ids]
}

export function withBreakZone(state: GameState, player: PlayerId, code: string): [GameState, CardId] {
  const [s, id] = addInstance(state, player, code)
  const ps = s.players[player]
  return [setPlayer(s, player, { ...ps, breakZone: [...ps.breakZone, id] }), id]
}

/** `n` active generic Backups of one element, as CP sources. Backups produce their FIRST printed element. */
export const EARTH_BACKUP = '18-064C'      // Geomancer, generic
export const LIGHTNING_BACKUP = '18-069C'  // Red Mage, generic
export function withCp(state: GameState, player: PlayerId, codes: string[]): [GameState, CardId[]] {
  let s = state
  const ids: CardId[] = []
  for (const code of codes) { let id: CardId; [s, id] = withField(s, player, 'backups', code); ids.push(id) }
  return [s, ids]
}

/** Both players forfeit priority (rung J1): what ends a Main Phase now that a single pass only hands priority over. */
export function passBoth(state: GameState): { state: GameState; events: Event[] } {
  const p = actingPlayer(state)!
  const first = apply(state, { type: 'pass', player: p })
  const same = first.state.phase === state.phase && first.state.attack?.step === state.attack?.step
  const q = actingPlayer(first.state)
  if (!same || first.state.pending || first.state.result || q === null || q === p) return first
  const second = apply(first.state, { type: 'pass', player: q })
  return { state: second.state, events: [...first.events, ...second.events] }
}
export function endPhase(state: GameState): GameState {
  let s = passBoth(state).state
  for (let i = 0; i < 4 && !s.pending && !s.result && isResponseWindow(s) && s.stack.length === 0 && s.phase === 'attack'; i++) s = passBoth(s).state
  return s
}
/** `apply`, then resolve everything it triggered or stacked, with no windows (rung J1) — what "immediate resolution" was. */
export function applyNow(state: GameState, command: Command): { state: GameState; events: Event[] } {
  const r = engineApply(state, command)
  if (r.state.result) return r
  const [t, more] = drainResolution(r.state)
  const s = !t.result && !t.pending && !hasResolutionWork(t.resolution) && t.stack.length === 0 ? { ...t, resolution: { ...t.resolution, steps: 0 } } : t
  return { state: s, events: [...r.events, ...more] }
}
/** `passBoth`, `endPhase` and the C1-era fixtures answer a command with `applyNow` semantics: what "immediate resolution" was. */
const apply = applyNow

/** A trace of what happened, for golden sequences: stack, triggers, power, damage, breaks, draws, combat steps. */
export function trace(events: readonly Event[], names: Record<number, string> = {}): string[] {
  const n = (id: number): string => names[id] ?? String(id)
  const item = (i: { kind: 'summon'; card: CardId } | { kind: 'ability'; abilityId: string }): string => (i.kind === 'summon' ? `summon:${n(i.card)}` : i.abilityId)
  const out: string[] = []
  for (const e of events) {
    switch (e.type) {
      case 'stackPushed': out.push(`push:${item(e.item)}`); break
      case 'stackResolved': out.push(`resolve:${item(e.item)}`); break
      case 'stackCancelled': out.push(`cancel:${item(e.item)}`); break
      case 'abilityTriggered': out.push(`trigger:${e.abilityId}`); break
      case 'abilityActivated': out.push(`activate:${e.abilityId}`); break
      case 'powerModified': out.push(`power:${n(e.card)}:${e.amount > 0 ? '+' : ''}${e.amount}`); break
      case 'keywordGranted': out.push(`keyword:${n(e.card)}:${e.keyword}`); break
      case 'abilityDamage': out.push(`damage:${n(e.target)}:${e.amount}`); break
      case 'battleDamage': out.push(`battle:${n(e.source)}>${n(e.target)}:${e.amount}`); break
      case 'broken': case 'brokenByAbility': out.push(`broken:${n(e.card)}`); break
      case 'paidToBreakZone': out.push(`paid:${n(e.card)}`); break
      case 'playerDamaged': out.push(`playerDamaged:${e.player}`); break
      case 'exBurstOffered': out.push('burst:offered'); break
      case 'exBurstUsed': out.push('burst:used'); break
      case 'exBurstDeclined': out.push('burst:declined'); break
      case 'drew': out.push(`drew:${e.player}:${e.count}`); break
      case 'discarded': out.push(`discard:${n(e.card)}`); break
      case 'phaseStarted': out.push(e.step ? `step:${e.step}` : `phase:${e.phase}`); break
      case 'attackDeclared': out.push(`attack:${e.attackers.map(n).join('+')}`); break
      case 'blockDeclared': out.push(`block:${e.blocker === null ? 'none' : n(e.blocker)}`); break
      default: break
    }
  }
  return out
}

/** Apply one command through the REAL pipeline (no drain), accumulating its events into `log`. */
export function step(log: Event[], s: GameState, command: Command): GameState {
  const r = engineApply(s, command)
  log.push(...r.events)
  return r.state
}
