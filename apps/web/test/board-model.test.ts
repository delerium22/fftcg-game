import { describe, expect, it } from 'vitest'
import { GreedyAgent } from '@fftcg/ai'
import { actingPlayer, createGame, viewFor, type GameState, type PlayerView } from '@fftcg/engine'
import { CARD_DEFS, DECK_CHOICES } from '../src/deck.js'
import { displayName, fieldCardDisplay, stateShim } from '../src/game/commands.js'
import { project, type BoardModel } from '../src/game/presentation/boardModel.js'
import { AI, HUMAN } from '../src/game/types.js'
import { stepAi } from '../src/game/useGame.js'

const game = (seed: number): GameState => createGame({
  seed, defs: CARD_DEFS,
  decks: [DECK_CHOICES.vol2.main, DECK_CHOICES.vol1.main],
  lbDecks: [DECK_CHOICES.vol2.lb, DECK_CHOICES.vol1.lb],
})

/** Every human view along a Greedy-vs-Greedy game, up to `max` steps. */
function* views(seed: number, max = 400): Generator<PlayerView> {
  const decks: [string[], string[]] = [DECK_CHOICES.vol2.main, DECK_CHOICES.vol1.main]
  const agents = [new GreedyAgent({ seed, decks, depth: 1 }), new GreedyAgent({ seed: seed + 1, decks, depth: 1 })] as const
  let s = game(seed)
  for (let i = 0; i < max && !s.result; i++) {
    yield viewFor(s, HUMAN)
    const p = actingPlayer(s)
    if (p === null) break
    s = stepAi(s, agents[p]).state
  }
  yield viewFor(s, HUMAN)
}

/** The spec's well-formedness invariants (section 4.3), for one model against the view it came from. */
function expectWellFormed(v: PlayerView, m: BoardModel): void {
  const visible = new Set(Object.keys(v.cards).map(Number))
  // No hidden id (Review Focus 2), and every visible id has exactly one record (Review Focus 1).
  expect(new Set(Object.keys(m.cards).map(Number))).toEqual(visible)
  const listed: number[] = [...m.hand, ...m.seats.flatMap((s) => [...s.forwards, ...s.backups, ...s.lbDeck, ...s.knownHand, ...s.breakZone, ...s.damageZone, ...s.removedFromGame])]
  expect(new Set(listed).size).toBe(listed.length)
  for (const id of listed) expect(m.cards[id]?.zone).not.toBe('elsewhere')
  // Every listed id's record says where it is: whose side, which zone, which position (U2a review minor, carried to U2b).
  m.hand.forEach((id, i) => expect(m.cards[id], `hand card ${id}`).toMatchObject({ side: v.me, zone: 'hand', index: i }))
  for (const p of [0, 1] as const) {
    for (const zone of ['forwards', 'backups', 'lbDeck', 'knownHand', 'breakZone', 'damageZone', 'removedFromGame'] as const) {
      m.seats[p][zone].forEach((id, i) => expect(m.cards[id], `${zone} card ${id}`).toMatchObject({ side: p, zone, index: i }))
    }
  }
  for (const p of [0, 1] as const) {
    const f = v.fields[p]
    const seat = m.seats[p]
    expect(seat.forwards).toEqual(f.forwards.map((c) => c.id))
    expect(seat.backups).toEqual(f.backups.map((c) => c.id))
    expect(seat.lbDeck).toEqual(f.lbDeck.map((x) => x.id))
    expect(seat.knownHand).toEqual(f.knownHand)
    expect(seat.breakZone).toEqual(f.breakZone)
    expect(seat.damageZone).toEqual(f.damageZone)
    expect(seat.removedFromGame).toEqual(f.removedFromGame)
    expect(seat.deckCount).toBe(f.deck.length)
    expect(seat.handCount).toBe(p === v.me ? v.hand.length : f.handCount)
    for (const x of f.lbDeck) expect(m.cards[x.id]?.lbFaceUp, 'LB face (Review Focus 5)').toBe(x.faceUp)
    for (const id of f.knownHand) expect(m.cards[id]).toMatchObject({ side: AI, zone: 'knownHand' })
  }
  expect(m.hand).toEqual(v.hand)
}

describe('project (spec section 4.1)', () => {
  it('keys the same ability on the stack twice apart, so U3 can diff the stack (spec section 4.3)', () => {
    const v0 = viewFor(game(1), HUMAN)
    const source = Number(Object.keys(v0.cards)[0])
    expect(v0.cards[source], 'a visible card to be the source').toBeDefined()
    const frame = { abilityId: 'twice', source, controller: HUMAN, path: [], chosen: [], triggerEvent: null, modes: [] }
    const v: PlayerView = { ...v0, stack: [{ kind: 'ability', frame }, { kind: 'ability', frame }] }
    expect(project(v).stack.map((e) => e.key)).toEqual([`a:${source}:twice`, `a:${source}:twice#1`])
  })

  it('projects the opening position', () => {
    const v = viewFor(game(1), HUMAN)
    const m = project(v)
    expectWellFormed(v, m)
    expect(m.turn).toBe(v.turn)
    expect(m.phase).toBe(v.phase)
    expect(m.result).toBeNull()
  })

  it('holds the invariants, the names and the layered power over a self-play corpus (Review Focus 1-5)', () => {
    let positions = 0
    // What the corpus must reach, or the assertions below prove nothing about it (plan review finding 2).
    const saw = { pumped: false, knownHand: false, lbFaceUp: false, elsewhere: false, breakZone: false, damageZone: false, removedFromGame: false, stack: false }
    for (const seed of [1, 2, 3, 4]) {
      for (const v of views(seed)) {
        const m = project(v)
        expectWellFormed(v, m)
        const shim = stateShim(v)
        for (const [id, rec] of Object.entries(m.cards)) expect(rec.face.name, `name of ${id}`).toBe(displayName(v, Number(id)))
        for (const p of [0, 1] as const) {
          for (const c of [...v.fields[p].forwards, ...v.fields[p].backups]) {
            const shown = fieldCardDisplay(v, c, shim)
            expect(m.cards[c.id]?.face).toMatchObject({ power: shown.power, powerBonus: shown.powerBonus, damage: c.damage, dull: c.status === 'dull', frozen: c.frozen === true })
            expect(m.cards[c.id]?.face.granted).toEqual(shown.granted)
            expect(m.cards[c.id]?.face.flags).toEqual(shown.flags)
          }
        }
        expect(m.active).toEqual([v.priority === HUMAN || v.pending?.player === HUMAN, v.priority === AI || v.pending?.player === AI])
        expect(m.stack.map((e) => e.card)).toEqual(v.stack.map((i) => (i.kind === 'summon' ? i.card : i.frame.source)))
        expect(new Set(m.stack.map((e) => e.key)).size).toBe(m.stack.length)
        expect(m).toMatchObject({ turnPlayer: v.turnPlayer, priority: v.priority, pending: v.pending ? { kind: v.pending.kind, player: v.pending.player } : null })
        const recs = Object.values(m.cards)
        if (recs.some((r) => (r.face.powerBonus ?? 0) !== 0)) saw.pumped = true
        if (recs.some((r) => r.zone === 'knownHand')) saw.knownHand = true
        if (recs.some((r) => r.lbFaceUp === true)) saw.lbFaceUp = true
        if (recs.some((r) => r.zone === 'elsewhere')) saw.elsewhere = true
        if (recs.some((r) => r.zone === 'breakZone')) saw.breakZone = true
        if (recs.some((r) => r.zone === 'damageZone')) saw.damageZone = true
        if (recs.some((r) => r.zone === 'removedFromGame')) saw.removedFromGame = true
        if (m.stack.length > 0) saw.stack = true
        positions++
      }
    }
    expect(positions).toBeGreaterThan(200)
    for (const [what, reached] of Object.entries(saw)) expect(reached, `the corpus never reached: ${what}`).toBe(true)
  }, 30_000)
})
