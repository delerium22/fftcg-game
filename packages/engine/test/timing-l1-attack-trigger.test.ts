import { describe, expect, it } from 'vitest'
import type { Ability } from '../src/abilities.js'
import type { CardDef } from '../src/types.js'
import type { CardId, GameState } from '../src/state.js'
import { apply } from '../src/apply.js'
import { checkInvariants } from '../src/invariants.js'
import { endPhase, makeDef, makeGame, passBoth, withField, withHandSize, VANILLA_POOL } from './helpers.js'

/**
 * Rung V1-A1 (spec V1-D5, CR §10.1.2.4–5): "when this attacks" fires as the Forward is declared an attacker. The
 * clause is placed on the stack before the turn player gains priority in the `declared` window (§10.1.2.6), so
 * it resolves before the block is owed. Synthetic cards; real passes.
 */

const ok = (s: GameState) => expect(checkInvariants(s)).toEqual([])
const quiet = (s: GameState): GameState => withHandSize(withHandSize(s, 0, 0), 1, 0)

const ATTACK_DRAW: Ability = {
  id: 'T-ATK:draw', trigger: { kind: 'attacks' }, text: 'When this attacks, draw 1 card.',
  effects: [{ kind: 'draw', count: 1 }],
}
const DEFS: CardDef[] = [
  ...VANILLA_POOL,
  makeDef({ code: 'T-ATK', cost: 0, power: 5000, elements: ['earth'], hasAbilities: true, abilityClauses: 1, abilities: [ATTACK_DRAW] }),
]

/** Player 0's declaration step with `n` T-ATK Forwards on its field. */
function board(n: number): { s: GameState; ids: CardId[] } {
  let s = quiet(endPhase(makeGame({ defs: DEFS })))
  const ids: CardId[] = []
  for (let i = 0; i < n; i++) { let id: CardId; [s, id] = withField(s, 0, 'forwards', 'T-ATK'); ids.push(id) }
  expect(s.attack?.step).toBe('declaration')
  return { s, ids }
}
const stackSources = (s: GameState) => s.stack.map((i) => (i.kind === 'ability' ? { source: i.frame.source, controller: i.frame.controller, abilityId: i.frame.abilityId } : null))

describe('L1 §10.1.2.5 — "when this attacks" triggers', () => {
  it('L1 §10.1.2.5 — a Forward that attacks puts its trigger on the stack before the declared window opens to the turn player', () => {
    const { s, ids } = board(1)
    const r = apply(s, { type: 'declareAttack', player: 0, attackers: ids })
    expect(r.state.attack?.step).toBe('declared')
    expect(stackSources(r.state)).toEqual([{ source: ids[0], controller: 0, abilityId: 'T-ATK:draw' }])
    expect(r.state.priority, '§10.1.2.6: the turn player gains priority with the trigger already on the stack').toBe(0)
    expect(r.events.findIndex((e) => e.type === 'stackPushed')).toBeGreaterThan(r.events.findIndex((e) => e.type === 'attackDeclared'))
    ok(r.state)
    const hand = r.state.players[0].hand.length
    const w = passBoth(r.state)
    expect(w.state.stack).toEqual([])
    expect(w.state.players[0].hand.length, 'player 0 drew 1').toBe(hand + 1)
    expect(w.state.attack?.step, 'the trigger resolves inside the declared window; the block is not yet owed').toBe('declared')
    expect(w.state.pending).toBeNull()
    ok(w.state)
  })

  it('L1 §10.1.2.5 — a party: each attacking member places its own trigger', () => {
    const { s, ids } = board(2)
    const r = apply(s, { type: 'declareAttack', player: 0, attackers: ids })
    expect(r.state.stack).toHaveLength(2)
    const sources = stackSources(r.state)
    expect(sources.map((x) => x?.source).sort(), 'two distinct attackers are the sources').toEqual([...ids].sort())
    expect(sources.every((x) => x?.controller === 0 && x.abilityId === 'T-ATK:draw')).toBe(true)
    expect(r.state.priority).toBe(0)
    ok(r.state)
  })

  it('a Forward that does not attack does not trigger', () => {
    const { s, ids } = board(2)
    const r = apply(s, { type: 'declareAttack', player: 0, attackers: [ids[0]!] })
    expect(stackSources(r.state)).toEqual([{ source: ids[0], controller: 0, abilityId: 'T-ATK:draw' }])
    ok(r.state)
  })
})
