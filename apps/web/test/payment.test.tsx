import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  actingPlayer, apply, createGame, legalCommands, viewFor,
  type CardId, type Command, type GameState, type Payment, type PlayerView,
} from '@fftcg/engine'
import { GreedyAgent } from '@fftcg/ai'
import { CARD_DEFS, DECKS } from '../src/deck.js'
import { Board } from '../src/ui/Board.js'
import { buildChoiceSet, paymentAlternatives, preferredChoices } from '../src/game/commands.js'
import { stepAi } from '../src/game/useGame.js'
import { HUMAN, type Choice, type GameApi } from '../src/game/types.js'

/**
 * Rung E11 — you don't get to choose what you pay with.
 *
 * Casting, and paying for an activated ability, spends your other cards as CP. `legalCommands` lists one
 * command per minimal payment and spec B6 collapses them to the one `preferredPayment` scores cheapest, so
 * the player never chose which of their own cards were spent.
 *
 * The first version of this spec claimed the chooser picks BADLY. It does not — it minimises `2 + cardValue`
 * per discard, and the example I called damning scores 18.05 against the alternative's 18.5, so it kept what
 * it scores as cheaper. The defect is the absence of the choice, not the quality of the guess, and these
 * tests assert only that.
 *
 * METHOD for every count quoted below (twelve seeds, first-non-concede human policy, Greedy opponent at the
 * same seed, payment identity = dullBackups sorted plus discards sorted by `card:element`): 390 human
 * decision points, 170 casts and 41 activations with ≥2 distinct payments, most for one action 30.
 */

Element.prototype.scrollIntoView = function scrollIntoView() {}

let root: Root | null = null
let host: HTMLDivElement | null = null
afterEach(() => { act(() => { root?.unmount() }); host?.remove(); root = null; host = null })

const idOf = (p: Payment): string =>
  `${[...p.dullBackups].sort((a, b) => a - b).join(',')}|${p.discards.map((d) => `${d.card}:${d.element}`).sort().join(',')}`

const payable = (c: Command): c is Extract<Command, { payment: Payment }> =>
  c.type === 'castCharacter' || c.type === 'castSummon' || c.type === 'activateAbility'

/** The semantic action a payable command funds — source, ability and targets, but NEVER the payment. */
function actionKey(c: Command): string | null {
  if (c.type === 'castCharacter' || c.type === 'castSummon') return `cast:${c.card}`
  if (c.type === 'activateAbility') return `act:${c.source}:${c.abilityId}:${[...c.targets].join(',')}`
  return null
}

function mount(s: GameState): { view: PlayerView; chosen: Choice[]; rerender: () => void } {
  const chosen: Choice[] = []
  const view = viewFor(s, HUMAN)
  const legal = legalCommands(s, HUMAN)
  const api: GameApi = {
    view,
    choices: buildChoiceSet(view, preferredChoices(view, legal), paymentAlternatives(legal)),
    log: [], aiThinking: false,
    choose: (c: Choice) => { chosen.push(c) },
    restart: () => {},
  }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  const rerender = (): void => { act(() => { root!.render(createElement(Board, { game: api })) }) }
  rerender()
  return { view, chosen, rerender }
}

const stripButtons = (): HTMLButtonElement[] =>
  [...document.querySelectorAll<HTMLButtonElement>('.prompt__actions button')]
const stripLabels = (): string[] => stripButtons().map((b) => b.textContent ?? '')
const byCommand = (name: string): HTMLButtonElement[] =>
  stripButtons().filter((b) => b.getAttribute('data-command') === name)

/** Plays until `stop`, human taking the first non-concede choice — the policy the numbers above were measured under. */
function play(seed: number, stop: (s: GameState) => boolean): GameState | null {
  const greedy = new GreedyAgent({ seed, decks: DECKS, depth: 1 })
  let s: GameState = createGame({ seed, decks: DECKS, defs: CARD_DEFS })
  for (let i = 0; i < 3000 && !s.result; i++) {
    const p = actingPlayer(s)
    if (p === null) return null
    if (stop(s)) return s
    if (p !== HUMAN) { s = stepAi(s, greedy).state; continue }
    const v = viewFor(s, HUMAN)
    const next = buildChoiceSet(v, preferredChoices(v, legalCommands(s, HUMAN))).all
      .find((c) => c.command.type !== 'concede')
    if (!next) return null
    s = apply(s, next.command).state
  }
  return null
}

/** Actions in this state that have more than one distinct payment. */
function multiPayment(s: GameState): Map<string, Command[]> {
  const groups = new Map<string, Command[]>()
  for (const c of legalCommands(s, HUMAN)) {
    const key = actionKey(c)
    if (key === null || !payable(c)) continue
    groups.set(key, [...(groups.get(key) ?? []), c])
  }
  for (const [key, cs] of groups) {
    if (new Set(cs.filter(payable).map((c) => idOf(c.payment))).size < 2) groups.delete(key)
  }
  return groups
}

function reach(kind: 'cast' | 'act'): GameState | null {
  for (let seed = 1; seed <= 20; seed++) {
    const found = play(seed, (s) => actingPlayer(s) === HUMAN
      && [...multiPayment(s).keys()].some((k) => k.startsWith(kind)))
    if (found) return found
  }
  return null
}

let CAST: GameState | null = null
let ACT: GameState | null = null
beforeAll(() => { CAST = reach('cast'); ACT = reach('act') })

describe.each([['a cast', () => CAST, 'cast'], ['an activation', () => ACT, 'act']] as const)(
  '%s with more than one way to pay (E11-A1)', (_name, get, kind) => {
    it('is reachable by playing', () => {
      expect(get(), `never reached ${_name} with two payments, so this block asserts nothing`).not.toBe(null)
      const groups = multiPayment(get()!)
      const mine = [...groups.entries()].filter(([k]) => k.startsWith(kind))
      expect(mine.length, 'the fixture has no multi-payment action of this kind').toBeGreaterThan(0)
      expect(Math.max(...mine.map(([, cs]) => cs.length)), 'only one payment after all').toBeGreaterThan(1)
    })

    it('offers EVERY payment the engine lists, and only those (E11-A1)', () => {
      // The expected set comes from raw `legalCommands`, never from what was rendered — expectations read off
      // the rendering would validate the rendering against itself.
      const s = get()!
      const { view } = mount(s)
      const legal = legalCommands(s, HUMAN)
      const set = buildChoiceSet(view, preferredChoices(view, legal), paymentAlternatives(legal))
      for (const [key, commands] of multiPayment(s)) {
        if (!key.startsWith(kind)) continue
        const choice = set.all.find((c) => actionKey(c.command) === key)
        expect(choice, `no choice at all for ${key}`).not.toBe(undefined)
        const offered = [choice!, ...(choice!.alternatives ?? [])]
          .map((c) => idOf((c.command as Extract<Command, { payment: Payment }>).payment)).sort()
        const expected = [...new Set(commands.filter(payable).map((c) => idOf(c.payment)))].sort()
        expect(offered, `${key}: the payments offered are not the payments the engine lists`).toEqual(expected)
      }
    })
  })

describe('the strip, before anything is asked for (E11-A6)', () => {
  it('shows ONE action per move plus one disclosure — never every payment', () => {
    // Without this, an implementation that simply stops collapsing — every payment as its own button, the
    // one thing this rung must not do — would satisfy every other criterion here.
    const s = CAST!
    const { view } = mount(s)
    const groups = multiPayment(s)
    const [key, commands] = [...groups.entries()].find(([k]) => k.startsWith('cast'))!
    const legal = legalCommands(s, HUMAN)
    const set = buildChoiceSet(view, preferredChoices(view, legal), paymentAlternatives(legal))
    const choice = set.all.find((c) => actionKey(c.command) === key)!
    expect(commands.length, 'this move has only one payment, so the collapse is not being tested')
      .toBeGreaterThan(1)

    const card = choice.card!
    act(() => { document.querySelector<HTMLElement>(`[data-card-id="${card}"] button`)!.click() })
    const labels = stripLabels()
    const forThisMove = labels.filter((l) => l === choice.label)
    expect(forThisMove.length, 'the move appears more than once in the strip').toBe(1)
    for (const alt of choice.alternatives ?? []) {
      expect(labels, 'an alternative payment is in the main strip before being asked for').not.toContain(alt.label)
    }
    // One disclosure PER MOVE, not one in total: the strip can legitimately show two different moves that
    // each hide a payment choice. Asserting a global 1 was my error, and the code was right.
    const shownWithAlternatives = stripButtons()
      .map((b) => set.all.find((c) => c.label === b.textContent))
      .filter((c): c is Choice => c !== undefined && (c.alternatives?.length ?? 0) > 0)
    expect(byCommand('payDifferently').length, 'a move that hides payments has no disclosure, or has two')
      .toBe(new Set(shownWithAlternatives.map((c) => c.label)).size)
    expect(byCommand('payDifferently').length, 'nothing on the strip hides a payment, so this asserts nothing')
      .toBeGreaterThan(0)
  })

  it('names how many other ways there are', () => {
    const s = CAST!
    const { view } = mount(s)
    const legal = legalCommands(s, HUMAN)
    const set = buildChoiceSet(view, preferredChoices(view, legal), paymentAlternatives(legal))
    const choice = set.all.find((c) => (c.alternatives?.length ?? 0) > 0 && c.card !== null)!
    act(() => { document.querySelector<HTMLElement>(`[data-card-id="${choice.card!}"] button`)!.click() })
    const n = choice.alternatives!.length
    expect(byCommand('payDifferently')[0]?.textContent)
      .toBe(`Pay differently (${n} other ${n === 1 ? 'way' : 'ways'})`)
  })
})

describe('choosing a different payment (E11-A3)', () => {
  it('applies the payment the player picked, not the preferred one', () => {
    const s = CAST!
    const { view, chosen } = mount(s)
    const legal = legalCommands(s, HUMAN)
    const set = buildChoiceSet(view, preferredChoices(view, legal), paymentAlternatives(legal))
    const choice = set.all.find((c) => (c.alternatives?.length ?? 0) > 0 && c.card !== null)!
    const wanted = choice.alternatives![0]!

    act(() => { document.querySelector<HTMLElement>(`[data-card-id="${choice.card!}"] button`)!.click() })
    act(() => { byCommand('payDifferently')[0]!.click() })
    const target = stripButtons().find((b) => b.textContent === wanted.label)
    expect(target, 'the chosen alternative is not offered after asking').not.toBe(undefined)
    act(() => { target!.click() })

    expect(chosen.length, 'clicking an alternative submitted nothing').toBe(1)
    const got = chosen[0]!.command as Extract<Command, { payment: Payment }>
    const preferred = choice.command as Extract<Command, { payment: Payment }>
    expect(idOf(got.payment), 'the applied payment is not the one picked')
      .toBe(idOf((wanted.command as Extract<Command, { payment: Payment }>).payment))
    expect(idOf(got.payment), 'the preferred payment was applied instead').not.toBe(idOf(preferred.payment))
    // Same move, different funding — the action itself must not have changed.
    expect(actionKey(got)).toBe(actionKey(preferred))
  })

  it('goes back to the ordinary strip without spending anything', () => {
    const s = CAST!
    const { view, chosen } = mount(s)
    const legal = legalCommands(s, HUMAN)
    const set = buildChoiceSet(view, preferredChoices(view, legal), paymentAlternatives(legal))
    const choice = set.all.find((c) => (c.alternatives?.length ?? 0) > 0 && c.card !== null)!
    act(() => { document.querySelector<HTMLElement>(`[data-card-id="${choice.card!}"] button`)!.click() })
    act(() => { byCommand('payDifferently')[0]!.click() })
    expect(byCommand('payBack').length, 'there is no way back out of the payments').toBe(1)
    act(() => { byCommand('payBack')[0]!.click() })
    expect(chosen.length, 'backing out spent something').toBe(0)
    expect(byCommand('payDifferently').length, 'the ordinary strip did not come back').toBeGreaterThan(0)
    expect(byCommand('payBack').length, 'the payment view is still open').toBe(0)
  })
})

describe('a move with only one way to pay (E11-A2, E11-A4)', () => {
  it('still commits on a single click, with no disclosure', () => {
    // Guarded: the payment must be NON-EMPTY and uniquely legal. A free cast would pass this while proving
    // nothing, since there is nothing to choose between either way.
    const found = (() => {
      for (let seed = 1; seed <= 20; seed++) {
        const s = play(seed, (st) => {
          if (actingPlayer(st) !== HUMAN) return false
          const groups = new Map<string, Command[]>()
          for (const c of legalCommands(st, HUMAN)) {
            const key = actionKey(c)
            if (key === null || !payable(c)) continue
            groups.set(key, [...(groups.get(key) ?? []), c])
          }
          return [...groups.values()].some((cs) => cs.length === 1
            && payable(cs[0]!) && (cs[0]!.payment.discards.length + cs[0]!.payment.dullBackups.length) > 0)
        })
        if (s) return s
      }
      return null
    })()
    expect(found, 'never reached a uniquely-paid, non-free move').not.toBe(null)

    const { view, chosen } = mount(found!)
    const legal = legalCommands(found!, HUMAN)
    const set = buildChoiceSet(view, preferredChoices(view, legal), paymentAlternatives(legal))
    const sole = set.all.find((c) => c.card !== null && payable(c.command)
      && (c.alternatives?.length ?? 0) === 0
      && (c.command.payment.discards.length + c.command.payment.dullBackups.length) > 0
      && (set.byCard.get(c.card) ?? []).length === 1)
    expect(sole, 'the fixture has no uniquely-paid move that is the card\'s only choice').not.toBe(undefined)

    act(() => { document.querySelector<HTMLElement>(`[data-card-id="${sole!.card!}"] button`)!.click() })
    expect(chosen.length, 'a uniquely-paid move no longer commits on one click').toBe(1)
    expect(chosen[0]!.command).toEqual(sole!.command)
    expect(byCommand('payDifferently').length, 'a move with one payment offered a disclosure').toBe(0)
  })
})

describe('the payment view does not outlive its position', () => {
  it('is dropped when the choices change', () => {
    // The same hazard as the stale selection the board already guards: buttons offering payments for a move
    // that may no longer be legal. These ones spend cards.
    const s = CAST!
    const { view } = mount(s)
    const legal = legalCommands(s, HUMAN)
    const set = buildChoiceSet(view, preferredChoices(view, legal), paymentAlternatives(legal))
    const choice = set.all.find((c) => (c.alternatives?.length ?? 0) > 0 && c.card !== null)!
    act(() => { document.querySelector<HTMLElement>(`[data-card-id="${choice.card!}"] button`)!.click() })
    act(() => { byCommand('payDifferently')[0]!.click() })
    expect(byCommand('payBack').length, 'the payments never opened').toBe(1)

    // A new position: same board, a freshly built ChoiceSet, as `useGame` produces on every state change.
    const next: GameApi = {
      view,
      choices: buildChoiceSet(view, preferredChoices(view, legal), paymentAlternatives(legal)),
      log: [], aiThinking: false, choose: () => {}, restart: () => {},
    }
    act(() => { root!.render(createElement(Board, { game: next })) })
    expect(byCommand('payBack').length, 'the payment view survived a change of position').toBe(0)
  })
})

/**
 * The interaction contract itself, and the test I did not have.
 *
 * Mutation 22 — restoring `forCard.length === 1` so a card commits on click regardless of hidden payments —
 * SURVIVED every test above. All of them happened to click cards with several choices in `byCard` (a cast and
 * an activation, say), which select for the old reason. None exercised the case the rung is about: a card
 * whose ONLY choice is a cast that hides several ways to pay. That card used to spend whichever cards
 * `preferredPayment` scored cheapest the instant you touched it.
 */
describe('a card whose ONE choice hides a payment choice (E11-A4)', () => {
  /** A position with a card offering exactly one choice, and that choice having alternatives. */
  function reachSoleMultiPayment(): { state: GameState; card: CardId } | null {
    const hitIn = (s: GameState): [CardId, Choice[]] | undefined => {
      const v = viewFor(s, HUMAN)
      const legal = legalCommands(s, HUMAN)
      const set = buildChoiceSet(v, preferredChoices(v, legal), paymentAlternatives(legal))
      return [...set.byCard.entries()].find(([, list]) =>
        list.length === 1 && (list[0]?.alternatives?.length ?? 0) > 0)
    }
    for (let seed = 1; seed <= 20; seed++) {
      const state = play(seed, (s) => actingPlayer(s) === HUMAN && hitIn(s) !== undefined)
      if (!state) continue
      const hit = hitIn(state)
      if (hit) return { state, card: hit[0] }
    }
    return null
  }

  let FIXTURE: { state: GameState; card: CardId } | null = null
  beforeAll(() => { FIXTURE = reachSoleMultiPayment() })

  it('is reachable — a card with one action and several ways to fund it', () => {
    expect(FIXTURE, 'never reached a card whose sole choice hides payments; this block asserts nothing')
      .not.toBe(null)
  })

  it('SELECTS rather than spending your cards the moment you touch it', () => {
    const { state, card } = FIXTURE!
    const { chosen } = mount(state)
    act(() => { document.querySelector<HTMLElement>(`[data-card-id="${card}"] button`)!.click() })
    expect(chosen.length, 'the card committed on one click, spending cards the player never chose').toBe(0)
    expect(byCommand('payDifferently').length, 'no way to reach the other payments').toBeGreaterThan(0)
  })

  it('and the preferred payment is still one further click away (E11-A4)', () => {
    // Selecting must not COST the player anything beyond that one click: the default is right there.
    const { state, card } = FIXTURE!
    const { view, chosen } = mount(state)
    const legal = legalCommands(state, HUMAN)
    const set = buildChoiceSet(view, preferredChoices(view, legal), paymentAlternatives(legal))
    const sole = (set.byCard.get(card) ?? [])[0]!
    act(() => { document.querySelector<HTMLElement>(`[data-card-id="${card}"] button`)!.click() })
    const preferred = stripButtons().find((b) => b.textContent === sole.label)
    expect(preferred, 'the preferred action is not on the strip after selecting').not.toBe(undefined)
    act(() => { preferred!.click() })
    expect(chosen.length).toBe(1)
    expect(chosen[0]!.command).toEqual(sole.command)
  })
})
