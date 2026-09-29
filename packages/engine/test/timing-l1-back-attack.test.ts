import { describe, expect, it } from 'vitest'
import type { Ability } from '../src/abilities.js'
import type { CardDef } from '../src/types.js'
import type { CardId, GameState } from '../src/state.js'
import { findFieldCard } from '../src/state.js'
import { apply } from '../src/apply.js'
import { castBlocker } from '../src/cast.js'
import { forcedPass, legalCommands } from '../src/legal.js'
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
const ETB: Ability = {
  id: 'T-BA-ETB:etb', trigger: { kind: 'enterField' }, text: 'When this enters the field, choose 1 Forward. Deal it 5000 damage.',
  effects: [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'any' }, then: [{ kind: 'damage', amount: 5000 }] }],
}
const WATCH_ENTER: Ability = {
  id: 'T-OBS-ENTER:draw', trigger: { kind: 'observesEnterField', whose: 'opponent', of: 'forward' }, text: 'When a Forward opponent controls enters the field, draw 1 card.',
  effects: [{ kind: 'draw', count: 1 }],
}
const DEFS: CardDef[] = [
  ...VANILLA_POOL,
  makeDef({ code: 'T-BA', cost: 0, power: 5000, keywords: ['backAttack'] }),
  makeDef({ code: 'T-BA-ETB', cost: 0, power: 5000, keywords: ['backAttack'], hasAbilities: true, abilityClauses: 1, abilities: [ETB] }),
  makeDef({ code: 'T-OBS-ENTER', cost: 0, power: 1000, hasAbilities: true, abilityClauses: 1, abilities: [WATCH_ENTER] }),
  makeDef({ code: 'T-BA-B', type: 'backup', cost: 0, power: null, keywords: ['backAttack'] }),
  makeDef({ code: 'T-PLAIN', cost: 0, power: 5000 }),
  makeDef({ code: 'T-FS6', cost: 0, power: 6000, keywords: ['firstStrike'] }),
  makeDef({ code: 'T-BA2', cost: 2, power: 5000, keywords: ['backAttack'] }),
  makeDef({ code: 'T-S2', type: 'summon', cost: 2, power: null }),
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

  it('L1 §11.4.7 + §11.8.7 — the ETB of a non-turn player’s Back Attack cast: the turn player holds priority while the caster declares its targets; the turn player’s watcher is placed first and the caster’s ETB resolves on top (J2 review M2)', () => {
    let s = quiet(endPhase(makeGame({ defs: DEFS })))
    let a: CardId, watcher: CardId, ba: CardId, victim: CardId
    ;[s, a] = withField(s, 0, 'forwards', 'V-F2')
    ;[s, watcher] = withField(s, 0, 'forwards', 'T-OBS-ENTER')
    ;[s, victim] = withField(s, 0, 'forwards', 'V-F5')            // 7000: the 5000 only scratches it
    ;[s, ba] = withHand(s, 1, 'T-BA-ETB')
    let t = apply(s, { type: 'declareAttack', player: 0, attackers: [a] }).state
    t = apply(t, { type: 'pass', player: 0 }).state
    const cast = apply(t, { type: 'castCharacter', player: 1, card: ba, payment: NO_PAY }).state
    expect(findFieldCard(cast, ba), 'on the field at once (§15.2.5.4)').not.toBeNull()
    expect(cast.priority, '§11.4.7: the turn player holds priority').toBe(0)
    expect(cast.pending, 'yet the caster declares its ETB’s targets as it is placed (§11.8.7)').toEqual(expect.objectContaining({ kind: 'chooseTargets', player: 1 }))
    const placed = apply(cast, { type: 'chooseTargets', player: 1, targets: [victim] }).state
    expect(placed.stack.map((i) => (i.kind === 'ability' ? i.frame.abilityId : 'summon')), 'the turn player’s clause is placed first, the non-turn player’s on top (§11.8.7)').toEqual(['T-OBS-ENTER:draw', 'T-BA-ETB:etb'])
    expect([placed.priority, placed.passes]).toEqual([0, 0])
    expect(placed.attack?.step).toBe('declared')
    const one = passBoth(placed).state
    expect(one.stack.map((i) => (i.kind === 'ability' ? i.frame.abilityId : 'summon')), 'the ETB resolved first').toEqual(['T-OBS-ENTER:draw'])
    expect(findFieldCard(one, victim)?.card.damage).toBe(5000)
    const two = passBoth(one).state
    expect(two.stack).toEqual([])
    expect(two.players[0].hand, 'the watcher drew').toHaveLength(1)
    expect(two.attack?.step, 'still the declared window: a Summon or ability could not have stopped the entry').toBe('declared')
    ok(two)
    void watcher
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

  it('L1 §15.2.5.2 — Main Phase 2 and the post-damage `damage` window too (J2 second review L1)', () => {
    // Main Phase 2: the turn player passes the declaration step; the non-turn player casts once handed priority.
    let s = quiet(endPhase(makeGame({ defs: DEFS })))
    let a: CardId, ba: CardId
    ;[s, a] = withField(s, 0, 'forwards', 'V-F2')
    ;[s, ba] = withHand(s, 1, 'T-BA')
    let m = apply(s, { type: 'pass', player: 0 }).state
    expect(m.phase).toBe('main2')
    m = apply(m, { type: 'pass', player: 0 }).state
    expect(castBlocker(m, 1, ba)).toBeNull()
    // The `damage` window of an unblocked attack.
    let t = apply(s, { type: 'declareAttack', player: 0, attackers: [a] }).state
    t = passBoth(t).state
    t = apply(t, { type: 'declareBlock', player: 1, blocker: null }).state
    t = passBoth(t).state
    expect(t.attack?.step).toBe('damage')
    t = apply(t, { type: 'pass', player: 0 }).state
    expect(castBlocker(t, 1, ba)).toBeNull()
    const cast = apply(t, { type: 'castCharacter', player: 1, card: ba, payment: NO_PAY }).state
    expect([cast.attack?.step, cast.priority]).toEqual(['damage', 0])
    ok(cast)
  })

  it('L1 §15.2.5.3 + §11.8.7 — an ETB cast in response goes ON TOP of the waiting Summon and resolves first (J2 second review L2)', () => {
    let s = quiet(makeGame({ defs: DEFS }))
    let ba: CardId, victim: CardId, burn: CardId, scratch: CardId
    ;[s, ba] = withHand(s, 1, 'T-BA-ETB')
    ;[s, victim] = withField(s, 1, 'forwards', 'V-F2')
    ;[s, scratch] = withField(s, 0, 'forwards', 'V-F5')            // 7000: the ETB's 5000 only scratches it
    ;[s, burn] = withHand(s, 0, 'T-BURN')
    let t = apply(s, { type: 'castSummon', player: 0, card: burn, payment: NO_PAY }).state
    t = apply(t, { type: 'chooseTargets', player: 0, targets: [victim] }).state
    t = apply(t, { type: 'pass', player: 0 }).state
    const cast = apply(t, { type: 'castCharacter', player: 1, card: ba, payment: NO_PAY }).state
    expect(cast.pending).toEqual(expect.objectContaining({ kind: 'chooseTargets', player: 1 }))
    const placed = apply(cast, { type: 'chooseTargets', player: 1, targets: [scratch] }).state
    expect(placed.stack.map((i) => (i.kind === 'ability' ? i.frame.abilityId : 'summon'))).toEqual(['summon', 'T-BA-ETB:etb'])
    expect([placed.priority, placed.passes], '§11.4.7').toEqual([0, 0])
    const one = passBoth(placed).state
    expect(findFieldCard(one, scratch)?.card.damage, 'the ETB resolved first').toBe(5000)
    expect(one.stack).toHaveLength(1)
    const two = passBoth(one).state
    expect(two.stack).toEqual([])
    expect(findFieldCard(two, victim), 'then the Summon').toBeNull()
    ok(two)
  })

  it('an UNAFFORDABLE Back Attack Character or Summon is not a decision: forcedPass passes (J2 second review M1)', () => {
    for (const code of ['T-BA2', 'T-S2']) {
      let s = quiet(endPhase(makeGame({ defs: DEFS })))
      let a: CardId
      ;[s, a] = withField(s, 0, 'forwards', 'V-F2')
      ;[s] = withHand(s, 1, code)                                  // its only card: nothing to pay 2 CP with
      let t = apply(s, { type: 'declareAttack', player: 0, attackers: [a] }).state
      t = apply(t, { type: 'pass', player: 0 }).state
      expect(legalCommands(t, 1).map((c) => c.type).filter((x) => x !== 'concede'), code).toEqual(['pass'])
      expect(forcedPass(t), code).toEqual({ type: 'pass', player: 1 })
      // One more card to discard for 2 CP: now it is a choice.
      ;[t] = withHand(t, 1, 'V-F1')
      expect(forcedPass(t), `${code}, affordable`).toBeNull()
    }
  })

  it('L1 §15.2.3.3 — in the First Strike window too: it bars Summons and abilities, and a Character cast is neither', () => {
    // J3 second review H2 (CR 3.3 letter; §9.3.1.5 makes a Character cast a special action, not a special ability).
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
    expect(castBlocker(t, 0, ba)).toBeNull()
    expect(forcedPass(t), 'a real choice: the window is not pass-only').toBeNull()
    const cast = legalCommands(t, 0).find((c) => c.type === 'castCharacter' && c.card === ba)
    expect(cast).toBeDefined()
    const u = apply(t, cast!).state
    expect(findFieldCard(u, ba), 'on the field between the batches').not.toBeNull()
    expect(u.attack?.step, 'the window stays open').toBe('firstStrike')
    expect([u.priority, u.passes], '§11.4.7: the turn player gains priority').toEqual([0, 0])
    const done = passBoth(u).state
    expect(done.attack?.step).toBe('damage')
    ok(done)
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
