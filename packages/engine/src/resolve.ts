import type { Ability, Effect, Frame, TargetFilter, TargetSpec, TriggerEvent } from './abilities.js'
import { MAX_RESOLUTION_STEPS } from './abilities.js'
import type { CardId, FieldCard, GameState, Pending } from './state.js'
import { findFieldCard, updatePlayer } from './state.js'
import type { PlayerId } from './types.js'
import { opponentOf } from './types.js'
import type { Event } from './events.js'
import { IllegalCommandError } from './errors.js'

/**
 * The ability executor (spec C1-3). No card-specific code lives here: this is an interpreter for the `Effect`
 * AST in abilities.ts, and `packages/cards` writes the ASTs.
 *
 * LAYERING — this module imports nothing from `rules.ts`, `phases.ts` or `apply.ts`, because `rules.ts` imports
 * `enqueueTrigger` from here (spec C1-8 wants zone transitions to enqueue their own triggers at the moment of
 * removal). Interleaving resolution with rule processes is therefore the outer reducer's job: `settle` in
 * `apply.ts` alternates `runRuleProcesses` and `drainResolution` until both are quiet.
 *
 * MVP0-SIMPLIFICATION (spec C1-4): there is no stack and no response window. A triggered clause resolves
 * immediately, in trigger order, and the opponent cannot answer it. Rule processes do not run *between* two
 * frames of one drain either; C1 can never enqueue two frames at once, so nothing observes it yet.
 */

// ---------------------------------------------------------------------------
// Queueing
// ---------------------------------------------------------------------------

/** Push a triggered clause onto the agenda. The frame starts at path `[]` — the top of `ability.effects`. */
export function enqueueTrigger(state: GameState, source: CardId, controller: PlayerId, ability: Ability, triggerEvent: TriggerEvent | null = null): GameState {
  const frame: Frame = { abilityId: ability.id, source, controller, path: [], chosen: [], modes: [], triggerEvent }
  return { ...state, resolution: { ...state.resolution, queue: [...state.resolution.queue, frame] } }
}

/** The clause a frame is executing, or null if the def no longer declares it (a hot-swapped card pool). */
export function abilityOf(state: GameState, frame: Frame): Ability | null {
  const code = state.cards[frame.source]?.code
  const def = code === undefined ? undefined : state.defs[code]
  return def?.abilities?.find((a) => a.id === frame.abilityId) ?? null
}

// ---------------------------------------------------------------------------
// Targeting
// ---------------------------------------------------------------------------

function defFor(state: GameState, id: CardId) {
  const code = state.cards[id]?.code
  return code === undefined ? undefined : state.defs[code]
}

function matchesFilter(state: GameState, source: CardId, id: CardId, filter: TargetFilter | undefined): boolean {
  if (!filter) return true
  const def = defFor(state, id)
  if (!def) return false
  if (filter.type !== undefined && def.type !== filter.type) return false
  if (filter.element !== undefined && !def.elements.includes(filter.element)) return false
  if (filter.maxCost !== undefined && def.cost > filter.maxCost) return false
  if (filter.excludeSource && id === source) return false
  if (filter.excludeSourceName) {
    const src = defFor(state, source)
    if (src && src.name === def.name) return false
  }
  return true
}

/**
 * The legal targets of one `TargetSpec`, in a fixed player-0-then-1 order so a live state and its
 * determinisation enumerate the same candidates in the same order (spec C1-A6).
 */
export function targetCandidates(state: GameState, source: CardId, controller: PlayerId, spec: TargetSpec): CardId[] {
  const owners: readonly PlayerId[] = spec.controller === 'any' ? [0, 1]
    : spec.controller === 'self' ? [controller] : [opponentOf(controller)]
  const out: CardId[] = []
  for (const p of ([0, 1] as const).filter((q) => owners.includes(q))) {
    const ps = state.players[p]
    const ids = spec.zone === 'breakZone' ? ps.breakZone
      : (spec.zone === 'forwards' ? ps.forwards : ps.backups).map((c) => c.id)
    for (const id of ids) if (matchesFilter(state, source, id, spec.filter)) out.push(id)
  }
  return out
}

// ---------------------------------------------------------------------------
// Zone plumbing
// ---------------------------------------------------------------------------

function setFieldCard(state: GameState, id: CardId, f: (c: FieldCard) => FieldCard): GameState {
  const loc = findFieldCard(state, id)
  if (!loc) return state
  return updatePlayer(state, loc.owner, (ps) => (loc.zone === 'forwards'
    ? { ...ps, forwards: ps.forwards.map((c) => (c.id === id ? f(c) : c)) }
    : { ...ps, backups: ps.backups.map((c) => (c.id === id ? f(c) : c))}))
}

function removeFromField(state: GameState, id: CardId): GameState {
  const loc = findFieldCard(state, id)
  if (!loc) return state
  return updatePlayer(state, loc.owner, (ps) => (loc.zone === 'forwards'
    ? { ...ps, forwards: ps.forwards.filter((c) => c.id !== id) }
    : { ...ps, backups: ps.backups.filter((c) => c.id !== id) }))
}

/** §7.10: a card always goes to its OWNER's zone, not its controller's. Returns null if the card is nowhere movable. */
function toHand(state: GameState, id: CardId): GameState | null {
  const owner = state.cards[id]?.owner
  if (owner === undefined) return null
  let s = state
  if (findFieldCard(state, id)) s = removeFromField(s, id)
  else {
    const holder = ([0, 1] as const).find((p) => state.players[p].breakZone.includes(id))
    if (holder === undefined) return null
    s = updatePlayer(s, holder, (ps) => ({ ...ps, breakZone: ps.breakZone.filter((x) => x !== id) }))
  }
  return updatePlayer(s, owner, (ps) => ({ ...ps, hand: [...ps.hand, id] }))
}

// ---------------------------------------------------------------------------
// The walker
// ---------------------------------------------------------------------------

interface Ctx {
  state: GameState
  events: Event[]
  source: CardId
  controller: PlayerId
  abilityId: string
  /** Program counter, one index per nesting level. `chooseModes` owns TWO levels: mode ordinal, then effect index. */
  path: number[]
  chosen: CardId[]
  modes: number[]
  /** What fired this clause, for `onSubject` and narration; null for self-triggers (spec C2-5). */
  triggerEvent: TriggerEvent | null
  /** The path the frame was suspended at; execution rejoins it instead of replaying the effects already run. */
  resume: readonly number[]
  suspend: Pending | null
  steps: number
}

/**
 * Spec C1-5: every effect step is counted, the count lives on `GameState` and therefore PERSISTS across player
 * choices. A call-depth cap would not see a trigger cycle that launders itself through a `chooseTargets` prompt.
 */
function step(ctx: Ctx): void {
  ctx.steps++
  if (ctx.steps > MAX_RESOLUTION_STEPS) {
    throw new Error(`ability ${ctx.abilityId} on card ${ctx.source} exceeded ${MAX_RESOLUTION_STEPS} resolution steps (spec C1-5) — trigger cycle?`)
  }
}

function noLegalTarget(ctx: Ctx): void {
  // Spec C1-7: an ability that cannot legally resolve is a NO-OP that logs, never an error.
  ctx.events.push({ type: 'abilityNoLegalTarget', card: ctx.source, abilityId: ctx.abilityId })
}

function runEffects(ctx: Ctx, effects: readonly Effect[], depth: number, onSpine: boolean): void {
  const start = onSpine ? (ctx.resume[depth] ?? 0) : 0
  for (let i = start; i < effects.length; i++) {
    const eff = effects[i]
    if (!eff) continue
    ctx.path = [...ctx.path.slice(0, depth), i]
    // Still on the resume spine AND a deeper index was recorded ⇒ this node's choice is already answered:
    // descend into its children rather than raising the same prompt again.
    const answered = onSpine && i === start && depth + 1 < ctx.resume.length
    runEffect(ctx, eff, depth, answered)
    if (ctx.suspend) return
  }
}

function runEffect(ctx: Ctx, eff: Effect, depth: number, answered: boolean): void {
  step(ctx)
  switch (eff.kind) {
    case 'chooseTargets': {
      if (answered) { runEffects(ctx, eff.then, depth + 1, true); return }
      const candidates = targetCandidates(ctx.state, ctx.source, ctx.controller, eff.from)
      if (candidates.length === 0 || eff.min > candidates.length) { noLegalTarget(ctx); return }
      ctx.suspend = { kind: 'chooseTargets', player: ctx.controller, min: eff.min, max: Math.min(eff.max, candidates.length), candidates }
      return
    }
    case 'chooseModes': {
      if (answered) {
        const from = ctx.resume[depth + 1] ?? 0
        for (let k = from; k < ctx.modes.length; k++) {
          ctx.path = [...ctx.path.slice(0, depth + 1), k]
          const mode = eff.modes[ctx.modes[k] ?? -1]
          if (mode) runEffects(ctx, mode.effects, depth + 2, k === from)
          if (ctx.suspend) return
        }
        return
      }
      if (eff.modes.length === 0 || eff.min > eff.modes.length) { noLegalTarget(ctx); return }
      ctx.suspend = { kind: 'chooseMode', player: ctx.controller, min: eff.min, max: Math.min(eff.max, eff.modes.length), labels: eff.modes.map((m) => m.label) }
      return
    }
    case 'forEach': {
      // Untargeted, so it raises no prompt — and it must not contain one either: `Frame.chosen` is a single
      // innermost binding, so a suspension inside `do` could not restore the per-iteration card on resume.
      const saved = ctx.chosen
      for (const id of targetCandidates(ctx.state, ctx.source, ctx.controller, eff.from)) {
        ctx.chosen = [id]
        runEffects(ctx, eff.do, depth + 1, false)
        if (ctx.suspend) throw new Error(`ability ${ctx.abilityId}: forEach.do must not contain a suspending effect`)
      }
      ctx.chosen = saved
      return
    }
    case 'onSubject': {
      // The card the trigger was ABOUT — Luso's "break it" (spec C2-5). Same fixed-binding shape as
      // `forEach`, so `do` may not suspend: `Frame.chosen` holds one innermost binding and a prompt inside
      // `do` could not restore the subject on resume. A trigger with no card subject is a no-op.
      const ev = ctx.triggerEvent
      const subject = ev === null ? null : ev.kind === 'damage' ? ev.target : ev.card
      if (subject === null) return
      const saved = ctx.chosen
      ctx.chosen = [subject]
      runEffects(ctx, eff.do, depth + 1, false)
      if (ctx.suspend) throw new Error(`ability ${ctx.abilityId}: onSubject.do must not contain a suspending effect`)
      ctx.chosen = saved
      return
    }
    case 'dull':
      for (const id of ctx.chosen) {
        const loc = findFieldCard(ctx.state, id)
        if (!loc || loc.card.status === 'dull') continue
        ctx.state = setFieldCard(ctx.state, id, (c) => ({ ...c, status: 'dull' }))
        ctx.events.push({ type: 'dulled', card: id })
      }
      return
    case 'damage':
      for (const id of ctx.chosen) {
        const loc = findFieldCard(ctx.state, id)
        if (!loc || loc.zone !== 'forwards') continue   // only Forwards carry damage
        ctx.state = setFieldCard(ctx.state, id, (c) => ({ ...c, damage: c.damage + eff.amount }))
        ctx.events.push({ type: 'abilityDamage', source: ctx.source, target: id, amount: eff.amount })
      }
      // §12.4.5 turns this into a break; `settle` runs the rule processes, which honour `cannotBeBroken`.
      return
    case 'breakCard':
      for (const id of ctx.chosen) {
        const loc = findFieldCard(ctx.state, id)
        if (!loc) continue
        if (loc.card.flags.includes('cannotBeBroken')) { ctx.events.push({ type: 'breakPrevented', card: id, flag: 'cannotBeBroken' }); continue }
        const owner = loc.owner
        ctx.state = updatePlayer(removeFromField(ctx.state, id), owner, (ps) => ({ ...ps, breakZone: [...ps.breakZone, id] }))
        ctx.events.push({ type: 'brokenByAbility', card: id, source: ctx.source })
      }
      return
    case 'addPower':
      for (const id of ctx.chosen) {
        if (!findFieldCard(ctx.state, id)) continue
        ctx.state = setFieldCard(ctx.state, id, (c) => ({ ...c, powerBonus: c.powerBonus + eff.amount }))
        ctx.events.push({ type: 'powerModified', card: id, amount: eff.amount })
      }
      return
    case 'grantKeyword':
      for (const id of ctx.chosen) {
        const loc = findFieldCard(ctx.state, id)
        if (!loc || loc.card.granted.includes(eff.keyword)) continue
        ctx.state = setFieldCard(ctx.state, id, (c) => ({ ...c, granted: [...c.granted, eff.keyword] }))
        ctx.events.push({ type: 'keywordGranted', card: id, keyword: eff.keyword })
      }
      return
    case 'grantFlag':
      for (const id of ctx.chosen) {
        const loc = findFieldCard(ctx.state, id)
        if (!loc || loc.card.flags.includes(eff.flag)) continue
        ctx.state = setFieldCard(ctx.state, id, (c) => ({ ...c, flags: [...c.flags, eff.flag] }))
        ctx.events.push({ type: 'flagGranted', card: id, flag: eff.flag })
      }
      return
    case 'moveToHand':
      for (const id of ctx.chosen) {
        const moved = toHand(ctx.state, id)
        if (!moved) continue
        ctx.state = moved
        ctx.events.push({ type: 'returnedToHand', player: ctx.state.cards[id]?.owner ?? ctx.controller, card: id })
      }
      return
    default: { const _exhaustive: never = eff; return _exhaustive }
  }
}

interface FrameResult { state: GameState; events: Event[]; pending: Pending | null; frame: Frame; steps: number }

function runFrame(state: GameState, frame: Frame): FrameResult {
  const ability = abilityOf(state, frame)
  const base: FrameResult = { state, events: [], pending: null, frame, steps: state.resolution.steps }
  if (!ability) return base   // the clause vanished with its def; drop the frame rather than throw
  const ctx: Ctx = {
    state, events: [], source: frame.source, controller: frame.controller, abilityId: frame.abilityId,
    path: [...frame.path], chosen: [...frame.chosen], modes: [...frame.modes],
    triggerEvent: frame.triggerEvent,
    resume: frame.path, suspend: null, steps: state.resolution.steps,
  }
  runEffects(ctx, ability.effects, 0, frame.path.length > 0)
  return {
    state: ctx.state, events: ctx.events, pending: ctx.suspend, steps: ctx.steps,
    frame: { ...frame, path: ctx.path, chosen: ctx.chosen, modes: ctx.modes },
  }
}

// ---------------------------------------------------------------------------
// Draining
// ---------------------------------------------------------------------------

/** §10.1.1 Attack Preparation Step, then §10.1.2 Declaration. Shared by `pass` and by the agenda continuation. */
export function enterAttackDeclaration(state: GameState, player: PlayerId): [GameState, Event[]] {
  const s: GameState = { ...state, phase: 'attack', attack: { step: 'declaration', attackers: [], blocker: null }, priority: player }
  return [s, [{ type: 'phaseStarted', phase: 'attack', step: 'preparation' }, { type: 'phaseStarted', phase: 'attack', step: 'declaration' }]]
}

/**
 * Run agenda frames until a player must choose (the choice becomes `state.pending`, the frame stays `active`) or
 * the queue empties (then the system continuation, if any, runs). Never touches an existing `pending` — the
 * decision already on the table always comes first.
 *
 * `resolution.steps` is NOT reset here: `settle` in apply.ts resets it once the whole settlement is quiet, so a
 * rule-process ⇄ trigger cycle keeps accumulating and hits the cap instead of restarting the count every pass.
 */
export function drainResolution(state: GameState): [GameState, Event[]] {
  const events: Event[] = []
  let s = state
  for (;;) {
    if (s.result || s.pending) return [s, events]
    let frame = s.resolution.active
    if (!frame) {
      const [next, ...rest] = s.resolution.queue
      if (!next) break
      frame = next
      const steps = s.resolution.steps + 1   // starting a frame is a step too, so a cycle of empty clauses is still capped
      if (steps > MAX_RESOLUTION_STEPS) throw new Error(`resolution exceeded ${MAX_RESOLUTION_STEPS} steps (spec C1-5) — trigger cycle?`)
      s = { ...s, resolution: { ...s.resolution, active: frame, queue: rest, steps } }
      events.push({ type: 'abilityTriggered', player: frame.controller, card: frame.source, abilityId: frame.abilityId })
    }
    const r = runFrame(s, frame)
    s = r.state
    events.push(...r.events)
    s = r.pending
      ? { ...s, pending: r.pending, resolution: { ...s.resolution, active: r.frame, steps: r.steps } }
      : { ...s, resolution: { ...s.resolution, active: null, steps: r.steps } }
    if (r.pending) return [s, events]
  }
  const continuation = s.resolution.continuation
  if (continuation === 'enterAttackDeclaration') {
    s = { ...s, resolution: { ...s.resolution, continuation: null } }
    const [t, e] = enterAttackDeclaration(s, s.turnPlayer)
    s = t; events.push(...e)
  }
  return [s, events]
}

// ---------------------------------------------------------------------------
// Answering a suspended choice
// ---------------------------------------------------------------------------

/**
 * The effect node a frame is suspended at, found by walking `path` through the AST. `apply` re-derives its
 * candidates from HERE rather than trusting `state.pending`, which is only a projection of it (spec C1-6).
 */
function effectAt(effects: readonly Effect[], path: readonly number[], modes: readonly number[], depth: number): Effect | null {
  const i = path[depth]
  if (i === undefined) return null
  const eff = effects[i]
  if (!eff) return null
  if (depth === path.length - 1) return eff
  if (eff.kind === 'chooseTargets') return effectAt(eff.then, path, modes, depth + 1)
  if (eff.kind === 'chooseModes') {
    const k = path[depth + 1]
    if (k === undefined) return null
    const mode = eff.modes[modes[k] ?? -1]
    return mode ? effectAt(mode.effects, path, modes, depth + 2) : null
  }
  return null
}

function suspendedNode(state: GameState): { frame: Frame; node: Effect } {
  const frame = state.resolution.active
  if (!frame) throw new IllegalCommandError('no ability is waiting for an answer')
  const ability = abilityOf(state, frame)
  if (!ability) throw new IllegalCommandError('the waiting ability no longer exists')
  const node = effectAt(ability.effects, frame.path, frame.modes, 0)
  if (!node) throw new IllegalCommandError('the waiting ability has no effect at its program counter')
  return { frame, node }
}

export function applyChooseTargets(state: GameState, player: PlayerId, targets: readonly CardId[]): [GameState, Event[]] {
  if (state.pending?.kind !== 'chooseTargets' || state.pending.player !== player) throw new IllegalCommandError('no target choice owed by this player')
  const { frame, node } = suspendedNode(state)
  if (node.kind !== 'chooseTargets') throw new IllegalCommandError('the waiting ability is not choosing targets')
  if (new Set(targets).size !== targets.length) throw new IllegalCommandError('duplicate target')
  const candidates = targetCandidates(state, frame.source, frame.controller, node.from)
  const max = Math.min(node.max, candidates.length)
  if (targets.length < node.min || targets.length > max) throw new IllegalCommandError(`choose ${node.min}..${max} targets, got ${targets.length}`)
  for (const id of targets) if (!candidates.includes(id)) throw new IllegalCommandError(`${id} is not a legal target`)
  // Extending the path by one level says "the choice at this node is made" — resume runs `then`, not the prompt.
  const active: Frame = { ...frame, chosen: [...targets], path: [...frame.path, 0] }
  return [{ ...state, pending: null, resolution: { ...state.resolution, active } }, []]
}

export function applyChooseMode(state: GameState, player: PlayerId, modes: readonly number[]): [GameState, Event[]] {
  if (state.pending?.kind !== 'chooseMode' || state.pending.player !== player) throw new IllegalCommandError('no mode choice owed by this player')
  const { frame, node } = suspendedNode(state)
  if (node.kind !== 'chooseModes') throw new IllegalCommandError('the waiting ability is not choosing modes')
  if (new Set(modes).size !== modes.length) throw new IllegalCommandError('duplicate mode')
  const max = Math.min(node.max, node.modes.length)
  if (modes.length < node.min || modes.length > max) throw new IllegalCommandError(`choose ${node.min}..${max} modes, got ${modes.length}`)
  for (const m of modes) if (!Number.isInteger(m) || m < 0 || m >= node.modes.length) throw new IllegalCommandError(`${m} is not a mode of this ability`)
  const ordered = [...modes].sort((a, b) => a - b)   // "select up to 2 of the 3 following" resolves in PRINTED order
  const active: Frame = { ...frame, modes: ordered, path: [...frame.path, 0, 0] }
  return [{ ...state, pending: null, resolution: { ...state.resolution, active } }, []]
}
