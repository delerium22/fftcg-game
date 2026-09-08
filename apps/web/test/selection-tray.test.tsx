import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { isLegal, legalCommands, viewFor, type CardId, type GameState, type PlayerView } from '@fftcg/engine'
import { Board } from '../src/ui/Board.js'
import { buildChoiceSet, paymentAlternatives, preferredChoices } from '../src/game/commands.js'
import { HUMAN, type Choice, type ChoiceSet, type GameApi } from '../src/game/types.js'
import { VANILLA_POOL, endPhase, makeGame, withField } from '../../../packages/engine/test/helpers.js'

/**
 * Rung J7-A3/A6 — a party is built by pressing Forwards and Confirm; a Forward of another element is not
 * offered while the party has one; Cancel restores the strip; the sheet of a Forward that can attack alone
 * or in a party shows "Attack with <it>" and "Attack with several…", not one button per party.
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
const cardButton = (id: CardId): HTMLButtonElement | null => document.querySelector<HTMLButtonElement>(`[data-card-id="${id}"] button`)
const sheet = (): HTMLDialogElement | null => document.querySelector<HTMLDialogElement>('dialog[data-card-sheet]')
const sheetButtons = (): HTMLButtonElement[] => [...(sheet()?.querySelectorAll<HTMLButtonElement>('.sheet__actions button') ?? [])]
const press = (el: Element | null): void => { act(() => { (el as HTMLElement).click() }) }
const tray = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-selection-tray]')
const command = (name: string): HTMLButtonElement | null => document.querySelector<HTMLButtonElement>(`[data-command="${name}"]`)

/** Turn 1's declaration step with three earth Forwards and one lightning Forward of the human's. */
function board(): { s: GameState; earth: CardId[]; lightning: CardId } {
  let s = endPhase(makeGame({ defs: VANILLA_POOL })); const earth: CardId[] = []
  for (const code of ['V-F1', 'V-F2', 'V-F5']) { let id: CardId; [s, id] = withField(s, 0, 'forwards', code); earth.push(id) }
  const [withL, lightning] = withField(s, 0, 'forwards', 'V-F3')
  return { s: withL, earth, lightning }
}

describe('J7-A6 — the sheet collapses the parties into one action', () => {
  it('shows "Attack with <card>" and "Attack with several…", not one button per party', () => {
    const { s, earth } = board()
    const { choices } = mount(s)
    expect((choices.byCard.get(earth[0]!) ?? []).length, 'the list still carries several parties for this card').toBeGreaterThan(2)
    press(cardButton(earth[0]!))
    const labels = sheetButtons().map((b) => b.textContent?.trim())
    expect(labels.filter((l) => l?.startsWith('Attack with')), labels.join(' | ')).toHaveLength(2)
    expect(labels).toContain('Attack with several…')
    expect(sheet()!.querySelector('[data-sheet-action="select"]')).not.toBeNull()
  })
})

describe('J7-A3 — a party built by pressing', () => {
  it('two presses and Confirm submit the party the list would have offered; the off-element Forward is not offered; Cancel restores the strip', () => {
    const { s, earth, lightning } = board()
    const { chosen } = mount(s)
    press(cardButton(earth[0]!))
    press(sheet()!.querySelector('[data-sheet-action="select"]'))
    expect(sheet(), 'the sheet closes when the picker starts').toBeNull()
    expect(tray(), 'the tray is up').not.toBeNull()
    expect(document.querySelector('.prompt__text')?.textContent).toMatch(/Attack with: .* — 1 chosen/)
    expect(cardButton(earth[0]!)!.getAttribute('aria-label')).toMatch(/chosen for this move/)
    expect(cardButton(lightning)!.getAttribute('aria-label'), 'a lightning Forward is not offered to an earth party').not.toMatch(/Press to add/)
    expect(cardButton(earth[1]!)!.getAttribute('aria-label')).toMatch(/Press to add/)
    press(cardButton(earth[1]!))
    expect(document.querySelector('.prompt__text')?.textContent).toMatch(/2 chosen/)
    expect(command('selectConfirm')!.disabled).toBe(false)
    press(command('selectConfirm'))
    expect(chosen).toHaveLength(1)
    const cmd = chosen[0]!.command
    expect(cmd).toEqual({ type: 'declareAttack', player: HUMAN, attackers: [earth[0], earth[1]] })
    expect(isLegal(s, cmd)).toBeNull()
    expect(legalCommands(s, HUMAN)).toContainEqual(cmd)
  })

  it('Cancel drops the picker and the strip is back', () => {
    const { s, earth } = board()
    mount(s)
    press(cardButton(earth[0]!))
    press(sheet()!.querySelector('[data-sheet-action="select"]'))
    expect(tray()).not.toBeNull()
    press(command('selectCancel'))
    expect(tray()).toBeNull()
    expect(document.querySelector('.prompt__text')?.textContent).toMatch(/Attack Phase/)
  })
})

describe('J7-A4 / A5 — "up to N" targets and a discard of exactly `count`', () => {
  it('"choose up to 2": one press then Confirm submits one target; the strip keeps its "no targets" button', async () => {
    const { makeDef, withHand } = await import('../../../packages/engine/test/helpers.js')
    const { apply } = await import('@fftcg/engine')
    const UP_TO_2 = {
      id: 'T-UP2:etb', trigger: { kind: 'enterField' as const }, text: 'choose up to 2 Forwards, dull them',
      effects: [{ kind: 'chooseTargets' as const, min: 0, max: 2, from: { zone: 'forwards' as const, controller: 'opponent' as const }, then: [{ kind: 'dull' as const }] }],
    }
    let s = makeGame({ defs: [...VANILLA_POOL, makeDef({ code: 'T-UP2', cost: 0, hasAbilities: true, abilityClauses: 1, abilities: [UP_TO_2] })] })
    const theirs: CardId[] = []
    for (let i = 0; i < 3; i++) { let id: CardId; [s, id] = withField(s, 1, 'forwards', 'V-F1'); theirs.push(id) }
    const [withCard, card] = withHand(s, 0, 'T-UP2')
    s = apply(withCard, { type: 'castCharacter', player: 0, card, payment: { dullBackups: [], discards: [] } }).state
    expect(s.pending?.kind).toBe('chooseTargets')
    const { chosen } = mount(s)
    // The singleton is a plain commit on the sheet; "Choose several…" starts the picker.
    press(cardButton(theirs[0]!))
    const labels = sheetButtons().map((b) => b.textContent?.trim())
    expect(labels).toContain('Choose several…')
    press(sheet()!.querySelector('[data-sheet-action="select"]'))
    expect(command('selectConfirm')!.disabled, 'one target is a legal answer to "up to 2"').toBe(false)
    press(command('selectConfirm'))
    expect(chosen[0]!.command).toEqual({ type: 'chooseTargets', player: HUMAN, targets: [theirs[0]] })
  })

  it('discard to hand size with 7 cards: Confirm waits for exactly `count`, and a third is not offered', async () => {
    const { withHand, withHandSize } = await import('../../../packages/engine/test/helpers.js')
    let s = withHandSize(makeGame({ defs: VANILLA_POOL }), 0, 0)
    const hand: CardId[] = []
    for (let i = 0; i < 7; i++) { let id: CardId; [s, id] = withHand(s, 0, 'V-F1'); hand.push(id) }
    s = { ...s, phase: 'end', pending: { kind: 'discardToHandSize', player: 0, count: 2 } }
    const { chosen } = mount(s)
    press(cardButton(hand[0]!))
    expect(sheetButtons().map((b) => b.textContent?.trim())).toContain('Discard several…')
    press(sheet()!.querySelector('[data-sheet-action="select"]'))
    expect(command('selectConfirm')!.disabled, 'one of two is not enough').toBe(true)
    expect(document.querySelector('.prompt__text')?.textContent).toMatch(/1 of 2 chosen/)
    press(cardButton(hand[1]!))
    expect(command('selectConfirm')!.disabled).toBe(false)
    expect(cardButton(hand[2]!)!.getAttribute('aria-label'), 'a third is not offered').not.toMatch(/Press to add/)
    press(command('selectConfirm'))
    expect(chosen[0]!.command).toEqual({ type: 'discardToHandSize', player: HUMAN, cards: [hand[0], hand[1]] })
  })
})

describe('J7 — a card whose only answers are several-member sets', () => {
  it('"choose 2" targets: the sheet offers one enabled "Choose several…" and no whole-set buttons; two presses and Confirm submit', async () => {
    const { makeDef, withHand } = await import('../../../packages/engine/test/helpers.js')
    const { apply } = await import('@fftcg/engine')
    const PICK2 = {
      id: 'T-PICK2:etb', trigger: { kind: 'enterField' as const }, text: 'choose 2 Forwards, dull them',
      effects: [{ kind: 'chooseTargets' as const, min: 2, max: 2, from: { zone: 'forwards' as const, controller: 'opponent' as const }, then: [{ kind: 'dull' as const }] }],
    }
    let s = makeGame({ defs: [...VANILLA_POOL, makeDef({ code: 'T-PICK2', cost: 0, hasAbilities: true, abilityClauses: 1, abilities: [PICK2] })] })
    const theirs: CardId[] = []
    for (let i = 0; i < 3; i++) { let id: CardId; [s, id] = withField(s, 1, 'forwards', 'V-F1'); theirs.push(id) }
    const [withCard, card] = withHand(s, 0, 'T-PICK2')
    s = apply(withCard, { type: 'castCharacter', player: 0, card, payment: { dullBackups: [], discards: [] } }).state
    const { chosen } = mount(s)
    press(cardButton(theirs[0]!))
    const buttons = sheetButtons().filter((b) => b.getAttribute('data-command') !== 'sheetBack')
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(['Choose several…'])
    expect(buttons[0]!.disabled).toBe(false)
    press(buttons[0]!)
    expect(command('selectConfirm')!.disabled).toBe(true)
    press(cardButton(theirs[1]!))
    expect(command('selectConfirm')!.disabled).toBe(false)
    press(command('selectConfirm'))
    expect(chosen[0]!.command).toEqual({ type: 'chooseTargets', player: HUMAN, targets: [theirs[0]!, theirs[1]!].sort((a, b) => a - b) })
  })
})
