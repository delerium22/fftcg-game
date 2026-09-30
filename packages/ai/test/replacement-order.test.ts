import { describe, expect, it } from 'vitest'
import {
  apply, determinise, isLegal, legalCommands, seedRng, viewFor,
  type Ability, type CardDef, type CardId, type Command, type DamageChange, type DamageScope, type GameState,
} from '@fftcg/engine'
import { candidateCommands } from '../src/candidates.js'
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
