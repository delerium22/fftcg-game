import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CardDef } from '@fftcg/engine'
import { withAbilities } from './abilities.js'

const here = dirname(fileURLToPath(import.meta.url))

/**
 * `data/cards.json` is machine-owned — `scripts/fetch-cards.ts` regenerates it — so the hand-written
 * ability ASTs are merged on here from `src/abilities.ts` rather than stored in it (spec C1-1/C1-2).
 * Every consumer must go through this (or `withAbilities` directly) or it plays a vanilla game.
 */
export function loadCards(): CardDef[] {
  return withAbilities(JSON.parse(readFileSync(join(here, '..', 'data', 'cards.json'), 'utf8')) as CardDef[])
}

export function cardDb(): Map<string, CardDef> {
  return new Map(loadCards().map((c) => [c.code, c]))
}

export { parseDeckFile } from './deck.js'
export { ABILITIES, ABILITY_CLAUSES, withAbilities } from './abilities.js'
