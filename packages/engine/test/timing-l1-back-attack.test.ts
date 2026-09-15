import { describe, expect, it } from 'vitest'
import type { Ability } from '../src/abilities.js'
import type { CardDef } from '../src/types.js'
import type { CardId, GameState } from '../src/state.js'
import { findFieldCard } from '../src/state.js'
import { apply } from '../src/apply.js'
import { castBlocker } from '../src/cast.js'
import { legalCommands } from '../src/legal.js'
import { checkInvariants } from '../src/invariants.js'
import { endPhase, makeDef, makeGame, passBoth, withField, withHand, withHandSize, VANILLA_POOL } from './helpers.js'

/**
 * Rung J2 (spec J2-D2..D4, CR §15.2.5): a Character with Back Attack is cast by the PRIORITY HOLDER in either
 * player's Main Phase or Attack Phase window, with the stack empty or not, and enters at once (no stack). The
 * turn player then gains priority (§11.4.7). Synthetic cards; real passes.
 */

const ok = (s: GameState) => expect(checkInvariants(s)).toEqual([])
const quiet = (s: GameState): GameState => withHandSize(withHandSize(s, 0, 0), 1, 0)
const NO_PAY = { dullBackups: [], discards: [] }

const BURN: Ability = {
  id: 'T-BURN:summon', trigger: { kind: 'summonResolve' }, text: 'Choose 1 Forward. Deal it 5000 damage.',
  effects: [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'any' }, then: [{ kind: 'damage', amount: 5000 }] }],
}
const DEFS: CardDef[] = [
  ...VANILLA_POOL,
  makeDef({ code: 'T-BA', cost: 0, power: 5000, keywords: ['backAttack'] }),
  makeDef({ code: 'T-BA-B', type: 'backup', cost: 0, power: null, keywords: ['backAttack'] }),
  makeDef({ code: 'T-PLAIN', cost: 0, power: 5000 }),
  makeDef({ code: 'T-FS6', cost: 0, power: 6000, keywords: ['firstStrike'] }),
  makeDef({ code: 'T-BURN', type: 'summon', cost: 0, power: null, hasAbilities: true, abilityClauses: 1, abilities: [BURN] }),
]

const castsOf = (s: GameState, p: 0 | 1, id: CardId) => legalCommands(s, p).filter((c) => c.type === 'castCharacter' && c.card === id)

describe('L1 §15.2.5 — a Back Attack Character is cast by the priority holder, in any window', () => {
  it('L1 §15.2.5.2 — the NON-turn player casts it in the turn player’s Main Phase 1, once the turn player has forfeited (§11.1.6); a plain Character is still refused', () => {
    let s = quiet(makeGame({ defs: DEFS }))
    let ba: CardId, plain: CardId
    ;[s, ba] = withHand(s, 1, 'T-BA')
    ;[s, plain] = withHand(s, 1, 'T-PLAIN')
    expect(castBlocker(s, 1, ba), 'without priority: no').toBe('priority')
    s = apply(s, { type: 'pass', player: 0 }).state
    expect(s.priority).toBe(1)
    expect(castBlocker(s, 1, ba)).toBeNull()
    expect(castsOf(s, 1, ba)).toHaveLength(1)
    expect(castBlocker(s, 1, plain), '§9.3.1.5: a plain Character is the turn player’s only').toBe('notTurnPlayer')
    const r = apply(s, { type: 'castCharacter', player: 1, card: ba, payment: NO_PAY })
    expect(findFieldCard(r.state, ba)?.owner, 'on the field at once (§15.2.5.4)').toBe(1)
    expect(r.state.stack, 'no stack').toEqual([])
    expect(r.state.priority, '§11.4.7: the TURN player gains priority').toBe(0)
    expect(r.state.passes).toBe(0)
    ok(r.state)
  })

  it('L1 §15.2.5.2 — the defender casts it in the `declared` and `blocked` windows; the turn player in `preparation`', () => {
    let s = quiet(endPhase(makeGame({ defs: DEFS })))   // player 0's declaration step
    let a: CardId, ba: CardId, mine: CardId, blocker: CardId
    ;[s, a] = withField(s, 0, 'forwards', 'V-F2')
    ;[s, blocker] = withField(s, 1, 'forwards', 'V-F3')
    ;[s, ba] = withHand(s, 1, 'T-BA')
    ;[s, mine] = withHand(s, 0, 'T-BA')
    expect(castBlocker(s, 0, mine), 'the declaration step is a decision, not a window').toBe('phase')
    let t = apply(s, { type: 'declareAttack', player: 0, attackers: [a] }).state
    expect(castBlocker(t, 0, mine), 'the attacker, holding the `declared` window').toBeNull()
    t = apply(t, { type: 'pass', player: 0 }).state
    expect(castBlocker(t, 1, ba), 'the defender, once handed the window').toBeNull()
    const cast = apply(t, { type: 'castCharacter', player: 1, card: ba, payment: NO_PAY }).state
    expect(cast.attack?.step, 'the window is still open').toBe('declared')
    expect(cast.priority, '§11.4.7').toBe(0)
    let u = passBoth(cast).state                                          // out of the window: the block is owed
    expect(u.pending).toEqual({ kind: 'declareBlock', player: 1 })
    expect(legalCommands(u, 1).some((c) => c.type === 'declareBlock' && c.blocker === ba), 'the surprise blocker is active and may block').toBe(true)
    u = apply(u, { type: 'declareBlock', player: 1, blocker }).state
    let b: CardId
    ;[u, b] = withHand(u, 1, 'T-BA')
    u = apply(u, { type: 'pass', player: 0 }).state
    expect(castBlocker(u, 1, b), 'the `blocked` window too').toBeNull()
    // And the preparation window, for the turn player.
    let p = quiet(makeGame({ defs: DEFS }))
    ;[p, mine] = withHand(p, 0, 'T-BA')
    p = passBoth(p).state
    expect(p.attack?.step).toBe('preparation')
    expect(castBlocker(p, 0, mine)).toBeNull()
    ok(u)
  })

  it('L1 §15.2.5.3 — a response: cast with the opponent’s Summon on the stack, the Character is on the field before it resolves', () => {
    let s = quiet(makeGame({ defs: DEFS }))
    let ba: CardId, victim: CardId, burn: CardId
    ;[s, ba] = withHand(s, 1, 'T-BA')
    ;[s, victim] = withField(s, 1, 'forwards', 'V-F2')
    ;[s, burn] = withHand(s, 0, 'T-BURN')
    let t = apply(s, { type: 'castSummon', player: 0, card: burn, payment: NO_PAY }).state
    t = apply(t, { type: 'chooseTargets', player: 0, targets: [victim] }).state
    expect(t.stack).toHaveLength(1)
    t = apply(t, { type: 'pass', player: 0 }).state
    expect(castBlocker(t, 1, ba), 'the stack is not empty, and that is fine for Back Attack').toBeNull()
    const cast = apply(t, { type: 'castCharacter', player: 1, card: ba, payment: NO_PAY }).state
    expect(findFieldCard(cast, ba)).not.toBeNull()
    expect(cast.stack, 'the Summon is still waiting').toHaveLength(1)
    expect(cast.priority).toBe(0)
    const done = passBoth(cast).state
    expect(done.stack).toEqual([])
    expect(findFieldCard(done, victim), '5000 ≥ 5000').toBeNull()
    expect(findFieldCard(done, ba), 'the response was on the field first').not.toBeNull()
    ok(done)
  })

  it('L1 §15.2.3.3 — not in the First Strike window, where nothing may be cast', () => {
    let s = quiet(endPhase(makeGame({ defs: DEFS })))
    let a: CardId, blocker: CardId, ba: CardId
    ;[s, a] = withField(s, 0, 'forwards', 'T-FS6')
    ;[s, blocker] = withField(s, 1, 'forwards', 'V-F3')
    ;[s, ba] = withHand(s, 0, 'T-BA')
    let t = apply(s, { type: 'declareAttack', player: 0, attackers: [a] }).state
    t = passBoth(t).state
    t = apply(t, { type: 'declareBlock', player: 1, blocker }).state
    t = passBoth(t).state
    expect(t.attack?.step).toBe('firstStrike')
    expect(castBlocker(t, 0, ba)).toBe('phase')
    expect(legalCommands(t, 0).map((c) => c.type).filter((x) => x !== 'concede')).toEqual(['pass'])
  })

  it('L1 §7.7.4 — a Back Attack Backup is castable in a window, but never as a sixth Backup', () => {
    let s = quiet(makeGame({ defs: DEFS }))
    let b: CardId
    ;[s, b] = withHand(s, 1, 'T-BA-B')
    s = apply(s, { type: 'pass', player: 0 }).state
    expect(castBlocker(s, 1, b)).toBeNull()
    for (let i = 0; i < 5; i++) [s] = withField(s, 1, 'backups', 'V-B1')
    expect(castBlocker(s, 1, b)).toBe('backupsFull')
  })
})
