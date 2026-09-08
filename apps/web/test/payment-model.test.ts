import { describe, expect, it } from 'vitest'
import {
  actingPlayer, apply, canPay, createGame, generateCp, legalCommands, viewFor,
  type Command, type GameState, type Payment,
} from '@fftcg/engine'
import { GreedyAgent } from '@fftcg/ai'
import { CARD_DEFS, DECKS } from '../src/deck.js'
import { buildChoiceSet, paymentAlternatives, preferredChoices, stateShim } from '../src/game/commands.js'
import {
  EMPTY_PAYMENT, candidateSources, completedChoice, crystals, extendable, generatedFor, legalPaymentsOf,
  paidText, requirementFor, withBackup, withDiscard,
} from '../src/game/payment.js'
import { stepAi } from '../src/game/useGame.js'
import { HUMAN, type Choice } from '../src/game/types.js'

/**
 * Rung I2 — the payment picker's model, pure and engine-checked.
 *
 * The browser builds a payment one source at a time. Two things must hold at every step: the picker may only
 * offer a source that still leads to a payment the engine LISTED (so `useGame.choose`'s membership check
 * holds by construction), and the crystals it lights must agree with the engine's own `canPay` about when a
 * cost is met. Both are pinned here as properties over real positions, not on one fixture.
 */

function payableChoices(s: GameState): { view: ReturnType<typeof viewFor>; choices: Choice[] } {
  const view = viewFor(s, HUMAN)
  const legal = legalCommands(s, HUMAN)
  const set = buildChoiceSet(view, preferredChoices(view, legal), paymentAlternatives(legal))
  const payable = set.all.filter((c) => c.command.type === 'castCharacter' || c.command.type === 'castSummon' || c.command.type === 'activateAbility')
  return { view, choices: payable }
}

/** Every human decision over `seeds`, greedy driving both seats' progress and the human taking the first non-concede choice. */
function* humanPositions(seeds: number[], cap = 400): Generator<GameState> {
  for (const seed of seeds) {
    const greedy = new GreedyAgent({ seed, decks: DECKS, depth: 1 })
    let s: GameState = createGame({ seed, decks: DECKS, defs: CARD_DEFS })
    for (let i = 0; i < cap && !s.result; i++) {
      const p = actingPlayer(s)
      if (p === null) break
      if (p !== HUMAN) { s = stepAi(s, greedy).state; continue }
      yield s
      const v = viewFor(s, HUMAN)
      const next = buildChoiceSet(v, preferredChoices(v, legalCommands(s, HUMAN))).all.find((c) => c.command.type !== 'concede')
      if (!next) break
      s = apply(s, next.command).state
    }
  }
}

const sourcesOf = (p: Payment): string[] => [...p.dullBackups.map((b) => `b${b}`), ...p.discards.map((d) => `d${d.card}:${d.element}`)]

describe('the legal list is the choice plus its alternatives', () => {
  it('lists the preferred payment first and every alternative after it', () => {
    for (const s of humanPositions([1, 2, 3])) {
      for (const c of payableChoices(s).choices) {
        const legal = legalPaymentsOf(c)
        expect(legal[0]).toBe((c.command as Extract<Command, { payment: Payment }>).payment)
        expect(legal.length).toBe(1 + (c.alternatives?.length ?? 0))
      }
    }
  })
})

describe('I2-A3 / I2-A6 — a source is offered only while it still leads to a listed payment', () => {
  it('every reachable selection is a subset of a listed payment, and completes exactly when it equals one', () => {
    let checked = 0
    for (const s of humanPositions([1, 2, 3, 4, 5, 6])) {
      const { view, choices } = payableChoices(s)
      for (const c of choices) {
        const req = requirementFor(view, c)
        if (req === null || req.amount === 0) continue
        const legal = legalPaymentsOf(c)
        const cands = candidateSources(legal)
        // Walk every selection the picker can reach by adding one offered source at a time.
        const seen = new Set<string>()
        const frontier: Payment[] = [EMPTY_PAYMENT]
        while (frontier.length) {
          const sel = frontier.pop() as Payment
          const key = sourcesOf(sel).sort().join('|')
          if (seen.has(key)) continue
          seen.add(key)
          checked++
          // (1) the selection is inside some listed payment
          expect(legal.some((p) => sourcesOf(sel).every((src) => sourcesOf(p).includes(src)))).toBe(true)
          // (2) completion ⇔ membership ⇔ every crystal lit ⇔ engine canPay
          const done = completedChoice(c, sel)
          const member = legal.some((p) => sourcesOf(p).sort().join('|') === key)
          expect(done !== null).toBe(member)
          const cp = generatedFor(view, sel, req)
          const lit = crystals(req, cp)
          const allLit = lit.every((x) => x.lit)
          expect(allLit).toBe(canPay(req.amount, req.requiredElements, cp))
          if (member) expect(allLit).toBe(true)
          // (3) extend by every offered source
          for (const b of cands.backups) {
            if (sel.dullBackups.includes(b)) continue
            if (extendable(legal, sel, { backup: b })) frontier.push(withBackup(sel, b, true))
          }
          for (const [card, elements] of cands.discards) {
            if (sel.discards.some((d) => d.card === card)) continue
            for (const e of elements) if (extendable(legal, sel, { discard: card, element: e })) frontier.push(withDiscard(sel, card, e))
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(200)
  }, 60_000)

  it('the earth-backup-then-lightning-discard case: after the discard pays it all, the backup is not offered', () => {
    // A hand-built fixture: cost 2, one lightning required; sources: an earth backup and a lightning card in hand.
    // Minimal payments: {L discard}, {L backup + any backup} — never {earth backup + L discard}.
    const legal: Payment[] = [
      { dullBackups: [], discards: [{ card: 7, element: 'lightning' }] },
      { dullBackups: [3, 4], discards: [] },
    ]
    const afterDiscard = withDiscard(EMPTY_PAYMENT, 7, 'lightning')
    expect(extendable(legal, afterDiscard, { backup: 3 })).toBe(false)
    expect(extendable(legal, EMPTY_PAYMENT, { backup: 3 })).toBe(true)
    expect(extendable(legal, withBackup(EMPTY_PAYMENT, 3, true), { discard: 7, element: 'lightning' })).toBe(false)
  })
})

describe('I2-A1 / I2-A2 — crystals are the cost, element first, lit by matching', () => {
  it('draws one crystal per CP, the required elements first, all greyed with nothing paid', () => {
    const req = { amount: 3, requiredElements: ['lightning' as const], excluded: [] }
    expect(crystals(req, [])).toEqual([
      { element: 'lightning', lit: false }, { element: null, lit: false }, { element: null, lit: false },
    ])
    expect(paidText(crystals(req, []))).toBe('0 of 3 CP paid')
  })
  it('an off-element CP lights a generic crystal, never the required one', () => {
    const req = { amount: 2, requiredElements: ['lightning' as const], excluded: [] }
    const lit = crystals(req, [{ elements: ['earth'], source: 1 }])
    expect(lit).toEqual([{ element: 'lightning', lit: false }, { element: null, lit: true }])
    expect(paidText(lit)).toBe('1 of 2 CP paid')
  })
  it('a flexible source takes the required crystal when a fixed one cannot (the C6 backtracking case)', () => {
    const req = { amount: 2, requiredElements: ['lightning' as const, 'earth' as const], excluded: [] }
    // Moogle (earth OR lightning) plus a pure-earth backup: Moogle must be the lightning one.
    const lit = crystals(req, [{ elements: ['earth', 'lightning'], source: 1 }, { elements: ['earth'], source: 2 }])
    expect(lit.every((x) => x.lit)).toBe(true)
  })
  it('a discard is two CP of one element', () => {
    const req = { amount: 3, requiredElements: ['earth' as const], excluded: [] }
    const cp = [{ elements: ['earth' as const], source: 9 }, { elements: ['earth' as const], source: 9 }]
    expect(crystals(req, cp).filter((x) => x.lit).length).toBe(2)
  })
})

describe('generatedFor validates through the engine', () => {
  it('produces the engine’s own GeneratedCp for a real position', () => {
    for (const s of humanPositions([1])) {
      const { view, choices } = payableChoices(s)
      for (const c of choices) {
        const req = requirementFor(view, c)
        if (!req) continue
        const p = legalPaymentsOf(c)[0] as Payment
        expect(generatedFor(view, p, req)).toEqual(generateCp(stateShim(view), HUMAN, p, req.excluded))
      }
      break
    }
  })
})
