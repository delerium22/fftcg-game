import { describe, expect, it } from 'vitest'
import type { CardId, GameState } from '../src/state.js'
import { findFieldCard } from '../src/state.js'
import { apply } from '../src/apply.js'
import { legalCommands } from '../src/legal.js'
import { checkInvariants } from '../src/invariants.js'
import { endPhase, makeGame, passBoth, withField, withHand, withHandSize } from './helpers.js'

/**
 * Rung J9, Layer 1: timing primitives the matrix (docs/rules/timing-matrix.md) found untested, each alone, on the
 * vanilla pool. Driven through `apply` and real passes, never `applyNow`, because the priority grants between
 * the moves are what is under test.
 */

const ok = (s: GameState) => expect(checkInvariants(s)).toEqual([])
const quiet = (s: GameState): GameState => withHandSize(withHandSize(s, 0, 0), 1, 0)

describe('L1 — phases nobody can act in (§9.1.1.2, §9.2.1.2)', () => {
  it('L1 §9.1.1.2 §9.2.1.2 — the pass that ends a turn lands in the next Main Phase 1: the Active and Draw Phases happen inside that one apply and never wait for a command', () => {
    let s = quiet(makeGame())
    s = endPhase(endPhase(s))                       // main1 → declaration → main2
    expect(s.phase).toBe('main2')
    const r = passBoth(s)                           // main2 → end → active → draw → main1 of turn 2, in ONE apply
    expect(r.state.turn).toBe(2)
    expect(r.state.phase).toBe('main1')
    expect(r.state.turnPlayer).toBe(1)
    expect(r.state.priority, '§9.3.1.4: the new turn player holds priority').toBe(1)
    const started = r.events.filter((e) => e.type === 'phaseStarted').map((e) => e.phase)
    expect(started, 'both phases are passed through, in order, and the Main Phase is where the state lands').toEqual(['end', 'active', 'draw', 'main1'])
    expect(r.events).toContainEqual({ type: 'drew', player: 1, count: 2 })
    ok(r.state)
  })
})

describe('L1 — a second attack in one turn (§10.1.4.6)', () => {
  it('L1 §10.1.4.6 — after the damage window the turn player may attack again with a Forward that has not attacked, or pass to Main Phase 2', () => {
    let s = quiet(endPhase(makeGame()))
    let a: CardId, b: CardId
    ;[s, a] = withField(s, 0, 'forwards', 'V-F2')
    ;[s, b] = withField(s, 0, 'forwards', 'V-F2')
    expect(s.attack?.step).toBe('declaration')
    let r = apply(s, { type: 'declareAttack', player: 0, attackers: [a] }).state
    r = passBoth(r).state                                       // `declared` window → the block is owed
    expect(r.pending).toEqual({ kind: 'declareBlock', player: 1 })
    r = apply(r, { type: 'declareBlock', player: 1, blocker: null }).state
    r = passBoth(r).state                                       // `blocked` window → one point of damage → `damage` window
    expect(r.attack?.step).toBe('damage')
    expect(r.players[1].damageZone).toHaveLength(1)
    r = passBoth(r).state                                       // `damage` window → back to the declaration step
    expect(r.phase).toBe('attack'); expect(r.attack?.step).toBe('declaration')
    const again = legalCommands(r, 0).filter((c) => c.type === 'declareAttack').map((c) => c.attackers)
    expect(again, 'only the Forward that has not attacked may be declared').toEqual([[b]])
    const second = apply(r, { type: 'declareAttack', player: 0, attackers: [b] }).state
    expect(second.attack?.step).toBe('declared')
    ok(second)
    // Passing at the declaration step instead ends the phase (§10.1.4.6 "otherwise, proceed to Main Phase 2").
    expect(passBoth(r).state.phase).toBe('main2')
  })
})

describe('L1 — who holds priority after a resolution (§11.1.5, §11.3.8)', () => {
  it('L1 §11.1.5 §11.3.8 — the non-turn player casts a Summon and regains priority; when it resolves, the TURN player gains priority with the forfeit count reset', () => {
    let s = quiet(makeGame())
    for (const code of ['V-S2', 'V-F1']) [s] = withHand(s, 1, code)
    s = apply(s, { type: 'pass', player: 0 }).state             // §11.1.6: player 1 holds priority in player 0's Main Phase 1
    expect(s.priority).toBe(1)
    const cast = legalCommands(s, 1).find((c) => c.type === 'castSummon')
    expect(cast, 'the non-turn player may cast a Summon with priority (§9.3.1.6)').toBeDefined()
    s = apply(s, cast!).state
    expect(s.stack).toHaveLength(1)
    expect(s.priority, '§11.3.8: the caster regains priority').toBe(1)
    expect(s.passes).toBe(0)
    s = apply(s, { type: 'pass', player: 1 }).state
    const r = apply(s, { type: 'pass', player: 0 })
    expect(r.events.map((e) => e.type)).toContain('stackResolved')
    expect(r.state.stack).toEqual([])
    expect(r.state.phase).toBe('main1')
    expect(r.state.priority, '§11.1.5: the turn player, not the caster').toBe(0)
    expect(r.state.passes).toBe(0)
    ok(r.state)
  })
})

describe('L1 — a party of any size (§15.1.1.9.4)', () => {
  it('L1 §15.1.1.9.4 — three same-element Forwards attack as one party; a 9000 blocker splits its damage among them and takes the sum', () => {
    let s = quiet(endPhase(makeGame()))
    const party: CardId[] = []
    for (let i = 0; i < 3; i++) { let f: CardId; [s, f] = withField(s, 0, 'forwards', 'V-F2'); party.push(f) }
    let blocker: CardId
    ;[s, blocker] = withField(s, 1, 'forwards', 'V-F8')
    const declared = apply(s, { type: 'declareAttack', player: 0, attackers: party })
    expect(declared.events).toContainEqual({ type: 'attackDeclared', player: 0, attackers: party })
    let r = passBoth(declared.state).state
    r = apply(r, { type: 'declareBlock', player: 1, blocker }).state
    r = passBoth(r).state
    expect(r.pending, '§10.1.4.2.1: the blocker splits 9000 among the party').toEqual({ kind: 'assignPartyDamage', player: 1 })
    r = apply(r, { type: 'assignPartyDamage', player: 1, assignments: [{ target: party[0]!, amount: 5000 }, { target: party[1]!, amount: 4000 }] }).state
    expect(findFieldCard(r, blocker), '15000 into 9000: the blocker breaks').toBeNull()
    expect(findFieldCard(r, party[0]!), '5000 damage on a 5000: broken').toBeNull()
    expect(findFieldCard(r, party[1]!)?.card.damage).toBe(4000)
    expect(findFieldCard(r, party[2]!)?.card.damage).toBe(0)
    ok(r)
  })
})
