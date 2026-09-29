import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_ITERATIONS } from '@fftcg/ai'
import { loadCards } from '@fftcg/cards'
import { profileSearch } from './profile.js'
import type { AgentSpec } from './agents.js'
import {
  MAX_ITERATIONS, parseAgentSpec, parseBudgetMs, parseDepth, parseIterations, parseMinIterations,
  parsePositiveInt, parseRolloutCap, withDefaults,
} from './agents.js'
import { parseDeckFile } from './deck.js'
import { hotseat } from './hotseat.js'
import { mirrorTournament } from './mirror.js'
import { selfPlay } from './selfplay.js'
import { deckOrder } from './deckorder.js'
import { deckPaths, unknownFlagError } from './flags.js'

// repo root, not process.cwd() — `pnpm --filter @fftcg/cli <script>` runs with cwd set to apps/cli,
// so the default deck path must be anchored to this file's location rather than the invocation cwd.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

const [, , cmd, ...rest] = process.argv
/**
 * A flag's value, or `dflt` when the flag is absent.
 *
 * A flag PRESENT with no value is an error, not the default. `--budget-ms` as the last argument used to read
 * as "no budget at all", so a run intended to be boxed measured the unboxed agent and said nothing — the same
 * class of silent-wrong-measurement as the unknown flag that ran 400 games instead of 120.
 */
const flag = (name: string, dflt: string) => {
  const i = rest.indexOf(`--${name}`)
  if (i < 0) return dflt
  const v = rest[i + 1]
  if (v === undefined || v.startsWith('--')) {
    console.error(`--${name} needs a value`)
    process.exit(2)
  }
  return v
}
const has = (name: string) => rest.includes(`--${name}`)
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

const usage = [
  'usage: <hotseat|selfplay|mirror|profile|deckorder> [options]',
  '  agent spec: random | greedy[:0-2] | ismcts[:N][+weight=value,...]   (G1a: e.g. ismcts:200+damage=25)',
  '  selfplay: [--seed N] [--games N] [--p0 spec] [--p1 spec] [--depth 0-2] [--iterations N] [--rollout-cap N] [--budget-ms N] [--min-iterations N] [--fast]',
  '  mirror:   [--seed N] [--pairs N] [--a spec] [--b spec] [--depth 0-2] [--iterations N] [--rollout-cap N] [--budget-ms N] [--min-iterations N] [--bootstrap N] [--fast]',
  '            plays every seed twice with the seats swapped; every score is agent A\'s (spec D-A1)',
  '  profile:  [--seed N] [--games N] [--iterations N] [--opponent spec]   (rung D7: where a rollout\'s applies go)',
  '  decks:    [--deck path] [--lb-deck path|none]   both seats; default the Vol. 2 mirror, decks/starter-2025-vol2.txt',
  '            and decks/starter-2025-vol2-lb.txt (J8: the LB deck)',
  '            [--deck0 path] [--deck1 path] [--lb-deck0 path|none] [--lb-deck1 path|none]   one seat each, winning',
  '            over --deck/--lb-deck (V1-C) — hotseat, selfplay, profile; deckorder takes --deck/--deck0/--deck1',
  '            mirror takes --deck and --lb-deck only: it plays one list for both seats',
].join('\n')

/** Every flag is validated the same strict way (a bad value is an error, never a silent `NaN`); a throw from
 *  any of them prints the usage and exits 2 rather than dumping a stack. */
function parsed<T>(f: () => T): T {
  try { return f() } catch (e) { console.error(`${e instanceof Error ? e.message : String(e)}\n\n${usage}`); process.exit(2) }
}

// A flag this command does not read is an ERROR, not something to ignore — see `flags.ts` for the forty
// minutes that bought this.
const flagError = cmd === undefined ? null : unknownFlagError(cmd, rest)
if (flagError !== null) { console.error(`${flagError}\n\n${usage}`); process.exit(2) }

// After the flag check, never before: a flag this command does not take must be named as such, not surface as a
// missing file when its value happens to be a bad path (V1-C review).
// Rung V1-C: a deck per seat. `--deck`/`--lb-deck` set both seats; `--deck0/--deck1/--lb-deck0/--lb-deck1` one
// each (see `deckPaths`). The default stays the Vol. 2 mirror. Rung J8 (spec J8-D7): the LB deck (§7.14) beside the
// main list; `none` plays without one.
const paths = deckPaths((name) => flag(name, ''), {
  main: resolve(repoRoot, 'decks/starter-2025-vol2.txt'),
  lb: resolve(repoRoot, 'decks/starter-2025-vol2-lb.txt'),
})
const readDeck = (path: string): string[] => parseDeckFile(readFileSync(resolve(path), 'utf8'))
const decks: [string[], string[]] = [readDeck(paths.main[0]), readDeck(paths.main[1])]
const lbDecks: [string[], string[]] = [paths.lb[0] === null ? [] : readDeck(paths.lb[0]), paths.lb[1] === null ? [] : readDeck(paths.lb[1])]

if (cmd === 'hotseat') {
  await hotseat({ seed, decks, defs, lbDecks })
} else if (cmd === 'selfplay' || cmd === 'mirror' || cmd === 'profile') {
  // C7: --depth gets the same 0-2 integer validation as greedy:N, instead of `Number(...)` silently coercing
  // any garbage input (including NaN) into the 0|1|2 type. D1: --iterations likewise, for ismcts:N.
  const depth = parsed(() => parseDepth(flag('depth', '1')))
  const iterations = parsed(() => parseIterations(flag('iterations', String(DEFAULT_ITERATIONS))))
  // Null means "not given", which is different from a value: an absent flag must leave the agent on its own
  // default rather than pinning it to whatever this file happens to think the default is.
  const rawCap = flag('rollout-cap', '')
  const rolloutCap = rawCap === '' ? null : parsed(() => parseRolloutCap(rawCap))
  // F4: both halves of the box, or neither. A floor without a box is meaningless, and a box whose floor is
  // unnamed cannot be reported as a policy — `describeAgentSpec` prints both for exactly that reason.
  const rawBudget = flag('budget-ms', '')
  const rawMinIters = flag('min-iterations', '')
  if (rawBudget === '' && rawMinIters !== '') {
    console.error('--min-iterations needs --budget-ms: a floor with no box bounds nothing')
    process.exit(2)
  }
  const budget = rawBudget === '' ? null : parsed(() => ({
    ms: parseBudgetMs(rawBudget),
    minIterations: rawMinIters === '' ? 1 : parseMinIterations(rawMinIters),
  }))
  if (cmd === 'profile') {
    // D7: where a rollout's applies go. Its own command because it answers one question and reports a shape
    // of its own; `selfplay`'s report stays the strength/cost report it already is.
    const games = parsed(() => parsePositiveInt(flag('games', '3'), 'games', 10_000))
    // G1b-A0: seat 1's policy. Default greedy:1, which is what every earlier profile measured.
    const opponent = withDefaults(parsed(() => parseAgentSpec(flag('opponent', 'greedy:1'))), depth, iterations, rolloutCap, budget)
    const r = profileSearch({ games, seed, decks, lbDecks, defs, iterations, opponent })
    console.log(JSON.stringify(r, null, 2))
    process.exit(r.mismatchedDecisions === 0 ? 0 : 1)
  }
  if (cmd === 'selfplay') {
    const agents: [AgentSpec, AgentSpec] = parsed(() => [
      withDefaults(parseAgentSpec(flag('p0', 'random')), depth, iterations, rolloutCap, budget),
      withDefaults(parseAgentSpec(flag('p1', 'random')), depth, iterations, rolloutCap, budget),
    ])
    const games = parsed(() => parsePositiveInt(flag('games', '200'), 'games', 1_000_000))
    const r = selfPlay({ games, seed, decks, defs, lbDecks, agents, strict: !has('fast') })
    console.log(JSON.stringify({ ...r, failures: r.failures.map((f) => ({ seed: f.seed, error: f.error.split('\n')[0] })) }, null, 2))
    for (const f of r.failures) console.error(`seed ${f.seed}:\n${f.error}`)
    process.exit(r.failures.length ? 1 : 0)
  }
  const agents: [AgentSpec, AgentSpec] = parsed(() => [
    withDefaults(parseAgentSpec(flag('a', 'ismcts')), depth, iterations, rolloutCap, budget),
    withDefaults(parseAgentSpec(flag('b', 'greedy')), depth, iterations, rolloutCap, budget),
  ])
  const pairs = parsed(() => parsePositiveInt(flag('pairs', '200'), 'pairs', 1_000_000))
  const bootstrapSamples = parsed(() => parsePositiveInt(flag('bootstrap', '2000'), 'bootstrap', MAX_ITERATIONS))
  const r = mirrorTournament({ pairs, seed, decks, lbDecks, defs, agents, strict: !has('fast'), bootstrapSamples })
  // `results` is one row per game — useful in a file, noise on a terminal. `JSON.stringify` drops undefined
  // properties, so this is how the summary omits it. The aggregates are the report.
  const summary = { ...r, results: undefined, failures: r.failures.map((f) => ({ seed: f.seed, seatOfA: f.seatOfA, error: f.error.split('\n')[0] })) }
  console.log(JSON.stringify(summary, null, 2))
  for (const f of r.failures) console.error(`seed ${f.seed} (A at seat ${f.seatOfA}):\n${f.error}`)
  process.exit(r.failures.length ? 1 : 0)
} else if (cmd === 'deckorder') {
  console.log(deckOrder({ seed, decks, defs }))
} else {
  console.error(usage)
  process.exit(2)
}
