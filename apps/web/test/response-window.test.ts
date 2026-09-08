import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { actingPlayer, apply, createGame, forcedDecision, forcedPass, isResponseWindow, legalCommands, type CardId, type GameState } from '@fftcg/engine'
import { endPhase, makeGame, withField, withHand, withHandSize } from '../../../packages/engine/test/helpers.js'
import { GreedyAgent } from '@fftcg/ai'
import { CARD_DEFS, DECKS } from '../src/deck.js'
import { aiHandlers, settleForcedWindows, settleWindows, stepAi, useGame } from '../src/game/useGame.js'
import { AI, HUMAN, type GameApi } from '../src/game/types.js'

/**
 * Rung J1-A12 (slice 2): a pass-only response window is never something the human is shown.
 *
 * With priority that passes, the turn player's Main-Phase `pass` hands priority to the opponent, who may
 * (from slice 4) respond — and who, with nothing to respond with, may only pass back. That second pass is not
 * a decision, so the browser applies it in the same commit as the move that opened it: no render sees a
 * strip whose one button does nothing, and the AI never "thinks" about passing.
 */

const newGame = (seed: number): GameState => createGame({ seed, decks: DECKS, defs: CARD_DEFS })

/**
 * Walk to a Main Phase of the human's where the AI, handed priority by a pass, would have NOTHING to do — a
 * pass-only window. Since slice 4 the AI may respond with a Summon or an ability, so the position is found
 * rather than assumed: the first seed whose Main Phase 1 pass opens a forced window.
 */
function humanMain(seed: number): GameState | null {
  let s = newGame(seed)
  const agent = new GreedyAgent({ seed, decks: DECKS, depth: 1 })
  for (let i = 0; i < 60 && !s.result; i++) {
    if (actingPlayer(s) === HUMAN && s.phase === 'main1' && !s.pending) {
      const passed = apply(s, { type: 'pass', player: HUMAN }).state
      if (forcedPass(passed)) return s
      return null
    }
    if (actingPlayer(s) === AI) { s = stepAi(s, agent).state; continue }
    const next = legalCommands(s, HUMAN).find((c) => c.type !== 'concede')
    if (!next) return null
    s = apply(s, next).state
  }
  return null
}
function forcedWindowSeed(): number {
  for (let seed = 1; seed < 40; seed++) if (humanMain(seed)) return seed
  throw new Error('no seed under 40 opens a pass-only window from the human\'s Main Phase 1')
}

describe('a pass-only window is closed in the same step (J1-A12)', () => {
  it('settleForcedWindows applies every forced pass and stops at the first real decision', () => {
    const s = humanMain(forcedWindowSeed())!
    expect(s).not.toBeNull()
    const passed = apply(s, { type: 'pass', player: HUMAN }).state
    expect(isResponseWindow(passed), 'the human’s pass should open the AI’s window').toBe(true)
    expect(forcedPass(passed)?.type).toBe('pass')
    const settled = settleForcedWindows(passed).state
    // The Attack Phase's preparation window IS a response window (slice 4: the human may cast a Summon from
    // it), so what is asserted is that the settling stopped at a REAL decision, not at a window as such.
    expect(forcedPass(settled)).toBeNull()
    expect(settled.phase).toBe('attack')
    expect(actingPlayer(settled)).toBe(HUMAN)
  })

  it('stepAi closes the window and hands the real decision back without deciding for the human', () => {
    const seed = forcedWindowSeed()
    const s = humanMain(seed)!
    const agent = new GreedyAgent({ seed, decks: DECKS, depth: 1 })
    const passed = apply(s, { type: 'pass', player: HUMAN }).state
    const stepped = stepAi(passed, agent)
    // No MOVE line for the pass itself; what the passes caused (the phase the window's exit began) is narrated.
    expect(stepped.lines.filter((l) => l.kind === 'ai' || l.kind === 'human'), 'a forced pass was narrated as a move').toEqual([])
    expect(stepped.lines.every((l) => l.kind === 'phase' || l.kind === 'event'), 'only what the exit caused is narrated').toBe(true)
    expect(actingPlayer(stepped.state)).toBe(HUMAN)
    expect(stepped.state.phase).toBe('attack')
  })

  it('the hook never publishes a choice set whose only live choice is a forced pass', () => {
    // A seed whose opening decision is the human's, so the hook is driven from the human side throughout.
    let seed = -1
    for (let s = 1; s < 60 && seed < 0; s++) { const g = newGame(s); if (g.pending?.kind === 'chooseFirst' && g.pending.player === HUMAN) seed = s }
    expect(seed).toBeGreaterThan(0)
    const published: { window: boolean; live: string[] }[] = []
    const ref: { api: GameApi | null } = { api: null }
    function Probe(): null {
      const game = useGame(seed)
      ref.api = game
      published.push({ window: isResponseWindow(game.view), live: game.choices.all.filter((c) => c.command.type !== 'concede').map((c) => c.command.type) })
      return null
    }
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    act(() => { root.render(createElement(Probe)) })
    // Take the first non-concede choice while the human has one and the game has not handed to the AI.
    for (let i = 0; i < 12; i++) {
      const game = ref.api
      if (!game || game.aiThinking) break
      const next = game.choices.all.find((c) => c.command.type !== 'concede')
      if (!next) break
      act(() => { game.choose(next) })
    }
    // Every published render that is a response window has something to do besides passing, or is not a
    // window at all — the forced pass never reached a render.
    for (const r of published) {
      if (r.window) expect(r.live.filter((t) => t !== 'pass'), `a pass-only window was rendered: ${r.live.join(',')}`).not.toEqual([])
    }
    act(() => { root.unmount() })
    host.remove()
  })
})

describe('a decision with one answer is closed in the same step (K2-A2)', () => {
  it('settleForcedWindows applies the forced no-block and stops at the next real decision, with no move line for it', () => {
    // The AI attacks into a human whose only Forward is dull: the block is owed and has one answer.
    let s = endPhase(makeGame())
    s = { ...s, turnPlayer: AI, priority: AI, firstPlayer: AI }
    let attacker: CardId, dull: CardId
    ;[s, attacker] = withField(s, AI, 'forwards', 'V-F2')
    ;[s, dull] = withField(s, HUMAN, 'forwards', 'V-F3', { status: 'dull' })
    s = withHandSize(withHandSize(s, HUMAN, 0), AI, 0)
    const declared = apply(s, { type: 'declareAttack', player: AI, attackers: [attacker] }).state
    const settled = settleForcedWindows(declared)
    expect(settled.state.pending, 'the block was answered for the human').toBeNull()
    expect(settled.state.attack?.step === 'block').toBe(false)
    expect(settled.state.players[HUMAN].damageZone, 'the unblocked attack dealt its point').toHaveLength(1)
    expect(settled.events.some((e) => e.type === 'phaseStarted'), 'what the forced answers caused is returned').toBe(true)
    expect(forcedDecision(settled.state), 'stopped at a real decision').toBeNull()
    expect(dull).toBeGreaterThan(0)
  })
})

describe('the auto-pass toggle (K4-A1)', () => {
  /** The AI's Main Phase 1 with the human holding priority after the AI's pass, and a castable Summon in hand: a REAL window. */
  function humanWindowInAiMain(): GameState {
    let s = makeGame()
    s = { ...s, turnPlayer: AI, priority: AI, firstPlayer: AI }
    s = withHandSize(withHandSize(s, AI, 0), HUMAN, 0)
    for (const code of ['V-S1', 'V-F1', 'V-F1']) [s] = withHand(s, HUMAN, code)
    const passed = apply(s, { type: 'pass', player: AI }).state
    expect(actingPlayer(passed)).toBe(HUMAN)
    expect(isResponseWindow(passed)).toBe(true)
    expect(forcedDecision(passed), 'a castable Summon makes it a real window').toBeNull()
    return passed
  }
  it('off: the human’s real window is left for the human', () => {
    const w = humanWindowInAiMain()
    expect(settleWindows(w, { autoPass: false }).state).toBe(w)
  })
  it('on: the human’s response windows are passed until the AI has a decision or the game owes one', () => {
    const w = humanWindowInAiMain()
    const settled = settleWindows(w, { autoPass: true })
    expect(settled.state).not.toBe(w)
    expect(actingPlayer(settled.state) === HUMAN && isResponseWindow(settled.state), 'a human window survived').toBe(false)
    expect(settled.events.some((e) => e.type === 'phaseStarted'), 'the AI’s Main Phase ended').toBe(true)
  })
  it('on: never the human’s own empty-stack Main Phase, and never a decision the game owes', () => {
    let s = makeGame()
    for (const code of ['V-S1', 'V-F1', 'V-F1']) [s] = withHand(s, HUMAN, code)
    expect(actingPlayer(s)).toBe(HUMAN)
    expect(s.phase).toBe('main1')
    expect(settleWindows(s, { autoPass: true }).state, 'the Pass that ends a phase stays a button').toBe(s)
    // A block owed with a live blocker is a pending, not a window: untouched.
    let b = endPhase(makeGame())
    b = { ...b, turnPlayer: AI, priority: AI, firstPlayer: AI }
    let attacker: CardId
    ;[b, attacker] = withField(b, AI, 'forwards', 'V-F2')
    ;[b] = withField(b, HUMAN, 'forwards', 'V-F3')
    b = withHandSize(withHandSize(b, HUMAN, 0), AI, 0)
    const owed = settleWindows(apply(b, { type: 'declareAttack', player: AI, attackers: [attacker] }).state, { autoPass: true }).state
    expect(owed.pending).toEqual({ kind: 'declareBlock', player: HUMAN })
  })
})

describe('the AI’s commit path honours the toggle (K4-A2)', () => {
  it('with the toggle on, the window the AI’s pass hands the human is closed before the commit; off, it is the human’s', () => {
    let s = makeGame()
    s = { ...s, turnPlayer: AI, priority: AI, firstPlayer: AI }
    s = withHandSize(withHandSize(s, AI, 0), HUMAN, 0)
    for (const code of ['V-S1', 'V-F1', 'V-F1']) [s] = withHand(s, HUMAN, code)
    const pass = { type: 'pass' as const, player: AI }
    for (const on of [false, true]) {
      const committed: GameState[] = []
      const handlers = aiHandlers({ commit: (state) => { committed.push(state) }, log: () => {}, autoPass: () => on })
      expect(handlers.onCommand(pass, s)).toBe(true)
      const after = committed[0]!
      const humanWindow = actingPlayer(after) === HUMAN && isResponseWindow(after)
      expect(humanWindow, on ? 'on: the human’s window was passed' : 'off: the window is the human’s').toBe(!on)
    }
  })
})
