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
  /**
   * Clauses that are deliberately NOT implemented because, in this card pool, they cannot do anything — so
   * warning about them tells the player something was lost when nothing was.
   *
   * Found by playing: Sphene prints "all cards in your Break Zone cannot be removed from the game by your
   * opponent's Summons or abilities", and the pool has no way to remove a card from anyone's Break Zone —
   * `Effect` has no removal member at all, and the only removal in the engine is the `selfRemoveFromGame`
   * COST, which a card pays out of its OWN Break Zone. So the clause protects against something unreachable,
   * and the log warned in every game Sphene was cast.
   *
   * This is a claim about the POOL, not about the card, so it is checked rather than trusted: the cards
   * package proves each entry inert and fails if the pool ever gains the effect that would make it matter.
   * A warning that cries wolf is worse than no warning, because the EX Burst ones are real.
   */
  inertClauses?: number
}
export function opponentOf(p: PlayerId): PlayerId { return p === 0 ? 1 : 0 }
