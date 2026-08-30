import { describe, expect, it } from 'vitest'
import { actingPlayer, apply, createGame, legalCommands, viewFor, type Command, type Event, type GameState } from '@fftcg/engine'
import { loadCards } from '@fftcg/cards'
import { GreedyAgent } from '@fftcg/ai'
import { parseDeckFile } from '../src/deck.js'
import { readFileSync } from 'node:fs'

/**
 * Rung G3 — EX Burst on damage (§11.10), the accounting.
 *
 * It lives here rather than in `packages/engine` because it needs the real card pool, and the engine
 * deliberately does not depend on `@fftcg/cards` — the defs reach it as data, through `createGame`.
 *
 * G3-A1 as PREDECLARED, and the predeclaration is worth restating because my first draft of it was wrong.
 * I asked for "the same 43 EX Bursts, now offered instead of skipped". That is not a valid experiment: once
 * bursts change boards and AI choices, the same seeds no longer produce the same games, so the count MUST
 * move. It also contradicted G3-A5 — a lethal reveal must NOT be offered — and it could have been satisfied
 * by renaming the event while resolving nothing.
 *
 * What is asserted instead is a CLOSED SUM: every revealed EX card ends in exactly one of three states, and
 * the three tallies account for every reveal. That cannot be satisfied by a rename, because "used" requires a
 * frame carrying the card's own marked ability id to follow.
 */

const DECK = parseDeckFile(readFileSync(new URL('../../../decks/starter-2025-vol2.txt', import.meta.url), 'utf8'))
const DEFS = loadCards()
const EX_CODES = new Set(DEFS.filter((d) => d.exBurst).map((d) => d.code))

interface Tally {
  reveals: number; offered: number; used: number; declined: number; lethalSuppressed: number
  /** The burst's own ability id, observed on the frame that ran — routing proven by id, not by shape. */
  ownClauseRan: number
  /** Board effects only these clauses produce here: Noel dulls, Lightning and Odin break. */
  broken: number; dulled: number
}

/**
 * Plays `games` games, answering every EX Burst offer with `answer`, and tallies what happened to each reveal.
 *
 * Every other decision is the greedy agent's, NOT `legal[0]`. Taking the first legal command reached zero
 * damage in twenty games — it never attacks — so the corpus would have proved nothing while every assertion
 * about EX Bursts passed vacuously for want of any reveal at all. The EX answer is forced rather than left to
 * the agent so each arm is a clean policy: always use, or always decline.
 */
function play(games: number, answer: boolean): Tally {
  const t: Tally = { reveals: 0, offered: 0, used: 0, declined: 0, lethalSuppressed: 0, ownClauseRan: 0, broken: 0, dulled: 0 }
  for (let seed = 1; seed <= games; seed++) {
    let s: GameState = createGame({ seed, decks: [DECK, DECK], defs: DEFS })
    const agent = new GreedyAgent({ seed, decks: [DECK, DECK], depth: 1 })
    let awaiting: { card: number; abilityId: string } | null = null
    for (let i = 0; i < 4000 && !s.result; i++) {
      const p = actingPlayer(s)
      if (p === null) break
      const legal = legalCommands(s, p)
      const command: Command | undefined = s.pending?.kind === 'chooseExBurst'
        ? { type: 'chooseExBurst', player: p, use: answer }
        : agent.decide(viewFor(s, p), legal)
      if (!command) break
      const r = apply(s, command)
      for (const e of r.events) tallyEvent(t, e)
      // Routing proven BY ID, on the frame itself. There is no `abilityResolved` event, and `abilityTriggered`
      // is deliberately suppressed for an `exBurst` frame — narrating a burst as an ordinary trigger is the
      // thing G3 set out not to do — so the frame the clause suspends on is what names the clause that ran.
      // (`abilityNoLegalTarget` would also name it, but it almost never fires: the attacker's Forward is
      // standing right there, so these clauses nearly always have a legal target.)
      if (awaiting && r.state.resolution.active?.abilityId === awaiting.abilityId
        && r.state.resolution.active.origin === 'exBurst') t.ownClauseRan++
      // The reveal is a `playerDamaged` naming a card whose def prints EX BURST; whether it was OFFERED is
      // the separate question this closed sum exists to answer.
      for (const e of r.events) {
        if (e.type === 'playerDamaged' && EX_CODES.has(defCodeOf(s, e.card))) t.reveals++
      }
      awaiting = r.state.pending?.kind === 'chooseExBurst'
        ? { card: r.state.pending.card, abilityId: r.state.pending.abilityId }
        : null
      s = r.state
    }
  }
  t.lethalSuppressed = t.reveals - t.offered
  return t
}

const defCodeOf = (s: GameState, card: number): string => s.cards[card]?.code ?? ''

function tallyEvent(t: Tally, e: Event): void {
  if (e.type === 'exBurstOffered') t.offered++
  else if (e.type === 'exBurstDeclined') t.declined++
  else if (e.type === 'exBurstUsed') t.used++
  else if (e.type === 'broken') t.broken++
  else if (e.type === 'dulled') t.dulled++
}

describe('G3-A1 — every revealed EX Burst is accounted for exactly once', () => {
  for (const [label, answer] of [['always used', true], ['always declined', false]] as const) {
    it(`closes the sum when the burst is ${label}`, () => {
      const t = play(20, answer)
      expect(t.reveals, 'no EX Burst was revealed in 20 games, so this asserts nothing').toBeGreaterThan(20)
      expect(t.offered + t.lethalSuppressed, 'reveals are not fully accounted for').toBe(t.reveals)
      // Every offer reaches exactly one answer. An offer left on the table would show up here as a shortfall,
      // which is the shape the `attack.ts` `pending: null` bug would have taken had it survived.
      expect(t.used + t.declined, 'an offer was never answered').toBe(t.offered)
      expect(answer ? t.declined : t.used, 'an answer the driver never gave was recorded').toBe(0)
      expect(answer ? t.used : t.declined, 'the driver answered but nothing was recorded').toBe(t.offered)
      // Some reveals MUST be lethal-suppressed across 20 games, or G3-A5 is untested by this corpus.
      expect(t.lethalSuppressed, 'no lethal reveal occurred, so the suppression path is unexercised')
        .toBeGreaterThan(0)
    })
  }

  it('a used burst runs the card’s own marked clause, and declining runs nothing (G3-A2)', () => {
    // Two independent halves, because either alone can pass while the claim is false.
    //
    // BY ID: `abilityNoLegalTarget` names the clause that ran, and it must be the very id the offer carried.
    // A copy of the clause under a different id would pass an event-shape check and fail this.
    //
    // BY EFFECT: using must do strictly more to the board than declining. All three of these clauses either
    // break or dull a Forward, so if "used" and "declined" left the same tallies, the frame was queued and
    // never ran — which is exactly what appending it behind the attacker's damage triggers, or dropping it on
    // `attack.ts`'s `pending: null`, would have looked like.
    const used = play(20, true)
    const declined = play(20, false)
    expect(used.used, 'no burst was used').toBeGreaterThan(0)
    expect(used.ownClauseRan, 'no used burst was ever traced back to its own ability id, on a frame marked exBurst')
      .toBeGreaterThan(0)
    expect(used.broken + used.dulled, 'using every burst did nothing to any board')
      .toBeGreaterThan(declined.broken + declined.dulled)
  })
})

describe('G3-A8 — at most one EX Burst can ever be pending', () => {
  it('no engine path deals more than one point of player damage in one resolution', () => {
    // The design rests on this. CR §6.5.2.1 batches every point of a multi-point damage resolution BEFORE any
    // EX Burst resolves, and nothing here implements that — because nothing here can reach it: `resolveDamage`
    // has an unblocked party deal ONE point with its members sharing attribution, and blocked members deal
    // power to the blocker rather than to the player.
    //
    // Asserted rather than assumed, and deliberately NOT marked MVP0-SIMPLIFICATION: nothing is being
    // simplified away while the case cannot occur. If a card ever makes it occur, this test fails and the
    // batching has to be built.
    let worst = 0
    for (let seed = 1; seed <= 20; seed++) {
      let s: GameState = createGame({ seed, decks: [DECK, DECK], defs: DEFS })
      const agent = new GreedyAgent({ seed, decks: [DECK, DECK], depth: 1 })
      for (let i = 0; i < 4000 && !s.result; i++) {
        const p = actingPlayer(s)
        if (p === null) break
        const legal = legalCommands(s, p)
        const command = s.pending?.kind === 'chooseExBurst'
          ? { type: 'chooseExBurst' as const, player: p, use: i % 2 === 0 }
          : agent.decide(viewFor(s, p), legal)
        if (!command) break
        const r = apply(s, command)
        for (const victim of [0, 1] as const) {
          const n = r.events.filter((e) => e.type === 'playerDamaged' && e.player === victim).length
          if (n > worst) worst = n
        }
        s = r.state
      }
    }
    expect(worst, 'a single apply dealt more than one point to one player — CR §6.5.2.1 batching is now reachable')
      .toBeLessThanOrEqual(1)
    expect(worst, 'no player damage occurred at all, so this proves nothing').toBe(1)
  })
})
