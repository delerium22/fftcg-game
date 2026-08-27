import { describe, expect, it } from 'vitest'
import { viewFor } from '../src/view.js'
import { makeGame, withField } from './helpers.js'

describe('§7.6 hidden zones', () => {
  it('shows my hand, counts for the opponent, and never leaks deck/hand instances', () => {
    let s = makeGame(); let f: number
    ;[s, f] = withField(s, 1, 'forwards', 'V-F2')
    const v = viewFor(s, 0)
    expect(v.hand).toEqual(s.players[0].hand)
    expect(v.fields[1].handCount).toBe(s.players[1].hand.length)
    expect(v.fields[1].forwards[0]?.id).toBe(f)
    const visible = new Set(Object.keys(v.cards).map(Number))
    for (const id of s.players[1].hand) expect(visible.has(id)).toBe(false)
    for (const id of [...s.players[0].deck, ...s.players[1].deck]) expect(visible.has(id)).toBe(false)
    expect(visible.has(f)).toBe(true)
    expect(v.fields[1].deck.length).toBe(s.players[1].deck.length)   // 45 after dealing 5
    // C9 gave `FieldView` a `deck` of SLOTS, so a key named "deck" now exists legitimately. The property this
    // ever cared about is that no hidden card's identity leaks — assert that, not the absence of a key.
    // The loops above already prove no hidden id reaches `v.cards`; this proves none reaches a deck SLOT
    // either, which is the new surface C9 added and the only place a deck id could now appear.
    for (const side of v.fields) for (const slot of side.deck) expect(slot.card).toBeNull()
    expect(v.firstPlayer).toBe(s.firstPlayer)
    expect(v.mulliganDecided).toEqual([true, true])
  })
  it('is isolated from engine state', () => {
    const s = makeGame()
    const v = viewFor(s, 0)
    v.hand.push(4242); v.fields[0].forwards.push({ id: 4243, status: 'active', damage: 0, enteredTurn: 0, attackedThisTurn: false, granted: [], powerBonus: 0, flags: [] }); (v.defs['V-F1'] as { cost: number }).cost = 99
    expect(s.players[0].hand).not.toContain(4242)
    expect(s.players[0].forwards).toHaveLength(0)
    expect(s.defs['V-F1']?.cost).toBe(1)
  })
})
