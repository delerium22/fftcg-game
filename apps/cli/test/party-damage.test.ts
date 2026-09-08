import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { apply, legalCommands, viewFor, type CardId, type GameState } from '@fftcg/engine'
import { loadCards } from '@fftcg/cards'
import { parseDeckFile } from '../src/deck.js'
import { IsmctsAgent } from '@fftcg/ai'
import { endPhase, makeGame, passBoth, withField } from '../../../packages/engine/test/helpers.js'

/**
 * Rung K1-A2 — the position that found the rung: seed 8, turn 6. Cloud (protected by his own trigger) and
 * Shantotto attack as a party; the AI blocks with Billy Bob (8000) and owes the split. Before K1 the search
 * at the browser's budget put the damage on the Forward that could not be broken in 7 of 10 seeds.
 */
const DEFS = loadCards()
const STARTER = parseDeckFile(readFileSync(new URL('../../../decks/starter-2025-vol2.txt', import.meta.url), 'utf8'))
const DECKS: [string[], string[]] = [STARTER, STARTER]
const CLOUD = '27-124S', SHANTOTTO = '12-120C', BILLY = '18-124C', HUGH = '24-063H', LUSO = '27-125S'

/** Move one deck card of each `code` onto `player`'s field, so the deck lists stay whole for `determinise`. */
function fromDeck(s: GameState, player: 0 | 1, codes: readonly string[]): GameState {
  const ps = s.players[player]
  const deck = [...ps.deck]
  for (const code of codes) {
    const i = deck.findIndex((id) => s.cards[id]!.code === code)
    if (i < 0) throw new Error(`no ${code} left in player ${player}'s deck`)
    deck.splice(i, 1)
  }
  const players: GameState['players'] = [s.players[0], s.players[1]]
  players[player] = { ...ps, deck }
  return { ...s, players }
}

describe('K1-A2 — the seed-8 split, real cards, 64 iterations', () => {
  it('breaks Shantotto in at least 9 of 10 seeds', () => {
    let s: GameState = endPhase(makeGame({ defs: DEFS, decks: DECKS }))
    let safe: CardId, soft: CardId, blocker: CardId
    ;[s, safe] = withField(s, 0, 'forwards', CLOUD, { flags: ['cannotBeBroken', 'cannotBeReturnedByOpponent'] })
    ;[s, soft] = withField(s, 0, 'forwards', SHANTOTTO)
    ;[s, blocker] = withField(s, 1, 'forwards', BILLY)
    ;[s] = withField(s, 1, 'forwards', HUGH, { status: 'dull' })
    ;[s] = withField(s, 1, 'forwards', LUSO)
    s = fromDeck(fromDeck(s, 0, [CLOUD, SHANTOTTO]), 1, [BILLY, HUGH, LUSO])
    s = passBoth(apply(s, { type: 'declareAttack', player: 0, attackers: [safe, soft] }).state).state
    s = passBoth(apply(s, { type: 'declareBlock', player: 1, blocker }).state).state
    expect(s.pending).toEqual({ kind: 'assignPartyDamage', player: 1 })
    const legal = legalCommands(s, 1)
    let breaks = 0
    for (let seed = 1; seed <= 10; seed++) {
      const agent = new IsmctsAgent({ seed, decks: DECKS, iterations: 64 })
      const c = agent.decide(viewFor(s, 1), legal)
      if (c.type === 'assignPartyDamage' && c.assignments.some((a) => a.target === soft && a.amount >= 7000)) breaks++
    }
    expect(breaks).toBeGreaterThanOrEqual(9)
  }, 60_000)
})
