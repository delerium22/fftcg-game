import type { PlayerId } from './types.js'
import { opponentOf } from './types.js'
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
  s = { ...s, attack: { step: 'block', attackers: ordered, blocker: null }, pending: { kind: 'declareBlock', player: opponentOf(player) } }   // §10.1.3.1
  return [s, [{ type: 'attackDeclared', player, attackers: ordered }, { type: 'phaseStarted', phase: 'attack', step: 'block' }]]
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
  const events: Event[] = [{ type: 'blockDeclared', player, blocker }, { type: 'phaseStarted', phase: 'attack', step: 'damage' }]
  const attack: AttackState = { ...state.attack!, step: 'damage', blocker }
  if (blocker !== null && attack.attackers.length > 1) {
    // §10.1.4.2.1 — the blocking player must split the blocker's damage among the party
    return [{ ...state, attack, pending: { kind: 'assignPartyDamage', player } }, events]
  }
  // MVP0-SIMPLIFICATION: the Damage Resolution Step auto-advances (no priority window, §10.1.4.4)
  const [s, more] = resolveDamage({ ...state, attack, pending: null }, [])
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

export function applyAssignPartyDamage(state: GameState, player: PlayerId, assignments: Assignment[]): [GameState, Event[]] {
  if (state.result) throw new IllegalCommandError('game is over')
  if (state.pending?.kind !== 'assignPartyDamage' || state.pending.player !== player) throw new IllegalCommandError('you do not owe a party damage assignment')
  const at = state.attack!
  const blocker = at.blocker === null ? null : findFieldCard(state, at.blocker)
  const total = blocker ? powerOf(state, blocker.card) : 0
  const noValidSplit = blocker !== null && splits(total, at.attackers).length === 0
  if (assignments.length === 0 && noValidSplit) return resolveDamage({ ...state, pending: null }, assignments)
  const sum = assignments.reduce((n, a) => n + a.amount, 0)
  if (sum !== total) throw new IllegalCommandError(`assignments must total the blocker's power ${total} (§10.1.4.2.1)`)
  if (assignments.some((a) => a.amount < 1000 || a.amount % 1000 !== 0)) throw new IllegalCommandError('each assignment must be a multiple of 1000 and at least 1000 (§10.1.4.2.1)')
  if (new Set(assignments.map((a) => a.target)).size !== assignments.length) throw new IllegalCommandError('duplicate target')
  if (assignments.some((a) => !at.attackers.includes(a.target))) throw new IllegalCommandError('targets must be attacking forwards')
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
  s = { ...s, attack: IDLE, pending: null, priority: s.turnPlayer }   // §10.1.4.5–6
  if (s.result) events.push({ type: 'gameOver', result: s.result })
  return [s, events]
}
