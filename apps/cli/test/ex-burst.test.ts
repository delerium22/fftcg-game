import { describe, expect, it } from 'vitest'
import { actingPlayer, apply, checkInvariants, createGame, dealPlayerDamage, legalCommands, viewFor, type Command, type Event, type GameState } from '@fftcg/engine'
import { loadCards } from '@fftcg/cards'
import { GreedyAgent } from '@fftcg/ai'
import { selfPlay } from '../src/selfplay.js'
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
/** Each of these plays twenty to forty complete games; the 5 s default is nowhere near enough. */
const CORPUS_TIMEOUT = 120_000
const EX_CODES = new Set(DEFS.filter((d) => d.exBurst).map((d) => d.code))

interface Tally {
  reveals: number; offered: number; used: number; declined: number; lethalSuppressed: number
  /** The burst's own ability id, observed on the frame that ran — routing proven by id, not by shape. */
  ownClauseRan: number
  /** Board effects only these clauses produce here: Noel dulls, Lightning and Odin break. */
  broken: number; dulled: number
  /** Board effects that happened while a used burst's own frame was running (rung J1). */
  inBurst: number
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
  const t: Tally = { reveals: 0, offered: 0, used: 0, declined: 0, lethalSuppressed: 0, ownClauseRan: 0, broken: 0, dulled: 0, inBurst: 0 }
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
      // Effects while the burst itself runs: the apply that used it, and any answer to a prompt it raised.
      const burstRunning = (command.type === 'chooseExBurst' && command.use) || s.resolution.active?.origin === 'exBurst'
      if (burstRunning) t.inBurst += r.events.filter((e) => e.type === 'dulled' || e.type === 'brokenByAbility' || e.type === 'abilityDamage').length
      // Routing proven BY ID, on the frame itself. There is no `abilityResolved` event, and `abilityTriggered`
      // is deliberately suppressed for an `exBurst` frame — narrating a burst as an ordinary trigger is the
      // thing G3 set out not to do — so the frame the clause suspends on is what names the clause that ran.
      // (`abilityNoLegalTarget` would also name it, but it almost never fires: the attacker's Forward is
      // standing right there, so these clauses nearly always have a legal target.)
      if (awaiting && r.state.resolution.active?.abilityId === awaiting.abilityId
        && r.state.resolution.active.origin === 'exBurst') t.ownClauseRan++
      // ...or it ran and found nothing to choose. Rare, as the comment above says, but rung J1's forfeit
      // windows moved the corpus and two games reached it: the clause still ran, and the event names its id.
      else if (awaiting && r.events.some((e) => e.type === 'abilityNoLegalTarget' && e.abilityId === awaiting!.abilityId)) t.ownClauseRan++
      // Each reveal is classified AT THE REVEAL, from the state it produced — not by subtracting offers from
      // reveals afterwards. Deriving it was the defect a code review found: `lethalSuppressed = reveals -
      // offered` silently relabels every offer that went missing for any other reason as "suppressed", so the
      // sum closes by construction and the criterion cannot fail for the reason it names.
      for (const e of r.events) {
        if (e.type !== 'playerDamaged' || !EX_CODES.has(defCodeOf(s, e.card))) continue
        t.reveals++
        const lethal = r.state.players[e.player].damageZone.length >= 7 || r.state.result !== null
        if (lethal) {
          t.lethalSuppressed++
          expect(r.events.some((x) => x.type === 'exBurstOffered'),
            'a lethal reveal was offered anyway').toBe(false)
          expect(r.state.result, 'a seventh damage did not end the game').not.toBeNull()
        }
      }
      awaiting = r.state.pending?.kind === 'chooseExBurst'
        ? { card: r.state.pending.card, abilityId: r.state.pending.abilityId }
        : null
      s = r.state
    }
  }
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
      // Both terms are now MEASURED, so this can actually fail: an offer that never happened for some third
      // reason leaves the sum short instead of being quietly booked as suppressed.
      expect(t.offered + t.lethalSuppressed, 'reveals are not fully accounted for').toBe(t.reveals)
      // Every offer reaches exactly one answer. An offer left on the table would show up here as a shortfall,
      // which is the shape the `attack.ts` `pending: null` bug would have taken had it survived.
      expect(t.used + t.declined, 'an offer was never answered').toBe(t.offered)
      expect(answer ? t.declined : t.used, 'an answer the driver never gave was recorded').toBe(0)
      expect(answer ? t.used : t.declined, 'the driver answered but nothing was recorded').toBe(t.offered)
      // Some reveals MUST be lethal-suppressed across 20 games, or G3-A5 is untested by this corpus.
      expect(t.lethalSuppressed, 'no lethal reveal occurred, so the suppression path is unexercised')
        .toBeGreaterThan(0)
    }, CORPUS_TIMEOUT)
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
    // EVERY use, not merely one. `> 0` let some cards or some uses fail silently while the test passed, which
    // a code review pointed out; a used burst that never ran its clause is the whole defect this guards.
    expect(used.ownClauseRan, 'a burst was used whose own marked clause never ran')
      .toBe(used.used)
    // BY EFFECT: the bursts' own resolutions changed boards. Counted INSIDE the burst — the events of the
    // apply that used it and of the answers to its prompts, while its frame is the one running — rather than
    // as a difference between two whole corpora: rung J1's forfeit windows moved every trajectory, and two
    // corpora of different games can no longer be compared by their totals.
    expect(used.inBurst, 'using every burst did nothing to any board').toBeGreaterThan(0)
    expect(declined.inBurst, 'a declined burst changed a board').toBe(0)
  }, CORPUS_TIMEOUT)
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
      for (let i = 0; i < 6000 && !s.result; i++) {
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
  }, CORPUS_TIMEOUT)
})

describe('G3-A4 — an opted-in burst with no legal target settles instead of stranding', () => {
  it('Odin’s clause, opted into, finds nothing and the game carries on', () => {
    // Reached THROUGH the new command, which is the part that matters. Odin's no-target path already worked
    // from a normal cast, so asserting `abilityNoLegalTarget` alone would pass on behaviour that predates
    // this rung entirely.
    const odin = DEFS.find((d) => d.code === '13-072R')
    expect(odin?.exBurst, 'Odin is not the EX card this test assumes').toBe(true)

    let s: GameState = createGame({ seed: 4, decks: [DECK, DECK], defs: DEFS })
    // Odin on top of P1's deck, and no Forward anywhere for its clause to break.
    const odinId = Object.values(s.cards).find((c) => c.code === '13-072R' && c.owner === 1)?.id
    expect(odinId, 'no Odin in P1’s cards').toBeDefined()
    // Placed in the ATTACK phase, mid-damage-step, because that is the only place a burst arises — and
    // `applyChooseExBurst` finishes that step. A setup-phase fixture makes `checkInvariants` complain that an
    // attack state exists outside the attack phase, which is the invariant doing its job on a bad fixture.
    s = {
      ...s,
      phase: 'attack',
      turnPlayer: 0,
      attack: { step: 'damage', attackers: [], blocker: null },
      pending: null,
      players: [
        { ...s.players[0], forwards: [] },
        { ...s.players[1], forwards: [], deck: [odinId as number, ...s.players[1].deck.filter((c) => c !== odinId)] },
      ],
    }

    const [damaged] = dealPlayerDamage(s, 1, null)
    expect(damaged.pending, 'Odin on top did not raise an offer').toEqual({
      kind: 'chooseExBurst', player: 1, card: odinId, abilityId: '13-072R:summon',
    })

    const r = apply(damaged, { type: 'chooseExBurst', player: 1, use: true })
    expect(r.events.some((e) => e.type === 'abilityNoLegalTarget' && e.abilityId === '13-072R:summon'),
      'the opted-in clause did not report that it found nothing').toBe(true)
    expect(r.state.pending, 'the game is waiting on a target that cannot exist').toBeNull()
    expect(r.state.resolution.active, 'a frame was left suspended with nothing to choose').toBeNull()
    expect(checkInvariants(r.state)).toEqual([])
  })
})

describe('G3-A6/A7 — the agent decides, and the counters can fail', () => {
  it('a searching agent picks BOTH answers across a corpus, so neither is a default', () => {
    // `legalCommands` lists decline first precisely because a budget-starved rollout keeps candidate zero
    // without pricing the rest. If that degradation were the whole story the agent would never use a burst —
    // so seeing both answers chosen is what shows the decision is actually being scored.
    const r = selfPlay({
      games: 40, seed: 1, decks: [DECK, DECK], defs: DEFS,
      agents: [{ kind: 'greedy', depth: 1 }, { kind: 'greedy', depth: 1 }],
    })
    expect(r.exBurst.offered, 'no burst was offered in 40 greedy games').toBeGreaterThan(10)
    expect(r.exBurst.used, 'the agent never used a burst — decline is acting as a default').toBeGreaterThan(0)
    expect(r.exBurst.declined, 'the agent never declined a burst — use is acting as a default').toBeGreaterThan(0)
  }, CORPUS_TIMEOUT)

  it('every offer reaches exactly one answer (G3-A7)', () => {
    // The gate `unimplementedAbilities: 0` could not be: it counts a different event and stayed at zero
    // throughout the period when every EX Burst was being skipped. This one fails if an offer is ever left
    // unanswered, which is the exact shape of the `attack.ts` bug that erased the decision.
    const r = selfPlay({ games: 40, seed: 1, decks: [DECK, DECK], defs: DEFS })
    expect(r.exBurst.used + r.exBurst.declined, 'an offer was never answered').toBe(r.exBurst.offered)
    expect(r.completed, 'games failed, so the counters describe a broken corpus').toBe(40)
  }, CORPUS_TIMEOUT)
})
