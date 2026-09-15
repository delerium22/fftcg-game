import { describe, expect, it } from 'vitest'
import type { CardId, Event, GameState } from '@fftcg/engine'
import { checkInvariants, findFieldCard, legalCommands } from '@fftcg/engine'
import { EARTH_BACKUP, endPhase, makeGame, passBoth, step, trace, withCp, withField, withHand } from '../harness.js'

/**
 * Rung J3, Layer 3 (spec J3-A5): Freeze on the shipped cards. Shiva, paid with the ice Summoner and two earth
 * Backups, freezes the opponent's dull Luso; Luso stays dull through the opponent's next Active Phase (§15.2.4.2)
 * and activates in the one after.
 */

const ok = (s: GameState) => expect(checkInvariants(s)).toEqual([])
const card = (s: GameState, id: CardId) => findFieldCard(s, id)!.card

/** Both forfeit through the rest of the turn into the next one, answering a hand-size discard if one is owed. */
function nextTurn(log: Event[], s: GameState): GameState {
  let t = endPhase(endPhase(s))
  const r = passBoth(t); log.push(...r.events); t = r.state
  if (t.pending?.kind === 'discardToHandSize') {
    const d = legalCommands(t, t.pending.player).find((c) => c.type === 'discardToHandSize')!
    t = step(log, t, d)
  }
  return t
}

describe('scenario: Shiva freezes — a dull Forward misses its next Active Phase and activates the one after', () => {
  it('L3 shiva-freezes — Shiva resolves after both forfeit, Luso is frozen; turn 2 thaws it without activating; turn 4 activates it', () => {
    let s = makeGame()
    let luso: CardId, shiva: CardId, cp: CardId[]
    ;[s, luso] = withField(s, 1, 'forwards', '27-125S', { status: 'dull' })
    ;[s, shiva] = withHand(s, 0, '1-038R')
    ;[s, cp] = withCp(s, 0, ['1-040C', EARTH_BACKUP, EARTH_BACKUP])   // §11.2.2: one ice CP, the rest any element
    const names = { [luso]: 'luso', [shiva]: 'shiva' }
    const log: Event[] = []
    s = step(log, s, { type: 'castSummon', player: 0, card: shiva, payment: { dullBackups: cp, discards: [] } })
    expect(s.pending).toEqual(expect.objectContaining({ kind: 'chooseTargets', player: 0 }))
    s = step(log, s, { type: 'chooseTargets', player: 0, targets: [luso] })   // §11.3.3: declared at cast
    s = step(log, s, { type: 'pass', player: 0 }); s = step(log, s, { type: 'pass', player: 1 })   // §11.1.7: Shiva resolves
    expect(card(s, luso).frozen).toBe(true)
    expect(card(s, luso).status, 'already dull: "Dull it" changes nothing').toBe('dull')
    expect(s.players[0].breakZone, '§11.11.10').toContain(shiva)
    // Turn 2 is the opponent's: their Active Phase leaves Luso dull and clears the status (§15.2.4.2).
    s = nextTurn(log, s)
    expect(s.turn).toBe(2); expect(s.turnPlayer).toBe(1)
    expect(card(s, luso).status).toBe('dull')
    expect(card(s, luso).frozen).toBe(false)
    // Turn 4 is theirs again: an ordinary Active Phase.
    s = nextTurn(log, s); s = nextTurn(log, s)
    expect(s.turn).toBe(4); expect(s.turnPlayer).toBe(1)
    expect(card(s, luso).status).toBe('active')
    expect(trace(log, names).slice(0, 9)).toEqual([
      'push:summon:shiva', 'frozen:luso', 'resolve:summon:shiva',
      'phase:end', 'phase:active', 'thawed:luso', 'phase:draw', 'drew:1:2', 'phase:main1',
    ])
    ok(s)
  })
})
