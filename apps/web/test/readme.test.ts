import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_ITERATIONS, DEFAULT_ROLLOUT_COMMAND_CAP } from '@fftcg/ai'
import { AI_STEP_MS } from '../src/game/useGame.js'

/**
 * The README states numbers that come from code, and in this repo those drift.
 *
 * It has happened four times now: two measured figures rotted silently as cards were added (the README says
 * so itself), the rung-C10 spec went on claiming Sphene warns after it stopped, rung D7's own acceptance
 * criterion claimed a CLI path that did not work, and the README's opening paragraph still advertised the
 * AI at 78.3 % after the shipped rollout cap moved the answer to 75.0 %.
 *
 * A win rate cannot be pinned from here — it is a measurement, not a constant, and the honest defence
 * against that one was to stop stating it in two places. But the CONSTANTS it is measured at can be pinned,
 * and they are exactly what makes a stale figure hard to spot: a reader has no way to tell whether "200
 * iterations" still describes the shipped default.
 *
 * If one of these fails, the code moved and the README did not. Update the prose, not the assertion.
 */
describe('the README still describes the code', () => {
  // Walk up from the working directory: this project runs under jsdom, where `import.meta.url` is not a
  // `file:` URL and `new URL('../…', import.meta.url)` throws.
  const repoRoot = ((): string => {
    let dir = process.cwd()
    for (let i = 0; i < 6; i++) {
      if (existsSync(join(dir, 'README.md'))) return dir
      dir = dirname(dir)
    }
    throw new Error('README.md not found above the working directory')
  })()
  const readme = readFileSync(join(repoRoot, 'README.md'), 'utf8')

  it('quotes the pacing constant the coordinator actually uses', () => {
    expect(readme, `AI_STEP_MS is ${AI_STEP_MS} in code; the README says otherwise`)
      .toContain(`\`AI_STEP_MS\` = ${AI_STEP_MS} ms`)
  })

  it('quotes the search budget the agent actually defaults to', () => {
    expect(readme, `DEFAULT_ITERATIONS is ${DEFAULT_ITERATIONS}; the strength table is measured at it`)
      .toContain(`${DEFAULT_ITERATIONS} iterations`)
  })

  it('quotes the rollout cap that actually ships', () => {
    // D5 halved this and the README's opening paragraph kept the pre-D5 win rate for weeks. The table row
    // for the shipped cap is bold precisely because it is the one that describes today.
    expect(readme, `the rollout cap is ${DEFAULT_ROLLOUT_COMMAND_CAP}; the README's bold row says otherwise`)
      .toContain(`| **${DEFAULT_ROLLOUT_COMMAND_CAP}** |`)
  })

  it('states the current win rate once, so it cannot drift out of step with itself', () => {
    // The rot was duplication, not arithmetic. `75.0 %` may appear in the strength table and in the D5 cap
    // table (the same measurement, cited twice by design) — but not a third time as a headline.
    const currentFigure = [...readme.matchAll(/\*\*75\.0 %\*\*/g)].length
    expect(currentFigure, 'the current win rate is stated in more places than the two tables').toBeLessThanOrEqual(2)
  })
})
