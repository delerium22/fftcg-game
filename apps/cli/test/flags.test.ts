import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { KNOWN_FLAGS, deckPaths, unknownFlagError } from '../src/flags.js'

/**
 * An unknown flag must be an ERROR, not silence.
 *
 * `mirror --games 120` used to run for forty minutes and report 400 games, because `--games` is real but
 * belongs to `selfplay`; `mirror` counts in `--pairs`. The number it produced was plausible and against the
 * wrong sample size — the worst thing a measurement can be, because it invites comparison with a baseline
 * that was configured differently and nothing objects.
 */

const MAIN = resolve(dirname(fileURLToPath(import.meta.url)), '../src/main.ts')

/** Runs the real CLI and returns its stdout, stderr and exit code — the only way to prove main.ts calls any of this. */
function run(args: string[]): { code: number; err: string; out: string } {
  try {
    // A timeout, because the interesting FAILURE is the CLI accepting the flag and running the tournament
    // anyway. Without it the wired-to-nothing mutant does not fail this test, it HANGS it for forty minutes —
    // which is how the defect behaved in the first place. A test that reproduces the bug by taking as long as
    // the bug did is not a test.
    const out = execFileSync('node', ['--import', 'tsx', MAIN, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000 })
    return { code: 0, err: '', out }
  } catch (e) {
    const x = e as { status?: number; stderr?: string; stdout?: string }
    return { code: x.status ?? -1, err: x.stderr ?? '', out: x.stdout ?? '' }
  }
}

describe('unknownFlagError', () => {
  it('rejects a flag the command does not read, and says where it IS valid', () => {
    const msg = unknownFlagError('mirror', ['--games', '120', '--seed', '1'])
    expect(msg).toContain('--games')
    // Naming the command it belongs to is the useful half: the mistake is reaching for the right idea under
    // the wrong command, not inventing a flag out of nothing.
    expect(msg).toContain('selfplay')
  })

  it('accepts every flag its own usage line advertises', () => {
    // Guards the direction that would break the tool rather than the user: a `KNOWN_FLAGS` entry that omits
    // a flag the command really reads would reject a correct invocation.
    for (const [cmd, flags] of Object.entries(KNOWN_FLAGS)) {
      const argv = flags.flatMap((f) => [`--${f}`, 'x'])
      expect(unknownFlagError(cmd, argv), `${cmd} rejects one of its own flags`).toBe(null)
    }
  })

  it('does not mistake a flag VALUE for a flag', () => {
    expect(unknownFlagError('mirror', ['--a', 'greedy:2', '--b', 'ismcts:400'])).toBe(null)
  })

  it('reports every unknown flag at once, not just the first', () => {
    const msg = unknownFlagError('mirror', ['--games', '1', '--nonsense', '2'])
    expect(msg).toContain('--games')
    expect(msg).toContain('--nonsense')
  })

  it('says nothing about a command it does not know', () => {
    // An unrecognised command is the dispatcher's business; this must not pre-empt it with a worse message.
    expect(unknownFlagError('nonsense', ['--whatever'])).toBe(null)
  })
})

describe('the real CLI', () => {
  it('exits 2 and names the flag rather than running for forty minutes', () => {
    // The integration anchor. Every assertion above passes with `unknownFlagError` wired to nothing at all;
    // only running the actual binary proves main.ts calls it.
    // The rest of the invocation is deliberately CHEAP — one pair of random agents. Under the mutant the CLI
    // ignores `--games` and runs that tiny tournament to completion in a couple of seconds, so this fails on
    // the exit code immediately instead of waiting out the timeout. The timeout stays as a backstop for a
    // mutant that also drops `--pairs`.
    const { code, err } = run(['mirror', '--pairs', '1', '--a', 'random', '--b', 'random', '--fast', '--games', '120'])
    expect(code, 'the CLI accepted an unknown flag').toBe(2)
    expect(err).toContain('unknown flag for mirror: --games')
    expect(err, 'the usage text should follow, so the reader can see the right flag').toContain('--pairs')
  })

  it('still accepts a correct invocation', () => {
    // The other direction: a rejection that rejects everything would pass the test above.
    const { code, err } = run(['mirror', '--pairs', '1', '--a', 'random', '--b', 'random', '--fast'])
    expect(err).not.toContain('unknown flag')
    expect(code).toBe(0)
  })
})

/**
 * Rung V1-C (spec V1-D17, plan R6/R7): a deck per seat. `--deck`/`--lb-deck` keep meaning BOTH seats; the seat
 * flags override one seat each, and a seat flag wins over the shared one. The default stays the Vol. 2 mirror: the
 * CLI is the measuring tool, and every recorded win rate assumes it.
 */
describe('deck flags', () => {
  const DEFAULTS = { main: 'vol2.txt', lb: 'vol2-lb.txt' }
  const from = (argv: Record<string, string>) => (name: string): string => argv[name] ?? ''

  it('defaults both seats to the Vol. 2 mirror', () => {
    expect(deckPaths(from({}), DEFAULTS)).toEqual({ main: ['vol2.txt', 'vol2.txt'], lb: ['vol2-lb.txt', 'vol2-lb.txt'] })
  })

  it('--deck and --lb-deck set both seats, as they always did', () => {
    expect(deckPaths(from({ deck: 'a.txt', 'lb-deck': 'none' }), DEFAULTS)).toEqual({ main: ['a.txt', 'a.txt'], lb: [null, null] })
  })

  it('a seat flag overrides its own seat, and wins over the shared flag', () => {
    expect(deckPaths(from({ deck: 'a.txt', deck1: 'b.txt', 'lb-deck': 'l.txt', 'lb-deck0': 'none' }), DEFAULTS))
      .toEqual({ main: ['a.txt', 'b.txt'], lb: [null, 'l.txt'] })
    expect(deckPaths(from({ deck0: 'c.txt' }), DEFAULTS)).toEqual({ main: ['c.txt', 'vol2.txt'], lb: ['vol2-lb.txt', 'vol2-lb.txt'] })
  })

  it('--lb-deck is a known flag where an LB deck is read (it was read, and refused, before)', () => {
    for (const cmd of ['hotseat', 'selfplay', 'mirror', 'profile']) {
      expect(unknownFlagError(cmd, ['--lb-deck', 'none']), `${cmd} refuses --lb-deck`).toBe(null)
    }
  })

  it('mirror takes no seat flag, and the refusal names the commands that do', () => {
    const msg = unknownFlagError('mirror', ['--deck1', 'x'])
    expect(msg).toContain('--deck1')
    expect(msg).toContain('selfplay')
  })

  const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
  const VOL1 = resolve(REPO, 'decks/starter-2025-vol1.txt')

  it('the real CLI deals seat 1 the Vol. 1 list with --deck1 (deckorder prints both decks)', () => {
    const { code, out } = run(['deckorder', '--seed', '1', '--deck1', VOL1])
    expect(code).toBe(0)
    const [seat0, seat1] = out.split('Player 1 deck')
    // 27-123S is Zack, a Vol. 1 exclusive; 27-1xxS below 122 are Vol. 2's.
    expect(seat0, 'seat 0 lost the default Vol. 2 list').not.toContain('27-123S')
    expect(seat1, 'seat 1 was not dealt Vol. 1').toContain('27-123S')
  })

  it('the real CLI plays Vol. 1 against Vol. 2 in selfplay, LB decks included', () => {
    const { code, err } = run(['selfplay', '--games', '1', '--fast', '--deck1', VOL1, '--lb-deck1', resolve(REPO, 'decks/starter-2025-vol1-lb.txt')])
    expect(err).toBe('')
    expect(code).toBe(0)
  })

  it('names the unknown flag before it tries to read any deck file (V1-C review)', () => {
    // The flag check used to run AFTER the deck files were read, so a seat flag given to mirror with a path that
    // does not exist died on the file — the wrong complaint about the wrong mistake.
    const { code, err } = run(['mirror', '--pairs', '1', '--fast', '--deck1', '/nonexistent.txt'])
    expect(err).toContain('unknown flag for mirror: --deck1')
    expect(err).not.toContain('ENOENT')
    expect(code).toBe(2)
  })

  it('the real CLI refuses a seat flag for mirror', () => {
    const { code, err } = run(['mirror', '--pairs', '1', '--a', 'random', '--b', 'random', '--fast', '--deck1', VOL1])
    expect(code).toBe(2)
    expect(err).toContain('unknown flag for mirror: --deck1')
  })
})
