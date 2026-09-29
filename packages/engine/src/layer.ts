import type { PlayerId } from './types.js'
import type { CardDef, Keyword } from './types.js'
import { opponentOf } from './types.js'
import type { FieldCard, GameState, CardId } from './state.js'
import type { Amount, ContinuousStatic, DefFilter, FieldFlag, StaticCondition } from './abilities.js'
import { CONTINUOUS_STATIC_KINDS } from './abilities.js'
import { matchesDefFilter } from './filters.js'

/**
 * The continuous-effect LAYER (rung J6, CR §11.12.4.4–5): what the field abilities in play add to a card's
 * power, keywords and flags right now. Read only through `effectivePower`, `keywordsOf` and `flagsOf`
 * (state.ts), which union it with the stamps single effects leave on a `FieldCard` (§11.12.4.2).
 *
 * No state memo: states are cloned by views, determinisations and the worker, and the exported `GameState`
 * is mutable. Instead the set of codes carrying a continuous static is memoised per `defs` OBJECT (shared by
 * every state of a game and every determinisation; a view clones it, and recomputing over a few dozen
 * definitions is nothing), and a reader scans the two fields — a handful of cards — for members of that set.
 * With none on either field a reader does no filter matching at all (spec J6-A5).
 *
 * This module imports nothing from state.ts (which imports it): the two helpers it needs are inlined.
 */

type Defs = GameState['defs']
const memo = new WeakMap<Defs, ReadonlySet<string>>()

/** The codes whose definition carries at least one continuous static. */
export function continuousStatics(defs: Defs): ReadonlySet<string> {
  const hit = memo.get(defs)
  if (hit) return hit
  const out = new Set<string>()
  for (const def of Object.values(defs)) {
    for (const a of def.abilities ?? []) {
      if (a.trigger.kind === 'static' && (CONTINUOUS_STATIC_KINDS as readonly string[]).includes(a.trigger.effect.kind)) { out.add(def.code); break }
    }
  }
  memo.set(defs, out)
  return out
}

/** The layer's contribution to one card. `power` is a delta; the sets are what the layer GRANTS. */
export interface LayerContribution { readonly power: number; readonly keywords: readonly Keyword[]; readonly flags: readonly FieldFlag[] }
const NOTHING: LayerContribution = { power: 0, keywords: [], flags: [] }

const defOfId = (state: GameState, id: CardId): CardDef | undefined => { const inst = state.cards[id]; return inst ? state.defs[inst.code] : undefined }

/**
 * How many Characters (Forwards and Backups) on `player`'s field match `filter` by DEFINITION (rung V1-A1) — the
 * count behind `controlsAtLeast` and counted amounts. Definition-only on purpose: the layer asks this while it is
 * computing keywords and power, and an instance axis here would make it read its own output (spec V1-D6).
 */
export function countControlled(state: GameState, player: PlayerId, filter: DefFilter | undefined): number {
  const ps = state.players[player]
  let n = 0
  for (const c of [...ps.forwards, ...ps.backups]) {
    const d = defOfId(state, c.id)
    if (d !== undefined && matchesDefFilter(d, filter)) n++
  }
  return n
}

/** An `Amount` as a number now, for `controller` (rung V1-A1, spec V1-D7): a printed number, or `times` per counted Character. */
export function amountOf(state: GameState, controller: PlayerId, amount: Amount): number {
  if (typeof amount === 'number') return amount
  const side = amount.per.controller === 'self' ? controller : opponentOf(controller)
  return amount.times * countControlled(state, side, amount.per.filter)
}

/**
 * Whether a static's condition holds, from a SOURCE-aware context (rung J6-D5): `controller` is the card's
 * controller (the caster, for a cost reduction read in hand). Exhaustive by construction, as before.
 */
export function staticApplies(ctx: { state: GameState; source: CardId | null; controller: PlayerId }, when: StaticCondition | undefined): boolean {
  if (!when) return true
  const conditions: { readonly [K in StaticCondition['kind']]: (w: Extract<StaticCondition, { kind: K }>) => boolean } = {
    // §9.4 — damage is received by a PLAYER, and "you have received" is the controller, never the opponent.
    damageReceived: (w) => ctx.state.players[ctx.controller].damageZone.length >= w.atLeast,
    // Relative to the ability's controller; never reads `ctx.source`, which is null for a cost reduction read in hand.
    controlsAtLeast: (w) => countControlled(ctx.state, w.controller === 'self' ? ctx.controller : opponentOf(ctx.controller), w.filter) >= w.count,
  }
  return conditions[when.kind](when as never)
}

/** What the field abilities in play add to `card`, which sits on `controller`'s field. */
export function layerFor(state: GameState, card: FieldCard, controller: PlayerId): LayerContribution {
  const sources = continuousStatics(state.defs)
  if (sources.size === 0) return NOTHING
  const targetDef = defOfId(state, card.id)
  if (!targetDef) return NOTHING
  let power = 0
  const keywords: Keyword[] = []
  const flags: FieldFlag[] = []
  let any = false
  for (const p of [0, 1] as const) {
    const ps = state.players[p]
    for (const src of [...ps.forwards, ...ps.backups]) {
      const srcInst = state.cards[src.id]
      if (!srcInst || !sources.has(srcInst.code)) continue
      const srcDef = state.defs[srcInst.code]
      for (const a of srcDef?.abilities ?? []) {
        if (a.trigger.kind !== 'static') continue
        const eff = a.trigger.effect as ContinuousStatic
        if (!(CONTINUOUS_STATIC_KINDS as readonly string[]).includes(eff.kind)) continue
        // Scope: whose field, relative to the SOURCE's controller (§11.12.4.4 — the source must be in play).
        const to = eff.to
        if (to.controller === 'self' && controller !== p) continue
        if (to.controller === 'opponent' && controller === p) continue
        if (to.excludeSource && src.id === card.id) continue
        if (to.self && src.id !== card.id) continue   // "<this card> gains …" (rung V1-A1)
        if (to.filter && !matchesDefFilter(targetDef, to.filter)) continue
        if (!staticApplies({ state, source: src.id, controller: p }, eff.when)) continue
        any = true
        if (eff.kind === 'modifyPower') power += eff.amount
        else if (eff.kind === 'grantKeyword') { if (!keywords.includes(eff.keyword)) keywords.push(eff.keyword) }
        else if (!flags.includes(eff.flag)) flags.push(eff.flag)
      }
    }
  }
  return any ? { power, keywords, flags } : NOTHING
}
