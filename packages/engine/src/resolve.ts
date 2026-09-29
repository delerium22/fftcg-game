import type { Ability, AbilityTrigger, Condition, Effect, Frame, TargetFilter, TargetSpec, TriggerEvent, TriggerWhose } from './abilities.js'
// Type-only, so it is erased at compile time and creates no runtime cycle with rules.ts (which imports this module).
import type { ZoneTransition } from './rules.js'
import { drawCards } from './draw.js'
import { shuffle } from './rng.js'
import { EMPTY_RESOLUTION, MAX_RESOLUTION_STEPS, effectAtPath, hasResolutionWork, unimplementedClauseCount } from './abilities.js'
import type { CardId, DamageOccurrence, FieldCard, GameState, Pending, StackItem } from './state.js'
export type { DamageOccurrence } from './state.js'
import { defOf, findFieldCard, forget, learn, updatePlayer, powerOf, keywordsOf, flagsOf } from './state.js'
import { matchesDefFilter } from './filters.js'
export { matchesDefFilter } from './filters.js'
import { amountOf, staticApplies } from './layer.js'
// Rung V1-A1: the AI and the browser price and word counted amounts through these. Not `export *` from layer.ts,
// which cp.ts already re-exports `staticApplies` from — the index would see it twice.
export { amountOf, countControlled } from './layer.js'
import type { CardDef, PlayerId } from './types.js'
import { opponentOf } from './types.js'
import type { Event, StackRef } from './events.js'
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
 * Rung J1 retired C1-4's "no stack" marker: a triggered clause is DECLARED as it is placed on the stack
 * (§11.8.7) and resolves only when both players have forfeited priority (§11.1.7); Summons and activations
 * are stack items too (§11.3, §11.6). What remains simplified is marked below (§11.8.7 within-player order,
 * §11.11.4 last-known information).
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
 * For damage to a Forward the side is that Forward's controller as the hit landed (`targetController`) — a held
 * First Strike occurrence's target may be gone by now. The pool's only `to: 'forward'` clause is unrestricted
 * (`whose: 'any'`), so this is guarded, not exercised.
 */
function damagedSideMatches(state: GameState, whose: TriggerWhose, h: DamageOccurrence): boolean {
  if (whose === 'any') return true
  const damaged = h.victim !== null ? h.victim : h.targetController ?? (h.target === null ? null : findFieldCard(state, h.target)?.owner ?? null)
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

/** The instance half of the power/status/keyword axes (rung J5): read from the FieldCard when the card is on a field. */
function matchesInstanceFilter(state: GameState, id: CardId, filter: TargetFilter): boolean {
  const loc = findFieldCard(state, id)
  if (!loc) {
    // Not on a field (Break Zone, deck): the def answers, except `status`, which is undefined there.
    const def = defFor(state, id)
    if (!def) return false
    if (filter.status !== undefined) return false
    if (filter.minPower !== undefined && (def.power === null || def.power < filter.minPower)) return false
    if (filter.maxPower !== undefined && (def.power === null || def.power > filter.maxPower)) return false
    if (filter.grantedKeyword !== undefined && !def.keywords.includes(filter.grantedKeyword)) return false
    return true
  }
  const fc = loc.card
  const def = defOf(state, id)
  if (filter.status !== undefined && fc.status !== filter.status) return false
  const isForward = def.type === 'forward'
  const power = isForward ? powerOf(state, fc) : null
  if (filter.minPower !== undefined && (power === null || power < filter.minPower)) return false
  if (filter.maxPower !== undefined && (power === null || power > filter.maxPower)) return false
  if (filter.grantedKeyword !== undefined && !keywordsOf(state, fc).has(filter.grantedKeyword)) return false
  return true
}

function matchesFilter(state: GameState, source: CardId, id: CardId, filter: TargetFilter | undefined): boolean {
  if (!filter) return true
  const def = defFor(state, id)
  if (!def) return false
  // The def axes; the instance axes (power, status, granted keyword) are answered by the field below (rung J5).
  if (!matchesDefFilter(def, filter, true)) return false
  if (!matchesInstanceFilter(state, id, filter)) return false
  // A fact about the INSTANCE and the state, which is why it lives here and not in `matchesDefFilter`
  // (spec C10-2). Sphene's "put in your Break Zone from the field during this turn".
  if (filter.putIntoBreakZoneFromFieldThisTurn) {
    const anywhere = state.players.some((ps) => ps.putIntoBreakZoneFromFieldThisTurn.includes(id))
    if (!anywhere) return false
  }
  if (filter.excludeSource && id === source) return false
  if (filter.excludeSourceName) {
    const src = defFor(state, source)
    if (src && src.name === def.name) return false
  }
  return true
}

/**
 * Whether an `if`'s condition holds now (rung V1-A1, spec V1-D6). Here rather than in layer.ts because
 * `subjectMatches` needs `matchesFilter`, which lives in this module; every static condition is delegated to the
 * layer's `staticApplies`, so an `if` and a static `when` can never read the same condition two ways.
 *
 * `chosen` is the frame's binding at the `if` node; `subjectMatches` reads its first card. A null source (no
 * caller passes one today) excludes nothing: `-1` names no card, so `excludeSource`/`excludeSourceName` pass.
 */
export function conditionHolds(ctx: { state: GameState; source: CardId | null; controller: PlayerId }, when: Condition, chosen: readonly CardId[]): boolean {
  if (when.kind === 'subjectMatches') {
    const subject = chosen[0]
    return subject !== undefined && matchesFilter(ctx.state, ctx.source ?? -1, subject, when.filter)
  }
  return staticApplies(ctx, when)
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
  /**
   * Program counter, one index per nesting level. `chooseModes` owns TWO levels: mode ordinal, then effect index;
   * `if` owns two as well: the branch taken (0 = then, 1 = else), then the effect index (rung V1-A1).
   */
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
  /** Rung J1-D3. Declaring (choices only, as the item goes on the stack) or resolving. */
  stage: 'declare' | 'resolve'
  /**
   * Targets declared at placement, by node path; read at resolution and re-validated (§11.11.2). A choice answered
   * AT resolution (a chooser under an `if`) is recorded here too, so its node can rebind its own targets when a
   * deeper prompt resumes; the §11.11.2 check reads this list only as a frame starts resolving, before any.
   */
  declared: { path: number[]; targets: CardId[] }[]
  /** The answer the frame resumed with — the targets of the node the prompt was raised at. */
  answer: readonly CardId[]
  modesDeclared: boolean
  /** Declaration met a choice with no legal answer (§11.8.4), or resolution found every declared target gone (§11.11.2). */
  cancelled: boolean
  /** Declaration reached its first real effect — the item is fully declared. */
  done: boolean
}

const samePath = (a: readonly number[], b: readonly number[]): boolean => a.length === b.length && a.every((x, i) => x === b[i])

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
  ctx.events.push({ type: 'abilityNoLegalTarget', card: ctx.source, abilityId: ctx.abilityId, controller: ctx.controller })
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
    if (ctx.suspend || ctx.done) return
  }
}

/**
 * Finish a `lookAtDeck`: the picked cards go to hand, the rest to the bottom, and the exposure is over.
 *
 * Shared by the answered path and the nothing-was-eligible path, which are the same move with an empty pick.
 */
function settleLook(ctx: Ctx, eff: Extract<Effect, { kind: 'lookAtDeck' }>, exposed: readonly CardId[], picks: readonly number[]): void {
  const taken = picks.map((i) => exposed[i] as CardId)
  const kept = exposed.filter((_, i) => !picks.includes(i))
  // Whatever was NOT exposed stays under whatever was, in both cases: for a search `below` is empty because
  // the whole deck was exposed, and the one expression covers the top-N look and the search alike.
  const below = ctx.state.players[ctx.controller].deck.slice(exposed.length)
  // MVP0-SIMPLIFICATION (spec C9): "return the other cards to the bottom in any order" keeps the exposed
  // order. Asking a player to arrange cards going to the BOTTOM of a 40-card deck is a permutation prompt
  // for something a game this length will almost never reach.
  let deck = [...below, ...kept]
  if (eff.rest === 'shuffle') {
    const [shuffled, rng] = shuffle(ctx.state.rng, deck)
    deck = shuffled
    ctx.state = { ...ctx.state, rng }
  }
  ctx.state = updatePlayer(ctx.state, ctx.controller, (q) => ({
    ...q,
    deck,
    hand: eff.to === 'hand' ? [...q.hand, ...taken] : q.hand,
  }))
  // The shuffle is what pays for having looked: a player who searched their whole deck legitimately saw all
  // of it, and then it is randomised, so the knowledge must go with it. `forget` is called on the deck AFTER
  // the taken cards have left it — a card on its way to the field is public, and re-hiding it would be wrong.
  if (eff.rest === 'shuffle') ctx.state = forget(ctx.state, deck)
  for (const id of taken) {
    if (eff.to === 'hand') { ctx.events.push({ type: 'addedToHand', player: ctx.controller, card: id }); continue }
    ctx.events.push({ type: 'playedFromDeck', player: ctx.controller, card: id })
    ctx.state = putOntoField(ctx.state, id, ctx.controller, ctx.events)
  }
}

function runEffect(ctx: Ctx, eff: Effect, depth: number, answered: boolean): void {
  // Rung J1-D3: the declare stage walks CHOICE nodes only. The first effect that is not one ends declaration —
  // the item is fully declared and goes on the stack; everything from here runs when it resolves.
  // A SELECT is not a choice either (§11.3.3, rung V1-A2): it is made as the item resolves, so declaration ends at it.
  const choice = (eff.kind === 'chooseTargets' && eff.select === undefined) || eff.kind === 'chooseModes'
  if (ctx.stage === 'declare' && !choice) { ctx.done = true; return }
  step(ctx)
  switch (eff.kind) {
    case 'chooseTargets': {
      if (answered) {
        // On the resume spine. Either the prompt was raised at THIS node (the spine enters its `then` and stops:
        // `applyChooseTargets` appended one level) and the answer is recorded, or a DEEPER prompt was answered and
        // this node rebinds its own recorded targets — the answer belongs to the inner node, and an effect after
        // the inner one in this `then` must act on this node's targets (V1-A1 review M1).
        const here = ctx.resume.length === depth + 2
        const own = here ? [...ctx.answer] : ctx.declared.find((d) => samePath(d.path, ctx.path))?.targets ?? [...ctx.chosen]
        if (here) ctx.declared.push({ path: [...ctx.path], targets: [...own] })
        // "When you do so" (rung V1-A2, spec V1-D10): nothing picked, nothing nested runs.
        if (eff.onlyIfChosen && own.length === 0) return
        const outer = ctx.chosen
        ctx.chosen = [...own]
        runEffects(ctx, eff.then, depth + 1, true)
        if (!ctx.suspend) ctx.chosen = outer
        return
      }
      // Resolving a node that was declared at placement: no prompt. Its targets are re-validated against the
      // candidates NOW (§11.11.2) — the ones that left, or stopped matching the filter, are dropped, and a
      // node with none left is skipped. (Whether the WHOLE item is cancelled was decided in `runFrame`.)
      const pre = ctx.stage === 'resolve' ? ctx.declared.find((d) => samePath(d.path, ctx.path)) : undefined
      if (pre) {
        const candidates = targetCandidates(ctx.state, ctx.source, ctx.controller, eff.from)
        const valid = pre.targets.filter((t) => candidates.includes(t))
        if (valid.length === 0) return
        const outer = ctx.chosen
        ctx.chosen = valid
        runEffects(ctx, eff.then, depth + 1, false)
        if (!ctx.suspend) ctx.chosen = outer
        return
      }
      const candidates = targetCandidates(ctx.state, ctx.source, ctx.controller, eff.from)
      // A select with nothing to select does nothing, and says nothing: it is not a failed choice (§11.3.3). It is
      // only ever reached resolving, so there is no placement to cancel.
      if (eff.select !== undefined && candidates.length === 0) return
      if (candidates.length === 0 || eff.min > candidates.length) {
        // §11.8.4: an auto-ability that cannot choose still triggers, and is removed as it is placed.
        if (ctx.stage === 'declare') ctx.cancelled = true
        noLegalTarget(ctx)
        return
      }
      // "Your opponent selects" (spec V1-D9): the prompt is the opponent's; the candidates stay relative to the
      // ability's controller, and `chooseTargetsCheck` re-derives them the same way.
      const player = eff.select === 'opponent' ? opponentOf(ctx.controller) : ctx.controller
      ctx.suspend = { kind: 'chooseTargets', player, min: eff.min, max: Math.min(eff.max, candidates.length), candidates }
      return
    }
    case 'chooseModes': {
      // Declared at placement (rung J1-D3), or answered by a prompt just now: run the chosen modes in order.
      const declaredHere = !answered && ctx.stage === 'resolve' && ctx.modesDeclared
      if (answered || declaredHere) {
        if (answered && ctx.stage === 'declare') ctx.modesDeclared = true
        const from = answered ? (ctx.resume[depth + 1] ?? 0) : 0
        for (let k = from; k < ctx.modes.length; k++) {
          ctx.path = [...ctx.path.slice(0, depth + 1), k]
          const mode = eff.modes[ctx.modes[k] ?? -1]
          if (mode) runEffects(ctx, mode.effects, depth + 2, answered && k === from)
          if (ctx.suspend) return
          // A mode's declaration ending (its first real effect) does not end the OTHER modes' declarations.
          if (ctx.stage === 'declare') ctx.done = false
        }
        return
      }
      if (eff.modes.length === 0 || eff.min > eff.modes.length) { noLegalTarget(ctx); return }
      ctx.suspend = { kind: 'chooseMode', player: ctx.controller, min: eff.min, max: Math.min(eff.max, eff.modes.length), labels: eff.modes.map((m) => m.label) }
      return
    }
    case 'if': {
      // Answered: a prompt inside the branch was raised and answered, so the branch was fixed then — never re-read
      // the condition, which may no longer hold (rung V1-A1). Otherwise it is read now, at resolution.
      const branch = answered ? (ctx.resume[depth + 1] ?? 0)
        : (conditionHolds({ state: ctx.state, source: ctx.source, controller: ctx.controller }, eff.when, ctx.chosen) ? 0 : 1)
      const effects = branch === 0 ? eff.then : (eff.else ?? [])
      ctx.path = [...ctx.path.slice(0, depth + 1), branch]
      runEffects(ctx, effects, depth + 2, answered)
      return
    }
    case 'lookAtDeck': {
      const own = ctx.state.players[ctx.controller].deck
      const exposed = eff.count === 'all' ? [...own] : own.slice(0, eff.count)
      if (answered) { settleLook(ctx, eff, exposed, ctx.picks); return }
      if (exposed.length === 0) { noLegalTarget(ctx); return }

      // Exposing IS the effect that changes what is known — before any choice, and whether or not one
      // follows. `self` is a LOOK, `all` a REVEAL; that is the whole private/public distinction.
      //
      // It is also what makes the INDEX answer world-independent for a search (spec C9-5, D-2): every slot
      // the controller now knows is PINNED by `determinise`, so "index 17" lands on the same card in every
      // determinisation taken from this point. A search that did not expose first could not be answered by
      // index at all — the position would name a different card in every world.
      const audience: PlayerId[] = eff.audience === 'all' ? [0, 1] : [ctx.controller]
      ctx.state = learn(ctx.state, audience, exposed)
      ctx.events.push({ type: 'deckExposed', player: ctx.controller, count: exposed.length, audience: eff.audience, cards: exposed, scope: eff.count === 'all' ? 'deck' : 'top' })

      const pending: Extract<Pending, { kind: 'chooseFromDeck' }> = {
        kind: 'chooseFromDeck', player: ctx.controller,
        min: eff.take.min, max: eff.take.max, count: exposed.length, to: eff.to,
        scope: eff.count === 'all' ? 'deck' : 'top',
        ...(eff.take.filter ? { filter: eff.take.filter } : {}),
      }
      // Asked through the SAME function that will validate the answer, and against the same state. Computing
      // it inline here instead left two implementations of "which positions does this filter allow" — so the
      // question a player is offered could drift from the one their answer is checked against.
      const eligible = deckPickCandidates(ctx.state, pending)
      // "Add 1 Backup among them" with no Backup among them takes nothing — but the look still happened and
      // the cards still go to the bottom, so this settles rather than aborting.
      //
      // `eligible.length === 0` is checked SEPARATELY from `min`, and it has to be: Hugh Yurg's search is
      // "you MAY", so `min` is 0, and `min > 0` alone would raise a prompt offering a choice between zero
      // and zero cards. A prompt with exactly one legal answer is not a decision — it is a click the player
      // has to make to continue, and for the AI a tree edge that carries no information.
      if (eligible.length === 0 || eff.take.min > eligible.length) { settleLook(ctx, eff, exposed, []); return }

      ctx.suspend = pending
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
    case 'freeze':
      // §15.2.4 (rung J3): a status, not a dulling — an active card stays active and frozen. Freezing a frozen
      // card changes nothing and says nothing.
      for (const id of ctx.chosen) {
        const loc = findFieldCard(ctx.state, id)
        if (!loc || loc.card.frozen === true) continue
        ctx.state = setFieldCard(ctx.state, id, (c) => ({ ...c, frozen: true }))
        ctx.events.push({ type: 'frozen', card: id })
      }
      return
    case 'damage': {
      // A counted amount (rung V1-A1) is read once per hit, for the ability's controller. Zero deals nothing at all:
      // no event and no damage trigger, since a card that deals 0 damage has not dealt damage.
      const amount = amountOf(ctx.state, ctx.controller, eff.amount)
      if (amount <= 0) return
      const hits: DamageOccurrence[] = []
      for (const id of ctx.chosen) {
        const loc = findFieldCard(ctx.state, id)
        if (!loc || loc.zone !== 'forwards') continue   // only Forwards carry damage
        ctx.state = setFieldCard(ctx.state, id, (c) => ({ ...c, damage: c.damage + amount }))
        ctx.events.push({ type: 'abilityDamage', source: ctx.source, target: id, amount })
        hits.push({ source: ctx.source, sourceController: ctx.controller, target: id, victim: null, amount, targetController: loc.owner })
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
        if (flagsOf(ctx.state, loc.card).has('cannotBeBroken')) { ctx.events.push({ type: 'breakPrevented', card: id, flag: 'cannotBeBroken' }); continue }
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
        // Leaving the Break Zone forgets the arrival (spec C10-2): come back by a discard this same turn and
        // you are a new object under CR §7.4, not a card Sphene may retrieve twice.
        ctx.state = forgetBreakZoneArrivals(moved, [id])
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

interface FrameResult { state: GameState; events: Event[]; pending: Pending | null; frame: Frame; steps: number; cancelled: boolean }

function runFrame(state: GameState, frame: Frame): FrameResult {
  const ability = abilityOf(state, frame)
  const stage = frame.stage ?? 'resolve'
  const base: FrameResult = { state, events: [], pending: null, frame, steps: state.resolution.steps, cancelled: false }
  if (!ability) return base   // the clause vanished with its def; drop the frame rather than throw
  const ctx: Ctx = {
    state, events: [], source: frame.source, controller: frame.controller, abilityId: frame.abilityId,
    path: [...frame.path],
    // An `observesChosen` clause runs with the CHOSEN card bound, as C11's inline execution bound it: "Prishe
    // gains +2000 power" is an `addPower` over the binding, and the binding is Prishe herself.
    chosen: frame.chosen.length ? [...frame.chosen] : frame.triggerEvent?.kind === 'chosen' ? [frame.triggerEvent.card] : [],
    modes: [...frame.modes], picks: [...(frame.picks ?? [])],
    triggerEvent: frame.triggerEvent,
    resume: frame.path, suspend: null, steps: state.resolution.steps,
    stage, declared: (frame.declared ?? []).map((d) => ({ path: [...d.path], targets: [...d.targets] })),
    modesDeclared: frame.modesDeclared ?? false, cancelled: false, done: false,
    answer: [...frame.chosen],
  }
  // §11.11.2: an item that chose targets, every one of which has since become illegal, is cancelled whole.
  // With at least one still legal it applies to those (per node, in `runEffect`). Checked only when the frame
  // STARTS resolving — a frame resuming from a prompt has already begun.
  if (stage === 'resolve' && frame.path.length === 0 && ctx.declared.length > 0) {
    const anyValid = ctx.declared.some((d) => {
      const node = effectAtPath(ability.effects, d.path, ctx.modes)
      if (node?.kind !== 'chooseTargets') return false
      const candidates = targetCandidates(state, frame.source, frame.controller, node.from)
      return d.targets.some((t) => candidates.includes(t))
    })
    if (!anyValid) {
      noLegalTarget(ctx)
      return { ...base, events: ctx.events, cancelled: true, frame: { ...frame, stage } }
    }
  }
  runEffects(ctx, ability.effects, 0, frame.path.length > 0)
  return {
    state: ctx.state, events: ctx.events, pending: ctx.suspend, steps: ctx.steps, cancelled: ctx.cancelled,
    frame: { ...frame, path: ctx.path, chosen: ctx.chosen, modes: ctx.modes, stage, declared: ctx.declared, modesDeclared: ctx.modesDeclared },
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
  const s: GameState = { ...state, phase: 'attack', attack: { step: 'preparation', attackers: [], blocker: null }, priority: player, passes: 0 }
  return [s, [{ type: 'phaseStarted', phase: 'attack', step: 'preparation' }]]
}

/** §10.1.2 Declaration. Reached from preparation, either immediately or once the beginning-of-phase triggers drain. */
export function enterAttackDeclaration(state: GameState, player: PlayerId): [GameState, Event[]] {
  const s: GameState = { ...state, phase: 'attack', attack: { step: 'declaration', attackers: [], blocker: null }, priority: player, passes: 0 }
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

const stackRefOf = (item: StackItem): StackRef =>
  (item.kind === 'summon' ? { kind: 'summon', card: item.card } : { kind: 'ability', source: item.frame.source, abilityId: item.frame.abilityId })

/**
 * Which triggered clause is placed NEXT (rung J1-D4, CR §11.8.7): the turn player's clauses go on first —
 * so the non-turn player's end up on top and resolve first — and within one controller the LAST-triggered
 * is placed first, so the first-triggered ends on top and resolves first, which is the FIFO order the agenda
 * had before the stack existed.
 */
export function nextTriggeredToPlace(state: GameState): Frame | null {
  const q = state.resolution.queue
  if (!q.length) return null
  const ap = state.turnPlayer
  const mine = q.filter((f) => f.controller === ap)
  const pool = mine.length ? mine : q
  return pool[pool.length - 1] ?? null
}

/** Put `frame` (a triggered clause) into its declare stage as the item it will become (rung J1-D3). */
function beginPlacing(state: GameState, frame: Frame, events: Event[]): GameState {
  const steps = state.resolution.steps + 1   // starting a frame is a step too, so a cycle of empty clauses is still capped
  if (steps > MAX_RESOLUTION_STEPS) throw new Error(`resolution exceeded ${MAX_RESOLUTION_STEPS} steps (spec C1-5) — trigger cycle?`)
  const queue = state.resolution.queue.filter((f) => f !== frame)
  const declaring: Frame = { ...frame, stage: 'declare', path: [], chosen: [], declared: [], modesDeclared: false }
  // An ACTIVATED ability announced itself with `abilityActivated` when the player paid for it (spec C3-A7),
  // and a burst with `exBurstUsed`; saying "triggers" as well would report a deliberate move back as
  // something that merely happened.
  if (frame.origin !== 'activated' && frame.origin !== 'exBurst') {
    events.push({ type: 'abilityTriggered', player: frame.controller, card: frame.source, abilityId: frame.abilityId, cause: frame.triggerEvent })
  }
  const item: StackItem = { kind: 'ability', frame: declaring }
  return { ...state, resolution: { ...state.resolution, queue, active: declaring, placing: { item, frameIndex: 0 }, steps } }
}

/** Start resolving the TOP of the stack (rung J1-D9): its first frame runs, or an empty Summon completes at once. */
export function startResolvingTop(state: GameState): GameState {
  const top = state.stack[state.stack.length - 1]
  if (!top) return state
  const frames = top.kind === 'summon' ? top.frames : [top.frame]
  const first = frames[0]
  const active: Frame | null = first ? { ...first, stage: 'resolve', path: [], chosen: [] } : null
  return { ...state, resolution: { ...state.resolution, active, resolvingFrame: 0 } }
}

/** A Summon that has resolved (or been cancelled) leaves the stack for its owner's Break Zone (§11.11.10). */
/**
 * Game over empties the stack (rung J1): nothing may stay waiting once a result is set, exactly as no frame
 * may. A Summon still on it goes to its owner's Break Zone so the card is in a zone (invariant conservation);
 * an ability item is simply dropped. Nothing about the result depends on it — the game has ended.
 */
export function clearStackAtGameOver(state: GameState): GameState {
  const placing = state.resolution.placing?.item
  if (!state.stack.length && placing?.kind !== 'summon') return state
  let s = state
  for (const item of state.stack) if (item.kind === 'summon') s = summonToBreakZone(s, item.card)
  // A Summon still declaring its targets (§11.3.3) is in no zone but `resolution.placing`, which the caller clears:
  // it goes to the Break Zone like a stacked one (J8 second review H2 — it used to vanish).
  if (placing?.kind === 'summon') s = { ...summonToBreakZone(s, placing.card), resolution: { ...s.resolution, placing: null } }
  return { ...s, stack: [] }
}

function summonToBreakZone(state: GameState, card: CardId): GameState {
  const owner = state.cards[card]?.owner ?? 0
  return updatePlayer(state, owner, (ps) => ({ ...ps, breakZone: [...ps.breakZone, card] }))
}

/** The top item is finished: pop it, and hand priority back to the turn player (§11.1.5). */
function finishTopItem(state: GameState, cancelled: boolean, events: Event[]): GameState {
  const top = state.stack[state.stack.length - 1]
  if (!top) return { ...state, resolution: { ...state.resolution, active: null, resolvingFrame: null } }
  let s: GameState = { ...state, stack: state.stack.slice(0, -1), resolution: { ...state.resolution, active: null, resolvingFrame: null }, priority: state.turnPlayer, passes: 0 }
  if (top.kind === 'summon') {
    s = summonToBreakZone(s, top.card)
    if (top.frames.length === 0) events.push({ type: 'summonResolvedNoEffect', card: top.card })
  }
  events.push(cancelled ? { type: 'stackCancelled', item: stackRefOf(top), reason: 'targetsGone' } : { type: 'stackResolved', item: stackRefOf(top) })
  return s
}

/**
 * What a frame's completion means (rung J1-D3/D9):
 *  - a DECLARE-stage frame is one of a placing item's: record it; declare the next, or push the item;
 *  - an EX Burst's declare stage flows straight into its resolve stage — no stack, no window (§11.10.2);
 *  - a RESOLVE-stage frame is the top item's: run its next frame, or pop the item.
 */
function completeActive(state: GameState, r: FrameResult, events: Event[]): GameState {
  const frame = r.frame
  let s: GameState = { ...state, resolution: { ...state.resolution, active: null, steps: r.steps } }
  const stage = frame.stage ?? 'resolve'
  if (frame.origin === 'exBurst') {
    if (stage === 'declare' && !r.cancelled) {
      return { ...s, resolution: { ...s.resolution, active: { ...frame, stage: 'resolve', path: [], chosen: [] } } }
    }
    return s
  }
  if (stage === 'declare') {
    const placing = s.resolution.placing
    if (!placing) return s
    const done: Frame = { ...frame, stage: 'resolve', path: [], chosen: [] }
    if (r.cancelled) {
      // §11.8.4: removed as it is placed. A Summon whose declaration fails goes to the Break Zone unresolved.
      events.push({ type: 'stackCancelled', item: stackRefOf(placing.item), reason: 'noTargetAtPlacement' })
      s = { ...s, resolution: { ...s.resolution, placing: null } }
      return placing.item.kind === 'summon' ? summonToBreakZone(s, placing.item.card) : s
    }
    const item: StackItem = placing.item.kind === 'summon'
      ? { ...placing.item, frames: placing.item.frames.map((f, i) => (i === placing.frameIndex ? done : f)) }
      : { kind: 'ability', frame: done }
    const nextIndex = placing.frameIndex + 1
    const frames = item.kind === 'summon' ? item.frames : [item.frame]
    const next = frames[nextIndex]
    if (next) {
      const declaring: Frame = { ...next, stage: 'declare', path: [], chosen: [], declared: [], modesDeclared: false }
      return { ...s, resolution: { ...s.resolution, active: declaring, placing: { item, frameIndex: nextIndex } } }
    }
    events.push({ type: 'stackPushed', item: stackRefOf(item), controller: item.kind === 'summon' ? item.controller : item.frame.controller })
    return { ...s, stack: [...s.stack, item], resolution: { ...s.resolution, placing: null } }
  }
  // Resolve stage: the top item's frame `resolvingFrame`.
  const idx = s.resolution.resolvingFrame
  const top = s.stack[s.stack.length - 1]
  if (idx === null || !top) return s
  if (r.cancelled) return finishTopItem(s, true, events)
  const frames = top.kind === 'summon' ? top.frames : [top.frame]
  const next = frames[idx + 1]
  if (next) return { ...s, resolution: { ...s.resolution, active: { ...next, stage: 'resolve', path: [], chosen: [] }, resolvingFrame: idx + 1 } }
  return finishTopItem(s, false, events)
}

/**
 * Advance the agenda by exactly ONE frame (rung J1-D2): resume the active frame, or start declaring the next
 * triggered clause, or start the next frame of the item resolving on top of the stack — and then YIELD, so
 * `settle` in apply.ts can run §12.3 rule processes between frames (spec C2-6). It never starts resolving a
 * stack item by itself: that takes both players forfeiting (§11.1.7), which is `applyPass`'s call.
 *
 * Never touches an existing `pending`: the decision already on the table always comes first.
 */
export function advanceAgenda(state: GameState): [GameState, Event[]] {
  const events: Event[] = []
  let s = state
  if (s.result || s.pending) return [s, events]
  if (!s.resolution.active) {
    if (s.resolution.placing) {
      // Between frames of a multi-frame item (a Summon with several clauses): declare the next one.
      const { item, frameIndex } = s.resolution.placing
      const frames = item.kind === 'summon' ? item.frames : [item.frame]
      const next = frames[frameIndex]
      if (!next) return [{ ...s, resolution: { ...s.resolution, placing: null } }, events]
      s = { ...s, resolution: { ...s.resolution, active: { ...next, stage: 'declare', path: [], chosen: [], declared: [], modesDeclared: false } } }
    } else if (s.resolution.resolvingFrame !== null) {
      // An item on top with no frame running: a vanilla Summon, or one whose frames are all done.
      const top = s.stack[s.stack.length - 1]
      const frames = top ? (top.kind === 'summon' ? top.frames : [top.frame]) : []
      const next = frames[s.resolution.resolvingFrame]
      if (!next) return [finishTopItem(s, false, events), events]
      s = { ...s, resolution: { ...s.resolution, active: { ...next, stage: 'resolve', path: [], chosen: [] } } }
    } else {
      const next = nextTriggeredToPlace(s)
      if (!next) return [s, events]
      s = beginPlacing(s, next, events)
    }
  }
  const frame = s.resolution.active as Frame
  const r = runFrame(s, frame)
  s = r.state
  events.push(...r.events)
  if (r.pending) return [{ ...s, pending: r.pending, resolution: { ...s.resolution, active: r.frame, steps: r.steps } }, events]
  return [completeActive(s, r, events), events]
}

/**
 * Resolve EVERYTHING now, with no priority windows: place every triggered clause, and resolve the stack top
 * to bottom, until a player must choose or nothing is left. This is what "immediate resolution" was before
 * rung J1, kept for the tests written in that world and for anything that must not stop at a window.
 */
export function drainResolution(state: GameState): [GameState, Event[]] {
  const events: Event[] = []
  let s = state
  for (let guard = 0; guard < MAX_RESOLUTION_STEPS * 4; guard++) {
    if (s.result || s.pending) break
    if (!s.resolution.active) {
      // Rule processes between frames, exactly as `settle` runs them (spec C2-6).
      const [ruled, ruleEvents] = runRuleProcessesRef(s)
      s = ruled; events.push(...ruleEvents)
      if (s.result) break
    }
    if (!hasResolutionWork(s.resolution)) {
      if (!s.stack.length) break
      s = startResolvingTop(s)
    }
    const [t, e] = advanceAgenda(s)
    s = t; events.push(...e)
  }
  // `steps` is deliberately NOT reset here: a caller driving a cycle through this sees it accumulate and hit
  // the cap (spec C1-5), exactly as `settle` would. `settle` is the one place the epoch ends (J1-D12).
  if (s.result) s = { ...s, resolution: EMPTY_RESOLUTION }
  return [s, events]
}

/**
 * `runRuleProcesses` lives in rules.ts, which imports this module — so it is reached through a late binding
 * that rules.ts installs at load, rather than an import that would be a runtime cycle.
 */
let runRuleProcessesRef: (state: GameState) => [GameState, Event[]] = () => { throw new Error('rules.ts has not registered runRuleProcesses') }
export function registerRuleProcesses(fn: (state: GameState) => [GameState, Event[]]): void { runRuleProcessesRef = fn }

// ---------------------------------------------------------------------------
// Answering a suspended choice
// ---------------------------------------------------------------------------

function suspendedNode(state: GameState): { frame: Frame; node: Effect } {
  const frame = state.resolution.active
  if (!frame) throw new IllegalCommandError('no ability is waiting for an answer')
  const ability = abilityOf(state, frame)
  if (!ability) throw new IllegalCommandError('the waiting ability no longer exists')
  // `apply` re-derives its candidates from the node HERE rather than trusting `state.pending`, which is only
  // a projection of it (spec C1-6). Shared with the AI and the browser; see `effectAtPath`.
  const node = effectAtPath(ability.effects, frame.path, frame.modes)
  if (!node) throw new IllegalCommandError('the waiting ability has no effect at its program counter')
  return { frame, node }
}

/**
 * Queue every `observesChosen` clause on the cards a choice just fixed (spec C11, rung J1-D7) — Prishe's
 * "when Prishe is chosen by a Summon or an ability, Prishe gains +2000 power until the end of the turn".
 *
 * A TRIGGER, placed ABOVE the choosing item. The clause lands before the choosing ability resolves — that is
 * the whole card: a Summon choosing a 5000 Prishe and dealing 5000 kills her unless the +2000 arrives first
 * — and with declaration at placement (J1-D3) the choice is fixed while the chooser is still on the stack, so
 * the pump goes on top and resolves first (§11.8.7). That is the CR ordering; C11's inline marker is retired.
 *
 * The effects run through the REAL executor with the chosen card bound as `chosen` (the `chosen` trigger
 * event), so the AST decides what happens — hand-writing the power change would bypass `addPower`, the
 * engine's single power-modifying authority, and let the card's text and the code drift apart.
 */
export function dispatchChosenTriggers(state: GameState, chosen: readonly CardId[], by: CardId, byController: PlayerId): GameState {
  let s = state
  for (const id of chosen) {
    const loc = findFieldCard(s, id)
    if (!loc) continue   // only a card ON THE FIELD can be pumped; a Break Zone target has no FieldCard
    for (const ability of defOf(s, id).abilities ?? []) {
      if (ability.trigger.kind !== 'observesChosen') continue
      // The controller is whoever's field the chosen card is on — NOT whoever did the choosing (CR §11.8.5).
      s = enqueueTrigger(s, id, loc.owner, ability, { kind: 'chosen', card: id, by, byController })
    }
  }
  return s
}

/**
 * Why a `chooseTargets` answer would be refused, or null (rung J7-D1): the exact test `applyChooseTargets`
 * runs, exported so the browser's picker can validate a set it built card by card without `legalCommands`
 * having enumerated it.
 */
export function chooseTargetsCheck(state: GameState, player: PlayerId, targets: readonly CardId[]): string | null {
  if (state.result) return 'game is over'
  if (state.pending?.kind !== 'chooseTargets' || state.pending.player !== player) return 'no target choice owed by this player'
  const frame = state.resolution.active
  if (!frame) return 'no ability is waiting for an answer'
  const ability = abilityOf(state, frame)
  if (!ability) return 'the waiting ability no longer exists'
  const node = effectAtPath(ability.effects, frame.path, frame.modes)
  if (!node || node.kind !== 'chooseTargets') return 'the waiting ability is not choosing targets'
  if (new Set(targets).size !== targets.length) return 'duplicate target'
  const candidates = targetCandidates(state, frame.source, frame.controller, node.from)
  const max = Math.min(node.max, candidates.length)
  if (targets.length < node.min || targets.length > max) return `choose ${node.min}..${max} targets, got ${targets.length}`
  for (const id of targets) if (!candidates.includes(id)) return `${id} is not a legal target`
  return null
}

export function applyChooseTargets(state: GameState, player: PlayerId, targets: readonly CardId[]): [GameState, Event[]] {
  const why = chooseTargetsCheck(state, player, targets)
  if (why) throw new IllegalCommandError(why)
  const { frame, node } = suspendedNode(state)
  // Extending the path by one level says "the choice at this node is made" — resume runs `then`, not the prompt.
  const active: Frame = { ...frame, chosen: [...targets], path: [...frame.path, 0] }
  // "When <this> is chosen" triggers HERE (spec C11, rung J1-D7) and is placed above the choosing item — but not
  // for a SELECT, which is not a choice (§11.3.3, rung V1-A2).
  const selected = node.kind === 'chooseTargets' && node.select !== undefined
  const after = selected ? state : dispatchChosenTriggers(state, targets, frame.source, frame.controller)
  return [{ ...after, pending: null, resolution: { ...after.resolution, active } }, []]
}

/**
 * Which of the exposed positions this pending's filter allows, computed from the deck the caller actually has.
 *
 * ONE implementation on purpose. It runs on the real state for `legalCommands` and `applyChooseFromDeck`, and
 * on each determinised state inside the search — and because it reads that state's own deck, a sampled world
 * answers the question about the cards IT holds. The resolved index list used to travel on the pending
 * instead, which meant the search enumerated positions computed against a deck it was not looking at.
 */
export function deckPickCandidates(state: GameState, pending: Extract<Pending, { kind: 'chooseFromDeck' }>): number[] {
  const source = state.resolution.active?.source
  const exposed = state.players[pending.player].deck.slice(0, pending.count)
  const out: number[] = []
  exposed.forEach((id, i) => { if (matchesFilter(state, source ?? id, id, pending.filter)) out.push(i) })
  return out
}

/**
 * Answer a `chooseFromDeck` with INDICES (spec C9-1).
 *
 * The index is what keeps this world-independent: the same command is legal in every determinisation, and
 * which card index 2 names is whatever that world sampled. Eligibility is recomputed here from the deck the
 * caller holds — the pending carries the printed FILTER, never a resolved index list, which is what stopped
 * it leaking a private search's deck positions to the opponent.
 */
export function applyChooseFromDeck(state: GameState, player: PlayerId, picks: readonly number[]): [GameState, Event[]] {
  const pending = state.pending
  if (pending?.kind !== 'chooseFromDeck' || pending.player !== player) throw new IllegalCommandError('no deck choice owed by this player')
  if (new Set(picks).size !== picks.length) throw new IllegalCommandError('duplicate pick')
  if (picks.length < pending.min || picks.length > pending.max) throw new IllegalCommandError(`choose ${pending.min}..${pending.max} cards, got ${picks.length}`)
  for (const i of picks) {
    if (!Number.isInteger(i) || i < 0 || i >= pending.count) throw new IllegalCommandError(`${i} is not one of the exposed cards`)
  }
  const eligible = deckPickCandidates(state, pending)
  for (const i of picks) {
    if (!eligible.includes(i)) throw new IllegalCommandError(`${i} is not a legal choice here`)
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
 * MVP0-SIMPLIFICATION (narrowed by rung J1-D4): the non-turn player's triggers ARE placed on top of the turn
 * player's now (§11.8.7); what stays fixed is the order WITHIN one controller's simultaneous triggers — this
 * key, rather than a choice the controller makes. None of this pool's clauses has an outcome-sensitive
 * same-controller conflict, so it is unobservable — but it is a deviation.
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
/** Queue every implemented clause with this trigger kind, in printed order — to the triggered list, placed on the stack at the next priority grant (rung J1-D2). */
export function dispatchTrigger(state: GameState, def: CardDef, card: CardId, controller: PlayerId, kind: AbilityTrigger['kind']): GameState {
  let s = state
  for (const ability of def.abilities ?? []) if (ability.trigger.kind === kind) s = enqueueTrigger(s, card, controller, ability)
  return s
}

/**
 * Coverage is per CLAUSE (spec C1-9). A card with an AST for 1 of its 3 printed clauses must still warn about
 * the other 2, so the log stays honest about what the player is actually getting. `clauses` is omitted when
 * nothing at all is implemented — the vanilla-pool log line keeps the shape it has had since rung A.
 */
export function warnUnimplemented(def: CardDef, card: CardId, events: Event[]): void {
  const missing = unimplementedClauseCount(def)
  if (missing === 0) return
  const implemented = def.abilities?.length ?? 0
  if (implemented === 0) events.push({ type: 'unimplementedAbility', card, code: def.code })
  else events.push({ type: 'unimplementedAbility', card, code: def.code, clauses: missing })
}

/**
 * Put a Character onto the field and run everything that arrival owes, whatever brought it there.
 *
 * The caller has already removed the card from wherever it came from (hand, for a cast; deck, for C9's Hugh
 * Yurg search) and pushed its own event for that. This does the rest, and it does it in ONE place on purpose:
 * a search that grew its own copy of "place, warn, dispatch, notify watchers" would drift from casting exactly
 * the way `breakCard` drifted from the zone-change dispatch and silently missed ~40% of the breaks its printed
 * text named. Whatever an arrival owes, it owes here.
 */
export function putOntoField(state: GameState, card: CardId, controller: PlayerId, events: Event[]): GameState {
  // Entry by ABILITY is not checked against the field limits, on purpose (§7.7.3/§12.4.6, spec C9, rung J4):
  // the CR prohibits the ACTION that would deploy a duplicate, not an effect doing so. Hugh Yurg may search
  // out a second Undead Princess while one is on the field; the §12.4.6 rule process then puts every copy of
  // that name into the Break Zone (rules.ts). Refusing the pick would quietly change what the text can find.
  const def = defOf(state, card)
  const fc: FieldCard = {
    id: card, status: def.type === 'backup' ? 'dull' : 'active', damage: 0,
    // A FRESH instance, so `usedThisTurn` starts empty: under CR §7.4 a card entering a zone is a new
    // object, and a `oncePerTurn` ability spent before it left the field is spendable again now (C10-1).
    enteredTurn: state.turn, attackedThisTurn: false, granted: [], powerBonus: 0, flags: [], usedThisTurn: [],
  }
  let s = updatePlayer(state, controller, (ps) => ({
    ...ps,
    forwards: def.type === 'forward' ? [...ps.forwards, fc] : ps.forwards,
    backups: def.type === 'backup' ? [...ps.backups, fc] : ps.backups,
  }))
  warnUnimplemented(def, card, events)
  // The entering card's own clauses first (`enterField`, not `cast` — Hugh Yurg's search never casts anything,
  // spec C1-2), then the cards WATCHING an arrival (spec C8-1). A card that both has an ETB and is watched
  // resolves them in that order: the CR gives simultaneous triggers to the active player to order, and MVP0
  // gives them queue order (spec C1-4/C8-4).
  s = dispatchTrigger(s, def, card, controller, 'enterField')
  return enqueueEnterFieldTriggers(s, card, controller)
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
  return enqueueZoneTriggers(recordBreakZoneArrivals(post, transitions), collectWatchers(pre, transitions))
}

/**
 * Remember that these cards reached a Break Zone FROM THE FIELD this turn (spec C10-2) — Sphene's retrieve.
 *
 * Here, and not at each call site, for the reason the function above exists at all: every field → Break Zone
 * path already funnels through it, and the one that once did not silently lost ~40% of its observer triggers.
 * A future path that forgets this loses its triggers too, which is a loud and already-guarded failure rather
 * than a quiet wrong answer.
 *
 * Keyed by OWNER, not controller: §7.10 puts a broken card in its owner's Break Zone, and "your Break Zone"
 * means the one it is actually in. They coincide for this pool — nothing here changes control — so the
 * distinction is unobservable today and is made anyway, because the moment it matters it would be silent.
 *
 * Cause-agnostic: a card paid there as a COST is not a break (CR §15.1.1.3.2) but the printed text says
 * "put in your Break Zone from the field", which admits it.
 */
function recordBreakZoneArrivals(state: GameState, transitions: readonly ZoneTransition[]): GameState {
  let s = state
  for (const p of [0, 1] as const) {
    const arrived = transitions.filter((t) => t.owner === p).map((t) => t.card)
    if (!arrived.length) continue
    s = updatePlayer(s, p, (ps) => ({
      ...ps,
      putIntoBreakZoneFromFieldThisTurn: [...ps.putIntoBreakZoneFromFieldThisTurn, ...arrived.filter((id) => !ps.putIntoBreakZoneFromFieldThisTurn.includes(id))],
    }))
  }
  return s
}

/**
 * Forget a card that has LEFT a Break Zone (spec C10-2). Not bookkeeping: a card that goes Break Zone → hand
 * → Break Zone within one turn is a NEW object in the destination zone under CR §7.4, and must not still be
 * retrievable. It is also what keeps `checkInvariants`' "every tracked id is in that Break Zone" true, which
 * a successful retrieve would otherwise break the instant it worked.
 */
export function forgetBreakZoneArrivals(state: GameState, ids: readonly CardId[]): GameState {
  let s = state
  for (const p of [0, 1] as const) {
    const ps = s.players[p]
    if (!ps.putIntoBreakZoneFromFieldThisTurn.some((id) => ids.includes(id))) continue
    s = updatePlayer(s, p, (q) => ({
      ...q,
      putIntoBreakZoneFromFieldThisTurn: q.putIntoBreakZoneFromFieldThisTurn.filter((id) => !ids.includes(id)),
    }))
  }
  return s
}
