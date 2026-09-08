import { describe, expect, it } from 'vitest'
import type { Ability, Effect } from '../src/abilities.js'
import type { CardDef } from '../src/types.js'
import type { CardId, GameState } from '../src/state.js'
import { findFieldCard } from '../src/state.js'
import { apply } from '../src/apply.js'
import { actingPlayer, forcedDecision, forcedPass, isResponseWindow, legalCommands } from '../src/legal.js'
import { checkInvariants } from '../src/invariants.js'
import { endPhase, makeDef, makeGame, VANILLA_POOL, withField, withHand, withHandSize } from './helpers.js'

/**
 * Rung J1, slice 5 — the Attack Phase as six states (spec J1-D10, CR §10.1): the four WINDOWS (preparation
 * §10.1.1.2, declared §10.1.2.6, blocked §10.1.3.6, damage §10.1.4.4) exist, the combatants are recomputed
 * at every window exit (§10.1.2.6 attackers that left, §10.1.3.3 a blocker that left), and an EX Burst
 * resolves in full before the damage window opens (J1-D11, §11.10.2). Driven through `apply` and real passes.
 */

const ok = (s: GameState) => expect(checkInvariants(s)).toEqual([])
const pass = (s: GameState, p: 0 | 1): GameState => apply(s, { type: 'pass', player: p }).state
const passBoth = (s: GameState): GameState => { const p = actingPlayer(s) as 0 | 1; return pass(pass(s, p), (1 - p) as 0 | 1) }
const NO_PAY = { dullBackups: [], discards: [] }
const fieldOf = (s: GameState, id: CardId) => findFieldCard(s, id)?.card

/** A Summon that breaks one chosen Forward, castable by either player at instant speed. */
const BREAK_ONE: Ability = {
  id: 'T-BREAK:break', trigger: { kind: 'summonResolve' }, text: 'Choose 1 Forward. Break it.',
  effects: [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'any' }, then: [{ kind: 'breakCard' }] }],
}
const PUMP: readonly Effect[] = [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'any' }, then: [{ kind: 'addPower', amount: 4000 }] }]
/** Undead Princess's pump shape: put herself into the Break Zone, a Forward gains +4000 (an action ability, §11.6). */
const PUMP_ABILITY: Ability = {
  id: 'T-PUMP:pump', trigger: { kind: 'activated', sourceZone: 'field', cost: { selfToBreakZone: true } },
  text: 'Put this into the Break Zone: Choose 1 Forward. It gains +4000 power until the end of the turn.', effects: PUMP,
}
const DEFS: CardDef[] = [
  ...VANILLA_POOL,
  makeDef({ code: 'T-BREAK', type: 'summon', cost: 0, power: null, hasAbilities: true, abilityClauses: 1, abilities: [BREAK_ONE] }),
  makeDef({ code: 'T-PUMP', type: 'forward', cost: 0, power: 1000, hasAbilities: true, abilityClauses: 1, abilities: [PUMP_ABILITY] }),
]

/** Turn 1, player 0 in the declaration step, with `attackers` of V-F2 (5000) on 0's field and a V-F3 (7000) on 1's. */
function board(n = 1): { s: GameState; attackers: CardId[]; blocker: CardId } {
  let s = endPhase(makeGame({ defs: DEFS }))
  const attackers: CardId[] = []
  for (let i = 0; i < n; i++) { let a: CardId; [s, a] = withField(s, 0, 'forwards', 'V-F2'); attackers.push(a) }
  let blocker: CardId
  ;[s, blocker] = withField(s, 1, 'forwards', 'V-F3')
  expect(s.attack?.step).toBe('declaration')
  return { s, attackers, blocker }
}
const declare = (s: GameState, attackers: CardId[]) => apply(s, { type: 'declareAttack', player: 0, attackers })
const block = (s: GameState, blocker: CardId | null) => apply(s, { type: 'declareBlock', player: 1, blocker })

describe('J1-A6 — the four windows exist, and each is a real priority window', () => {
  it('declaring an attack opens the `declared` window for the turn player; the block is owed only after both forfeit', () => {
    const { s, attackers } = board()
    const d = declare(s, attackers)
    expect(d.state.attack).toEqual({ step: 'declared', attackers, blocker: null })
    expect(d.state.pending, 'no block is owed yet (§10.1.2.6 comes first)').toBeNull()
    expect(d.state.priority, 'the turn player holds priority in its own window').toBe(0)
    expect(d.state.passes).toBe(0)
    expect(isResponseWindow(d.state)).toBe(true)
    expect(d.events).toContainEqual({ type: 'phaseStarted', phase: 'attack', step: 'declared' })
    ok(d.state)
    const one = pass(d.state, 0)
    expect(one.priority).toBe(1); expect(one.pending).toBeNull()
    const two = pass(one, 1)
    expect(two.attack?.step).toBe('block')
    expect(two.pending).toEqual({ kind: 'declareBlock', player: 1 })
    ok(two)
  })

  it('declaring a block opens the `blocked` window; damage is dealt only after both forfeit; then the `damage` window; then declaration', () => {
    const { s, attackers, blocker } = board()
    const atBlock = passBoth(declare(s, attackers).state)
    const b = block(atBlock, blocker)
    expect(b.state.attack).toEqual({ step: 'blocked', attackers, blocker })
    expect(b.state.pending).toBeNull()
    expect(b.state.priority, 'priority returns to the turn player (§10.1.3.6)').toBe(0)
    expect(b.events).toContainEqual({ type: 'phaseStarted', phase: 'attack', step: 'blocked' })
    expect(fieldOf(b.state, blocker)?.damage, 'no damage yet').toBe(0)
    ok(b.state)
    const dmg = passBoth(b.state)
    expect(fieldOf(dmg, blocker)?.damage, 'both forfeited: battle damage was dealt (§10.1.4.2)').toBe(5000)
    expect(findFieldCard(dmg, attackers[0]!), 'the 5000 attacker was broken by 7000').toBeNull()
    expect(dmg.attack?.step, 'the post-damage window (§10.1.4.4)').toBe('damage')
    expect(dmg.priority).toBe(0); expect(dmg.pending).toBeNull()
    expect(isResponseWindow(dmg)).toBe(true)
    ok(dmg)
    const done = passBoth(dmg)
    expect(done.attack).toEqual({ step: 'declaration', attackers: [], blocker: null })
    expect(done.phase).toBe('attack'); expect(done.priority).toBe(0)
    ok(done)
  })

  it('an unblocked attack still deals its one point only after the `blocked` window', () => {
    const { s, attackers } = board()
    const nb = block(passBoth(declare(s, attackers).state), null)
    expect(nb.state.attack?.step).toBe('blocked')
    expect(nb.state.players[1].damageZone).toHaveLength(0)
    const dmg = passBoth(nb.state)
    expect(dmg.players[1].damageZone).toHaveLength(1)
    expect(dmg.attack?.step).toBe('damage')
  })

  it('a pass-only window is what `forcedPass` reports, for whichever seat holds it', () => {
    let { s, attackers } = board()
    s = withHandSize(withHandSize(s, 0, 0), 1, 0)   // the vanilla pool holds Summons, castable in a window
    const d = declare(s, attackers).state
    expect(forcedPass(d)?.player).toBe(0)
    expect(forcedPass(pass(d, 0))?.player).toBe(1)
  })
})

describe('J1-A6 — combatants are recomputed at every window exit', () => {
  function withSummon(s: GameState, player: 0 | 1): [GameState, CardId] { return withHand(s, player, 'T-BREAK') }
  /** Cast T-BREAK at `target` by `player` in the current window, resolving it with both passes. */
  function breakWith(s: GameState, player: 0 | 1, card: CardId, target: CardId): GameState {
    const cast = apply(s, { type: 'castSummon', player, card, payment: NO_PAY }).state
    expect(cast.pending?.kind, 'the Summon declares its target at cast (§11.3.3)').toBe('chooseTargets')
    const declared = apply(cast, { type: 'chooseTargets', player, targets: [target] }).state
    expect(declared.stack.map((i) => i.kind)).toEqual(['summon'])
    return passBoth(declared)   // both forfeit: the Summon resolves; priority returns to the turn player
  }

  it('an attacker removed in the `declared` window is dropped; with none left the attack ends without a block', () => {
    let { s, attackers } = board(2)
    let card: CardId
    ;[s, card] = withSummon(s, 1)
    const d = pass(declare(s, attackers).state, 0)   // the turn player forfeits; the defender responds
    expect(d.priority).toBe(1)
    const cast = apply(d, { type: 'castSummon', player: 1, card, payment: NO_PAY }).state
    const declared = apply(cast, { type: 'chooseTargets', player: 1, targets: [attackers[0]!] }).state
    expect(declared.priority, 'the caster holds priority after casting (§11.3.8)').toBe(1)
    const resolved = passBoth(declared)
    expect(findFieldCard(resolved, attackers[0]!)).toBeNull()
    expect(resolved.attack?.step, 'still the declared window: resolving the stack does not end it').toBe('declared')
    expect(resolved.attack?.attackers, 'the combatants are recomputed at the window EXIT, not before').toEqual(attackers)
    const atBlock = passBoth(resolved)
    expect(atBlock.attack?.step).toBe('block')
    expect(atBlock.attack?.attackers, 'the broken attacker is dropped (§10.1.2.6)').toEqual([attackers[1]])
    ok(atBlock)
  })

  it('every attacker removed in the `declared` window: no block is owed, the attack is over', () => {
    let { s, attackers } = board(1)
    let card: CardId
    ;[s, card] = withSummon(s, 1)
    const d = pass(declare(s, attackers).state, 0)
    const gone = breakWith(d, 1, card, attackers[0]!)
    const after = passBoth(gone)
    expect(after.attack, 'nothing to block: back to declaration').toEqual({ step: 'declaration', attackers: [], blocker: null })
    expect(after.pending).toBeNull()
    expect(after.players[1].damageZone, 'no damage was dealt').toHaveLength(0)
    ok(after)
  })

  it('a blocker removed in the `blocked` window makes the attack unblocked (§10.1.3.3): one point of damage, no battle', () => {
    let { s, attackers, blocker } = board(1)
    let card: CardId
    ;[s, card] = withSummon(s, 0)
    const b = block(passBoth(declare(s, attackers).state), blocker).state
    expect(b.priority).toBe(0)
    const gone = breakWith(b, 0, card, blocker)
    expect(findFieldCard(gone, blocker)).toBeNull()
    expect(gone.attack?.step).toBe('blocked')
    const dmg = passBoth(gone)
    expect(dmg.attack?.step).toBe('damage')
    expect(dmg.players[1].damageZone, 'unblocked: the defender takes one point').toHaveLength(1)
    expect(fieldOf(dmg, attackers[0]!)?.damage, 'no battle damage was dealt to the attacker').toBe(0)
    ok(dmg)
  })

  it('a party reduced to one in the `blocked` window raises no split (§10.1.4.2.1)', () => {
    let { s, attackers, blocker } = board(2)
    let card: CardId
    ;[s, card] = withSummon(s, 0)
    const b = block(passBoth(declare(s, attackers).state), blocker).state
    const gone = breakWith(b, 0, card, attackers[0]!)
    const dmg = passBoth(gone)
    expect(dmg.pending, 'one attacker left: the blocker deals its power to it, no assignment').toBeNull()
    expect(dmg.attack?.step).toBe('damage')
    expect(dmg.attack?.attackers).toEqual([attackers[1]])
    expect(findFieldCard(dmg, attackers[1]!), '7000 broke the lone 5000 attacker').toBeNull()
    expect(fieldOf(dmg, blocker)?.damage).toBe(5000)
    ok(dmg)
  })

  it('a party still whole at the `blocked` exit raises the split as before', () => {
    const { s, attackers, blocker } = board(2)
    const b = block(passBoth(declare(s, attackers).state), blocker).state
    const split = passBoth(b)
    expect(split.attack?.step).toBe('damage')
    expect(split.pending).toEqual({ kind: 'assignPartyDamage', player: 1 })
    const dmg = apply(split, { type: 'assignPartyDamage', player: 1, assignments: [{ target: attackers[0]!, amount: 7000 }] }).state
    expect(findFieldCard(dmg, attackers[0]!), '7000 assigned to the first attacker broke it').toBeNull()
    expect(findFieldCard(dmg, blocker), 'the blocker took 5000 + 5000 and broke too (§12.4.5)').toBeNull()
    expect(dmg.attack?.step, 'then the post-damage window').toBe('damage')
    expect(dmg.pending).toBeNull()
    ok(dmg)
  })
})

describe('J1-A3 — an action ability in the `blocked` window, by either player, lands before damage (§11.6)', () => {
  it.each([0, 1] as const)('player %i pumps in the blocked window and the pump is priced in the battle', (who) => {
    let { s, attackers, blocker } = board(1)          // 5000 attacks into 7000
    let pumper: CardId
    ;[s, pumper] = withField(s, who, 'forwards', 'T-PUMP')
    let b = block(passBoth(declare(s, attackers).state), blocker).state
    if (who === 1) b = pass(b, 0)
    expect(actingPlayer(b)).toBe(who)
    const target = who === 0 ? attackers[0]! : blocker
    const act = legalCommands(b, who).find((c) => c.type === 'activateAbility' && c.source === pumper && c.targets[0] === target)
    expect(act, 'the pump is offered in the blocked window').toBeDefined()
    const used = apply(b, act!).state
    expect(used.stack.map((i) => i.kind), 'the activation is on the stack').toEqual(['ability'])
    expect(used.priority, 'the activator holds priority (§11.6.11)').toBe(who)
    const resolved = passBoth(used)
    expect(resolved.stack).toEqual([])
    expect(resolved.attack?.step, 'still the blocked window').toBe('blocked')
    const dmg = passBoth(resolved)
    expect(dmg.attack?.step).toBe('damage')
    if (who === 0) {
      // 9000 vs 7000: the blocker breaks and the attacker survives
      expect(findFieldCard(dmg, blocker)).toBeNull()
      expect(findFieldCard(dmg, attackers[0]!)).not.toBeNull()
    } else {
      // 5000 vs 11000: the attacker breaks, the blocker sits at 5000 damage
      expect(findFieldCard(dmg, attackers[0]!)).toBeNull()
      expect(fieldOf(dmg, blocker)?.damage).toBe(5000)
    }
    ok(dmg)
  })
})

describe('J1-A8 — EX Burst resolves in full before the damage window (§11.10.2, J1-D11)', () => {
  const EX_ABILITY: Ability = {
    id: 'V-EX:burst', trigger: { kind: 'enterField' }, exBurst: true, text: 'EX BURST Choose 1 Forward. Break it.',
    effects: [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'any' }, then: [{ kind: 'breakCard' }] }],
  }
  const EX_DEFS = [...DEFS, makeDef({ code: 'V-EX', exBurst: true, hasAbilities: true, abilityClauses: 1, abilities: [EX_ABILITY] })]

  /** Player 0 attacks with a V-F2 into an empty board; player 1's top card is the burst. */
  function burstAttack(): { s: GameState; attacker: CardId } {
    let s = endPhase(makeGame({ defs: EX_DEFS }))
    let attacker: CardId
    ;[s, attacker] = withField(s, 0, 'forwards', 'V-F2')
    const id = 999   // minted onto the top of player 1's deck, as cr12-rules does
    s = { ...s, cards: { ...s.cards, [id]: { id, code: 'V-EX', owner: 1 } }, players: [s.players[0], { ...s.players[1], deck: [id, ...s.players[1].deck] }] }
    const nb = block(passBoth(declare(s, [attacker]).state), null).state
    const offered = passBoth(nb)
    expect(offered.pending).toEqual(expect.objectContaining({ kind: 'chooseExBurst', player: 1 }))
    expect(offered.attack?.step).toBe('damage')
    return { s: offered, attacker }
  }

  it('used: the burst runs at once (prompts included) and the window opens only when it is done', () => {
    const { s, attacker } = burstAttack()
    const used = apply(s, { type: 'chooseExBurst', player: 1, use: true }).state
    expect(used.pending?.kind, 'the burst asks for its target immediately').toBe('chooseTargets')
    expect(used.stack, 'never on the stack').toEqual([])
    expect(used.attack?.step, 'the attack is held in the damage step').toBe('damage')
    const done = apply(used, { type: 'chooseTargets', player: 1, targets: [attacker] }).state
    expect(findFieldCard(done, attacker), 'the burst resolved unrespondably').toBeNull()
    expect(done.pending).toBeNull()
    expect(done.attack?.step, 'now the §10.1.4.4 window').toBe('damage')
    expect(done.priority).toBe(0); expect(done.passes).toBe(0)
    expect(isResponseWindow(done)).toBe(true)
    ok(done)
    expect(passBoth(done).attack?.step).toBe('declaration')
  })

  it('declined: the window opens at once', () => {
    const { s } = burstAttack()
    const declined = apply(s, { type: 'chooseExBurst', player: 1, use: false }).state
    expect(declined.pending).toBeNull()
    expect(declined.attack?.step).toBe('damage')
    expect(declined.priority).toBe(0)
    expect(isResponseWindow(declined)).toBe(true)
    ok(declined)
    expect(passBoth(declined).attack?.step).toBe('declaration')
  })
})

describe('K2-A1 — a decision with one answer is what `forcedDecision` reports', () => {
  it('the block declaration with every Forward of the defender dull, and the attack declaration with none able to attack', () => {
    const { s, attackers, blocker } = board()
    const dulled = { ...s, players: [s.players[0], { ...s.players[1], forwards: s.players[1].forwards.map((c) => (c.id === blocker ? { ...c, status: 'dull' as const } : c)) }] as GameState['players'] }
    const owed = passBoth(declare(dulled, attackers).state)
    expect(owed.pending).toEqual({ kind: 'declareBlock', player: 1 })
    expect(forcedDecision(owed), 'no active Forward: the only answer is no block').toEqual({ type: 'declareBlock', player: 1, blocker: null })
    const owedWithBlocker = passBoth(declare(s, attackers).state)
    expect(forcedDecision(owedWithBlocker), 'an active Forward: a real decision').toBeNull()
    // Declaration: the attackers already attacked this turn (dull), so nothing can be declared.
    const spent = { ...s, players: [{ ...s.players[0], forwards: s.players[0].forwards.map((c) => ({ ...c, status: 'dull' as const })) }, s.players[1]] as GameState['players'] }
    expect(spent.attack?.step).toBe('declaration')
    expect(forcedDecision(spent), 'no Forward can attack: the only answer is pass').toEqual({ type: 'pass', player: 0 })
    expect(forcedDecision(s), 'a ready Forward: a real decision').toBeNull()
    // A pass-only response window is still reported through the same door.
    expect(forcedDecision(declare(withHandSize(withHandSize(s, 0, 0), 1, 0), attackers).state)?.type).toBe('pass')
  })
})
