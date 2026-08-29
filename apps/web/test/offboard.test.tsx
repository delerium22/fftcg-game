import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  actingPlayer, apply, createGame, deckPickCandidates, legalCommands, pickedDeckCards, viewFor,
  type CardId, type Command, type GameState, type PlayerView,
} from '@fftcg/engine'
import { GreedyAgent } from '@fftcg/ai'
import { CARD_DEFS, DECKS } from '../src/deck.js'
import { Board } from '../src/ui/Board.js'
import { seedFromLocation } from '../src/App.js'
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

/**
 * A deck search (E10-A2/A3/A4) — the case where nothing was rendered at all.
 *
 * `chooseFromDeck` names deck INDICES, not card ids, so `subjectsOf` could not turn one into a card and every
 * search fell into `loose`. Hugh Yurg puts ANY card in your deck onto the field and presented as a list of
 * bare names for cards the player has never seen; picking one by name alone is not a decision a player can
 * make. Resolving the picks through the view turns them into ordinary `byCard` keys, after which the orphan
 * row draws them, `pick` clicks them and `displayName` numbers them.
 *
 * All three printed paths are covered, because they differ on every axis that could be got wrong:
 *   Hugh Yurg  whole deck, filtered,   to the field
 *   Reeve      top three, unfiltered,  to hand
 *   Miner      top five,  filtered,    to hand
 * Reeve is the one that catches "render every visible deck card": at its pending the view exposes seven deck
 * cards and the look is over three.
 */
describe('a deck search (E10-A2/A3/A4)', () => {
  const SEARCHERS = ['24-063H', '20-105C', '20-074C']    // Hugh Yurg, Reeve, Miner

  /** The first state whose pending is a `chooseFromDeck` matching `want`. */
  function reachSearch(want: (p: Extract<GameState['pending'], { kind: 'chooseFromDeck' }>) => boolean): GameState | null {
    for (let seed = 1; seed <= 30; seed++) {
      const greedy = new GreedyAgent({ seed, decks: DECKS, depth: 1 })
      const agent = {
        decide(v: PlayerView, legal: Command[]): Command {
          if (v.me !== HUMAN) return greedy.decide(v, legal)
          return legal.find((c) => c.type === 'castCharacter'
            && SEARCHERS.includes(v.cards[c.card]?.code ?? '')) ?? greedy.decide(v, legal)
        },
      }
      let s: GameState = createGame({ seed, decks: DECKS, defs: CARD_DEFS })
      for (let i = 0; i < 3000 && !s.result; i++) {
        const p = s.pending
        if (p?.kind === 'chooseFromDeck' && p.player === HUMAN && want(p)) return s
        if (actingPlayer(s) === null) break
        s = stepAi(s, agent).state
      }
    }
    return null
  }

  /** The cards the engine says are eligible, as ids — the answer the UI must agree with and never re-derive. */
  function eligibleIds(s: GameState): CardId[] {
    const p = s.pending
    if (p?.kind !== 'chooseFromDeck') return []
    return deckPickCandidates(s, p).map((i) => s.players[HUMAN].deck[i]!).filter((id) => id !== undefined)
  }

  /** The ids the candidate row actually draws. */
  function renderedCandidates(): CardId[] {
    const grid = document.querySelector('[aria-label="Choose a card"]')
    if (!grid) return []
    return [...grid.querySelectorAll('[data-card-id]')]
      .map((el) => Number(el.getAttribute('data-card-id')))
  }

  type DeckPending = Extract<GameState['pending'], { kind: 'chooseFromDeck' }>
  const PATHS: { name: string; want: (p: DeckPending) => boolean }[] = [
    { name: 'Hugh Yurg — whole deck, filtered, to the field', want: (p) => p.scope === 'deck' && p.to === 'field' },
    { name: 'Reeve — top three, unfiltered, to hand', want: (p) => p.scope === 'top' && p.to === 'hand' && p.count === 3 },
    { name: 'Miner — top five, filtered, to hand', want: (p) => p.scope === 'top' && p.to === 'hand' && p.count === 5 },
  ]

  for (const path of PATHS) {
    describe(path.name, () => {
      let STATE: GameState | null = null
      beforeAll(() => { STATE = reachSearch(path.want) })

      it('is reachable, and the view exposes cards the player may NOT pick', () => {
        expect(STATE, 'never reached this search, so the rest of this block asserts nothing').not.toBe(null)
        const s = STATE!
        const eligible = eligibleIds(s)
        expect(eligible.length, 'nothing is eligible, so there is no choice to render').toBeGreaterThan(0)
        // The guard the plan review demanded. Without a visible INELIGIBLE card, "renders only what you may
        // pick" is trivially true and a test asserting it proves nothing.
        const visible = viewFor(s, HUMAN).fields[HUMAN].deck.filter((slot) => slot.card !== null).length
        expect(visible - eligible.length,
          'every visible deck card is eligible here, so filtering cannot be observed').toBeGreaterThan(0)
      })

      it('renders exactly the eligible cards — no more, no fewer (E10-A2, E10-A4)', () => {
        const s = STATE!
        render(s)
        expect(renderedCandidates().slice().sort((a, b) => a - b))
          .toEqual(eligibleIds(s).slice().sort((a, b) => a - b))
      })

      it('clicking a candidate submits the pick that resolves back to THAT card (E10-A3)', () => {
        const s = STATE!
        const { view, chosen } = render(s)
        const ids = renderedCandidates()
        expect(ids.length, 'nothing rendered to click').toBeGreaterThan(0)
        for (const id of ids) {
          chosen.length = 0
          const button = document.querySelector<HTMLElement>(`[data-card-id="${id}"] button`)
          expect(button, `candidate ${id} is rendered but cannot be pressed`).not.toBe(null)
          act(() => { button!.click() })
          expect(chosen.length, `clicking ${id} submitted nothing`).toBe(1)
          const command = chosen[0]!.command
          expect(command.type).toBe('chooseFromDeck')
          if (command.type !== 'chooseFromDeck') continue
          // A deck command carries INDICES, so the check has to go back through the engine's own resolution.
          expect(pickedDeckCards(view, command.player, command.picks),
            `clicking ${id} submitted a pick naming a different card`).toEqual([id])
        }
      })
    })
  }
})

/**
 * The candidates go away once the choice is made (E10-A5).
 *
 * Asserted as a before/after on NAMED ids, never as "the row is absent": a row that never existed would pass
 * that, and the row may legitimately survive if another off-board choice remains. The plan review named this
 * as the criterion easiest to write vacuously, so the before-state is asserted first and the test fails if
 * there was nothing to clear.
 */
describe('candidates clear once the choice is made (E10-A5)', () => {
  it('leaves none of the searched deck cards on the board afterwards', () => {
    const found = (() => {
      for (let seed = 1; seed <= 30; seed++) {
        const greedy = new GreedyAgent({ seed, decks: DECKS, depth: 1 })
        const agent = {
          decide(v: PlayerView, legal: Command[]): Command {
            if (v.me !== HUMAN) return greedy.decide(v, legal)
            return legal.find((c) => c.type === 'castCharacter'
              && ['24-063H', '20-105C', '20-074C'].includes(v.cards[c.card]?.code ?? ''))
              ?? greedy.decide(v, legal)
          },
        }
        let s: GameState = createGame({ seed, decks: DECKS, defs: CARD_DEFS })
        for (let i = 0; i < 3000 && !s.result; i++) {
          if (s.pending?.kind === 'chooseFromDeck' && s.pending.player === HUMAN) return s
          if (actingPlayer(s) === null) break
          s = stepAi(s, agent).state
        }
      }
      return null
    })()
    expect(found, 'never reached a search, so this asserts nothing').not.toBe(null)

    const before = found!
    render(before)
    const candidates = [...document.querySelectorAll('[aria-label="Choose a card"] [data-card-id]')]
      .map((el) => Number(el.getAttribute('data-card-id')))
    // The guard: without candidates on screen first, "they are gone" is true of every possible board.
    expect(candidates.length, 'no candidates were rendered, so their disappearance proves nothing')
      .toBeGreaterThan(0)

    const pick = legalCommands(before, HUMAN)
      .find((c) => c.type === 'chooseFromDeck' && c.picks.length > 0)
    expect(pick, 'the search offers no pick to take').not.toBe(undefined)
    const after = apply(before, pick!).state

    act(() => { root?.unmount() })
    host?.remove()
    root = null
    host = null
    render(after)
    const still = [...document.querySelectorAll('[aria-label="Choose a card"] [data-card-id]')]
      .map((el) => Number(el.getAttribute('data-card-id')))
    for (const id of candidates) {
      expect(still, `candidate ${id} is still offered after the search resolved`).not.toContain(id)
    }
  })
})

/**
 * `?seed=` — a production surface added so E10's browser check can take a REPRODUCIBLE route.
 *
 * Strict on purpose. The CLI once accepted an unknown flag silently and ran 400 games for forty minutes
 * answering a question nobody asked; the lesson was that quietly doing something OTHER than what was asked is
 * the expensive failure. `Number` would read "" as 0, "0x10" as 16, " 5" as 5 and "1e3" as 1000 — four ways
 * to hand back a different game from the one requested, which defeats the entire point of asking by seed.
 *
 * A bad seed still starts a game, though: a typo in an address bar is not a malformed flag, and bricking the
 * page would be a worse answer than playing on and saying so.
 */
describe('the seed in the URL', () => {
  it('takes a plain whole number', () => {
    expect(seedFromLocation('?seed=7')).toBe(7)
    expect(seedFromLocation('?seed=0')).toBe(0)
    expect(seedFromLocation('?seed=2147483647')).toBe(2_147_483_647)
  })

  it('is absent when not asked for', () => {
    expect(seedFromLocation('')).toBe(undefined)
    expect(seedFromLocation('?other=3')).toBe(undefined)
  })

  it('refuses every spelling that would silently mean a different game', () => {
    // Each of these is a value `Number()` accepts and turns into a seed nobody asked for.
    for (const raw of ['', ' 5', '0x10', '1e3', '5.0', '-1', '+7', 'Infinity', '2147483648', 'abc']) {
      expect(seedFromLocation(`?seed=${encodeURIComponent(raw)}`), `?seed=${raw} was accepted`).toBe(undefined)
    }
  })

  it('says so rather than pretending it honoured the request', () => {
    const warned: unknown[] = []
    const real = console.warn
    console.warn = (...args: unknown[]) => { warned.push(args[0]) }
    try {
      seedFromLocation('?seed=abc')
    } finally {
      console.warn = real
    }
    expect(warned.length, 'an ignored seed was ignored silently').toBe(1)
    expect(String(warned[0])).toContain('abc')
  })
})
