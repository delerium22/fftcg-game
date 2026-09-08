import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { legalCommands, viewFor, type Ability, type CardDef, type CardId, type GameState, type StaticEffect } from '@fftcg/engine'
import { Board } from '../src/ui/Board.js'
import { buildChoiceSet, fieldCardDisplay, paymentAlternatives, preferredChoices } from '../src/game/commands.js'
import { HUMAN, type Choice, type GameApi } from '../src/game/types.js'
import { VANILLA_POOL, makeDef, makeGame, withField } from '../../../packages/engine/test/helpers.js'

/**
 * Rung J6-A7 — the board shows the power, keywords and flags the ENGINE uses, layer included, and the sheet
 * says when that differs from the printing.
 */

Element.prototype.scrollIntoView = function scrollIntoView() {}
let root: Root | null = null
let host: HTMLDivElement | null = null
afterEach(() => { act(() => { root?.unmount() }); host?.remove(); root = null; host = null })

const stat = (id: string, effect: StaticEffect): Ability => ({ id, trigger: { kind: 'static', effect }, text: id, effects: [] })
const BANNER: CardDef = makeDef({ code: 'T-BANNER', type: 'backup', power: null, cost: 1, hasAbilities: true, abilityClauses: 1,
  abilities: [stat('T-BANNER:pump', { kind: 'modifyPower', amount: 1000, to: { controller: 'self', filter: { type: 'forward' } } })] })
const HERALD: CardDef = makeDef({ code: 'T-HERALD', cost: 2, power: 3000, hasAbilities: true, abilityClauses: 1,
  abilities: [stat('T-HERALD:haste', { kind: 'grantKeyword', keyword: 'haste', to: { controller: 'self', excludeSource: true, filter: { type: 'forward' } } })] })

function mount(s: GameState): void {
  const view = viewFor(s, HUMAN)
  const legal = legalCommands(s, HUMAN)
  const choices = buildChoiceSet(view, preferredChoices(view, legal), paymentAlternatives(legal))
  const api: GameApi = { view, choices, log: [], aiThinking: false, choose: (_c: Choice) => {}, restart: () => {} }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root!.render(createElement(Board, { game: api })) })
}
const cardButton = (id: CardId): HTMLButtonElement | null => document.querySelector<HTMLButtonElement>(`[data-card-id="${id}"] button`)

describe('J6-A7 — the board and the sheet read through the layer', () => {
  it('a Forward under a +1000 field static shows 6000, with the +1000 badge, and the sheet says "6000 (printed 5000)"', () => {
    let s = makeGame({ defs: [...VANILLA_POOL, BANNER, HERALD] })
    const [withF, f] = withField(s, 0, 'forwards', 'V-F2')      // printed 5000
    s = withF
    ;[s] = withField(s, 0, 'backups', 'T-BANNER')
    ;[s] = withField(s, 0, 'forwards', 'T-HERALD')     // grants Haste to the OTHER Forward
    const v = viewFor(s, HUMAN)
    const shown = fieldCardDisplay(v, s.players[0].forwards.find((c) => c.id === f)!)
    expect(shown).toMatchObject({ power: 6000, powerBonus: 1000, granted: ['haste'], flags: [] })
    mount(s)
    const button = cardButton(f)
    expect(button, 'the Forward is not rendered as a button').not.toBeNull()
    expect(button!.getAttribute('aria-label') ?? button!.textContent).toMatch(/6000/)
    act(() => { button!.click() })
    const sheet = document.querySelector('dialog[data-card-sheet]')
    expect(sheet).not.toBeNull()
    expect(sheet!.querySelector('.sheet__meta')?.textContent).toContain('6000 (printed 5000)')
  })
})
