export type PlayerId = 0 | 1
export const ELEMENTS = ['fire', 'ice', 'wind', 'earth', 'lightning', 'water', 'light', 'dark'] as const
export type Element = (typeof ELEMENTS)[number]
export type CardType = 'forward' | 'backup' | 'summon' | 'monster'
export type Keyword = 'haste' | 'brave' | 'firstStrike' | 'backAttack'
export interface CardDef {
  code: string; name: string; type: CardType; elements: Element[]; cost: number
  power: number | null; keywords: Keyword[]; generic: boolean; exBurst: boolean
  text: string; hasAbilities: boolean
}
export function opponentOf(p: PlayerId): PlayerId { return p === 0 ? 1 : 0 }
