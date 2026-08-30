import { writeFileSync } from 'node:fs'
import { evaluate } from '../../src/evaluate.js'
import { corpus } from './frozen-scores.js'

/**
 * Regenerates `frozen-scores.json` — the A1 reference for rung G1b.
 *
 * ```
 * pnpm --filter @fftcg/ai exec tsx test/fixtures/write-frozen-scores.ts
 * ```
 *
 * It is committed so the fixture is auditable rather than a wall of numbers nobody can re-derive, and it is
 * deliberately NOT wired into any test: the whole value of a frozen reference is that it was taken before the
 * change and does not move with it. Running this after adding a weight would quietly re-freeze the new
 * behaviour as the baseline, which is the one thing A1 exists to prevent. Regenerate only when the evaluation
 * is *meant* to change, and say so in the commit that does it.
 */
const out: Record<string, number> = {}
for (const c of corpus()) out[c.label] = evaluate(c.state, c.me, undefined, c.aggression)
writeFileSync(new URL('./frozen-scores.json', import.meta.url), `${JSON.stringify(out, null, 0)}\n`)
console.log(`wrote ${Object.keys(out).length} frozen scores`)
