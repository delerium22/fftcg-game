import { describe, expect, it } from 'vitest'
import { createGame, apply, viewFor, legalCommands, actingPlayer, type PlayerView } from '@fftcg/engine'
import { cardDb, loadCards } from '@fftcg/cards'
import { readFileSync } from 'node:fs'
import { parseDeckFile } from '../src/deck.js'
import { askingBecause, describeCommand, renderView } from '../src/render.js'

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
    v.pending = { kind: 'chooseFromDeck', player: looker, min: 0, max: 1, count: 3, scope: 'top', to }
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

describe('render — an activated ability names what it DOES, not only what it costs', () => {
  // The hotseat player has no more access to rules text than the browser player does: a label that says
  // "[Earth], discard" tells them what a click SPENDS and never what it buys. Both front-ends now read the
  // effect off the printed text through the same engine helper, so the two play modes cannot drift.
  const defs = loadCards()
  /** A card instance the VIEW knows about. A fresh deck is hidden, so nothing real is visible to read. */
  const mint = (v: ReturnType<typeof viewFor>, id: number, code: string): number => {
    v.cards[id] = { id, code, owner: 0 }
    return id
  }

  it('puts the effect after the cost, drops the legality boilerplate, and keeps the payment', () => {
    const s = createGame({ seed: 1, decks: [deck, deck], defs })
    const v = viewFor(s, 0)
    // Geomancer's clause is usable from HAND, which is also why the label cannot read it off the board.
    expect(v.defs['18-064C']?.abilities?.some((a) => a.id === '18-064C:draw'), 'Geomancer no longer has that clause').toBe(true)
    const geo = mint(v, 900, '18-064C')
    const label = describeCommand(v, {
      type: 'activateAbility', player: 0, source: geo, abilityId: '18-064C:draw',
      payment: { dullBackups: [], discards: [] }, targets: [],
    })
    // `Name (CODE)` is the CLI's own convention — a terminal has no art to identify a card by.
    expect(label).toBe("Use Geomancer (18-064C)'s [Earth], discard: Draw 1 card")
    expect(label, 'a legality condition the engine already enforced reached the label').not.toContain('You can only use this ability')
  })

  it('covers every activated clause the pool ships — the SHAPE of the label', () => {
    // As with the web sweep: what the effect should say is pinned by the table in
    // `packages/cards/test/abilities.test.ts`. Here the claim is only that every clause gets a label built
    // the same way, so a card added later cannot quietly fall back to "…'s [cost] ability".
    const s = createGame({ seed: 1, decks: [deck, deck], defs })
    const v = viewFor(s, 0)
    let checked = 0
    let next = 910
    for (const def of defs) {
      for (const ability of def.abilities ?? []) {
        if (ability.trigger.kind !== 'activated') continue
        const id = mint(v, next++, def.code)
        const label = describeCommand(v, {
          type: 'activateAbility', player: 0, source: id, abilityId: ability.id,
          payment: { dullBackups: [], discards: [] }, targets: [],
        })
        expect(label.startsWith(`Use ${def.name} (${def.code})'s `), `${ability.id}: ${label}`).toBe(true)
        expect(label, `${ability.id}: fell back to naming the clause — ${label}`).not.toMatch(/ ability$/)
        expect(label.indexOf(': '), `${ability.id}: nothing separates cost from effect — ${label}`).toBeGreaterThan(0)
        checked++
      }
    }
    expect(checked, 'no activated clause was checked, so this proves nothing').toBeGreaterThan(3)
  })
})

describe('render — a modal choice says what the modes DO', () => {
  // Found by playing the hotseat: a modal ability offered "Choose mode 1 + 2", with the effects nowhere on
  // screen. The engine carries the printed wordings on the pending for exactly this reason, and the browser
  // has read them since rung C1 — the terminal was rendering an ordinal.
  const defs = loadCards()

  it('prints the printed wording, not the index', () => {
    const s = createGame({ seed: 1, decks: [deck, deck], defs })
    const v = viewFor(s, 0)
    v.pending = {
      kind: 'chooseMode', player: 0, min: 1, max: 2,
      labels: ['Choose 1 Forward. Dull it.', 'Choose 1 Forward. Deal it 5000 damage.', 'Choose 1 Forward. It gains Haste.'],
    }
    expect(describeCommand(v, { type: 'chooseMode', player: 0, modes: [0] }))
      .toBe('Choose 1 Forward. Dull it.')
    expect(describeCommand(v, { type: 'chooseMode', player: 0, modes: [0, 2] }))
      .toBe('Choose 1 Forward. Dull it. + Choose 1 Forward. It gains Haste.')
    expect(describeCommand(v, { type: 'chooseMode', player: 0, modes: [] })).toBe('Choose no modes')
  })

  it('falls back to an ordinal only when the wording is genuinely missing', () => {
    const s = createGame({ seed: 1, decks: [deck, deck], defs })
    const v = viewFor(s, 0)
    v.pending = { kind: 'chooseMode', player: 0, min: 1, max: 1, labels: [] }
    expect(describeCommand(v, { type: 'chooseMode', player: 0, modes: [1] })).toBe('mode 2')
  })
})

describe('render — the terminal says WHY it is asking', () => {
  // Found by playing: the menu offered "0: Target Lightning (27-127S)" at 5 of 7 damage, with nothing on
  // screen saying whether that Lightning was about to be dulled, damaged, broken or buffed. The browser
  // answers this with a prompt above its buttons; the terminal had only the numbered list.
  const defs = loadCards()
  const NOEL = '16-092C'

  const suspended = (code: string, abilityId: string): PlayerView => {
    const s = createGame({ seed: 1, decks: [deck, deck], defs })
    const v = viewFor(s, 0)
    const src = 900
    v.cards[src] = { id: src, code, owner: 0 }
    v.resolution = { active: { abilityId, source: src, controller: 0, path: [], chosen: [], modes: [], triggerEvent: null }, queue: [], continuation: null, steps: 1 }
    return v
  }

  it('names the clause acting on the cards, from the card own printed text', () => {
    const v = suspended(NOEL, `${NOEL}:etb`)
    const line = askingBecause(v)
    expect(line, 'no line at all').not.toBeNull()
    // A TRIGGERED clause has no "cost: effect" colon, so the whole printed text comes through — and that is
    // what the player needs: "EX BURST When Noel enters the field, choose up to 2 Forwards opponent
    // controls. Dull them." I expected only the tail here and was wrong about the code, not the other way
    // round; the full sentence is more use in a terminal with nothing else on screen.
    expect(line).toContain('Dull them')
    expect(line, 'the source card is not named').toContain(v.defs[NOEL]!.name)
    expect(line).toContain('When Noel enters the field')
  })

  it('shows only the EFFECT half of an activated clause, not the cost it already paid', () => {
    // Where the "cost: effect" split does matter. Geomancer prints "[Earth], discard Geomancer: Draw 1 card"
    // — by the time a choice is on the table the cost is spent, and repeating it is noise.
    const GEO = '18-064C'
    const v = suspended(GEO, `${GEO}:draw`)
    const line = askingBecause(v) ?? ''
    expect(line).toContain('Draw 1 card')
    expect(line, 'the spent cost is still being quoted').not.toContain('[Earth]')
  })

  it('says nothing when no clause is running, rather than inventing a reason', () => {
    const s = createGame({ seed: 1, decks: [deck, deck], defs })
    expect(askingBecause(viewFor(s, 0)), 'invented a reason with no agenda frame').toBeNull()
  })

  it('says nothing when the frame names a clause the defs do not have', () => {
    const v = suspended(NOEL, 'no-such-clause')
    expect(askingBecause(v), 'invented a reason for an unknown clause').toBeNull()
  })
})
