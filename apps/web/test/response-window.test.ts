import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { actingPlayer, apply, createGame, forcedDecision, forcedPass, isResponseWindow, legalCommands, type CardId, type GameState } from '@fftcg/engine'
import { VANILLA_POOL, endPhase, makeDef, makeGame, withField, withHand, withHandSize } from '../../../packages/engine/test/helpers.js'
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

describe('smart auto-pass (K5-A1)', () => {
  /** A seat's hand with a castable Summon in it: makes any response window a REAL one. */
  function armed(s: GameState, player: 0 | 1): GameState {
    let t = withHandSize(s, player, 0)
    for (const code of ['V-S2', 'V-F1', 'V-F1']) [t] = withHand(t, player, code)   // a cost-1 earth Summon, payable by one earth discard
    return t
  }
  /** The AI's Main Phase 1 with the human holding priority after the AI's pass, and a castable Summon in hand: a REAL window. */
  function humanWindowInAiMain(): GameState {
    let s = makeGame()
    s = { ...s, turnPlayer: AI, priority: AI, firstPlayer: AI }
    s = armed(withHandSize(s, AI, 0), HUMAN)
    const passed = apply(s, { type: 'pass', player: AI }).state
    expect(actingPlayer(passed)).toBe(HUMAN)
    expect(isResponseWindow(passed)).toBe(true)
    expect(forcedDecision(passed), 'a castable Summon makes it a real window').toBeNull()
    return passed
  }
  const humanWindow = (s: GameState): boolean => actingPlayer(s) === HUMAN && isResponseWindow(s)

  it('full control: the human’s real window is left for the human', () => {
    const w = humanWindowInAiMain()
    expect(settleWindows(w, { control: 'full' }).state).toBe(w)
  })
  it('smart: an empty-stack window in the AI’s Main Phase is passed until the AI has a decision', () => {
    const w = humanWindowInAiMain()
    const settled = settleWindows(w, { control: 'smart' })
    expect(settled.state).not.toBe(w)
    expect(humanWindow(settled.state), 'a human window survived').toBe(false)
    expect(settled.events.some((e) => e.type === 'phaseStarted'), 'the AI’s Main Phase ended').toBe(true)
  })
  it('smart: a window whose stack top is the AI’s Summon is kept — the AI did something the human could answer', () => {
    let s = makeGame()
    s = { ...s, turnPlayer: AI, priority: AI, firstPlayer: AI }
    s = armed(armed(s, AI), HUMAN)
    const cast = legalCommands(s, AI).find((c) => c.type === 'castSummon')
    expect(cast, 'the AI can cast its Summon').toBeDefined()
    let w = apply(s, cast!).state
    if (actingPlayer(w) === AI) w = apply(w, { type: 'pass', player: AI }).state
    expect(humanWindow(w)).toBe(true)
    expect(w.stack.at(-1)).toMatchObject({ kind: 'summon', controller: AI })
    expect(settleWindows(w, { control: 'smart' }).state, 'kept for the human').toBe(w)
  })
  it('smart: a window whose stack top is the human’s OWN Summon is passed — the AI’s forced pass then resolves it', () => {
    let s = makeGame()
    expect(s.turnPlayer).toBe(HUMAN)
    s = armed(withHandSize(s, AI, 0), HUMAN)
    for (const code of ['V-S2', 'V-F1']) [s] = withHand(s, HUMAN, code)   // a second castable Summon, left to answer with
    const cast = legalCommands(s, HUMAN).find((c) => c.type === 'castSummon')!
    const w = apply(s, cast).state
    expect(humanWindow(w) && w.stack.at(-1)?.kind === 'summon', 'the caster holds priority with their Summon on top').toBe(true)
    expect(forcedDecision(w), 'the second Summon makes it a real window').toBeNull()
    const settled = settleWindows(w, { control: 'smart' }).state
    expect(settled.stack, 'the Summon resolved').toEqual([])
    expect(settled.phase).toBe('main1')
    expect(actingPlayer(settled), 'back in the human’s own Main Phase, which is never passed').toBe(HUMAN)
    expect(settled.players[HUMAN].breakZone).toContain(cast.type === 'castSummon' ? cast.card : -1)
  })
  /** The AI attacks a human who holds a live blocker and a castable Summon. */
  function aiAttack(): { state: GameState; blocker: CardId } {
    let b = endPhase(makeGame())
    b = { ...b, turnPlayer: AI, priority: AI, firstPlayer: AI }
    let attacker: CardId, blocker: CardId
    ;[b, attacker] = withField(b, AI, 'forwards', 'V-F2')
    ;[b, blocker] = withField(b, HUMAN, 'forwards', 'V-F3')
    b = armed(withHandSize(b, AI, 0), HUMAN)
    return { state: apply(b, { type: 'declareAttack', player: AI, attackers: [attacker] }).state, blocker }
  }
  it('smart: the `declared` window of the AI’s attack is passed (K5-D4) and the block decision is the human’s', () => {
    const { state } = aiAttack()
    const settled = settleWindows(state, { control: 'smart' }).state
    expect(settled.pending).toEqual({ kind: 'declareBlock', player: HUMAN })
  })
  it('smart: the `declared` window of the AI’s attack is KEPT when the human could cast a Back Attack Character there (J2 review H1)', () => {
    // K5-D4 passed `declared` when only Summons could be cast there; rung J2 made it the surprise-blocker window.
    const defs = [...VANILLA_POOL, makeDef({ code: 'T-BA', cost: 0, power: 5000, keywords: ['backAttack'] })]
    let b = endPhase(makeGame({ defs }))
    b = { ...b, turnPlayer: AI, priority: AI, firstPlayer: AI }
    let attacker: CardId
    ;[b, attacker] = withField(b, AI, 'forwards', 'V-F2')
    b = withHandSize(withHandSize(b, AI, 0), HUMAN, 0)
    ;[b] = withHand(b, HUMAN, 'T-BA')
    const declared = apply(b, { type: 'declareAttack', player: AI, attackers: [attacker] }).state
    const w = apply(declared, { type: 'pass', player: AI }).state   // §11.1.6: the attacker forfeits first
    expect(humanWindow(w) && w.attack?.step === 'declared').toBe(true)
    expect(legalCommands(w, HUMAN).some((c) => c.type === 'castCharacter'), 'the Back Attack cast is on the menu').toBe(true)
    expect(settleWindows(w, { control: 'smart' }).state, 'kept: a Character could enter here').toBe(w)
  })
  it('smart: an UNAFFORDABLE Back Attack Character does not keep the `declared` window (J2 second review M1)', () => {
    const defs = [...VANILLA_POOL, makeDef({ code: 'T-BA2', cost: 2, power: 5000, keywords: ['backAttack'] })]
    let b = endPhase(makeGame({ defs }))
    b = { ...b, turnPlayer: AI, priority: AI, firstPlayer: AI }
    let attacker: CardId
    ;[b, attacker] = withField(b, AI, 'forwards', 'V-F2')
    ;[b] = withField(b, HUMAN, 'forwards', 'V-F3')                // a blocker, so the block is a real decision
    b = withHandSize(withHandSize(b, AI, 0), HUMAN, 0)
    ;[b] = withHand(b, HUMAN, 'T-BA2')                            // its only card: nothing to pay 2 CP with
    const declared = apply(b, { type: 'declareAttack', player: AI, attackers: [attacker] }).state
    const w = apply(declared, { type: 'pass', player: AI }).state
    expect(legalCommands(w, HUMAN).some((c) => c.type === 'castCharacter')).toBe(false)
    expect(settleWindows(w, { control: 'smart' }).state.pending, 'passed through to the block').toEqual({ kind: 'declareBlock', player: HUMAN })
  })
  it('smart: the `blocked` window before damage is kept (K5-D3.2)', () => {
    const { state, blocker } = aiAttack()
    const owed = settleWindows(state, { control: 'smart' }).state
    const blocked = apply(owed, { type: 'declareBlock', player: HUMAN, blocker }).state
    const settled = settleWindows(blocked, { control: 'smart' }).state
    expect(settled.attack?.step).toBe('blocked')
    expect(humanWindow(settled), 'the human holds the window in which combat is decided').toBe(true)
    expect(forcedDecision(settled)).toBeNull()
  })
  it('smart: never the human’s own empty-stack Main Phase, and never a decision the game owes', () => {
    const s = armed(makeGame(), HUMAN)
    expect(actingPlayer(s)).toBe(HUMAN)
    expect(s.phase).toBe('main1')
    expect(settleWindows(s, { control: 'smart' }).state, 'the Pass that ends a phase stays a button').toBe(s)
  })
})

describe('the AI’s commit path settles under the live mode (K5-A2)', () => {
  it('smart: the empty-stack window the AI’s pass hands the human is closed before the commit; full: it is the human’s', () => {
    let s = makeGame()
    s = { ...s, turnPlayer: AI, priority: AI, firstPlayer: AI }
    s = withHandSize(withHandSize(s, AI, 0), HUMAN, 0)
    // Lightning discards: the Lightning Summon must be AFFORDABLE for the window to be a real one (J2 second review M1).
    for (const code of ['V-S1', 'V-F3', 'V-F3']) [s] = withHand(s, HUMAN, code)
    const pass = { type: 'pass' as const, player: AI }
    for (const control of ['full', 'smart'] as const) {
      const committed: GameState[] = []
      const handlers = aiHandlers({ commit: (state) => { committed.push(state) }, log: () => {}, control: () => control })
      expect(handlers.onCommand(pass, s)).toBe(true)
      const after = committed[0]!
      const humanWindow = actingPlayer(after) === HUMAN && isResponseWindow(after)
      expect(humanWindow, control === 'smart' ? 'smart: the human’s window was passed' : 'full: the window is the human’s').toBe(control === 'full')
    }
  })
})
