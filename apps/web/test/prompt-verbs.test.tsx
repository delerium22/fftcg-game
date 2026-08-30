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

/**
 * Which verbs the position actually offers, read off the commands themselves.
 *
 * `ability` is here because the prompt can now say "use an ability", and the first version of this oracle did
 * not model `activateAbility` at all — so the branch G2 added was the one branch this test could not see. A
 * code review caught that; it is the same shape as testing the parts and not the composition.
 */
function offered(legal: readonly Command[]): Set<string> {
  const out = new Set<string>()
  for (const c of legal) {
    if (isCast(c)) out.add('cast')
    else if (c.type === 'declareAttack') out.add('attack')
    else if (c.type === 'declareBlock') out.add('block')
    else if (c.type === 'activateAbility') out.add('ability')
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
  // Inflections included, because the vocabulary is the oracle: a prompt reworded to "casting" or "blockers"
  // would otherwise stop being seen as a claim at all, and this test would go quiet rather than fail.
  if (/\bcast(s|ing)?\b/.test(said)) out.add('cast')
  if (/\battack(s|ing)?\b/.test(said)) out.add('attack')
  if (/\bblock(s|er|ers|ing)?\b/.test(said)) out.add('block')
  if (/\bability\b|\babilities\b/.test(said)) out.add('ability')
  return out
}

/**
 * A prompt that NEGATES a verb is not offering it, and this oracle is lexical. Nothing in the current wording
 * negates — the no-offer clauses were deliberately written to avoid restating the verb — so this asserts that
 * assumption rather than silently depending on it. If a future wording says "you cannot cast", this fires and
 * the oracle has to become smarter before the wording ships.
 */
const NEGATIONS = /\b(cannot|can't|no longer|not able|nothing to)\b/

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
    // POSITIONS as well as verb-instances. A prompt overclaiming both "cast" and "attack" increments the maps
    // twice, so their total is not a count of prompts — and the commit that landed this reported it as one.
    let badPositions = 0
    let seen = 0
    const negated: string[] = []
    for (const s of samples()) {
      seen++
      if (NEGATIONS.test(s.prompt.toLowerCase())) negated.push(s.prompt)
      let bad = false
      for (const verb of s.says) {
        if (s.offers.has(verb)) continue
        bad = true
        byPhase.set(s.phase, (byPhase.get(s.phase) ?? 0) + 1)
        byVerb.set(verb, (byVerb.get(verb) ?? 0) + 1)
        if (overclaims.length < 4) overclaims.push(`${s.phase}: "${s.prompt}" claims "${verb}" with none legal`)
      }
      if (bad) badPositions++
    }
    expect(seen, 'no state was sampled, so this asserts nothing').toBeGreaterThan(200)
    expect(badPositions, 'a sampled position still carries a prompt naming a move it does not offer').toBe(0)
    expect(negated, 'a prompt negates a verb, which this lexical oracle would read as an offer').toEqual([])
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
    //
    // All four verbs, not just cast and attack. Checking only two left the ability branch — the one G2 added —
    // free to say nothing at all in an activate-only position, which is exactly where a player most needs to
    // be told there is something to do.
    const silent: string[] = []
    const reached: Record<string, number> = { cast: 0, attack: 0, block: 0, ability: 0 }
    for (const s of samples()) {
      for (const verb of ['cast', 'attack', 'block', 'ability']) {
        if (!s.offers.has(verb)) continue
        reached[verb] = (reached[verb] ?? 0) + 1
        if (!s.says.has(verb)) silent.push(`${s.phase}: ${verb} is legal but "${s.prompt}" does not say so`)
      }
    }
    // Each half must actually be exercised, or "both directions" is a word rather than a test. `block` and
    // `ability` are rarer than the other two, hence the lower floors — but not zero.
    expect(reached.cast, 'no sampled state could cast').toBeGreaterThan(20)
    expect(reached.attack, 'no sampled state could attack').toBeGreaterThan(20)
    expect(reached.block, 'no sampled state could block').toBeGreaterThan(0)
    expect(reached.ability, 'no sampled state could use an ability').toBeGreaterThan(0)
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
