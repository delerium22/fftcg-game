import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_ITERATIONS } from '@fftcg/ai'
import { loadCards } from '@fftcg/cards'
import type { AgentSpec } from './agents.js'
import { MAX_ITERATIONS, parseAgentSpec, parseDepth, parseIterations, parsePositiveInt } from './agents.js'
import { parseDeckFile } from './deck.js'
import { hotseat } from './hotseat.js'
import { mirrorTournament } from './mirror.js'
import { selfPlay } from './selfplay.js'
import { deckOrder } from './deckorder.js'

// repo root, not process.cwd() — `pnpm --filter @fftcg/cli <script>` runs with cwd set to apps/cli,
// so the default deck path must be anchored to this file's location rather than the invocation cwd.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

const [, , cmd, ...rest] = process.argv
const flag = (name: string, dflt: string) => { const i = rest.indexOf(`--${name}`); return i >= 0 && rest[i + 1] ? (rest[i + 1] as string) : dflt }
const has = (name: string) => rest.includes(`--${name}`)
const deckArg = flag('deck', '')
const deckPath = deckArg ? resolve(deckArg) : resolve(repoRoot, 'decks/starter-2025-vol2.txt')
const deck = parseDeckFile(readFileSync(deckPath, 'utf8'))
const defs = loadCards()
const seed = Number(flag('seed', '1'))

/**
 * Applies `--depth`/`--iterations` to a BARE spec (no explicit `:N`); an explicit suffix always wins. The
 * iteration default is the SEARCH's `DEFAULT_ITERATIONS`, not a number this CLI invented — a bare `ismcts`
 * must run the budget its own defaults describe, and resolving it here means `describeAgentSpec` labels the
 * run with the budget that actually produced its ms/decision (D-A4) instead of a bare "ismcts".
 */
function withDefaults(spec: AgentSpec, depth: 0 | 1 | 2, iterations: number): AgentSpec {
  if (spec.kind === 'greedy' && spec.depth === undefined) return { kind: 'greedy', depth }
  if (spec.kind === 'ismcts' && spec.iterations === undefined) return { kind: 'ismcts', iterations }
  return spec
}

const usage = [
  'usage: <hotseat|selfplay|mirror|deckorder> [options]',
  '  agent spec: random | greedy[:0-2] | ismcts[:N]',
  '  selfplay: [--seed N] [--games N] [--p0 spec] [--p1 spec] [--depth 0-2] [--iterations N] [--fast]',
  '  mirror:   [--seed N] [--pairs N] [--a spec] [--b spec] [--depth 0-2] [--iterations N] [--bootstrap N] [--fast]',
  '            plays every seed twice with the seats swapped; every score is agent A\'s (spec D-A1)',
  '  common:   [--deck path]',
].join('\n')

/** Every flag is validated the same strict way (a bad value is an error, never a silent `NaN`); a throw from
 *  any of them prints the usage and exits 2 rather than dumping a stack. */
function parsed<T>(f: () => T): T {
  try { return f() } catch (e) { console.error(`${e instanceof Error ? e.message : String(e)}\n\n${usage}`); process.exit(2) }
}

if (cmd === 'hotseat') {
  await hotseat({ seed, decks: [deck, deck], defs })
} else if (cmd === 'selfplay' || cmd === 'mirror') {
  // C7: --depth gets the same 0-2 integer validation as greedy:N, instead of `Number(...)` silently coercing
  // any garbage input (including NaN) into the 0|1|2 type. D1: --iterations likewise, for ismcts:N.
  const depth = parsed(() => parseDepth(flag('depth', '1')))
  const iterations = parsed(() => parseIterations(flag('iterations', String(DEFAULT_ITERATIONS))))
  if (cmd === 'selfplay') {
    const agents: [AgentSpec, AgentSpec] = parsed(() => [
      withDefaults(parseAgentSpec(flag('p0', 'random')), depth, iterations),
      withDefaults(parseAgentSpec(flag('p1', 'random')), depth, iterations),
    ])
    const games = parsed(() => parsePositiveInt(flag('games', '200'), 'games', 1_000_000))
    const r = selfPlay({ games, seed, decks: [deck, deck], defs, agents, strict: !has('fast') })
    console.log(JSON.stringify({ ...r, failures: r.failures.map((f) => ({ seed: f.seed, error: f.error.split('\n')[0] })) }, null, 2))
    for (const f of r.failures) console.error(`seed ${f.seed}:\n${f.error}`)
    process.exit(r.failures.length ? 1 : 0)
  }
  const agents: [AgentSpec, AgentSpec] = parsed(() => [
    withDefaults(parseAgentSpec(flag('a', 'ismcts')), depth, iterations),
    withDefaults(parseAgentSpec(flag('b', 'greedy')), depth, iterations),
  ])
  const pairs = parsed(() => parsePositiveInt(flag('pairs', '200'), 'pairs', 1_000_000))
  const bootstrapSamples = parsed(() => parsePositiveInt(flag('bootstrap', '2000'), 'bootstrap', MAX_ITERATIONS))
  const r = mirrorTournament({ pairs, seed, decks: [deck, deck], defs, agents, strict: !has('fast'), bootstrapSamples })
  // `results` is one row per game — useful in a file, noise on a terminal. `JSON.stringify` drops undefined
  // properties, so this is how the summary omits it. The aggregates are the report.
  const summary = { ...r, results: undefined, failures: r.failures.map((f) => ({ seed: f.seed, seatOfA: f.seatOfA, error: f.error.split('\n')[0] })) }
  console.log(JSON.stringify(summary, null, 2))
  for (const f of r.failures) console.error(`seed ${f.seed} (A at seat ${f.seatOfA}):\n${f.error}`)
  process.exit(r.failures.length ? 1 : 0)
} else if (cmd === 'deckorder') {
  console.log(deckOrder({ seed, decks: [deck, deck], defs }))
} else {
  console.error(usage)
  process.exit(2)
}
