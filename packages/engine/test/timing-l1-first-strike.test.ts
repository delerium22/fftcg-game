import { describe, expect, it } from 'vitest'
import type { Ability } from '../src/abilities.js'
import type { CardDef } from '../src/types.js'
import type { CardId, GameState } from '../src/state.js'
import { findFieldCard } from '../src/state.js'
import type { Event } from '../src/events.js'
import { apply } from '../src/apply.js'
import { actingPlayer, forcedPass, isResponseWindow, legalCommands } from '../src/legal.js'
import { checkInvariants } from '../src/invariants.js'
import { endPhase, makeDef, makeGame, passBoth, withField, withHand, withHandSize, VANILLA_POOL } from './helpers.js'

/**
 * Rung J3 (spec J3-D2..D5, CR §15.2.3): First Strike splits a BLOCKED battle's Damage Resolution Step in two.
 * The First Strike combatants deal first; rule processes run; a pass-only window opens (§15.2.3.3); then what is
 * still in battle deals to what is still there; then every damage trigger — the held ones first — is placed and
 * the ordinary §10.1.4.4 window opens. Synthetic cards; real passes.
 */

const ok = (s: GameState) => expect(checkInvariants(s)).toEqual([])
const quiet = (s: GameState): GameState => withHandSize(withHandSize(s, 0, 0), 1, 0)

const WATCH_OWN_DAMAGE: Ability = {
  id: 'T-FS-WATCH:draw', trigger: { kind: 'dealtDamage', to: 'forward', whose: 'any' }, text: 'When this deals damage to a Forward, draw 1 card.',
  effects: [{ kind: 'draw', count: 1 }],
}
const BLOCKER_WATCH: Ability = { ...WATCH_OWN_DAMAGE, id: 'T-WATCH:draw' }
const WATCH_SELF: Ability = { id: 'T-FS-SELF:draw', trigger: { kind: 'dealtDamage', to: 'forward', whose: 'self' }, text: 'When this deals damage to a Forward you control, draw 1 card.', effects: [{ kind: 'draw', count: 1 }] }
const WATCH_OPP: Ability = { id: 'T-FS-OPP:draw', trigger: { kind: 'dealtDamage', to: 'forward', whose: 'opponent' }, text: 'When this deals damage to a Forward opponent controls, draw 1 card.', effects: [{ kind: 'draw', count: 1 }] }
const WATCH_OPP_BREAK: Ability = {
  id: 'T-OBS:draw', trigger: { kind: 'observesZoneChange', from: 'field', to: 'breakZone', whose: 'opponent', of: 'forward' },
  text: 'When a Forward opponent controls is put from the field into the Break Zone, draw 1 card.',
  effects: [{ kind: 'draw', count: 1 }],
}
const NOOP_SUMMON: Ability = {
  id: 'T-SUMMON:noop', trigger: { kind: 'summonResolve' }, text: 'Choose 1 Forward. Dull it.',
  effects: [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'any' }, then: [{ kind: 'dull' }] }],
}
const PUMP: Ability = {
  id: 'T-PUMP:pump', trigger: { kind: 'activated', sourceZone: 'field', cost: { selfToBreakZone: true } },
  text: 'Put this into the Break Zone: Choose 1 Forward. It gains +4000 power until the end of the turn.',
  effects: [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'any' }, then: [{ kind: 'addPower', amount: 4000 }] }],
}
const DEFS: CardDef[] = [
  ...VANILLA_POOL,
  makeDef({ code: 'T-FS6', cost: 0, power: 6000, keywords: ['firstStrike'] }),
  makeDef({ code: 'T-FS5', cost: 0, power: 5000, keywords: ['firstStrike'] }),
  makeDef({ code: 'T-FS-WATCH', cost: 0, power: 6000, keywords: ['firstStrike'], hasAbilities: true, abilityClauses: 1, abilities: [WATCH_OWN_DAMAGE] }),
  makeDef({ code: 'T-WATCH', cost: 0, power: 7000, hasAbilities: true, abilityClauses: 1, abilities: [BLOCKER_WATCH] }),
  makeDef({ code: 'T-OBS', cost: 0, power: 1000, hasAbilities: true, abilityClauses: 1, abilities: [WATCH_OPP_BREAK] }),
  makeDef({ code: 'T-SUMMON', type: 'summon', cost: 0, power: null, hasAbilities: true, abilityClauses: 1, abilities: [NOOP_SUMMON] }),
  makeDef({ code: 'T-PUMP', cost: 0, power: 1000, hasAbilities: true, abilityClauses: 1, abilities: [PUMP] }),
  makeDef({ code: 'T-BIG', cost: 0, power: 13000 }),
  makeDef({ code: 'T-FS-SELF', cost: 0, power: 6000, keywords: ['firstStrike'], hasAbilities: true, abilityClauses: 1, abilities: [WATCH_SELF] }),
  makeDef({ code: 'T-FS-OPP', cost: 0, power: 6000, keywords: ['firstStrike'], hasAbilities: true, abilityClauses: 1, abilities: [WATCH_OPP] }),
]

function trace(events: readonly Event[], names: Record<number, string>): string[] {
  const n = (id: number) => names[id] ?? String(id)
  const out: string[] = []
  for (const e of events) {
    switch (e.type) {
      case 'phaseStarted': if (e.step) out.push(`step:${e.step}`); break
      case 'battleDamage': out.push(`battle:${e.dealers.map(n).join('+')}>${n(e.target)}:${e.amount}`); break   // one packet (rung V2-A1)
      case 'broken': out.push(`broken:${n(e.card)}`); break
      case 'abilityTriggered': out.push(`trigger:${e.abilityId}`); break
      case 'stackPushed': out.push(`push:${e.item.kind === 'ability' ? e.item.abilityId : 'summon'}`); break
      case 'drew': out.push(`drew:${e.player}:${e.count}`); break
      default: break
    }
  }
  return out
}

/** Player 0's declaration step with `attackerCodes` on its field and `blockerCode` on player 1's. */
function board(attackerCodes: string[], blockerCode: string): { s: GameState; attackers: CardId[]; blocker: CardId; names: Record<number, string> } {
  let s = quiet(endPhase(makeGame({ defs: DEFS })))
  const attackers: CardId[] = []; const names: Record<number, string> = {}
  attackerCodes.forEach((code, i) => { let a: CardId; [s, a] = withField(s, 0, 'forwards', code); attackers.push(a); names[a] = `a${i}` })
  let blocker: CardId
  ;[s, blocker] = withField(s, 1, 'forwards', blockerCode); names[blocker] = 'b'
  expect(s.attack?.step).toBe('declaration')
  return { s, attackers, blocker, names }
}
/** Declare, both forfeit the `declared` window, block, both forfeit the `blocked` window: the damage step begins. */
function intoDamage(s: GameState, attackers: CardId[], blocker: CardId | null): { state: GameState; events: Event[] } {
  const log: Event[] = []
  const step = (t: GameState, c: Parameters<typeof apply>[1]) => { const r = apply(t, c); log.push(...r.events); return r.state }
  let t = step(s, { type: 'declareAttack', player: 0, attackers })
  t = step(t, { type: 'pass', player: 0 }); t = step(t, { type: 'pass', player: 1 })
  t = step(t, { type: 'declareBlock', player: 1, blocker })
  t = step(t, { type: 'pass', player: 0 }); t = step(t, { type: 'pass', player: 1 })
  return { state: t, events: log }
}
const gone = (s: GameState, id: CardId) => findFieldCard(s, id) === null
const dmg = (s: GameState, id: CardId) => findFieldCard(s, id)?.card.damage

describe('L1 §15.2.3 — First Strike splits the damage step', () => {
  it('L1 §15.2.3.2 — a 6000 First Strike attacker into a 5000 blocker: the blocker breaks in the first batch and deals nothing; the attacker is undamaged', () => {
    const { s, attackers, blocker, names } = board(['T-FS6'], 'V-F2')
    const r = intoDamage(s, attackers, blocker)
    expect(r.state.attack?.step, '§15.2.3.3: the window between the batches').toBe('firstStrike')
    expect(r.state.priority).toBe(0); expect(r.state.passes).toBe(0)
    expect(gone(r.state, blocker), '§12.4.5 ran before the window (§11.1.3)').toBe(true)
    const w = passBoth(r.state)
    expect(w.state.attack?.step, 'then the ordinary §10.1.4.4 window').toBe('damage')
    expect(dmg(w.state, attackers[0]!), 'nothing left in battle to deal to it').toBe(0)
    expect(trace([...r.events, ...w.events], names)).toEqual(['step:declared', 'step:block', 'step:blocked', 'step:damage', 'battle:a0>b:6000', 'broken:b', 'step:firstStrike', 'step:damage'])
    ok(w.state)
  })

  it('L1 §15.2.3.2 — the mirror: a First Strike blocker breaks a weaker attacker before it deals', () => {
    const { s, attackers, blocker, names } = board(['V-F1'], 'T-FS5')   // 3000 into 5000 First Strike
    const r = intoDamage(s, attackers, blocker)
    expect(r.state.attack?.step).toBe('firstStrike')
    expect(gone(r.state, attackers[0]!)).toBe(true)
    const w = passBoth(r.state)
    expect(dmg(w.state, blocker)).toBe(0)
    expect(trace([...r.events, ...w.events], names)).toEqual(['step:declared', 'step:block', 'step:blocked', 'step:damage', 'battle:b>a0:5000', 'broken:a0', 'step:firstStrike', 'step:damage'])
    ok(w.state)
  })

  it('L1 §15.2.3.2 — a First Strike combatant that does not kill: the survivor deals its damage in the second batch', () => {
    const { s, attackers, blocker, names } = board(['T-FS5'], 'V-F3')   // 5000 First Strike into 7000
    const r = intoDamage(s, attackers, blocker)
    expect(r.state.attack?.step).toBe('firstStrike')
    expect(dmg(r.state, blocker)).toBe(5000)
    const w = passBoth(r.state)
    expect(gone(w.state, attackers[0]!), '7000 ≥ 5000 in the second batch').toBe(true)
    // The resumed step announces itself, then the second batch lands, then §12.4.5 runs.
    expect(trace([...r.events, ...w.events], names)).toEqual(['step:declared', 'step:block', 'step:blocked', 'step:damage', 'battle:a0>b:5000', 'step:firstStrike', 'step:damage', 'battle:b>a0:7000', 'broken:a0'])
    ok(w.state)
  })

  it('L1 §15.2.3.2 — both with First Strike, or neither: one simultaneous batch and no firstStrike step', () => {
    for (const [a, b] of [['T-FS6', 'T-FS5'], ['V-F2', 'V-F3']] as const) {
      const { s, attackers, blocker, names } = board([a], b)
      const r = intoDamage(s, attackers, blocker)
      expect(r.state.attack?.step).toBe('damage')
      expect(trace(r.events, names)).not.toContain('step:firstStrike')
      expect(trace(r.events, names).filter((x) => x.startsWith('battle:'))).toHaveLength(2)
      ok(r.state)
    }
  })

  it('L1 §15.2.3.4 §15.1.1.9.7 — a party deals First Strike damage only if EVERY member has it', () => {
    // One member without: no split, everyone simultaneous, the blocker's split is owed as usual.
    const mixed = board(['T-FS6', 'V-F2'], 'V-F3')
    let r = intoDamage(mixed.s, mixed.attackers, mixed.blocker)
    expect(r.state.pending).toEqual({ kind: 'assignPartyDamage', player: 1 })
    r = { state: apply(r.state, { type: 'assignPartyDamage', player: 1, assignments: [{ target: mixed.attackers[1]!, amount: 7000 }] }).state, events: r.events }
    expect(r.state.attack?.step).toBe('damage')
    // Every member with it: the party deals first, the blocker (no First Strike) deals second — and it is gone by then.
    const all = board(['T-FS6', 'T-FS5'], 'V-F3')
    const q = intoDamage(all.s, all.attackers, all.blocker)
    expect(q.state.attack?.step).toBe('firstStrike')
    expect(gone(q.state, all.blocker), '11000 into 7000').toBe(true)
    const w = passBoth(q.state)
    expect(w.state.pending, 'a blocker that left owes no split').toBeNull()
    expect(w.state.attack?.step).toBe('damage')
    expect(dmg(w.state, all.attackers[0]!)).toBe(0); expect(dmg(w.state, all.attackers[1]!)).toBe(0)
    ok(w.state)
  })

  it('L1 §10.1.4.2.1 — an all-First-Strike party into a plain blocker that survives: the split is owed only after the window, over the survivors', () => {
    // J3 Codex second pass M3: the post-window split (`exitAttackWindow` → `landSecondBatch`) had no case.
    const { s, attackers, blocker, names } = board(['T-FS5', 'T-FS6'], 'T-BIG')   // 5000 + 6000 into 13000
    const r = intoDamage(s, attackers, blocker)
    expect(r.state.pending, 'the blocker deals second: nothing is owed before the window').toBeNull()
    expect(r.state.attack?.step).toBe('firstStrike')
    expect(dmg(r.state, blocker)).toBe(11000)
    const w = passBoth(r.state)
    expect(w.state.pending, 'the window is over: the blocker now owes its split').toEqual({ kind: 'assignPartyDamage', player: 1 })
    const split = apply(w.state, { type: 'assignPartyDamage', player: 1, assignments: [{ target: attackers[0]!, amount: 5000 }, { target: attackers[1]!, amount: 8000 }] })
    expect(gone(split.state, attackers[0]!)).toBe(true); expect(gone(split.state, attackers[1]!)).toBe(true)
    expect(split.state.attack?.step).toBe('damage')
    expect(trace([...r.events, ...w.events, ...split.events], names)).toEqual([
      'step:declared', 'step:block', 'step:blocked', 'step:damage',
      'battle:a0>b:5000', 'battle:a1>b:6000', 'step:firstStrike',
      'step:damage', 'battle:b>a0:5000', 'battle:b>a1:8000', 'broken:a0', 'broken:a1',
    ])
    ok(split.state)
  })

  it('L1 §10.1.4.2.1 — a party with a First Strike BLOCKER: the blocker splits its damage before the window; the survivors deal after it', () => {
    const { s, attackers, blocker, names } = board(['V-F2', 'V-F2'], 'T-FS6')   // 5000 + 5000 into a 6000 First Strike blocker
    const r = intoDamage(s, attackers, blocker)
    expect(r.state.pending, 'the split is owed first: the blocker deals in the first batch').toEqual({ kind: 'assignPartyDamage', player: 1 })
    const split = apply(r.state, { type: 'assignPartyDamage', player: 1, assignments: [{ target: attackers[0]!, amount: 5000 }, { target: attackers[1]!, amount: 1000 }] })
    expect(split.state.attack?.step).toBe('firstStrike')
    expect(gone(split.state, attackers[0]!)).toBe(true)
    expect(dmg(split.state, attackers[1]!)).toBe(1000)
    const w = passBoth(split.state)
    expect(dmg(w.state, blocker), 'only the survivor dealt to it').toBe(5000)
    expect(trace([...r.events, ...split.events, ...w.events], names)).toEqual([
      'step:declared', 'step:block', 'step:blocked', 'step:damage',
      'battle:b>a0:5000', 'battle:b>a1:1000', 'broken:a0', 'step:firstStrike',
      'step:damage', 'battle:a1>b:5000',
    ])
    ok(w.state)
  })

  it('L1 §15.2.3.2 — the set is fixed at the beginning of the step: a mixed party\'s First Strike survivor still deals in the second batch', () => {
    // J3 Codex-stand-in review H1: recomputing the set over the SURVIVORS made a party that lost its plain member
    // "all First Strike", and its remaining member was filtered out of the second batch — the blocker took nothing.
    const { s, attackers, blocker, names } = board(['T-FS6', 'V-F2'], 'T-FS5')   // 6000 FS + 5000 into a 5000 FS blocker
    const r = intoDamage(s, attackers, blocker)
    expect(r.state.pending, 'the blocker has First Strike: its split is owed in the first batch').toEqual({ kind: 'assignPartyDamage', player: 1 })
    const split = apply(r.state, { type: 'assignPartyDamage', player: 1, assignments: [{ target: attackers[1]!, amount: 5000 }] })
    expect(split.state.attack?.step).toBe('firstStrike')
    expect(gone(split.state, attackers[1]!), 'the plain member broke in the first batch').toBe(true)
    expect(gone(split.state, blocker), 'FS6 was not in the first batch (a mixed party has no First Strike, §15.1.1.9.7)').toBe(false)
    const w = passBoth(split.state)
    expect(gone(w.state, blocker), 'FS6 deals its 6000 in the second batch: the 5000 blocker breaks').toBe(true)
    expect(trace([...r.events, ...split.events, ...w.events], names)).toEqual([
      'step:declared', 'step:block', 'step:blocked', 'step:damage',
      'battle:b>a1:5000', 'broken:a1', 'step:firstStrike',
      'step:damage', 'battle:a0>b:6000', 'broken:b',
    ])
    ok(w.state)
  })

  it('L1 §15.2.3.3 — the window bars Summons and abilities: a castable Summon and a live activation are refused; forcedPass reports it; isResponseWindow is true', () => {
    let { s, attackers, blocker } = board(['T-FS6'], 'V-F3')
    let princess: CardId
    ;[s, princess] = withField(s, 0, 'forwards', 'T-PUMP')
    ;[s] = withHand(s, 0, 'T-SUMMON')
    const r = intoDamage(s, attackers, blocker)
    expect(r.state.attack?.step).toBe('firstStrike')
    const menu = legalCommands(r.state, 0).map((c) => c.type)
    expect(menu.filter((t) => t !== 'concede'), 'pass and nothing else').toEqual(['pass'])
    expect(menu).not.toContain('castSummon'); expect(menu).not.toContain('activateAbility')
    expect(isResponseWindow(r.state)).toBe(true)
    expect(forcedPass(r.state)).toEqual({ type: 'pass', player: 0 })
    expect(actingPlayer(r.state)).toBe(0)
    // And in the next window, the same hand CAN act: the refusal was the step's, not the position's.
    const w = passBoth(r.state)
    expect(w.state.attack?.step).toBe('damage')
    expect(legalCommands(w.state, 0).some((c) => c.type === 'castSummon' || (c.type === 'activateAbility' && c.source === princess))).toBe(true)
  })

  it('L1 §15.2.3.3 — a trigger fired by First Strike damage is placed only when the damage window opens, with the second batch’s', () => {
    // A 6000 First Strike attacker that draws when it deals damage, into a 7000 blocker that draws when IT deals damage:
    // the blocker survives the first batch and kills the attacker in the second; BOTH triggers are placed only then.
    const { s, attackers, blocker, names } = board(['T-FS-WATCH'], 'T-WATCH')
    // Both draw clauses need a deck: the quiet fixture keeps the decks, only the hands are empty.
    const r = intoDamage(s, attackers, blocker)
    expect(r.state.attack?.step).toBe('firstStrike')
    expect(r.state.stack, 'nothing placed in the First Strike window').toEqual([])
    expect(r.state.resolution.queue.length + r.state.stack.length, 'held, not queued for placement').toBe(0)
    const w = passBoth(r.state)
    expect(w.state.attack?.step).toBe('damage')
    expect(w.state.stack.map((i) => (i.kind === 'ability' ? i.frame.abilityId : 'summon')), '§11.8.7: the turn player’s first, the non-turn player’s on top').toEqual(['T-FS-WATCH:draw', 'T-WATCH:draw'])
    const done = passBoth(passBoth(w.state).state)
    expect(trace([...r.events, ...w.events], names)).toEqual([
      'step:declared', 'step:block', 'step:blocked', 'step:damage',
      'battle:a0>b:6000', 'step:firstStrike',
      'step:damage', 'battle:b>a0:7000', 'broken:a0',
      'trigger:T-FS-WATCH:draw', 'push:T-FS-WATCH:draw', 'trigger:T-WATCH:draw', 'push:T-WATCH:draw',
    ])
    expect(done.state.stack).toEqual([])
    ok(done.state)
  })

  it('L1 §15.2.3.3 — a held trigger matches the side of a victim the first batch broke', () => {
    // J3 Codex second pass M1: by the time the held occurrence is placed its target is gone, so the side was
    // looked up in vain and every `whose` clause fired. The side is now recorded as the hit lands.
    for (const [code, fires] of [['T-FS-SELF', false], ['T-FS-OPP', true]] as const) {
      const { s, attackers, blocker } = board([code], 'V-F2')   // 6000 First Strike into 5000: it breaks in the first batch
      const r = intoDamage(s, attackers, blocker)
      expect(gone(r.state, blocker)).toBe(true)
      const w = passBoth(r.state)
      expect(w.state.stack.map((i) => (i.kind === 'ability' ? i.frame.abilityId : 'summon')), code).toEqual(fires ? [`${code}:draw`] : [])
      ok(w.state)
    }
  })

  it('L1 §15.2.3.3 §11.8.7 — a zone-change trigger fired by the first batch’s break IS placed in the First Strike window and resolves there; only casts and activations are barred', () => {
    // Player 0's 6000 First Strike attacker breaks the 5000 blocker in the first batch; player 0 also controls a
    // watcher of the opponent's Forwards leaving. The watcher is not a damage trigger, so it is not held.
    let { s, attackers, blocker, names } = board(['T-FS6'], 'V-F2')
    let obs: CardId
    ;[s, obs] = withField(s, 0, 'forwards', 'T-OBS'); names[obs] = 'obs'
    const r = intoDamage(s, attackers, blocker)
    expect(r.state.attack?.step).toBe('firstStrike')
    expect(r.state.stack.map((i) => (i.kind === 'ability' ? i.frame.abilityId : 'summon')), 'placed as priority was granted (§11.1.4)').toEqual(['T-OBS:draw'])
    expect(legalCommands(r.state, 0).map((c) => c.type).filter((t) => t !== 'concede')).toEqual(['pass'])
    const resolved = passBoth(r.state)
    expect(resolved.state.stack).toEqual([])
    expect(resolved.state.attack?.step, 'still the First Strike window: the double forfeit resolved the top (§11.1.7)').toBe('firstStrike')
    expect(trace(resolved.events, names)).toEqual(['drew:0:1'])
    const w = passBoth(resolved.state)
    expect(w.state.attack?.step).toBe('damage')
    ok(w.state)
  })

  it('unblocked: no firstStrike step, one point of damage as before', () => {
    const { s, attackers, names } = board(['T-FS6'], 'V-F3')
    const r = intoDamage(s, attackers, null)
    expect(r.state.attack?.step).toBe('damage')
    expect(r.state.players[1].damageZone).toHaveLength(1)
    expect(trace(r.events, names)).not.toContain('step:firstStrike')
    ok(r.state)
  })
})
