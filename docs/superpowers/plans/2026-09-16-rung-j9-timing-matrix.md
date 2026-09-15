# Rung J9 — the timing matrix: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** every timing rule in CR 3.3 chapters 9–12 and the combat/keyword parts of 15 is mapped to a test (or an honest `simplified`/`n/a` reason), a meta-test keeps the map truthful, and three new test layers prove the primitives alone, in pairs, and as scripted real-card games.

**Architecture:** a markdown matrix in `docs/rules/` is parsed by a vitest meta-test in the engine package that checks every row against the section index, the test tree and the simplification markers. Layer 1 and 2 tests are ordinary engine tests on the synthetic `V-*` pool. Layer 3 lives in `packages/cards/test/scenarios/` because only the cards package may import both the shipped ability ASTs and the engine.

**Tech Stack:** TypeScript, vitest 3 (`pnpm test`, `pnpm vitest run <file>`), node:fs for the meta-test. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-16-rung-j9-timing-matrix.md`

## Global Constraints

- The rules text is © Square Enix: the matrix paraphrases, never quotes more than a few words. The section index is `docs/rules/cr-3.3-sections.txt`.
- Existing tests are cited, never renamed or moved (spec J9-D4). New tests carry their section in the `it` name, e.g. `L1 §10.1.4.6 — …`.
- A rule found WRONG gets an `it.fails` test, a `simplified` row, and a ladder line — not a fix (spec J9-D6).
- Every `MVP0-SIMPLIFICATION` marker is a comment of exactly that token in a `packages/**/src/*.ts` file.
- Test refs in the matrix are `<pkg>/<file>#<fragment>` where `<pkg>` is `engine` (`packages/engine/test/`), `cards` (`packages/cards/test/`) or `web` (`apps/web/test/`), `<file>` omits `.test.ts(x)`, and `<fragment>` is a literal substring of a `describe(`/`it(` line in that file. Multiple refs are separated by `; `.
- Run everything from the worktree `/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai`. Do not touch the uncommitted `vitest.config.ts`.
- Commit each task green with the repo's message style (`test(engine): …`, `docs(rules): …`) and the `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` trailer.

---

## File structure

| File | Responsibility |
|---|---|
| `docs/rules/timing-matrix.md` (new) | The matrix: one row per in-scope CR subsection, status, test refs or reason. |
| `packages/engine/test/timing-matrix.test.ts` (new) | Meta-test: parses the matrix, checks rows against the index, the test tree and the markers. |
| `packages/engine/src/phases.ts`, `packages/engine/src/cast.ts` (modify) | Two new `MVP0-SIMPLIFICATION` markers: Freeze (§15.2.4) at the Active Phase, Back Attack (§15.2.5) at the Character cast check. |
| `packages/engine/test/timing-l1-priority.test.ts` (new) | Layer 1: the primitives the matrix finds untested. |
| `packages/engine/test/timing-l2-compositions.test.ts` (new) | Layer 2: two rules on top of each other, asserted as event sequences. |
| `packages/cards/test/harness.ts` (new) | The real-card fixture helpers, moved out of `abilities.test.ts` so scenarios can share them. |
| `packages/cards/test/abilities.test.ts` (modify) | Imports the helpers from `harness.ts` instead of defining them. |
| `packages/cards/test/scenarios/{cloud-turn,combat-tricks,ramuh-in-a-window,end-phase}.test.ts` (new) | Layer 3: scripted games on the shipped card definitions with golden event sequences. |
| `docs/superpowers/specs/2026-09-08-rules-conformance-audit.md` (modify) | Starred rows refreshed; note pointing at the matrix. |

---

### Task 1: The two missing markers

**Files:**
- Modify: `packages/engine/src/phases.ts` (the Active Phase activation, near line 20–40 — find `status: 'active'` in the per-turn activation)
- Modify: `packages/engine/src/cast.ts` (`castCheck`'s "Main Phase with priority and an empty stack" refusal for Characters, near line 12–23)

**Interfaces:** none. Comments only.

- [ ] **Step 1: Find the two sites**

Run: `grep -n "status: 'active'" packages/engine/src/phases.ts; grep -n "main1\|main2\|stackNotEmpty" packages/engine/src/cast.ts | head`

- [ ] **Step 2: Add the Freeze marker** immediately above the line in `phases.ts` that activates the turn player's dull cards:

```ts
  // MVP0-SIMPLIFICATION (§15.2.4 Freeze): there is no frozen status, so every dull Character activates here.
  // §15.2.4.2 says a frozen Forward skips its controller's next Active Phase. Rung J3 adds the status.
```

- [ ] **Step 3: Add the Back Attack marker** immediately above the Character-cast phase/stack check in `cast.ts`:

```ts
  // MVP0-SIMPLIFICATION (§15.2.5 Back Attack): a Character with Back Attack may be cast by the priority holder in
  // either player's Main or Attack Phase (§15.2.5.2). No pool card prints it; the keyword is never consulted here.
```

- [ ] **Step 4: Verify** `pnpm typecheck && pnpm lint` pass and `grep -c MVP0-SIMPLIFICATION packages/engine/src/phases.ts packages/engine/src/cast.ts` shows each file gained one.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/phases.ts packages/engine/src/cast.ts
git commit -m "docs(engine): mark Freeze and Back Attack as the simplifications they are (J9)"
```

---

### Task 2: The matrix and its meta-test

**Files:**
- Create: `docs/rules/timing-matrix.md`
- Create: `packages/engine/test/timing-matrix.test.ts`

**Interfaces:**
- Produces: the matrix format below, which Tasks 3–5 add rows to. The meta-test exports nothing.

- [ ] **Step 1: Write the meta-test first** (it must fail until the matrix exists):

```ts
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Rung J9: the timing matrix (docs/rules/timing-matrix.md) is a claim about which timing rules of CR 3.3 have a
 * test. This keeps the claim honest, the way rules-citations keeps citations honest: every in-scope subsection
 * has a row; every row's section exists; every `tested` row cites a describe/it that exists; every `simplified`
 * row names a source file that carries a MVP0-SIMPLIFICATION marker.
 */

const ROOT = resolve(import.meta.dirname, '../../..')
const MATRIX = join(ROOT, 'docs/rules/timing-matrix.md')
const INDEX = join(ROOT, 'docs/rules/cr-3.3-sections.txt')
/** The chapters and sections the matrix covers (spec J9-D1). A section is in scope when it equals or is under one of these. */
export const SCOPE = ['9', '10', '11.1', '11.3', '11.4', '11.6', '11.7', '11.8', '11.10', '11.11', '12', '15.1.1.9', '15.2.1', '15.2.2', '15.2.3', '15.2.4', '15.2.5']
const STATUSES = new Set(['heading', 'tested', 'simplified', 'n/a'])
const PKG_DIRS: Record<string, string> = { engine: 'packages/engine/test', cards: 'packages/cards/test', web: 'apps/web/test' }

export interface Row { section: string; rule: string; status: string; tests: string; line: number }

export function parseMatrix(text: string): Row[] {
  const rows: Row[] = []
  text.split('\n').forEach((line, i) => {
    if (!line.startsWith('| ')) return
    const cells = line.slice(1, line.endsWith('|') ? -1 : undefined).split(' | ').map((c) => c.trim())
    if (cells.length < 4 || cells[0] === '§' || /^-+$/.test(cells[0] ?? '')) return
    rows.push({ section: cells[0]!, rule: cells[1]!, status: cells[2]!, tests: cells[3]!, line: i + 1 })
  })
  return rows
}

const inScope = (n: string): boolean => SCOPE.some((p) => n === p || n.startsWith(p + '.'))

function testFile(ref: string): string | null {
  const [pkg, ...rest] = ref.split('/')
  const dir = PKG_DIRS[pkg ?? '']
  if (!dir) return null
  for (const ext of ['.test.ts', '.test.tsx']) {
    const p = join(ROOT, dir, rest.join('/') + ext)
    if (existsSync(p)) return p
  }
  return null
}
const TEST_LINE = /\b(describe|it)(\.\w+)?(\([^)]*\))?\(/

/** Every problem with `rows`, as one string each; empty when the matrix is truthful. Pure, so fixtures can probe it. */
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
  })

  it('the SCOPE reaches at least 180 sections of the index', () => {
    expect([...loadIndex()].filter(inScope).length).toBeGreaterThan(180)
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run packages/engine/test/timing-matrix.test.ts`
Expected: the first test fails on `docs/rules/timing-matrix.md` → `expected false to be true`; the fixture test passes (it is pure); the scope test passes.

- [ ] **Step 3: Write the matrix.** Rows below are the plan's classification; the meta-test is the referee. Where a fragment does not match (the referee says `names no describe/it`), fix the FRAGMENT to a substring that exists in that file — never the test. Rows citing `engine/timing-l1-priority`, `engine/timing-l2-compositions` or `cards/scenarios/…` will fail until Tasks 3–5 land: leave them in and expect the meta-test to go green at the end of Task 5, or temporarily mark them `n/a | pending Task N` and flip them in that task (either is fine; the second keeps every commit green and is preferred).

```markdown
# Timing matrix — CR 3.3 chapters 9–12 and the combat/keyword parts of 15, mapped to tests

Rung J9 (spec `docs/superpowers/specs/2026-09-16-rung-j9-timing-matrix.md`). One row per subsection of the
section index for chapters 9, 10, 11 (11.1, 11.3, 11.4, 11.6, 11.7, 11.8, 11.10, 11.11), 12, and 15.1.1.9,
15.2.1–15.2.5. Checked by `packages/engine/test/timing-matrix.test.ts`.

Status: `heading` (a title with sub-rows), `tested` (cites `pkg/file#fragment` refs), `simplified` (names the
source file carrying the `MVP0-SIMPLIFICATION` marker, optionally plus refs for what IS tested), `n/a` (unreachable
with the pool, with the reason). The `rule` column paraphrases; the rules text is Square Enix's.

| § | rule | status | tests |
|---|---|---|---|
| 9 | Game Phases | heading |  |
| 9.1 | Active Phase | heading |  |
| 9.1.1 | The turn player's Characters activate, in the order below | tested | engine/cr9-phases#§9.1 active phase |
| 9.1.1.1 | The turn player activates all their dull cards; a special action, no stack | tested | engine/cr9-phases#activates all of the turn player |
| 9.1.1.2 | Nobody holds priority in the Active Phase; triggers wait for the next priority grant | tested | engine/timing-l1-priority#§9.1.1.2 |
| 9.2 | Draw Phase | heading |  |
| 9.2.1 | The turn player draws, in the order below | tested | engine/cr9-phases#draws 2 |
| 9.2.1.1 | Draws two; a special action | tested | engine/cr9-phases#draws 2 |
| 9.2.1.2 | Nobody holds priority in the Draw Phase | tested | engine/timing-l1-priority#§9.2.1.2 |
| 9.2.1.3 | The first player draws one on their first turn | tested | engine/cr9-phases#§9.2.1.3 |
| 9.3 | Main Phase | heading |  |
| 9.3.1 | Actions in the order below | heading |  |
| 9.3.1.1 | Main Phase 1 precedes the Attack Phase, Main Phase 2 follows it; extra Main Phases are Main Phase 2 | tested | engine/cr9-phases#main1 → attack declaration → main2 |
| 9.3.1.2 | The Main Phase ends when the stack is empty and both players forfeit | tested | engine/cr9-phases#J1-A1 |
| 9.3.1.3 | "At the beginning of the Main Phase" triggers, and pending triggers, go on the stack | n/a | no pool card prints it and the AST has no such trigger kind |
| 9.3.1.4 | The turn player gains priority | tested | engine/cr9-phases#the first pass hands priority to the opponent |
| 9.3.1.5 | Characters are cast by the turn player with priority and an empty stack; a special action | tested | engine/cr11-stack#J1-A5 |
| 9.3.1.6 | Summons need priority; Main and Attack Phase only | tested | engine/cr11.4-cast#§9.3.1.6 |
| 9.3.1.7 | Action and special abilities need priority; Main and Attack Phase only | tested | engine/activated-abilities#§9.3.1.7 |
| 9.4 | Attack Phase | heading |  |
| 9.4.1 | The turn player attacks with Forwards; see chapter 10 | heading |  |
| 9.5 | End Phase | heading |  |
| 9.5.1 | Processes at the end of the turn, below | heading |  |
| 9.5.1.1 | "Beginning of the End Phase" / "end of the turn" triggers go on the stack; the turn player gains priority; no Summons or action abilities | simplified | packages/engine/src/phases.ts |
| 9.5.1.2 | Discard down to the hand size; a special action | tested | engine/cr9-phases#§9.5.1.2 |
| 9.5.1.3 | Then, simultaneously: | heading |  |
| 9.5.1.3.1 | All damage on field cards is removed | tested | engine/cr9-phases#§9.5.1.3 |
| 9.5.1.3.2 | "Until the end of the turn" effects stop | tested | engine/abilities-engine#§9.5.1.3.2; engine/timing-l2-compositions#§9.5.1.3.2 |
| 9.5.1.4 | Then rule processes and waiting triggers; the turn player gains priority; after both forfeit, back to 9.5.1.3.1 | simplified | packages/engine/src/phases.ts |
| 9.5.1.5 | Nothing further: a new turn for the other player | tested | engine/cr9-phases#main1 → attack declaration → main2 |
| 10 | Attack Phase | heading |  |
| 10.1 | Carried out as follows | heading |  |
| 10.1.1 | Attack Preparation Step | heading |  |
| 10.1.1.1 | "Beginning of the Attack Phase" triggers go on the stack | tested | cards/abilities#At the beginning of the Attack Phase |
| 10.1.1.2 | The turn player gains priority; either player may cast a Summon or use an ability | tested | engine/cr11-stack#the non-turn player may activate in the Attack Preparation window |
| 10.1.2 | Attack Declaration Step | heading |  |
| 10.1.2.1 | The turn player declares one Forward, or a same-element party | tested | engine/cr10-attack#§10.1.2.1 |
| 10.1.2.1.1 | Attackers must be active, and have Haste or have been controlled since the turn began | tested | engine/cr10-attack#a forward controlled since the start of the turn |
| 10.1.2.1.2 | And legally able: not attacked this turn, not prevented | tested | engine/cr10-attack#dull forwards and forwards that already attacked |
| 10.1.2.1.3 | Forwards that must attack keep the phase open | n/a | no pool card compels an attack |
| 10.1.2.2 | Legal attackers dull; Brave ones do not | tested | engine/cr10-attack#§10.1.2.2 |
| 10.1.2.3 | Attack costs are locked at declaration | n/a | no pool card has an attack cost |
| 10.1.2.4 | The Forward is now attacking | tested | engine/cr10-attack#§10.1.2.2 |
| 10.1.2.5 | Triggers caused by the attacking Forward go on the stack | n/a | no pool card prints "when attacks"; the AST has no such trigger |
| 10.1.2.6 | The turn player gains priority (the `declared` window) | tested | engine/cr10-attack-windows#declaring an attack opens the |
| 10.1.2.7 | No attackers: skip the block and damage steps | tested | engine/cr9-phases#main1 → attack declaration → main2 |
| 10.1.3 | Block Declaration Step | heading |  |
| 10.1.3.1 | The defender may block with one Forward, or not | tested | engine/cr10-attack#only the defender may block |
| 10.1.3.1.1 | The blocker must be active | tested | engine/cr10-attack#only the defender may block |
| 10.1.3.1.2 | Block limitations | n/a | none in the pool |
| 10.1.3.1.3 | Compulsory blocks and block costs | n/a | none in the pool |
| 10.1.3.2 | If still controlled by the defender, it is blocking | tested | engine/cr10-attack-windows#declaring a block opens the |
| 10.1.3.2.1 | Attacker and blocker are in battle; one leaving ends it | tested | engine/cr10-attack-windows#§10.1.3.3 |
| 10.1.3.3 | A blocker or attacker removed during the step takes no damage | tested | engine/cr10-attack-windows#§10.1.3.3 |
| 10.1.3.4 | A party is blocked as one Character | tested | engine/cr10-attack#§10.1.3.4 |
| 10.1.3.5 | Triggers caused by the block go on the stack | n/a | no pool card prints "when blocks"; the AST has no such trigger |
| 10.1.3.6 | The turn player gains priority (the `blocked` window) | tested | engine/cr10-attack-windows#J1-A3 |
| 10.1.4 | Damage Resolution Step | heading |  |
| 10.1.4.1 | Unblocked: one point of damage to the opponent | tested | engine/cr10-attack#§10.1.4.1 |
| 10.1.4.2 | Blocked: each deals its power to the other as battle damage | tested | engine/cr10-attack#§10.1.4.2 |
| 10.1.4.2.1 | Against a party, the blocker splits its damage in multiples of 1000 | tested | engine/cr10-attack#§10.1.4.2.1; engine/party-damage#C2-A6 |
| 10.1.4.3 | Damage triggers go on the stack | tested | engine/observer-triggers#C2-A4; engine/party-damage#C2-A8 |
| 10.1.4.4 | The turn player gains priority (the `damage` window) | tested | engine/cr10-attack-windows#declaring a block opens the |
| 10.1.4.5 | The party disbands | tested | engine/cr10-attack#an unblocked party |
| 10.1.4.6 | Another attack, or Main Phase 2 | tested | engine/timing-l1-priority#§10.1.4.6 |
| 11 | Casting Cards and Using Abilities | heading |  |
| 11.1 | Priority | heading |  |
| 11.1.1 | The priority holder may cast or use | tested | engine/cr11.4-cast#§9.3.1.6; engine/activated-abilities#§9.3.1.7 |
| 11.1.2 | The turn player gains priority once start-of-step triggers are placed | tested | cards/abilities#At the beginning of the Attack Phase |
| 11.1.3 | Rule processes resolve before priority, repeated until none | tested | engine/cr12-field-limits#runs it: an; engine/observer-triggers#C2-A5 |
| 11.1.4 | On gaining priority, triggers go on the stack, repeated until none | tested | engine/cr11-stack#J1-A4; engine/observer-triggers#C2-A9 |
| 11.1.5 | After a Summon or ability resolves, the turn player gains priority | tested | engine/timing-l1-priority#§11.1.5 |
| 11.1.6 | Forfeit: the opponent gains priority | tested | engine/cr9-phases#J1-A1 |
| 11.1.7 | Both forfeit: the top of the stack resolves, or the step ends | tested | engine/cr9-phases#J1-A1; engine/cr11-stack#J1-A2 |
| 11.3 | Casting a Summon | heading |  |
| 11.3.1 | Hand to stack with the cost paid; an illegal cast rewinds | tested | engine/cr11-stack#J1-A2; engine/legal-apply#invariant |
| 11.3.2 | Declared, revealed, moved to the top of the stack under the caster | tested | engine/cr11-stack#J1-A2 |
| 11.3.3 | "Choose" needs a legal target or it cannot be cast | tested | engine/cr11-stack#§11.3.3 |
| 11.3.4 | Modal Summons declare their mode | tested | cards/abilities#20-103H Ramuh |
| 11.3.4.1 | The number of selectable effects is fixed at declaration | n/a | no pool Summon varies its mode count |
| 11.3.5 | Cost references, alternative and variable costs, fixed at declaration | tested | cards/abilities#13-072R Odin — "If you have received 5 points |
| 11.3.6 | Effects applying differently to several cards or players | n/a | none in the pool |
| 11.3.7 | The cost is locked | tested | cards/abilities#13-072R Odin — "If you have received 5 points |
| 11.3.7.1 | Paid all at once | tested | engine/cr11.2-cp#§11.2.2 paying a cost |
| 11.3.8 | The cast completes; cast-triggers fire; the caster regains priority | tested | engine/timing-l1-priority#§11.3.8 |
| 11.3.9 | All targets ineligible at resolution: cancelled | tested | engine/cr11-stack#J1-A7 |
| 11.3.10 | "Power becomes N" sets the base power | n/a | none in the pool |
| 11.3.11 | A Summon cast by an effect is cast right after it | n/a | none in the pool |
| 11.4 | Casting a Character | heading |  |
| 11.4.1 | With priority, in a Main Phase, with an empty stack; a special action, uninterruptible | tested | engine/cr11-stack#J1-A5 |
| 11.4.1.1 | Cast by an effect: right after it, no stack | n/a | Hugh Yurg PLAYS a card onto the field, which is not a cast; no pool card casts one |
| 11.4.2 | Declared and revealed | tested | engine/cr11.4-cast#§11.4 casting a Character |
| 11.4.3 | Modal Characters | n/a | none in the pool |
| 11.4.4 | Cost references, alternative and variable costs | n/a | none in the pool |
| 11.4.5 | Effects applying differently | n/a | none in the pool |
| 11.4.6 | The cost is locked | tested | engine/cr11.4-cast#a Forward enters the field active |
| 11.4.6.1 | Payment per §11.2 | tested | engine/cr11.4-cast#rejects insufficient or wrong-element payment |
| 11.4.7 | Enters the field; its ETB triggers go on the stack; the turn player gains priority | tested | engine/cr11-stack#J1-A4 |
| 11.6 | Action Abilities | heading |  |
| 11.6.1 | An effect for a cost | tested | engine/activated-abilities#C3-A2 |
| 11.6.2 | Written "(cost): (effect)" | tested | engine/activated-abilities#renders the printed cost |
| 11.6.2.1 | The text before the colon is the cost | tested | engine/activated-abilities#renders the printed cost |
| 11.6.2.2 | Dull-icon costs need control since the turn began, or Haste | tested | engine/activated-abilities#§11.6.2.2 |
| 11.6.2.3 | Dull/break costs use your own Characters | tested | engine/activated-abilities#a [Dull] cost needs an ACTIVE source |
| 11.6.2.4 | Remove/return costs need a Character you could otherwise remove or return | tested | cards/abilities#19-052C Undead Princess — "Remove |
| 11.6.3 | Put on the stack and the cost paid; a failed activation rewinds | tested | engine/cr10-attack-windows#J1-A3; engine/activated-abilities#is ILLEGAL |
| 11.6.4 | Declared, revealed from a hidden zone, on top of the stack under the activator | tested | engine/activated-abilities#honours sourceZone; engine/cr10-attack-windows#J1-A3 |
| 11.6.5 | "Choose" needs a legal target | tested | engine/activated-abilities#is ILLEGAL |
| 11.6.6 | Modal action abilities declare the mode | n/a | none in the pool |
| 11.6.6.1 | The mode count is fixed | n/a | none in the pool |
| 11.6.7 | Cost references, alternative and variable costs | n/a | none in the pool |
| 11.6.8 | Effects applying differently | n/a | none in the pool |
| 11.6.9 | The cost is locked | tested | engine/activated-abilities#the source may not pay its own CP cost |
| 11.6.10 | Paid all at once | tested | engine/activated-abilities#C3-A2 |
| 11.6.11 | Activated; activation-triggers go on the stack; the activator regains priority | tested | engine/cr10-attack-windows#J1-A3 |
| 11.6.12 | All targets ineligible at resolution: cancelled | tested | engine/cr11-stack#J1-A7 |
| 11.7 | Special Abilities | heading |  |
| 11.7.1 | Like action abilities plus a same-name discard; the S icon | n/a | none in the pool |
| 11.7.2 | Written "(cost): (effect)" | n/a | none in the pool |
| 11.7.2.1 | The text before the colon is the cost | n/a | none in the pool |
| 11.7.2.2 | Dull-icon costs need control since the turn began, or Haste | n/a | none in the pool |
| 11.7.2.3 | Dull/break costs use your own Characters | n/a | none in the pool |
| 11.7.2.4 | Remove/return costs | n/a | none in the pool |
| 11.7.3 | Put on the stack and the cost paid; a failed activation rewinds | n/a | none in the pool |
| 11.7.4 | Declared, revealed, on top of the stack under the activator | n/a | none in the pool |
| 11.7.5 | "Choose" needs a legal target | n/a | none in the pool |
| 11.7.6 | Modal special abilities | n/a | none in the pool |
| 11.7.6.1 | The mode count is fixed | n/a | none in the pool |
| 11.7.7 | Cost references, alternative and variable costs | n/a | none in the pool |
| 11.7.8 | Effects applying differently | n/a | none in the pool |
| 11.7.9 | The cost is locked | n/a | none in the pool |
| 11.7.10 | Paid all at once | n/a | none in the pool |
| 11.7.11 | Activated; triggers go on the stack; the activator regains priority | n/a | none in the pool |
| 11.7.12 | All targets ineligible at resolution: cancelled | n/a | none in the pool |
| 11.8 | Auto-Abilities | heading |  |
| 11.8.1 | Trigger automatically on their event | tested | engine/observer-triggers#C2-A2 |
| 11.8.2 | Written "(trigger), (effect)" | tested | cards/pool-coverage#implements every printed clause |
| 11.8.3 | Trigger at the event, even in phases where nothing can be cast | tested | engine/observer-triggers#C2-A2; engine/timing-l1-priority#§9.1.1.2 |
| 11.8.4 | Trigger even with no legal target, then leave the stack at once | tested | engine/cr11-stack#§11.8.4 |
| 11.8.5 | The controller is the source's controller | tested | engine/observer-triggers#opponent controls |
| 11.8.6 | Once per occurrence of the event | tested | engine/observer-triggers#C2-A3 |
| 11.8.7 | Do nothing when triggered; placed when priority is next gained, the turn player's in their order, then the non-turn player's | simplified | packages/engine/src/resolve.ts; engine/cr11-stack#§11.8.7 |
| 11.8.8 | Cost references are locked at placement | n/a | none in the pool |
| 11.8.9 | "Choose" needs a legal target | tested | engine/cr11-stack#§11.8.4 |
| 11.8.10 | Modal auto-abilities declare the mode | tested | cards/abilities#12-120C Shantotto; engine/party-damage#C2-A8 |
| 11.8.10.1 | The mode count is fixed | n/a | no pool card varies it |
| 11.8.10.2 | No selectable mode: it does not trigger | n/a | none in the pool |
| 11.8.11 | Variable costs | n/a | none in the pool |
| 11.8.12 | Effects applying differently | n/a | none in the pool |
| 11.8.13 | Conditional auto-abilities check at trigger and at resolution | n/a | none in the pool |
| 11.8.14 | "You may": placed regardless, decided at resolution | tested | cards/abilities#24-063H Hugh Yurg — "you may search |
| 11.8.15 | Only when the event actually occurs; a replaced event does not trigger | tested | engine/activated-abilities#a self-break cost is a zone movement but NOT a break |
| 11.8.16 | Zone movement triggers | tested | engine/observer-triggers#C2-A2 |
| 11.8.16.1 | Fail when the card did not reach the zone | n/a | none in the pool |
| 11.8.16.2 | A search whose card does not reach the zone fails | n/a | none in the pool |
| 11.8.16.2.1 | Enter-the-field triggers; every field card is checked | tested | cards/abilities#24-063H Hugh Yurg — "When a Forward of cost 1 enters your field |
| 11.8.17 | Delayed auto-abilities | n/a | none in the pool; no AST node |
| 11.8.17.1 | Generated by resolving; not triggered before they exist | n/a | none in the pool |
| 11.8.17.2 | Trigger once unless given a duration | n/a | none in the pool |
| 11.8.17.3 | Follow the card until it leaves its zone | n/a | none in the pool |
| 11.8.17.4 | Source and controller when a Summon generates one | n/a | none in the pool |
| 11.8.17.5 | Source and controller when an ability generates one | n/a | none in the pool |
| 11.8.17.6 | Source and controller when a replacement effect generates one | n/a | none in the pool |
| 11.8.18 | State-based triggers fire when the condition is met and not again until resolved | n/a | none in the pool |
| 11.8.19 | All targets ineligible at resolution: cancelled | tested | engine/cr11-stack#J1-A7 |
| 11.10 | EX Burst | heading |  |
| 11.10.1 | Marked cards carry their whole information | tested | engine/cr12-rules#§11.10 |
| 11.10.2 | Offered when dealt as damage; optional; cannot be responded to | tested | engine/cr10-attack-windows#J1-A8; engine/cr12-rules#§11.10 |
| 11.10.3 | Summons apply all their effects; Characters only the marked clauses | tested | cards/abilities#13-072R Odin — "EX BURST; engine/cr12-rules#ignores a marked clause |
| 11.11 | Resolving Summons and abilities | heading |  |
| 11.11.1 | Both forfeit: the top of the stack resolves | tested | engine/cr11-stack#J1-A2 |
| 11.11.2 | All chosen targets invalid: cancelled | tested | engine/cr11-stack#J1-A7 |
| 11.11.2.1 | Some still valid: applies to those | tested | engine/cr11-stack#an item whose declared target is still there |
| 11.11.3 | Conditional auto-abilities re-check | n/a | none in the pool |
| 11.11.4 | A moved source is read as it was before it left | simplified | packages/engine/src/resolve.ts |
| 11.11.5 | The controller resolves per the text | tested | engine/abilities-engine#choices suspend the frame |
| 11.11.5.1 | Choices not declared at cast are made at resolution | tested | engine/abilities-engine#a nested chooseModes → chooseTargets chain |
| 11.11.5.1.1 | Still legal targets | tested | engine/abilities-engine#apply re-derives the candidates |
| 11.11.6 | Both players choose: the turn player first, then simultaneous | n/a | none in the pool |
| 11.11.7 | A moved card is read as it was before it left | simplified | packages/engine/src/resolve.ts |
| 11.11.8 | An instructed action is done by the source card | tested | engine/observer-triggers#C2-A4 |
| 11.11.9 | Variables declared once | n/a | none in the pool |
| 11.11.10 | A resolved Summon goes to its owner's Break Zone; abilities cease | tested | engine/cr11-stack#J1-A2 |
| 12 | Rule Processes | heading |  |
| 12.1 | Performed when their condition is met | tested | engine/cr12-rules#§12.4 rule processes |
| 12.2 | Nobody controls them | tested | engine/cr12-field-limits#J4-A1 |
| 12.3 | Checked when priority is gained; simultaneous; repeated; then triggers are placed; then priority | tested | engine/observer-triggers#C2-A5; engine/cr12-field-limits#runs it: an |
| 12.4 | The processes: | heading |  |
| 12.4.1 | Seven damage loses | tested | engine/cr12-rules#§12.4.1 |
| 12.4.2 | Drawing from an empty deck loses | tested | engine/cr9-phases#§3.1.2 |
| 12.4.3 | Damage beyond the deck loses | tested | engine/cr12-rules#§3.1.3 |
| 12.4.4 | Zero or less power: to the owner's Break Zone | tested | engine/cr12-rules#§12.4.4 |
| 12.4.5 | Damage at or above power breaks; the damage source is credited | tested | engine/cr12-rules#§12.4.5; engine/observer-triggers#C2-A5 |
| 12.4.6 | Two same-name non-generic Characters: both to the Break Zone | tested | engine/cr12-field-limits#J4-A1 |
| 12.4.7 | Two Light/Dark Characters: all to the Break Zone | tested | engine/cr12-field-limits#J4-A2 |
| 12.4.8 | Six Backups: down to five | tested | engine/cr12-field-limits#J4-A3 |
| 15.1.1.9 | Form a Party | heading |  |
| 15.1.1.9.1 | Two or more Forwards attack as one | tested | engine/cr10-attack#§10.1.2.1 |
| 15.1.1.9.2 | Same element only | tested | engine/cr10-attack#§10.1.2.1 |
| 15.1.1.9.3 | Only Forwards that could attack alone | tested | engine/cr10-attack#dull forwards and forwards that already attacked |
| 15.1.1.9.4 | Any number of Forwards | tested | engine/timing-l1-priority#§15.1.1.9.4 |
| 15.1.1.9.5 | Down to one Forward, it is no longer a party | tested | engine/cr10-attack-windows#a party reduced to one |
| 15.1.1.9.6 | Blockable if any member is; the whole party is blocked | tested | engine/cr10-attack#§10.1.3.4 |
| 15.1.1.9.7 | First Strike damage only if every member has it | simplified | packages/engine/src/attack.ts |
| 15.1.1.9.8 | Each member checks it may damage the blocker; any break credits them all | tested | engine/cr10-attack#§10.1.4.2.1 |
| 15.1.1.9.9 | Disbands at the next declaration or when the phase ends | tested | engine/cr10-attack#an unblocked party |
| 15.1.1.9.10 | Ability damage by a member counts as the party's, sourced to that member | n/a | no pool card reads party damage |
| 15.2.1 | Brave | heading |  |
| 15.2.1.1 | A field ability changing the declaration step | tested | engine/cr10-attack#§10.1.2.2 |
| 15.1.2 | (not in scope) | heading |  |
| 15.2.1.2 | Does not dull when attacking; still once per turn | tested | engine/cr10-attack#§10.1.2.2 |
| 15.2.2 | Haste | heading |  |
| 15.2.2.1 | A field ability | tested | engine/cr10-attack#a forward controlled since the start of the turn |
| 15.2.2.2 | May attack the turn it arrives | tested | engine/cr10-attack#a forward controlled since the start of the turn |
| 15.2.2.3 | May pay a dull-icon cost the turn it arrives | tested | engine/activated-abilities#§11.6.2.2 |
| 15.2.3 | First Strike | heading |  |
| 15.2.3.1 | A field ability changing the damage step | simplified | packages/engine/src/attack.ts |
| 15.2.3.2 | First Strike Forwards deal damage first, then the rest | simplified | packages/engine/src/attack.ts |
| 15.2.3.3 | A priority window between the two, with no casts; triggers wait for the second | simplified | packages/engine/src/attack.ts |
| 15.2.3.4 | A party needs First Strike on every member | simplified | packages/engine/src/attack.ts |
| 15.2.4 | Freeze | heading |  |
| 15.2.4.1 | An ongoing effect applied by Summons and abilities | simplified | packages/engine/src/phases.ts |
| 15.2.4.2 | Frozen Forwards skip their controller's next Active Phase | simplified | packages/engine/src/phases.ts |
| 15.2.5 | Back Attack | heading |  |
| 15.2.5.1 | A Character field ability | simplified | packages/engine/src/cast.ts |
| 15.2.5.2 | Cast with priority in either player's Main or Attack Phase | simplified | packages/engine/src/cast.ts |
| 15.2.5.3 | Cast as a response | simplified | packages/engine/src/cast.ts |
| 15.2.5.4 | No stack: cannot be prevented by Summons or abilities | simplified | packages/engine/src/cast.ts |
```

Remove the stray `| 15.1.2 | (not in scope) | heading |  |` line above before saving: it is not a section and the referee will say so. (It is here so the plan's own referee step is exercised at least once.)

- [ ] **Step 4: Run the meta-test and fix fragments until only the pending-task rows fail**

Run: `pnpm vitest run packages/engine/test/timing-matrix.test.ts`
Expected: failures name only rows citing `engine/timing-l1-priority`, `engine/timing-l2-compositions` (files that do not exist yet). Any other failure is a fragment to correct. If you chose to mark those rows `n/a | pending Task 3` for now, expected: PASS.

- [ ] **Step 5: Add the meta-test's scope to the citations skip list?** No: `rules-citations` scans `docs/superpowers/specs`, `packages`, `apps` and `README.md`, not `docs/rules`, so the matrix's `§` cells are not double-checked there. Nothing to do.

- [ ] **Step 6: Commit**

```bash
git add docs/rules/timing-matrix.md packages/engine/test/timing-matrix.test.ts
git commit -m "test(engine): the timing matrix — every CR timing rule mapped to a test, with a referee (J9-A1)"
```

---

### Task 3: Layer 1 — the untested primitives

**Files:**
- Create: `packages/engine/test/timing-l1-priority.test.ts`
- Modify: `docs/rules/timing-matrix.md` (flip any `pending Task 3` rows to `tested`)

**Interfaces:**
- Consumes: `endPhase`, `makeGame`, `passBoth`, `withField`, `withHand`, `withHandSize` from `packages/engine/test/helpers.ts`; `apply` from `../src/apply.js`; `legalCommands` from `../src/legal.js`; `checkInvariants` from `../src/invariants.js`; `findFieldCard` from `../src/state.js`.
- Produces: `it` names containing `§9.1.1.2`, `§9.2.1.2`, `§10.1.4.6`, `§11.1.5`, `§11.3.8`, `§15.1.1.9.4` (the matrix cites them by section).

Facts the tests rely on: the vanilla pool is earth by default; `V-F2` is a 5000 earth Forward, `V-F8` a 9000 lightning one; `V-S2` is a cost-1 earth Summon payable by discarding one `V-F1`; `makeGame()` starts turn 1 with player 0 in `main1`; the caster of a Summon regains priority (§11.3.8) which the engine implements as `priority` staying with the caster.

- [ ] **Step 1: Write the file**

```ts
import { describe, expect, it } from 'vitest'
import type { CardId, GameState } from '../src/state.js'
import { findFieldCard } from '../src/state.js'
import { apply } from '../src/apply.js'
import { legalCommands } from '../src/legal.js'
import { checkInvariants } from '../src/invariants.js'
import { endPhase, makeGame, passBoth, withField, withHand, withHandSize } from './helpers.js'

/**
 * Rung J9, Layer 1: timing primitives the matrix found untested, each alone, on the vanilla pool. Driven through
 * `apply` and real passes, never `applyNow`, because the priority grants between the moves are what is under test.
 */

const ok = (s: GameState) => expect(checkInvariants(s)).toEqual([])
const NO_PAY = { dullBackups: [], discards: [] }
const quiet = (s: GameState): GameState => withHandSize(withHandSize(s, 0, 0), 1, 0)

describe('L1 — phases nobody can act in (§9.1.1.2, §9.2.1.2)', () => {
  it('L1 §9.1.1.2 §9.2.1.2 — the pass that ends a turn lands in the next Main Phase 1: no position in the Active or Draw Phase is ever the acting position', () => {
    let s = quiet(makeGame())
    s = endPhase(endPhase(s))                       // main1 → declaration → main2
    expect(s.phase).toBe('main2')
    const r = passBoth(s)                           // main2 → end → (active, draw) → main1 of turn 2, in ONE apply
    expect(r.state.turn).toBe(2)
    expect(r.state.phase).toBe('main1')
    expect(r.state.turnPlayer).toBe(1)
    expect(r.state.priority, '§9.3.1.4: the new turn player holds priority').toBe(1)
    const started = r.events.filter((e) => e.type === 'phaseStarted').map((e) => e.phase)
    expect(started.at(-1), 'the last phase the events report is the Main Phase').toBe('main1')
    expect(started, 'the Active and Draw Phases never wait for a command').not.toContain('active')
    ok(r.state)
  })
})

describe('L1 — a second attack in one turn (§10.1.4.6)', () => {
  it('L1 §10.1.4.6 — after the damage window the turn player may attack again with a Forward that has not attacked, or pass to Main Phase 2', () => {
    let s = quiet(endPhase(makeGame()))
    let a: CardId, b: CardId
    ;[s, a] = withField(s, 0, 'forwards', 'V-F2')
    ;[s, b] = withField(s, 0, 'forwards', 'V-F2')
    expect(s.attack?.step).toBe('declaration')
    let r = apply(s, { type: 'declareAttack', player: 0, attackers: [a] }).state
    r = passBoth(r).state                                       // `declared` window → the block is owed
    expect(r.pending).toEqual({ kind: 'declareBlock', player: 1 })
    r = apply(r, { type: 'declareBlock', player: 1, blocker: null }).state
    r = passBoth(r).state                                       // `blocked` window → one point of damage → `damage` window
    expect(r.attack?.step).toBe('damage')
    expect(r.players[1].damage).toHaveLength(1)
    r = passBoth(r).state                                       // `damage` window → back to the declaration step
    expect(r.phase).toBe('attack'); expect(r.attack?.step).toBe('declaration')
    const again = legalCommands(r, 0).filter((c) => c.type === 'declareAttack').map((c) => c.attackers)
    expect(again, 'only the Forward that has not attacked may be declared').toEqual([[b]])
    const second = apply(r, { type: 'declareAttack', player: 0, attackers: [b] }).state
    expect(second.attack?.step).toBe('declared')
    ok(second)
    // Passing at the declaration step instead ends the phase (§10.1.4.6 "otherwise, proceed to Main Phase 2").
    expect(passBoth(r).state.phase).toBe('main2')
  })
})

describe('L1 — who holds priority after a resolution (§11.1.5, §11.3.8)', () => {
  it('L1 §11.1.5 §11.3.8 — the non-turn player casts a Summon and regains priority; when it resolves, the TURN player gains priority with the forfeit count reset', () => {
    let s = quiet(makeGame())
    for (const code of ['V-S2', 'V-F1']) [s] = withHand(s, 1, code)
    s = apply(s, { type: 'pass', player: 0 }).state             // §11.1.6: player 1 holds priority in player 0's Main Phase 1
    expect(s.priority).toBe(1)
    const cast = legalCommands(s, 1).find((c) => c.type === 'castSummon')
    expect(cast, 'the non-turn player may cast a Summon with priority (§9.3.1.6)').toBeDefined()
    s = apply(s, cast!).state
    expect(s.stack).toHaveLength(1)
    expect(s.priority, '§11.3.8: the caster regains priority').toBe(1)
    expect(s.passes).toBe(0)
    s = apply(s, { type: 'pass', player: 1 }).state
    const r = apply(s, { type: 'pass', player: 0 })
    expect(r.events.map((e) => e.type)).toContain('stackResolved')
    expect(r.state.stack).toEqual([])
    expect(r.state.phase).toBe('main1')
    expect(r.state.priority, '§11.1.5: the turn player, not the caster').toBe(0)
    expect(r.state.passes).toBe(0)
    ok(r.state)
  })
})

describe('L1 — a party of any size (§15.1.1.9.4)', () => {
  it('L1 §15.1.1.9.4 — three same-element Forwards attack as one party; a 9000 blocker splits its damage among them and takes the sum', () => {
    let s = quiet(endPhase(makeGame()))
    const party: CardId[] = []
    for (let i = 0; i < 3; i++) { let f: CardId; [s, f] = withField(s, 0, 'forwards', 'V-F2'); party.push(f) }
    let blocker: CardId
    ;[s, blocker] = withField(s, 1, 'forwards', 'V-F8')
    const declared = apply(s, { type: 'declareAttack', player: 0, attackers: party })
    expect(declared.events).toContainEqual({ type: 'attackDeclared', player: 0, attackers: party })
    let r = passBoth(declared.state).state
    r = apply(r, { type: 'declareBlock', player: 1, blocker }).state
    r = passBoth(r).state
    expect(r.pending, '§10.1.4.2.1: the blocker splits 9000 among the party').toEqual({ kind: 'assignPartyDamage', player: 1 })
    r = apply(r, { type: 'assignPartyDamage', player: 1, assignments: [{ target: party[0]!, amount: 5000 }, { target: party[1]!, amount: 4000 }] }).state
    expect(findFieldCard(r, blocker), '15000 into 9000: the blocker breaks').toBeNull()
    expect(findFieldCard(r, party[0]!), '5000 damage on a 5000: broken').toBeNull()
    expect(findFieldCard(r, party[1]!)?.card.damage).toBe(4000)
    expect(findFieldCard(r, party[2]!)?.card.damage).toBe(0)
    ok(r)
  })
})
```

- [ ] **Step 2: Run it**

Run: `pnpm vitest run packages/engine/test/timing-l1-priority.test.ts`
Expected: every test PASSES, because these are claims about behaviour the engine already has. If one FAILS, read the failure against the rules text quoted in the spec: (a) the test's expectation is wrong about the engine's event vocabulary or the fixture (e.g. `assignPartyDamage` is raised before the blocker's damage is dealt, or `phaseStarted` is not emitted for `main1`) — fix the test to assert the same rule through the right observable; (b) the engine is wrong — change the `it` to `it.fails`, keep the rules-derived assertion, add the section to the matrix as `simplified` naming the file that should carry a marker, add that marker with the section, and add a line to the audit's ladder. Do not fix the engine in this rung.

- [ ] **Step 3: Flip the matrix rows** citing `engine/timing-l1-priority` to `tested` if they were parked, and run `pnpm vitest run packages/engine/test/timing-matrix.test.ts` — expected: only `timing-l2-compositions` refs (if any remain parked) fail.

- [ ] **Step 4: Commit**

```bash
git add packages/engine/test/timing-l1-priority.test.ts docs/rules/timing-matrix.md
git commit -m "test(engine): Layer 1 — the timing primitives the matrix found untested (J9-A2)"
```

---

### Task 4: Layer 2 — compositions as event sequences

**Files:**
- Create: `packages/engine/test/timing-l2-compositions.test.ts`
- Modify: `docs/rules/timing-matrix.md` (flip parked rows; add `engine/timing-l2-compositions#…` refs to rows 11.1.4, 11.1.5, 11.10.2, 12.3 as noted below)

**Interfaces:**
- Consumes: as Task 3 plus `Ability`, `Effect` types from `../src/abilities.js`, `makeDef`, `VANILLA_POOL` from helpers, `powerOf` from `../src/abilities.js` (the single power authority; signature `powerOf(state, fieldCard)`), `isResponseWindow` from `../src/legal.js`.
- Produces: `it` names containing `§9.5.1.3.2`, `L2-a`, `L2-b`, `L2-d`, `L2-e`.

Synthetic cards (all cost 0, so `NO_PAY` casts them; all generic):
- `T-DMG` — a Summon: "Choose 1 Forward. Deal it 5000 damage."
- `T-PUMP` — a 1000 Forward with the Undead Princess shape: "Put this into the Break Zone: Choose 1 Forward. It gains +4000 power until the end of the turn."
- `T-WATCH` — a 1000 Forward: "When a Forward opponent controls is put from the field into the Break Zone, draw 1 card."
- `T-EX` — a 1000 Forward with `exBurst: true`: "EX BURST Choose 1 Forward. Break it."
- `T-BUFF` — a Summon: "Choose 1 Forward you control. It gains +4000 power until the end of the turn."

- [ ] **Step 1: Write the file**

```ts
import { describe, expect, it } from 'vitest'
import type { Ability } from '../src/abilities.js'
import { powerOf } from '../src/abilities.js'
import type { CardDef } from '../src/types.js'
import type { CardId, GameState } from '../src/state.js'
import { findFieldCard } from '../src/state.js'
import type { Event } from '../src/events.js'
import { apply } from '../src/apply.js'
import { isResponseWindow, legalCommands } from '../src/legal.js'
import { checkInvariants } from '../src/invariants.js'
import { endPhase, makeDef, makeGame, passBoth, withField, withHand, withHandSize, VANILLA_POOL } from './helpers.js'

/**
 * Rung J9, Layer 2: two timing rules on top of each other, each asserted as the exact ORDER of what happened —
 * a trace of event types with the cards named — because order is the whole claim. Synthetic cards; real passes.
 */

const ok = (s: GameState) => expect(checkInvariants(s)).toEqual([])
const NO_PAY = { dullBackups: [], discards: [] }
const quiet = (s: GameState): GameState => withHandSize(withHandSize(s, 0, 0), 1, 0)
const pass = (s: GameState, p: 0 | 1) => apply(s, { type: 'pass', player: p })

const DMG: Ability = {
  id: 'T-DMG:burn', trigger: { kind: 'summonResolve' }, text: 'Choose 1 Forward. Deal it 5000 damage.',
  effects: [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'any' }, then: [{ kind: 'damage', amount: 5000 }] }],
}
const BUFF: Ability = {
  id: 'T-BUFF:pump', trigger: { kind: 'summonResolve' }, text: 'Choose 1 Forward you control. It gains +4000 power until the end of the turn.',
  effects: [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'self' }, then: [{ kind: 'addPower', amount: 4000 }] }],
}
const PUMP: Ability = {
  id: 'T-PUMP:pump', trigger: { kind: 'activated', sourceZone: 'field', cost: { selfToBreakZone: true } },
  text: 'Put this into the Break Zone: Choose 1 Forward. It gains +4000 power until the end of the turn.',
  effects: [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'any' }, then: [{ kind: 'addPower', amount: 4000 }] }],
}
const WATCH: Ability = {
  id: 'T-WATCH:draw', trigger: { kind: 'observesZoneChange', from: 'field', to: 'breakZone', whose: 'opponent', of: 'forward' },
  text: 'When a Forward opponent controls is put from the field into the Break Zone, draw 1 card.',
  effects: [{ kind: 'draw', amount: 1 }],
}
const EX: Ability = {
  id: 'T-EX:burst', trigger: { kind: 'enterField' }, exBurst: true, text: 'EX BURST Choose 1 Forward. Break it.',
  effects: [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'any' }, then: [{ kind: 'breakCard' }] }],
}
const DEFS: CardDef[] = [
  ...VANILLA_POOL,
  makeDef({ code: 'T-DMG', type: 'summon', cost: 0, power: null, hasAbilities: true, abilityClauses: 1, abilities: [DMG] }),
  makeDef({ code: 'T-BUFF', type: 'summon', cost: 0, power: null, hasAbilities: true, abilityClauses: 1, abilities: [BUFF] }),
  makeDef({ code: 'T-PUMP', cost: 0, power: 1000, hasAbilities: true, abilityClauses: 1, abilities: [PUMP] }),
  makeDef({ code: 'T-WATCH', cost: 0, power: 1000, hasAbilities: true, abilityClauses: 1, abilities: [WATCH] }),
  makeDef({ code: 'T-EX', cost: 0, power: 1000, exBurst: true, hasAbilities: true, abilityClauses: 1, abilities: [EX] }),
]

/** The order of what happened, as short strings: only the event kinds the composition is about. */
function trace(events: readonly Event[], names: Record<number, string> = {}): string[] {
  const n = (id: number) => names[id] ?? String(id)
  const out: string[] = []
  for (const e of events) {
    switch (e.type) {
      case 'stackPushed': out.push(`push:${e.item.kind === 'summon' ? `summon:${n(e.item.card)}` : e.item.abilityId}`); break
      case 'stackResolved': out.push(`resolve:${e.item.kind === 'summon' ? `summon:${n(e.item.card)}` : e.item.abilityId}`); break
      case 'abilityTriggered': out.push(`trigger:${e.abilityId}`); break
      case 'powerModified': out.push(`power:${n(e.card)}:${e.amount > 0 ? '+' : ''}${e.amount}`); break
      case 'abilityDamage': out.push(`damage:${n(e.card)}`); break
      case 'broken': out.push(`broken:${n(e.card)}`); break
      case 'brokenByAbility': out.push(`broken:${n(e.card)}`); break
      case 'drew': out.push(`drew:${e.player}`); break
      case 'exBurstOffered': out.push('burst:offered'); break
      case 'exBurstUsed': out.push('burst:used'); break
      case 'playerDamaged': out.push(`playerDamaged:${e.player}`); break
      case 'phaseStarted': if (e.step) out.push(`step:${e.step}`); break
      default: break
    }
  }
  return out
}

/** Cast a cost-0 Summon by `player` at its single target, through the real command pipeline. */
function castAt(s: GameState, player: 0 | 1, code: string, target: CardId): { state: GameState; events: Event[]; card: CardId } {
  let t = s; let card: CardId
  ;[t, card] = withHand(t, player, code)
  const cmd = legalCommands(t, player).find((c) => c.type === 'castSummon' && c.card === card)
  expect(cmd, `${code} is castable by player ${player} here`).toBeDefined()
  let r = apply(t, cmd!)
  if (r.state.pending?.kind === 'chooseTargets' && r.state.pending.player === player) {
    const chosen = apply(r.state, { type: 'chooseTargets', player, targets: [target] })
    r = { state: chosen.state, events: [...r.events, ...chosen.events] }
  }
  return { ...r, card }
}

describe('L2-a — a Summon answered by the non-turn player’s action ability resolves LAST (§11.1.7, §11.6.11, §11.11.1)', () => {
  it('L2-a — the pump on top resolves first, so the burn underneath finds a 9000 Forward and does not break it', () => {
    let s = quiet(makeGame({ defs: DEFS }))
    let victim: CardId, princess: CardId
    ;[s, victim] = withField(s, 1, 'forwards', 'V-F2')          // 5000
    ;[s, princess] = withField(s, 1, 'forwards', 'T-PUMP')
    const names = { [victim]: 'victim', [princess]: 'princess' }
    const cast = castAt(s, 0, 'T-DMG', victim)
    names[cast.card] = 'burn'
    let events = [...cast.events]
    let t = cast.state
    expect(t.priority, '§11.3.8: the caster regains priority').toBe(0)
    let r = pass(t, 0); t = r.state; events.push(...r.events)          // §11.1.6: player 1 may respond
    const act = legalCommands(t, 1).find((c) => c.type === 'activateAbility' && c.source === princess && c.targets[0] === victim)
    expect(act, 'the pump is offered in response').toBeDefined()
    r = apply(t, act!); t = r.state; events.push(...r.events)
    expect(t.stack.map((i) => i.kind), 'the pump sits above the burn').toEqual(['summon', 'ability'])
    expect(t.priority, '§11.6.11: the activator regains priority').toBe(1)
    r = pass(t, 1); t = r.state; events.push(...r.events)
    r = pass(t, 0); t = r.state; events.push(...r.events)              // both forfeit: the PUMP resolves
    expect(t.stack.map((i) => i.kind)).toEqual(['summon'])
    expect(t.priority, '§11.1.5: the turn player').toBe(0)
    r = pass(t, 0); t = r.state; events.push(...r.events)
    r = pass(t, 1); t = r.state; events.push(...r.events)              // both forfeit: the BURN resolves
    expect(t.stack).toEqual([])
    expect(trace(events, names)).toEqual([
      'push:summon:burn', 'push:T-PUMP:pump',
      'power:victim:+4000', 'resolve:T-PUMP:pump',
      'damage:victim', 'resolve:summon:burn',
    ])
    expect(findFieldCard(t, victim)?.card.damage, '5000 damage on a 9000 Forward').toBe(5000)
    expect(findFieldCard(t, victim), 'survives').not.toBeNull()
    expect(t.players[1].breakZone, 'the pump’s cost put its source into the Break Zone').toContain(princess)
    ok(t)
  })
})

describe('L2-b — a trigger fired by a resolving item is placed ABOVE what is still on the stack (§11.1.4, §11.8.7, §12.3)', () => {
  it('L2-b — the top burn breaks a Forward the other player’s watcher sees; the watcher resolves before the burn underneath', () => {
    let s = quiet(makeGame({ defs: DEFS }))
    let v0: CardId, v1: CardId, watcher: CardId
    ;[s, v0] = withField(s, 0, 'forwards', 'V-F1')               // 3000, player 0's
    ;[s, v1] = withField(s, 1, 'forwards', 'V-F2')               // 5000, player 1's
    ;[s, watcher] = withField(s, 1, 'forwards', 'T-WATCH')       // watches player 0's Forwards leave
    const names = { [v0]: 'v0', [v1]: 'v1', [watcher]: 'watcher' }
    const a = castAt(s, 0, 'T-DMG', v1); names[a.card] = 'burnA'   // bottom: player 0 burns v1
    let t = a.state; const events = [...a.events]
    let r = pass(t, 0); t = r.state; events.push(...r.events)
    const b = castAt(t, 1, 'T-DMG', v0); names[b.card] = 'burnB'  // top: player 1 burns v0
    t = b.state; events.push(...b.events)
    r = pass(t, 1); t = r.state; events.push(...r.events)
    r = pass(t, 0); t = r.state; events.push(...r.events)        // burnB resolves: v0 takes 5000 ≥ 3000 → §12.4.5 breaks it → the watcher triggers
    expect(t.stack.map((i) => (i.kind === 'summon' ? `summon:${names[i.card]}` : i.frame.abilityId)), 'the watcher is placed above burnA').toEqual(['summon:burnA', 'T-WATCH:draw'])
    expect(t.priority, '§11.1.5').toBe(0)
    r = pass(t, 0); t = r.state; events.push(...r.events)
    r = pass(t, 1); t = r.state; events.push(...r.events)        // the watcher resolves: player 1 draws
    r = pass(t, 0); t = r.state; events.push(...r.events)
    r = pass(t, 1); t = r.state; events.push(...r.events)        // burnA resolves: v1 takes 5000 ≥ 5000 → breaks
    expect(trace(events, names)).toEqual([
      'push:summon:burnA', 'push:summon:burnB',
      'damage:v0', 'resolve:summon:burnB', 'broken:v0', 'trigger:T-WATCH:draw', 'push:T-WATCH:draw',
      'drew:1', 'resolve:T-WATCH:draw',
      'damage:v1', 'resolve:summon:burnA', 'broken:v1',
    ])
    ok(t)
  })
})

describe('L2-d — an EX Burst inside combat, and the trigger it causes (§11.10.2, §10.1.4.4, §11.1.4)', () => {
  it('L2-d — the burst breaks the attacker unrespondably; the watcher it triggers is on the stack when the damage window opens', () => {
    let s = quiet(endPhase(makeGame({ defs: DEFS })))
    let attacker: CardId, watcher: CardId
    ;[s, attacker] = withField(s, 0, 'forwards', 'V-F2')
    ;[s, watcher] = withField(s, 1, 'forwards', 'T-WATCH')       // watches player 0's Forwards leave
    const burst = 999
    s = { ...s, cards: { ...s.cards, [burst]: { id: burst, code: 'T-EX', owner: 1 } }, players: [s.players[0], { ...s.players[1], deck: [burst, ...s.players[1].deck] }] }
    const names = { [attacker]: 'attacker', [watcher]: 'watcher' }
    let r = apply(s, { type: 'declareAttack', player: 0, attackers: [attacker] })
    let t = r.state; const events = [...r.events]
    r = passBoth(t); t = r.state; events.push(...r.events)
    r = apply(t, { type: 'declareBlock', player: 1, blocker: null }); t = r.state; events.push(...r.events)
    r = passBoth(t); t = r.state; events.push(...r.events)       // one point of damage: the burst is offered
    expect(t.pending).toEqual(expect.objectContaining({ kind: 'chooseExBurst', player: 1 }))
    r = apply(t, { type: 'chooseExBurst', player: 1, use: true }); t = r.state; events.push(...r.events)
    expect(t.pending?.kind).toBe('chooseTargets')
    r = apply(t, { type: 'chooseTargets', player: 1, targets: [attacker] }); t = r.state; events.push(...r.events)
    expect(findFieldCard(t, attacker), 'broken by the burst, with no window to answer it').toBeNull()
    expect(t.attack?.step, 'the §10.1.4.4 window').toBe('damage')
    expect(t.stack.map((i) => (i.kind === 'ability' ? i.frame.abilityId : 'summon')), '§11.1.4: the watcher was placed as priority was granted').toEqual(['T-WATCH:draw'])
    expect(t.priority).toBe(0)
    expect(isResponseWindow(t)).toBe(true)
    r = passBoth(t); t = r.state; events.push(...r.events)       // the watcher resolves in the window
    expect(trace(events, names)).toEqual([
      'step:declared', 'step:block', 'step:blocked', 'step:damage',
      'playerDamaged:1', 'burst:offered', 'burst:used', 'broken:attacker',
      'trigger:T-WATCH:draw', 'push:T-WATCH:draw',
      'drew:1', 'resolve:T-WATCH:draw',
    ])
    ok(t)
  })
})

describe('L2-e — an until-end-of-turn effect from a resolved Summon stops at the End Phase (§9.5.1.3.2, §11.11.10)', () => {
  it('L2-e §9.5.1.3.2 — +4000 from a Summon lasts through the turn and is gone in the next', () => {
    let s = quiet(makeGame({ defs: DEFS }))
    let mine: CardId
    ;[s, mine] = withField(s, 0, 'forwards', 'V-F2')
    const cast = castAt(s, 0, 'T-BUFF', mine)
    let t = passBoth(cast.state).state                            // resolves
    expect(t.stack).toEqual([])
    expect(t.players[0].breakZone, '§11.11.10').toContain(cast.card)
    expect(powerOf(t, findFieldCard(t, mine)!.card)).toBe(9000)
    t = endPhase(endPhase(t))                                     // → main2
    expect(powerOf(t, findFieldCard(t, mine)!.card), 'still on in Main Phase 2').toBe(9000)
    t = passBoth(t).state                                         // End Phase → turn 2
    expect(t.turn).toBe(2)
    expect(powerOf(t, findFieldCard(t, mine)!.card), 'gone with the turn').toBe(5000)
    ok(t)
  })
})
```

- [ ] **Step 2: Run it**

Run: `pnpm vitest run packages/engine/test/timing-l2-compositions.test.ts`
Expected: PASS, or a failure that names an ORDER difference. The golden traces above are derived from the rules and the engine's event contract (`stackResolved` fires after the item's effects; a §12.4.5 break is a `broken` event emitted by the rule process, which runs before the trigger is placed). On a difference: if the engine's order is the rules' order and the golden is not (re-read the section in the spec), fix the golden; if the engine's order is wrong, `it.fails` + `simplified` row + ladder line, per Task 3 Step 2. A trace that contains an event kind the `trace()` switch does not name is not a failure — extend the switch only if the composition is ABOUT that kind.

- [ ] **Step 3: Cite the new tests in the matrix.** Add `; engine/timing-l2-compositions#L2-b` to rows 11.1.4 and 12.3; `; engine/timing-l2-compositions#L2-a` to rows 11.1.5 and 11.11.1; `; engine/timing-l2-compositions#L2-d` to rows 10.1.4.4 and 11.10.2. Flip any parked rows. Run the meta-test — expected: PASS (all engine refs resolve; `cards/scenarios` rows are not cited until Task 5).

- [ ] **Step 4: Commit**

```bash
git add packages/engine/test/timing-l2-compositions.test.ts docs/rules/timing-matrix.md
git commit -m "test(engine): Layer 2 — timing rules composed, asserted as event order (J9-A3)"
```

---

### Task 5: Layer 3 — scripted real-card scenarios

**Files:**
- Create: `packages/cards/test/harness.ts`
- Modify: `packages/cards/test/abilities.test.ts:19-108` (delete the local helper definitions; import them)
- Create: `packages/cards/test/scenarios/cloud-turn.test.ts`, `combat-tricks.test.ts`, `ramuh-in-a-window.test.ts`, `end-phase.test.ts`
- Modify: `docs/rules/timing-matrix.md` (add `cards/scenarios/<file>#<fragment>` refs)

**Interfaces:**
- Produces from `harness.ts`: `DEFS: CardDef[]`, `DECK: string[]`, `makeGame(): GameState`, `withField`, `withHand`, `withDeckTops`, `withBreakZone`, `withCp`, `passBoth`, `endPhase`, `applyNow`, `EARTH_BACKUP`, `LIGHTNING_BACKUP` — exactly the functions now defined at `abilities.test.ts:19-108`, with `export` added and nothing else changed.
- Consumes: `apply` (the real one, `engineApply` in that file), `legalCommands`, `findFieldCard`, `powerOf`, `checkInvariants`, `isResponseWindow` from `@fftcg/engine`.

Card facts (printed text, from `packages/cards/data/cards.json`): Cloud 27-124S (earth, 3, 7000) ETB: all your Forwards +3000 and Brave until end of turn; at the beginning of your Attack Phase choose 1 Forward you control, it cannot be broken (ability ids `27-124S:etb`, `27-124S:attack-phase`). Luso 27-125S (earth, 1, 3000): breaks any Forward it damages (`27-125S:damages-forward`); modal on player damage (`27-125S:damages-opponent`). Undead Princess 19-052C (earth, 1, 2000): put into Break Zone → a Forward +4000 (`19-052C:pump`). Prishe 22-068R (earth, 2, 5000): +2000 when chosen (`22-068R:chosen`). Lightning 27-127S (lightning, 7, 9000): when an opponent's Forward goes field→Break Zone, a Forward you control gains Haste (`27-127S:opponent-forward-broken`); EX BURST ETB break a cost≤4 Forward (`27-127S:etb`). Ramuh 20-103H (lightning Summon, 2): up to 2 of dull / 5000 damage / Haste (`20-103H:summon`). Geomancer 18-064C is the earth generic Backup, Red Mage 18-069C the lightning one.

- [ ] **Step 1: Extract the harness.** Create `packages/cards/test/harness.ts` whose body is `abilities.test.ts` lines 19–108 verbatim with `export` in front of `DEFS`, `DECK`, `makeGame`, `withField`, `withHand`, `withDeckTops`, `withBreakZone`, `EARTH_BACKUP`, `LIGHTNING_BACKUP`, `withCp`, `passBoth`, `endPhase`, `applyNow` (leave `addInstance`, `setPlayer`, `nextId` unexported), plus the imports those lines need:

```ts
import type { CardDef, CardId, Command, Event, FieldCard, GameState, PlayerId } from '@fftcg/engine'
import { actingPlayer, apply as engineApply, applyChooseFirst, applyMulligan, createGame, drainResolution, hasResolutionWork, isResponseWindow } from '@fftcg/engine'
import { loadCards } from '../src/index.js'
```

Then in `abilities.test.ts` delete lines 19–108 and add after its existing imports:

```ts
import { DEFS, DECK, EARTH_BACKUP, LIGHTNING_BACKUP, applyNow, endPhase, makeGame, passBoth, withBreakZone, withCp, withDeckTops, withField, withHand } from './harness.js'
```

Remove from `abilities.test.ts`'s `@fftcg/engine` import any name that is now unused (the linter will list them). Keep `const apply = applyNow` and the three one-liners after it.

Run: `pnpm vitest run packages/cards/test/abilities.test.ts && pnpm lint` — expected: same pass count as before (`git stash` is NOT the way to compare; run `git show HEAD:packages/cards/test/abilities.test.ts | grep -c "^\s*it("` for the count), lint clean.

Commit: `git add packages/cards/test/harness.ts packages/cards/test/abilities.test.ts && git commit -m "test(cards): the real-card fixture helpers move to a shared harness (J9)"`

- [ ] **Step 2: Write the scenario harness additions** at the bottom of `harness.ts`:

```ts
/** A trace of what happened, for golden sequences: stack, triggers, power, damage, breaks, draws, combat steps. */
export function trace(events: readonly Event[], names: Record<number, string> = {}): string[] {
  const n = (id: number) => names[id] ?? String(id)
  const out: string[] = []
  for (const e of events) {
    switch (e.type) {
      case 'stackPushed': out.push(`push:${e.item.kind === 'summon' ? `summon:${n(e.item.card)}` : e.item.abilityId}`); break
      case 'stackResolved': out.push(`resolve:${e.item.kind === 'summon' ? `summon:${n(e.item.card)}` : e.item.abilityId}`); break
      case 'stackCancelled': out.push(`cancel:${e.item.kind === 'summon' ? `summon:${n(e.item.card)}` : e.item.abilityId}`); break
      case 'abilityTriggered': out.push(`trigger:${e.abilityId}`); break
      case 'abilityActivated': out.push(`activate:${e.abilityId}`); break
      case 'powerModified': out.push(`power:${n(e.card)}:${e.amount > 0 ? '+' : ''}${e.amount}`); break
      case 'keywordGranted': out.push(`keyword:${n(e.card)}:${e.keyword}`); break
      case 'abilityDamage': out.push(`damage:${n(e.card)}`); break
      case 'battleDamage': out.push(`battle:${n(e.source)}>${n(e.target)}:${e.amount}`); break
      case 'broken': case 'brokenByAbility': out.push(`broken:${n(e.card)}`); break
      case 'paidToBreakZone': out.push(`paid:${n(e.card)}`); break
      case 'playerDamaged': out.push(`playerDamaged:${e.player}`); break
      case 'exBurstOffered': out.push('burst:offered'); break
      case 'exBurstUsed': out.push('burst:used'); break
      case 'exBurstDeclined': out.push('burst:declined'); break
      case 'drew': out.push(`drew:${e.player}`); break
      case 'discarded': out.push(`discard:${n(e.card)}`); break
      case 'phaseStarted': out.push(e.step ? `step:${e.step}` : `phase:${e.phase}`); break
      case 'attackDeclared': out.push(`attack:${e.attackers.map(n).join('+')}`); break
      case 'blockDeclared': out.push(`block:${e.blocker === null ? 'none' : n(e.blocker)}`); break
      default: break
    }
  }
  return out
}

/** Apply one command through the REAL pipeline (no drain), accumulating events into `log`. */
export function step(log: Event[], s: GameState, command: Command): GameState {
  const r = engineApply(s, command)
  log.push(...r.events)
  return r.state
}
```

Check the exact field names of `keywordGranted`, `paidToBreakZone` and `discarded` in `packages/engine/src/events.ts` before relying on them (`grep -n "keywordGranted\|paidToBreakZone\|discarded" packages/engine/src/events.ts`) and adjust the two property reads if they differ.

- [ ] **Step 3: Scenario 1 — `cloud-turn.test.ts`**

Script: player 0's Main Phase 1, turn 1. P0 field: Luso. P1 field: Undead Princess, Prishe. P0 casts Cloud paying 3 Geomancers (`withCp(s, 0, [EARTH_BACKUP, EARTH_BACKUP, EARTH_BACKUP])`). Cloud's ETB goes on the stack (untargeted `forEach`: nothing to declare), P0 holds priority (§11.4.7). P0 passes; P1 activates the Princess's pump on Prishe; Prishe's "when chosen" triggers and, per J1-A10, is placed above the pump and resolves first (+2000), then the pump (+4000), then Cloud's ETB (+3000 and Brave to Luso and Cloud). Then both pass out of Main Phase 1 into the Attack Phase: Cloud's "beginning of the Attack Phase" trigger goes on the stack at the preparation window, P0 chooses Cloud as its target.

```ts
import { describe, expect, it } from 'vitest'
import type { CardId, Event, GameState } from '@fftcg/engine'
import { checkInvariants, findFieldCard, keywordsOf, legalCommands, powerOf } from '@fftcg/engine'
import { EARTH_BACKUP, makeGame, step, trace, withCp, withField, withHand } from '../harness.js'

/** Rung J9 Layer 3: the shipped cards, a scripted turn, a golden order (spec J9-D3). */
const ok = (s: GameState) => expect(checkInvariants(s)).toEqual([])
const power = (s: GameState, id: CardId) => powerOf(s, findFieldCard(s, id)!.card)

describe('scenario: the Cloud turn — an ETB on the stack, answered from the other side, then the Attack Phase trigger', () => {
  it('L3 cloud-turn — Prishe’s chosen-trigger, the Princess’s pump and Cloud’s ETB resolve in that order; Cloud’s attack-phase clause fires at preparation', () => {
    let s = makeGame()
    let luso: CardId, princess: CardId, prishe: CardId, cloud: CardId, cp: CardId[]
    ;[s, luso] = withField(s, 0, 'forwards', '27-125S')
    ;[s, princess] = withField(s, 1, 'forwards', '19-052C')
    ;[s, prishe] = withField(s, 1, 'forwards', '22-068R')
    ;[s, cloud] = withHand(s, 0, '27-124S')
    ;[s, cp] = withCp(s, 0, [EARTH_BACKUP, EARTH_BACKUP, EARTH_BACKUP])
    const names = { [luso]: 'luso', [princess]: 'princess', [prishe]: 'prishe', [cloud]: 'cloud' }
    const log: Event[] = []
    s = step(log, s, { type: 'castCharacter', player: 0, card: cloud, payment: { dullBackups: cp, discards: [] } })
    expect(s.stack.map((i) => (i.kind === 'ability' ? i.frame.abilityId : 'summon'))).toEqual(['27-124S:etb'])
    expect(s.priority, '§11.4.7: the turn player').toBe(0)
    s = step(log, s, { type: 'pass', player: 0 })
    const pump = legalCommands(s, 1).find((c) => c.type === 'activateAbility' && c.source === princess && c.targets[0] === prishe)
    expect(pump, 'the Princess may answer in the window').toBeDefined()
    s = step(log, s, pump!)
    expect(s.stack.map((i) => (i.kind === 'ability' ? i.frame.abilityId : 'summon')), 'Prishe’s trigger sits above the pump that chose her').toEqual(['27-124S:etb', '19-052C:pump', '22-068R:chosen'])
    for (const p of [1, 0, 0, 1, 0, 1] as const) s = step(log, s, { type: 'pass', player: p })   // chosen → pump → ETB
    expect(s.stack).toEqual([])
    expect(power(s, prishe)).toBe(5000 + 2000 + 4000)
    expect(power(s, luso)).toBe(3000 + 3000)
    expect(power(s, cloud)).toBe(7000 + 3000)
    expect(keywordsOf(s, findFieldCard(s, luso)!.card)).toContain('brave')
    // Out of Main Phase 1: the Attack Phase begins, Cloud's clause triggers and asks for its target at the preparation window.
    s = step(log, s, { type: 'pass', player: 0 })
    s = step(log, s, { type: 'pass', player: 1 })
    expect(s.phase).toBe('attack')
    expect(s.pending).toEqual(expect.objectContaining({ kind: 'chooseTargets', player: 0 }))
    s = step(log, s, { type: 'chooseTargets', player: 0, targets: [cloud] })
    expect(s.stack.map((i) => (i.kind === 'ability' ? i.frame.abilityId : 'summon'))).toEqual(['27-124S:attack-phase'])
    expect(s.attack?.step).toBe('preparation')
    expect(trace(log, names)).toEqual([
      'trigger:27-124S:etb', 'push:27-124S:etb',
      'activate:19-052C:pump', 'paid:princess', 'trigger:22-068R:chosen', 'push:19-052C:pump', 'push:22-068R:chosen',
      'power:prishe:+2000', 'resolve:22-068R:chosen',
      'power:prishe:+4000', 'resolve:19-052C:pump',
      'power:luso:+3000', 'keyword:luso:brave', 'power:cloud:+3000', 'keyword:cloud:brave', 'resolve:27-124S:etb',
      'phase:attack', 'step:preparation', 'trigger:27-124S:attack-phase', 'push:27-124S:attack-phase',
    ])
    ok(s)
  })
})
```

The exact strings `activate:…`, `paid:…` and the relative order of `activate`/`paid`/`trigger`/`push` on the pump line depend on the engine's event order for an activation whose cost is paid before placement (C3-A2 says the cost is paid first, and C3-A3 says the self-break is a `paidToBreakZone`). Run, then judge the difference by the rules: §11.6.3–11.6.4 put the ability on the stack THEN pay, but the engine's documented C3 order is pay-then-place with the target validated against the post-cost board, a marked C3 decision. If the trace differs only in that pair's order, accept the engine's order in the golden and add a comment citing C3-A2.

Check `keywordsOf`'s signature in `packages/engine/src/abilities.ts` (`grep -n "export function keywordsOf"`) before using it.

- [ ] **Step 4: Scenario 2 — `combat-tricks.test.ts`**

Script: player 0's declaration step, turn 1 (`endPhase(makeGame())` reaches it). P0 field: Luso (3000) and Prishe (5000), both earth → a party; Undead Princess on P0's field too. P1 field: Lightning (9000) as blocker, and a second Forward, Sphene (7000), for Lightning's Haste trigger to pick. P0 declares the party [luso, prishe]; through the `declared` window; P1 blocks with Lightning; in the `blocked` window P0 pumps Luso with the Princess (+4000 → 7000; Prishe not chosen). Both forfeit: battle damage — the party deals 7000+5000 = 12000 to Lightning (breaks it); Lightning assigns its 9000 among the party: 3000 to Luso? No — Luso is 7000 now: assign 7000 to Luso and 2000 to Prishe. Luso's damage-to-Forward trigger fires ("break it": Lightning already broke by §12.4.5, so it no-ops per C2-A5); Lightning left P1's field → P1 has no Lightning left to watch (Lightning's own observer needs Lightning ON the field: it watches P0's Forwards, and it is P0's Luso that breaks from 7000 damage) — so instead give P1 a SECOND Lightning? Same-name rule (§12.4.6) forbids. Use: P1 blocks with Sphene (7000) instead and keeps Lightning (9000) unblocking on the field. Then: party 12000 into Sphene → Sphene breaks; Sphene assigns 7000: 7000 to Luso (breaks at 7000) or 3000+4000; script `[{luso, 7000}]` → Luso breaks by §12.4.5. Triggers: Luso's `damages-forward` (Sphene, already broken → no-op), Lightning's observer (P0's Luso went to the Break Zone) → P1 chooses Lightning itself to gain Haste. Expected golden (declaration → damage window):

```ts
import { describe, expect, it } from 'vitest'
import type { CardId, Event, GameState } from '@fftcg/engine'
import { checkInvariants, findFieldCard, keywordsOf, legalCommands } from '@fftcg/engine'
import { endPhase, makeGame, step, trace, withField } from '../harness.js'

const ok = (s: GameState) => expect(checkInvariants(s)).toEqual([])
const ids = (s: GameState) => s.stack.map((i) => (i.kind === 'ability' ? i.frame.abilityId : 'summon'))

describe('scenario: combat with tricks — a party, a block, a pump in the blocked window, and the triggers damage fires', () => {
  it('L3 combat-tricks — the pump lands before damage; the rule process breaks first; Luso’s trigger no-ops; Lightning’s observer resolves in the damage window', () => {
    let s = endPhase(makeGame())
    let luso: CardId, prishe: CardId, princess: CardId, sphene: CardId, lightning: CardId
    ;[s, luso] = withField(s, 0, 'forwards', '27-125S')
    ;[s, prishe] = withField(s, 0, 'forwards', '22-068R')
    ;[s, princess] = withField(s, 0, 'forwards', '19-052C')
    ;[s, sphene] = withField(s, 1, 'forwards', '27-126S')
    ;[s, lightning] = withField(s, 1, 'forwards', '27-127S')
    const names = { [luso]: 'luso', [prishe]: 'prishe', [princess]: 'princess', [sphene]: 'sphene', [lightning]: 'lightning' }
    const log: Event[] = []
    expect(s.attack?.step).toBe('declaration')
    s = step(log, s, { type: 'declareAttack', player: 0, attackers: [luso, prishe] })
    s = step(log, s, { type: 'pass', player: 0 }); s = step(log, s, { type: 'pass', player: 1 })   // the `declared` window
    expect(s.pending).toEqual({ kind: 'declareBlock', player: 1 })
    s = step(log, s, { type: 'declareBlock', player: 1, blocker: sphene })
    expect(s.attack?.step).toBe('blocked'); expect(s.priority).toBe(0)
    const pump = legalCommands(s, 0).find((c) => c.type === 'activateAbility' && c.source === princess && c.targets[0] === luso)
    expect(pump, 'the Princess pumps Luso in the blocked window').toBeDefined()
    s = step(log, s, pump!)
    expect(ids(s)).toEqual(['19-052C:pump'])
    s = step(log, s, { type: 'pass', player: 0 }); s = step(log, s, { type: 'pass', player: 1 })   // the pump resolves
    expect(s.stack).toEqual([]); expect(s.attack?.step).toBe('blocked')
    s = step(log, s, { type: 'pass', player: 0 }); s = step(log, s, { type: 'pass', player: 1 })   // damage
    expect(s.pending, '§10.1.4.2.1: Sphene splits its 7000').toEqual({ kind: 'assignPartyDamage', player: 1 })
    s = step(log, s, { type: 'assignPartyDamage', player: 1, assignments: [{ target: luso, amount: 7000 }] })
    // §12.4.5 broke Sphene (12000 ≥ 7000) and Luso (7000 ≥ 7000) as one rule process; then the triggers were placed:
    // Luso's (turn player, first) and Lightning's (non-turn player, on top). Lightning's asks for its target at placement.
    expect(s.pending).toEqual(expect.objectContaining({ kind: 'chooseTargets', player: 1 }))
    s = step(log, s, { type: 'chooseTargets', player: 1, targets: [lightning] })
    expect(ids(s)).toEqual(['27-125S:damages-forward', '27-127S:opponent-forward-broken'])
    expect(s.attack?.step).toBe('damage'); expect(s.priority).toBe(0)
    s = step(log, s, { type: 'pass', player: 0 }); s = step(log, s, { type: 'pass', player: 1 })   // Lightning gains Haste
    s = step(log, s, { type: 'pass', player: 0 }); s = step(log, s, { type: 'pass', player: 1 })   // Luso's break: nothing left to break
    expect(s.stack).toEqual([])
    expect(findFieldCard(s, sphene)).toBeNull(); expect(findFieldCard(s, luso)).toBeNull()
    expect(findFieldCard(s, prishe)).not.toBeNull()
    expect(keywordsOf(s, findFieldCard(s, lightning)!.card)).toContain('haste')
    expect(trace(log, names)).toEqual([
      'attack:luso+prishe', 'step:declared', 'step:block', 'block:sphene', 'step:blocked',
      'activate:19-052C:pump', 'paid:princess', 'push:19-052C:pump', 'power:luso:+4000', 'resolve:19-052C:pump',
      'step:damage', 'battle:luso>sphene:7000', 'battle:prishe>sphene:5000', 'battle:sphene>luso:7000',
      'broken:sphene', 'broken:luso',
      'trigger:27-125S:damages-forward', 'trigger:27-127S:opponent-forward-broken',
      'push:27-125S:damages-forward', 'push:27-127S:opponent-forward-broken',
      'keyword:lightning:haste', 'resolve:27-127S:opponent-forward-broken',
      'resolve:27-125S:damages-forward',
    ])
    ok(s)
  })
})
```

Points the run will settle, each judged by the rules: whether `battleDamage` is one event per source (the golden assumes so), whether Luso's trigger with a target already gone is placed then no-ops or is dropped at placement (§11.8.4 says placed and removed at once only when it must CHOOSE and cannot; Luso's clause chooses nothing, so it is placed — the golden assumes a `push` and a `resolve`), and whether Lightning's `chooseTargets` prompt appears at placement (J1-D3: declaration is a stage of placement) — the golden assumes it does.

- [ ] **Step 5: Scenario 3 — `ramuh-in-a-window.test.ts`**

Script: player 0's declaration step. P0 field: Luso (3000) and Prishe (5000), earth party. P1 field: nothing; P1 hand: Ramuh; P1 backups: two Red Mages (`withCp(s, 1, [LIGHTNING_BACKUP, LIGHTNING_BACKUP])`). P0 declares the party; P0 passes in the `declared` window; P1 casts Ramuh choosing modes [dull, 5000 damage] — mode 1 dulls Prishe (already dull from attacking: dulling a dull card is legal, §15.1.1.2.2), mode 2 deals 5000 to Luso. Ramuh resolves: Luso breaks (§12.4.5). Combatants are recomputed at the window exit (J1-A6): Prishe alone is no longer a party (§15.1.1.9.5), the attack continues, P1 owes a block with no Forward → forced no-block (K2), one point of damage.

```ts
import { describe, expect, it } from 'vitest'
import type { CardId, Event, GameState } from '@fftcg/engine'
import { checkInvariants, findFieldCard, legalCommands } from '@fftcg/engine'
import { LIGHTNING_BACKUP, endPhase, makeGame, step, trace, withCp, withField, withHand } from '../harness.js'

const ok = (s: GameState) => expect(checkInvariants(s)).toEqual([])

describe('scenario: Ramuh in a window — the non-turn player’s Summon in the declared window kills an attacker; the attack goes on with what is left', () => {
  it('L3 ramuh-in-a-window — modes are declared at cast, Ramuh resolves after both forfeit, the party shrinks to one, the block is owed', () => {
    let s = endPhase(makeGame())
    let luso: CardId, prishe: CardId, ramuh: CardId, cp: CardId[]
    ;[s, luso] = withField(s, 0, 'forwards', '27-125S')
    ;[s, prishe] = withField(s, 0, 'forwards', '22-068R')
    ;[s, ramuh] = withHand(s, 1, '20-103H')
    ;[s, cp] = withCp(s, 1, [LIGHTNING_BACKUP, LIGHTNING_BACKUP])
    const names = { [luso]: 'luso', [prishe]: 'prishe', [ramuh]: 'ramuh' }
    const log: Event[] = []
    s = step(log, s, { type: 'declareAttack', player: 0, attackers: [luso, prishe] })
    s = step(log, s, { type: 'pass', player: 0 })
    expect(s.priority, 'the defender holds the declared window').toBe(1)
    const cast = legalCommands(s, 1).find((c) => c.type === 'castSummon' && c.card === ramuh)
    expect(cast, 'Ramuh is castable in an Attack Phase window (§9.3.1.6)').toBeDefined()
    s = step(log, s, cast!)
    expect(s.pending).toEqual(expect.objectContaining({ kind: 'chooseModes', player: 1 }))
    s = step(log, s, { type: 'chooseMode', player: 1, modes: [0, 1] })            // dull, then 5000 damage
    expect(s.pending).toEqual(expect.objectContaining({ kind: 'chooseTargets', player: 1 }))
    s = step(log, s, { type: 'chooseTargets', player: 1, targets: [prishe] })      // mode 0: dull Prishe
    s = step(log, s, { type: 'chooseTargets', player: 1, targets: [luso] })        // mode 1: 5000 to Luso
    expect(s.stack.map((i) => i.kind)).toEqual(['summon'])
    expect(s.priority, '§11.3.8').toBe(1)
    s = step(log, s, { type: 'pass', player: 1 }); s = step(log, s, { type: 'pass', player: 0 })   // Ramuh resolves
    expect(findFieldCard(s, luso), '5000 ≥ 3000').toBeNull()
    expect(s.players[1].breakZone, '§11.11.10').toContain(ramuh)
    expect(s.attack?.step, 'still the declared window (§11.1.5: the turn player has priority)').toBe('declared')
    expect(s.priority).toBe(0)
    s = step(log, s, { type: 'pass', player: 0 }); s = step(log, s, { type: 'pass', player: 1 })   // out of the window: combatants recomputed
    expect(s.attack?.attackers, '§15.1.1.9.5: Prishe alone').toEqual([prishe])
    expect(s.pending).toEqual({ kind: 'declareBlock', player: 1 })
    expect(trace(log, names)).toEqual([
      'attack:luso+prishe', 'step:declared',
      'push:summon:ramuh',
      'damage:luso', 'resolve:summon:ramuh', 'broken:luso',
      'step:block',
    ])
    ok(s)
  })
})
```

The `dull` on Prishe emits `dulled`, which `trace` does not name — that is intended; the scenario is about the stack and the combatants. Confirm the `chooseMode` command's exact name and shape (`grep -n "chooseMode" packages/engine/src/commands.ts`) — the union shows `{ type: 'chooseMode'; player; modes }`.

- [ ] **Step 6: Scenario 4 — `end-phase.test.ts`**

Script: player 0's Main Phase 2 with a pumped Forward, damage on another, and seven cards in hand. Pass out of Main Phase 2: the End Phase asks for two discards (§9.5.1.2), then damage is removed and the pump stops (§9.5.1.3), then turn 2 begins for player 1 with their Active and Draw Phases done (§9.5.1.5, §9.1, §9.2).

```ts
import { describe, expect, it } from 'vitest'
import type { CardId, Event, GameState } from '@fftcg/engine'
import { checkInvariants, findFieldCard, legalCommands, powerOf } from '@fftcg/engine'
import { endPhase, makeGame, step, trace, withField, withHand } from '../harness.js'

const ok = (s: GameState) => expect(checkInvariants(s)).toEqual([])

describe('scenario: the End Phase — hand size, damage removal, until-end-of-turn expiry, then the next turn', () => {
  it('L3 end-phase — discards are owed first; damage and the pump go together; the new turn player starts in Main Phase 1 having drawn', () => {
    let s = makeGame()
    let prishe: CardId, luso: CardId
    ;[s, prishe] = withField(s, 0, 'forwards', '22-068R', { powerBonus: 2000 })    // as if chosen this turn
    ;[s, luso] = withField(s, 0, 'forwards', '27-125S', { damage: 2000 })
    for (let i = 0; i < 7; i++) [s] = withHand(s, 0, '18-064C')
    const names = { [prishe]: 'prishe', [luso]: 'luso' }
    const log: Event[] = []
    s = endPhase(endPhase(s))                                              // → main2
    expect(s.phase).toBe('main2')
    s = step(log, s, { type: 'pass', player: 0 }); s = step(log, s, { type: 'pass', player: 1 })
    expect(s.phase).toBe('end')
    expect(s.pending).toEqual({ kind: 'discardToHandSize', player: 0, count: 2 })
    const hand = s.players[0].hand
    const discard = legalCommands(s, 0).find((c) => c.type === 'discardToHandSize')!
    expect(discard.type === 'discardToHandSize' && discard.cards).toHaveLength(2)
    const p1DeckBefore = s.players[1].deck.length
    s = step(log, s, discard)
    expect(s.players[0].hand).toHaveLength(5)
    expect(s.turn).toBe(2); expect(s.turnPlayer).toBe(1); expect(s.phase).toBe('main1'); expect(s.priority).toBe(1)
    expect(findFieldCard(s, luso)!.card.damage, '§9.5.1.3.1').toBe(0)
    expect(powerOf(s, findFieldCard(s, prishe)!.card), '§9.5.1.3.2').toBe(5000)
    expect(s.players[1].deck.length, '§9.2.1.1: two drawn').toBe(p1DeckBefore - 2)
    expect(s.players[1].hand).toHaveLength(hand.length === 7 ? s.players[1].hand.length : s.players[1].hand.length)   // no claim about P1's hand size here
    const t = trace(log, names)
    expect(t.slice(0, 1)).toEqual(['phase:end'])
    expect(t.filter((x) => x.startsWith('discard:'))).toHaveLength(2)
    expect(t.at(-1)).toBe('phase:main1')
    expect(t.filter((x) => x.startsWith('drew:'))).toEqual(['drew:1', 'drew:1'])
    ok(s)
  })
})
```

Remove the no-claim line about P1's hand size before committing; it is a placeholder that says nothing (kept in the plan only to make the point that a golden must claim something). Whether the engine emits one `drew` per card or one per draw action is settled by the run; if it is one per action, the expectation becomes `['drew:1']` with a comment.

- [ ] **Step 7: Run all four**

Run: `pnpm vitest run packages/cards/test/scenarios`
Expected: PASS, or order differences to judge as in Task 4 Step 2. Every judged difference that is an engine deviation from the rules becomes `it.fails` + a `simplified` row + a marker + a ladder line; every one that is the golden's mistake is corrected with a one-line comment saying which section settled it.

- [ ] **Step 8: Cite the scenarios in the matrix.** Add refs: row 10.1.1.1 `; cards/scenarios/cloud-turn#L3 cloud-turn`; row 11.4.7 `; cards/scenarios/cloud-turn#L3 cloud-turn`; rows 10.1.3.6 and 10.1.4.3 `; cards/scenarios/combat-tricks#L3 combat-tricks`; rows 10.1.2.6 and 11.3.4 `; cards/scenarios/ramuh-in-a-window#L3 ramuh-in-a-window`; rows 9.5.1.2, 9.5.1.3.1, 9.5.1.5 `; cards/scenarios/end-phase#L3 end-phase`. Run the meta-test — expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/cards/test/harness.ts packages/cards/test/scenarios docs/rules/timing-matrix.md
git commit -m "test(cards): Layer 3 — four scripted games on the shipped cards with golden event order (J9-A4)"
```

---

### Task 6: Refresh the audit table

**Files:**
- Modify: `docs/superpowers/specs/2026-09-08-rules-conformance-audit.md` (the starred rows in "Section-by-section", and a note under the title)

- [ ] **Step 1: Add the note** directly under the `# Rules conformance audit …` title:

```markdown
> **2026-09-16:** for chapters 9–12 and the combat/keyword parts of 15, the live view is now
> `docs/rules/timing-matrix.md`, checked by a test. The starred rows below were refreshed to what J1–J7 and K1–K5
> built; the rest of the table is as audited on 2026-09-08.
```

- [ ] **Step 2: Replace the starred rows** (`grep -n "★" docs/superpowers/specs/2026-09-08-rules-conformance-audit.md`) with:

```markdown
| 7.12 | **The stack** | ok | Rung J1: `state.stack`, `passes`; `cr11-stack.test.ts`. |
| 9.3.1.6 | Summons castable in Main **and Attack** Phase | ok | J1 slice 4; `cr11.4-cast.test.ts` (§9.3.1.6). |
| 9.3.1.7 | Action abilities in Main **and Attack** Phase | ok | J1 slice 4; `activated-abilities.test.ts` (§9.3.1.7). |
| 10.1.4 | Damage resolution, party split, **priority after damage** | ok | J1-D10: the `damage` window; `cr10-attack-windows.test.ts`. |
| 11.1 | **Priority** | ok | J1-D9; `cr9-phases.test.ts` (J1-A1). No End Phase window (§9.5.1.4, marked). |
| 11.3 | Casting a Summon (to the stack, respondable) | ok | J1-D5; `cr11-stack.test.ts` (J1-A2). |
| 11.6 | Action abilities: costs paid simultaneously, `[Dull]` needs continuous control unless Haste | ok | C3 + J1 slice 4. |
| 11.8 | Auto-abilities: trigger, go on the stack when priority is next gained, **controller orders own triggers, NAP on top** | partial | J1-D4: turn player's first, NAP's on top (`cr11-stack.test.ts` §11.8.7); within-player order is FIFO (marked, `resolve.ts`). |
```

Keep each row's `★` marker off (they were markers for "consequence of no stack"; the stack exists). Also update the "Verdict in three sentences" paragraph's bold sentence to past tense: "**The one structural gap was §11.1 and §7.12 — no stack and no priority passing — closed by rung J1 on 2026-09-08.**" and leave the rest.

- [ ] **Step 3: Update the ladder**: add a row after J8:

```markdown
| **J9** | ~~The timing matrix: every CR timing rule mapped to a test, three layers (primitives, compositions, real-card scenarios), a referee test.~~ Built 2026-09-16 ([spec](2026-09-16-rung-j9-timing-matrix.md)). | Asked for by the user 2026-09-16; J3/J2/J8 add rows to it. |
```

and for every `it.fails` Tasks 3–5 produced, one line under the ladder table: `- **Found by J9:** §x.y.z — <one sentence>; test `<file>#<fragment>` is `it.fails`.` If none were produced, add nothing.

- [ ] **Step 4: Verify** `pnpm vitest run packages/engine/test/rules-citations.test.ts` (every § in the edited spec still exists) and commit:

```bash
git add docs/superpowers/specs/2026-09-08-rules-conformance-audit.md
git commit -m "docs(specs): the audit's starred rows say what J1 built; the timing matrix is the live view (J9-A5)"
```

---

### Task 7: Gates, spec status, handoff

- [ ] **Step 1: Full gates**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: clean; "Timeout calling onTaskUpdate" unhandled errors are the busy machine, not failures — the totals line is the verdict.

- [ ] **Step 2: Spec status.** Change the spec's status line to `> **STATUS: BUILT, 2026-09-16** (commits <first>..<last>).` and, under Acceptance, tick nothing — the meta-test is the tick.

- [ ] **Step 3: Commit** `git add docs/superpowers/specs/2026-09-16-rung-j9-timing-matrix.md && git commit -m "docs(specs): J9 built"`.

- [ ] **Step 4: Handoff.** Invoke the `handoff` skill: next step is J3 First Strike + Freeze, whose `simplified` rows (15.2.3.x, 15.2.4.x, 15.1.1.9.7) turn `tested`. Note any `it.fails` in Dead ends as "known wrong, not fixed in J9". Do not push; ask.

---

## Self-review

**Spec coverage.** J9-D1 matrix → Task 2. J9-D2 meta-test → Task 2 (all six failure classes: bad section, uncited tested, missing file, dead fragment, missing marker, missing row). J9-D3 Layer 1 → Task 3 (the D3 list: §9.1.1.2/§9.2.1.2, §10.1.4.6, §11.1.5, §11.3.8, §15.1.1.9.4 are tests; §9.3.1.3, §9.5.1.1, §10.1.2.5, §10.1.3.5 are `n/a` rows with reasons; §10.1.1.1, §10.1.4.3, §11.1.3, §11.1.4, §10.1.3.3, §10.1.2.7, §11.3.8/§11.11.10 were found tested and cited). Layer 2 → Task 4 (a, b, d, e new; J1-A4, J1-A5, C2-A5 by citation — seven). Layer 3 → Task 5 (four). J9-D4 → no renames anywhere. J9-D5 → Task 6. J9-D6 → the `it.fails` rule in Tasks 3–5 Step 2/7 and Task 6 Step 3. J9-A5's "in `pnpm test`" holds because vitest picks up every `*.test.ts` under `packages/*/test`.

**Placeholders.** The end-phase scenario's no-claim line and the matrix's deliberate stray row are both flagged for removal in their steps. No TBDs.

**Type consistency.** `trace(events, names)` and `step(log, s, command)` have the same signatures in Task 4 (local) and Task 5 (harness). `problems(rows, index)` and `parseMatrix(text)` are used only in Task 2. Matrix refs use the `pkg/file#fragment` form everywhere, including the Task 5 additions.

**Known unknowns the run settles** (listed so nobody mistakes them for plan gaps): the exact event order around an activation's cost payment (Task 5 Step 3), one-`battleDamage`-per-source (Step 4), `drew` granularity (Step 6), and whether `phaseStarted` is emitted for `active`/`draw` (Task 3 Step 1 avoids depending on it).
