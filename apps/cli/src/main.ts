import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_ITERATIONS } from '@fftcg/ai'
import { loadCards } from '@fftcg/cards'
import { profileSearch } from './profile.js'
import type { AgentSpec } from './agents.js'
import { MAX_ITERATIONS, parseAgentSpec, parseDepth, parseIterations, parsePositiveInt, parseRolloutCap } from './agents.js'
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
/**
 * `--seed` is validated as strictly as `--depth` and `--iterations`. It was the one flag that was not, and a
 * typo did not fail — `Number('x')` is `NaN`, `NaN + i` is `NaN`, and `seedRng` coerces that to 0, so every
 * pair of a mirrored tournament collapsed onto the SAME game and reported a meaninglessly narrow confidence
 * interval. A gate that silently measures one game 200 times is worse than no gate.
 */
function parseSeed(s: string): number {
  if (!/^\d+$/.test(s)) throw new Error(`invalid seed "${s}" (expected a non-negative integer)`)
  return Number(s)
}

const seed = parseSeed(flag('seed', '1'))

/**
 * Applies `--depth`/`--iterations` to a BARE spec (no explicit `:N`); an explicit suffix always wins. The
 * iteration default is the SEARCH's `DEFAULT_ITERATIONS`, not a number this CLI invented — a bare `ismcts`
 * must run the budget its own defaults describe, and resolving it here means `describeAgentSpec` labels the
 * run with the budget that actually produced its ms/decision (D-A4) instead of a bare "ismcts".
 */
function withDefaults(spec: AgentSpec, depth: 0 | 1 | 2, iterations: number, rolloutCap: number | null): AgentSpec {
  if (spec.kind === 'greedy' && spec.depth === undefined) return { kind: 'greedy', depth }
  if (spec.kind !== 'ismcts') return spec
  // An explicit `undefined` is not an absent key under exactOptionalPropertyTypes, so build the object.
  return {
    kind: 'ismcts',
    ...(spec.iterations === undefined ? { iterations } : { iterations: spec.iterations }),
    ...(spec.rolloutCap !== undefined ? { rolloutCap: spec.rolloutCap } : rolloutCap === null ? {} : { rolloutCap }),
  }
}

const usage = [
  'usage: <hotseat|selfplay|mirror|profile|deckorder> [options]',
  '  agent spec: random | greedy[:0-2] | ismcts[:N]',
  '  selfplay: [--seed N] [--games N] [--p0 spec] [--p1 spec] [--depth 0-2] [--iterations N] [--rollout-cap N] [--fast]',
  '  mirror:   [--seed N] [--pairs N] [--a spec] [--b spec] [--depth 0-2] [--iterations N] [--rollout-cap N] [--bootstrap N] [--fast]',
  '            plays every seed twice with the seats swapped; every score is agent A\'s (spec D-A1)',
  '  profile:  [--seed N] [--games N] [--iterations N]   (rung D7: where a rollout\'s applies go)',
  '  common:   [--deck path]',
].join('\n')

/** Every flag is validated the same strict way (a bad value is an error, never a silent `NaN`); a throw from
 *  any of them prints the usage and exits 2 rather than dumping a stack. */
function parsed<T>(f: () => T): T {
  try { return f() } catch (e) { console.error(`${e instanceof Error ? e.message : String(e)}\n\n${usage}`); process.exit(2) }
}

if (cmd === 'hotseat') {
  await hotseat({ seed, decks: [deck, deck], defs })
} else if (cmd === 'selfplay' || cmd === 'mirror' || cmd === 'profile') {
  // C7: --depth gets the same 0-2 integer validation as greedy:N, instead of `Number(...)` silently coercing
  // any garbage input (including NaN) into the 0|1|2 type. D1: --iterations likewise, for ismcts:N.
  const depth = parsed(() => parseDepth(flag('depth', '1')))
  const iterations = parsed(() => parseIterations(flag('iterations', String(DEFAULT_ITERATIONS))))
  // Null means "not given", which is different from a value: an absent flag must leave the agent on its own
  // default rather than pinning it to whatever this file happens to think the default is.
  const rawCap = flag('rollout-cap', '')
  const rolloutCap = rawCap === '' ? null : parsed(() => parseRolloutCap(rawCap))
  if (cmd === 'profile') {
    // D7: where a rollout's applies go. Its own command because it answers one question and reports a shape
    // of its own; `selfplay`'s report stays the strength/cost report it already is.
    const games = parsed(() => parsePositiveInt(flag('games', '3'), 'games', 10_000))
    const r = profileSearch({ games, seed, decks: [deck, deck], defs, iterations })
    console.log(JSON.stringify(r, null, 2))
    process.exit(r.mismatchedDecisions === 0 ? 0 : 1)
  }
  if (cmd === 'selfplay') {
    const agents: [AgentSpec, AgentSpec] = parsed(() => [
      withDefaults(parseAgentSpec(flag('p0', 'random')), depth, iterations, rolloutCap),
      withDefaults(parseAgentSpec(flag('p1', 'random')), depth, iterations, rolloutCap),
    ])
    const games = parsed(() => parsePositiveInt(flag('games', '200'), 'games', 1_000_000))
    const r = selfPlay({ games, seed, decks: [deck, deck], defs, agents, strict: !has('fast') })
    console.log(JSON.stringify({ ...r, failures: r.failures.map((f) => ({ seed: f.seed, error: f.error.split('\n')[0] })) }, null, 2))
    for (const f of r.failures) console.error(`seed ${f.seed}:\n${f.error}`)
    process.exit(r.failures.length ? 1 : 0)
  }
  const agents: [AgentSpec, AgentSpec] = parsed(() => [
    withDefaults(parseAgentSpec(flag('a', 'ismcts')), depth, iterations, rolloutCap),
    withDefaults(parseAgentSpec(flag('b', 'greedy')), depth, iterations, rolloutCap),
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
