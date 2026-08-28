import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Every subcommand `main.ts` dispatches must be reachable the way the README says to run things.
 *
 * Rung D7 added `profile` to the dispatch and nothing else, so it could not be started at all: without a
 * package script `pnpm --filter @fftcg/cli run profile` fails with ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT, and
 * the bare form collides with pnpm's own built-in `profile` command. D7-A5 claimed the measurement was
 * "reachable from the CLI, so it is reproducible by someone who did not write it" — and it was not; only an
 * ad-hoc `pnpm exec tsx src/main.ts profile` reached it, which is exactly the someone-who-wrote-it path.
 *
 * A wiring test rather than a behaviour test, because the failure was wiring: the code was fine and nobody
 * could run it.
 */
describe('every subcommand is actually runnable', () => {
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { scripts: Record<string, string> }

  /** The commands `main.ts` compares `cmd` against — the dispatch is the source of truth, not the docs. */
  const dispatched = [...main.matchAll(/cmd === '([a-z]+)'/g)].map((m) => m[1] as string)

  it('finds the dispatch, so the sweep is not empty', () => {
    expect(new Set(dispatched).size, 'no subcommands were found — the dispatch shape has changed').toBeGreaterThan(3)
    expect(dispatched).toContain('profile')
  })

  it('has a package script for each one', () => {
    for (const cmd of new Set(dispatched)) {
      expect(pkg.scripts[cmd], `\`pnpm --filter @fftcg/cli run ${cmd}\` would fail — no script for it`).toBeDefined()
      // ...and the script must actually run THAT command, not a copy-pasted sibling.
      expect(pkg.scripts[cmd], `the ${cmd} script runs something else`).toContain(`src/main.ts ${cmd}`)
    }
  })

  it('documents each one in the README', () => {
    // The README is where a reader looks for how to start something; a command missing from it is a command
    // nobody finds. `usage` in main.ts is the second place, and is checked too.
    const readme = readFileSync(new URL('../../../README.md', import.meta.url), 'utf8')
    const usage = /usage: <([^>]+)>/.exec(main)?.[1]?.split('|') ?? []
    for (const cmd of new Set(dispatched)) {
      expect(readme, `${cmd} is not in the README`).toContain(cmd)
      expect(usage, `${cmd} is missing from main.ts's own usage line`).toContain(cmd)
    }
  })
})
