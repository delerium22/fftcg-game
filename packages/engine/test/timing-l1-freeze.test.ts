import { describe, expect, it } from 'vitest'
import type { Ability } from '../src/abilities.js'
import type { CardDef } from '../src/types.js'
import type { CardId, GameState } from '../src/state.js'
import { findFieldCard } from '../src/state.js'
import { apply } from '../src/apply.js'
import { legalCommands } from '../src/legal.js'
import { checkInvariants } from '../src/invariants.js'
import { endPhase, makeDef, makeGame, passBoth, withField, withHand, withHandSize, VANILLA_POOL } from './helpers.js'

/**
 * Rung J3 (spec J3-D6/D7, CR §15.2.4): Freeze is a status on the field card. A frozen Character does not
 * activate in its controller's next Active Phase, and the status clears there — one skip, then normal. It does
 * not dull, and the End Phase leaves it alone. Synthetic cards; real passes.
 */

const ok = (s: GameState) => expect(checkInvariants(s)).toEqual([])
const quiet = (s: GameState): GameState => withHandSize(withHandSize(s, 0, 0), 1, 0)

const FREEZE: Ability = {
  id: 'T-FREEZE:summon', trigger: { kind: 'summonResolve' }, text: 'Choose 1 Forward. Dull it and Freeze it.',
  effects: [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'any' }, then: [{ kind: 'dull' }, { kind: 'freeze' }] }],
}
const FREEZE_BACKUP: Ability = {
  id: 'T-FREEZE-BACKUP:summon', trigger: { kind: 'summonResolve' }, text: 'Choose 1 Backup. Dull it and Freeze it.',
  effects: [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'backups', controller: 'any' }, then: [{ kind: 'dull' }, { kind: 'freeze' }] }],
}
const FREEZE_ONLY: Ability = {
  id: 'T-FREEZE-ONLY:summon', trigger: { kind: 'summonResolve' }, text: 'Choose 1 Forward. Freeze it.',
  effects: [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'any' }, then: [{ kind: 'freeze' }] }],
}
const DEFS: CardDef[] = [
  ...VANILLA_POOL,
  makeDef({ code: 'T-FREEZE', type: 'summon', cost: 0, power: null, hasAbilities: true, abilityClauses: 1, abilities: [FREEZE] }),
  makeDef({ code: 'T-FREEZE-ONLY', type: 'summon', cost: 0, power: null, hasAbilities: true, abilityClauses: 1, abilities: [FREEZE_ONLY] }),
  makeDef({ code: 'T-FREEZE-BACKUP', type: 'summon', cost: 0, power: null, hasAbilities: true, abilityClauses: 1, abilities: [FREEZE_BACKUP] }),
]

/** Player 0 casts `code` at `target` in its Main Phase 1 and both forfeit: the Summon has resolved. */
function castAndResolve(s: GameState, code: string, target: CardId): { state: GameState; events: import('../src/events.js').Event[] } {
  let t = s; let card: CardId
  ;[t, card] = withHand(t, 0, code)
  const cmd = legalCommands(t, 0).find((c) => c.type === 'castSummon' && c.card === card)
  expect(cmd, `${code} is castable`).toBeDefined()
  let r = apply(t, cmd!)
  const chosen = apply(r.state, { type: 'chooseTargets', player: 0, targets: [target] })
  r = { state: chosen.state, events: [...r.events, ...chosen.events] }
  const p = passBoth(r.state)
  return { state: p.state, events: [...r.events, ...p.events] }
}
/** Walk from player 0's Main Phase 1 to the start of the next turn (both forfeit through every phase). */
function nextTurn(s: GameState): GameState {
  let t = endPhase(endPhase(s))     // main1 → declaration → main2
  t = passBoth(t).state             // main2 → end → next turn's main1
  return t
}
const card = (s: GameState, id: CardId) => findFieldCard(s, id)!.card

describe('L1 §15.2.4 — Freeze is a status that skips one Active Phase', () => {
  it('L1 §15.2.4.2 — a frozen dull Forward stays dull through its controller’s next Active Phase, thaws there, and activates the one after', () => {
    let s = quiet(makeGame({ defs: DEFS }))
    let victim: CardId
    ;[s, victim] = withField(s, 1, 'forwards', 'V-F2')
    const r = castAndResolve(s, 'T-FREEZE', victim)
    expect(r.events.map((e) => e.type)).toEqual(expect.arrayContaining(['dulled', 'frozen']))
    expect(r.events).toContainEqual({ type: 'frozen', card: victim })
    expect(card(r.state, victim).status).toBe('dull')
    expect(card(r.state, victim).frozen).toBe(true)
    ok(r.state)
    // Turn 2 is player 1's: its Active Phase would have activated the Forward. Frozen: it stays dull and thaws.
    let t = nextTurn(r.state)
    expect(t.turn).toBe(2); expect(t.turnPlayer).toBe(1)
    expect(card(t, victim).status, '§15.2.4.2: not activated').toBe('dull')
    expect(card(t, victim).frozen, 'one skip, then the status is gone').toBe(false)
    ok(t)
    // Turn 4 is player 1's again: an ordinary Active Phase.
    t = nextTurn(t)                // turn 3, player 0's
    t = nextTurn(t)                // turn 4, player 1's
    expect(t.turn).toBe(4); expect(t.turnPlayer).toBe(1)
    expect(card(t, victim).status).toBe('active')
    ok(t)
  })

  it('L1 §15.2.4.2 — the `thawed` event names the card the Active Phase left dull', () => {
    let s = quiet(makeGame({ defs: DEFS }))
    let victim: CardId
    ;[s, victim] = withField(s, 1, 'forwards', 'V-F2')
    const r = castAndResolve(s, 'T-FREEZE', victim)
    const turn = passBoth(endPhase(endPhase(r.state)))
    expect(turn.events).toContainEqual({ type: 'thawed', card: victim })
    expect(turn.events.filter((e) => e.type === 'activated').flatMap((e) => (e.type === 'activated' ? e.cards : []))).not.toContain(victim)
  })

  it('L1 §15.2.4.1 — freezing an ACTIVE Forward does not dull it; it is simply active and frozen, and stays active', () => {
    let s = quiet(makeGame({ defs: DEFS }))
    let victim: CardId
    ;[s, victim] = withField(s, 1, 'forwards', 'V-F2')
    const r = castAndResolve(s, 'T-FREEZE-ONLY', victim)
    expect(r.events.map((e) => e.type)).not.toContain('dulled')
    expect(card(r.state, victim).status).toBe('active')
    expect(card(r.state, victim).frozen).toBe(true)
    const t = nextTurn(r.state)
    expect(card(t, victim).status).toBe('active')
    expect(card(t, victim).frozen).toBe(false)
    ok(t)
  })

  it('L1 §15.2.4.1 — a Backup can be frozen, and the End Phase leaves `frozen` alone', () => {
    let s = quiet(makeGame({ defs: DEFS }))
    let backup: CardId
    ;[s, backup] = withField(s, 1, 'backups', 'V-B1', { status: 'dull' })
    const r = castAndResolve(s, 'T-FREEZE-BACKUP', backup)
    expect(card(r.state, backup).frozen).toBe(true)
    // Through player 0's End Phase (§9.5.1.3 clears until-end-of-turn stamps, not Freeze) into player 1's turn.
    const t = nextTurn(r.state)
    expect(card(t, backup).status, 'the frozen Backup did not activate').toBe('dull')
    expect(card(t, backup).frozen).toBe(false)
    ok(t)
  })

  it('L1 §15.2.4 — a Forward frozen during the OPPONENT’s turn skips its own next Active Phase, not the opponent’s', () => {
    let s = quiet(makeGame({ defs: DEFS }))
    let mine: CardId
    ;[s, mine] = withField(s, 0, 'forwards', 'V-F2', { status: 'dull' })   // player 0's own dull Forward, frozen by player 0's own Summon
    const r = castAndResolve(s, 'T-FREEZE-ONLY', mine)
    expect(card(r.state, mine).frozen).toBe(true)
    let t = nextTurn(r.state)                          // turn 2, player 1's Active Phase: player 0's cards are not activated anyway
    expect(card(t, mine).status).toBe('dull'); expect(card(t, mine).frozen, 'still frozen: the skip is player 0’s to take').toBe(true)
    t = nextTurn(t)                                    // turn 3, player 0's Active Phase: skipped, thawed
    expect(card(t, mine).status).toBe('dull'); expect(card(t, mine).frozen).toBe(false)
    t = nextTurn(t); t = nextTurn(t)                   // turn 5, player 0's: activates
    expect(card(t, mine).status).toBe('active')
    ok(t)
  })
})
