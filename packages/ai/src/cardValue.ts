import type { CardDef } from '@fftcg/engine'

export function cardValue(def: CardDef): number {
  switch (def.type) {
    case 'forward': return (def.power ?? 0) / 1000 + 1.5 + (def.cost >= 5 ? 0.5 : 0)
    case 'backup': return 3.5 - def.cost * 0.15
    case 'summon': return 1
    case 'monster': return 1
  }
}
