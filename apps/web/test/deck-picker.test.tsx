import { act, createElement, type JSX } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { apply, viewFor } from '@fftcg/engine'
import { type DeckPair } from '../src/deck.js'
import { buildChoiceSet } from '../src/game/commands.js'
import type { Clock, SearchTransport, SearchTransportFactory, TransportHandlers } from '../src/game/search/coordinator.js'
import type { WorkerRequestMessage } from '../src/game/search/protocol.js'
import { HUMAN, type Choice, type GameApi } from '../src/game/types.js'
import { createWebGame, useGame } from '../src/game/useGame.js'
import { Board } from '../src/ui/Board.js'

/**
 * Rung V1-C (R1, R2): the deck picker — a toolbar with "Your deck", "AI deck" and "New game".
 *
 * The one property that is easy to get wrong is WHEN a choice applies (C-D1): a select changes what the NEXT game
 * deals, never the game in progress. The selection is the picker's; the active pair is the hook's, moved only by
 * a restart. So these drive the real hook with an injected worker, and count workers, rather than trusting a
 * fixture that could not tell the two pairs apart.
 */

Element.prototype.scrollIntoView = function scrollIntoView() {}

let root: Root | null = null
let host: HTMLDivElement | null = null
afterEach(() => { act(() => { root?.unmount() }); host?.remove(); root = null; host = null })

function mount(el: JSX.Element): void {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  act(() => { root!.render(el) })
}

class NoClock implements Clock {
  now(): number { return 0 }
  after(): () => void { return () => {} }
}
class CountingTransport implements SearchTransport {
  terminations = 0
  readonly sent: WorkerRequestMessage[] = []
  constructor(readonly handlers: TransportHandlers) {}
  post(message: WorkerRequestMessage): void { this.sent.push(message) }
  terminate(): void { this.terminations++ }
}

/** Seed 5 opens on the AI's first-player choice (the seed's call, whatever the decks), so a worker exists at once. */
const SEED = 5

function mountHook(decks: DeckPair): { api: () => GameApi; transports: CountingTransport[] } {
  const transports: CountingTransport[] = []
  const createTransport: SearchTransportFactory = (h) => { const t = new CountingTransport(h); transports.push(t); return t }
  let api: GameApi | null = null
  function Harness(): JSX.Element {
    const game = useGame(SEED, { decks, seams: { clock: new NoClock(), createTransport } })
    api = game
    return createElement(Board, { game })
  }
  mount(createElement(Harness))
  return { api: () => api!, transports }
}

const select = (label: string): HTMLSelectElement => {
  const el = [...document.querySelectorAll('select')].find((s) => s.labels?.[0]?.textContent === label)
  expect(el, `no select labelled "${label}"`).toBeDefined()
  return el!
}
const newGameButton = (): HTMLButtonElement => {
  const btn = [...document.querySelectorAll<HTMLButtonElement>('.picker button')].find((b) => b.textContent?.startsWith('New game'))
  expect(btn, 'no New game button in the picker').toBeDefined()
  return btn!
}
function choose(label: string, value: string): void {
  const el = select(label)
  act(() => {
    el.value = value
    el.dispatchEvent(new Event('change', { bubbles: true }))
  })
}
const click = (el: HTMLElement): void => { act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) }) }

describe('the deck picker (rung V1-C)', () => {
  it('shows two VISIBLY labelled selects holding the active pair, and a New game button naming it', () => {
    mountHook(['vol2', 'vol1'])
    // A visible <label>, not an aria-label: a sighted player needs to know which select is theirs too.
    expect(select('Your deck').value).toBe('vol2')
    expect(select('AI deck').value).toBe('vol1')
    expect([...select('Your deck').options].map((o) => o.textContent)).toEqual(['Vol. 1', 'Vol. 2'])
    expect(newGameButton().textContent).toBe('New game (Vol. 2 vs Vol. 1)')
  })

  it('changing a select neither ends the game nor touches its worker (R2)', () => {
    const h = mountHook(['vol2', 'vol1'])
    const view = h.api().view
    const log = h.api().log
    expect(h.transports, 'the AI never asked for a search, so the worker count proves nothing').toHaveLength(1)
    choose('Your deck', 'vol1')
    choose('AI deck', 'vol2')
    expect(h.api().view, 'a select changed the game in progress').toBe(view)
    expect(h.api().log).toBe(log)
    expect(h.api().decks, 'a select moved the active pair').toEqual(['vol2', 'vol1'])
    expect(h.transports).toHaveLength(1)
    expect(h.transports[0]!.terminations, 'a select terminated the worker').toBe(0)
    // What it DOES change is what the button will start.
    expect(newGameButton().textContent).toBe('New game (Vol. 1 vs Vol. 2)')
  })

  it('New game deals the SELECTED pair, and the picker then shows it as the active one', () => {
    const h = mountHook(['vol2', 'vol1'])
    choose('Your deck', 'vol1')
    choose('AI deck', 'vol1')
    click(newGameButton())
    expect(h.api().decks).toEqual(['vol1', 'vol1'])
    expect(h.api().log.map((l) => l.text)).toEqual(['New game — you play Starter Vol. 1, the AI plays Starter Vol. 1'])
    expect(h.transports[0]!.terminations, 'the old game\'s worker survived the new game').toBe(1)
    expect(select('Your deck').value).toBe('vol1')
    expect(select('AI deck').value).toBe('vol1')
  })

  it('"Play again" also starts the selected pair (R1)', () => {
    // A finished game: the human concedes at once. The fixture carries `decks`, so the picker renders beside it.
    const over = apply(createWebGame(1, ['vol2', 'vol1']), { type: 'concede', player: HUMAN }).state
    const v = viewFor(over, HUMAN)
    const restarts: (DeckPair | undefined)[] = []
    const api: GameApi = {
      view: v, choices: buildChoiceSet(v, []), log: [], aiThinking: false,
      choose: (_c: Choice) => {}, restart: (d?: DeckPair) => { restarts.push(d) }, decks: ['vol2', 'vol1'],
    }
    mount(createElement(Board, { game: api }))
    choose('AI deck', 'vol2')
    const again = [...document.querySelectorAll<HTMLButtonElement>('dialog.banner button')].find((b) => b.textContent === 'Play again')
    expect(again, 'no Play again button').toBeDefined()
    click(again!)
    expect(restarts).toEqual([['vol2', 'vol2']])
  })

  it('is absent from a board whose game names no pair — so the hand-built fixtures keep their controls', () => {
    const v = viewFor(createWebGame(1, ['vol2', 'vol2']), HUMAN)
    mount(createElement(Board, { game: { view: v, choices: buildChoiceSet(v, []), log: [], aiThinking: false, choose: () => {}, restart: () => {} } }))
    expect(document.querySelector('.picker')).toBeNull()
  })
})
