import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CardDef } from '@fftcg/engine'

const here = dirname(fileURLToPath(import.meta.url))

export function loadCards(): CardDef[] {
  return JSON.parse(readFileSync(join(here, '..', 'data', 'cards.json'), 'utf8')) as CardDef[]
}

export function cardDb(): Map<string, CardDef> {
  return new Map(loadCards().map((c) => [c.code, c]))
}
