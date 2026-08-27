import type { CardDef, PlayerId } from '../src/types.js'
import type { CardId, FieldCard, GameState } from '../src/state.js'
import { applyChooseFirst, applyMulligan, createGame } from '../src/setup.js'

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
