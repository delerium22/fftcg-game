import { describe, expect, it } from 'vitest'
import { GameSession } from '../src/session.js'
import { actingPlayer, legalCommands } from '../src/legal.js'
import { nextInt, seedRng } from '../src/rng.js'
import { DEFAULT_DECK, VANILLA_POOL } from './helpers.js'

const opts = { seed: 11, decks: [DEFAULT_DECK, DEFAULT_DECK] as [string[], string[]], defs: VANILLA_POOL }

function playRandom(session: GameSession, n: number) {
  let rng = seedRng(99)
  for (let i = 0; i < n && !session.state.result; i++) {
    const p = actingPlayer(session.state)!
    const cmds = legalCommands(session.state, p).filter((c) => c.type !== 'concede')
    const [k, r] = nextInt(rng, cmds.length); rng = r
    session.apply(cmds[k]!)
  }
}

describe('GameSession', () => {
  it('replaying the command log reproduces the identical state', () => {
    const a = new GameSession(opts)
    playRandom(a, 120)
    expect(a.commands.length).toBeGreaterThan(50)
    expect(GameSession.replay(opts, a.commands)).toEqual(a.state)
    expect(GameSession.fromJSON(JSON.parse(JSON.stringify(a.toJSON()))).state).toEqual(a.state)
  })
  it('undo truncates the log and restores the previous state', () => {
    const a = new GameSession(opts)
    playRandom(a, 40)
    const before = JSON.stringify(a.state)
    const p = actingPlayer(a.state)!
    a.apply(legalCommands(a.state, p).find((c) => c.type !== 'concede')!)
    expect(JSON.stringify(a.state)).not.toBe(before)
    expect(a.undo()).toBe(true)
    expect(JSON.stringify(a.state)).toBe(before)
    const fresh = new GameSession(opts)
    expect(fresh.undo()).toBe(false)
  })
})
