import { describe, expect, it } from 'vitest'
import {
  apply, determinise, drainResolution, enqueueTrigger, isLegal, legalCommands, seedRng, viewFor,
  type Ability, type CardDef, type CardId, type Command, type DamageChange, type DamageScope, type GameState,
} from '@fftcg/engine'
import { candidateCommands } from '../src/candidates.js'
import { DEFAULT_WEIGHTS, evaluate, resolveWeights } from '../src/evaluate.js'
import { GreedyAgent } from '../src/greedy.js'
import { IsmctsAgent } from '../src/ismcts/agent.js'
import { actionKey, decodeAction, observationKey } from '../src/ismcts/keys.js'
import { VANILLA_POOL, attackInto, blockWith, endPhase, makeDef, makeGame, withField } from '../../engine/test/helpers.js'

/**
 * Rung V2-A2 (plan A2-D4, A2-D6, R5, R6): the AI answers a `chooseReplacementOrder` — the policy puts the order that
 * lets the least damage through first, and the search keys and decodes the answer by index.
 */

const replacement = (code: string, slug: string, affects: DamageScope, change: DamageChange): Ability => ({
  id: `${code}:${slug}`, trigger: { kind: 'static', effect: { kind: 'damageReplacement', id: slug, affects, change } }, text: 'synthetic', effects: [],
})
const withAbilities = (def: CardDef, ...abilities: Ability[]): CardDef => ({ ...def, hasAbilities: true, abilityClauses: abilities.length, abilities })
const WUK = withAbilities(makeDef({ code: 'A-WUK', power: 8000 }), replacement('A-WUK', 'wuk', { target: { controller: 'any' }, bySource: { controller: 'self', filter: { type: 'forward' } } }, { add: 2000 }))
const NULL = withAbilities(makeDef({ code: 'A-NULL', power: 7000 }), replacement('A-NULL', 'null', { target: 'self' }, { becomes: 0 }))
const POOL = [...VANILLA_POOL, WUK, NULL]

const decksOf = (s: GameState): [string[], string[]] => ([0, 1] as const).map((p) => {
  const q = s.players[p]
  return [...q.deck, ...q.hand, ...q.forwards.map((c) => c.id), ...q.backups.map((c) => c.id), ...q.damageZone, ...q.breakZone, ...q.removedFromGame].map((id) => s.cards[id]!.code)
}) as [string[], string[]]

/** P0 attacks with a Forward under Wuk Lamat into P1's "becomes 0" blocker: P1 owes the order (outcomes 0 and 2000). */
function asked(): { s: GameState; b: CardId } {
  let s = makeGame({ defs: POOL }); let a: CardId, b: CardId
  ;[s] = withField(s, 0, 'forwards', 'A-WUK')
  ;[s, a] = withField(s, 0, 'forwards', 'V-F8')
  ;[s, b] = withField(s, 1, 'forwards', 'A-NULL')
  s = blockWith(attackInto(endPhase(s), [a]).state, b).state
  if (s.pending?.kind !== 'chooseReplacementOrder') throw new Error('fixture: no order owed')
  return { s, b }
}
const zeroOption = (s: GameState): number => (s.pending?.kind === 'chooseReplacementOrder' ? s.pending.outcomes.findIndex((o) => o.final === 0) : -1)

describe('the AI and a replacement order (rung V2-A2)', () => {
  it('candidates: every order, the least damage to its own Forward first (plan R6)', () => {
    const { s } = asked()
    const cands = candidateCommands(s, 1)
    expect(cands).toHaveLength(2)
    expect(cands[0]).toEqual({ type: 'chooseReplacementOrder', player: 1, order: zeroOption(s) })
    for (const c of cands) expect(isLegal(s, c)).toBeNull()
  })

  it('greedy answers with the order that takes no damage', () => {
    const { s, b } = asked()
    const cmd = new GreedyAgent({ seed: 1, decks: decksOf(s) }).decide(viewFor(s, 1), legalCommands(s, 1))
    expect(cmd).toEqual({ type: 'chooseReplacementOrder', player: 1, order: zeroOption(s) })
    const after = apply(s, cmd).state
    expect(after.players[1].forwards.find((c) => c.id === b)?.damage).toBe(0)
  })

  it('the search answers with a legal order', () => {
    const { s } = asked()
    const cmd = new IsmctsAgent({ seed: 1, decks: decksOf(s), iterations: 16 }).decide(viewFor(s, 1), legalCommands(s, 1))
    expect(cmd.type).toBe('chooseReplacementOrder')
    expect(isLegal(s, cmd)).toBeNull()
  })

  it('keys: each answer round-trips through its key in a determinised world, and the pending is in the observation', () => {
    const { s } = asked()
    const v = viewFor(s, 1)
    const [world] = determinise({ view: v, decks: decksOf(s), rng: seedRng(9) })
    const wv = viewFor(world, 1)
    for (const c of legalCommands(s, 1).filter((x): x is Extract<Command, { type: 'chooseReplacementOrder' }> => x.type === 'chooseReplacementOrder')) {
      expect(decodeAction(wv, actionKey(v, c))).toEqual(c)
    }
    expect(decodeAction(wv, actionKey(v, { type: 'chooseReplacementOrder', player: 1, order: 7 }))).toBeNull()
    expect(observationKey(wv)).toBe(observationKey(v))
    // The digest names the options: a different outcome is a different information set.
    const p = s.pending as Extract<GameState['pending'], { kind: 'chooseReplacementOrder' }>
    const other = { ...v, pending: { ...p, outcomes: p.outcomes.map((o) => ({ ...o, final: o.final + 1000 })) } }
    expect(observationKey(other)).not.toBe(observationKey(v))
  })
})

describe('pricing damage and shields (rung V2-A2, plan A2-D6)', () => {
  /** Charlotte's shape: "reduce the damage by 1000" — a 1000 hit on her is 0, which is not damage. */
  const CHAR = withAbilities(makeDef({ code: 'A-CHAR', power: 1000 }), replacement('A-CHAR', 'self', { target: 'self' }, { reduce: 1000 }))
  const PING: Ability = { id: 'A-PING:etb', trigger: { kind: 'enterField' }, text: 'synthetic',
    effects: [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'opponent' }, then: [{ kind: 'damage', amount: 1000 }] }] }
  const PINGER = withAbilities(makeDef({ code: 'A-PING', type: 'backup', power: null }), PING)
  const SHIELD: Ability = { id: 'A-SH:etb', trigger: { kind: 'enterField' }, text: 'synthetic',
    effects: [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'any' }, then: [{ kind: 'shieldNextDamage', amount: 2000 }] }] }
  const SHIELDER = withAbilities(makeDef({ code: 'A-SH', type: 'backup', power: null }), SHIELD)
  const PPOOL = [...POOL, CHAR, PINGER, SHIELDER, makeDef({ code: 'A-ONE', power: 1000 })]

  it("the target policy prices damage after the replacements: 1000 into Charlotte's shape is nothing, so the plain 1000 Forward comes first", () => {
    let s = makeGame({ defs: PPOOL }); let src: CardId, ch: CardId, plain: CardId
    ;[s, src] = withField(s, 0, 'backups', 'A-PING')
    ;[s, ch] = withField(s, 1, 'forwards', 'A-CHAR')
    ;[s, plain] = withField(s, 1, 'forwards', 'A-ONE')
    s = drainResolution(enqueueTrigger(s, src, 0, PING))[0]
    expect(s.pending?.kind).toBe('chooseTargets')
    expect(candidateCommands(s, 0)[0]).toEqual({ type: 'chooseTargets', player: 0, targets: [plain] })
    expect(ch).toBeGreaterThan(0)
  })

  it("a shield is worth something to its Forward's side: the policy shields its own Forward, not the opponent's", () => {
    let s = makeGame({ defs: PPOOL }); let src: CardId, mine: CardId
    ;[s, src] = withField(s, 0, 'backups', 'A-SH')
    ;[s] = withField(s, 1, 'forwards', 'V-F2')        // the lower id: a tie would pick it
    ;[s, mine] = withField(s, 0, 'forwards', 'V-F2')
    s = drainResolution(enqueueTrigger(s, src, 0, SHIELD))[0]
    expect(candidateCommands(s, 0)[0]).toEqual({ type: 'chooseTargets', player: 0, targets: [mine] })
  })

  it('evaluate: a shield adds `shield` × reduce/1000, and nothing when there is none (the frozen corpus has none)', () => {
    let s = makeGame({ defs: PPOOL }); let f: CardId
    ;[s, f] = withField(s, 0, 'forwards', 'V-F2')
    const shielded: GameState = { ...s, players: [{ ...s.players[0], forwards: s.players[0].forwards.map((c) => (c.id === f ? { ...c, shields: [{ id: 'x:1:0', reduce: 2000, source: f }] } : c)) }, s.players[1]] }
    expect(DEFAULT_WEIGHTS.shield).toBe(0.5)
    // `evaluate` is mine × 2(1 − aggression) − theirs × 2·aggression; at aggression 0 it is twice my material.
    expect(evaluate(shielded, 0, DEFAULT_WEIGHTS, 0) - evaluate(s, 0, DEFAULT_WEIGHTS, 0)).toBeCloseTo(2 * 0.5 * 2)
    expect(evaluate(shielded, 0, resolveWeights({ shield: 0 }), 0)).toBe(evaluate(s, 0, DEFAULT_WEIGHTS, 0))
  })
})
