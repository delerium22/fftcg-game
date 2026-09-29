import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkInvariants, createGame, type GameState, type PlayerId } from '@fftcg/engine'
import { CARD_DEFS, DECK_CHOICES, DECK_KEYS, DECKS, LB_DECKS, DEFAULT_DECKS, deckLists, type DeckPair } from '../src/deck.js'
import { App, decksFromLocation } from '../src/App.js'
import { AI_STEP_MS, createWebGame } from '../src/game/useGame.js'

/**
 * Rung V1-C (spec V1-D17): a deck per seat. The pair is `[you, the AI]`, seat 0 then seat 1, and it is part of a
 * game's identity — so the URL that names a seed can name the pair too, and the game it deals is checked here card
 * for card rather than trusted.
 */

const sorted = (xs: readonly string[]): string[] => [...xs].sort()
/** Every main-deck code a seat holds, wherever it is — at the start of a game, that is the deck and the hand. */
const mainCodes = (s: GameState, p: PlayerId): string[] =>
  sorted([...s.players[p].deck, ...s.players[p].hand].map((id) => s.cards[id]!.code))
const lbCodes = (s: GameState, p: PlayerId): string[] => sorted(s.players[p].lbDeck.map((x) => s.cards[x.id]!.code))

afterEach(() => { vi.restoreAllMocks() })

describe('decksFromLocation', () => {
  it('reads ?decks=you,ai in seat order', () => {
    expect(decksFromLocation('?decks=vol1,vol2')).toEqual(['vol1', 'vol2'])
    expect(decksFromLocation('?seed=5&decks=vol2,vol2')).toEqual(['vol2', 'vol2'])
  })

  it('is undefined when absent, so the caller picks the default', () => {
    expect(decksFromLocation('?seed=5')).toBeUndefined()
  })

  it('ignores a malformed pair with a console warning, like ?seed=', () => {
    // A typo in an address bar is not a reason to brick the game — but it is a reason to say the parameter
    // was not honoured, rather than silently dealing a pair nobody asked for.
    for (const bad of ['vol1', 'vol1,vol3', 'vol1,vol2,vol1', 'VOL1,vol2', '', 'vol1,']) {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      expect(decksFromLocation(`?decks=${bad}`), bad).toBeUndefined()
      expect(warn, `no warning for ?decks=${bad}`).toHaveBeenCalledTimes(1)
      warn.mockRestore()
    }
  })
})

describe('createWebGame deals the chosen pair', () => {
  it('the web default is you Vol. 2 against the AI Vol. 1', () => {
    expect(DEFAULT_DECKS).toEqual(['vol2', 'vol1'])
  })

  it('the two lists really are different, or none of the ownership checks below would mean anything', () => {
    expect(sorted(DECK_CHOICES.vol1.main)).not.toEqual(sorted(DECK_CHOICES.vol2.main))
    expect(sorted(DECK_CHOICES.vol1.lb)).not.toEqual(sorted(DECK_CHOICES.vol2.lb))
  })

  const pairs: DeckPair[] = DECK_KEYS.flatMap((you) => DECK_KEYS.map((ai) => [you, ai] as const))
  it.each(pairs)('%s vs %s starts legally, each seat holding its own main and LB deck', (you, ai) => {
    const s = createWebGame(7, [you, ai])
    expect(checkInvariants(s), 'the new game breaks an invariant').toEqual([])
    expect(s.result).toBeNull()
    expect(s.pending?.kind, 'the game did not open on the first-player choice').toBe('chooseFirst')
    expect(mainCodes(s, 0), 'seat 0 was not dealt your deck').toEqual(sorted(DECK_CHOICES[you].main))
    expect(mainCodes(s, 1), 'seat 1 was not dealt the AI deck').toEqual(sorted(DECK_CHOICES[ai].main))
    expect(lbCodes(s, 0), 'seat 0 has the wrong LB deck').toEqual(sorted(DECK_CHOICES[you].lb))
    expect(lbCodes(s, 1), 'seat 1 has the wrong LB deck').toEqual(sorted(DECK_CHOICES[ai].lb))
  })

  it('deckLists maps a pair onto the per-seat lists createGame takes', () => {
    const { decks, lbDecks } = deckLists(['vol2', 'vol1'])
    expect(decks).toEqual([DECK_CHOICES.vol2.main, DECK_CHOICES.vol1.main])
    expect(lbDecks).toEqual([DECK_CHOICES.vol2.lb, DECK_CHOICES.vol1.lb])
  })

  it('the Vol. 2 mirror is the game the seed-pinned fixtures were written against', () => {
    // `DECKS`/`LB_DECKS` stay the mirror for the fixtures; the app's own mirror must deal the identical game,
    // or `?seed=N&decks=vol2,vol2` would not reproduce what those fixtures pin.
    expect(createWebGame(28, ['vol2', 'vol2'])).toEqual(createGame({ seed: 28, decks: DECKS, defs: CARD_DEFS, lbDecks: LB_DECKS }))
  })
})

// jsdom has no layout, so no `scrollIntoView`; the event log calls it on every render.
Element.prototype.scrollIntoView = function scrollIntoView() {}

describe('the App reads the URL once (R10)', () => {
  /**
   * Mount the real App at `search`, let the AI take its opening decision, and read what the player sees: the log
   * and the hand the deal gave them. Seed 5 hands the AI the first-player choice (it is the seed's call, whatever
   * the decks). jsdom has no `Worker`, so the Greedy fallback answers it on the pacing timer — deterministic from
   * the game's seed, which is what makes "the same game on reload" checkable card for card.
   */
  function load(search: string): { log: string[]; hand: string } {
    vi.useFakeTimers()
    window.history.replaceState(null, '', `/${search}`)
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    act(() => { root.render(createElement(App)) })
    act(() => { vi.advanceTimersByTime(AI_STEP_MS) })
    const log = [...host.querySelectorAll('.log__line')].map((p) => p.textContent ?? '')
    const hand = host.querySelector('[role="grid"][aria-label="Your hand"]')?.textContent ?? ''
    act(() => { root.unmount() })
    host.remove()
    vi.useRealTimers()
    return { log, hand }
  }
  afterEach(() => { window.history.replaceState(null, '', '/') })

  it('?seed=5&decks=vol1,vol1 deals the same game again on reload', () => {
    const first = load('?seed=5&decks=vol1,vol1')
    expect(first.log[0]).toBe('New game — you play Starter Vol. 1, the AI plays Starter Vol. 1')
    expect(first.hand, 'the AI\'s opening choice never landed, so no hand was dealt to compare').not.toBe('')
    expect(load('?seed=5&decks=vol1,vol1')).toEqual(first)
    // And the pair is what dealt it: the same seed with the other deck deals you another hand.
    expect(load('?seed=5&decks=vol2,vol1').hand).not.toBe(first.hand)
  })

  it('with no ?decks= deals the default pair', () => {
    expect(load('?seed=5').log[0]).toBe('New game — you play Starter Vol. 2, the AI plays Starter Vol. 1')
  })

  it('warns about a malformed parameter once, not on every render', () => {
    // Parsed in the App's lazy initialiser: the location is a fact about the page load, and re-reading it on every
    // render repeated the console warning each time the board changed.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    window.history.replaceState(null, '', '/?seed=x&decks=vol9,vol1')
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    act(() => { root.render(createElement(App)) })
    act(() => { root.render(createElement(App)) })
    act(() => { root.unmount() })
    host.remove()
    expect(warn.mock.calls.map((c) => String(c[0]).slice(0, 16)).sort()).toEqual(['Ignoring ?decks=', 'Ignoring ?seed=x'])
  })
})
