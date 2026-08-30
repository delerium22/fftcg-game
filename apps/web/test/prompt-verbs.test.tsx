import { describe, expect, it } from 'vitest'
import {
  actingPlayer, apply, createGame, legalCommands, viewFor,
  type Command, type GameState,
} from '@fftcg/engine'
import { GreedyAgent } from '@fftcg/ai'
import { CARD_DEFS, DECKS } from '../src/deck.js'
import { buildChoiceSet, paymentAlternatives, preferredChoices } from '../src/game/commands.js'
import { HUMAN } from '../src/game/types.js'

/**
 * Rung G2 — the prompt names moves you cannot make.
 *
 * `commands.ts` already states the principle, on the `chooseFromDeck` branch: a prompt must not instruct "a
 * move the engine would reject". That fix gave `chooseFromDeck` its own sentence and left the phase fallback
 * it was falling through TO — three hard-coded strings that describe the phase rather than the position.
 *
 * METHOD, so the counts are reproducible:
 *   seeds        1..6, `createGame({ seed, decks: DECKS, defs: CARD_DEFS })`
 *   both seats   `GreedyAgent({ seed, decks: DECKS, depth: 1 })` drives the game forward
 *   sampled at   every state where `actingPlayer === HUMAN`
 *   step cap     600 commands per seed
 *
 * The oracle is the LEGAL COMMANDS, not a second opinion about legality. Recomputing "can I attack here?"
 * independently would be a second implementation of the same rule, and this repo has been bitten by that
 * divergence before (`preferredPayment` against `canPay`, `backupElements` against `def.elements`).
 */

const isCast = (c: Command): boolean => c.type === 'castCharacter' || c.type === 'castSummon'

/** Which verbs the position actually offers, read off the commands themselves. */
function offered(legal: readonly Command[]): Set<string> {
  const out = new Set<string>()
  for (const c of legal) {
    if (isCast(c)) out.add('cast')
    else if (c.type === 'declareAttack') out.add('attack')
    else if (c.type === 'declareBlock') out.add('block')
  }
  return out
}

/**
 * Which verbs the prompt OFFERS, by the words it uses.
 *
 * Only the clause after the em dash counts. The words before it are the phase's NAME, and "Attack Phase"
 * contains "attack" without offering one — scanning the whole sentence found a verb that was not on the table
 * and failed this test against a correct prompt. That is the same substring mistake F6 made, where
 * `includes("2 ways to pay")` was satisfied by "12 ways to pay".
 */
function claimed(prompt: string): Set<string> {
  const out = new Set<string>()
  const dash = prompt.indexOf(' — ')
  const said = (dash < 0 ? prompt : prompt.slice(dash + 3)).toLowerCase()
  if (/\bcast\b/.test(said)) out.add('cast')
  if (/\battack\b/.test(said)) out.add('attack')
  if (/\bblock(er)?\b/.test(said)) out.add('block')
  return out
}

interface Sample { readonly phase: string; readonly prompt: string; readonly offers: Set<string>; readonly says: Set<string> }

function* samples(): Generator<Sample> {
  for (let seed = 1; seed <= 6; seed++) {
    const greedy = new GreedyAgent({ seed, decks: DECKS, depth: 1 })
    let s: GameState = createGame({ seed, decks: DECKS, defs: CARD_DEFS })
    for (let i = 0; i < 600 && !s.result; i++) {
      const p = actingPlayer(s)
      if (p === null) break
      if (p === HUMAN) {
        const view = viewFor(s, HUMAN)
        const legal = legalCommands(s, HUMAN)
        // Through the SAME path the board uses. Calling `promptFor` with no commands would exercise a
        // signature the app never uses, which is how a test measures something the player never sees.
        const prompt = buildChoiceSet(view, preferredChoices(view, legal), paymentAlternatives(legal)).prompt
        yield { phase: view.phase, prompt, offers: offered(legal), says: claimed(prompt) }
      }
      s = apply(s, greedy.decide(viewFor(s, p), legalCommands(s, p))).state
    }
  }
}

describe('G2 — the prompt only names moves the position offers', () => {
  it('never claims a verb the legal commands do not contain (G2-A1)', () => {
    const overclaims: string[] = []
    const byPhase = new Map<string, number>()
    const byVerb = new Map<string, number>()
    let seen = 0
    for (const s of samples()) {
      seen++
      for (const verb of s.says) {
        if (s.offers.has(verb)) continue
        byPhase.set(s.phase, (byPhase.get(s.phase) ?? 0) + 1)
        byVerb.set(verb, (byVerb.get(verb) ?? 0) + 1)
        if (overclaims.length < 4) overclaims.push(`${s.phase}: "${s.prompt}" claims "${verb}" with none legal`)
      }
    }
    expect(seen, 'no state was sampled, so this asserts nothing').toBeGreaterThan(200)
    // PER PHASE and PER VERB, so a fix that repairs `main1` and leaves `attack` broken cannot pass by
    // shrinking a total. The aggregate is reported for the record; the map is what the assertion reads.
    expect(
      { byPhase: Object.fromEntries(byPhase), byVerb: Object.fromEntries(byVerb) },
      `prompts naming an unavailable move: ${overclaims.join(' | ')}`,
    ).toEqual({ byPhase: {}, byVerb: {} })
  })

  it('still names the moves it DOES offer (G2-A2)', () => {
    // The converse, and the reason A1 cannot be satisfied by a prompt that says nothing. Both directions or
    // neither: a strip that went silent would pass A1 perfectly and be worse than what it replaced.
    const silent: string[] = []
    let castable = 0
    let attackable = 0
    for (const s of samples()) {
      if (s.offers.has('cast')) {
        castable++
        if (!s.says.has('cast')) silent.push(`${s.phase}: a cast is legal but "${s.prompt}" does not say so`)
      }
      if (s.offers.has('attack')) {
        attackable++
        if (!s.says.has('attack')) silent.push(`${s.phase}: an attack is legal but "${s.prompt}" does not say so`)
      }
    }
    expect(castable, 'no sampled state could cast, so the cast half proves nothing').toBeGreaterThan(20)
    expect(attackable, 'no sampled state could attack, so the attack half proves nothing').toBeGreaterThan(20)
    expect(silent.length, silent.slice(0, 4).join(' | ')).toBe(0)
  })

  it('never says "attack" during Main Phase 1, because that is not a Main Phase 1 move (G2-A3)', () => {
    // Separate from A1 so it cannot pass merely because the sampled boards had no attackers: an attack is
    // declared in the Attack Phase, which Main Phase 1 reaches by passing.
    let mains = 0
    const wrong: string[] = []
    for (const s of samples()) {
      if (s.phase !== 'main1') continue
      mains++
      if (s.says.has('attack')) wrong.push(`"${s.prompt}"`)
    }
    expect(mains, 'no Main Phase 1 state was sampled').toBeGreaterThan(50)
    expect(wrong.length, `Main Phase 1 prompts naming an attack: ${wrong.slice(0, 2).join(' | ')}`).toBe(0)
  })
})
