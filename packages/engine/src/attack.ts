import type { PlayerId } from './types.js'
import { opponentOf } from './types.js'
import type { Frame } from './abilities.js'
import type { AttackState, CardId, GameState } from './state.js'
import { defOf, findFieldCard, keywordsOf, powerOf, updatePlayer } from './state.js'
import type { Event } from './events.js'
import { IllegalCommandError } from './errors.js'
import { dealPlayerDamage, runRuleProcesses } from './rules.js'
import type { DamageOccurrence } from './resolve.js'
import { enqueueDamageTriggers } from './resolve.js'

const IDLE: AttackState = { step: 'declaration', attackers: [], blocker: null }
type Assignment = { target: CardId; amount: number }

/** Is `player` in a position to declare an attack at all? */
function declarationCheck(state: GameState, player: PlayerId): string | null {
  if (state.result) return 'game is over'
  if (state.phase !== 'attack' || state.attack?.step !== 'declaration' || state.pending) return 'not in the attack declaration step'
  if (state.turnPlayer !== player || state.priority !== player) return 'only the turn player may attack'
  return null
}

export function attackCheck(state: GameState, player: PlayerId, attackers: CardId[]): string | null {
  const why = declarationCheck(state, player)
  if (why) return why
  if (attackers.length === 0) return 'declare at least one forward'
  if (new Set(attackers).size !== attackers.length) return 'duplicate attacker'
  const ps = state.players[player]
  let common: Set<string> | null = null
  for (const id of attackers) {
    const fc = ps.forwards.find((c) => c.id === id)
    if (!fc) return `${id} is not a forward you control`
    if (fc.status !== 'active') return `${id} must be active (§10.1.2.1.1)`
    if (fc.attackedThisTurn) return `${id} already attacked this turn (§10.1.2.1.2)`
    if (fc.enteredTurn >= state.turn && !keywordsOf(state, fc).has('haste')) return `${id} entered this turn and lacks Haste — must be controlled since the beginning of the turn (§10.1.2.1.1)`
    const els = new Set<string>(defOf(state, id).elements)
    common = common ? new Set([...common].filter((e: string) => els.has(e))) : els
  }
  if (attackers.length > 1 && common && common.size === 0) return 'a party must share the same element (§10.1.2.1)'
  return null
}

export function legalAttackSets(state: GameState, player: PlayerId): CardId[][] {
  if (declarationCheck(state, player)) return []
  const ids = state.players[player].forwards.map((c) => c.id).filter((id) => attackCheck(state, player, [id]) === null)
  const out: CardId[][] = []
  for (let mask = 1; mask < 1 << ids.length; mask++) {
    const set = ids.filter((_, i) => mask & (1 << i))
    if (attackCheck(state, player, set) === null) out.push(set)
  }
  return out
}

export function applyDeclareAttack(state: GameState, player: PlayerId, attackers: CardId[]): [GameState, Event[]] {
  const why = attackCheck(state, player, attackers)
  if (why) throw new IllegalCommandError(why)
  const ordered = [...attackers].sort((a, b) => a - b)
  let s = updatePlayer(state, player, (ps) => ({
    ...ps,
    forwards: ps.forwards.map((c) => ordered.includes(c.id)
      ? { ...c, attackedThisTurn: true, status: keywordsOf(state, c).has('brave') ? c.status : 'dull' }   // §10.1.2.2, §15.2.1
      : c),
  }))
  // Rung J1-D10: the attack is declared; a WINDOW opens for the turn player (§10.1.2.6), and the block is
  // owed only once both players forfeit (`exitAttackWindow`).
  s = { ...s, attack: { step: 'declared', attackers: ordered, blocker: null }, pending: null, priority: player, passes: 0 }
  return [s, [{ type: 'attackDeclared', player, attackers: ordered }, { type: 'phaseStarted', phase: 'attack', step: 'declared' }]]
}

function blockCheck(state: GameState, player: PlayerId): string | null {
  if (state.result) return 'game is over'
  if (state.phase !== 'attack' || state.attack?.step !== 'block') return 'not in the block declaration step'
  if (state.pending?.kind !== 'declareBlock' || state.pending.player !== player) return 'you do not owe a block declaration'
  return null
}

export function legalBlockers(state: GameState, player: PlayerId): CardId[] {
  if (blockCheck(state, player)) return []
  return state.players[player].forwards.filter((c) => c.status === 'active').map((c) => c.id)   // §10.1.3.1.1
}

export function applyDeclareBlock(state: GameState, player: PlayerId, blocker: CardId | null): [GameState, Event[]] {
  const why = blockCheck(state, player)
  if (why) throw new IllegalCommandError(why)
  if (blocker !== null) {
    const fc = state.players[player].forwards.find((c) => c.id === blocker)
    if (!fc) throw new IllegalCommandError(`${blocker} is not a forward you control`)
    if (fc.status !== 'active') throw new IllegalCommandError('the blocking forward must be active (§10.1.3.1.1)')
  }
  // Rung J1-D10: the block is declared; a WINDOW opens, priority to the turn player (§10.1.3.6). Damage is
  // dealt only once both players forfeit (`exitAttackWindow` → `beginDamageResolution`).
  const attack: AttackState = { ...state.attack!, step: 'blocked', blocker }
  const s: GameState = { ...state, attack, pending: null, priority: state.turnPlayer, passes: 0 }
  return [s, [{ type: 'blockDeclared', player, blocker }, { type: 'phaseStarted', phase: 'attack', step: 'blocked' }]]
}

/**
 * The combatants as the field has them NOW (rung J1-D10): an attacker that left the field is no longer
 * attacking (§10.1.2.6 — a window may have broken it), and a blocker that left leaves the attack unblocked
 * (§10.1.3.3). Recomputed at every window exit, never inside one.
 */
function survivors(state: GameState): AttackState {
  const at = state.attack
  if (!at) throw new Error('no attack')
  const attackers = at.attackers.filter((id) => findFieldCard(state, id) !== null)
  const blocker = at.blocker !== null && findFieldCard(state, at.blocker) !== null ? at.blocker : null
  return { ...at, attackers, blocker }
}

/**
 * Both players forfeited in an Attack Phase window with nothing on the stack (§11.1.7): move to the next
 * state. `preparation` is handled by the caller (`applyPass` → `enterAttackDeclaration`).
 */
export function exitAttackWindow(state: GameState): [GameState, Event[]] {
  const at = state.attack
  if (!at) throw new Error('no attack')
  const turn = state.turnPlayer
  switch (at.step) {
    case 'declared': {
      const attack = survivors(state)
      if (attack.attackers.length === 0) return [finishDamageStep(state), [{ type: 'phaseStarted', phase: 'attack', step: 'declaration' }]]   // nothing left to block
      const step: AttackState = { ...attack, step: 'block' }
      return [{ ...state, attack: step, pending: { kind: 'declareBlock', player: opponentOf(turn) }, passes: 0 }, [{ type: 'phaseStarted', phase: 'attack', step: 'block' }]]   // §10.1.3.1
    }
    case 'blocked': {
      const attack = survivors(state)
      if (attack.attackers.length === 0) return [finishDamageStep(state), [{ type: 'phaseStarted', phase: 'attack', step: 'declaration' }]]
      return beginDamageResolution({ ...state, attack: { ...attack, step: 'damage' }, passes: 0 })
    }
    case 'damage':
      return [finishDamageStep(state), [{ type: 'phaseStarted', phase: 'attack', step: 'declaration' }]]   // §10.1.4.5–6
    default:
      throw new IllegalCommandError(`the ${at.step} step is not a window`)
  }
}

/** §10.1.4: the party split is owed (§10.1.4.2.1), or the damage is dealt at once. */
function beginDamageResolution(state: GameState): [GameState, Event[]] {
  const at = state.attack!
  const events: Event[] = [{ type: 'phaseStarted', phase: 'attack', step: 'damage' }]
  if (at.blocker !== null && at.attackers.length > 1) {
    return [{ ...state, pending: { kind: 'assignPartyDamage', player: opponentOf(state.turnPlayer) } }, events]
  }
  const [s, more] = resolveDamage({ ...state, pending: null }, [])
  return [s, [...events, ...more]]
}

/** All ways to split `total` over `targets` in multiples of 1000, each part ≥ 1000 (targets that receive nothing are omitted). */
function splits(total: number, targets: CardId[]): Assignment[][] {
  if (total <= 0) return [[]]
  const out: Assignment[][] = []
  const rec = (i: number, left: number, acc: Assignment[]) => {
    if (i === targets.length) { if (left === 0) out.push(acc); return }
    rec(i + 1, left, acc)
    for (let a = 1000; a <= left; a += 1000) rec(i + 1, left - a, [...acc, { target: targets[i] as CardId, amount: a }])
  }
  rec(0, total, [])
  return out
}

export function legalPartyDamageAssignments(state: GameState): Assignment[][] {
  const at = state.attack
  if (state.pending?.kind !== 'assignPartyDamage' || !at || at.blocker === null) return []
  const blocker = findFieldCard(state, at.blocker)
  if (!blocker) return [[]]   // blocker left the field (§10.1.3.3) — nothing to assign
  const result = splits(powerOf(state, blocker.card), at.attackers)
  // the blocker's power cannot be split into ≥1000 multiples across the party — it deals no battle damage
  return result.length === 0 ? [[]] : result
}

/** Why a party-damage split would be refused, or null (rung J7-D1): the exact test `applyAssignPartyDamage` runs. */
export function partyDamageCheck(state: GameState, player: PlayerId, assignments: readonly Assignment[]): string | null {
  if (state.result) return 'game is over'
  if (state.pending?.kind !== 'assignPartyDamage' || state.pending.player !== player) return 'you do not owe a party damage assignment'
  const at = state.attack
  if (!at) return 'no attack'
  const blocker = at.blocker === null ? null : findFieldCard(state, at.blocker)
  const total = blocker ? powerOf(state, blocker.card) : 0
  const noValidSplit = blocker !== null && splits(total, at.attackers).length === 0
  if (assignments.length === 0 && noValidSplit) return null
  const sum = assignments.reduce((n, a) => n + a.amount, 0)
  if (sum !== total) return `assignments must total the blocker's power ${total} (§10.1.4.2.1)`
  if (assignments.some((a) => a.amount < 1000 || a.amount % 1000 !== 0)) return 'each assignment must be a multiple of 1000 and at least 1000 (§10.1.4.2.1)'
  if (new Set(assignments.map((a) => a.target)).size !== assignments.length) return 'duplicate target'
  if (assignments.some((a) => !at.attackers.includes(a.target))) return 'targets must be attacking forwards'
  return null
}

export function applyAssignPartyDamage(state: GameState, player: PlayerId, assignments: Assignment[]): [GameState, Event[]] {
  const why = partyDamageCheck(state, player, assignments)
  if (why) throw new IllegalCommandError(why)
  return resolveDamage({ ...state, pending: null }, assignments)
}

/** §10.1.4. `blockerAssignments` is the blocker's damage split for a party; ignored for a single attacker (blocker's full power). */
function resolveDamage(state: GameState, blockerAssignments: Assignment[]): [GameState, Event[]] {
  const at = state.attack
  if (!at) throw new Error('no attack')
  const defender = opponentOf(state.turnPlayer)
  const events: Event[] = []
  let s = state
  // MVP0-SIMPLIFICATION: §15.2.3 First Strike not implemented — all battle damage is simultaneous
  if (at.blocker === null) {
    // §10.1.4.1 — an unblocked party deals ONE point of damage, but every member of it is dealing that damage, so
    // every member's `dealtDamage` clause triggers (spec C2-8). Controllers are captured here, from the field, for
    // the same reason the blocked branch does it: attribution must not depend on `at.attackers`'s id sort (:54).
    const party: DamageOccurrence[] = []
    for (const a of at.attackers) {
      const fc = findFieldCard(s, a)
      if (fc) party.push({ source: a, sourceController: fc.owner, target: null, victim: defender, amount: 1 })
    }
    const [t, e] = dealPlayerDamage(s, defender, party)
    s = t; events.push(...e)
  } else {
    const blockerFc = findFieldCard(s, at.blocker)
    if (blockerFc) {
      // `findFieldCard().owner` is the field array the card sits in, i.e. its CONTROLLER — attackers are the turn
      // player's, the blocker is the defender's. Captured per hit so a source broken by this same simultaneous
      // batch still attributes correctly (spec C2-7/C2-8).
      const hits: { source: CardId; sourceController: PlayerId; target: CardId; amount: number }[] = []
      for (const a of at.attackers) {
        const fc = findFieldCard(s, a)
        if (fc) hits.push({ source: a, sourceController: fc.owner, target: at.blocker, amount: powerOf(s, fc.card) })   // §10.1.4.2 each attacker deals its power to the blocker
      }
      if (at.attackers.length === 1) hits.push({ source: at.blocker, sourceController: blockerFc.owner, target: at.attackers[0] as CardId, amount: powerOf(s, blockerFc.card) })
      else for (const x of blockerAssignments) hits.push({ source: at.blocker, sourceController: blockerFc.owner, target: x.target, amount: x.amount })
      const landed: DamageOccurrence[] = []
      for (const h of hits) {
        const loc = findFieldCard(s, h.target)
        if (!loc) continue
        s = updatePlayer(s, loc.owner, (ps) => ({ ...ps, forwards: ps.forwards.map((c) => (c.id === h.target ? { ...c, damage: c.damage + h.amount } : c)) }))
        events.push({ type: 'battleDamage', source: h.source, target: h.target, amount: h.amount })
        landed.push({ source: h.source, sourceController: h.sourceController, target: h.target, victim: null, amount: h.amount })
      }
      // §15.2.3 aside, battle damage is simultaneous: all of it lands, THEN every source's `dealtDamage` clause
      // queues. Draining is `settle`'s job, so the §12.4.5 process below still runs first (spec C2-6).
      s = enqueueDamageTriggers(s, landed)
    }
  }
  const [ruled, ruleEvents] = runRuleProcesses(s)
  s = ruled; events.push(...ruleEvents)
  // An unanswered EX Burst offer (rung G3) holds the damage step open. Without this the line below would
  // clear it before the player ever saw it — `pending: null` is unconditional — and the whole rule would be
  // unreachable while every board-level test still passed. The plan review caught exactly this.
  //
  // A game that ENDED still finishes the step: `dealPlayerDamage` never offers on lethal damage, so a result
  // here means no offer is outstanding, and leaving combat mid-step after game over is what `checkInvariants`
  // forbids.
  if (!s.result && s.pending?.kind === 'chooseExBurst') return [s, events]
  // Rung J1-D10: the damage is dealt; the §10.1.4.4 WINDOW opens with priority to the turn player, and the
  // combat ends when both forfeit (`exitAttackWindow`). A game that ended finishes the step outright.
  s = s.result ? finishDamageStep(s) : openDamageWindow(s)
  if (s.result) events.push({ type: 'gameOver', result: s.result })
  return [s, events]
}

/** The §10.1.4.4 window: damage dealt, priority to the turn player, nothing owed. */
function openDamageWindow(s: GameState): GameState {
  return { ...s, pending: null, priority: s.turnPlayer, passes: 0 }
}

/**
 * Rung G3 — the answer to a `chooseExBurst` offer (§11.10).
 *
 * On **use**, the marked clause runs as an ordinary frame, but at the FRONT of the queue. `dealPlayerDamage`
 * has already enqueued the attacker's `dealtDamage` clauses and the agenda is FIFO, so appending would resolve
 * the attacker's trigger first — an EX Burst resolves immediately and unrespondably, ahead of them. Unshifting
 * is also why no continuation is needed to carry deferred occurrences: the triggers stay queued exactly where
 * they were, the burst simply goes in front.
 *
 * The frame is built from the ability's ID and runs through `abilityOf`/`runFrame` like any other, so there is
 * no second copy of the clause anywhere. `origin: 'exBurst'` keeps `drainResolution` from narrating it as an
 * ordinary trigger.
 *
 * On **decline**, nothing is queued and the damage step simply finishes. Note the asymmetry with Noel's
 * `min: 0`: declining the burst is not "use it and pick nothing", and the two produce different events.
 */
export function applyChooseExBurst(state: GameState, player: PlayerId, use: boolean): [GameState, Event[]] {
  const pending = state.pending
  if (pending?.kind !== 'chooseExBurst') throw new IllegalCommandError('no EX Burst is being offered')
  if (pending.player !== player) throw new IllegalCommandError(`EX Burst belongs to player ${pending.player}`)
  const events: Event[] = [{
    type: use ? 'exBurstUsed' : 'exBurstDeclined',
    player, card: pending.card, abilityId: pending.abilityId,
  }]
  let s: GameState = { ...state, pending: null }
  if (use) {
    // Rung J1-D11: the burst runs NOW as the active frame — declare, then resolve — never on the stack and
    // never behind a window (§11.10.2). `settle` runs it (prompts included) and places whatever it triggers
    // BEFORE either player can act in the §10.1.4.4 window opened below: the attack is held in `damage`
    // until the frame is done, because a frame in flight is what `actingPlayer` answers first.
    const frame: Frame = {
      abilityId: pending.abilityId, source: pending.card, controller: player,
      path: [], chosen: [], modes: [], triggerEvent: null, origin: 'exBurst', stage: 'declare', declared: [], modesDeclared: false,
    }
    s = { ...s, resolution: { ...s.resolution, active: frame } }
  }
  return [openDamageWindow(s), events]
}

/**
 * §10.1.4.5–6: combat is over, the defender owes nothing more, and priority returns to the turn player.
 *
 * Split out because there are now two ways to reach it — straight through `resolveDamage`, or later, once an
 * EX Burst offer has been answered. Two copies of this line would be two chances to forget one of the three
 * fields it resets.
 */
export function finishDamageStep(s: GameState): GameState {
  return { ...s, attack: IDLE, pending: null, priority: s.turnPlayer, passes: 0 }
}
