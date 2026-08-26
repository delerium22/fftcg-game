import { describe, expect, it } from 'vitest'
import type { Ability, Effect } from '../src/abilities.js'
import { EMPTY_RESOLUTION, MAX_RESOLUTION_STEPS } from '../src/abilities.js'
import type { CardDef, PlayerId } from '../src/types.js'
import type { CardId, GameState } from '../src/state.js'
import type { Event } from '../src/events.js'
import { defOf, effectivePower, findFieldCard, powerOf } from '../src/state.js'
import { apply } from '../src/apply.js'
import { legalCommands } from '../src/legal.js'
import { checkInvariants } from '../src/invariants.js'
import { applyCastCharacter, applyCastSummon } from '../src/cast.js'
import { runRuleProcesses } from '../src/rules.js'
import { finishEndPhase } from '../src/phases.js'
import { viewFor } from '../src/view.js'
import { applyChooseTargets, drainResolution, enqueueTrigger, targetCandidates } from '../src/resolve.js'
import { IllegalCommandError } from '../src/errors.js'
import { createGame } from '../src/setup.js'
import { determinise } from '../src/determinise.js'
import { seedRng } from '../src/rng.js'
import type { Command } from '../src/commands.js'
import { actingPlayer } from '../src/legal.js'
import { deckOf, makeDef, makeGame, VANILLA_POOL, withField, withHand } from './helpers.js'

/**
 * The executor is card-agnostic (spec C1-1): every def below is SYNTHETIC, authored here to exercise one
 * primitive at a time. The five real clauses live in `packages/cards` and are tested against their printed text.
 */

const ID = 'T-SRC:etb'

function srcDef(effects: readonly Effect[], over: Partial<CardDef> = {}): CardDef {
  const ability: Ability = { id: ID, trigger: 'enterField', text: 'synthetic test clause', effects }
  return makeDef({ code: 'T-SRC', cost: 1, power: 1000, text: 'synthetic test clause', hasAbilities: true, abilityClauses: 1, abilities: [ability], ...over })
}

/** A game with the source Forward already on P0's field, plus whatever `extra` defs a test needs. */
function setup(effects: readonly Effect[], extra: CardDef[] = []): { s: GameState; src: CardId } {
  let s = makeGame({ defs: [...VANILLA_POOL, srcDef(effects), ...extra] })
  let src: CardId
  ;[s, src] = withField(s, 0, 'forwards', 'T-SRC')
  return { s, src }
}

function fire(s: GameState, src: CardId, controller: PlayerId = 0): [GameState, Event[]] {
  const ability = defOf(s, src).abilities?.[0]
  if (!ability) throw new Error('the source def carries no ability')
  return drainResolution(enqueueTrigger(s, src, controller, ability))
}

const fc = (s: GameState, id: CardId) => findFieldCard(s, id)?.card
const ok = (s: GameState) => expect(checkInvariants(s)).toEqual([])

/** Wrap a primitive in an untargeted `forEach` so it gets a binding without raising a prompt. */
const overOpponentForwards = (...effects: Effect[]): Effect[] => [{ kind: 'forEach', from: { zone: 'forwards', controller: 'opponent' }, do: effects }]

describe('effectivePower is the single power authority (spec C1-7)', () => {
  it('powerOf delegates to it, and it floors at 0', () => {
    let { s } = setup([]); let f: CardId
    ;[s, f] = withField(s, 1, 'forwards', 'V-F2', { powerBonus: 3000 })   // printed 5000
    const card = fc(s, f)!
    expect(effectivePower(defOf(s, f), card)).toBe(8000)
    expect(powerOf(s, card)).toBe(8000)
    expect(effectivePower(defOf(s, f), { ...card, powerBonus: -9000 })).toBe(0)
  })
})

describe('effect primitives, one at a time', () => {
  it('dull turns an active card dull and logs it once', () => {
    let { s, src } = setup(overOpponentForwards({ kind: 'dull' })); let a: CardId
    ;[s, a] = withField(s, 1, 'forwards', 'V-F2')
    ;[s] = withField(s, 1, 'forwards', 'V-F5', { status: 'dull' })
    const [t, events] = fire(s, src)
    expect(fc(t, a)?.status).toBe('dull')
    expect(events.filter((e) => e.type === 'dulled')).toEqual([{ type: 'dulled', card: a }])   // b was already dull
    ok(t)
  })

  it('damage accumulates on Forwards and is ignored by Backups', () => {
    let { s, src } = setup([{ kind: 'forEach', from: { zone: 'backups', controller: 'opponent' }, do: [{ kind: 'damage', amount: 6000 }] },
      ...overOpponentForwards({ kind: 'damage', amount: 6000 })])
    let f: CardId, bk: CardId
    ;[s, f] = withField(s, 1, 'forwards', 'V-F8')     // 9000 power, survives
    ;[s, bk] = withField(s, 1, 'backups', 'V-B1')
    const [t, events] = fire(s, src)
    expect(fc(t, f)?.damage).toBe(6000)
    expect(fc(t, bk)?.damage).toBe(0)
    expect(events).toContainEqual({ type: 'abilityDamage', source: src, target: f, amount: 6000 })
    ok(t)
  })

  it('breakCard puts the card into its OWNER’s break zone', () => {
    let { s, src } = setup(overOpponentForwards({ kind: 'breakCard' })); let f: CardId
    ;[s, f] = withField(s, 1, 'forwards', 'V-F2')
    const [t, events] = fire(s, src)
    expect(fc(t, f)).toBeUndefined()
    expect(t.players[1].breakZone).toContain(f)
    expect(events).toContainEqual({ type: 'brokenByAbility', card: f, source: src })
    ok(t)
  })

  it('addPower changes only powerBonus, and powerOf sees it', () => {
    let { s, src } = setup([{ kind: 'forEach', from: { zone: 'forwards', controller: 'self', filter: { excludeSource: true } }, do: [{ kind: 'addPower', amount: 3000 }] }])
    let f: CardId
    ;[s, f] = withField(s, 0, 'forwards', 'V-F2')
    const [t] = fire(s, src)
    expect(fc(t, f)?.powerBonus).toBe(3000)
    expect(powerOf(t, fc(t, f)!)).toBe(8000)
    expect(fc(t, src)?.powerBonus).toBe(0)   // excludeSource
    ok(t)
  })

  it('grantKeyword and grantFlag are idempotent', () => {
    let { s, src } = setup(overOpponentForwards({ kind: 'grantKeyword', keyword: 'haste' }, { kind: 'grantKeyword', keyword: 'haste' },
      { kind: 'grantFlag', flag: 'cannotBeBroken' }, { kind: 'grantFlag', flag: 'cannotBeBroken' }))
    let f: CardId
    ;[s, f] = withField(s, 1, 'forwards', 'V-F2')
    const [t, events] = fire(s, src)
    expect(fc(t, f)?.granted).toEqual(['haste'])
    expect(fc(t, f)?.flags).toEqual(['cannotBeBroken'])
    expect(events.filter((e) => e.type === 'keywordGranted')).toHaveLength(1)
    ok(t)
  })

  it('moveToHand pulls a Forward out of the Break Zone', () => {
    let { s, src } = setup([{ kind: 'forEach', from: { zone: 'breakZone', controller: 'self', filter: { type: 'forward' } }, do: [{ kind: 'moveToHand' }] }])
    let dead: CardId, summon: CardId
    ;[s, dead] = withHand(s, 0, 'V-F2')
    ;[s, summon] = withHand(s, 0, 'V-S1')
    s = { ...s, players: [{ ...s.players[0], hand: s.players[0].hand.filter((id) => id !== dead && id !== summon), breakZone: [dead, summon] }, s.players[1]] }
    const before = [...s.players[0].hand]
    const [t, events] = fire(s, src)
    expect(t.players[0].hand).toEqual([...before, dead])   // the Summon is filtered out by `type: 'forward'`
    expect(t.players[0].breakZone).toEqual([summon])
    expect(events).toContainEqual({ type: 'returnedToHand', player: 0, card: dead })
    ok(t)
  })

  it('forEach runs once per matching card and binds each in turn', () => {
    let { s, src } = setup(overOpponentForwards({ kind: 'addPower', amount: 1000 })); let a: CardId, b: CardId
    ;[s, a] = withField(s, 1, 'forwards', 'V-F2')
    ;[s, b] = withField(s, 1, 'forwards', 'V-F5')
    const [t] = fire(s, src)
    expect([fc(t, a)?.powerBonus, fc(t, b)?.powerBonus]).toEqual([1000, 1000])
  })

  it('targetCandidates honours zone, controller and every filter', () => {
    let { s, src } = setup([]); let mine: CardId, theirs: CardId, twin: CardId
    ;[s, mine] = withField(s, 0, 'forwards', 'V-F1')          // earth, cost 1
    ;[s, theirs] = withField(s, 1, 'forwards', 'V-F3')        // lightning, cost 3
    ;[s, twin] = withField(s, 1, 'forwards', 'T-SRC')         // same NAME as the source
    expect(targetCandidates(s, src, 0, { zone: 'forwards', controller: 'opponent' })).toEqual([theirs, twin])
    expect(targetCandidates(s, src, 0, { zone: 'forwards', controller: 'any', filter: { maxCost: 1 } })).toEqual([src, mine, twin])
    expect(targetCandidates(s, src, 0, { zone: 'forwards', controller: 'any', filter: { element: 'lightning' } })).toEqual([theirs])
    expect(targetCandidates(s, src, 0, { zone: 'forwards', controller: 'any', filter: { excludeSourceName: true } })).toEqual([mine, theirs])
    expect(targetCandidates(s, src, 0, { zone: 'forwards', controller: 'self', filter: { excludeSource: true } })).toEqual([mine])
  })
})

describe('choices suspend the frame and resume it (spec C1-3/C1-6)', () => {
  const modal: Effect[] = [{
    kind: 'chooseModes',
    min: 1,
    max: 1,
    modes: [
      { label: 'Dull 1 of your opponent’s Forwards', effects: [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'opponent' }, then: [{ kind: 'dull' }] }] },
      { label: 'All your Forwards gain +1000 power', effects: [{ kind: 'forEach', from: { zone: 'forwards', controller: 'self' }, do: [{ kind: 'addPower', amount: 1000 }] }] },
    ],
  }]

  it('a nested chooseModes → chooseTargets chain takes exactly two commands', () => {
    let { s, src } = setup(modal); let victim: CardId
    ;[s, victim] = withField(s, 1, 'forwards', 'V-F2')
    ;[s] = fire(s, src)

    expect(s.pending).toEqual({ kind: 'chooseMode', player: 0, min: 1, max: 1, labels: ['Dull 1 of your opponent\u2019s Forwards', 'All your Forwards gain +1000 power'] })
    expect(s.resolution.active?.abilityId).toBe(ID)
    ok(s)
    // C1-A3: the choice is a normal command, enumerated by legalCommands like any other.
    expect(legalCommands(s, 0)).toContainEqual({ type: 'chooseMode', player: 0, modes: [0] })
    expect(legalCommands(s, 1)).toEqual([{ type: 'concede', player: 1 }])

    s = apply(s, { type: 'chooseMode', player: 0, modes: [0] }).state
    expect(s.pending).toEqual({ kind: 'chooseTargets', player: 0, min: 1, max: 1, candidates: [victim] })
    expect(s.resolution.active).not.toBeNull()
    ok(s)

    s = apply(s, { type: 'chooseTargets', player: 0, targets: [victim] }).state
    expect(fc(s, victim)?.status).toBe('dull')
    expect(s.pending).toBeNull()
    expect(s.resolution).toEqual(EMPTY_RESOLUTION)   // settle resets the agenda once it is quiet
    ok(s)
  })

  it('the OTHER mode resumes into its own branch, not the first one', () => {
    let { s, src } = setup(modal); let victim: CardId
    ;[s, victim] = withField(s, 1, 'forwards', 'V-F2')
    ;[s] = fire(s, src)
    s = apply(s, { type: 'chooseMode', player: 0, modes: [1] }).state
    expect(s.pending).toBeNull()                       // mode 1 raises no prompt
    expect(fc(s, src)?.powerBonus).toBe(1000)
    expect(fc(s, victim)?.status).toBe('active')
  })

  it('two modes chosen at once resolve in PRINTED order and each keeps its own program counter', () => {
    const both: Effect[] = [{
      kind: 'chooseModes',
      min: 0,
      max: 2,
      modes: [
        { label: 'a', effects: [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'opponent' }, then: [{ kind: 'dull' }] }] },
        { label: 'b', effects: [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'opponent' }, then: [{ kind: 'damage', amount: 1000 }] }] },
      ],
    }]
    let { s, src } = setup(both); let x: CardId, y: CardId
    ;[s, x] = withField(s, 1, 'forwards', 'V-F8')
    ;[s, y] = withField(s, 1, 'forwards', 'V-F7')
    ;[s] = fire(s, src)
    s = apply(s, { type: 'chooseMode', player: 0, modes: [1, 0] }).state   // answered out of order
    s = apply(s, { type: 'chooseTargets', player: 0, targets: [x] }).state // mode a first
    s = apply(s, { type: 'chooseTargets', player: 0, targets: [y] }).state // then mode b
    expect(fc(s, x)?.status).toBe('dull')
    expect(fc(s, x)?.damage).toBe(0)
    expect(fc(s, y)?.damage).toBe(1000)
    expect(fc(s, y)?.status).toBe('active')
    ok(s)
  })

  it('apply re-derives the candidates from the AST and refuses a forged answer', () => {
    let { s, src } = setup([{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'opponent' }, then: [{ kind: 'dull' }] }])
    let victim: CardId, mine: CardId
    ;[s, victim] = withField(s, 1, 'forwards', 'V-F2')
    ;[s, mine] = withField(s, 0, 'forwards', 'V-F5')
    ;[s] = fire(s, src)
    // A pending that claims a bigger candidate set than the ability actually allows must not be believed.
    const forged: GameState = { ...s, pending: { kind: 'chooseTargets', player: 0, min: 0, max: 2, candidates: [victim, mine] } }
    expect(() => applyChooseTargets(forged, 0, [mine])).toThrow(IllegalCommandError)
    expect(() => applyChooseTargets(forged, 0, [victim, victim])).toThrow(IllegalCommandError)
    expect(() => applyChooseTargets(forged, 0, [])).toThrow(IllegalCommandError)
    expect(() => applyChooseTargets(s, 1, [victim])).toThrow(IllegalCommandError)
  })

  it('"up to 2" enumerates C(N,0..2) and the empty answer is legal', () => {
    let { s, src } = setup([{ kind: 'chooseTargets', min: 0, max: 2, from: { zone: 'forwards', controller: 'opponent' }, then: [{ kind: 'dull' }] }])
    let a: CardId, b: CardId, c: CardId
    ;[s, a] = withField(s, 1, 'forwards', 'V-F1')
    ;[s, b] = withField(s, 1, 'forwards', 'V-F2')
    ;[s, c] = withField(s, 1, 'forwards', 'V-F5')
    ;[s] = fire(s, src)
    const answers = legalCommands(s, 0).filter((x) => x.type === 'chooseTargets')
    expect(answers).toHaveLength(1 + 3 + 3)   // C(3,0) + C(3,1) + C(3,2)
    const none = apply(s, { type: 'chooseTargets', player: 0, targets: [] }).state
    expect([a, b, c].map((id) => fc(none, id)?.status)).toEqual(['active', 'active', 'active'])
    const two = apply(s, { type: 'chooseTargets', player: 0, targets: [a, c] }).state
    expect([a, b, c].map((id) => fc(two, id)?.status)).toEqual(['dull', 'active', 'dull'])
  })

  it('the view carries the agenda so the AI simulates the ability game it is playing (spec C1-A6)', () => {
    let { s, src } = setup([{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'opponent' }, then: [{ kind: 'dull' }] }])
    ;[s] = withField(s, 1, 'forwards', 'V-F2')
    ;[s] = fire(s, src)
    expect(viewFor(s, 0).resolution).toEqual(s.resolution)
  })

  it('C1-A6 proper: a live state and its DETERMINISATION resolve the same command identically', () => {
    // The previous test only checked that `viewFor` copied `resolution` — it never called `determinise`, which
    // is the function the whole "AST on CardDef, not an injected registry" decision exists to survive. If the
    // AST failed to reach a determinised state, the AI would roll out a vanilla game while playing an ability
    // game, and nothing here would have failed.
    let { s, src } = setup([{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'opponent' }, then: [{ kind: 'dull' }] }])
    let victim: CardId
    ;[s, victim] = withField(s, 1, 'forwards', 'V-F2')
    ;[s] = fire(s, src)
    expect(s.pending?.kind).toBe('chooseTargets')

    // Derived from the state, not DEFAULT_DECK: withField/withHand MINT card instances, so the declared list
    // must include them or `determinise` rejects a visible card it cannot account for.
    const decks = ([0, 1] as const).map((p) => {
      const q = s.players[p]
      return [...q.deck, ...q.hand, ...q.forwards.map((c) => c.id), ...q.backups.map((c) => c.id), ...q.damageZone, ...q.breakZone]
        .map((id) => s.cards[id]!.code)
    }) as [string[], string[]]
    const [det] = determinise({ view: viewFor(s, 0), decks, rng: seedRng(1) })
    const before = JSON.stringify(det)

    const answer: Command = { type: 'chooseTargets', player: 0, targets: [victim] }
    const live = apply(s, answer)
    const sim = apply(det, answer)

    // The ability must have DONE something in both — a vanilla determinisation would leave the card active.
    expect(fc(live.state, victim)?.status).toBe('dull')
    expect(fc(sim.state, victim)?.status).toBe('dull')
    expect(sim.events.map((e) => e.type)).toEqual(live.events.map((e) => e.type))
    expect(sim.state.resolution).toEqual(live.state.resolution)
    expect(JSON.stringify(det), 'apply must not mutate its input').toBe(before)
  })
})

describe('an ability with no legal target is a no-op that logs (spec C1-7)', () => {
  it('does not throw, changes nothing, and warns', () => {
    const { s, src } = setup([{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'opponent' }, then: [{ kind: 'breakCard' }] }])
    const [t, events] = fire(s, src)   // the opponent controls no Forwards
    expect(t.pending).toBeNull()
    expect(t.resolution.active).toBeNull()
    expect(events).toContainEqual({ type: 'abilityNoLegalTarget', card: src, abilityId: ID })
    expect(JSON.stringify(t.players)).toBe(JSON.stringify(s.players))
    ok(t)
  })

  it('"up to 2" with a single candidate is still a real choice, not a no-op', () => {
    let { s, src } = setup([{ kind: 'chooseTargets', min: 0, max: 2, from: { zone: 'forwards', controller: 'opponent' }, then: [{ kind: 'dull' }] }])
    ;[s] = withField(s, 1, 'forwards', 'V-F2')
    const [t] = fire(s, src)
    expect(t.pending).toMatchObject({ kind: 'chooseTargets', min: 0, max: 1 })   // max clamped to the candidate count
  })
})

describe('cannotBeBroken (spec C1-7)', () => {
  it('survives lethal damage but NOT the zero-power rule process', () => {
    let { s } = setup([]); let tough: CardId, weak: CardId
    ;[s, tough] = withField(s, 1, 'forwards', 'V-F2', { damage: 99000, flags: ['cannotBeBroken'] })       // 5000 power
    ;[s, weak] = withField(s, 1, 'forwards', 'V-F2', { powerBonus: -5000, flags: ['cannotBeBroken'] })    // 0 power
    const [t, events] = runRuleProcesses(s)
    expect(fc(t, tough)).toBeDefined()
    expect(fc(t, weak)).toBeUndefined()
    expect(events).toContainEqual({ type: 'putIntoBreakZone', card: weak, reason: 'zeroPower' })
    expect(events.some((e) => e.type === 'broken')).toBe(false)
    ok(t)
  })

  it('blocks a direct breakCard effect and says so', () => {
    let { s, src } = setup(overOpponentForwards({ kind: 'breakCard' })); let f: CardId
    ;[s, f] = withField(s, 1, 'forwards', 'V-F2', { flags: ['cannotBeBroken'] })
    const [t, events] = fire(s, src)
    expect(fc(t, f)).toBeDefined()
    expect(events).toContainEqual({ type: 'breakPrevented', card: f, flag: 'cannotBeBroken' })
  })
})

describe('the End Phase ends every until-end-of-turn effect (§9.5.1.3.2)', () => {
  it('clears powerBonus, granted keywords and flags on both fields', () => {
    let { s } = setup([]); let f: CardId, b: CardId
    ;[s, f] = withField(s, 1, 'forwards', 'V-F8', { damage: 2000, attackedThisTurn: true, granted: ['haste'], powerBonus: 4000, flags: ['cannotBeBroken'] })
    ;[s, b] = withField(s, 0, 'backups', 'V-B1', { granted: ['brave'], powerBonus: 2000, flags: ['cannotBeBroken'] })
    const [t] = finishEndPhase({ ...s, phase: 'end' })
    expect(fc(t, f)).toMatchObject({ damage: 0, attackedThisTurn: false, granted: [], powerBonus: 0, flags: [] })
    expect(fc(t, b)).toMatchObject({ granted: [], powerBonus: 0, flags: [] })
    ok(t)
  })
})

describe('the step budget is total and persists across player choices (spec C1-5)', () => {
  /**
   * `settle` only resets `resolution.steps` when the whole settlement has gone quiet, which a genuine cycle never
   * does — so these drive `drainResolution` directly, which is exactly the state a rule-process ⇄ trigger cycle
   * would be in when C2 adds zone-change triggers.
   */
  it('throws on a trigger cycle with no prompt in it', () => {
    const { s, src } = setup([{ kind: 'addPower', amount: 0 }, { kind: 'addPower', amount: 0 }])
    const ability = defOf(s, src).abilities![0]!
    expect(() => {
      let t = s
      for (let i = 0; i < MAX_RESOLUTION_STEPS + 10; i++) [t] = drainResolution(enqueueTrigger(t, src, 0, ability))
    }).toThrow(/resolution steps|resolution exceeded/)
  })

  it('throws on a cycle that launders itself through a chooseTargets prompt', () => {
    let { s, src } = setup([{ kind: 'chooseTargets', min: 0, max: 1, from: { zone: 'forwards', controller: 'opponent' }, then: [{ kind: 'addPower', amount: 0 }] }])
    ;[s] = withField(s, 1, 'forwards', 'V-F2')
    const ability = defOf(s, src).abilities![0]!
    let rounds = 0
    expect(() => {
      let t = s
      for (let i = 0; i < MAX_RESOLUTION_STEPS + 10; i++) {
        ;[t] = drainResolution(enqueueTrigger(t, src, 0, ability))
        expect(t.pending?.kind).toBe('chooseTargets')
        ;[t] = applyChooseTargets(t, 0, [])
        ;[t] = drainResolution(t)
        rounds++
      }
    }).toThrow(/resolution steps|resolution exceeded/)
    // A call-depth cap would have reset at every prompt and never fired.
    expect(rounds).toBeGreaterThan(1)
    expect(rounds).toBeLessThan(MAX_RESOLUTION_STEPS)
  })
})

describe('per-clause coverage warnings (spec C1-9)', () => {
  function castable(def: CardDef) {
    let s = makeGame({ defs: [...VANILLA_POOL, def] })
    s = { ...s, players: [{ ...s.players[0], hand: [] }, s.players[1]] }
    let bk: CardId, card: CardId
    ;[s, bk] = withField(s, 0, 'backups', 'V-B1')
    ;[s, card] = withHand(s, 0, def.code)
    return { s, bk, card }
  }

  it('a card with 1 of 3 printed clauses implemented still warns about the other 2', () => {
    const def = srcDef([{ kind: 'forEach', from: { zone: 'forwards', controller: 'self' }, do: [{ kind: 'addPower', amount: 1000 }] }], { code: 'T-3CL', abilityClauses: 3 })
    const { s, bk, card } = castable(def)
    const [t, events] = applyCastCharacter(s, 0, card, { dullBackups: [bk], discards: [] })
    expect(events).toContainEqual({ type: 'unimplementedAbility', card, code: 'T-3CL', clauses: 2 })
    // and the one clause that IS implemented actually ran
    const [u] = drainResolution(t)
    expect(fc(u, card)?.powerBonus).toBe(1000)
  })

  it('a fully implemented card warns about nothing', () => {
    const def = srcDef([{ kind: 'forEach', from: { zone: 'forwards', controller: 'self' }, do: [{ kind: 'addPower', amount: 1000 }] }], { code: 'T-1CL', abilityClauses: 1 })
    const { s, bk, card } = castable(def)
    const [, events] = applyCastCharacter(s, 0, card, { dullBackups: [bk], discards: [] })
    expect(events.some((e) => e.type === 'unimplementedAbility')).toBe(false)
  })

  it('a wholly unimplemented card keeps the rung-A log line, with no `clauses` field', () => {
    const def = makeDef({ code: 'T-0CL', cost: 1, power: 1000, hasAbilities: true, abilityClauses: 3, text: 'three unimplemented clauses' })
    const { s, bk, card } = castable(def)
    const [, events] = applyCastCharacter(s, 0, card, { dullBackups: [bk], discards: [] })
    expect(events).toContainEqual({ type: 'unimplementedAbility', card, code: 'T-0CL' })
  })

  it('a Summon with an implemented summonResolve clause resolves instead of reporting no effect', () => {
    const ability: Ability = { id: 'T-SUM:resolve', trigger: 'summonResolve', text: 'Deal 2000 damage to all opponent Forwards.', effects: [{ kind: 'forEach', from: { zone: 'forwards', controller: 'opponent' }, do: [{ kind: 'damage', amount: 2000 }] }] }
    const def = makeDef({ code: 'T-SUM', type: 'summon', cost: 1, power: null, hasAbilities: true, abilityClauses: 1, abilities: [ability], text: ability.text })
    let { s, bk, card } = castable(def); let victim: CardId
    ;[s, victim] = withField(s, 1, 'forwards', 'V-F8')
    const [t, events] = applyCastSummon(s, 0, card, { dullBackups: [bk], discards: [] })
    expect(events.some((e) => e.type === 'summonResolvedNoEffect')).toBe(false)
    expect(t.players[0].breakZone).toContain(card)   // the summon resolves FROM the break zone (§7.10.1)
    const [u] = drainResolution(t)
    expect(fc(u, victim)?.damage).toBe(2000)
  })
})

/**
 * Spec C1-A7: a random walk over an ability-bearing pool must never reach an illegal state, a dead end (a
 * pending with no legal answer), or a trigger loop. Every C1 shape is in the pool: `0..2` modal selection, a
 * nested target choice inside a mode, an untargeted mass pump, Break-Zone retrieval, and the Summon path.
 */
const FUZZ_POOL: CardDef[] = VANILLA_POOL.map((d, i) => {
  if (d.type === 'forward' && i % 2 === 0) {
    return makeDef({ ...d, hasAbilities: true, abilityClauses: 2, abilities: [{
      id: `${d.code}:etb`, trigger: 'enterField', text: 'synthetic modal ETB', effects: [
        { kind: 'chooseModes', min: 0, max: 2, modes: [
          { label: 'dull up to 2', effects: [{ kind: 'chooseTargets', min: 1, max: 2, from: { zone: 'forwards', controller: 'opponent' }, then: [{ kind: 'dull' }] }] },
          { label: 'pump the team', effects: [{ kind: 'forEach', from: { zone: 'forwards', controller: 'self' }, do: [{ kind: 'addPower', amount: 1000 }, { kind: 'grantKeyword', keyword: 'haste' }] }] },
          { label: 'retrieve a Forward', effects: [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'breakZone', controller: 'self', filter: { type: 'forward' } }, then: [{ kind: 'moveToHand' }] }] },
        ] },
      ],
    }] })
  }
  if (d.type === 'summon') {
    return makeDef({ ...d, hasAbilities: true, abilityClauses: 1, abilities: [{
      id: `${d.code}:resolve`, trigger: 'summonResolve', text: 'synthetic summon effect', effects: [
        { kind: 'chooseTargets', min: 0, max: 1, from: { zone: 'forwards', controller: 'any' }, then: [{ kind: 'damage', amount: 7000 }, { kind: 'grantFlag', flag: 'cannotBeBroken' }] },
      ],
    }] })
  }
  return d
})

describe('random walks with abilities on (spec C1-A7)', () => {
  it('20 seeds x 500 commands: no illegal state, no dead end, no trigger loop', () => {
    const deck = deckOf(FUZZ_POOL.map((d) => d.code))
    for (let seed = 1; seed <= 20; seed++) {
      let s = createGame({ seed, decks: [deck, deck], defs: FUZZ_POOL })
      let r = seed * 7919
      for (let i = 0; i < 500 && !s.result; i++) {
        const p = actingPlayer(s)
        expect(p, `seed ${seed} step ${i}`).not.toBeNull()
        const legal = legalCommands(s, p!).filter((c) => c.type !== 'concede')
        expect(legal.length, `seed ${seed} step ${i}: dead end at ${JSON.stringify(s.pending)}`).toBeGreaterThan(0)
        r = (r * 1103515245 + 12345) % 2147483648
        s = apply(s, legal[r % legal.length]!).state
        expect(checkInvariants(s), `seed ${seed} step ${i}`).toEqual([])
      }
    }
  })
})

describe('§12.4.5: a Forward killed by ABILITY damage is broken', () => {
  // `settle()` ran rule processes at the top of its loop and broke out the instant the agenda emptied, so the
  // drain that finished an ability had no rule process after it: a Forward with damage >= power stayed on the
  // board indefinitely. Found by probe, not by any test — combat damage runs its own rule process inside
  // `resolveDamage`, so only ABILITY damage was exposed, and nothing exercised it.
  const victimDef = makeDef({ code: 'T-VICTIM', cost: 1, power: 5000 })

  /** The source is CAST (not pre-placed), so its ETB fires the way it does in a real game. */
  const castBurner = (amount: number): { state: GameState; victim: CardId } => {
    // cost 0 so an empty payment is legal (§11.2.2.4) — this test is about §12.4.5, not about paying.
    const burner = srcDef([{ kind: 'forEach', from: { zone: 'forwards', controller: 'opponent' }, do: [{ kind: 'damage', amount }] }], { cost: 0 })
    let s = makeGame({ defs: [...VANILLA_POOL, burner, victimDef] })
    let victim: CardId
    ;[s, victim] = withField(s, 1, 'forwards', 'T-VICTIM')
    let src: CardId
    ;[s, src] = withHand(s, 0, 'T-SRC')
    // Through the PUBLIC reducer: `settle()` inside `apply` is what drains the agenda and then runs the rule
    // processes. Calling applyCastCharacter directly only enqueues the trigger, which is the whole bug's hiding place.
    const { state } = apply(s, { type: 'castCharacter', player: 0, card: src, payment: { dullBackups: [], discards: [] } })
    return { state, victim }
  }

  it('untargeted forEach damage breaks the victim', () => {
    const { state, victim } = castBurner(5000)
    expect(fc(state, victim), 'a 5000-power Forward dealt 5000 must not still be on the field').toBeUndefined()
    expect(state.players[1].breakZone).toContain(victim)
  })

  it('leaves a Forward alive when the damage is not lethal', () => {
    const { state, victim } = castBurner(4000)
    expect(fc(state, victim)?.damage).toBe(4000)
  })
})


describe('a frame is atomic across the commands that answer it (Codex HIGH)', () => {
  // Ramuh may legally select BOTH "deal it 5000 damage" and "it gains Haste", and target the SAME Forward with
  // each. The second prompt is raised while lethal damage is already on that Forward. `settle()` used to run
  // rule processes on the way back in, breaking the target before the frame resumed, so the Haste silently
  // applied to nothing. A frame must run to completion across its own prompts; rule processes go between frames.
  const victimDef = makeDef({ code: 'T-VICTIM5', cost: 1, power: 5000 })
  const twoModes = srcDef([{
    kind: 'chooseModes', min: 2, max: 2,
    modes: [
      { label: 'damage', effects: [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'opponent' }, then: [{ kind: 'damage', amount: 5000 }] }] },
      { label: 'haste', effects: [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'opponent' }, then: [{ kind: 'grantKeyword', keyword: 'haste' }] }] },
    ],
  }], { cost: 0 })

  it('grants the keyword to a target the earlier mode has already dealt lethal damage to', () => {
    let s = makeGame({ defs: [...VANILLA_POOL, twoModes, victimDef] })
    let victim: CardId
    ;[s, victim] = withField(s, 1, 'forwards', 'T-VICTIM5')
    let src: CardId
    ;[s, src] = withHand(s, 0, 'T-SRC')

    let r = apply(s, { type: 'castCharacter', player: 0, card: src, payment: { dullBackups: [], discards: [] } })
    const events: Event[] = [...r.events]
    expect(r.state.pending?.kind, 'the mode choice must be raised').toBe('chooseMode')

    r = apply(r.state, { type: 'chooseMode', player: 0, modes: [0, 1] })
    events.push(...r.events)
    expect(r.state.pending?.kind).toBe('chooseTargets')
    expect(r.state.pending?.kind === 'chooseTargets' && r.state.pending.candidates).toContain(victim)

    r = apply(r.state, { type: 'chooseTargets', player: 0, targets: [victim] })   // 5000 damage — now lethal
    events.push(...r.events)
    // The SECOND prompt must still offer the target: the frame owns it until it finishes.
    expect(r.state.pending?.kind, 'the haste prompt must still be raised').toBe('chooseTargets')
    expect(r.state.pending?.kind === 'chooseTargets' && r.state.pending.candidates, 'a card the frame already chose must not be broken out from under it').toContain(victim)

    r = apply(r.state, { type: 'chooseTargets', player: 0, targets: [victim] })
    events.push(...r.events)
    expect(events.some((e) => e.type === 'keywordGranted'), 'the Haste must actually be granted, not silently skipped').toBe(true)
    // …and only once the frame is done does §12.4.5 collect it.
    expect(fc(r.state, victim)).toBeUndefined()
    expect(r.state.players[1].breakZone).toContain(victim)
    ok(r.state)
  })
})
