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
import { legalPaymentsOf, requirementFor } from '../src/game/payment.js'
import { stepAi } from '../src/game/useGame.js'
import { HUMAN, type Choice, type ChoiceSet, type GameApi } from '../src/game/types.js'

/**
 * Rung I2 — paying crystal by crystal, in a mounted Board.
 *
 * `payment-model.test.ts` pins the model. These pin the WIRING: that the tray draws the requirement, that a
 * board press on a candidate lights a crystal and marks the card, that Confirm is gated and submits the exact
 * payment built, and that Auto, Clear and Cancel do what they say.
 */

Element.prototype.scrollIntoView = function scrollIntoView() {}

let root: Root | null = null
let host: HTMLDivElement | null = null
afterEach(() => { act(() => { root?.unmount() }); host?.remove(); root = null; host = null })

function mount(s: GameState): { view: PlayerView; choices: ChoiceSet; chosen: Choice[]; rerender: (s: GameState) => void } {
  const build = (st: GameState): GameApi => {
    const view = viewFor(st, HUMAN)
    const legal = legalCommands(st, HUMAN)
    return { view, choices: buildChoiceSet(view, preferredChoices(view, legal), paymentAlternatives(legal)), log: [], aiThinking: false, choose: (c) => { chosen.push(c) }, restart: () => {} }
  }
  const chosen: Choice[] = []
  const api = build(s)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root!.render(createElement(Board, { game: api })) })
  return { view: api.view, choices: api.choices, chosen, rerender: (st) => { act(() => { root!.render(createElement(Board, { game: build(st) })) }) } }
}

const cardButton = (id: CardId): HTMLButtonElement | null => document.querySelector<HTMLButtonElement>(`[data-card-id="${id}"] button`)
const tray = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-payment-tray]')
const trayButton = (cmd: string): HTMLButtonElement => tray()!.querySelector<HTMLButtonElement>(`[data-command="${cmd}"]`)!
const crystalsOnScreen = (): { element: string | null; lit: boolean }[] =>
  [...(tray()?.querySelectorAll<HTMLElement>('.crystal') ?? [])].map((c) => ({
    element: [...c.classList].find((k) => k.startsWith('crystal--') && k !== 'crystal--any')?.replace('crystal--', '') ?? null,
    lit: c.classList.contains('is-lit'),
  }))
const press = (el: Element | null): void => { act(() => { (el as HTMLElement).click() }) }
const sheetButton = (cmd: string): HTMLButtonElement | null => document.querySelector<HTMLButtonElement>(`dialog[data-card-sheet] [data-command="${cmd}"]`)

function play(seed: number, stop: (s: GameState) => boolean, cap = 600): GameState | null {
  const greedy = new GreedyAgent({ seed, decks: DECKS, depth: 1 })
  let s: GameState = createGame({ seed, decks: DECKS, defs: CARD_DEFS })
  for (let i = 0; i < cap && !s.result; i++) {
    const p = actingPlayer(s)
    if (p === null) return null
    if (stop(s)) return s
    if (p !== HUMAN) { s = stepAi(s, greedy).state; continue }
    const v = viewFor(s, HUMAN)
    const next = buildChoiceSet(v, preferredChoices(v, legalCommands(s, HUMAN))).all.find((c) => c.command.type !== 'concede')
    if (!next) return null
    s = apply(s, next.command).state
  }
  return null
}

const payable = (c: Command): c is Extract<Command, { payment: Payment }> => c.type === 'castCharacter' || c.type === 'castSummon' || c.type === 'activateAbility'

/** A Main Phase where some cast has ≥2 payments, at least one of which dulls a backup. */
function reach(pred: (s: GameState) => boolean): GameState {
  for (let seed = 1; seed <= 40; seed++) { const f = play(seed, (s) => actingPlayer(s) === HUMAN && pred(s)); if (f) return f }
  throw new Error('no seed reached the position')
}
const castsWithBackup = (s: GameState): Set<CardId> => {
  const out = new Set<CardId>()
  for (const c of legalCommands(s, HUMAN)) if (c.type !== 'activateAbility' && payable(c) && c.payment.dullBackups.length > 0) out.add(c.card)
  return out
}

let WITH_BACKUP: GameState
let MULTI: GameState
beforeAll(() => {
  WITH_BACKUP = reach((s) => !s.pending && castsWithBackup(s).size > 0)
  MULTI = reach((s) => {
    if (s.pending) return false
    const byCard = new Map<CardId, number>()
    for (const c of legalCommands(s, HUMAN)) if (c.type !== 'activateAbility' && payable(c)) byCard.set(c.card, (byCard.get(c.card) ?? 0) + 1)
    return [...byCard.values()].some((n) => n >= 2)
  })
})

/** Open the tray for the first cast of `id`. */
function openTray(view: PlayerView, choices: ChoiceSet, id: CardId): Choice {
  const cast = choices.byCard.get(id)!.find((c) => c.command.type.startsWith('cast'))!
  press(cardButton(id))
  press(sheetButton(cast.command.type))
  expect(tray(), 'the tray did not open').not.toBeNull()
  return cast
}

describe('I2-A1 — the tray draws the cost', () => {
  it('one crystal per CP, required elements first and tinted, all greyed, Confirm disabled', () => {
    const { view, choices } = mount(WITH_BACKUP)
    const id = [...castsWithBackup(WITH_BACKUP)][0]!
    const cast = openTray(view, choices, id)
    const req = requirementFor(view, cast)!
    const drawn = crystalsOnScreen()
    expect(drawn.length).toBe(req.amount)
    expect(drawn.slice(0, req.requiredElements.length).map((c) => c.element)).toEqual(req.requiredElements)
    expect(drawn.every((c) => !c.lit)).toBe(true)
    expect(trayButton('payConfirm').disabled).toBe(true)
    expect(document.querySelector('.prompt__text')?.textContent).toMatch(new RegExp(`0 of ${req.amount} CP paid`))
  })
})

describe('I2-A2 — a press on a source lights a crystal and marks the card', () => {
  it('a backup lights one, shows dull with a badge, and a second press puts it back', () => {
    const { view, choices } = mount(WITH_BACKUP)
    const id = [...castsWithBackup(WITH_BACKUP)][0]!
    const cast = openTray(view, choices, id)
    const backup = legalPaymentsOf(cast).find((p) => p.dullBackups.length > 0)!.dullBackups[0]!
    const btn = cardButton(backup)!
    expect(btn.getAttribute('aria-label')).toMatch(/Dull for 1 CP$/)
    press(btn)
    expect(crystalsOnScreen().filter((c) => c.lit).length).toBe(1)
    expect(btn.className).toMatch(/is-dull/)
    expect(btn.className).toMatch(/is-paying-dull/)
    expect(btn.getAttribute('aria-label')).toMatch(/will be dulled to pay/)
    press(btn)
    expect(crystalsOnScreen().filter((c) => c.lit).length).toBe(0)
    expect(btn.className).not.toMatch(/is-paying-dull/)
  })

  it('a hand card lights two and is marked for discard', () => {
    const { view, choices } = mount(MULTI)
    const id = [...choices.byCard.keys()].find((k) => view.hand.includes(k) && (choices.byCard.get(k)![0]!.alternatives?.length ?? 0) > 0)!
    const cast = openTray(view, choices, id)
    const discard = legalPaymentsOf(cast).find((p) => p.discards.length > 0)!.discards[0]!
    const btn = cardButton(discard.card)!
    press(btn)
    expect(crystalsOnScreen().filter((c) => c.lit).length).toBe(Math.min(2, crystalsOnScreen().length))
    expect(btn.className).toMatch(/is-paying-discard/)
    expect(btn.getAttribute('aria-label')).toMatch(/will be discarded to pay/)
  })
})

describe('I2-A4 / I2-A5 — Confirm, Auto, Clear, Cancel', () => {
  it('Confirm submits the exact payment built, which is a listed command', () => {
    const { view, choices, chosen } = mount(MULTI)
    const id = [...choices.byCard.keys()].find((k) => view.hand.includes(k) && (choices.byCard.get(k)![0]!.alternatives?.length ?? 0) > 0)!
    const cast = openTray(view, choices, id)
    // Build the LAST listed payment by hand — never the preferred one, so a Confirm that submits the
    // preferred payment regardless is caught.
    const target = legalPaymentsOf(cast).at(-1)!
    for (const b of target.dullBackups) press(cardButton(b))
    for (const d of target.discards) {
      press(cardButton(d.card))
      const ask = tray()!.querySelector<HTMLButtonElement>(`[data-command="declareElement"]`)
      if (ask) press([...tray()!.querySelectorAll<HTMLButtonElement>('[data-command="declareElement"]')].find((b) => b.textContent?.toLowerCase() === d.element)!)
    }
    expect(crystalsOnScreen().every((c) => c.lit)).toBe(true)
    expect(trayButton('payConfirm').disabled).toBe(false)
    press(trayButton('payConfirm'))
    expect(chosen.length).toBe(1)
    const sub = chosen[0]!.command
    expect(payable(sub) && sub.payment).toEqual(target)
    expect(legalCommands(MULTI, HUMAN).some((c) => JSON.stringify(c) === JSON.stringify(sub))).toBe(true)
    expect(tray()).toBeNull()
  })

  it('Auto fills the preferred payment; Clear empties; Cancel leaves nothing spent', () => {
    const { view, choices, chosen } = mount(MULTI)
    const id = [...choices.byCard.keys()].find((k) => view.hand.includes(k) && (choices.byCard.get(k)![0]!.alternatives?.length ?? 0) > 0)!
    openTray(view, choices, id)
    press(trayButton('payAuto'))
    expect(crystalsOnScreen().every((c) => c.lit)).toBe(true)
    expect(trayButton('payConfirm').disabled).toBe(false)
    press(trayButton('payClear'))
    expect(crystalsOnScreen().some((c) => c.lit)).toBe(false)
    press(trayButton('payCancel'))
    expect(tray()).toBeNull()
    expect(chosen).toEqual([])
    expect(document.querySelectorAll('.prompt__actions button').length).toBeGreaterThan(0)
  })

  it('a change of position closes the tray', () => {
    const { view, choices, rerender } = mount(MULTI)
    const id = [...choices.byCard.keys()].find((k) => view.hand.includes(k) && (choices.byCard.get(k)![0]!.alternatives?.length ?? 0) > 0)!
    openTray(view, choices, id)
    const pass = legalCommands(MULTI, HUMAN).find((c) => c.type === 'pass')!
    rerender(apply(MULTI, pass).state)
    expect(tray()).toBeNull()
  })
})

describe('I2-A3 — a source that no listed payment can absorb is not offered', () => {
  it('after the selection is complete, an unrelated source is not actionable', () => {
    const { view, choices } = mount(MULTI)
    const id = [...choices.byCard.keys()].find((k) => view.hand.includes(k) && (choices.byCard.get(k)![0]!.alternatives?.length ?? 0) > 0)!
    const cast = openTray(view, choices, id)
    press(trayButton('payAuto'))
    const used = new Set([...legalPaymentsOf(cast)[0]!.dullBackups, ...legalPaymentsOf(cast)[0]!.discards.map((d) => d.card)])
    for (const h of view.hand) {
      if (h === id || used.has(h)) continue
      const b = cardButton(h)!
      // Not glowing, and a press does not light anything more.
      const before = crystalsOnScreen().filter((c) => c.lit).length
      press(b)
      if (document.querySelector('dialog[data-card-sheet]')) press(sheetButton('sheetBack'))
      expect(crystalsOnScreen().filter((c) => c.lit).length).toBe(before)
      expect(b.className).not.toMatch(/is-paying/)
    }
  })
})
