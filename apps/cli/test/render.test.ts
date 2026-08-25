import { describe, expect, it } from 'vitest'
import { createGame, apply, viewFor, legalCommands, actingPlayer } from '@fftcg/engine'
import { cardDb, loadCards } from '@fftcg/cards'
import { readFileSync } from 'node:fs'
import { parseDeckFile } from '../src/deck.js'
import { describeCommand, renderView } from '../src/render.js'

const deck = parseDeckFile(readFileSync(new URL('../../../decks/starter-2025-vol2.txt', import.meta.url), 'utf8'))
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
