import { describe, expect, it } from 'vitest'
import {
  actingPlayer, apply, createGame, legalCommands, viewFor,
  type CardId, type Command, type GameState, type PlayerView,
} from '@fftcg/engine'
import { GreedyAgent, type Agent } from '@fftcg/ai'
import { CARD_DEFS, DECKS } from '../src/deck.js'
import { buildChoiceSet, describeChoice, preferredChoices, sameCommand } from '../src/game/commands.js'
import { AI, HUMAN, type LogLine } from '../src/game/types.js'
import { describeEvent, stepAi } from '../src/game/useGame.js'

const newGame = (seed: number): GameState => createGame({ seed, decks: DECKS, defs: CARD_DEFS })

/** Spec B-A3, asserted rather than inspected: nothing the AI holds in hand may reach the human's view. */
function assertNoAiHandLeak(state: GameState, view: PlayerView): void {
  for (const id of state.players[AI].hand) {
    expect(view.cards[id]).toBeUndefined()
    expect(view.hand).not.toContain(id)
  }
}

interface PlayedGame { state: GameState; log: LogLine[]; humanMoves: number; commandTypes: Set<Command['type']> }

/**
 * Play a whole game headlessly: `stepAi` drives the agent, and the "human" always takes the first non-concede
 * choice `buildChoiceSet` offers. This is B-A1 (a game reaches a result), B-A2 (only UI-reachable commands are
 * used) and B-A4 (every applied command was in `legalCommands` at the time) without a browser.
 */
function playFullGame(seed: number): PlayedGame {
  let state = newGame(seed)
  const agent: Agent = new GreedyAgent({ seed, decks: DECKS, depth: 1 })
  const log: LogLine[] = []
  const commandTypes = new Set<Command['type']>()
  let humanMoves = 0
  for (let step = 0; step < 4000 && !state.result; step++) {
    const view = viewFor(state, HUMAN)
    assertNoAiHandLeak(state, view)
    if (actingPlayer(state) === AI) {
      const before = state
      const stepped = stepAi(state, agent)
      expect(stepped.state).not.toBe(before)   // stepAi applies exactly one command
      state = stepped.state
      log.push(...stepped.lines)
      continue
    }
    const legal = legalCommands(state, HUMAN)
    const choices = buildChoiceSet(view, preferredChoices(view, legal))
    const choice = choices.all.find((ch) => ch.command.type !== 'concede')
    expect(choice, `no non-concede choice in ${view.phase}`).toBeDefined()
    // independent of the hook's own guard: the command really is in the legal set at this instant
    expect(legal.some((c) => sameCommand(c, choice!.command))).toBe(true)
    commandTypes.add(choice!.command.type)
    const result = apply(state, choice!.command)
    log.push({ kind: 'human', text: describeChoice(view, choice!.command) })
    for (const e of result.events) { const line = describeEvent(viewFor(result.state, HUMAN), e); if (line) log.push(line) }
    state = result.state
    humanMoves++
  }
  return { state, log, humanMoves, commandTypes }
}

describe('stepAi', () => {
  it('applies exactly one command and narrates it', () => {
    const state = newGame(5)
    const agent = new GreedyAgent({ seed: 5, decks: DECKS, depth: 1 })
    const acting = actingPlayer(state)
    if (acting === HUMAN) {
      // seed 5 opened on the human; still fine — stepAi drives whoever is acting
      expect(acting).toBe(HUMAN)
    }
    const { state: next, lines } = stepAi(state, agent)
    expect(next).not.toBe(state)
    expect(lines[0]?.kind).toBe('ai')
    expect(lines[0]?.text.length).toBeGreaterThan(0)
  })

  it('is a no-op once the game is over', () => {
    const over = apply(newGame(5), { type: 'concede', player: HUMAN }).state
    const agent = new GreedyAgent({ seed: 5, decks: DECKS, depth: 1 })
    const stepped = stepAi(over, agent)
    expect(stepped.state).toBe(over)
    expect(stepped.lines).toEqual([])
  })

  it('refuses to apply a command outside the legal set (B-A4)', () => {
    const state = newGame(5)
    const rogue: Agent = { decide: (): Command => ({ type: 'declareAttack', player: actingPlayer(state)!, attackers: [1] }) }
    expect(() => stepAi(state, rogue)).toThrow(/illegal command/)
  })
})

describe('describeEvent', () => {
  const view = viewFor(newGame(1), HUMAN)
  it('surfaces unimplemented abilities as a warning (B-A6)', () => {
    const line = describeEvent(view, { type: 'unimplementedAbility', card: 1, code: '25-001H' })
    expect(line?.kind).toBe('warning')
    expect(line?.text).toContain('25-001H')
  })
  it('surfaces a skipped EX Burst as a warning', () => {
    expect(describeEvent(view, { type: 'exBurstSkipped', player: HUMAN, card: 1 })?.kind).toBe('warning')
  })
  it('drops the events the move line already states', () => {
    expect(describeEvent(view, { type: 'cast', player: HUMAN, card: 1, cardType: 'forward' })).toBeNull()
    expect(describeEvent(view, { type: 'attackDeclared', player: HUMAN, attackers: [1] })).toBeNull()
    expect(describeEvent(view, { type: 'cpGenerated', player: HUMAN, cp: ['fire'] })).toBeNull()
  })
  it('reports the result from the human seat', () => {
    expect(describeEvent(view, { type: 'gameOver', result: { winner: HUMAN, reason: 'damage' } })?.text).toContain('you win')
    expect(describeEvent(view, { type: 'gameOver', result: { winner: AI, reason: 'damage' } })?.text).toContain('the AI wins')
  })
})

describe('a complete headless game (B-A1/B-A2/B-A4)', () => {
  const played = playFullGame(1)

  it('terminates with a result', () => {
    expect(played.state.result).not.toBeNull()
    expect(viewFor(played.state, HUMAN).result).not.toBeNull()
    expect(played.humanMoves).toBeGreaterThan(5)
  })

  it('reaches the setup, main-phase and attack commands from the choice set alone', () => {
    for (const type of ['chooseFirst', 'mulligan', 'pass'] as const) expect(played.commandTypes).toContain(type)
    expect([...played.commandTypes].some((t) => t === 'castCharacter' || t === 'castSummon')).toBe(true)
    expect(played.commandTypes).toContain('declareAttack')
  })

  it('logs the game, ending in a result line, with the vanilla-pool warning visible (B-A6)', () => {
    expect(played.log.at(-1)?.kind).toBe('result')
    expect(played.log.some((l) => l.kind === 'warning')).toBe(true)
    expect(played.log.some((l) => l.kind === 'phase')).toBe(true)
    expect(played.log.some((l) => l.kind === 'ai')).toBe(true)
    expect(played.log.some((l) => l.kind === 'human')).toBe(true)
  })

  it('is deterministic for a fixed seed', () => {
    expect(playFullGame(1).log.map((l) => l.text)).toEqual(played.log.map((l) => l.text))
  })
})

describe('viewFor hides the AI hand throughout (B-A3)', () => {
  it('never exposes an AI hand card id to the human view', () => {
    let state = newGame(2)
    const agent = new GreedyAgent({ seed: 2, decks: DECKS, depth: 1 })
    let checked = 0
    for (let step = 0; step < 2000 && !state.result; step++) {
      const view = viewFor(state, HUMAN)
      assertNoAiHandLeak(state, view)
      const visible = new Set<CardId>(Object.keys(view.cards).map(Number))
      for (const id of state.players[AI].deck) expect(visible.has(id)).toBe(false)
      checked++
      if (actingPlayer(state) === AI) { state = stepAi(state, agent).state; continue }
      const legal = legalCommands(state, HUMAN)
      const next = legal.find((c) => c.type !== 'concede')
      if (!next) break
      state = apply(state, next).state
    }
    expect(checked).toBeGreaterThan(20)
    expect(state.players[AI].hand.length).toBeGreaterThan(0)   // there was something to hide
  })
})
