import { describe, expect, it } from 'vitest'
import { dealPlayerDamage, runRuleProcesses } from '../src/rules.js'
import { applyChooseExBurst } from '../src/attack.js'
import { checkInvariants } from '../src/invariants.js'
import type { Ability, Frame } from '../src/abilities.js'
import type { CardId, GameState } from '../src/state.js'
import type { CardDef } from '../src/types.js'
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
  /** A deck whose top card is `code`, so the next damage reveals exactly that card. */
  const withTopCard = (defs: CardDef[], code: string): [GameState, CardId] => {
    const base = makeGame({ defs: [...VANILLA_POOL, ...defs] })
    const id = 999
    return [{
      ...base,
      cards: { ...base.cards, [id]: { id, code, owner: 1 } },
      players: [base.players[0], { ...base.players[1], deck: [id, ...base.players[1].deck] }],
    }, id]
  }

  const EX_ABILITY: Ability = {
    id: 'V-EX:etb', trigger: { kind: 'enterField' }, exBurst: true,
    text: 'EX BURST When V-EX enters the field, nothing happens.', effects: [],
  }

  it('§11.10: offers the marked clause when an EX Burst card is dealt as damage', () => {
    const [s, id] = withTopCard([makeDef({ code: 'V-EX', exBurst: true, hasAbilities: true, abilities: [EX_ABILITY] })], 'V-EX')
    const [t, events] = dealPlayerDamage(s, 1, null)
    expect(events).toContainEqual({ type: 'exBurstOffered', player: 1, card: id, abilityId: 'V-EX:etb' })
    expect(t.pending).toEqual({ kind: 'chooseExBurst', player: 1, card: id, abilityId: 'V-EX:etb' })
    // The damage still happened. A burst is damage that has an ability, not a card being cast.
    expect(t.players[1].damageZone).toContain(id)
  })

  it('offers nothing when the card prints EX BURST but marks no clause', () => {
    // A coverage hole rather than a crash: `pool-coverage` is where a card printing EX BURST with no marked
    // ability is caught, and damage time must not care. This was the original fixture, which passed the old
    // assertion for the wrong reason — the def had `exBurst` and no abilities at all.
    const [s] = withTopCard([makeDef({ code: 'V-EX', exBurst: true, hasAbilities: true })], 'V-EX')
    const [t, events] = dealPlayerDamage(s, 1, null)
    expect(events.some((e) => e.type.startsWith('exBurst')), 'an unmarked card was offered').toBe(false)
    expect(t.pending).toBeNull()
  })

  it('ignores a marked clause on a card that does not print EX BURST (G3)', () => {
    // The runtime half of the contract `pool-coverage` states. Removing the def check passed every other test
    // here, because no other fixture makes the two disagree — and disagreement is precisely the case it
    // guards: a clause mistakenly marked `exBurst` on a card printing no EX BURST would otherwise fire a rule
    // the card does not have, in play, with nothing to flag it.
    const [s] = withTopCard([makeDef({
      code: 'V-NOEX', exBurst: false, hasAbilities: true,
      abilities: [{ ...EX_ABILITY, id: 'V-NOEX:etb' }],
    })], 'V-NOEX')
    const [t, events] = dealPlayerDamage(s, 1, null)
    expect(events.some((e) => e.type.startsWith('exBurst')), 'a card that prints no EX BURST was offered one').toBe(false)
    expect(t.pending).toBeNull()
  })

  it('does NOT offer when the damage was the seventh, because the game is over (G3-A5)', () => {
    // Asserted against a fixture proven to offer BELOW lethal, one line up in this same shape — otherwise this
    // passes on any implementation that never offers at all.
    const defs = [makeDef({ code: 'V-EX', exBurst: true, hasAbilities: true, abilities: [EX_ABILITY] })]
    const [six, id] = withTopCard(defs, 'V-EX')
    // Card 0 is the EX card the next damage will reveal, so the damage zone is filled from index 1 onward and
    // those cards LEAVE the deck — a card in two zones at once is a state `checkInvariants` rejects.
    const stack = (n: number): GameState => ({
      ...six,
      players: [six.players[0], {
        ...six.players[1],
        damageZone: six.players[1].deck.slice(1, 1 + n),
        deck: [six.players[1].deck[0] as CardId, ...six.players[1].deck.slice(1 + n)],
      }],
    })
    expect(dealPlayerDamage(stack(5), 1, null)[0].pending, 'the sixth damage should still offer').not.toBeNull()
    const [t, events] = dealPlayerDamage(stack(6), 1, null)
    expect(t.players[1].damageZone.length, 'the fixture did not reach seven').toBe(7)
    expect(events.some((e) => e.type.startsWith('exBurst')), 'a lethal damage offered a burst').toBe(false)
    expect(t.pending, 'a lethal damage left an offer on the table').toBeNull()
    // ...and the game really does end. Without this the reason given above — "because the game is over" — was
    // unproven: the assertions hold on any build where the seventh damage quietly fails to end anything.
    expect(runRuleProcesses(t)[0].result, 'the seventh damage did not end the game').not.toBeNull()
    void id
  })

  it('a game that ends while an offer is outstanding clears it (G3, found in code review)', () => {
    // The offer is raised when the VICTIM survives, which says nothing about the OTHER player. P0 already at
    // seven, P1 below it and dealt an EX card: `dealPlayerDamage` offers P1 the burst, then `runRuleProcesses`
    // ends the game because P0 is at seven — and `stopped` used to clear only `resolution`, leaving a finished
    // game with a decision nobody could answer, which `checkInvariants` forbids.
    //
    // The attack path happened to clear it a moment later in `finishDamageStep`, so no game-level test could
    // see it. This calls `runRuleProcesses` directly, which is the only place the invalid state was visible.
    const [base] = withTopCard([makeDef({ code: 'V-EX', exBurst: true, hasAbilities: true, abilities: [EX_ABILITY] })], 'V-EX')
    // The cards MOVE, they are not copied. Slicing into `damageZone` while leaving them in `deck` builds a
    // state where the same card is in two zones, and `checkInvariants` says so — which is the check working.
    const doomed: GameState = {
      ...base,
      players: [
        { ...base.players[0], damageZone: base.players[0].deck.slice(0, 7), deck: base.players[0].deck.slice(7) },
        base.players[1],
      ],
    }
    const [damaged] = dealPlayerDamage(doomed, 1, null)
    expect(damaged.pending?.kind, 'the fixture never raised an offer').toBe('chooseExBurst')
    const [after] = runRuleProcesses(damaged)
    expect(after.result, 'the fixture did not end the game').not.toBeNull()
    expect(after.pending, 'a finished game kept an offer nobody could answer').toBeNull()
    expect(checkInvariants(after)).toEqual([])
  })

  it('a used burst goes to the FRONT of the agenda, ahead of the attacker’s damage triggers (G3)', () => {
    // `dealPlayerDamage` has already queued the attacker's `dealtDamage` clauses by the time the offer is
    // answered, and the agenda is FIFO. An EX Burst resolves immediately and unrespondably, so appending it
    // would let the attacker's trigger run first and see a board the burst was supposed to have changed.
    //
    // Asserted structurally rather than through a game, because a corpus does not catch it: the queue is
    // usually EMPTY when a burst is queued, so append and unshift agree and the mutation survives every
    // aggregate. This is the position where they differ.
    const [base, id] = withTopCard([makeDef({ code: 'V-EX', exBurst: true, hasAbilities: true, abilities: [EX_ABILITY] })], 'V-EX')
    const decoy: Frame = {
      abilityId: 'V-OTHER:dealt', source: 1, controller: 0,
      path: [], chosen: [], modes: [], triggerEvent: null,
    }
    const [damaged] = dealPlayerDamage(base, 1, null)
    const withTrigger: GameState = { ...damaged, resolution: { ...damaged.resolution, queue: [decoy] } }
    expect(withTrigger.pending?.kind, 'the fixture never raised an offer').toBe('chooseExBurst')

    // Rung J1-D11: the burst is the ACTIVE frame at once — never queued, never placed on the stack — so the
    // attacker's trigger (still in the triggered list) cannot be placed before it has finished.
    const [used] = applyChooseExBurst(withTrigger, 1, true)
    expect(used.resolution.active?.abilityId, 'the burst is not the frame running').toBe('V-EX:etb')
    expect(used.resolution.active?.origin, 'the burst frame is not marked as one').toBe('exBurst')
    expect(used.resolution.queue.map((f) => f.abilityId), 'the attacker’s trigger was disturbed').toEqual(['V-OTHER:dealt'])

    // And declining runs nothing at all — the decoy is left exactly as it was.
    const [declined] = applyChooseExBurst(withTrigger, 1, false)
    expect(declined.resolution.active).toBeNull()
    expect(declined.resolution.queue.map((f) => f.abilityId)).toEqual(['V-OTHER:dealt'])
    expect(declined.pending, 'declining left the offer on the table').toBeNull()
    void id
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
