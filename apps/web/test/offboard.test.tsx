import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  actingPlayer, createGame, legalCommands, viewFor,
  type CardId, type Command, type GameState, type PlayerView,
} from '@fftcg/engine'
import { GreedyAgent } from '@fftcg/ai'
import { CARD_DEFS, DECKS } from '../src/deck.js'
import { Board } from '../src/ui/Board.js'
import { buildChoiceSet, choiceName, displayName, preferredChoices } from '../src/game/commands.js'
import { stepAi } from '../src/game/useGame.js'
import { HUMAN, type Choice, type GameApi } from '../src/game/types.js'

/**
 * Rung E10 — choices whose subject the board's named zones do not draw.
 *
 * E9 made every offered button read differently. It did not make every button's SUBJECT reachable. The board
 * already has an orphan row for this (`orphanTargetIds`) — my first spec claimed otherwise and a plan review
 * corrected me — but that row passes the raw definition name, so E9's occurrence marker stops at its edge:
 * three Lusos in a Break Zone choice render as three cards all reading "Luso" while their buttons read
 * "Luso (1)".."Luso (3)".
 */

Element.prototype.scrollIntoView = function scrollIntoView() {}

let root: Root | null = null
let host: HTMLDivElement | null = null
afterEach(() => { act(() => { root?.unmount() }); host?.remove(); root = null; host = null })

function render(s: GameState): { view: PlayerView; chosen: Choice[] } {
  const view = viewFor(s, HUMAN)
  const chosen: Choice[] = []
  const api: GameApi = {
    view,
    choices: buildChoiceSet(view, preferredChoices(view, legalCommands(s, HUMAN))),
    log: [], aiThinking: false,
    choose: (c: Choice) => { chosen.push(c) },
    restart: () => {},
  }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root!.render(createElement(Board, { game: api })) })
  return { view, chosen }
}

/** Cards the human may pick that are sitting in their Break Zone. */
function breakZoneCandidates(s: GameState): CardId[] {
  const p = s.pending
  if (p?.kind !== 'chooseTargets' || p.player !== HUMAN) return []
  return p.candidates.filter((id) => s.players[HUMAN].breakZone.includes(id))
}

/**
 * A real Break Zone target choice, reached by playing — the human casts a retriever on sight.
 * Billy Bob, Prishe and Sphene all choose from the Break Zone and are all in this deck.
 */
function reachBreakZoneChoice(): GameState | null {
  const retrievers = ['18-124C', '22-068R', '27-126S']
  for (let seed = 1; seed <= 25; seed++) {
    const greedy = new GreedyAgent({ seed, decks: DECKS, depth: 1 })
    const agent = {
      decide(v: PlayerView, legal: Command[]): Command {
        if (v.me !== HUMAN) return greedy.decide(v, legal)
        return legal.find((c) => c.type === 'castCharacter'
          && retrievers.includes(v.cards[c.card]?.code ?? '')) ?? greedy.decide(v, legal)
      },
    }
    let s: GameState = createGame({ seed, decks: DECKS, defs: CARD_DEFS })
    for (let i = 0; i < 3000 && !s.result; i++) {
      const cands = breakZoneCandidates(s)
      const names = cands.map((id) => s.defs[s.cards[id]?.code ?? '']?.name)
      if (names.some((n, j) => n !== undefined && names.indexOf(n) !== j)) return s
      if (actingPlayer(s) === null) break
      s = stepAi(s, agent).state
    }
  }
  return null
}

let BREAK_ZONE_CHOICE: GameState | null = null
beforeAll(() => { BREAK_ZONE_CHOICE = reachBreakZoneChoice() })

describe('a Break Zone choice (E10-A1)', () => {
  it('is reachable by playing, with two candidates sharing a printed name', () => {
    expect(BREAK_ZONE_CHOICE, 'never reached a Break Zone choice, so everything below asserts nothing')
      .not.toBe(null)
    const s = BREAK_ZONE_CHOICE!
    const cands = breakZoneCandidates(s)
    const names = cands.map((id) => s.defs[s.cards[id]?.code ?? '']?.name)
    const shared = names.filter((n, i) => names.indexOf(n) !== i)
    // The guard the plan review demanded: without a repeated name this test cannot tell a marker from its
    // absence, and would pass on the very code it exists to reject.
    expect(shared.length, 'no two candidates share a name, so a missing marker would be invisible here')
      .toBeGreaterThan(0)
  })

  it('renders every candidate the game offers', () => {
    const s = BREAK_ZONE_CHOICE!
    render(s)
    for (const id of breakZoneCandidates(s)) {
      expect(document.querySelector(`[data-card-id="${id}"]`), `candidate ${id} is not rendered at all`)
        .not.toBe(null)
    }
  })

  it('shows each candidate under the SAME name its button uses', () => {
    // The defect: the orphan row passed `d?.name`, so three Lusos all rendered as "Luso" while their buttons
    // read "Luso (1)".."Luso (3)" — the marker pointed at cards that did not carry it.
    //
    // The card's name is NOT the button's label and must not be asserted equal to it: a label is a sentence
    // and carries the possessive ("your Hugh Yurg (1)"), which on a card the player is looking at, beside
    // their own Break Zone, states the one thing never in doubt. The tie that matters is the MARKER, so the
    // card's name is exactly `displayName` and the button's label ends with it.
    const s = BREAK_ZONE_CHOICE!
    const { view } = render(s)
    for (const id of breakZoneCandidates(s)) {
      const cell = document.querySelector<HTMLElement>(`[data-card-id="${id}"]`)
      expect(cell, `candidate ${id} is not rendered`).not.toBe(null)
      const shown = cell!.querySelector('.card__name')?.textContent ?? ''
      expect(shown, `candidate ${id} is shown under a different name from its button`)
        .toBe(displayName(view, id))
      expect(choiceName(view, id), `the button for ${id} does not end in the name its card shows`)
        .toMatch(new RegExp(`${shown.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`))
    }
  })

  it('gives no two candidates the same displayed name', () => {
    const s = BREAK_ZONE_CHOICE!
    render(s)
    const shown = breakZoneCandidates(s).map((id) =>
      document.querySelector<HTMLElement>(`[data-card-id="${id}"] .card__name`)?.textContent ?? '')
    expect(shown.filter((n, i) => shown.indexOf(n) !== i), 'two rendered candidates read exactly alike')
      .toEqual([])
  })
})

/**
 * Sphene — the case my first E10 spec missed entirely, and the reason activation targets are now subjects.
 *
 * `legalCommands` pre-enumerates an activation's targets INTO the command (`activationTargetSets`), so unlike
 * a `chooseTargets` pending there is no later step at which those cards become subjects. `subjectsOf` returned
 * only the source, so Sphene's Break Zone candidates attached to no card, appeared in no row, and could not be
 * clicked. E9's fix made the BUTTON name them; nothing on screen was them.
 */
describe("an activation's target that no row draws (E10-A3)", () => {
  const SPHENE = '27-126S'

  /** A real position where Sphene can retrieve — its targets sit in the Break Zone, which no named zone draws. */
  function reachSpheneActivation(): GameState | null {
    for (let seed = 1; seed <= 25; seed++) {
      const greedy = new GreedyAgent({ seed, decks: DECKS, depth: 1 })
      const agent = {
        decide(v: PlayerView, legal: Command[]): Command {
          if (v.me !== HUMAN) return greedy.decide(v, legal)
          return greedy.decide(v, legal)
        },
      }
      let s: GameState = createGame({ seed, decks: DECKS, defs: CARD_DEFS })
      for (let i = 0; i < 3000 && !s.result; i++) {
        if (actingPlayer(s) === HUMAN) {
          const bz = s.players[HUMAN].breakZone
          const hit = legalCommands(s, HUMAN).some((c) => c.type === 'activateAbility'
            && s.cards[c.source]?.code === SPHENE && c.targets.some((t) => bz.includes(t)))
          if (hit) return s
        }
        if (actingPlayer(s) === null) break
        s = stepAi(s, agent).state
      }
    }
    return null
  }

  /** Sphene's Break Zone targets in this state. */
  function spheneTargets(s: GameState): CardId[] {
    const bz = s.players[HUMAN].breakZone
    const out = new Set<CardId>()
    for (const c of legalCommands(s, HUMAN)) {
      if (c.type !== 'activateAbility' || s.cards[c.source]?.code !== SPHENE) continue
      for (const t of c.targets) if (bz.includes(t)) out.add(t)
    }
    return [...out]
  }

  let SPHENE_STATE: GameState | null = null
  beforeAll(() => { SPHENE_STATE = reachSpheneActivation() })

  it('is reachable by playing', () => {
    expect(SPHENE_STATE, 'never reached a Sphene retrieval, so everything below asserts nothing').not.toBe(null)
    expect(spheneTargets(SPHENE_STATE!).length, 'the fixture offers no Break Zone target')
      .toBeGreaterThan(0)
  })

  it('is rendered and pressable, not merely named on a button', () => {
    const s = SPHENE_STATE!
    render(s)
    for (const id of spheneTargets(s)) {
      const cell = document.querySelector<HTMLElement>(`[data-card-id="${id}"]`)
      expect(cell, `Sphene's target ${id} is named on a button but rendered nowhere`).not.toBe(null)
      expect(cell!.querySelector('button'), `Sphene's target ${id} is rendered but cannot be pressed`)
        .not.toBe(null)
    }
  })

  it('maps each target to a command that actually names it (E10-A3)', () => {
    const s = SPHENE_STATE!
    const view = viewFor(s, HUMAN)
    const choices = buildChoiceSet(view, preferredChoices(view, legalCommands(s, HUMAN)))
    for (const id of spheneTargets(s)) {
      const forCard = choices.byCard.get(id) ?? []
      expect(forCard.length, `target ${id} offers no choice at all`).toBeGreaterThan(0)
      for (const c of forCard) {
        const named = c.command.type === 'activateAbility' ? [c.command.source, ...c.command.targets] : [c.card]
        expect(named, `a choice filed under ${id} does not name it`).toContain(id)
      }
    }
  })

  it('still treats payment as chosen FOR the player, not as a subject', () => {
    // The distinction the change rests on: a target is chosen BY the player and is a subject; the backups
    // dulled to pay are chosen for them and are not. Losing that would light up the whole board.
    const s = SPHENE_STATE!
    const view = viewFor(s, HUMAN)
    const choices = buildChoiceSet(view, preferredChoices(view, legalCommands(s, HUMAN)))
    for (const [id, list] of choices.byCard) {
      for (const c of list) {
        if (c.command.type !== 'activateAbility') continue
        const payers = c.command.payment.dullBackups
        if (!payers.includes(id)) continue
        const alsoSubject = c.command.source === id || c.command.targets.includes(id)
        expect(alsoSubject, `card ${id} is filed as a subject only because it pays`).toBe(true)
      }
    }
  })
})
