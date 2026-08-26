import type { Ability } from './abilities.js'

export type PlayerId = 0 | 1
export const ELEMENTS = ['fire', 'ice', 'wind', 'earth', 'lightning', 'water', 'light', 'dark'] as const
export type Element = (typeof ELEMENTS)[number]
export type CardType = 'forward' | 'backup' | 'summon' | 'monster'
export const KEYWORDS = ['haste', 'brave', 'firstStrike', 'backAttack'] as const
export type Keyword = (typeof KEYWORDS)[number]
export interface CardDef {
  code: string; name: string; type: CardType; elements: Element[]; cost: number
  power: number | null; keywords: Keyword[]; generic: boolean; exBurst: boolean
  text: string; hasAbilities: boolean
  /**
   * The implemented clauses, as data (spec C1-1/C1-2). Lives here and not in an injected registry because
   * `defs` is the one card-definition channel `viewFor` and `determinise` both already carry — see abilities.ts.
   */
  abilities?: readonly Ability[]
  /**
   * How many separate ability clauses `text` prints. Coverage is per CLAUSE (spec C1-9): `abilities` implements
   * some subset of these, and the rest keep warning. Absent means "unknown" — treated as `hasAbilities ? 1 : 0`.
   */
  abilityClauses?: number
}
export function opponentOf(p: PlayerId): PlayerId { return p === 0 ? 1 : 0 }
