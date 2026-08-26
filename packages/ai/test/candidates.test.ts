import { describe, expect, it } from 'vitest'
import { EMPTY_RESOLUTION, apply, attackCheck, defOf, drainResolution, enqueueTrigger, legalCommands, type Ability, type CardDef, type CardId, type Command, type Effect, type GameState, type PlayerId } from '@fftcg/engine'
import { candidateCommands } from '../src/candidates.js'
import { cardValue } from '../src/cardValue.js'
import { VANILLA_POOL, makeDef, makeGame, withField, withHand, withHandSize } from '../../engine/test/helpers.js'

/** A synthetic one-clause ability. The AI lane never depends on a real card: the policy reads the AST, not the code. */
const clause = (id: string, effects: readonly Effect[]): Ability => ({ id, trigger: 'enterField', text: `synthetic clause ${id}`, effects })
const bearer = (code: string, a: Ability): CardDef => makeDef({ code, hasAbilities: true, abilityClauses: 1, abilities: [a] })

/** Put the clause on the agenda and run it until it asks its question — exactly the state `candidateCommands` meets in play. */
const arm = (s: GameState, source: CardId, controller: PlayerId, a: Ability): GameState => drainResolution(enqueueTrigger(s, source, controller, a))[0] as GameState

const targetsOf = (c: Command | undefined): readonly CardId[] => (c?.type === 'chooseTargets' ? c.targets : [])
const modesOf = (c: Command | undefined): readonly number[] => (c?.type === 'chooseMode' ? c.modes : [])

/** Mint an instance straight into a Break Zone — `withField` only reaches the field. */
function withBreakZone(state: GameState, player: PlayerId, code: string): [GameState, CardId] {
  const [s, id] = withField(state, player, 'backups', code)
  const ps = s.players[player]
  const players: GameState['players'] = [s.players[0], s.players[1]]
  players[player] = { ...ps, backups: ps.backups.filter((c) => c.id !== id), breakZone: [...ps.breakZone, id] }
  return [{ ...s, players }, id]
}

describe('candidateCommands', () => {
  it('collapses casts to one per card and never includes concede', () => {
    let s = withHandSize(makeGame(), 0, 0); let f: number
    ;[s] = withField(s, 0, 'backups', 'V-B1'); [s] = withField(s, 0, 'backups', 'V-B3')
    ;[s] = withHand(s, 0, 'V-S2'); [s] = withHand(s, 0, 'V-B4')
    ;[s, f] = withHand(s, 0, 'V-F1')
    const c = candidateCommands(s, 0)
    expect(c.filter((x) => x.type === 'castCharacter' && x.card === f)).toHaveLength(1)
    expect(c.some((x) => x.type === 'concede')).toBe(false)
    expect(c.some((x) => x.type === 'pass')).toBe(true)
    expect(legalCommands(s, 0).filter((x) => x.type === 'castCharacter' && x.card === f).length).toBeGreaterThan(1)   // the point
    for (const x of c) expect(() => apply(s, x)).not.toThrow()   // every candidate is legal
  })
  it('chooses discards by value and mirrors legalCommands for decisions', () => {
    let s = makeGame()   // 6 cards → discard pending at end of turn
    s = apply(s, { type: 'pass', player: 0 }).state; s = apply(s, { type: 'pass', player: 0 }).state; s = apply(s, { type: 'pass', player: 0 }).state
    const c = candidateCommands(s, 0)
    expect(c).toHaveLength(1); expect(c[0]!.type).toBe('discardToHandSize')
    expect(() => apply(s, c[0]!)).not.toThrow()
    const cmd = c[0]! as Extract<Command, { type: 'discardToHandSize' }>
    const byValue = [...s.players[0].hand].sort((a, b) => cardValue(defOf(s, a)) - cardValue(defOf(s, b)))
    const pending = s.pending
    expect(cmd.cards).toEqual(byValue.slice(0, pending?.kind === 'discardToHandSize' ? pending.count : 0))
    expect(cmd.cards).toHaveLength(1)
    expect(candidateCommands(s, 1)).toEqual([])
  })
  it('F3/C5: bounds attack candidates when more than 6 forwards are eligible (singles + pairs + per-element parties), every candidate legal and deduplicated', () => {
    const defs = [...VANILLA_POOL, makeDef({ code: 'V-DUAL', elements: ['earth', 'lightning'], cost: 1, power: 3000 })]
    let s = withHandSize(makeGame({ defs }), 0, 0)
    for (let i = 0; i < 8; i++) [s] = withField(s, 0, 'forwards', 'V-DUAL')
    s = apply(s, { type: 'pass', player: 0 }).state   // main1 -> attack declaration
    const c = candidateCommands(s, 0)
    const attacks = c.filter((x): x is Extract<Command, { type: 'declareAttack' }> => x.type === 'declareAttack')
    // 8 singles + up to C(8,2)=28 pairs + 1 party per shared element (earth, lightning) = up to 8 + 28 + 2 = 38
    expect(attacks.length).toBeLessThanOrEqual(8 + 28 + 2)
    for (const a of attacks) expect(attackCheck(s, 0, a.attackers)).toBeNull()
    const signatures = attacks.map((a) => [...a.attackers].sort((x, y) => x - y).join(','))
    expect(new Set(signatures).size).toBe(signatures.length)   // no duplicate attacker sets
    expect(attacks.filter((a) => a.attackers.length === 2).length).toBeGreaterThan(0)   // pairs are present
    expect(attacks.filter((a) => a.attackers.length === 1).length).toBe(8)   // every single is a candidate
    expect(c.some((x) => x.type === 'pass')).toBe(true)
  })
})

/**
 * Rung C1. `legalCommands` enumerates Σ C(N, k) answers to a target choice; `candidateCommands` must instead
 * offer a handful ranked by a one-ply policy, BEST FIRST — a budget-starved `greedyStep` scores only the first
 * candidate, so the head of the list is the answer the AI actually plays.
 */
describe('candidateCommands: the C1 one-ply target policy', () => {
  it('dull: prefers the ACTIVE, highest-effective-power opponent Forwards, and takes the max', () => {
    const a = clause('T-DULL:etb', [{ kind: 'chooseTargets', min: 0, max: 2, from: { zone: 'forwards', controller: 'opponent' }, then: [{ kind: 'dull' }] }])
    let s = withHandSize(makeGame({ defs: [...VANILLA_POOL, bearer('T-DULL', a)] }), 0, 0)
    let src: number, small: number, big: number, alreadyDull: number
    ;[s, src] = withField(s, 0, 'forwards', 'T-DULL')
    ;[s, small] = withField(s, 1, 'forwards', 'V-F1')                          // 3000, active
    ;[s, alreadyDull] = withField(s, 1, 'forwards', 'V-F8', { status: 'dull' })  // 9000 but dulling it is a no-op
    ;[s, big] = withField(s, 1, 'forwards', 'V-F5')                            // 7000, active
    s = arm(s, src, 0, a)
    expect(s.pending?.kind).toBe('chooseTargets')
    const c = candidateCommands(s, 0)
    expect(targetsOf(c[0])).toEqual([big, small])       // both active, ranked by power…
    expect(targetsOf(c[0])).not.toContain(alreadyDull)   // …and the dull 9000 never makes the pick
    for (const cmd of c) expect(() => apply(s, cmd)).not.toThrow()
    expect(candidateCommands(s, 0)).toEqual(c)      // deterministic
  })

  it('dull: a pumped Forward is ranked on its EFFECTIVE power, not its printed power', () => {
    const a = clause('T-DULL:etb', [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'opponent' }, then: [{ kind: 'dull' }] }])
    let s = withHandSize(makeGame({ defs: [...VANILLA_POOL, bearer('T-DULL', a)] }), 0, 0)
    let src: number, printedBigger: number, pumped: number
    ;[s, src] = withField(s, 0, 'forwards', 'T-DULL')
    ;[s, printedBigger] = withField(s, 1, 'forwards', 'V-F5')                       // 7000 printed
    ;[s, pumped] = withField(s, 1, 'forwards', 'V-F1', { powerBonus: 6000 })        // 3000 + 6000 = 9000 effective
    s = arm(s, src, 0, a)
    expect(targetsOf(candidateCommands(s, 0)[0])).toEqual([pumped])
    expect(printedBigger).toBeGreaterThan(0)
  })

  it('damage: prefers the target the damage actually BREAKS over the bigger one it only scratches (§12.4.5)', () => {
    const a = clause('T-DMG:etb', [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'opponent' }, then: [{ kind: 'damage', amount: 3000 }] }])
    let s = withHandSize(makeGame({ defs: [...VANILLA_POOL, bearer('T-DMG', a)] }), 0, 0)
    let src: number, hurt: number, healthy: number
    ;[s, src] = withField(s, 0, 'forwards', 'T-DMG')
    ;[s, healthy] = withField(s, 1, 'forwards', 'V-F8')                       // 9000 undamaged: 3000 does not break it
    ;[s, hurt] = withField(s, 1, 'forwards', 'V-F5', { damage: 5000 })        // 7000 with 5000 on it: 3000 breaks it
    s = arm(s, src, 0, a)
    expect(targetsOf(candidateCommands(s, 0)[0])).toEqual([hurt])
    expect(healthy).toBeGreaterThan(0)
  })

  it('damage: a `cannotBeBroken` Forward is not treated as breakable (spec C1-7)', () => {
    const a = clause('T-DMG:etb', [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'opponent' }, then: [{ kind: 'damage', amount: 3000 }] }])
    let s = withHandSize(makeGame({ defs: [...VANILLA_POOL, bearer('T-DMG', a)] }), 0, 0)
    let src: number, protectedFc: number, plain: number
    ;[s, src] = withField(s, 0, 'forwards', 'T-DMG')
    ;[s, protectedFc] = withField(s, 1, 'forwards', 'V-F5', { damage: 5000, flags: ['cannotBeBroken'] })
    ;[s, plain] = withField(s, 1, 'forwards', 'V-F1', { damage: 2000 })   // 3000 with 2000 on it — this one really does break
    s = arm(s, src, 0, a)
    expect(targetsOf(candidateCommands(s, 0)[0])).toEqual([plain])
    expect(protectedFc).toBeGreaterThan(0)
  })

  it('break: takes the highest `cardValue` among equal-power Forwards', () => {
    const a = clause('T-BRK:etb', [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'opponent' }, then: [{ kind: 'breakCard' }] }])
    const cheap = makeDef({ code: 'T-CHEAP', cost: 1, power: 9000 })
    let s = withHandSize(makeGame({ defs: [...VANILLA_POOL, cheap, bearer('T-BRK', a)] }), 0, 0)
    let src: number, dear: number, plain: number
    ;[s, src] = withField(s, 0, 'forwards', 'T-BRK')
    ;[s, plain] = withField(s, 1, 'forwards', 'T-CHEAP')   // 9000, cost 1
    ;[s, dear] = withField(s, 1, 'forwards', 'V-F8')       // 9000, cost 5 — same power, higher cardValue
    s = arm(s, src, 0, a)
    expect(cardValue(defOf(s, dear))).toBeGreaterThan(cardValue(defOf(s, plain)))   // the fixture is genuinely non-tied
    expect(targetsOf(candidateCommands(s, 0)[0])).toEqual([dear])
  })

  it('Break-Zone retrieval: takes the highest `cardValue` card back', () => {
    const a = clause('T-RET:etb', [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'breakZone', controller: 'self', filter: { type: 'forward' } }, then: [{ kind: 'moveToHand' }] }])
    let s = withHandSize(makeGame({ defs: [...VANILLA_POOL, bearer('T-RET', a)] }), 0, 0)
    let src: number, junk: number, prize: number
    ;[s, src] = withField(s, 0, 'forwards', 'T-RET')
    ;[s, junk] = withBreakZone(s, 0, 'V-F1')    // 3000, cost 1
    ;[s, prize] = withBreakZone(s, 0, 'V-F8')   // 9000, cost 5
    s = arm(s, src, 0, a)
    expect(targetsOf(candidateCommands(s, 0)[0])).toEqual([prize])
    expect(junk).toBeGreaterThan(0)
    for (const cmd of candidateCommands(s, 0)) expect(() => apply(s, cmd)).not.toThrow()
  })

  it('Haste: only a fresh, active, unattacked Forward it makes attack-eligible is worth anything', () => {
    const a = clause('T-HASTE:etb', [{ kind: 'chooseTargets', min: 0, max: 1, from: { zone: 'forwards', controller: 'self' }, then: [{ kind: 'grantKeyword', keyword: 'haste' }] }])
    let s = withHandSize(makeGame({ defs: [...VANILLA_POOL, bearer('T-HASTE', a)] }), 0, 0)
    let src: number, stale: number, fresh: number
    ;[s, src] = withField(s, 0, 'forwards', 'T-HASTE')
    ;[s, stale] = withField(s, 0, 'forwards', 'V-F8', { enteredTurn: 0 })                 // 9000, but already attack-eligible (§10.1.2.1.1)
    ;[s, fresh] = withField(s, 0, 'forwards', 'V-F1', { enteredTurn: s.turn })            // 3000, entered this turn — Haste unlocks it
    s = arm(s, src, 0, a)
    expect(targetsOf(candidateCommands(s, 0)[0])).toEqual([fresh])   // the 9000 gains NOTHING and must not win on power
    expect(stale).toBeGreaterThan(0)
  })

  it('Haste: worth ~0 everywhere means the policy declines the choice rather than picking a body at random', () => {
    const a = clause('T-HASTE:etb', [{ kind: 'chooseTargets', min: 0, max: 1, from: { zone: 'forwards', controller: 'self' }, then: [{ kind: 'grantKeyword', keyword: 'haste' }] }])
    let s = withHandSize(makeGame({ defs: [...VANILLA_POOL, bearer('T-HASTE', a)] }), 0, 0)
    let src: number
    ;[s, src] = withField(s, 0, 'forwards', 'T-HASTE')
    ;[s] = withField(s, 0, 'forwards', 'V-F8', { status: 'dull' })      // dull: cannot attack whatever it is granted
    ;[s] = withField(s, 0, 'forwards', 'V-F5', { attackedThisTurn: true })
    s = arm(s, src, 0, a)
    const c = candidateCommands(s, 0)
    expect(targetsOf(c[0])).toEqual([])                 // "up to 1" and nothing is worth it: take none
    expect(c.length).toBeGreaterThan(1)                 // the real options are still offered to the search
    for (const cmd of c) expect(() => apply(s, cmd)).not.toThrow()
  })

  it('cannotBeBroken: valued by combat exposure — the damaged Forward over the pristine bigger one', () => {
    const a = clause('T-PROT:etb', [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'self' }, then: [{ kind: 'grantFlag', flag: 'cannotBeBroken' }] }])
    let s = withHandSize(makeGame({ defs: [...VANILLA_POOL, bearer('T-PROT', a)] }), 0, 0)
    let src: number, exposed: number, pristine: number
    ;[s, src] = withField(s, 0, 'forwards', 'T-PROT')
    ;[s, pristine] = withField(s, 0, 'forwards', 'V-F8')                         // 9000, no damage
    ;[s, exposed] = withField(s, 0, 'forwards', 'V-F5', { damage: 6000 })        // 7000 carrying 6000 — one hit from a §12.4.5 break
    s = arm(s, src, 0, a)
    expect(targetsOf(candidateCommands(s, 0)[0])).toEqual([exposed])
    expect(pristine).toBeGreaterThan(0)
  })

  it('is bounded and deterministic where `legalCommands` is combinatorial', () => {
    const a = clause('T-DULL:etb', [{ kind: 'chooseTargets', min: 0, max: 2, from: { zone: 'forwards', controller: 'opponent' }, then: [{ kind: 'dull' }] }])
    let s = withHandSize(makeGame({ defs: [...VANILLA_POOL, bearer('T-DULL', a)] }), 0, 0)
    let src: number
    ;[s, src] = withField(s, 0, 'forwards', 'T-DULL')
    for (let i = 0; i < 8; i++) [s] = withField(s, 1, 'forwards', 'V-F1')
    s = arm(s, src, 0, a)
    const c = candidateCommands(s, 0)
    expect(legalCommands(s, 0).length).toBeGreaterThan(20)   // 1 + 8 + C(8,2) = 37 answers exist
    expect(c.length).toBeLessThanOrEqual(6)                  // the policy offers a handful
    const signatures = c.map((x) => [...targetsOf(x)].sort((p, q) => p - q).join(','))
    expect(new Set(signatures).size).toBe(signatures.length)
    for (const cmd of c) expect(() => apply(s, cmd)).not.toThrow()
    expect(candidateCommands(s, 0)).toEqual(c)
  })

  it('modes: ranks a mode by what its branch would actually do, and every answer stays legal', () => {
    // The Shantotto shape: one clause, two modes, each with its own nested target choice. Dulling the
    // opponent's active 9000 is worth a great deal; granting Haste to a Forward that already attacked is worth 0.
    const a = clause('T-MODAL:etb', [{
      kind: 'chooseModes', min: 1, max: 1, modes: [
        { label: 'Haste to one of your Forwards', effects: [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'self' }, then: [{ kind: 'grantKeyword', keyword: 'haste' }] }] },
        { label: 'Dull one Forward opponent controls', effects: [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'opponent' }, then: [{ kind: 'dull' }] }] },
      ],
    }])
    let s = withHandSize(makeGame({ defs: [...VANILLA_POOL, bearer('T-MODAL', a)] }), 0, 0)
    let src: number
    ;[s, src] = withField(s, 0, 'forwards', 'T-MODAL')
    ;[s] = withField(s, 0, 'forwards', 'V-F5', { attackedThisTurn: true })   // Haste on it does nothing
    ;[s] = withField(s, 1, 'forwards', 'V-F8')                               // active 9000 worth dulling
    s = arm(s, src, 0, a)
    expect(s.pending?.kind).toBe('chooseMode')
    const c = candidateCommands(s, 0)
    expect(modesOf(c[0])).toEqual([1])                       // the dull branch, not the printed-first Haste branch
    expect(c.length).toBeLessThanOrEqual(6)
    for (const cmd of c) expect(() => apply(s, cmd)).not.toThrow()
    // …and following that answer through leads to the target choice, which the policy answers in turn.
    const next = apply(s, c[0] as Command).state
    expect(next.pending?.kind).toBe('chooseTargets')
    const after = apply(next, candidateCommands(next, 0)[0] as Command).state
    expect(after.players[1].forwards[0]?.status).toBe('dull')
  })

  it('falls back to `legalCommands` when the agenda and the pending disagree', () => {
    // The policy reads the AST through `resolution.active`; if that is missing it must still answer legally
    // rather than guess. Unreachable through `apply` — forged here precisely because the fallback is load-bearing.
    let s = withHandSize(makeGame(), 0, 0)
    let a: number, b: number
    ;[s, a] = withField(s, 1, 'forwards', 'V-F1')
    ;[s, b] = withField(s, 1, 'forwards', 'V-F5')
    const forged: GameState = { ...s, pending: { kind: 'chooseTargets', player: 0, min: 1, max: 1, candidates: [a, b] }, resolution: EMPTY_RESOLUTION }
    expect(candidateCommands(forged, 0)).toEqual(legalCommands(forged, 0).filter((c) => c.type === 'chooseTargets'))
    const forgedModes: GameState = { ...s, pending: { kind: 'chooseMode', player: 0, min: 1, max: 1, labels: ['a', 'b'] }, resolution: EMPTY_RESOLUTION }
    expect(candidateCommands(forgedModes, 0)).toEqual(legalCommands(forgedModes, 0).filter((c) => c.type === 'chooseMode'))
  })
})
