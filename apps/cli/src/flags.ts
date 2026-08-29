/**
 * Which flags each command actually reads, and the rejection of any it does not.
 *
 * Found the hard way: `mirror --games 120` ran silently, ignored `--games`, and used the default 200 pairs —
 * 400 games, not 120 — after forty minutes of CPU. `--games` is a real flag, but it belongs to `selfplay` and
 * `profile`; `mirror` counts in `--pairs`, because each pair is one seed played twice with the seats swapped.
 * So the mistake produced a plausible number against the wrong sample size, which is the worst outcome a
 * measurement can have: it invites comparison against a differently-configured baseline and nothing objects.
 *
 * `main.ts` already refuses a bad flag VALUE rather than coercing it — `--seed x` once collapsed every pair
 * of a tournament onto the same game and reported a meaninglessly narrow confidence interval. This is the
 * same principle applied to a bad flag NAME.
 *
 * Lives in its own module so it can be tested directly; `main.ts` is a script with top-level side effects
 * (it reads a deck off disk and dispatches) and cannot be imported into a test.
 */
export const KNOWN_FLAGS: Record<string, readonly string[]> = {
  hotseat: ['deck', 'seed'],
  selfplay: ['deck', 'seed', 'games', 'p0', 'p1', 'depth', 'iterations', 'rollout-cap', 'fast'],
  mirror: ['deck', 'seed', 'pairs', 'a', 'b', 'depth', 'iterations', 'rollout-cap', 'bootstrap', 'fast'],
  profile: ['deck', 'seed', 'games', 'iterations'],
  deckorder: ['deck', 'seed'],
}

/**
 * The complaint about `argv` for `command`, or `null` if there is nothing to complain about.
 *
 * Returns the message rather than printing it, so the decision and the reporting stay separable — and so a
 * test can assert what it SAYS, not merely that it exited.
 */
export function unknownFlagError(command: string, argv: readonly string[]): string | null {
  const known = KNOWN_FLAGS[command]
  if (!known) return null
  // Only tokens that LOOK like flags. A flag's value can be anything, so `--p0 greedy:2` must not trip over
  // `greedy:2`, and a value is never itself checked.
  const unknown = argv.filter((t) => t.startsWith('--')).map((t) => t.slice(2)).filter((f) => !known.includes(f))
  if (!unknown.length) return null
  const list = unknown.map((f) => `--${f}`).join(', ')
  // Name where each one IS valid, because that is the actual mistake being made: reaching for the right idea
  // under the wrong command, rather than inventing a flag from nothing.
  const elsewhere = unknown
    .map((f) => [f, Object.keys(KNOWN_FLAGS).filter((c) => c !== command && KNOWN_FLAGS[c]?.includes(f))] as const)
    .filter(([, cs]) => cs.length)
    .map(([f, cs]) => `--${f} is a flag of ${cs.join(', ')}`)
  return `unknown flag${unknown.length > 1 ? 's' : ''} for ${command}: ${list}${elsewhere.length ? `\n${elsewhere.join('\n')}` : ''}`
}
