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
