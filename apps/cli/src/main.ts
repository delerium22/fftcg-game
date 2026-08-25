import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadCards } from '@fftcg/cards'
import { parseDeckFile } from './deck.js'
import { hotseat } from './hotseat.js'
import { selfPlay } from './selfplay.js'
import { deckOrder } from './deckorder.js'

// repo root, not process.cwd() — `pnpm --filter @fftcg/cli <script>` runs with cwd set to apps/cli,
// so the default deck path must be anchored to this file's location rather than the invocation cwd.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

const [, , cmd, ...rest] = process.argv
const flag = (name: string, dflt: string) => { const i = rest.indexOf(`--${name}`); return i >= 0 && rest[i + 1] ? (rest[i + 1] as string) : dflt }
const deckArg = flag('deck', '')
const deckPath = deckArg ? resolve(deckArg) : resolve(repoRoot, 'decks/starter-2025-vol2.txt')
const deck = parseDeckFile(readFileSync(deckPath, 'utf8'))
const defs = loadCards()
const seed = Number(flag('seed', '1'))

if (cmd === 'hotseat') {
  await hotseat({ seed, decks: [deck, deck], defs })
} else if (cmd === 'selfplay') {
  const r = selfPlay({ games: Number(flag('games', '200')), seed, decks: [deck, deck], defs })
  console.log(JSON.stringify({ ...r, failures: r.failures.map((f) => ({ seed: f.seed, error: f.error.split('\n')[0] })) }, null, 2))
  for (const f of r.failures) console.error(`seed ${f.seed}:\n${f.error}`)
  process.exit(r.failures.length ? 1 : 0)
} else if (cmd === 'deckorder') {
  console.log(deckOrder({ seed, decks: [deck, deck], defs }))
} else {
  console.error('usage: <hotseat|selfplay|deckorder> [--seed N] [--games N] [--deck path]')
  process.exit(2)
}
