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
/** Rung V1-C: one deck per seat. A seat flag overrides the shared `--deck`/`--lb-deck` for that seat alone. */
const SEAT_DECKS = ['deck0', 'deck1'] as const
const SEAT_LB_DECKS = ['lb-deck0', 'lb-deck1'] as const

// `lb-deck` was READ by main.ts since rung J8 and listed nowhere here, so every `--lb-deck` was refused as unknown.
// `mirror` takes only the shared flags (rung V1-C, R7): it plays one list for both seats — see `mirrorTournament`.
export const KNOWN_FLAGS: Record<string, readonly string[]> = {
  hotseat: ['deck', 'lb-deck', ...SEAT_DECKS, ...SEAT_LB_DECKS, 'seed'],
  selfplay: ['deck', 'lb-deck', ...SEAT_DECKS, ...SEAT_LB_DECKS, 'seed', 'games', 'p0', 'p1', 'depth', 'iterations', 'rollout-cap', 'budget-ms', 'min-iterations', 'fast'],
  mirror: ['deck', 'lb-deck', 'seed', 'pairs', 'a', 'b', 'depth', 'iterations', 'rollout-cap', 'budget-ms', 'min-iterations', 'bootstrap', 'fast'],
  profile: ['deck', 'lb-deck', ...SEAT_DECKS, ...SEAT_LB_DECKS, 'seed', 'games', 'iterations', 'opponent'],
  // `deckorder` prints the two main decks and deals no LB deck, so it takes no LB flag.
  deckorder: ['deck', ...SEAT_DECKS, 'seed'],
}

/** Each seat's main-deck path, and its LB-deck path or `null` for none (`--lb-deck none`). */
export interface DeckPaths {
  main: [string, string]
  lb: [string | null, string | null]
}

/**
 * Which deck file each seat plays (rung V1-C, spec V1-D17).
 *
 * `--deck`/`--lb-deck` keep their old meaning, BOTH seats, so every script and recorded run means what it did;
 * `--deck0/--deck1/--lb-deck0/--lb-deck1` override one seat and win over the shared flag. With nothing given both
 * seats get `defaults` — the Vol. 2 mirror, deliberately NOT the web app's pair: the CLI is the measuring tool,
 * and every recorded win rate, gate and weights A/B assumes the mirror.
 *
 * `flag` returns `''` for an absent flag, as main.ts's does. Pure, so it can be tested without the script.
 */
export function deckPaths(flag: (name: string) => string, defaults: { main: string; lb: string }): DeckPaths {
  const pick = (seat: string, shared: string, dflt: string): string => flag(seat) || flag(shared) || dflt
  const lb = (seat: string): string | null => { const v = pick(seat, 'lb-deck', defaults.lb); return v === 'none' ? null : v }
  return {
    main: [pick('deck0', 'deck', defaults.main), pick('deck1', 'deck', defaults.main)],
    lb: [lb('lb-deck0'), lb('lb-deck1')],
  }
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
