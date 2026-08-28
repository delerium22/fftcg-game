import { spawn } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { loadCards } from '@fftcg/cards'
import { nextInt, seedRng, type Rng } from '@fftcg/engine'
import { parseDeckFile } from '../src/deck.js'
import { hotseat, type HotseatIo } from '../src/hotseat.js'

describe('hotseat', () => {
  it('plays a complete game end to end through a scripted io', async () => {
    const deck = parseDeckFile(readFileSync(new URL('../../../decks/starter-2025-vol2.txt', import.meta.url), 'utf8'))
    const defs = loadCards()

    const lines: string[] = []
    const asked: string[] = []
    const clears: number[] = []
    let rng: Rng = seedRng(7)
    let askCount = 0
    let usedInvalid = false

    const io: HotseatIo = {
      print(line) {
        for (const l of line.split('\n')) lines.push(l)
      },
      clear() {
        clears.push(lines.length)
      },
      async ask(prompt) {
        askCount++
        if (askCount > 5000) throw new Error(`hotseat asked more than 5000 times without finishing (stuck?) — last prompt "${prompt}"`)
        asked.push(prompt)
        if (prompt.startsWith('Pass the device')) return ''
        // parse the most recently printed numbered menu (lines since the last "=== Turn" header)
        let turnIdx = -1
        for (let i = lines.length - 1; i >= 0; i--) {
          if (/^=== Turn/.test(lines[i] ?? '')) { turnIdx = i; break }
        }
        const menu: { i: number; desc: string }[] = []
        for (let i = turnIdx + 1; i < lines.length; i++) {
          const m = /^\s*(\d+): (.*)$/.exec(lines[i] ?? '')
          if (m) menu.push({ i: Number(m[1]), desc: m[2] as string })
        }
        if (!usedInvalid) { usedInvalid = true; return 'x' }
        const choices = menu.filter((e) => e.desc !== 'Concede')
        const pool = choices.length ? choices : menu
        const [idx, next] = nextInt(rng, pool.length)
        rng = next
        return String(pool[idx]!.i)
      },
    }

    await hotseat({ seed: 7, decks: [deck, deck], defs }, io)

    const text = lines.join('\n')
    const turns = lines.filter((l) => /^=== Turn/.test(l)).length

    expect(text).toMatch(/\*\*\* GAME OVER/)
    expect(asked.some((p) => p.includes('Pass the device to P1'))).toBe(true)
    expect(asked.some((p) => p.includes('Pass the device to P0'))).toBe(true)
    expect(text).toMatch(/\(auto-pass/)
    expect(text).toMatch(/enter a number from the list/)
    expect(clears.length).toBeGreaterThanOrEqual(2)
    expect(text).toMatch(/Turn \d/)
    expect(lines.some((l) => l.includes('!'))).toBe(true)
    expect(turns).toBeGreaterThan(0)
  })
})

describe('the terminal prompt cannot lose the game by accident', () => {
  /**
   * Found by playing the hotseat for the first time. `Number('')` is 0, `legalCommands` returns Concede
   * first, so option 0 WAS Concede — and a bare Enter at a `P0> ` prompt, the single most likely accidental
   * keystroke in a terminal, conceded the game instantly. `echo "" | pnpm --filter @fftcg/cli hotseat`
   * printed "GAME OVER: P1 wins — player 0 conceded".
   *
   * The browser already sorts Concede last for exactly this reason and says so in `Board`; the terminal had
   * the opposite order.
   */
  const deck = parseDeckFile(readFileSync(new URL('../../../decks/starter-2025-vol2.txt', import.meta.url), 'utf8'))
  const defs = loadCards()

  /** Drive the hotseat with a fixed script of answers; returns everything it printed. */
  async function play(answers: string[]): Promise<{ lines: string[]; asked: string[]; consumed: number }> {
    const lines: string[] = []
    const asked: string[] = []
    let i = 0
    const io: HotseatIo = {
      print(line) { for (const l of line.split('\n')) lines.push(l) },
      clear() {},
      async ask(prompt) {
        asked.push(prompt)
        if (prompt.startsWith('Pass the device')) return ''
        // Running out of script ends the game rather than looping forever.
        if (i >= answers.length) throw new Error('script exhausted')
        return answers[i++] as string
      },
    }
    try { await hotseat({ seed: 3, decks: [deck, deck], defs }, io) } catch (e) {
      if ((e as Error).message !== 'script exhausted') throw e
    }
    return { lines, asked, consumed: i }
  }

  const menu = (lines: string[]): { i: number; desc: string }[] => {
    let turn = -1
    for (let i = lines.length - 1; i >= 0; i--) if (/^=== Turn/.test(lines[i] ?? '')) { turn = i; break }
    const out: { i: number; desc: string }[] = []
    for (let i = turn + 1; i < lines.length; i++) {
      const m = /^\s*(\d+): (.*)$/.exec(lines[i] ?? '')
      if (m) out.push({ i: Number(m[1]), desc: m[2] as string })
    }
    return out
  }

  it('offers Concede LAST, never as option 0', async () => {
    const { lines } = await play([])
    const m = menu(lines)
    expect(m.length, 'no menu was printed, so this proves nothing').toBeGreaterThan(1)
    expect(m[0]?.desc, 'Concede is the first option again').not.toBe('Concede')
    expect(m.at(-1)?.desc, 'Concede is not last').toBe('Concede')
  })

  it('a bare Enter does not concede — it asks again', async () => {
    const { lines, asked } = await play(['', '', ''])
    expect(lines).toContain('enter a number from the list')
    expect(lines.join('\n'), 'a blank line ended the game').not.toContain('conceded')
    // ...and it really did keep asking rather than falling through to something.
    expect(asked.filter((a) => a.startsWith('P0> ')).length).toBeGreaterThan(1)
  })

  it('choosing Concede asks first, and "n" keeps playing', async () => {
    const { lines } = await play([])
    const concede = menu(lines).find((e) => e.desc === 'Concede')!
    const out = await play([String(concede.i), 'n', String(concede.i), 'n'])
    expect(out.asked.some((a) => /Concede the game\?/.test(a)), 'it did not ask').toBe(true)
    expect(out.lines).toContain('still playing')
    expect(out.lines.join('\n'), 'declining still conceded').not.toContain('conceded')
    // "Keeps playing" means the loop went round again and asked for the NEXT answer. Without this the test
    // passes when declining ABANDONS the prompt entirely — Codex swapped the `continue` for a `return` and
    // everything here stayed green, because not-conceding and not-asking-again look identical from outside.
    expect(out.consumed, 'declining did not return to the menu — it stopped asking').toBeGreaterThan(2)
    expect(out.asked.filter((a) => /Concede the game\?/.test(a)).length, 'the second attempt never happened').toBe(2)
  })

  it('choosing Concede and confirming does end the game', async () => {
    const { lines } = await play([])
    const concede = menu(lines).find((e) => e.desc === 'Concede')!
    const out = await play([String(concede.i), 'y'])
    expect(out.lines.join('\n'), 'confirming did not concede').toContain('conceded')
  })
})

describe('running out of input quits instead of crashing', () => {
  /**
   * The ONLY test that runs the real terminal path. Every other test here injects `HotseatIo`, so
   * `createInterface`, the close listener, the abort signal and `InputEnded` are never executed by them —
   * Codex deleted the whole EOF fix and the suite stayed green (MAJOR).
   *
   * What it guards: `rl.question` does not settle when stdin ends, so node reported "Detected unsettled
   * top-level await" and the process exited 13. Pressing Ctrl-D, or piping anything at all, got that instead
   * of a quit.
   *
   * A child process, because that is the only way to have a real stdin to close.
   */
  it('exits 0 with a message when stdin closes', async () => {
    const cli = new URL('../', import.meta.url).pathname
    const child = spawn('node', ['--import', 'tsx', 'src/main.ts', 'hotseat', '--seed', '3'], {
      cwd: cli, stdio: ['pipe', 'pipe', 'pipe'],
    })
    let out = ''
    child.stdout.on('data', (b: Buffer) => { out += b.toString() })
    child.stderr.on('data', (b: Buffer) => { out += b.toString() })
    // One blank line — which used to concede — and then end the input.
    child.stdin.write('\n')
    child.stdin.end()

    const code = await new Promise<number | null>((resolve) => { child.on('close', resolve) })
    expect(out, 'the blank line conceded the game').not.toContain('conceded')
    expect(out, 'the prompt did not reject the blank line').toContain('enter a number from the list')
    expect(out, 'no clean exit message').toContain('input closed')
    expect(out, 'node reported the unsettled await again').not.toContain('unsettled top-level await')
    expect(code, 'a closed stdin is not a crash').toBe(0)
  }, 60_000)
})

describe('the hotseat prints WHY a choice is being asked', () => {
  /**
   * The integration half. `render.test.ts` proves `askingBecause` builds the right line; nothing proved the
   * hotseat ever CALLS it — deleting the print left every test green, which is precisely the gap the E1 plan
   * review predicted for a helper tested in isolation.
   */
  it('a full game shows at least one clause explaining a choice', async () => {
    const deck = parseDeckFile(readFileSync(new URL('../../../decks/starter-2025-vol2.txt', import.meta.url), 'utf8'))
    const defs = loadCards()
    const lines: string[] = []
    let rng: Rng = seedRng(11)
    let asks = 0
    const io: HotseatIo = {
      print(l) { for (const x of l.split('\n')) lines.push(x) },
      clear() {},
      async ask(prompt) {
        if (++asks > 5000) throw new Error('stuck')
        if (prompt.startsWith('Pass the device')) return ''
        if (/Concede the game/.test(prompt)) return 'n'
        let turn = -1
        for (let i = lines.length - 1; i >= 0; i--) if (/^=== Turn/.test(lines[i] ?? '')) { turn = i; break }
        const menu: { i: number; desc: string }[] = []
        for (let i = turn + 1; i < lines.length; i++) {
          const m = /^\s*(\d+): (.*)$/.exec(lines[i] ?? '')
          if (m) menu.push({ i: Number(m[1]), desc: m[2] as string })
        }
        const pool = menu.filter((e) => e.desc !== 'Concede')
        const [idx, next] = nextInt(rng, Math.max(1, pool.length))
        rng = next
        return String((pool[idx] ?? menu[0])!.i)
      },
    }
    await hotseat({ seed: 11, decks: [deck, deck], defs }, io)

    // "  Noel (16-092C) — When Noel enters the field, choose up to 2 Forwards opponent controls. Dull them."
    const explained = lines.filter((l) => /^ {2}\S.* \(\d+-\d+[A-Z]\) — \S/.test(l))
    expect(explained.length, 'no choice in a whole game was explained — the line is never printed').toBeGreaterThan(0)
    // ...and it is a real clause, not an empty dash.
    expect(explained[0]!.split(' — ')[1]!.length).toBeGreaterThan(10)
  }, 120_000)
})
