import { describe, expect, it } from 'vitest'
import type { CardId, Event, GameState } from '@fftcg/engine'
import { checkInvariants, findFieldCard, legalCommands, powerOf } from '@fftcg/engine'
import { endPhase, makeGame, step, trace, withField, withHand } from '../harness.js'

/**
 * Rung J9, Layer 3 (spec J9-D3): the End Phase — hand size, damage removal, until-end-of-turn expiry — then the
 * next turn's Active and Draw Phases, none of which wait for a command. On the shipped cards, as a golden order.
 */

const ok = (s: GameState) => expect(checkInvariants(s)).toEqual([])

describe('scenario: the End Phase — hand size, damage removal, until-end-of-turn expiry, then the next turn', () => {
  it('L3 end-phase — the discards are owed first; damage and the pump go together; the new turn player starts in Main Phase 1 having drawn two', () => {
    let s = makeGame()
    let prishe: CardId, luso: CardId
    ;[s, prishe] = withField(s, 0, 'forwards', '22-068R', { powerBonus: 2000 })    // as if chosen this turn
    ;[s, luso] = withField(s, 0, 'forwards', '27-125S', { damage: 2000 })
    for (let i = 0; i < 7; i++) [s] = withHand(s, 0, '18-064C')
    const names: Record<number, string> = { [prishe]: 'prishe', [luso]: 'luso' }
    const log: Event[] = []
    s = endPhase(endPhase(s))                                              // → main2
    expect(s.phase).toBe('main2')
    // §9.3.1.2 → §9.5.1.2: the End Phase asks for two discards before anything else.
    s = step(log, s, { type: 'pass', player: 0 }); s = step(log, s, { type: 'pass', player: 1 })
    expect(s.phase).toBe('end')
    expect(s.pending).toEqual({ kind: 'discardToHandSize', player: 0, count: 2 })
    const discard = legalCommands(s, 0).find((c) => c.type === 'discardToHandSize')
    expect(discard).toBeDefined()
    if (discard?.type === 'discardToHandSize') { expect(discard.cards).toHaveLength(2); names[discard.cards[0]!] = 'geo1'; names[discard.cards[1]!] = 'geo2' }
    const p1DeckBefore = s.players[1].deck.length
    // §9.5.1.3 (both at once), §9.5.1.5, §9.1.1.1, §9.2.1.1, §9.3.1.4 — all inside the one apply.
    s = step(log, s, discard!)
    expect(s.players[0].hand).toHaveLength(5)
    expect(s.turn).toBe(2); expect(s.turnPlayer).toBe(1); expect(s.phase).toBe('main1'); expect(s.priority).toBe(1)
    expect(findFieldCard(s, luso)!.card.damage, '§9.5.1.3.1').toBe(0)
    expect(powerOf(s, findFieldCard(s, prishe)!.card), '§9.5.1.3.2').toBe(5000)
    expect(s.players[1].deck.length, '§9.2.1.1: two drawn').toBe(p1DeckBefore - 2)
    expect(trace(log, names)).toEqual([
      'phase:end', 'discard:geo1', 'discard:geo2',
      'phase:active', 'phase:draw', 'drew:1:2', 'phase:main1',
    ])
    ok(s)
  })
})
