import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Every `§x.y.z` cited anywhere in this repo names a section that exists in CR 3.3 (rung J0).
 *
 * Citations drifted once already: the C3 plan review found two that named unrelated rules, and the audit
 * found a citation to a non-existent 12.2.2 on the browser's damage constant (the rule is §12.4.1). The rules
 * text is not in the repo — it is Square Enix's — but its section index is, at `docs/rules/cr-3.3-sections.txt`,
 * built from the pinned PDF with:
 *
 *   pdftotext -layout fftcg-comprules-v3.3.pdf cr33.txt
 *   grep -E '^\s*[0-9]+(\.[0-9]+)*\.\s' cr33.txt   → number + opening words, deduplicated, sorted
 *
 * A citation to a section that does not exist is a comment that lies about the rule it implements.
 */

const ROOT = resolve(import.meta.dirname, '../../..')
const SCAN = ['packages', 'apps', 'docs/superpowers/specs', 'README.md']
const SKIP_DIRS = new Set(['node_modules', 'dist', 'data', '.playwright-mcp', 'test-results'])
const EXT = /\.(ts|tsx|md)$/

function* files(path: string): Generator<string> {
  const st = statSync(path)
  if (st.isFile()) { if (EXT.test(path)) yield path; return }
  for (const name of readdirSync(path)) {
    if (SKIP_DIRS.has(name)) continue
    yield* files(join(path, name))
  }
}

describe('rules citations', () => {
  const index = new Set(
    readFileSync(join(ROOT, 'docs/rules/cr-3.3-sections.txt'), 'utf8').split('\n')
      .filter((l) => l && !l.startsWith('#')).map((l) => l.split('\t')[0] as string),
  )

  it('the index is the CR 3.3 table of sections', () => {
    expect(index.size).toBeGreaterThan(400)
    for (const s of ['2.1', '5.2.1.3', '7.12', '9.3.1.7', '10.1.4.4', '11.2.2.3', '11.8.7', '12.4.8', '15.2.3', '15.2.9.4.2.2']) expect(index.has(s), s).toBe(true)
  })

  it('every §x.y.z cited in source, tests, specs and the README exists', () => {
    const bad: string[] = []
    let cited = 0
    for (const dir of SCAN) {
      for (const file of files(join(ROOT, dir))) {
        const text = readFileSync(file, 'utf8')
        for (const m of text.matchAll(/§(\d+(?:\.\d+)*)/g)) {
          cited++
          const num = m[1] as string
          if (!index.has(num)) bad.push(`${file.slice(ROOT.length + 1)}: §${num}`)
        }
      }
    }
    expect(cited).toBeGreaterThan(200)
    expect(bad, 'citations to sections CR 3.3 does not have').toEqual([])
  })
})
