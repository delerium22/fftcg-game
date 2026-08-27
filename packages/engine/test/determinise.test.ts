import { describe, expect, it } from 'vitest'
import { createGame } from '../src/setup.js'
import { apply } from '../src/apply.js'
import { actingPlayer, legalCommands } from '../src/legal.js'
import { checkInvariants } from '../src/invariants.js'
import { viewFor } from '../src/view.js'
import { determinise, SYNTHETIC_ID_BASE } from '../src/determinise.js'
import { knows, learn } from '../src/state.js'
import { nextInt, seedRng } from '../src/rng.js'
import type { GameState, PlayerId } from '../src/index.js'
import { DEFAULT_DECK, VANILLA_POOL, deckOf, makeGame } from './helpers.js'

const DECKS: [string[], string[]] = [DEFAULT_DECK, DEFAULT_DECK]

function codesOf(s: GameState, p: PlayerId): string[] {
  const q = s.players[p]
  // `removedFromGame` included since C7: a helper that enumerates "every zone" and quietly skips one turns
  // the tests built on it into tests of a subset, and a card lost from the accounting is exactly what they
  // exist to catch.
  return [...q.deck, ...q.hand, ...q.forwards.map((c) => c.id), ...q.backups.map((c) => c.id), ...q.damageZone, ...q.breakZone, ...q.removedFromGame].map((id) => s.cards[id]!.code).sort()
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
      expect(viewFor(det, me)).toEqual(view)   // F7: full equality, including visible card metadata — not just fields
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
  it('W5: conserves each player\'s own deck list even when the two players declared different (rotated) compositions', () => {
    // deckOf cycles the given codes to fill 50 slots (50 = 18*2 + 14), so a rotated code order changes WHICH 14
    // codes get a 3rd copy — a genuinely different composition, not just a reordering — catching a determinise
    // bug that indexed into the wrong player's deck list.
    const codes = VANILLA_POOL.map((d) => d.code)
    const decks: [string[], string[]] = [deckOf(codes), deckOf([...codes.slice(3), ...codes.slice(0, 3)])]
    expect([...decks[0]].sort()).not.toEqual([...decks[1]].sort())
    const s0 = createGame({ seed: 6, decks, defs: VANILLA_POOL })
    for (const me of [0, 1] as const) {
      const view = viewFor(s0, me)
      const [det] = determinise({ view, decks, rng: seedRng(1) })
      expect(checkInvariants(det)).toEqual([])
      for (const p of [0, 1] as const) expect(codesOf(det, p)).toEqual([...decks[p]].sort())
    }
  })
  it('throws when the deck lists do not match what is visible', () => {
    const view = viewFor(makeGame(), 0)
    expect(() => determinise({ view, decks: [DEFAULT_DECK.slice(0, 49), DEFAULT_DECK], rng: seedRng(1) })).toThrow(/deck list/)
  })
  it('F8: throws when a deck list contains a code with no definition in view.defs', () => {
    const view = viewFor(makeGame(), 0)
    const badDeck = [...DEFAULT_DECK.slice(0, 49), 'NOT-A-REAL-CODE']
    expect(() => determinise({ view, decks: [badDeck, DEFAULT_DECK], rng: seedRng(1) })).toThrow(/deck list/)
  })
  it('F8: synthetic ids start above the highest visible id, even when one is already >= SYNTHETIC_ID_BASE', () => {
    const s0 = makeGame()
    const oldId = s0.players[0].hand[0]!
    const highId = SYNTHETIC_ID_BASE + 5
    const inst = s0.cards[oldId]!
    const cards = { ...s0.cards }
    delete cards[oldId]
    cards[highId] = { ...inst, id: highId }
    const players = [s0.players[0], s0.players[1]] as typeof s0.players
    players[0] = { ...players[0], hand: players[0].hand.map((id) => (id === oldId ? highId : id)) }
    const s: GameState = { ...s0, cards, players }
    const view = viewFor(s, 0)
    const [det] = determinise({ view, decks: DECKS, rng: seedRng(1) })
    expect(checkInvariants(det)).toEqual([])
    const mintedIds = [...det.players[1].hand, ...det.players[0].deck, ...det.players[1].deck]
    expect(mintedIds.length).toBeGreaterThan(0)
    expect(mintedIds.every((id) => id > highId)).toBe(true)
  })
})

describe('a removed card stays removed (spec C7-A5)', () => {
  /** Move one card of P0's from the Break Zone out of the game, by hand. */
  function withRemoved(state: GameState): { s: GameState; removed: number } {
    const ps = state.players[0]
    const removed = ps.deck[0] as number
    const players = [state.players[0], state.players[1]] as typeof state.players
    players[0] = { ...ps, deck: ps.deck.slice(1), removedFromGame: [...ps.removedFromGame, removed] }
    return { s: { ...state, players }, removed }
  }

  it('is reproduced in the removed zone and NOT dealt back into a deck', () => {
    const { s, removed } = withRemoved(makeGame({ defs: VANILLA_POOL, decks: DECKS }))
    const view = viewFor(s, 0)
    const [det] = determinise({ view, decks: DECKS, rng: seedRng(7) })

    expect(det.players[0].removedFromGame).toEqual([removed])
    // The counting assertion: a duplicated card is exactly what a green suite otherwise misses. The removed
    // card's CODE must appear once across all of player 0's zones, not twice.
    const code = s.cards[removed]!.code
    const before = codesOf(s, 0).filter((c) => c === code).length
    const after = codesOf(det, 0).filter((c) => c === code).length
    expect(after).toBe(before)
    expect(codesOf(det, 0)).toHaveLength(codesOf(s, 0).length)
    expect(checkInvariants(det)).toEqual([])
  })

  it('is visible to BOTH players, being public', () => {
    const { s, removed } = withRemoved(makeGame({ defs: VANILLA_POOL, decks: DECKS }))
    for (const seat of [0, 1] as const) {
      const v = viewFor(s, seat)
      expect(v.fields[0].removedFromGame).toContain(removed)
      expect(v.cards[removed], `seat ${seat} cannot see the removed card`).toBeDefined()
    }
  })
})

describe('deck knowledge survives determinisation (spec C9-5)', () => {
  /** Teach `to` about the top `n` of `owner`'s deck. */
  function look(state: GameState, owner: PlayerId, to: PlayerId[], n: number): { s: GameState; ids: number[] } {
    const ids = state.players[owner].deck.slice(0, n)
    return { s: learn(state, to, ids), ids }
  }

  it('pins what the VIEWER knows: same ids, same codes, same positions', () => {
    const { s, ids } = look(makeGame({ defs: VANILLA_POOL, decks: DECKS }), 0, [0], 3)
    const view = viewFor(s, 0)
    const [det] = determinise({ view, decks: DECKS, rng: seedRng(11) })

    expect(det.players[0].deck.slice(0, 3)).toEqual(ids)
    for (const id of ids) expect(det.cards[id]!.code).toBe(s.cards[id]!.code)
    // And still exactly 50 cards' worth of codes — a pinned card must not ALSO be dealt from the pool.
    expect(codesOf(det, 0)).toEqual(codesOf(s, 0))
  })

  it('preserves "unknown to me, KNOWN TO THEM" — the half a bare count cannot carry', () => {
    // The opponent looked at their own top three. Root cannot name those cards, but must not model an
    // opponent who never looked: the sampler invents identities freely and records that they are known.
    const { s } = look(makeGame({ defs: VANILLA_POOL, decks: DECKS }), 1, [1], 3)
    const view = viewFor(s, 0)

    // Root sees the FACT but not the cards.
    expect(view.fields[1].deck.slice(0, 3).map((d) => d.card)).toEqual([null, null, null])
    expect(view.fields[1].deck.slice(0, 3).map((d) => d.knownBy)).toEqual([2, 2, 2])

    const [det] = determinise({ view, decks: DECKS, rng: seedRng(11) })
    const top3 = det.players[1].deck.slice(0, 3)
    for (const id of top3) {
      expect(knows(det, 1, id), 'the simulated opponent forgot what it had looked at').toBe(true)
      expect(knows(det, 0, id), 'root learned something it must not know').toBe(false)
    }
  })

  it('samples those positions differently across determinisations', () => {
    // The identities are invented, so two worlds should disagree about them — otherwise the search is
    // reasoning about one fixed guess rather than an information set.
    const { s } = look(makeGame({ defs: VANILLA_POOL, decks: DECKS }), 1, [1], 3)
    const view = viewFor(s, 0)
    const codesAt = (seed: number) => {
      const [d] = determinise({ view, decks: DECKS, rng: seedRng(seed) })
      return d.players[1].deck.slice(0, 3).map((id) => d.cards[id]!.code).join(',')
    }
    const worlds = new Set([1, 2, 3, 4, 5, 6, 7, 8].map(codesAt))
    expect(worlds.size, 'every determinisation sampled the same three cards').toBeGreaterThan(1)
  })
})
