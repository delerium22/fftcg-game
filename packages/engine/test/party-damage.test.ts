import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Ability } from '../src/abilities.js'
import type { CardDef, CardType, PlayerId } from '../src/types.js'
import type { CardId, GameState, PlayerState } from '../src/state.js'
import type { Command } from '../src/commands.js'
import type { Event } from '../src/events.js'
import { findFieldCard } from '../src/state.js'
import { apply } from '../src/apply.js'
import { checkInvariants } from '../src/invariants.js'
import { targetCandidates } from '../src/resolve.js'
import { viewFor } from '../src/view.js'
import { determinise } from '../src/determinise.js'
import { seedRng } from '../src/rng.js'
import { makeDef, makeGame, VANILLA_POOL, withField, withHand } from './helpers.js'

/**
 * Rung C2 stage 2: player-damage attribution across a party (spec C2-8), `TargetFilter.types` (spec C2-9) and the
 * full Luso cascade (spec C2-A8). Acceptance C2-A6, C2-A7, C2-A8.
 *
 * As in `observer-triggers.test.ts`, the ASTs below MIRROR `packages/cards/src/abilities.ts` and the printed text
 * is read out of the machine-owned `packages/cards/data/cards.json` — data, not a module, because the dependency
 * runs `@fftcg/cards` → `@fftcg/engine` and never the reverse. What pins the SHIPPED ASTs to these cards is
 * `packages/cards/test/abilities.test.ts`; what this file pins is that the engine resolves this shape correctly.
 */

const CARDS = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'cards', 'data', 'cards.json'), 'utf8')) as CardDef[]
const printed = (code: string): CardDef => {
  const def = CARDS.find((d) => d.code === code)
  if (!def) throw new Error(`cards.json has no ${code}`)
  return def
}

const CHARACTER: readonly CardType[] = ['forward', 'backup', 'monster']

const LUSO_DAMAGES_FORWARD: Ability = {
  id: '27-125S:damages-forward',
  trigger: { kind: 'dealtDamage', to: 'forward', whose: 'any' },
  text: 'When Luso deals damage to a Forward, break it.',
  effects: [{ kind: 'onSubject', do: [{ kind: 'breakCard' }] }],
}
const LUSO_DAMAGES_OPPONENT: Ability = {
  id: '27-125S:damages-opponent',
  trigger: { kind: 'dealtDamage', to: 'player', whose: 'opponent' },
  text: 'When Luso deals damage to your opponent, select up to 2 of the 2 following actions. '
    + '"Choose 1 Forward. Deal it 3000 damage." "Choose 1 Character in your Break Zone. Add it to your hand."',
  effects: [{
    kind: 'chooseModes', min: 0, max: 2,
    modes: [
      { label: 'Choose 1 Forward. Deal it 3000 damage.', effects: [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'any' }, then: [{ kind: 'damage', amount: 3000 }] }] },
      { label: 'Choose 1 Character in your Break Zone. Add it to your hand.', effects: [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'breakZone', controller: 'self', filter: { types: CHARACTER } }, then: [{ kind: 'moveToHand' }] }] },
    ],
  }],
}
const PRISHE_DAMAGES_OPPONENT: Ability = {
  id: '22-068R:damages-opponent',
  trigger: { kind: 'dealtDamage', to: 'player', whose: 'opponent' },
  text: 'When Prishe deals damage to your opponent, choose 1 Character in your Break Zone. Add it to your hand.',
  effects: [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'breakZone', controller: 'self', filter: { types: CHARACTER } }, then: [{ kind: 'moveToHand' }] }],
}
const LIGHTNING_ETB: Ability = {
  id: '27-127S:etb',
  trigger: { kind: 'enterField' },
  text: 'EX BURST When Lightning enters the field, choose 1 Forward of cost 4 or less opponent controls. Break it.',
  effects: [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'opponent', filter: { maxCost: 4 } }, then: [{ kind: 'breakCard' }] }],
}
const LIGHTNING_OPPONENT_BROKEN: Ability = {
  id: '27-127S:opponent-forward-broken',
  trigger: { kind: 'observesZoneChange', from: 'field', to: 'breakZone', whose: 'opponent', of: 'forward' },
  text: 'When a Forward opponent controls is put from the field into the Break Zone, choose 1 Forward you control. It gains Haste until the end of the turn.',
  effects: [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'self' }, then: [{ kind: 'grantKeyword', keyword: 'haste' }] }],
}

const LUSO: CardDef = { ...printed('27-125S'), abilityClauses: 2, abilities: [LUSO_DAMAGES_FORWARD, LUSO_DAMAGES_OPPONENT] }
const PRISHE: CardDef = { ...printed('22-068R'), abilityClauses: 2, abilities: [PRISHE_DAMAGES_OPPONENT] }
const LIGHTNING: CardDef = { ...printed('27-127S'), abilityClauses: 2, abilities: [LIGHTNING_ETB, LIGHTNING_OPPONENT_BROKEN] }
/** A Monster, so "1 Character" is tested against all three Character types and not just two (spec C2-9). */
const MONSTER = makeDef({ code: 'T-MON', type: 'monster', cost: 2, power: 4000 })

const BURN_AND_RETRIEVE = '27-125S:damages-opponent'
const BREAK_IT = '27-125S:damages-forward'
const RETRIEVE = '22-068R:damages-opponent'
const HASTE = '27-127S:opponent-forward-broken'

const fc = (s: GameState, id: CardId) => findFieldCard(s, id)?.card
const ok = (s: GameState) => expect(checkInvariants(s)).toEqual([])
const triggers = (events: readonly Event[], abilityId: string) =>
  events.filter((e) => e.type === 'abilityTriggered' && e.abilityId === abilityId)
const at = (events: readonly Event[], p: (e: Event) => boolean) => events.findIndex(p)

/**
 * Mint an instance straight into the Break Zone. `helpers.ts` has no such helper and belongs to stage 1, so this
 * is local: `withHand` mints the instance and the card is moved on from there.
 */
function withBreak(state: GameState, p: PlayerId, code: string): [GameState, CardId] {
  const [minted, id] = withHand(state, p, code)
  const ps = minted.players[p]
  const players: [PlayerState, PlayerState] = [minted.players[0], minted.players[1]]
  players[p] = { ...ps, hand: ps.hand.filter((x) => x !== id), breakZone: [...ps.breakZone, id] }
  return [{ ...minted, players }, id]
}

/** P0 attacks with `attackers` and P1 declines to block, so §10.1.4.1 player damage lands. */
function attackUnblocked(state: GameState, attackers: CardId[]) {
  let s = apply(state, { type: 'pass', player: 0 }).state          // §10.1.1–2 into the declaration step
  s = apply(s, { type: 'declareAttack', player: 0, attackers }).state
  return apply(s, { type: 'declareBlock', player: 1, blocker: null })
}

// ---------------------------------------------------------------------------
// C2-A6 — party attribution is by membership, not array position
// ---------------------------------------------------------------------------

describe('C2-A6: a Luso in an unblocked PARTY triggers wherever it sits in field order (spec C2-8)', () => {
  /**
   * `applyDeclareAttack` sorts the party by card id, and `withField` mints ids in creation order — so building
   * Luso first vs second is exactly the difference between `at.attackers[0] === luso` and `!== luso`. The old
   * `dealPlayerDamage(s, defender, at.attackers[0])` was silently position-dependent in precisely this way.
   */
  function partyOf(lusoFirst: boolean) {
    let s = makeGame({ defs: [...VANILLA_POOL, LUSO] })
    let luso: CardId, mate: CardId
    if (lusoFirst) {
      ;[s, luso] = withField(s, 0, 'forwards', '27-125S')   // earth 3000
      ;[s, mate] = withField(s, 0, 'forwards', 'V-F2')      // earth 5000 — a party needs a shared element (§10.1.2.1)
    } else {
      ;[s, mate] = withField(s, 0, 'forwards', 'V-F2')
      ;[s, luso] = withField(s, 0, 'forwards', '27-125S')
    }
    return { r: attackUnblocked(s, [luso, mate]), luso, mate }
  }

  for (const lusoFirst of [true, false]) {
    it(`triggers with Luso ${lusoFirst ? 'first' : 'second'} in the attacker array`, () => {
      const { r, luso, mate } = partyOf(lusoFirst)
      expect(r.state.attack?.attackers ?? []).toEqual([])                             // the attack is over
      expect(triggers(r.events, BURN_AND_RETRIEVE))
        .toEqual([{ type: 'abilityTriggered', player: 0, card: luso, abilityId: BURN_AND_RETRIEVE }])
      expect(r.state.pending?.kind).toBe('chooseMode')
      // The frame names Luso as the source even though the party as a whole dealt the damage…
      expect(r.state.resolution.active?.triggerEvent)
        .toEqual({ kind: 'damage', source: luso, sourceController: 0, target: null, victim: 1, amount: 1 })
      // …and the party still causes exactly ONE point of damage, not one per member.
      expect(r.state.players[1].damageZone).toHaveLength(1)
      expect(fc(r.state, mate)).toBeDefined()
      ok(r.state)
    })
  }

  it('two Lusos in one party are two separate occurrences, one frame each', () => {
    let s = makeGame({ defs: [...VANILLA_POOL, LUSO] })
    let a: CardId, b: CardId
    ;[s, a] = withField(s, 0, 'forwards', '27-125S')
    ;[s, b] = withField(s, 0, 'forwards', '27-125S')
    const r = attackUnblocked(s, [a, b])
    expect(r.state.resolution.active?.source).toBe(a)
    expect(r.state.resolution.queue.map((f) => [f.abilityId, f.source])).toEqual([[BURN_AND_RETRIEVE, b]])
    expect(r.state.players[1].damageZone).toHaveLength(1)
    ok(r.state)
  })
})

// ---------------------------------------------------------------------------
// C2-A7 — "1 Character" is Forward, Backup or Monster, never Summon
// ---------------------------------------------------------------------------

describe('C2-A7: TargetFilter.types selects Characters out of the Break Zone (spec C2-9)', () => {
  function prisheAfterDamage(codes: string[]) {
    let s = makeGame({ defs: [...VANILLA_POOL, PRISHE, MONSTER] })
    let prishe: CardId
    ;[s, prishe] = withField(s, 0, 'forwards', '22-068R')   // earth 5000
    const buried: CardId[] = []
    for (const code of codes) { let id: CardId; [s, id] = withBreak(s, 0, code); buried.push(id) }
    let theirs: CardId
    ;[s, theirs] = withBreak(s, 1, 'V-F2')                  // "your Break Zone" — never the opponent's
    return { r: attackUnblocked(s, [prishe]), prishe, buried, theirs }
  }

  it('a Forward, a Backup and a Monster are candidates; a Summon in the same Break Zone is not', () => {
    const { r, buried, theirs } = prisheAfterDamage(['V-F2', 'V-S1', 'V-B1', 'T-MON'])
    const [forward, summon, backup, monster] = buried as [CardId, CardId, CardId, CardId]
    expect(triggers(r.events, RETRIEVE)).toHaveLength(1)
    expect(r.state.pending).toEqual({ kind: 'chooseTargets', player: 0, min: 1, max: 1, candidates: [forward, backup, monster] })
    expect(r.state.pending?.kind === 'chooseTargets' && r.state.pending.candidates.includes(summon)).toBe(false)
    expect(r.state.pending?.kind === 'chooseTargets' && r.state.pending.candidates.includes(theirs)).toBe(false)

    const t = apply(r.state, { type: 'chooseTargets', player: 0, targets: [backup] })
    expect(t.state.players[0].hand).toContain(backup)
    expect(t.state.players[0].breakZone).toEqual([forward, summon, monster])
    expect(t.state.pending).toBeNull()
    ok(t.state)
  })

  it('a Break Zone holding nothing but Summons is a logged no-op (spec C1-7)', () => {
    const { r } = prisheAfterDamage(['V-S1', 'V-S2'])
    expect(r.events).toContainEqual({ type: 'abilityNoLegalTarget', card: r.state.players[0].forwards[0]?.id as CardId, abilityId: RETRIEVE })
    expect(r.state.pending).toBeNull()
    ok(r.state)
  })

  it('`types` and `type` conjoin rather than override each other', () => {
    // Nothing in the pool prints both, but the filter is a record and a future clause could set both; a Summon
    // must not slip through by matching `type` while failing `types`.
    let s = makeGame({ defs: [...VANILLA_POOL, MONSTER] })
    let forward: CardId, summon: CardId, monster: CardId
    ;[s, forward] = withBreak(s, 0, 'V-F2')
    ;[s, summon] = withBreak(s, 0, 'V-S1')
    ;[s, monster] = withBreak(s, 0, 'T-MON')
    const from = { zone: 'breakZone', controller: 'self' } as const
    expect(targetCandidates(s, forward, 0, { ...from, filter: { types: CHARACTER } })).toEqual([forward, monster])
    expect(targetCandidates(s, forward, 0, { ...from, filter: { type: 'summon', types: CHARACTER } })).toEqual([])
    expect(targetCandidates(s, forward, 0, { ...from, filter: { type: 'forward', types: CHARACTER } })).toEqual([forward])
    expect(targetCandidates(s, forward, 0, { ...from })).toEqual([forward, summon, monster])
  })
})

// ---------------------------------------------------------------------------
// C2-A8 — the full cascade
// ---------------------------------------------------------------------------

describe('C2-A8: Luso player-damage → modal 3000 → Luso’s own break trigger → Lightning’s Haste', () => {
  /**
   * Four clause resolutions chained through three prompts. The victim has EXACTLY 3000 power, so the 3000 damage
   * is lethal and §12.4.5 — running between frames (spec C2-6) — is what actually puts it into the Break Zone.
   * That matters twice over: Luso's own `breakCard` then finds nothing (the C2-A5 lethal path), and only the RULE
   * PROCESS produces a `ZoneTransition`, which is what Lightning watches.
   */
  function cascade() {
    let s = makeGame({ defs: [...VANILLA_POOL, LUSO, LIGHTNING] })
    let luso: CardId, lightning: CardId, victim: CardId, backup: CardId, summon: CardId
    ;[s, luso] = withField(s, 0, 'forwards', '27-125S')       // earth 3000, the attacker
    ;[s, lightning] = withField(s, 0, 'forwards', '27-127S')  // 9000, watching for an opponent Forward to break
    ;[s, victim] = withField(s, 1, 'forwards', 'V-F1')        // 3000 power — 3000 damage is exactly lethal
    ;[s, backup] = withBreak(s, 0, 'V-B1')
    ;[s, summon] = withBreak(s, 0, 'V-S1')
    return { s, luso, lightning, victim, backup, summon }
  }

  it('resolves through its prompts, terminates, is narrated, and never resets resolution.steps', () => {
    const { s, luso, lightning, victim, backup, summon } = cascade()
    const events: Event[] = []
    const steps: number[] = []

    // 1. The attack lands one point of player damage; Luso's second clause raises the mode choice.
    let r = attackUnblocked(s, [luso])
    events.push(...r.events); steps.push(r.state.resolution.steps)
    expect(r.state.pending).toEqual({
      kind: 'chooseMode', player: 0, min: 0, max: 2,
      labels: ['Choose 1 Forward. Deal it 3000 damage.', 'Choose 1 Character in your Break Zone. Add it to your hand.'],
    })
    ok(r.state)

    // 2. Both modes, resolving in printed order: burn first, retrieve second.
    r = apply(r.state, { type: 'chooseMode', player: 0, modes: [0, 1] })
    events.push(...r.events); steps.push(r.state.resolution.steps)
    expect(r.state.pending).toEqual({ kind: 'chooseTargets', player: 0, min: 1, max: 1, candidates: [luso, lightning, victim] })

    // 3. 3000 onto the 3000-power Forward. The frame is atomic, so nothing breaks yet…
    r = apply(r.state, { type: 'chooseTargets', player: 0, targets: [victim] })
    events.push(...r.events); steps.push(r.state.resolution.steps)
    expect(fc(r.state, victim)?.damage, 'no rule process may run mid-frame').toBe(3000)
    expect(r.state.resolution.queue.map((f) => f.abilityId), 'Luso’s own c1 queues behind the frame that fed it').toEqual([BREAK_IT])
    // …and mode 2's prompt is the SAME frame's second choice, with the Summon filtered out.
    expect(r.state.pending).toEqual({ kind: 'chooseTargets', player: 0, min: 1, max: 1, candidates: [backup] })
    ok(r.state)

    // 4. Retrieve the Backup. Frame over ⇒ §12.4.5 runs, breaks the victim, and Lightning sees the transition.
    r = apply(r.state, { type: 'chooseTargets', player: 0, targets: [backup] })
    events.push(...r.events); steps.push(r.state.resolution.steps)
    expect(r.state.players[0].hand).toContain(backup)
    expect(r.state.players[0].breakZone).toEqual([summon])
    expect(r.state.pending).toEqual({ kind: 'chooseTargets', player: 0, min: 1, max: 1, candidates: [luso, lightning] })
    ok(r.state)

    // 5. Haste, and the cascade is done.
    r = apply(r.state, { type: 'chooseTargets', player: 0, targets: [lightning] })
    events.push(...r.events)
    expect(fc(r.state, lightning)?.granted).toEqual(['haste'])
    expect(r.state.pending).toBeNull()
    expect(r.state.resolution.active).toBeNull()
    expect(r.state.resolution.queue).toEqual([])
    expect(r.state.resolution.steps, 'settle resets the budget only once everything is quiet').toBe(0)
    ok(r.state)

    // Narration, in order: the four clause resolutions and the §12.4.5 break between the second and the third.
    expect(events.filter((e) => e.type === 'abilityTriggered').map((e) => e.abilityId))
      .toEqual([BURN_AND_RETRIEVE, BREAK_IT, HASTE])
    expect(at(events, (e) => e.type === 'playerDamaged'))
      .toBeLessThan(at(events, (e) => e.type === 'abilityTriggered' && e.abilityId === BURN_AND_RETRIEVE))
    expect(at(events, (e) => e.type === 'broken' && e.card === victim))
      .toBeLessThan(at(events, (e) => e.type === 'abilityTriggered' && e.abilityId === BREAK_IT))
    // Lethal damage ⇒ §12.4.5 did the breaking and Luso's `breakCard` found nothing (spec C2-A5).
    expect(events.some((e) => e.type === 'brokenByAbility')).toBe(false)
    expect(r.state.players[1].breakZone).toContain(victim)

    // Spec C1-5: the budget PERSISTS across every prompt in the cascade. Reset it per drain and a rule-process ⇄
    // trigger cycle would restart the count every pass and never hit the cap.
    expect(steps.every((n, i) => n > 0 && n >= (steps[i - 1] ?? 0)), `steps must never fall mid-cascade: ${steps.join(',')}`).toBe(true)
  })

  it('taking neither mode ends the cascade immediately', () => {
    const { s, luso, victim } = cascade()
    const r = apply(attackUnblocked(s, [luso]).state, { type: 'chooseMode', player: 0, modes: [] })
    expect(r.state.pending).toBeNull()
    expect(r.state.resolution.queue).toEqual([])
    expect(fc(r.state, victim)?.damage).toBe(0)
    expect(r.events.some((e) => e.type === 'abilityTriggered' && e.abilityId !== BURN_AND_RETRIEVE)).toBe(false)
    ok(r.state)
  })
})

// ---------------------------------------------------------------------------
// Determinisation equivalence for a DAMAGE-triggered clause (spec C2-A12)
// ---------------------------------------------------------------------------

describe('a live state and its DETERMINISATION resolve a player-damage trigger identically (spec C2-A12)', () => {
  it('same states, events, pending and resolution queue', () => {
    // `observer-triggers.test.ts` pins the zone-change half; C2-A12 asks for both. This is the half that rides on
    // `at.attackers` — hit order comes from the party, and `determinise` has to reproduce it exactly.
    let s = makeGame({ defs: [...VANILLA_POOL, LUSO] })
    let a: CardId, b: CardId, theirs: CardId
    ;[s, a] = withField(s, 0, 'forwards', '27-125S')
    ;[s, b] = withField(s, 0, 'forwards', '27-125S')
    ;[s, theirs] = withField(s, 1, 'forwards', 'V-F8')
    s = attackUnblocked(s, [a, b]).state
    expect(s.pending?.kind).toBe('chooseMode')
    expect(s.resolution.queue).toHaveLength(1)   // the second Luso's occurrence, still queued

    // Derived from the state, not DEFAULT_DECK: withField/withBreak MINT instances, so the declared lists must
    // account for them or `determinise` rejects a visible card it cannot place.
    const decks = ([0, 1] as const).map((p) => {
      const q = s.players[p]
      return [...q.deck, ...q.hand, ...q.forwards.map((c) => c.id), ...q.backups.map((c) => c.id), ...q.damageZone, ...q.breakZone]
        .map((id) => s.cards[id]!.code)
    }) as [string[], string[]]
    const [det] = determinise({ view: viewFor(s, 0), decks, rng: seedRng(1) })
    const before = JSON.stringify(det)

    const answer: Command = { type: 'chooseMode', player: 0, modes: [0] }
    const live = apply(s, answer)
    const sim = apply(det, answer)

    expect(live.state.pending).toEqual({ kind: 'chooseTargets', player: 0, min: 1, max: 1, candidates: [a, b, theirs] })
    expect(sim.events).toEqual(live.events)
    expect(sim.state.pending).toEqual(live.state.pending)
    expect(sim.state.resolution).toEqual(live.state.resolution)
    for (const p of [0, 1] as const) {
      expect(sim.state.players[p].forwards).toEqual(live.state.players[p].forwards)
      expect(sim.state.players[p].breakZone).toEqual(live.state.players[p].breakZone)
    }
    expect(JSON.stringify(det), 'apply must not mutate its input').toBe(before)
  })
})
