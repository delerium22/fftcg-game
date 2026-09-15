import { describe, expect, it } from 'vitest'
import { apply, forcedPass, legalCommands, viewFor, type GameState } from '@fftcg/engine'
import { candidateCommands } from '../src/candidates.js'
import { GreedyAgent } from '../src/greedy.js'
import { VANILLA_POOL, endPhase, makeDef, makeGame, withField, withHand, withHandSize } from '../../engine/test/helpers.js'

/**
 * Rung J2 (spec J2-D5/J2-A4): the AI needs no Back Attack code — `actionMenu` runs every hand card through
 * `castCheck`, so the cast reaches its candidates in every window where it is legal, and `forcedPass` stops
 * reporting a window the AI could act in.
 */

const decksOf = (s: GameState): [string[], string[]] => ([0, 1] as const).map((p) => {
  const q = s.players[p]
  return [...q.deck, ...q.hand, ...q.forwards.map((c) => c.id), ...q.backups.map((c) => c.id), ...q.damageZone, ...q.breakZone, ...q.removedFromGame].map((id) => s.cards[id]!.code)
}) as [string[], string[]]

const DEFS = [...VANILLA_POOL, makeDef({ code: 'T-BA', cost: 0, power: 5000, keywords: ['backAttack'] })]

/** Player 0 attacks with a 3000 into player 1's empty board; player 1 holds a Back Attack 5000 and the `declared` window. */
function declaredWindow(): { s: GameState; ba: number } {
  let s = withHandSize(withHandSize(makeGame({ defs: DEFS }), 0, 5), 1, 0)
  let a: number, ba: number
  ;[s, a] = withField(s, 0, 'forwards', 'V-F1')
  ;[s, ba] = withHand(s, 1, 'T-BA')
  s = endPhase(s)
  s = apply(s, { type: 'declareAttack', player: 0, attackers: [a] }).state
  s = apply(s, { type: 'pass', player: 0 }).state
  expect(s.attack?.step).toBe('declared'); expect(s.priority).toBe(1)
  return { s, ba }
}

describe('the AI sees a Back Attack cast in a window (J2-A4)', () => {
  it('the `declared` window is a real decision for the defender, and the cast is among its candidates', () => {
    const { s, ba } = declaredWindow()
    expect(forcedPass(s), 'not a pass-only window any more').toBeNull()
    const cands = candidateCommands(s, 1)
    expect(cands.some((c) => c.type === 'castCharacter' && c.card === ba)).toBe(true)
  })

  it('greedy, facing a lone 3000 it can block for free with the 5000 it would cast, casts', () => {
    const { s, ba } = declaredWindow()
    const d = new GreedyAgent({ seed: 1, decks: decksOf(s), depth: 1 }).decide(viewFor(s, 1), legalCommands(s, 1))
    expect(d).toEqual(expect.objectContaining({ type: 'castCharacter', card: ba }))
  })
})
