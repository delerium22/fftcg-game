import { describe, expect, it } from 'vitest'
import { createGame } from '../src/setup.js'
import { apply } from '../src/apply.js'
import { actingPlayer, legalCommands } from '../src/legal.js'
import { checkInvariants } from '../src/invariants.js'
import { viewFor } from '../src/view.js'
import { determinise, SYNTHETIC_ID_BASE } from '../src/determinise.js'
import { nextInt, seedRng } from '../src/rng.js'
import type { GameState, PlayerId } from '../src/index.js'
import { DEFAULT_DECK, VANILLA_POOL, makeGame } from './helpers.js'

const DECKS: [string[], string[]] = [DEFAULT_DECK, DEFAULT_DECK]

function codesOf(s: GameState, p: PlayerId): string[] {
  const q = s.players[p]
  return [...q.deck, ...q.hand, ...q.forwards.map((c) => c.id), ...q.backups.map((c) => c.id), ...q.damageZone, ...q.breakZone].map((id) => s.cards[id]!.code).sort()
}

/** random-walk `n` steps from setup and return the state */
function walk(seed: number, n: number): GameState {
  let s = createGame({ seed, decks: DECKS, defs: VANILLA_POOL })
  let rng = seedRng(seed * 13)
  for (let i = 0; i < n && !s.result; i++) {
    const p = actingPlayer(s)!
    const cmds = legalCommands(s, p).filter((c) => c.type !== 'concede')
    const [k, r] = nextInt(rng, cmds.length); rng = r
    s = apply(s, cmds[k]!).state
  }
  return s
}

describe('determinise', () => {
  it('preserves everything visible and conserves each deck list', () => {
    const s = walk(5, 40)
    expect(s.result).toBeNull()   // a LIVE mid-game state; a finished game would make this test trivial
    for (const me of [0, 1] as const) {
      const view = viewFor(s, me)
      const [det] = determinise({ view, decks: DECKS, rng: seedRng(1) })
      expect(checkInvariants(det)).toEqual([])
      expect(det.players[me].hand).toEqual(s.players[me].hand)
      for (const p of [0, 1] as const) {
        expect(det.players[p].forwards).toEqual(s.players[p].forwards)
        expect(det.players[p].backups).toEqual(s.players[p].backups)
        expect(det.players[p].damageZone).toEqual(s.players[p].damageZone)
        expect(det.players[p].breakZone).toEqual(s.players[p].breakZone)
        expect(det.players[p].deck).toHaveLength(s.players[p].deck.length)
        expect(det.players[p].hand).toHaveLength(s.players[p].hand.length)
        expect(codesOf(det, p)).toEqual([...DEFAULT_DECK].sort())   // multiset conservation
      }
      const opp = me === 0 ? 1 : 0
      for (const id of [...det.players[opp].hand, ...det.players[0].deck, ...det.players[1].deck]) expect(id).toBeGreaterThanOrEqual(SYNTHETIC_ID_BASE)
      expect(viewFor(det, me).fields).toEqual(view.fields)
      expect({ ...viewFor(det, me), cards: null }).toEqual({ ...view, cards: null })
    }
  })
  it('is deterministic per rng and differs across rngs', () => {
    const live = walk(9, 40); expect(live.result).toBeNull()
    const view = viewFor(live, 0)
    const [a] = determinise({ view, decks: DECKS, rng: seedRng(3) })
    const [b] = determinise({ view, decks: DECKS, rng: seedRng(3) })
    const [c] = determinise({ view, decks: DECKS, rng: seedRng(4) })
    expect(a).toEqual(b)
    expect(a.players[1].hand.map((id) => a.cards[id]!.code)).not.toEqual(c.players[1].hand.map((id) => c.cards[id]!.code))
  })
  it('works from setup states (chooseFirst pending; mulligan pending) and mid-attack (declareBlock pending)', () => {
    const s0 = createGame({ seed: 2, decks: DECKS, defs: VANILLA_POOL })
    const [d0] = determinise({ view: viewFor(s0, 1), decks: DECKS, rng: seedRng(1) })
    expect(checkInvariants(d0)).toEqual([]); expect(d0.pending).toEqual(s0.pending); expect(d0.players[1].deck).toHaveLength(50)
    const s1 = walk(2, 1)   // after chooseFirst → mulligan pending, 5 cards each
    const [d1] = determinise({ view: viewFor(s1, 0), decks: DECKS, rng: seedRng(1) })
    expect([d1.players[0].mulliganDecided, d1.players[1].mulliganDecided]).toEqual([s1.players[0].mulliganDecided, s1.players[1].mulliganDecided]); expect(d1.firstPlayer).toBe(s1.firstPlayer)
    expect(d1.players[1].hand).toHaveLength(5)
    // mid-attack: find a walk state with declareBlock pending
    let s2: GameState | null = null
    for (let seed = 1; seed < 40 && !s2; seed++) for (let n = 5; n < 200 && !s2; n += 7) { const t = walk(seed, n); if (t.pending?.kind === 'declareBlock') s2 = t }
    expect(s2).not.toBeNull()
    const [d2] = determinise({ view: viewFor(s2!, s2!.pending!.player), decks: DECKS, rng: seedRng(1) })
    expect(d2.attack).toEqual(s2!.attack); expect(checkInvariants(d2)).toEqual([])
  })
  it('throws when the deck lists do not match what is visible', () => {
    const view = viewFor(makeGame(), 0)
    expect(() => determinise({ view, decks: [DEFAULT_DECK.slice(0, 49), DEFAULT_DECK], rng: seedRng(1) })).toThrow(/deck list/)
  })
})
