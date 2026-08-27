import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Ability, Effect } from '../src/abilities.js'
import type { CardDef } from '../src/types.js'
import type { CardId, GameState } from '../src/state.js'
import type { Command } from '../src/commands.js'
import type { Event } from '../src/events.js'
import { findFieldCard } from '../src/state.js'
import { apply } from '../src/apply.js'
import { checkInvariants } from '../src/invariants.js'
import { viewFor } from '../src/view.js'
import { determinise } from '../src/determinise.js'
import { seedRng } from '../src/rng.js'
import { makeDef, makeGame, VANILLA_POOL, withField, withHand } from './helpers.js'

/**
 * Rung C2 stage 1: the observer-trigger machinery (spec C2-3/C2-4/C2-6/C2-7/C2-10/C2-11) and the three clauses
 * that need only it — Lightning `27-127S` ×2 and Luso `27-125S` c1 (spec C2-12).
 *
 * The machinery is exercised with SYNTHETIC defs, as C1's executor tests are: the engine is card-agnostic.
 * The clauses are exercised against the REAL printed text, read out of the machine-owned `packages/cards/data/
 * cards.json` — data, not a module, so this stays free of a package dependency the engine must not have
 * (`@fftcg/cards` depends on `@fftcg/engine`, never the reverse).
 *
 * The three ASTs below MIRROR `packages/cards/src/abilities.ts`. What pins the SHIPPED ASTs to these cards is
 * `packages/cards/test/abilities.test.ts`; what this file pins is that the engine resolves this shape the way
 * CR §§11.8/12.3–12.4.5 say it must.
 */

const CARDS = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'cards', 'data', 'cards.json'), 'utf8')) as CardDef[]
const printed = (code: string): CardDef => {
  const def = CARDS.find((d) => d.code === code)
  if (!def) throw new Error(`cards.json has no ${code}`)
  return def
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
const LUSO_DAMAGES_FORWARD: Ability = {
  id: '27-125S:damages-forward',
  trigger: { kind: 'dealtDamage', to: 'forward', whose: 'any' },
  text: 'When Luso deals damage to a Forward, break it.',
  effects: [{ kind: 'onSubject', do: [{ kind: 'breakCard' }] }],
}

const LIGHTNING: CardDef = { ...printed('27-127S'), abilityClauses: 2, abilities: [LIGHTNING_ETB, LIGHTNING_OPPONENT_BROKEN] }
const LUSO: CardDef = { ...printed('27-125S'), abilityClauses: 2, abilities: [LUSO_DAMAGES_FORWARD] }

const HASTE = '27-127S:opponent-forward-broken'
const BREAK_IT = '27-125S:damages-forward'

/**
 * A synthetic Summon that deals `amount` to EVERY Forward: the cheapest way to put several Forwards into one
 * simultaneous §12.4.5 batch through the public reducer, which is where watcher discovery has to be right.
 * Cost 0 so an empty payment is legal (§11.2.2.4) — these tests are about triggers, not about paying.
 */
const quake = (amount: number): CardDef => makeDef({
  code: 'T-QUAKE', type: 'summon', cost: 0, power: null, hasAbilities: true, abilityClauses: 1,
  text: 'synthetic: deal damage to all Forwards',
  abilities: [{
    id: 'T-QUAKE:summon', trigger: { kind: 'summonResolve' }, text: 'synthetic: deal damage to all Forwards',
    effects: [{ kind: 'forEach', from: { zone: 'forwards', controller: 'any' }, do: [{ kind: 'damage', amount }] }],
  }],
})

const fc = (s: GameState, id: CardId) => findFieldCard(s, id)?.card
const ok = (s: GameState) => expect(checkInvariants(s)).toEqual([])
const ids = (events: readonly Event[], abilityId: string) =>
  events.filter((e) => e.type === 'abilityTriggered' && e.abilityId === abilityId)
const at = (events: readonly Event[], p: (e: Event) => boolean) => events.findIndex(p)

/** Cast the quake from P0's hand through the public reducer, so `settle` owns the interleaving. */
function castQuake(s: GameState, cast: CardId) {
  return apply(s, { type: 'castSummon', player: 0, card: cast, payment: { dullBackups: [], discards: [] } })
}

// ---------------------------------------------------------------------------
// The printed text the ASTs claim to encode
// ---------------------------------------------------------------------------

describe('every clause quotes text its card really prints (spec C2-A1)', () => {
  it('Lightning 27-127S and Luso 27-125S', () => {
    for (const def of [LIGHTNING, LUSO]) {
      for (const ability of def.abilities ?? []) {
        expect(ability.id.startsWith(`${def.code}:`), ability.id).toBe(true)
        expect(def.text, ability.id).toContain(ability.text)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// C2-A2 — a watcher broken in the same batch as its own victim
// ---------------------------------------------------------------------------

describe('C2-A2: Lightning triggers when it is broken in the SAME batch as its victim (spec C2-4)', () => {
  /**
   * Watchers are snapshotted from the field arrays BEFORE the batch moves. Discover them afterwards and this
   * Lightning is already in the Break Zone, its clause unreachable, and the trigger silently lost.
   */
  function sameBatch() {
    let s = makeGame({ defs: [...VANILLA_POOL, LIGHTNING, quake(5000)] })
    let lightning: CardId, ally: CardId, victim: CardId, cast: CardId
    ;[s, lightning] = withField(s, 0, 'forwards', '27-127S', { damage: 4000 })   // 9000 power; 4000 + 5000 is lethal
    ;[s, ally] = withField(s, 0, 'forwards', 'V-F8')                             // 9000 power, survives the quake
    ;[s, victim] = withField(s, 1, 'forwards', 'V-F2')                           // 5000 power, dies in the same batch
    ;[s, cast] = withHand(s, 0, 'T-QUAKE')
    return { r: castQuake(s, cast), lightning, ally, victim }
  }

  it('both Forwards break at once, and the dead Lightning still raises its choice', () => {
    const { r, lightning, ally, victim } = sameBatch()
    expect(r.state.players[0].breakZone).toContain(lightning)
    expect(r.state.players[1].breakZone).toContain(victim)
    expect(ids(r.events, HASTE)).toEqual([{ type: 'abilityTriggered', player: 0, card: lightning, abilityId: HASTE }])
    // Both breaks are in one batch: the trigger comes after BOTH `broken` events, never between them.
    expect(at(r.events, (e) => e.type === 'abilityTriggered' && e.abilityId === HASTE))
      .toBeGreaterThan(at(r.events, (e) => e.type === 'broken' && e.card === lightning))
    expect(r.state.pending).toEqual({ kind: 'chooseTargets', player: 0, min: 1, max: 1, candidates: [ally] })
    ok(r.state)
  })

  it('resolves onto a Forward its dead source no longer stands beside', () => {
    const { r, ally } = sameBatch()
    const t = apply(r.state, { type: 'chooseTargets', player: 0, targets: [ally] }).state
    expect(fc(t, ally)?.granted).toEqual(['haste'])
    expect(t.pending).toBeNull()
    ok(t)
  })
})

// ---------------------------------------------------------------------------
// C2-A3 — cardinality: once per matching transition, not once per batch
// ---------------------------------------------------------------------------

describe('C2-A3: one Lightning watching TWO simultaneous breaks triggers TWICE (CR §11.8.6, spec C2-3)', () => {
  function twoVictims() {
    let s = makeGame({ defs: [...VANILLA_POOL, LIGHTNING, quake(5000)] })
    let lightning: CardId, a: CardId, b: CardId, cast: CardId
    ;[s, lightning] = withField(s, 0, 'forwards', '27-127S')   // 9000 power, survives 5000
    ;[s, a] = withField(s, 1, 'forwards', 'V-F2')              // 5000
    ;[s, b] = withField(s, 1, 'forwards', 'V-F2')              // 5000
    ;[s, cast] = withHand(s, 0, 'T-QUAKE')
    return { r: castQuake(s, cast), lightning, a, b }
  }

  it('raises two separate choices, one per transition', () => {
    const { r, lightning, a, b } = twoVictims()
    expect(r.state.players[1].breakZone).toEqual(expect.arrayContaining([a, b]))
    const events: Event[] = [...r.events]
    expect(ids(events, HASTE), 'one occurrence per matching transition, not one per batch').toHaveLength(1)
    expect(r.state.pending).toEqual({ kind: 'chooseTargets', player: 0, min: 1, max: 1, candidates: [lightning] })

    // The second occurrence is still queued behind the first — it is a separate frame, not a re-run.
    expect(r.state.resolution.queue.map((f) => f.abilityId)).toEqual([HASTE])
    const second = apply(r.state, { type: 'chooseTargets', player: 0, targets: [lightning] })
    events.push(...second.events)
    expect(second.state.pending, 'the second trigger must raise its own choice').toEqual({ kind: 'chooseTargets', player: 0, min: 1, max: 1, candidates: [lightning] })
    const third = apply(second.state, { type: 'chooseTargets', player: 0, targets: [lightning] })
    events.push(...third.events)

    expect(ids(events, HASTE)).toHaveLength(2)
    expect(third.state.pending).toBeNull()
    expect(fc(third.state, lightning)?.granted).toEqual(['haste'])   // granting twice is idempotent; triggering twice is not
    ok(third.state)
  })

  it('each frame carries the transition it fired on, not the batch', () => {
    const { r, a, b } = twoVictims()
    const subjects = [r.state.resolution.active, ...r.state.resolution.queue].map((f) => f?.triggerEvent)
    expect(subjects).toEqual([
      // `reason` rides on the event from C3 so narration can tell a break from a cost payment.
      { kind: 'zoneChange', card: a, from: 'field', to: 'breakZone', controller: 1, owner: 1, reason: 'damage' },
      { kind: 'zoneChange', card: b, from: 'field', to: 'breakZone', controller: 1, owner: 1, reason: 'damage' },
    ])
  })
})

// ---------------------------------------------------------------------------
// C2-10 — "opponent controls" is relative to the WATCHER
// ---------------------------------------------------------------------------

describe('“opponent controls” resolves against the watcher’s controller, not the turn player (spec C2-10)', () => {
  it('with a Lightning on each side, only the one whose OPPONENT lost a Forward triggers', () => {
    let s = makeGame({ defs: [...VANILLA_POOL, LIGHTNING, quake(5000)] })
    let mine: CardId, theirs: CardId, victim: CardId, cast: CardId
    ;[s, mine] = withField(s, 0, 'forwards', '27-127S')       // P0's Lightning: 9000, survives
    ;[s, theirs] = withField(s, 1, 'forwards', '27-127S')     // P1's Lightning: 9000, survives
    ;[s, victim] = withField(s, 0, 'forwards', 'V-F2')        // P0's Forward dies — P1 is the one watching
    ;[s, cast] = withHand(s, 0, 'T-QUAKE')
    const r = castQuake(s, cast)
    expect(r.state.players[0].breakZone).toContain(victim)
    expect(ids(r.events, HASTE)).toEqual([{ type: 'abilityTriggered', player: 1, card: theirs, abilityId: HASTE }])
    expect(r.state.pending).toEqual({ kind: 'chooseTargets', player: 1, min: 1, max: 1, candidates: [theirs] })
    const t = apply(r.state, { type: 'chooseTargets', player: 1, targets: [theirs] }).state
    expect(fc(t, theirs)?.granted).toEqual(['haste'])
    expect(fc(t, mine)?.granted).toEqual([])
    ok(t)
  })
})

// ---------------------------------------------------------------------------
// C2-A4/C2-A5 — Luso, combat damage and ability damage
// ---------------------------------------------------------------------------

/**
 * Luso's REAL c1 plus a synthetic ETB that deals ability damage FROM Luso. Stage 1 implements no printed Luso
 * clause that deals damage — that is c2, which is stage 2 — so the ability-damage SOURCE has to be authored
 * here. `cost: 0` keeps the payment empty; the clause under test is the untouched real one.
 */
const lusoWithBurn = (amount: number): CardDef => ({
  ...LUSO,
  cost: 0,
  abilities: [LUSO_DAMAGES_FORWARD, {
    id: '27-125S:test-burn', trigger: { kind: 'enterField' }, text: 'synthetic: deal ability damage from Luso',
    effects: [{ kind: 'forEach', from: { zone: 'forwards', controller: 'opponent' }, do: [{ kind: 'damage', amount }] } as Effect],
  }],
})

const VICTIM_3000 = makeDef({ code: 'T-V3000', cost: 1, power: 3000 })

/** Cast the burning Luso onto an opponent Forward of `victimCode` and return the whole event stream. */
function lusoBurns(amount: number, victimCode: string) {
  let s = makeGame({ defs: [...VANILLA_POOL, lusoWithBurn(amount), VICTIM_3000] })
  let victim: CardId, cast: CardId
  ;[s, victim] = withField(s, 1, 'forwards', victimCode)
  ;[s, cast] = withHand(s, 0, '27-125S')
  const r = apply(s, { type: 'castCharacter', player: 0, card: cast, payment: { dullBackups: [], discards: [] } })
  return { r, victim, luso: cast }
}

describe('C2-A4: Luso breaks what it damages, in combat and by ability alike (spec C2-7)', () => {
  it('combat: the blocker Luso damaged is broken, even though the blocker killed Luso in the same batch', () => {
    let s = makeGame({ defs: [...VANILLA_POOL, LUSO] })
    let luso: CardId, blocker: CardId
    ;[s, luso] = withField(s, 0, 'forwards', '27-125S')      // 3000 power
    ;[s, blocker] = withField(s, 1, 'forwards', 'V-F8')      // 9000 power — survives 3000, deals 9000 back
    s = apply(s, { type: 'pass', player: 0 }).state          // §10.1.1–2 into the declaration step
    s = apply(s, { type: 'declareAttack', player: 0, attackers: [luso] }).state
    const r = apply(s, { type: 'declareBlock', player: 1, blocker })

    expect(r.events).toContainEqual({ type: 'battleDamage', source: luso, target: blocker, amount: 3000 })
    expect(r.events).toContainEqual({ type: 'broken', card: luso })                                  // §12.4.5 took Luso
    expect(ids(r.events, BREAK_IT)).toHaveLength(1)                                                  // …and it still triggered
    expect(r.events).toContainEqual({ type: 'brokenByAbility', card: blocker, source: luso })
    expect(fc(r.state, blocker)).toBeUndefined()
    expect(r.state.players[1].breakZone).toContain(blocker)
    expect(r.state.pending).toBeNull()   // "break it" names its subject; it is never a target CHOICE (spec C2-5)
    ok(r.state)
  })

  it('ability: a Forward Luso burned for less than lethal is broken by the trigger', () => {
    const { r, victim, luso } = lusoBurns(3000, 'V-F8')   // 9000 power — 3000 is not lethal
    expect(r.events).toContainEqual({ type: 'abilityDamage', source: luso, target: victim, amount: 3000 })
    expect(r.events).toContainEqual({ type: 'brokenByAbility', card: victim, source: luso })
    expect(r.state.players[1].breakZone).toContain(victim)
    ok(r.state)
  })
})

describe('C2-A5: §12.4.5 runs BETWEEN frames, so it beats the trigger the same damage queued (spec C2-6)', () => {
  it('lethal ability damage: the RULE PROCESS breaks the Forward and Luso’s breakCard no-ops', () => {
    const { r, victim } = lusoBurns(3000, 'T-V3000')   // 3000 power — exactly lethal
    // The final zones are identical either way. The cause and the narration are what separate them.
    expect(r.state.players[1].breakZone).toContain(victim)
    expect(r.events).toContainEqual({ type: 'broken', card: victim })                                     // §12.4.5
    expect(r.events.some((e) => e.type === 'brokenByAbility' && e.card === victim), 'Luso must find nothing left to break').toBe(false)
    expect(at(r.events, (e) => e.type === 'broken' && e.card === victim))
      .toBeLessThan(at(r.events, (e) => e.type === 'abilityTriggered' && e.abilityId === BREAK_IT))
    ok(r.state)
  })

  it('non-lethal ability damage: the rule process does nothing and the TRIGGER does the breaking', () => {
    const { r, victim, luso } = lusoBurns(3000, 'V-F8')   // 9000 power
    expect(r.state.players[1].breakZone).toContain(victim)
    expect(r.events.some((e) => e.type === 'broken'), '§12.4.5 has nothing to do here').toBe(false)
    expect(r.events).toContainEqual({ type: 'brokenByAbility', card: victim, source: luso })
    expect(at(r.events, (e) => e.type === 'abilityTriggered' && e.abilityId === BREAK_IT))
      .toBeLessThan(at(r.events, (e) => e.type === 'brokenByAbility' && e.card === victim))
    ok(r.state)
  })
})

// ---------------------------------------------------------------------------
// C2-A9 — nothing preempts an active frame, and rule processes run between frames
// ---------------------------------------------------------------------------

describe('C2-A9: queued triggers and rule processes never preempt an ACTIVE frame (spec C2-6)', () => {
  /**
   * Two `enterField` clauses on one card, so casting it queues TWO frames. Clause A raises two prompts with
   * lethal damage in between; clause B pumps whatever Forwards the opponent still has when its own turn comes.
   * B's `powerModified` events are therefore a direct read-out of WHEN the §12.4.5 process ran: before B (the
   * one-frame yield) or only after the whole queue drained (the ordering C2-6 replaced).
   */
  const TWO: Effect[] = [{
    kind: 'chooseModes', min: 2, max: 2,
    modes: [
      { label: 'damage', effects: [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'opponent' }, then: [{ kind: 'damage', amount: 5000 }] }] },
      { label: 'haste', effects: [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'opponent' }, then: [{ kind: 'grantKeyword', keyword: 'haste' }] }] },
    ],
  }]
  const A: Ability = { id: 'T-TWO:a', trigger: { kind: 'enterField' }, text: 'synthetic: modal', effects: TWO }
  const B: Ability = {
    id: 'T-TWO:b', trigger: { kind: 'enterField' }, text: 'synthetic: pump their team',
    effects: [{ kind: 'forEach', from: { zone: 'forwards', controller: 'opponent' }, do: [{ kind: 'addPower', amount: 1000 }] }],
  }
  const TWO_CLAUSE = makeDef({ code: 'T-TWO', cost: 0, power: 1000, hasAbilities: true, abilityClauses: 2, abilities: [A, B], text: 'synthetic: two clauses' })

  it('holds the second frame and the rule process until the first frame has answered both prompts', () => {
    let s = makeGame({ defs: [...VANILLA_POOL, TWO_CLAUSE, VICTIM_3000] })
    let victim: CardId, bystander: CardId, cast: CardId
    ;[s, victim] = withField(s, 1, 'forwards', 'V-F2')        // 5000 power — 5000 damage is exactly lethal
    ;[s, bystander] = withField(s, 1, 'forwards', 'V-F8')     // 9000 power — survives to be pumped by clause B
    ;[s, cast] = withHand(s, 0, 'T-TWO')

    let r = apply(s, { type: 'castCharacter', player: 0, card: cast, payment: { dullBackups: [], discards: [] } })
    expect(r.state.resolution.active?.abilityId).toBe('T-TWO:a')
    expect(r.state.resolution.queue.map((f) => f.abilityId), 'clause B waits its turn').toEqual(['T-TWO:b'])

    r = apply(r.state, { type: 'chooseMode', player: 0, modes: [0, 1] })
    expect(r.state.resolution.queue.map((f) => f.abilityId)).toEqual(['T-TWO:b'])

    r = apply(r.state, { type: 'chooseTargets', player: 0, targets: [victim] })   // now carrying lethal damage
    expect(r.state.pending?.kind, 'the second prompt of the SAME frame').toBe('chooseTargets')
    expect(r.state.pending?.kind === 'chooseTargets' && r.state.pending.candidates, 'a frame owns its targets until it finishes').toContain(victim)
    expect(fc(r.state, victim), 'no rule process may run mid-frame').toBeDefined()
    expect(r.state.resolution.queue.map((f) => f.abilityId), 'and no queued frame may cut in').toEqual(['T-TWO:b'])
    ok(r.state)

    const last = apply(r.state, { type: 'chooseTargets', player: 0, targets: [victim] })
    expect(last.events).toContainEqual({ type: 'keywordGranted', card: victim, keyword: 'haste' })
    // Only once frame A is done: §12.4.5, and only THEN clause B.
    expect(at(last.events, (e) => e.type === 'broken' && e.card === victim))
      .toBeLessThan(at(last.events, (e) => e.type === 'abilityTriggered' && e.abilityId === 'T-TWO:b'))
    // The read-out: B saw the post-rule-process field. Drain the whole queue without yielding and the dead
    // Forward is still standing here, and gets pumped too.
    expect(last.events.filter((e) => e.type === 'powerModified')).toEqual([{ type: 'powerModified', card: bystander, amount: 1000 }])
    expect(last.state.pending).toBeNull()
    expect(last.state.resolution.queue).toEqual([])
    ok(last.state)
  })
})

// ---------------------------------------------------------------------------
// Determinisation equivalence for a zone-change-triggered clause (spec C2-A12)
// ---------------------------------------------------------------------------

describe('a live state and its DETERMINISATION resolve a zone-change trigger identically (spec C2-A12)', () => {
  it('same states, events, pending and resolution queue', () => {
    // Same shape as C1-A6 in abilities-engine.test.ts, but on a clause whose SOURCE is a different card from
    // the one the event was about — the ordering C2-11 pins comes from the field arrays, which is exactly what
    // `determinise` preserves and `state.cards`' key order would not.
    let s = makeGame({ defs: [...VANILLA_POOL, LIGHTNING, quake(5000)] })
    let lightning: CardId, a: CardId, b: CardId, cast: CardId
    ;[s, lightning] = withField(s, 0, 'forwards', '27-127S')
    ;[s, a] = withField(s, 1, 'forwards', 'V-F2')
    ;[s, b] = withField(s, 1, 'forwards', 'V-F2')
    ;[s, cast] = withHand(s, 0, 'T-QUAKE')
    s = castQuake(s, cast).state
    expect(s.pending?.kind).toBe('chooseTargets')
    expect(s.resolution.queue).toHaveLength(1)   // the second occurrence, still queued

    // Derived from the state, not DEFAULT_DECK: withField/withHand MINT instances, so the declared lists must
    // account for them or `determinise` rejects a visible card it cannot place.
    const decks = ([0, 1] as const).map((p) => {
      const q = s.players[p]
      return [...q.deck, ...q.hand, ...q.forwards.map((c) => c.id), ...q.backups.map((c) => c.id), ...q.damageZone, ...q.breakZone, ...q.removedFromGame]
        .map((id) => s.cards[id]!.code)
    }) as [string[], string[]]
    const [det] = determinise({ view: viewFor(s, 0), decks, rng: seedRng(1) })
    const before = JSON.stringify(det)

    const answer: Command = { type: 'chooseTargets', player: 0, targets: [lightning] }
    const live = apply(s, answer)
    const sim = apply(det, answer)

    expect(fc(live.state, lightning)?.granted).toEqual(['haste'])
    expect(fc(sim.state, lightning)?.granted).toEqual(['haste'])
    expect(sim.events).toEqual(live.events)
    expect(sim.state.pending).toEqual(live.state.pending)
    expect(sim.state.resolution).toEqual(live.state.resolution)
    for (const p of [0, 1] as const) {
      expect(sim.state.players[p].forwards).toEqual(live.state.players[p].forwards)
      expect(sim.state.players[p].breakZone).toEqual(live.state.players[p].breakZone)
    }
    expect([a, b].every((id) => live.state.players[1].breakZone.includes(id))).toBe(true)
    expect(JSON.stringify(det), 'apply must not mutate its input').toBe(before)
  })
})

// ---------------------------------------------------------------------------
// An ABILITY break is a zone transition too — the rung's HIGH
// ---------------------------------------------------------------------------

describe('an ability-caused break is watched exactly as a rule-process break is', () => {
  /**
   * `breakCard` did its own field-to-Break-Zone move and produced no `ZoneTransition`, so `observesZoneChange`
   * clauses never saw an ability break at all — Lightning did not notice a Forward its own ETB had just broken.
   * Measured on the shipped seed-1 gate before the fix: roughly 130 of 220 ability breaks had an eligible
   * watcher standing, so about 40% of the breaks the printed text names were missed silently, with the whole
   * suite, the invariants and the strict fuzzer green throughout. Only a targeted probe could see it.
   *
   * Luso breaking a NON-lethally damaged Forward is the ability-break path end to end: no rule process is
   * involved at all, so if the watcher fires here it can only be because `breakCard` produced a transition.
   */
  it('a Forward broken by an ability raises the watcher, exactly as a rule-process break does', () => {
    let s = makeGame({ defs: [...VANILLA_POOL, LIGHTNING, LUSO] })
    let luso: CardId, watcher: CardId, blocker: CardId
    ;[s, watcher] = withField(s, 0, 'forwards', '27-127S')   // P0's Lightning, watching P1's field
    ;[s, luso] = withField(s, 0, 'forwards', '27-125S')      // 3000
    ;[s, blocker] = withField(s, 1, 'forwards', 'V-F8')      // 9000 — survives 3000, so ONLY the ability breaks it
    s = apply(s, { type: 'pass', player: 0 }).state
    s = apply(s, { type: 'declareAttack', player: 0, attackers: [luso] }).state
    const r = apply(s, { type: 'declareBlock', player: 1, blocker })

    // 3000 into 9000 is not lethal, so §12.4.5 does nothing to the blocker: `brokenByAbility` is the only
    // route it left the field by, which is what makes this the ability-break path end to end.
    expect(r.events).toContainEqual({ type: 'brokenByAbility', card: blocker, source: luso })
    expect(r.events.some((e) => e.type === 'broken' && e.card === blocker), 'no rule process touched the blocker').toBe(false)
    expect(ids(r.events, HASTE), 'the watcher must see an ability break too').toHaveLength(1)
    expect(r.state.pending?.kind).toBe('chooseTargets')

    const done = apply(r.state, { type: 'chooseTargets', player: 0, targets: [watcher] })
    expect(fc(done.state, watcher)?.granted).toEqual(['haste'])
    ok(done.state)
  })
})
