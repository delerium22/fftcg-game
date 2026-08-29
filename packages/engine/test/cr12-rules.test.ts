import { describe, expect, it } from 'vitest'
import { dealPlayerDamage, runRuleProcesses } from '../src/rules.js'
import { checkInvariants } from '../src/invariants.js'
import { makeDef, makeGame, VANILLA_POOL, withField } from './helpers.js'

describe('§12.4 rule processes', () => {
  it('§12.4.4: a zero-power character goes to the break zone (not "broken")', () => {
    let s = makeGame({ defs: [...VANILLA_POOL, makeDef({ code: 'V-Z', power: 0 })] }); let z: number
    ;[s, z] = withField(s, 0, 'forwards', 'V-Z')
    const [t, events] = runRuleProcesses(s)
    expect(t.players[0].breakZone).toContain(z)
    expect(events).toEqual([{ type: 'putIntoBreakZone', card: z, reason: 'zeroPower' }])
  })
  it('§12.4.5: a forward with damage ≥ power is broken', () => {
    let s = makeGame(); let f: number, g: number
    ;[s, f] = withField(s, 0, 'forwards', 'V-F2', { damage: 5000 })
    ;[s, g] = withField(s, 0, 'forwards', 'V-F2', { damage: 4000 })
    const [t, events] = runRuleProcesses(s)
    expect(t.players[0].forwards.map((c) => c.id)).toEqual([g])
    expect(t.players[0].breakZone).toContain(f)
    expect(events).toContainEqual({ type: 'broken', card: f })
  })
  it('§12.4.5: a forward with power below 1000 is not broken by damage', () => {
    let s = makeGame({ defs: [...VANILLA_POOL, makeDef({ code: 'V-W', power: 500 })] }); let w: number
    ;[s, w] = withField(s, 0, 'forwards', 'V-W', { damage: 9000 })
    const [t, events] = runRuleProcesses(s)
    expect(t.players[0].forwards.map((c) => c.id)).toEqual([w])
    expect(events).toEqual([])
  })
  it('§12.4.1: seven cards in the damage zone loses', () => {
    let s = makeGame()
    s = { ...s, players: [{ ...s.players[0], damageZone: s.players[0].deck.slice(0, 7), deck: s.players[0].deck.slice(7) }, s.players[1]] }
    const [t] = runRuleProcesses(s)
    expect(t.result).toEqual({ winner: 1, cause: 'damage', reason: expect.stringMatching(/7/) })
  })
  it('§3.3: both at seven is a draw', () => {
    let s = makeGame()
    const hit = (p: typeof s.players[0]) => ({ ...p, damageZone: p.deck.slice(0, 7), deck: p.deck.slice(7) })
    s = { ...s, players: [hit(s.players[0]), hit(s.players[1])] }
    expect(runRuleProcesses(s)[0].result).toEqual({ winner: null, cause: 'bothReachedSeven', reason: expect.any(String) })
  })
})

describe('dealPlayerDamage', () => {
  it('moves the top card of the deck to the damage zone', () => {
    const s = makeGame()
    const top = s.players[1].deck[0]!
    const [t, events] = dealPlayerDamage(s, 1, null)
    expect(t.players[1].damageZone).toEqual([top])
    expect(t.players[1].deck[0]).not.toBe(top)
    expect(events).toContainEqual({ type: 'playerDamaged', player: 1, card: top })
  })
  it('§3.1.3: damage with an empty deck loses', () => {
    let s = makeGame()
    s = { ...s, players: [s.players[0], { ...s.players[1], deck: [] }] }
    expect(dealPlayerDamage(s, 1, null)[0].result).toEqual({ winner: 0, cause: 'damageWithEmptyDeck', reason: expect.stringMatching(/empty/i) })
  })
  it('logs a skipped EX Burst', () => {
    let s = makeGame({ defs: [...VANILLA_POOL, makeDef({ code: 'V-EX', exBurst: true, hasAbilities: true })] })
    const id = 999
    s = { ...s, cards: { ...s.cards, [id]: { id, code: 'V-EX', owner: 1 } }, players: [s.players[0], { ...s.players[1], deck: [id, ...s.players[1].deck] }] }
    const [, events] = dealPlayerDamage(s, 1, null)
    expect(events).toContainEqual({ type: 'exBurstSkipped', player: 1, card: id })
  })

  it('§12.4.4/§15.1.1.3: a broken card goes to its OWNER’s break zone, not its controller’s', () => {
    // Nothing in the MVP0 pool changes control, so owner and controller coincide in every real game and this
    // is unobservable in play — which is exactly why it has to be asserted directly. The rule process removed
    // the card from the controller's field and appended it to that same player's break zone, so the first
    // control-changing effect would have silently stolen the card.
    let s = makeGame({ defs: [...VANILLA_POOL, makeDef({ code: 'V-Z0', power: 0 })] })
    let card: number
    ;[s, card] = withField(s, 0, 'forwards', 'V-Z0')   // sitting on P0's field…
    s = { ...s, cards: { ...s.cards, [card]: { ...s.cards[card]!, owner: 1 } } }   // …but owned by P1

    const [t] = runRuleProcesses(s)
    expect(t.players[0].forwards.some((c) => c.id === card), 'left the controller’s field').toBe(false)
    expect(t.players[1].breakZone, 'went to the OWNER’s break zone').toContain(card)
    expect(t.players[0].breakZone, 'and not the controller’s').not.toContain(card)
    // C10's turn history follows the card, for the same reason (spec C10-2). This fixture is the only place
    // owner and controller differ, so keying the history by `controller` instead of `owner` was invisible
    // everywhere else: the card would sit in P1's Break Zone while P0's history claimed it.
    expect(t.players[1].putIntoBreakZoneFromFieldThisTurn, 'the history followed the controller, not the card').toContain(card)
    expect(t.players[0].putIntoBreakZoneFromFieldThisTurn).not.toContain(card)
    expect(checkInvariants(t)).toEqual([])
  })
})
