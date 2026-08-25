import { describe, expect, it } from 'vitest'
import { RandomAgent } from '../src/index.js'
import type { Command, PlayerView } from '@fftcg/engine'

const legal: Command[] = [{ type: 'concede', player: 0 }, { type: 'pass', player: 0 }, { type: 'mulligan', player: 0, redraw: true }]
describe('RandomAgent', () => {
  it('is deterministic per seed and avoids concede when anything else is legal', () => {
    const picks = (seed: number) => { const a = new RandomAgent(seed); return Array.from({ length: 20 }, () => a.decide({} as PlayerView, legal).type) }
    expect(picks(1)).toEqual(picks(1))
    expect(picks(1)).not.toContain('concede')
    expect(new Set(picks(1)).size).toBe(2)
  })
  it('concedes when that is the only legal command', () => {
    expect(new RandomAgent(1).decide({} as PlayerView, [legal[0] as Command]).type).toBe('concede')
  })
})
