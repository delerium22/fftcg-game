import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Rung J6-D1: `effectivePower`, `keywordsOf` and `flagsOf` (state.ts) are the ONLY readers of a FieldCard's
 * `powerBonus`, `granted` and `flags`. A raw read anywhere else would miss the continuous-effect layer — which
 * is exactly how protection was read in six places before this rung (Codex CRITICAL). Writers (the stamps
 * `setFieldCard` applies), the invariants that validate the stamps, and the search key that digests them are
 * the allowed exceptions, by file and by shape.
 */

const ROOT = join(import.meta.dirname, '..', '..', '..')
const SCAN = ['packages/engine/src', 'packages/ai/src', 'apps/web/src']
/** Files that may read the stamps raw, and why. */
const ALLOWED: Record<string, string> = {
  'packages/engine/src/state.ts': 'the readers themselves',
  'packages/engine/src/invariants.ts': 'validates the stamps as data',
  'packages/ai/src/ismcts/keys.ts': 'digests the stamps into the observation key (state, not a reading of power)',
  'packages/ai/src/evaluate.ts': "`material` separates the temporary stamp from permanent power on purpose (w.temporaryPower)",
}
/** A read of the stamp off a FieldCard-shaped binding — `c`, `card`, `fc`, `f`, `loc.card` — not a display object's field of the same name. */
const RAW = /(?<![.\w])(c|card|fc|f|loc\.card|loc\?\.card)\.(flags|granted|powerBonus)\b/

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : []
  })
}

describe('J6-D1 — the three readers are the only readers of a FieldCard’s stamps', () => {
  it('no source file outside the allowed list reads .flags/.granted/.powerBonus except to WRITE them', () => {
    const offenders: string[] = []
    for (const dir of SCAN) {
      for (const file of files(join(ROOT, dir))) {
        const rel = file.slice(ROOT.length + 1)
        if (ALLOWED[rel]) continue
        readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
          if (!RAW.test(line)) return
          if (line.includes('setFieldCard') || /^\s*(\/\/|\*)/.test(line)) return   // a stamp write, or a comment
          if (/loc\.card\.(granted|flags)\.includes\(eff\./.test(line)) return   // the stamp writer de-duplicating its own stamp
          if (/:\s*\[\.\.\.c\.(granted|flags)|powerBonus: c\.powerBonus \+|powerBonus: 0|granted: \[\]|flags: \[\]/.test(line)) return   // constructing or updating a FieldCard
          if (/(granted|flags|powerBonus)\??:\s/.test(line) && !/\.(flags|granted|powerBonus)\b/.test(line.split('=')[1] ?? line)) return
          offenders.push(`${rel}:${i + 1}: ${line.trim().slice(0, 100)}`)
        })
      }
    }
    expect(offenders, 'read through effectivePower / keywordsOf / flagsOf instead').toEqual([])
  })
})
