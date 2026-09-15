import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Rung J9: the timing matrix (docs/rules/timing-matrix.md) is a claim about which timing rules of CR 3.3 have a
 * test. This keeps the claim honest, the way `rules-citations` keeps citations honest: every in-scope subsection
 * has a row; every row's section exists; every `tested` row cites a describe/it that exists; every `simplified`
 * row names a source file that carries a MVP0-SIMPLIFICATION marker; every `n/a` row says why.
 */

const ROOT = resolve(import.meta.dirname, '../../..')
const MATRIX = join(ROOT, 'docs/rules/timing-matrix.md')
const INDEX = join(ROOT, 'docs/rules/cr-3.3-sections.txt')
/** The chapters and sections the matrix covers (spec J9-D1). A section is in scope when it equals or is under one of these. */
export const SCOPE = ['9', '10', '11.1', '11.3', '11.4', '11.6', '11.7', '11.8', '11.10', '11.11', '12', '15.1.1.9', '15.2.1', '15.2.2', '15.2.3', '15.2.4', '15.2.5']
const STATUSES = new Set(['heading', 'tested', 'simplified', 'n/a'])
const PKG_DIRS: Record<string, string> = { engine: 'packages/engine/test', cards: 'packages/cards/test', web: 'apps/web/test' }

export interface Row { section: string; rule: string; status: string; tests: string; line: number }

/** The table rows of the matrix: `| § | rule | status | tests |`, header and rule lines skipped. */
export function parseMatrix(text: string): Row[] {
  const rows: Row[] = []
  text.split('\n').forEach((line, i) => {
    if (!line.startsWith('| ')) return
    const body = line.endsWith('|') ? line.slice(1, -1) : line.slice(1)
    const cells = body.split(' | ').map((c) => c.trim())
    if (cells.length < 4 || cells[0] === '§' || /^-+$/.test(cells[0] ?? '')) return
    rows.push({ section: cells[0]!, rule: cells[1]!, status: cells[2]!, tests: cells[3]!, line: i + 1 })
  })
  return rows
}

export const inScope = (n: string): boolean => SCOPE.some((p) => n === p || n.startsWith(p + '.'))

function testFile(ref: string): string | null {
  const [pkg, ...rest] = ref.split('/')
  const dir = PKG_DIRS[pkg ?? '']
  if (!dir || rest.length === 0) return null
  for (const ext of ['.test.ts', '.test.tsx']) {
    const p = join(ROOT, dir, rest.join('/') + ext)
    if (existsSync(p)) return p
  }
  return null
}
const TEST_LINE = /\b(describe|it)(\.\w+)?(\([^)]*\))?\(/

/** Every problem with `rows`, one string each; empty when the matrix is truthful. Pure over its inputs, so fixtures can probe it. */
export function problems(rows: Row[], index: Set<string>): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const r of rows) {
    const at = `line ${r.line} §${r.section}`
    if (!index.has(r.section)) out.push(`${at}: not a CR 3.3 section`)
    if (seen.has(r.section)) out.push(`${at}: duplicate row`)
    seen.add(r.section)
    if (!STATUSES.has(r.status)) out.push(`${at}: status "${r.status}"`)
    const entries = r.tests ? r.tests.split(';').map((e) => e.trim()).filter(Boolean) : []
    const refs = entries.filter((e) => e.includes('#'))
    const markers = entries.filter((e) => e.endsWith('.ts') && !e.includes('#'))
    if (r.status === 'tested' && refs.length === 0) out.push(`${at}: tested but cites no test`)
    if (r.status === 'simplified' && markers.length === 0) out.push(`${at}: simplified but names no marker file`)
    if (r.status === 'n/a' && !r.tests) out.push(`${at}: n/a without a reason`)
    for (const ref of refs) {
      const [file, fragment] = ref.split('#') as [string, string]
      const path = testFile(file)
      if (!path) { out.push(`${at}: no test file for "${file}"`); continue }
      const hit = readFileSync(path, 'utf8').split('\n').some((l) => TEST_LINE.test(l) && l.includes(fragment))
      if (!hit) out.push(`${at}: "${fragment}" names no describe/it in ${file}`)
    }
    for (const m of markers) {
      const path = join(ROOT, m)
      if (!existsSync(path)) out.push(`${at}: marker file ${m} does not exist`)
      else if (!readFileSync(path, 'utf8').includes('MVP0-SIMPLIFICATION')) out.push(`${at}: ${m} carries no MVP0-SIMPLIFICATION marker`)
    }
  }
  for (const n of index) if (inScope(n) && !seen.has(n)) out.push(`§${n} is in scope but has no row`)
  return out
}

function loadIndex(): Set<string> {
  return new Set(readFileSync(INDEX, 'utf8').split('\n').filter((l) => l && !l.startsWith('#')).map((l) => l.split('\t')[0] as string))
}

describe('the timing matrix (J9-A1)', () => {
  it('exists, covers every in-scope section, and every claim it makes is true', () => {
    expect(existsSync(MATRIX), 'docs/rules/timing-matrix.md').toBe(true)
    const rows = parseMatrix(readFileSync(MATRIX, 'utf8'))
    expect(rows.length).toBeGreaterThan(150)
    expect(problems(rows, loadIndex())).toEqual([])
  })

  it('fails a matrix that lies: a bad section, an uncited tested row, a dead fragment, a missing marker, a missing row', () => {
    const index = new Set(['9', '9.1', '9.1.1'])
    const fixture = [
      '| § | rule | status | tests |', '|---|---|---|---|',
      '| 9 | Game phases | heading |  |',
      '| 9.1 | Active Phase | tested |  |',
      '| 9.9 | not a section | n/a | nothing |',
      '| 9.1.1 | activation | tested | engine/cr9-phases#no such test name |',
    ].join('\n')
    const p = problems(parseMatrix(fixture), index)
    expect(p).toContainEqual(expect.stringContaining('§9.1: tested but cites no test'))
    expect(p).toContainEqual(expect.stringContaining('§9.9: not a CR 3.3 section'))
    expect(p).toContainEqual(expect.stringContaining('names no describe/it'))
    const simplified = problems(parseMatrix('| 9.1 | x | simplified | packages/engine/src/nowhere.ts |'), index)
    expect(simplified).toContainEqual(expect.stringContaining('does not exist'))
    const missing = problems(parseMatrix('| 9 | x | heading |  |'), index)
    expect(missing).toContainEqual('§9.1 is in scope but has no row')
    const noFile = problems(parseMatrix('| 9 | x | tested | engine/no-such-file#x |'), index)
    expect(noFile).toContainEqual(expect.stringContaining('no test file'))
  })

  it('the SCOPE reaches at least 180 sections of the index', () => {
    expect([...loadIndex()].filter(inScope).length).toBeGreaterThan(180)
  })
})
