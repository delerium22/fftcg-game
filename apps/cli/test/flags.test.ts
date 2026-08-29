import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { KNOWN_FLAGS, unknownFlagError } from '../src/flags.js'

/**
 * An unknown flag must be an ERROR, not silence.
 *
 * `mirror --games 120` used to run for forty minutes and report 400 games, because `--games` is real but
 * belongs to `selfplay`; `mirror` counts in `--pairs`. The number it produced was plausible and against the
 * wrong sample size — the worst thing a measurement can be, because it invites comparison with a baseline
 * that was configured differently and nothing objects.
 */

const MAIN = resolve(dirname(fileURLToPath(import.meta.url)), '../src/main.ts')

/** Runs the real CLI and returns its stderr and exit code — the only way to prove main.ts calls any of this. */
function run(args: string[]): { code: number; err: string } {
  try {
    // A timeout, because the interesting FAILURE is the CLI accepting the flag and running the tournament
    // anyway. Without it the wired-to-nothing mutant does not fail this test, it HANGS it for forty minutes —
    // which is how the defect behaved in the first place. A test that reproduces the bug by taking as long as
    // the bug did is not a test.
    execFileSync('node', ['--import', 'tsx', MAIN, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000 })
    return { code: 0, err: '' }
  } catch (e) {
    const x = e as { status?: number; stderr?: string }
    return { code: x.status ?? -1, err: x.stderr ?? '' }
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
