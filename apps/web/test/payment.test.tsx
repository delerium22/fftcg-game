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
 * Rung E11 — you don't get to choose what you pay with. (Re-drawn by rung I2: the strip's "Pay differently"
 * chooser became the crystal tray; the alternatives still ride on the `Choice`, and are now the tray's list.)
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
  for (let seed = 1; seed <= 60; seed++) {   // 60, not 20: rung J3's deck change moved the first hits past 20
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

describe('the strip never lists payments (E11-A6, kept by rung I2)', () => {
  it('shows no payment and no disclosure on the strip; the tray is the only way to pay', () => {
    // Without this, an implementation that simply stops collapsing — every payment as its own button, the
    // one thing E11 must not do — would satisfy every other criterion here.
    const s = CAST!
    const { view } = mount(s)
    const legal = legalCommands(s, HUMAN)
    const set = buildChoiceSet(view, preferredChoices(view, legal), paymentAlternatives(legal))
    const choice = set.all.find((c) => (c.alternatives?.length ?? 0) > 0 && c.card !== null)!
    for (const c of [choice, ...(choice.alternatives ?? [])]) {
      expect(stripLabels(), 'a payment is on the strip').not.toContain(c.label)
    }
    expect(byCommand('payDifferently').length).toBe(0)
    act(() => { document.querySelector<HTMLElement>(`[data-card-id="${choice.card!}"] button`)!.click() })
    for (const c of [choice, ...(choice.alternatives ?? [])]) {
      expect(stripLabels(), 'pressing the card put a payment on the strip').not.toContain(c.label)
    }
  })
})

/** Open the tray for `choice` through its card's sheet. */
function openTray(choice: Choice): void {
  act(() => { document.querySelector<HTMLElement>(`[data-card-id="${choice.card!}"] button`)!.click() })
  const btn = document.querySelector<HTMLElement>(`dialog[data-card-sheet] [data-command="${choice.command.type}"]`)
  expect(btn, 'the sheet does not offer the move').not.toBe(null)
  act(() => { btn!.click() })
  expect(document.querySelector('[data-payment-tray]'), 'the tray did not open').not.toBe(null)
}
const trayButton = (cmd: string): HTMLButtonElement | null => document.querySelector<HTMLButtonElement>(`[data-payment-tray] [data-command="${cmd}"]`)

describe('choosing a different payment (E11-A3, through the tray)', () => {
  it.each([['a cast', () => CAST], ['an activation', () => ACT]] as const)('%s: applies the payment the player built, not the preferred one', (_name, get) => {
    const s = get()!
    const { view, chosen } = mount(s)
    const legal = legalCommands(s, HUMAN)
    const set = buildChoiceSet(view, preferredChoices(view, legal), paymentAlternatives(legal))
    const choice = set.all.find((c) => (c.alternatives?.length ?? 0) > 0 && c.card !== null)!
    const wanted = choice.alternatives![0]!
    const target = (wanted.command as Extract<Command, { payment: Payment }>).payment

    openTray(choice)
    for (const b of target.dullBackups) act(() => { document.querySelector<HTMLElement>(`[data-card-id="${b}"] button`)!.click() })
    for (const d of target.discards) {
      act(() => { document.querySelector<HTMLElement>(`[data-card-id="${d.card}"] button`)!.click() })
      const ask = [...document.querySelectorAll<HTMLButtonElement>('[data-payment-tray] [data-command="declareElement"]')]
      if (ask.length) act(() => { ask.find((b) => b.textContent?.toLowerCase() === d.element)!.click() })
    }
    expect(trayButton('payConfirm')!.disabled, 'the built payment did not enable Confirm').toBe(false)
    act(() => { trayButton('payConfirm')!.click() })

    expect(chosen.length, 'confirming submitted nothing').toBe(1)
    const got = chosen[0]!.command as Extract<Command, { payment: Payment }>
    const preferred = choice.command as Extract<Command, { payment: Payment }>
    expect(idOf(got.payment), 'the applied payment is not the one built').toBe(idOf(target))
    expect(idOf(got.payment), 'the preferred payment was applied instead').not.toBe(idOf(preferred.payment))
    // Same move, different funding — the action itself must not have changed.
    expect(actionKey(got)).toBe(actionKey(preferred))
  })

  it('Cancel returns to the ordinary strip without spending anything', () => {
    const s = CAST!
    const { view, chosen } = mount(s)
    const legal = legalCommands(s, HUMAN)
    const set = buildChoiceSet(view, preferredChoices(view, legal), paymentAlternatives(legal))
    const choice = set.all.find((c) => (c.alternatives?.length ?? 0) > 0 && c.card !== null)!
    openTray(choice)
    act(() => { trayButton('payCancel')!.click() })
    expect(chosen.length, 'backing out spent something').toBe(0)
    expect(document.querySelector('[data-payment-tray]'), 'the tray is still open').toBe(null)
    expect(stripButtons().length, 'the ordinary strip did not come back').toBeGreaterThan(0)
  })
})

describe('a move with only one way to pay (E11-A2, E11-A4, re-drawn by rung I2)', () => {
  it('goes through the tray like any other, and Auto + Confirm commits it', () => {
    // Before I2 a uniquely-paid move committed on one click. Now NO move spends cards without the tray:
    // one way to pay is still a payment the player should see before it is made. Guarded: the payment must
    // be NON-EMPTY, or a free cast passes this while proving nothing.
    // The stop predicate is the SAME test `sole` runs below: a card whose ONLY choice is a non-free move with
    // exactly one way to pay. (It used to stop at any uniquely-paid move and hope the card had no second choice;
    // rung J3's deck list made the first such state one where it did.)
    const soleIn = (st: GameState): Choice | undefined => {
      const v = viewFor(st, HUMAN)
      const legal = legalCommands(st, HUMAN)
      const set = buildChoiceSet(v, preferredChoices(v, legal), paymentAlternatives(legal))
      return set.all.find((c) => c.card !== null && payable(c.command)
        && (c.alternatives?.length ?? 0) === 0
        && (c.command.payment.discards.length + c.command.payment.dullBackups.length) > 0
        && (set.byCard.get(c.card) ?? []).length === 1)
    }
    const found = (() => {
      for (let seed = 1; seed <= 200; seed++) {
        const s = play(seed, (st) => actingPlayer(st) === HUMAN && soleIn(st) !== undefined)
        if (s) return s
      }
      return null
    })()
    expect(found, 'never reached a uniquely-paid, non-free move').not.toBe(null)

    const { chosen } = mount(found!)
    const sole = soleIn(found!)
    expect(sole, 'the fixture has no uniquely-paid move that is the card\'s only choice').not.toBe(undefined)

    act(() => { document.querySelector<HTMLElement>(`[data-card-id="${sole!.card!}"] button`)!.click() })
    expect(chosen.length, 'a uniquely-paid move committed on one click, without showing its payment').toBe(0)
    openTray(sole!)
    expect(trayButton('payConfirm')!.disabled, 'Confirm was enabled with nothing paid').toBe(true)
    act(() => { trayButton('payAuto')!.click() })
    act(() => { trayButton('payConfirm')!.click() })
    expect(chosen.length).toBe(1)
    expect(chosen[0]!.command).toEqual(sole!.command)
  })
})

/**
 * The interaction contract itself. Mutation 22 in E11 — a card committing on click regardless of hidden
 * payments — survived every test that clicked cards with several choices. This is the case the rung was
 * about: a card whose ONLY choice is a cast that hides several ways to pay.
 */
describe('a card whose ONE choice hides a payment choice (E11-A4)', () => {
  function reachSoleMultiPayment(): { state: GameState; card: CardId } | null {
    const hitIn = (s: GameState): [CardId, Choice[]] | undefined => {
      const v = viewFor(s, HUMAN)
      const legal = legalCommands(s, HUMAN)
      const set = buildChoiceSet(v, preferredChoices(v, legal), paymentAlternatives(legal))
      return [...set.byCard.entries()].find(([, list]) =>
        list.length === 1 && (list[0]?.alternatives?.length ?? 0) > 0)
    }
    for (let seed = 1; seed <= 60; seed++) {   // 60, not 20: rung J3's deck change moved the first hits past 20
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

  it('opens its sheet rather than spending your cards the moment you touch it', () => {
    const { state, card } = FIXTURE!
    const { chosen } = mount(state)
    act(() => { document.querySelector<HTMLElement>(`[data-card-id="${card}"] button`)!.click() })
    expect(chosen.length, 'the card committed on one click, spending cards the player never chose').toBe(0)
    expect(document.querySelector('dialog[data-card-sheet]'), 'no sheet opened').not.toBe(null)
  })

  it('and the preferred payment is Auto + Confirm away (E11-A4)', () => {
    const { state, card } = FIXTURE!
    const { view, chosen } = mount(state)
    const legal = legalCommands(state, HUMAN)
    const set = buildChoiceSet(view, preferredChoices(view, legal), paymentAlternatives(legal))
    const sole = (set.byCard.get(card) ?? [])[0]!
    openTray(sole)
    act(() => { trayButton('payAuto')!.click() })
    act(() => { trayButton('payConfirm')!.click() })
    expect(chosen.length).toBe(1)
    expect(chosen[0]!.command).toEqual(sole.command)
  })
})
