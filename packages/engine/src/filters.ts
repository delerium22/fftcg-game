import type { CardDef } from './types.js'
import type { TargetFilter } from './abilities.js'

/**
 * The definition-only half of target filtering (rung J5), in a module below `state.ts` so the continuous-
 * effect layer (rung J6, layer.ts) can ask it without an import cycle: layer → filters → types. `resolve.ts`
 * re-exports it for every existing importer.
 */
/**
 * The half of a `TargetFilter` that depends only on the card's DEFINITION, split out so the search's decoder
 * can ask the same question of a `PlayerView` (spec C9). The other half — `excludeSource`/`excludeSourceName`
 * — needs the source instance and stays in `matchesFilter`, which delegates here rather than restating this.
 */
export function matchesDefFilter(def: CardDef, filter: TargetFilter | undefined, instanceAxesElsewhere = false): boolean {
  if (!filter) return true
  // Rung V1-A3 (R1): a resolved axis must have been replaced by the executor. Checked before the instance-axes
  // return below, so `matchesFilter` (which passes `true`) cannot skip it and fail open.
  if (filter.sameElementAsChosen !== undefined) throw new Error('sameElementAsChosen reached a filter unresolved; the executor resolves it into elementIn')
  if (filter.type !== undefined && def.type !== filter.type) return false
  // "Character" is Forward, Backup OR Monster and never Summon (§7.2), which a single `type` cannot say — both
  // Prishe's and Luso's Break-Zone retrievals need it (spec C2-9). `type` and `types` conjoin: a filter carrying
  // both must satisfy both.
  if (filter.types !== undefined && !filter.types.includes(def.type)) return false
  if (filter.element !== undefined && !def.elements.includes(filter.element)) return false
  if (filter.maxCost !== undefined && def.cost > filter.maxCost) return false
  // EXACT, not a ceiling: a cost-3 Forward must not satisfy Hugh Yurg's "of cost 1" (spec C8-3).
  if (filter.cost !== undefined && def.cost !== filter.cost) return false
  // Rung J5. An unknown job or category (the patched exclusives) matches nothing: `undefined !== 'Dragoon'`.
  // Rung V1-A3 (spec V1-D12): SE writes a multi-job card as `"Princess/Warrior"`, so the filter's job must be ONE of
  // the slash-separated jobs, exactly — "Warrior" is not "Warrior of Light".
  if (filter.job !== undefined && !(def.job ?? '').split('/').map((j) => j.trim()).includes(filter.job)) return false
  if (filter.elementIn !== undefined && !def.elements.some((e) => filter.elementIn?.includes(e))) return false
  if (filter.anyOf !== undefined && !filter.anyOf.some((member) => matchesDefFilter(def, member))) return false
  if (filter.category !== undefined && !(def.categories ?? []).includes(filter.category)) return false
  if (filter.name !== undefined && def.name !== filter.name) return false
  if (filter.keyword !== undefined && !def.keywords.includes(filter.keyword)) return false
  // The power bounds are INSTANCE axes (`matchesFilter` reads the field); off the field the printing is all
  // there is, and a Summon or Backup (no power) satisfies no bound. `matchesFilter` answers them itself and
  // says so with the flag — no filter is copied per candidate on the engine's hottest path.
  if (instanceAxesElsewhere) return true
  if (filter.minPower !== undefined && (def.power === null || def.power < filter.minPower)) return false
  if (filter.maxPower !== undefined && (def.power === null || def.power > filter.maxPower)) return false
  if (filter.grantedKeyword !== undefined && !def.keywords.includes(filter.grantedKeyword)) return false
  // `status` is a fact about a FieldCard: off the field there is none, so it matches nothing.
  if (filter.status !== undefined) return false
  return true
}

