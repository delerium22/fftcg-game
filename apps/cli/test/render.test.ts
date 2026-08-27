import { describe, expect, it } from 'vitest'
import { createGame, apply, viewFor, legalCommands, actingPlayer } from '@fftcg/engine'
import { cardDb, loadCards } from '@fftcg/cards'
import { readFileSync } from 'node:fs'
import { parseDeckFile } from '../src/deck.js'
import { describeCommand, renderView } from '../src/render.js'

const deck = parseDeckFile(readFileSync(new URL('../../../decks/starter-2025-vol2.txt', import.meta.url), 'utf8'))
describe('render — a deck look or search (rung C9)', () => {
  /** A view whose top three deck slots `looker` knows, seen from `seat`. */
  function looked(seat: 0 | 1, looker: 0 | 1, to: 'hand' | 'field') {
    let s = createGame({ seed: 1, decks: [deck, deck], defs: loadCards() })
    const p = actingPlayer(s)!
    s = apply(s, { type: 'chooseFirst', player: p, goFirst: true }).state
    s = apply(s, { type: 'mulligan', player: p, redraw: false }).state
    s = apply(s, { type: 'mulligan', player: p === 0 ? 1 : 0, redraw: false }).state
    const ids = s.players[looker].deck.slice(0, 3)
    const v = viewFor({ ...s, knownBy: Object.fromEntries(ids.map((id) => [id, 1 << looker])) }, seat)
    v.pending = { kind: 'chooseFromDeck', player: looker, min: 0, max: 1, count: 3, to }
    return { v, ids }
  }

  it('says PLAY for a search, because that is where the card goes — not "Take"', () => {
    const { v, ids } = looked(0, 0, 'field')
    const label = describeCommand(v, { type: 'chooseFromDeck', player: 0, picks: [1] })
    // The CLI's `name` appends the code, so pin the parts rather than the whole string — but pin the NAME,
    // which is what an off-by-one in the pick index would change.
    expect(label.startsWith(`Play ${v.defs[v.cards[ids[1]!]!.code]!.name} (`)).toBe(true)
    expect(label.endsWith(' onto the field')).toBe(true)
    expect(describeCommand(v, { type: 'chooseFromDeck', player: 0, picks: [] })).toBe('Find nothing')
  })

  it("reads the CHOOSER's deck, so the other seat gets a count and not a name", () => {
    // Seat 0 watching seat 1's private look: those slots are `card: null` in this view, so there is nothing
    // to name. Reading `v.me`'s deck instead would name seat 0's own cards as the ones seat 1 took.
    const { v } = looked(0, 1, 'hand')
    expect(describeCommand(v, { type: 'chooseFromDeck', player: 1, picks: [1] })).toBe('Take 1 card(s)')
  })
})

describe('render', () => {
  it('renders a board and describes commands with card names', () => {
    let s = createGame({ seed: 1, decks: [deck, deck], defs: loadCards() })
    const p = actingPlayer(s)!
    s = apply(s, { type: 'chooseFirst', player: p, goFirst: true }).state
    s = apply(s, { type: 'mulligan', player: p, redraw: false }).state
    s = apply(s, { type: 'mulligan', player: p === 0 ? 1 : 0, redraw: false }).state
    const v = viewFor(s, p)
    const text = renderView(v)
    expect(text).toMatch(/Turn 1/); expect(text).toMatch(/Main Phase 1/); expect(text).toMatch(/Hand \(6\)/)
    const card = v.hand[0]!, other = v.hand[1]!
    const cast = { type: 'castCharacter' as const, player: p, card, payment: { dullBackups: [], discards: [{ card: other, element: 'earth' as const }] } }   // hand-built; legality irrelevant to rendering
    expect(describeCommand(v, cast)).toMatch(new RegExp(`^Cast ${v.defs[v.cards[card]!.code]!.name} .* paying: discard .* as earth$`))
    expect(describeCommand(v, { type: 'pass', player: p })).toBe('Pass')
    expect(legalCommands(s, p).length).toBeGreaterThan(0)
    void cardDb
  })
})
