import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import {
  actingPlayer, apply, createGame, legalCommands, viewFor,
  type GameState,
} from '@fftcg/engine'
import { GreedyAgent } from '@fftcg/ai'
import { CARD_DEFS, DECKS } from '../src/deck.js'
import { Board } from '../src/ui/Board.js'
import { PromptStrip } from '../src/ui/PromptStrip.js'
import { buildChoiceSet, paymentAlternatives, preferredChoices } from '../src/game/commands.js'
import { HUMAN, type Choice, type ChoiceSet, type GameApi } from '../src/game/types.js'

/**
 * Rung G6 — for one decision in seven, the only button is "Concede".
 *
 * METHOD, so the counts are reproducible (the spec's corpus):
 *   seeds        1..40, `createGame({ seed, decks: DECKS, defs: CARD_DEFS })`
 *   both seats   `GreedyAgent({ seed, decks: DECKS, depth: 1 })` drives the game forward
 *   sampled at   every state where `actingPlayer === HUMAN` — a DECISION, whether or not a card is clickable
 *   choice set   `buildChoiceSet(view, preferredChoices(view, legal), paymentAlternatives(legal))`
 *   on arrival   `choices.loose` with Concede sorted last — what `Board` hands the strip before any click
 *   step cap     600 commands per seed
 *
 * The before-figure is read off the CHOICES, which the fix does not touch, so it holds before and after and
 * proves the corpus visited the hazard. The after-figure is read off the RENDERED strip, which is the thing
 * the player meets. Counting the predicate instead of the buttons is how F6 first under-counted by 108.
 */

Element.prototype.scrollIntoView = function scrollIntoView() {}

interface Decision { readonly state: GameState; readonly choices: ChoiceSet; readonly arrival: Choice[] }

const last = (c: Choice): number => (c.command.type === 'concede' ? 1 : 0)
const isConcede = (c: Choice): boolean => c.command.type === 'concede'

function* decisions(): Generator<Decision> {
  for (let seed = 1; seed <= 40; seed++) {
    const greedy = new GreedyAgent({ seed, decks: DECKS, depth: 1 })
    let s: GameState = createGame({ seed, decks: DECKS, defs: CARD_DEFS })
    for (let i = 0; i < 600 && !s.result; i++) {
      const p = actingPlayer(s)
      if (p === null) break
      if (p === HUMAN) {
        const view = viewFor(s, HUMAN)
        const legal = legalCommands(s, HUMAN)
        const choices = buildChoiceSet(view, preferredChoices(view, legal), paymentAlternatives(legal))
        const arrival = choices.loose.slice().sort((a, b) => last(a) - last(b))
        yield { state: s, choices, arrival }
      }
      s = apply(s, greedy.decide(viewFor(s, p), legalCommands(s, p))).state
    }
  }
}

/** The spec's predicate, on the choices: every answer is on a card and the strip would hold only Concede. */
const concedeWouldBeAlone = (d: Decision): boolean =>
  d.choices.byCard.size > 0 && d.arrival.length > 0 && d.arrival.every(isConcede)

let root: Root | null = null
let host: HTMLDivElement | null = null
function unmount(): void { act(() => { root?.unmount() }); host?.remove(); root = null; host = null }
afterEach(unmount)

/** Renders the strip exactly as `Board` would on arrival and returns the `data-command` of every button. */
function stripButtons(d: Decision): string[] {
  if (!root) { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) }
  const el = createElement(PromptStrip, {
    view: viewFor(d.state, HUMAN), choices: d.choices, shown: d.arrival, aiThinking: false,
    onChoose: () => {},
  })
  act(() => { root!.render(el) })
  return [...document.querySelectorAll<HTMLButtonElement>('.prompt__actions button')]
    .map((b) => b.getAttribute('data-command') ?? '')
}

/** Mounts the whole board at this decision and returns the byCard keys that rendered NO button. */
function unpressable(d: Decision): string[] {
  unmount()
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  const api: GameApi = {
    view: viewFor(d.state, HUMAN), choices: d.choices, log: [], aiThinking: false,
    choose: () => {}, restart: () => {},
  }
  act(() => { root!.render(createElement(Board, { game: api })) })
  const out: string[] = []
  for (const id of d.choices.byCard.keys()) {
    if (!document.querySelector(`[data-card-id="${id}"] button`)) out.push(String(id))
  }
  unmount()
  return out
}

// 40 seeds of greedy play plus a few hundred full-board mounts is well past vitest's 5 s default.
describe('G6 — the strip never offers Concede alone', () => {
  it('renders no button where every answer is on a card (G6-A1), and every other strip intact (G6-A2)', () => {
    let seen = 0
    let hazard = 0          // decisions where the CHOICES would put Concede alone — the before-figure
    let concedeAlone = 0    // decisions where the RENDERED strip's only button is Concede — must be 0
    let withOthers = 0      // decisions with a non-concede loose choice — A2's population
    const silenced: string[] = []
    const kinds = new Map<string, number>()
    for (const d of decisions()) {
      seen++
      const buttons = stripButtons(d)
      if (concedeWouldBeAlone(d)) {
        hazard++
        const kind = d.state.pending?.kind ?? d.state.phase
        kinds.set(kind, (kinds.get(kind) ?? 0) + 1)
      }
      if (buttons.length === 1 && buttons[0] === 'concede') concedeAlone++
      const others = d.arrival.filter((c) => !isConcede(c))
      if (others.length > 0) {
        withOthers++
        // Every non-concede choice is a button, and Concede is still alongside it — as a COUNT, because a fix
        // that hid the strip whenever it felt like it would pass A1 perfectly.
        const missing = others.filter((c) => !buttons.includes(c.command.type))
        if (missing.length > 0 || !buttons.includes('concede')) {
          if (silenced.length < 4) silenced.push(`${d.state.pending?.kind ?? d.state.phase}: [${buttons.join(', ')}] lacks ${missing.map((c) => c.label).join('/') || 'Concede'}`)
          else silenced.push('…')
        }
      }
    }
    // The corpus is the spec's: 2,288 decisions, 345 of them the hazard (15.1 %), at chooseTargets /
    // chooseFromDeck / discardToHandSize. Floors rather than exact pins, so an engine change that moves the
    // count by a few does not read as a G6 regression — but a corpus that never reaches the hazard must fail.
    expect(seen, 'corpus is far smaller than the 2,288 decisions the spec measured').toBeGreaterThan(2000)
    expect(hazard, `the corpus never reached the hazard (kinds: ${JSON.stringify([...kinds])})`).toBeGreaterThan(300)
    expect(withOthers, 'A2 has nothing to assert over').toBeGreaterThan(1500)
    expect(silenced, 'a strip with a real choice on it lost a button (G6-A2)').toEqual([])
    expect(concedeAlone, `${concedeAlone} of ${seen} decisions still render Concede as the only button (G6-A1)`).toBe(0)
  }, 120_000)

  it('leaves the card the prompt points at pressable, at exactly those decisions (G6-A4)', () => {
    let checked = 0
    const stranded: string[] = []
    for (const d of decisions()) {
      if (!concedeWouldBeAlone(d)) continue
      checked++
      const missing = unpressable(d)
      if (missing.length > 0 && stranded.length < 4) {
        stranded.push(`${d.state.pending?.kind ?? d.state.phase}: byCard ${missing.join(',')} rendered no button`)
      }
    }
    expect(checked, 'no hazard decision was examined, so nothing was proved').toBeGreaterThan(300)
    expect(stranded, 'the strip offers nothing AND the card is not pressable — the player is stranded').toEqual([])
  }, 120_000)
})
