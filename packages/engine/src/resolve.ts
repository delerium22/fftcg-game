import type { Ability, AbilityTrigger, Effect, Frame, TargetFilter, TargetSpec, TriggerEvent, TriggerWhose } from './abilities.js'
// Type-only, so it is erased at compile time and creates no runtime cycle with rules.ts (which imports this module).
import type { ZoneTransition } from './rules.js'
import { drawCards } from './draw.js'
import { MAX_RESOLUTION_STEPS } from './abilities.js'
import type { CardId, FieldCard, GameState, Pending } from './state.js'
import { defOf, findFieldCard, learn, updatePlayer } from './state.js'
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
 * immediately, in trigger order, and the opponent cannot answer it.
 *
 * C1's atomicity rule is REFINED by spec C2-6, not replaced: a frame is atomic WITHIN itself, across every
 * prompt it raises; rule processes run BETWEEN frames. `drainResolution` therefore completes exactly one frame
 * and yields while queued work remains, so `settle` gets its §12.3 pass in before the next frame starts.
 * Without that yield, Luso's "break it" resolved BEFORE §12.4.5 had broken the Forward its own damage killed —
 * backwards under CR §§12.3–12.4.5.
 */

// ---------------------------------------------------------------------------
// Queueing
// ---------------------------------------------------------------------------

/** Push a triggered clause onto the agenda. The frame starts at path `[]` — the top of `ability.effects`. */
export function enqueueTrigger(state: GameState, source: CardId, controller: PlayerId, ability: Ability, triggerEvent: TriggerEvent | null = null): GameState {
  const frame: Frame = { abilityId: ability.id, source, controller, path: [], chosen: [], modes: [], triggerEvent }
  return { ...state, resolution: { ...state.resolution, queue: [...state.resolution.queue, frame] } }
}

/**
 * One card dealing one lot of damage to one recipient — the SINGLE record combat damage (`attack.ts`) and the
 * ability `damage` effect both produce, because the printed text says "deals damage", not "deals combat
 * damage" (spec C2-7). Exactly one of `target`/`victim` is non-null.
 *
 * `sourceController` is passed in rather than derived: the source may be about to leave the field, and party
 * attribution is by MEMBERSHIP, not array position (spec C2-8).
 */
export interface DamageOccurrence {
  readonly source: CardId
  readonly sourceController: PlayerId
  readonly target: CardId | null
  readonly victim: PlayerId | null
  readonly amount: number
}

/**
 * Queue the `dealtDamage` clauses of every damage source in `hits`, in hit order. Damage inside one batch is
 * simultaneous (§10.1.4.2), so callers apply ALL of it first and dispatch once — a source that is about to be
 * broken by the same batch still triggers, exactly as a zone-change watcher does (spec C2-4).
 */
export function enqueueDamageTriggers(state: GameState, hits: readonly DamageOccurrence[]): GameState {
  let s = state
  for (const h of hits) {
    if (h.target === null && h.victim === null) continue
    const to = h.target !== null ? 'forward' : 'player'
    const code = state.cards[h.source]?.code
    const event: TriggerEvent = { kind: 'damage', source: h.source, sourceController: h.sourceController, target: h.target, victim: h.victim, amount: h.amount }
    for (const a of (code === undefined ? undefined : state.defs[code])?.abilities ?? []) {
      if (a.trigger.kind !== 'dealtDamage' || a.trigger.to !== to) continue
      // "deals damage to YOUR OPPONENT" (Luso, Prishe) is a real restriction, not decoration. It held only
      // because today's single producer always damages the opponent; encoding it here means a future
      // self-damage or redirect path cannot silently fire these on their own controller.
      if (!damagedSideMatches(state, a.trigger.whose, h)) continue
      s = enqueueTrigger(s, h.source, h.sourceController, a, event)
    }
  }
  return s
}


/**
 * Is the damaged side the one the clause names, relative to the SOURCE's controller (spec C2-10)?
 * For damage to a Forward the side is that Forward's controller, looked up while it is still on the field —
 * the pool's only `to: 'forward'` clause is unrestricted (`whose: 'any'`), so this is guarded, not exercised.
 */
function damagedSideMatches(state: GameState, whose: TriggerWhose, h: DamageOccurrence): boolean {
  if (whose === 'any') return true
  const damaged = h.victim !== null ? h.victim : h.target === null ? null : findFieldCard(state, h.target)?.owner ?? null
  if (damaged === null) return true   // nothing attributable to compare against
  return whose === 'self' ? damaged === h.sourceController : damaged === opponentOf(h.sourceController)
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
  // "Character" is Forward, Backup OR Monster and never Summon (§7.2), which a single `type` cannot say — both
  // Prishe's and Luso's Break-Zone retrievals need it (spec C2-9). `type` and `types` conjoin: a filter carrying
  // both must satisfy both.
  if (filter.types !== undefined && !filter.types.includes(def.type)) return false
  if (filter.element !== undefined && !def.elements.includes(filter.element)) return false
  if (filter.maxCost !== undefined && def.cost > filter.maxCost) return false
  // EXACT, not a ceiling: a cost-3 Forward must not satisfy Hugh Yurg's "of cost 1" (spec C8-3).
  if (filter.cost !== undefined && def.cost !== filter.cost) return false
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

export function removeFromField(state: GameState, id: CardId): GameState {
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
  /** Indices answered to a `chooseFromDeck` (spec C9-1). */
  picks: number[]
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

/**
 * Finish a `lookAtDeck`: the picked cards go to hand, the rest to the bottom, and the exposure is over.
 *
 * Shared by the answered path and the nothing-was-eligible path, which are the same move with an empty pick.
 */
function settleLook(ctx: Ctx, eff: Extract<Effect, { kind: 'lookAtDeck' }>, exposed: readonly CardId[], picks: readonly number[]): void {
  const taken = picks.map((i) => exposed[i] as CardId)
  const rest = exposed.filter((_, i) => !picks.includes(i))
  ctx.state = updatePlayer(ctx.state, ctx.controller, (q) => ({
    ...q,
    // MVP0-SIMPLIFICATION (spec C9): "return the other cards to the bottom in any order" keeps the exposed
    // order. Asking a player to arrange cards going to the BOTTOM of a 40-card deck is a permutation prompt
    // for something a game this length will almost never reach.
    deck: [...q.deck.slice(eff.count), ...rest],
    hand: [...q.hand, ...taken],
  }))
  for (const id of taken) ctx.events.push({ type: 'addedToHand', player: ctx.controller, card: id })
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
    case 'lookAtDeck': {
      const exposed = ctx.state.players[ctx.controller].deck.slice(0, eff.count)
      if (answered) { settleLook(ctx, eff, exposed, ctx.picks); return }
      if (exposed.length === 0) { noLegalTarget(ctx); return }

      // Exposing IS the effect that changes what is known — before any choice, and whether or not one
      // follows. `self` is a LOOK, `all` a REVEAL; that is the whole private/public distinction.
      const audience: PlayerId[] = eff.audience === 'all' ? [0, 1] : [ctx.controller]
      ctx.state = learn(ctx.state, audience, exposed)
      ctx.events.push({ type: 'deckExposed', player: ctx.controller, count: exposed.length, audience: eff.audience })

      const eligible = exposed
        .map((id, i) => (matchesFilter(ctx.state, ctx.source, id, eff.take.filter) ? i : -1))
        .filter((i) => i >= 0)
      // "Add 1 Backup among them" with no Backup among them takes nothing — but the look still happened and
      // the cards still go to the bottom, so this settles rather than aborting.
      if (eff.take.min > eligible.length) { settleLook(ctx, eff, exposed, []); return }

      ctx.suspend = {
        kind: 'chooseFromDeck', player: ctx.controller,
        min: eff.take.min, max: Math.min(eff.take.max, eligible.length), count: exposed.length, eligible,
      }
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
    case 'damage': {
      const hits: DamageOccurrence[] = []
      for (const id of ctx.chosen) {
        const loc = findFieldCard(ctx.state, id)
        if (!loc || loc.zone !== 'forwards') continue   // only Forwards carry damage
        ctx.state = setFieldCard(ctx.state, id, (c) => ({ ...c, damage: c.damage + eff.amount }))
        ctx.events.push({ type: 'abilityDamage', source: ctx.source, target: id, amount: eff.amount })
        hits.push({ source: ctx.source, sourceController: ctx.controller, target: id, victim: null, amount: eff.amount })
      }
      ctx.state = enqueueDamageTriggers(ctx.state, hits)   // ability damage triggers exactly as combat damage does (spec C2-7)
      // §12.4.5 turns this into a break; `settle` runs the rule processes, which honour `cannotBeBroken`. Because
      // `drainResolution` yields between frames (spec C2-6), that process resolves BEFORE the trigger just queued.
      return
    }
    case 'breakCard': {
      // An ability break is a field→Break Zone transition like any other, and Lightning's "when a Forward
      // opponent controls is put from the field into the Break Zone" is cause-agnostic. This path used to do its
      // own zone move and never produce a transition, so NO observer clause fired on an ability break —
      // ~130 of ~220 ability breaks on the shipped gate had an eligible watcher standing, and every test,
      // invariant and fuzzer run was green while it silently missed them.
      const pre = ctx.state   // watchers are read PRE-move, so one that breaks itself here still triggers
      const moved: ZoneTransition[] = []
      for (const id of ctx.chosen) {
        const loc = findFieldCard(ctx.state, id)
        if (!loc) continue
        if (loc.card.flags.includes('cannotBeBroken')) { ctx.events.push({ type: 'breakPrevented', card: id, flag: 'cannotBeBroken' }); continue }
        // `loc.owner` is the field the card sat on — its CONTROLLER. Real ownership is `CardInstance.owner`, and
        // §12.4.4/§15.1.1.3 sends a broken card to its OWNER's Break Zone. They coincide across the MVP0 pool.
        const owner = ctx.state.cards[id]?.owner ?? loc.owner
        moved.push({
          card: id, controller: loc.owner, owner,
          from: loc.zone === 'backups' ? 'backups' : 'forwards', to: 'breakZone', reason: 'ability',
          cause: ctx.source, causeController: ctx.controller, snapshot: loc.card,
        })
        ctx.state = updatePlayer(removeFromField(ctx.state, id), owner, (ps) => ({ ...ps, breakZone: [...ps.breakZone, id] }))
        ctx.events.push({ type: 'brokenByAbility', card: id, source: ctx.source })
      }
      ctx.state = enqueueZoneChangeTriggers(pre, ctx.state, moved)
      return
    }
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
    case 'draw': {
      // The ability's CONTROLLER draws, not the turn player: Miner's draw is Miner's controller's.
      const [drawn, drawEvents] = drawCards(ctx.state, ctx.controller, eff.count)
      ctx.state = drawn
      ctx.events.push(...drawEvents)
      return
    }
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
    path: [...frame.path], chosen: [...frame.chosen], modes: [...frame.modes], picks: [...(frame.picks ?? [])],
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

/**
 * §10.1.1 Attack Preparation Step. Enters the Attack Phase and STOPS there, so anything that triggers "at the
 * beginning of the Attack Phase" resolves while the state actually says Attack Phase (spec C5-1).
 *
 * The move into declaration is the agenda's `continuation`, not this function's job: Cloud's clause raises a
 * target choice, and the player must answer it before declaration arrives.
 */
export function enterAttackPreparation(state: GameState, player: PlayerId): [GameState, Event[]] {
  const s: GameState = { ...state, phase: 'attack', attack: { step: 'preparation', attackers: [], blocker: null }, priority: player }
  return [s, [{ type: 'phaseStarted', phase: 'attack', step: 'preparation' }]]
}

/** §10.1.2 Declaration. Reached from preparation, either immediately or once the beginning-of-phase triggers drain. */
export function enterAttackDeclaration(state: GameState, player: PlayerId): [GameState, Event[]] {
  const s: GameState = { ...state, phase: 'attack', attack: { step: 'declaration', attackers: [], blocker: null }, priority: player }
  return [s, [{ type: 'phaseStarted', phase: 'attack', step: 'declaration' }]]
}

/**
 * Queue every "at the beginning of the Attack Phase" clause the TURN PLAYER controls (spec C5-2).
 *
 * Only the turn player's: Cloud prints "during each of YOUR turns". Scanning both fields would hand the
 * opponent a free protection every round, and a fixture with one Cloud on one side cannot tell the difference.
 */
export function enqueueAttackPhaseTriggers(state: GameState, player: PlayerId): GameState {
  let s = state
  const ps = s.players[player]
  for (const c of [...ps.forwards, ...ps.backups]) {
    for (const ability of defOf(s, c.id).abilities ?? []) {
      if (ability.trigger.kind !== 'attackPhaseBegins') continue
      s = enqueueTrigger(s, c.id, player, ability)
    }
  }
  return s
}

/**
 * Advance the agenda by exactly ONE frame: resume the active one, or start the next queued one, and run it until
 * it finishes or a player must choose (the choice becomes `state.pending` and the frame stays `active`). Then
 * YIELD — spec C2-6. `settle` in apply.ts owns the loop and runs §12.3 rule processes before the next frame
 * starts, which is what puts §12.4.5's break ahead of the trigger that same damage queued. Draining the whole
 * queue here instead would resolve Luso before the Forward it killed was broken.
 *
 * With the queue and the active frame both empty, the system continuation — if any — runs. Never touches an
 * existing `pending`: the decision already on the table always comes first.
 *
 * `resolution.steps` is NOT reset here: `settle` in apply.ts resets it once the whole settlement is quiet, so a
 * rule-process ⇄ trigger cycle keeps accumulating and hits the cap instead of restarting the count every pass.
 */
export function drainResolution(state: GameState): [GameState, Event[]] {
  const events: Event[] = []
  let s = state
  if (s.result || s.pending) return [s, events]
  let frame = s.resolution.active
  if (!frame) {
    const [next, ...rest] = s.resolution.queue
    if (next) {
      frame = next
      const steps = s.resolution.steps + 1   // starting a frame is a step too, so a cycle of empty clauses is still capped
      if (steps > MAX_RESOLUTION_STEPS) throw new Error(`resolution exceeded ${MAX_RESOLUTION_STEPS} steps (spec C1-5) — trigger cycle?`)
      s = { ...s, resolution: { ...s.resolution, active: frame, queue: rest, steps } }
      // An ACTIVATED ability already announced itself with `abilityActivated` when the player paid for it
      // (spec C3-A7). Saying "triggers" here as well would report their own deliberate move back to them as
      // something that merely happened.
      if (frame.origin !== 'activated') {
        events.push({ type: 'abilityTriggered', player: frame.controller, card: frame.source, abilityId: frame.abilityId })
      }
    }
  }
  if (frame) {
    const r = runFrame(s, frame)
    s = r.state
    events.push(...r.events)
    s = r.pending
      ? { ...s, pending: r.pending, resolution: { ...s.resolution, active: r.frame, steps: r.steps } }
      : { ...s, resolution: { ...s.resolution, active: null, steps: r.steps } }
    return [s, events]   // one frame per call; `settle` comes back with rule processes run
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

/**
 * Answer a `chooseFromDeck` with INDICES (spec C9-1).
 *
 * Validated against the pending's own `count`/`eligible` rather than against the deck, which is what keeps
 * this world-independent: the same command is legal in every determinisation, and which card index 2 names
 * is whatever that world sampled.
 */
export function applyChooseFromDeck(state: GameState, player: PlayerId, picks: readonly number[]): [GameState, Event[]] {
  const pending = state.pending
  if (pending?.kind !== 'chooseFromDeck' || pending.player !== player) throw new IllegalCommandError('no deck choice owed by this player')
  if (new Set(picks).size !== picks.length) throw new IllegalCommandError('duplicate pick')
  if (picks.length < pending.min || picks.length > pending.max) throw new IllegalCommandError(`choose ${pending.min}..${pending.max} cards, got ${picks.length}`)
  for (const i of picks) {
    if (!Number.isInteger(i) || i < 0 || i >= pending.count) throw new IllegalCommandError(`${i} is not one of the exposed cards`)
    if (!pending.eligible.includes(i)) throw new IllegalCommandError(`${i} is not a legal choice here`)
  }
  const { frame } = suspendedNode(state)
  // Extending the path says "the choice at this node is made" — the same marker `applyChooseTargets` writes.
  const active: Frame = { ...frame, picks: [...picks], path: [...frame.path, 0] }
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

// ---------------------------------------------------------------------------
// Zone-change watcher dispatch (spec C2-3/C2-4). Lives here, not in rules.ts, because rules.ts already imports
// this module — keeping dispatch in one place avoids a runtime import cycle.
// ---------------------------------------------------------------------------
/**
 * One trigger occurrence: a (watcher, clause, matching transition) TRIPLE (spec C2-3). CR §11.8.6 — a Lightning
 * watching two opponent Forwards broken at the same instant triggers TWICE, so this is deliberately not
 * collapsed to one occurrence per batch.
 */
interface WatcherOccurrence {
  readonly transition: ZoneTransition
  readonly source: CardId
  readonly controller: PlayerId
  readonly ability: Ability
}

/** "Opponent controls" is relative to the WATCHER's controller, never the turn player (spec C2-10). */
function watches(state: GameState, trigger: AbilityTrigger, watcher: PlayerId, t: ZoneTransition): boolean {
  if (trigger.kind !== 'observesZoneChange') return false
  if (trigger.to !== 'breakZone') return false   // `from: 'field'` covers both field arrays
  // The moved card's TYPE, from its def — Lightning watches "a FORWARD … put into the Break Zone". Checking the
  // transition's `from` array instead would be the same implicit restriction that made this safe only by accident.
  const code = state.cards[t.card]?.code
  if ((code === undefined ? undefined : state.defs[code])?.type !== trigger.of) return false
  if (trigger.whose === 'self') return t.controller === watcher
  if (trigger.whose === 'opponent') return t.controller === opponentOf(watcher)
  return true
}

/**
 * Snapshot the watchers of a whole simultaneous batch BEFORE any of it moves (spec C2-4). A Lightning broken in
 * the SAME batch as its own victim must still trigger, and once removal has run its clause is no longer
 * discoverable from the field at all; `Frame.source` already tolerates an off-field source (C1).
 *
 * Order is spec C2-11's total key — (occurrence index, AP/NAP controller, source zone, pre-event field index,
 * ability index, source id) — produced by CONSTRUCTION rather than by sorting: transitions in batch order, then
 * active before non-active player, then forwards before backups, then field-array index, then printed clause
 * order. The final component, source id, can never actually break a tie, because (controller, zone, index)
 * already names exactly one card; it is in the key so the key is total by inspection. Watchers are read from the
 * FIELD ARRAYS only, never `state.cards`, because `determinise` preserves array order and not object-key order.
 *
 * MVP0-SIMPLIFICATION: fixed AP-first FIFO. CR §11.8.7 lets each controller order their OWN simultaneous
 * triggers, with the non-turn player's placed on top of the turn player's. None of this pool's clauses has an
 * outcome-sensitive AP/NAP conflict, so the deviation is unobservable — but it is a deviation.
 */
function collectWatchers(state: GameState, transitions: readonly ZoneTransition[]): WatcherOccurrence[] {
  const out: WatcherOccurrence[] = []
  // Local only, never on GameState. Guards against the SAME occurrence being discovered twice; two DISTINCT
  // transitions matching one watcher stay two occurrences (spec C2-3).
  const seen = new Set<string>()
  const ap = state.turnPlayer
  for (const t of transitions) {
    for (const p of [ap, opponentOf(ap)]) {
      for (const zone of ['forwards', 'backups'] as const) {
        for (const c of state.players[p][zone]) {
          const code = state.cards[c.id]?.code
          for (const ability of (code === undefined ? undefined : state.defs[code])?.abilities ?? []) {
            if (!watches(state, ability.trigger, p, t)) continue
            const key = `${c.id} ${ability.id} ${t.card}`
            if (seen.has(key)) continue
            seen.add(key)
            out.push({ transition: t, source: c.id, controller: p, ability })
          }
        }
      }
    }
  }
  return out
}

/** Enqueue the snapshotted occurrences AFTER movement, so a frame that looks at the field sees the post-batch one. */
function enqueueZoneTriggers(state: GameState, occurrences: readonly WatcherOccurrence[]): GameState {
  let s = state
  for (const o of occurrences) {
    const t = o.transition
    const event: TriggerEvent = { kind: 'zoneChange', card: t.card, from: 'field', to: 'breakZone', controller: t.controller, owner: t.owner, reason: t.reason }
    s = enqueueTrigger(s, o.source, o.controller, o.ability, event)
  }
  return s
}
/**
 * Dispatch `observesEnterField` clauses for one card ARRIVING on a field (spec C8-1) — `observesZoneChange`
 * pointed the other way.
 *
 * `state` must ALREADY contain the arrived card. Its mirror reads watchers from the pre-move state, because a
 * watcher leaving in the same batch must still trigger; here the opposite is wanted, and for the same reason:
 * a card that just arrived can be watched, and a watcher that just arrived can watch. Calling this before the
 * field arrays are updated would simply fire nothing, which is the failure a test asserting "no crash" would
 * not notice.
 *
 * Every path that puts a card onto the field must call this. Today that is casting; rung C9's Hugh Yurg
 * search puts one there without casting, and it calls this same helper rather than growing a parallel copy —
 * which is exactly the mistake `breakCard` made against the zone-change dispatch, silently missing ~40% of
 * the breaks its printed text named.
 */
export function enqueueEnterFieldTriggers(state: GameState, card: CardId, controller: PlayerId): GameState {
  const def = defFor(state, card)
  if (!def) return state
  const event: TriggerEvent = { kind: 'enteredField', card, controller }
  let s = state
  for (const watcher of [0, 1] as const) {
    const ps = s.players[watcher]
    for (const c of [...ps.forwards, ...ps.backups]) {
      for (const ability of defOf(s, c.id).abilities ?? []) {
        const t = ability.trigger
        if (t.kind !== 'observesEnterField') continue
        // "your field" is relative to the WATCHER, never the turn player (spec C2-10, and C8-1 inherits it).
        if (t.whose === 'self' && controller !== watcher) continue
        if (t.whose === 'opponent' && controller === watcher) continue
        if (def.type !== t.of) continue
        // `source` is the WATCHER, so `excludeSource` on such a filter would mean "not myself arriving".
        if (t.filter && !matchesFilter(s, c.id, card, t.filter)) continue
        s = enqueueTrigger(s, c.id, watcher, ability, event)
      }
    }
  }
  return s
}

/**
 * Dispatch `observesZoneChange` clauses for one batch of field→Break Zone movement.
 *
 * `pre` is the state BEFORE the batch moved — watchers must be read from it, or a watcher that is itself in the
 * batch is already gone (spec C2-4). `post` is the state the frames are queued onto.
 *
 * EVERY field→Break Zone path must call this, not just the §12.4.4/§12.4.5 rule processes. `breakCard` did its own
 * zone move and skipped it, so no observer clause fired on an ability-caused break at all — measured on the
 * shipped gate, ~130 of ~220 ability breaks had a Lightning standing on the watching side, so roughly 40% of the
 * breaks its printed text names were silently missed, with every test, invariant and fuzzer run still green.
 */

export function enqueueZoneChangeTriggers(pre: GameState, post: GameState, transitions: readonly ZoneTransition[]): GameState {
  if (!transitions.length) return post
  return enqueueZoneTriggers(post, collectWatchers(pre, transitions))
}
