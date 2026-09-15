import { describe, expect, it } from 'vitest'
import type { Ability } from '../src/abilities.js'
import type { CardDef } from '../src/types.js'
import type { CardId, GameState } from '../src/state.js'
import { findFieldCard, powerOf } from '../src/state.js'
import type { Event } from '../src/events.js'
import { apply } from '../src/apply.js'
import { isResponseWindow, legalCommands } from '../src/legal.js'
import { checkInvariants } from '../src/invariants.js'
import { endPhase, makeDef, makeGame, passBoth, withField, withHand, withHandSize, VANILLA_POOL } from './helpers.js'

/**
 * Rung J9, Layer 2: two timing rules on top of each other, each asserted as the exact ORDER of what happened —
 * a trace of event kinds with the cards named — because the order is the whole claim. Synthetic cards; real
 * passes; no `applyNow`. The compositions the existing suite already proves are cited from the matrix instead:
 * J1-A4 (two triggers, one per player), J1-A5 (no Character while the stack is non-empty), C2-A5 (a rule
 * process between two frames).
 */

const ok = (s: GameState) => expect(checkInvariants(s)).toEqual([])
const quiet = (s: GameState): GameState => withHandSize(withHandSize(s, 0, 0), 1, 0)
const pass = (s: GameState, p: 0 | 1) => apply(s, { type: 'pass', player: p })

const DMG: Ability = {
  id: 'T-DMG:burn', trigger: { kind: 'summonResolve' }, text: 'Choose 1 Forward. Deal it 5000 damage.',
  effects: [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'any' }, then: [{ kind: 'damage', amount: 5000 }] }],
}
const BUFF: Ability = {
  id: 'T-BUFF:pump', trigger: { kind: 'summonResolve' }, text: 'Choose 1 Forward you control. It gains +4000 power until the end of the turn.',
  effects: [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'self' }, then: [{ kind: 'addPower', amount: 4000 }] }],
}
const PUMP: Ability = {
  id: 'T-PUMP:pump', trigger: { kind: 'activated', sourceZone: 'field', cost: { selfToBreakZone: true } },
  text: 'Put this into the Break Zone: Choose 1 Forward. It gains +4000 power until the end of the turn.',
  effects: [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'any' }, then: [{ kind: 'addPower', amount: 4000 }] }],
}
const WATCH: Ability = {
  id: 'T-WATCH:draw', trigger: { kind: 'observesZoneChange', from: 'field', to: 'breakZone', whose: 'opponent', of: 'forward' },
  text: 'When a Forward opponent controls is put from the field into the Break Zone, draw 1 card.',
  effects: [{ kind: 'draw', count: 1 }],
}
const EX: Ability = {
  id: 'T-EX:burst', trigger: { kind: 'enterField' }, exBurst: true, text: 'EX BURST Choose 1 Forward. Break it.',
  effects: [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'any' }, then: [{ kind: 'breakCard' }] }],
}
const DEFS: CardDef[] = [
  ...VANILLA_POOL,
  makeDef({ code: 'T-DMG', type: 'summon', cost: 0, power: null, hasAbilities: true, abilityClauses: 1, abilities: [DMG] }),
  makeDef({ code: 'T-BUFF', type: 'summon', cost: 0, power: null, hasAbilities: true, abilityClauses: 1, abilities: [BUFF] }),
  makeDef({ code: 'T-PUMP', cost: 0, power: 1000, hasAbilities: true, abilityClauses: 1, abilities: [PUMP] }),
  makeDef({ code: 'T-WATCH', cost: 0, power: 1000, hasAbilities: true, abilityClauses: 1, abilities: [WATCH] }),
  makeDef({ code: 'T-EX', cost: 0, power: 1000, exBurst: true, hasAbilities: true, abilityClauses: 1, abilities: [EX] }),
]

/** The order of what happened, as short strings: only the event kinds the compositions are about. */
function trace(events: readonly Event[], names: Record<number, string> = {}): string[] {
  const n = (id: number) => names[id] ?? String(id)
  const item = (i: { kind: 'summon'; card: CardId } | { kind: 'ability'; abilityId: string }) => (i.kind === 'summon' ? `summon:${n(i.card)}` : i.abilityId)
  const out: string[] = []
  for (const e of events) {
    switch (e.type) {
      case 'stackPushed': out.push(`push:${item(e.item)}`); break
      case 'stackResolved': out.push(`resolve:${item(e.item)}`); break
      case 'abilityTriggered': out.push(`trigger:${e.abilityId}`); break
      case 'powerModified': out.push(`power:${n(e.card)}:${e.amount > 0 ? '+' : ''}${e.amount}`); break
      case 'abilityDamage': out.push(`damage:${n(e.target)}`); break
      case 'broken': case 'brokenByAbility': out.push(`broken:${n(e.card)}`); break
      case 'drew': out.push(`drew:${e.player}`); break
      case 'exBurstOffered': out.push('burst:offered'); break
      case 'exBurstUsed': out.push('burst:used'); break
      case 'playerDamaged': out.push(`playerDamaged:${e.player}`); break
      case 'phaseStarted': if (e.step) out.push(`step:${e.step}`); break
      default: break
    }
  }
  return out
}

/** Cast a cost-0 Summon by `player` at its single target, through the real command pipeline (declares at cast, J1-D5). */
function castAt(s: GameState, player: 0 | 1, code: string, target: CardId): { state: GameState; events: Event[]; card: CardId } {
  let t = s; let card: CardId
  ;[t, card] = withHand(t, player, code)
  const cmd = legalCommands(t, player).find((c) => c.type === 'castSummon' && c.card === card)
  expect(cmd, `${code} is castable by player ${player} here`).toBeDefined()
  let r = apply(t, cmd!)
  if (r.state.pending?.kind === 'chooseTargets' && r.state.pending.player === player) {
    const chosen = apply(r.state, { type: 'chooseTargets', player, targets: [target] })
    r = { state: chosen.state, events: [...r.events, ...chosen.events] }
  }
  return { ...r, card }
}
const stackIds = (s: GameState, names: Record<number, string>) => s.stack.map((i) => (i.kind === 'summon' ? `summon:${names[i.card] ?? i.card}` : i.frame.abilityId))

describe('L2-a — a Summon answered by the non-turn player’s action ability resolves LAST (§11.1.7, §11.6.11, §11.11.1)', () => {
  it('L2-a — the pump on top resolves first, so the burn underneath finds a 9000 Forward and does not break it', () => {
    let s = quiet(makeGame({ defs: DEFS }))
    let victim: CardId, princess: CardId
    ;[s, victim] = withField(s, 1, 'forwards', 'V-F2')          // 5000
    ;[s, princess] = withField(s, 1, 'forwards', 'T-PUMP')
    const names: Record<number, string> = { [victim]: 'victim', [princess]: 'princess' }
    const cast = castAt(s, 0, 'T-DMG', victim)
    names[cast.card] = 'burn'
    const events = [...cast.events]
    let t = cast.state
    expect(t.priority, '§11.3.8: the caster regains priority').toBe(0)
    let r = pass(t, 0); t = r.state; events.push(...r.events)          // §11.1.6: player 1 may respond
    const act = legalCommands(t, 1).find((c) => c.type === 'activateAbility' && c.source === princess && c.targets[0] === victim)
    expect(act, 'the pump is offered in response').toBeDefined()
    r = apply(t, act!); t = r.state; events.push(...r.events)
    expect(stackIds(t, names), 'the pump sits above the burn').toEqual(['summon:burn', 'T-PUMP:pump'])
    expect(t.priority, '§11.6.11: the activator regains priority').toBe(1)
    r = pass(t, 1); t = r.state; events.push(...r.events)
    r = pass(t, 0); t = r.state; events.push(...r.events)              // both forfeit: the PUMP resolves
    expect(stackIds(t, names)).toEqual(['summon:burn'])
    expect(t.priority, '§11.1.5: the turn player').toBe(0)
    r = pass(t, 0); t = r.state; events.push(...r.events)
    r = pass(t, 1); t = r.state; events.push(...r.events)              // both forfeit: the BURN resolves
    expect(t.stack).toEqual([])
    expect(trace(events, names)).toEqual([
      'push:summon:burn', 'push:T-PUMP:pump',
      'power:victim:+4000', 'resolve:T-PUMP:pump',
      'damage:victim', 'resolve:summon:burn',
    ])
    expect(findFieldCard(t, victim), 'survives').not.toBeNull()
    expect(findFieldCard(t, victim)?.card.damage, '5000 damage on a 9000 Forward').toBe(5000)
    expect(t.players[1].breakZone, 'the pump’s cost put its source into the Break Zone').toContain(princess)
    ok(t)
  })
})

describe('L2-b — a trigger fired by a resolving item is placed ABOVE what is still on the stack (§11.1.4, §11.8.7, §12.3)', () => {
  it('L2-b — the top burn breaks a Forward the other player’s watcher sees; the watcher resolves before the burn underneath', () => {
    let s = quiet(makeGame({ defs: DEFS }))
    let v0: CardId, v1: CardId, watcher: CardId
    ;[s, v0] = withField(s, 0, 'forwards', 'V-F1')               // 3000, player 0's
    ;[s, v1] = withField(s, 1, 'forwards', 'V-F2')               // 5000, player 1's
    ;[s, watcher] = withField(s, 1, 'forwards', 'T-WATCH')       // watches player 0's Forwards leave
    const names: Record<number, string> = { [v0]: 'v0', [v1]: 'v1', [watcher]: 'watcher' }
    const a = castAt(s, 0, 'T-DMG', v1); names[a.card] = 'burnA'   // bottom: player 0 burns v1
    let t = a.state; const events = [...a.events]
    let r = pass(t, 0); t = r.state; events.push(...r.events)
    const b = castAt(t, 1, 'T-DMG', v0); names[b.card] = 'burnB'  // top: player 1 burns v0
    t = b.state; events.push(...b.events)
    r = pass(t, 1); t = r.state; events.push(...r.events)
    r = pass(t, 0); t = r.state; events.push(...r.events)        // burnB resolves: v0 takes 5000 ≥ 3000 → §12.4.5 breaks it → the watcher triggers
    expect(stackIds(t, names), 'the watcher is placed above burnA').toEqual(['summon:burnA', 'T-WATCH:draw'])
    expect(t.priority, '§11.1.5').toBe(0)
    r = pass(t, 0); t = r.state; events.push(...r.events)
    r = pass(t, 1); t = r.state; events.push(...r.events)        // the watcher resolves: player 1 draws
    r = pass(t, 0); t = r.state; events.push(...r.events)
    r = pass(t, 1); t = r.state; events.push(...r.events)        // burnA resolves: v1 takes 5000 ≥ 5000 → breaks
    expect(trace(events, names)).toEqual([
      'push:summon:burnA', 'push:summon:burnB',
      'damage:v0', 'resolve:summon:burnB', 'broken:v0', 'trigger:T-WATCH:draw', 'push:T-WATCH:draw',
      'drew:1', 'resolve:T-WATCH:draw',
      'damage:v1', 'resolve:summon:burnA', 'broken:v1',
    ])
    ok(t)
  })
})

describe('L2-d — an EX Burst inside combat, and the trigger it causes (§11.10.2, §10.1.4.4, §11.1.4)', () => {
  it('L2-d — the burst breaks the attacker unrespondably; the watcher it triggers is on the stack when the damage window opens', () => {
    let s = quiet(endPhase(makeGame({ defs: DEFS })))
    let attacker: CardId, watcher: CardId
    ;[s, attacker] = withField(s, 0, 'forwards', 'V-F2')
    ;[s, watcher] = withField(s, 1, 'forwards', 'T-WATCH')       // watches player 0's Forwards leave
    const burst = 999
    s = { ...s, cards: { ...s.cards, [burst]: { id: burst, code: 'T-EX', owner: 1 } }, players: [s.players[0], { ...s.players[1], deck: [burst, ...s.players[1].deck] }] }
    const names: Record<number, string> = { [attacker]: 'attacker', [watcher]: 'watcher' }
    let r = apply(s, { type: 'declareAttack', player: 0, attackers: [attacker] })
    let t = r.state; const events = [...r.events]
    r = passBoth(t); t = r.state; events.push(...r.events)
    r = apply(t, { type: 'declareBlock', player: 1, blocker: null }); t = r.state; events.push(...r.events)
    r = passBoth(t); t = r.state; events.push(...r.events)       // one point of damage: the burst is offered
    expect(t.pending).toEqual(expect.objectContaining({ kind: 'chooseExBurst', player: 1 }))
    r = apply(t, { type: 'chooseExBurst', player: 1, use: true }); t = r.state; events.push(...r.events)
    expect(t.pending?.kind).toBe('chooseTargets')
    r = apply(t, { type: 'chooseTargets', player: 1, targets: [attacker] }); t = r.state; events.push(...r.events)
    expect(findFieldCard(t, attacker), 'broken by the burst, with no window to answer it').toBeNull()
    expect(t.attack?.step, 'the §10.1.4.4 window').toBe('damage')
    expect(stackIds(t, names), '§11.1.4: the watcher was placed as priority was granted').toEqual(['T-WATCH:draw'])
    expect(t.priority).toBe(0)
    expect(isResponseWindow(t)).toBe(true)
    r = passBoth(t); t = r.state; events.push(...r.events)       // the watcher resolves in the window
    expect(trace(events, names)).toEqual([
      'step:declared', 'step:block', 'step:blocked', 'step:damage',
      'playerDamaged:1', 'burst:offered', 'burst:used', 'broken:attacker',
      'trigger:T-WATCH:draw', 'push:T-WATCH:draw',
      'drew:1', 'resolve:T-WATCH:draw',
    ])
    ok(t)
  })
})

describe('L2-e — an until-end-of-turn effect from a resolved Summon stops at the End Phase (§9.5.1.3.2, §11.11.10)', () => {
  it('L2-e §9.5.1.3.2 — +4000 from a Summon lasts through the turn and is gone in the next', () => {
    let s = quiet(makeGame({ defs: DEFS }))
    let mine: CardId
    ;[s, mine] = withField(s, 0, 'forwards', 'V-F2')
    const cast = castAt(s, 0, 'T-BUFF', mine)
    let t = passBoth(cast.state).state                            // resolves
    expect(t.stack).toEqual([])
    expect(t.players[0].breakZone, '§11.11.10').toContain(cast.card)
    expect(powerOf(t, findFieldCard(t, mine)!.card)).toBe(9000)
    t = endPhase(endPhase(t))                                     // → main2
    expect(powerOf(t, findFieldCard(t, mine)!.card), 'still on in Main Phase 2').toBe(9000)
    t = passBoth(t).state                                         // End Phase → turn 2
    expect(t.turn).toBe(2)
    expect(powerOf(t, findFieldCard(t, mine)!.card), 'gone with the turn').toBe(5000)
    ok(t)
  })
})
