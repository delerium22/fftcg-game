import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { actingPlayer, apply, createGame, legalCommands, viewFor, type Command, type GameState } from '@fftcg/engine'
import { GreedyAgent } from '@fftcg/ai'
import { loadCards } from '@fftcg/cards'
import { parseDeckFile } from '../src/deck.js'

/**
 * The two things the AI must never get wrong, as PROPERTIES over played games rather than as hand-built
 * positions.
 *
 * `ismcts-search.test.ts` already pins one constructed board where the search takes an unblocked lethal. That
 * proves the case works; it cannot prove the case is still REACHED, and it says nothing about the heuristic
 * agent that plays every rollout and every fallback. A weight change — G1b's `damageCurve` is exactly such a
 * change, and it is specced and waiting — could silently move either.
 *
 * Both are cheap because greedy is cheap: sixty seeded games run in a few seconds.
 */

const DECK = parseDeckFile(readFileSync(new URL('../../../decks/starter-2025-vol2.txt', import.meta.url), 'utf8'))
const DEFS = loadCards()
const CORPUS_TIMEOUT = 300_000

/**
 * Does this command win the game outright, once the defender has answered?
 *
 * The defender's block is SIMULATED, not assumed away: an attack is only lethal if it survives the reply, and
 * treating every attack against a low-life opponent as lethal would make this test fail on correct play. The
 * walk stops as soon as the attack is fully resolved, because anything past that is a later decision's doing.
 */
function winsOutright(s: GameState, c: Command, me: number): boolean {
  const replier = new GreedyAgent({ seed: 12345, decks: [DECK, DECK], depth: 1 })
  let t = apply(s, c).state
  for (let i = 0; i < 200 && !t.result; i++) {
    if (t.attack === null || t.attack.step === 'declaration') break
    const p = actingPlayer(t)
    if (p === null) break
    t = apply(t, replier.decide(viewFor(t, p), legalCommands(t, p))).state
  }
  return t.result?.winner === me
}

describe('the AI never walks past a win (greedy, 60 seeded games)', () => {
  it('takes a winning attack whenever one exists', () => {
    let declarations = 0
    let available = 0
    const missed: string[] = []

    for (let seed = 1; seed <= 60; seed++) {
      let s: GameState = createGame({ seed, decks: [DECK, DECK], defs: DEFS })
      const agent = new GreedyAgent({ seed, decks: [DECK, DECK], depth: 1 })
      for (let i = 0; i < 4000 && !s.result; i++) {
        const p = actingPlayer(s)
        if (p === null) break
        const legal = legalCommands(s, p)
        const chosen = agent.decide(viewFor(s, p), legal) as Command

        if (s.phase === 'attack' && s.attack?.step === 'declaration' && s.pending === null) {
          declarations++
          const winning = legal.filter((c) => c.type === 'declareAttack' && winsOutright(s, c, p))
          if (winning.length > 0) {
            available++
            const took = chosen.type === 'declareAttack' && winsOutright(s, chosen, p)
            if (!took && missed.length < 4) {
              missed.push(`seed ${seed}: ${winning.length} winning attack(s), P${p} chose ${chosen.type}`)
            }
            if (!took) missed.push('')
          }
        }
        s = apply(s, chosen).state
      }
    }

    // Non-vacuity first, and it matters more than usual here: a corpus that never REACHES a winning attack
    // would pass this perfectly while proving nothing at all, and the pool has changed under this program
    // several times (rungs C5–C10 shortened games considerably).
    expect(declarations, 'no attack was ever declared, so nothing was examined').toBeGreaterThan(500)
    expect(available, 'no winning attack was ever available, so this test asserts nothing').toBeGreaterThan(20)
    expect(missed.filter(Boolean).length, `the AI walked past a win: ${missed.filter(Boolean).join(' | ')}`).toBe(0)
  }, CORPUS_TIMEOUT)
})

describe('declining a block into a loss is deliberate, not a miss', () => {
  it('only ever declines a fatal block when every block loses too (see the rejected G5 note)', () => {
    // The counterpart, and it exists to pin the REASON rather than the behaviour. The AI regularly declines a
    // block and dies — 32 games in 120 — and that is correct: both answers score exactly -terminal because the
    // attacker simply declares another attack, so blocking delays a point and nothing more. Forcing the block
    // changed the winner in 0 of those 32.
    //
    // What must not happen is declining while a block would have left the position genuinely better by the
    // evaluation's own measure. That is what this checks: at every fatal decline, the blocking answers scored
    // no higher than the declining one.
    let fatalDeclines = 0
    const wrong: string[] = []

    for (let seed = 1; seed <= 40; seed++) {
      let s: GameState = createGame({ seed, decks: [DECK, DECK], defs: DEFS })
      const agent = new GreedyAgent({ seed, decks: [DECK, DECK], depth: 1 })
      for (let i = 0; i < 4000 && !s.result; i++) {
        const p = actingPlayer(s)
        if (p === null) break
        const legal = legalCommands(s, p)
        const chosen = agent.decide(viewFor(s, p), legal) as Command

        if (s.pending?.kind === 'declareBlock' && chosen.type === 'declareBlock' && chosen.blocker === null) {
          const lost = apply(s, chosen).state.result
          if (lost && lost.winner !== null && lost.winner !== p) {
            const saver = legal.find((c) => c.type === 'declareBlock' && c.blocker !== null && !apply(s, c).state.result)
            if (saver) {
              fatalDeclines++
              const declineScore = agent.lastScores.find((x) => (x.command as Command).type === 'declareBlock'
                && (x.command as Extract<Command, { type: 'declareBlock' }>).blocker === null)?.score
              const best = Math.max(...agent.lastScores.map((x) => x.score))
              if (declineScore !== undefined && declineScore < best) {
                wrong.push(`seed ${seed}: declined at ${declineScore} while ${best} was on offer`)
              }
            }
          }
        }
        s = apply(s, chosen).state
      }
    }

    expect(fatalDeclines, 'no fatal decline occurred, so the reasoning behind G5’s rejection is untested')
      .toBeGreaterThan(0)
    expect(wrong.length, `a fatal decline was NOT a tie — the G5 rejection no longer holds: ${wrong.slice(0, 3).join(' | ')}`)
      .toBe(0)
  }, CORPUS_TIMEOUT)
})
