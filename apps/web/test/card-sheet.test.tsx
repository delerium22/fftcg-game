import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  actingPlayer, apply, createGame, legalCommands, viewFor,
  type CardId, type GameState, type PlayerView,
} from '@fftcg/engine'
import { GreedyAgent } from '@fftcg/ai'
import { CARD_DEFS, DECKS } from '../src/deck.js'
import { Board } from '../src/ui/Board.js'
import { buildChoiceSet, headline, paymentAlternatives, preferredChoices } from '../src/game/commands.js'
import { endPhase, makeGame, withHand, withHandSize } from '../../../packages/engine/test/helpers.js'
import { stepAi } from '../src/game/useGame.js'
import { HUMAN, type Choice, type ChoiceSet, type GameApi } from '../src/game/types.js'

/**
 * Rung I1 — the card sheet.
 *
 * A press on ANY card opens its sheet; nothing commits from the board. The sheet lists the card's choices as
 * buttons — a payable one headlined without its payment, because pressing it opens the tray — and a hand card
 * that cannot be cast shows Cast disabled with the engine's reason. These tests drive a real `Board` at real
 * positions reached by play, so the choice set is the one `legalCommands` produces.
 */

Element.prototype.scrollIntoView = function scrollIntoView() {}

let root: Root | null = null
let host: HTMLDivElement | null = null
afterEach(() => { act(() => { root?.unmount() }); host?.remove(); root = null; host = null })

function mount(s: GameState): { view: PlayerView; choices: ChoiceSet; chosen: Choice[] } {
  const view = viewFor(s, HUMAN)
  const legal = legalCommands(s, HUMAN)
  const choices = buildChoiceSet(view, preferredChoices(view, legal), paymentAlternatives(legal))
  const chosen: Choice[] = []
  const api: GameApi = { view, choices, log: [], aiThinking: false, choose: (c) => { chosen.push(c) }, restart: () => {} }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root!.render(createElement(Board, { game: api })) })
  return { view, choices, chosen }
}

const cardButton = (id: CardId): HTMLButtonElement | null =>
  document.querySelector<HTMLButtonElement>(`[data-card-id="${id}"] button`)
const sheet = (): HTMLDialogElement | null => document.querySelector<HTMLDialogElement>('dialog[data-card-sheet]')
const sheetButtons = (): HTMLButtonElement[] => [...(sheet()?.querySelectorAll<HTMLButtonElement>('.sheet__actions button') ?? [])]
const press = (el: Element | null): void => { act(() => { (el as HTMLElement).click() }) }

/** Plays until `stop`, the human taking the first non-concede choice. */
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

const atHuman = (s: GameState): boolean => actingPlayer(s) === HUMAN
const reach = (pred: (s: GameState) => boolean): GameState => {
  for (let seed = 1; seed <= 30; seed++) { const f = play(seed, (s) => atHuman(s) && pred(s)); if (f) return f }
  throw new Error('no seed reached the position')
}

let MULLIGAN: GameState
let MAIN: GameState
let BLOCK: GameState
beforeAll(() => {
  MULLIGAN = reach((s) => s.pending?.kind === 'mulligan')
  // A Main Phase where at least one hand card is castable AND at least one is not (so both Cast forms show).
  MAIN = reach((s) => {
    if (s.pending || (s.phase !== 'main1' && s.phase !== 'main2')) return false
    const legal = legalCommands(s, HUMAN)
    const castable = new Set(legal.flatMap((c) => (c.type === 'castCharacter' || c.type === 'castSummon' ? [c.card] : [])))
    return castable.size > 0 && s.players[HUMAN].hand.some((id) => !castable.has(id))
  })
  BLOCK = reach((s) => s.pending?.kind === 'declareBlock' && legalCommands(s, HUMAN).some((c) => c.type === 'declareBlock' && c.blocker !== null))
})

describe('I1-A1 — every card opens its sheet, and the sheet reads the card', () => {
  it('a mulligan hand card (nothing to do) is a button whose press opens a dialog named after it', () => {
    const { view, chosen } = mount(MULLIGAN)
    const id = view.hand[0] as CardId
    const btn = cardButton(id)
    expect(btn, 'a card with nothing to do is still pressable').not.toBeNull()
    expect(sheet()).toBeNull()
    press(btn)
    const d = sheet()
    expect(d, 'pressing the card opened no sheet').not.toBeNull()
    const def = view.defs[view.cards[id]!.code]!
    const title = d!.querySelector('[data-dialog-title]')
    expect(title?.textContent).toBe(def.name)
    expect(d!.getAttribute('aria-labelledby')).toBe(title?.id)
    expect(d!.getAttribute('aria-modal')).toBe('true')
    if (def.text) expect(d!.querySelector('.sheet__printed')?.textContent).toBe(def.text)
    expect(document.activeElement, 'focus did not land on the heading').toBe(title)
    // A disabled Cast (I1-D4: it says why) and Back: the card can do nothing yet.
    expect(sheetButtons().map((b) => `${b.textContent}${b.disabled ? ' (disabled)' : ''}`)).toEqual([`Cast ${def.name} (disabled)`, 'Back'])
    expect(chosen).toEqual([])
  })

  it('the AI’s field card opens a sheet too, and Back closes it with nothing applied', () => {
    const { view, chosen } = mount(BLOCK)
    const attacker = view.attack?.attackers[0] as CardId
    press(cardButton(attacker))
    expect(sheet()).not.toBeNull()
    press(sheetButtons().find((b) => b.dataset['command'] === 'sheetBack')!)
    expect(sheet()).toBeNull()
    expect(chosen).toEqual([])
  })

  it('Escape (the dialog’s cancel) closes the sheet', () => {
    const { view } = mount(MULLIGAN)
    press(cardButton(view.hand[0] as CardId))
    act(() => { sheet()!.dispatchEvent(new Event('cancel', { bubbles: true, cancelable: true })) })
    expect(sheet()).toBeNull()
  })
})

describe('I1-A2 — Cast on the sheet: enabled headline, or disabled with the reason', () => {
  it('a castable card offers "Cast X" (no payment), and pressing it opens the tray rather than applying', () => {
    const { view, choices, chosen } = mount(MAIN)
    const id = [...choices.byCard.keys()].find((k) => view.hand.includes(k) && choices.byCard.get(k)!.some((c) => c.command.type.startsWith('cast')))!
    const cast = choices.byCard.get(id)!.find((c) => c.command.type.startsWith('cast'))!
    press(cardButton(id))
    const btn = sheetButtons().find((b) => b.dataset['command'] === cast.command.type)!
    expect(btn.textContent).toBe(headline(view, cast))
    expect(btn.textContent).not.toMatch(/paying/)
    expect(btn.disabled).toBe(false)
    press(btn)
    expect(sheet(), 'the sheet stayed open after Cast').toBeNull()
    expect(document.querySelector('[data-payment-tray]'), 'Cast did not open the payment tray').not.toBeNull()
    expect(chosen, 'Cast applied a command before any payment was chosen').toEqual([])
  })

  it('an uncastable hand card shows a disabled Cast that says "Not enough CP"', () => {
    const { view, choices, chosen } = mount(MAIN)
    const id = view.hand.find((h) => !(choices.byCard.get(h) ?? []).some((c) => c.command.type.startsWith('cast')))!
    press(cardButton(id))
    const blocked = sheet()!.querySelector<HTMLButtonElement>('[data-command="castBlocked"]')!
    expect(blocked.disabled).toBe(true)
    const why = document.getElementById(blocked.getAttribute('aria-describedby')!)
    expect(why?.textContent).toBe('Not enough CP')
    press(blocked)
    expect(chosen).toEqual([])
  })

  it('at the mulligan the reason is the phase, not CP', () => {
    const { view } = mount(MULLIGAN)
    const card = view.hand[0] as CardId
    press(cardButton(card))
    const blocked = sheet()!.querySelector<HTMLButtonElement>('[data-command="castBlocked"]')
    expect(blocked, 'a hand card at the mulligan should show a disabled Cast').not.toBeNull()
    // J2 review L2: the wording follows the CARD — a plain Character is Main-Phase-only; a Summon (or a Back
    // Attack Character) is cast in a window, and never says "Main Phase".
    const def = view.defs[view.cards[card]!.code]!
    const windowCard = def.type === 'summon' || (def.keywords ?? []).includes('backAttack')
    expect(document.getElementById(blocked!.getAttribute('aria-describedby')!)?.textContent).toBe(windowCard ? 'Not in this step — cast it in a Main Phase or an Attack Phase window' : 'Only in your Main Phase')
  })

  it('a Back Attack card in the declaration step names the rule (J2-A5)', () => {
    let s = endPhase(makeGame({ decks: DECKS, defs: CARD_DEFS }))
    s = withHandSize(s, HUMAN, 0)
    const [t, scar] = withHand(s, HUMAN, '2-085H')
    s = t
    expect(s.attack?.step).toBe('declaration')
    const { view } = mount(s)
    press(cardButton(scar))
    const blocked = sheet()!.querySelector<HTMLButtonElement>('[data-command="castBlocked"]')
    expect(blocked, 'the declaration step is a decision, not a window (§10.1.2.1)').not.toBeNull()
    expect(document.getElementById(blocked!.getAttribute('aria-describedby')!)?.textContent).toBe('Not in this step — cast it in a Main Phase or an Attack Phase window')
    void view
  })
})

describe('I1-A3 — a non-payable choice commits from the sheet with its full label', () => {
  it('a blocker: the sheet offers "Block with X" and pressing it submits exactly that command', () => {
    const { view, choices, chosen } = mount(BLOCK)
    const id = [...choices.byCard.keys()].find((k) => view.fields[HUMAN].forwards.some((f) => f.id === k))!
    const block = choices.byCard.get(id)!.find((c) => c.command.type === 'declareBlock')!
    press(cardButton(id))
    const btn = sheetButtons().find((b) => b.dataset['command'] === 'declareBlock')!
    expect(btn.textContent).toBe(block.label)
    expect(btn.dataset['sheetAction']).toBe('commit')
    press(btn)
    expect(chosen).toEqual([block])
    expect(sheet()).toBeNull()
  })
})

describe('I1-A4 — no press on the board submits anything', () => {
  it('over six seeded games, pressing every rendered card at every human decision applies nothing', () => {
    let pressed = 0
    for (let seed = 1; seed <= 6; seed++) {
      const greedy = new GreedyAgent({ seed, decks: DECKS, depth: 1 })
      let s: GameState = createGame({ seed, decks: DECKS, defs: CARD_DEFS })
      for (let i = 0; i < 300 && !s.result; i++) {
        const p = actingPlayer(s)
        if (p === null) break
        if (p !== HUMAN) { s = stepAi(s, greedy).state; continue }
        const { chosen } = mount(s)
        for (const cell of document.querySelectorAll<HTMLElement>('[data-card-id] button')) {
          press(cell); pressed++
          expect(chosen, `pressing a card at seed ${seed} step ${i} applied ${chosen[0]?.label}`).toEqual([])
          if (sheet()) press(sheetButtons().find((b) => b.dataset['command'] === 'sheetBack')!)
        }
        act(() => { root?.unmount() }); host?.remove(); root = null; host = null
        const v = viewFor(s, HUMAN)
        const next = buildChoiceSet(v, preferredChoices(v, legalCommands(s, HUMAN))).all.find((c) => c.command.type !== 'concede')
        if (!next) break
        s = apply(s, next.command).state
      }
    }
    expect(pressed).toBeGreaterThan(500)
  }, 60_000)
})

describe('I1-A5 — what a card announces', () => {
  it('a sole choice is announced by its headline, never a payment; several by their count', () => {
    const { view, choices } = mount(MAIN)
    for (const [id, forCard] of choices.byCard) {
      const name = cardButton(id)?.getAttribute('aria-label') ?? ''
      if (forCard.length === 1) expect(name.endsWith(`, ${headline(view, forCard[0]!)}`), `${name}`).toBe(true)
      else expect(name.endsWith(`, ${forCard.length} options`), `${name}`).toBe(true)
      expect(name).not.toMatch(/paying/)
      expect(name).not.toMatch(/ways to pay/)
    }
  })
  it('the strip carries only subjectless choices and no "Pay differently"', () => {
    const { choices } = mount(MAIN)
    const strip = [...document.querySelectorAll<HTMLButtonElement>('.prompt__actions button')]
    expect(strip.some((b) => b.dataset['command'] === 'payDifferently')).toBe(false)
    const loose = new Set<string>(choices.loose.map((c) => c.command.type))
    for (const b of strip) expect(loose.has(b.dataset['command'] ?? '')).toBe(true)
  })
})

describe('J5-A5 — the sheet shows the printed Job and Category under the name', () => {
  it('Geomancer reads "Standard Unit · XI"', () => {
    // The first seed that deals the human a Geomancer; every face-up card is a button from the first render (rung I1).
    let s = createGame({ seed: 1, decks: DECKS, defs: CARD_DEFS })
    let geo: CardId | undefined
    for (let seed = 1; seed < 40 && geo === undefined; seed++) {
      s = createGame({ seed, decks: DECKS, defs: CARD_DEFS })
      // Hands are dealt once the first player is chosen; the sheet is reachable from the mulligan on.
      if (s.pending?.kind === 'chooseFirst') s = apply(s, { type: 'chooseFirst', player: s.pending.player, goFirst: true }).state
      geo = s.players[HUMAN].hand.find((id) => s.cards[id]?.code === '18-064C')
    }
    expect(geo, 'no seed under 40 deals the human a Geomancer').toBeDefined()
    mount(s)
    press(cardButton(geo!))
    expect(sheet()).not.toBeNull()
    expect(sheet()!.querySelector('.sheet__meta--job')?.textContent).toBe('Standard Unit · XI')
  })
})
