import { describe, expect, it } from 'vitest'
import type { Ability, AbilityCost } from '../src/abilities.js'
import type { CardDef } from '../src/types.js'
import type { CardId, GameState } from '../src/state.js'
import { findFieldCard, flagsOf } from '../src/state.js'
import { legalCommands } from '../src/legal.js'
import { activationCheck } from '../src/activate.js'
import { deckOf, makeDef, makeGame, VANILLA_POOL, withField, withHand } from './helpers.js'

/**
 * Rung V1-A3 (spec V1-D15): Charlotte 27-128S's third clause — "Forwards your opponent controls cannot use action
 * abilities." A continuous `grantFlag` of `cannotUseActionAbilities` over the opponent's Forwards, read by
 * `activationCheck`. An ACTION ability is §11.6; a special ability is §11.7 and is not one, so it stays usable.
 */

const BAN: Ability = {
  id: 'T-CHARLOTTE:ban', trigger: { kind: 'static', effect: { kind: 'grantFlag', flag: 'cannotUseActionAbilities', to: { controller: 'opponent', filter: { type: 'forward' } } } },
  text: 'Forwards your opponent controls cannot use action abilities.', effects: [],
}
const act = (code: string, cost: AbilityCost = { cp: { amount: 0 } }): Ability =>
  ({ id: `${code}:act`, trigger: { kind: 'activated', sourceZone: 'field', cost }, text: 'synthetic: draw 1', effects: [{ kind: 'draw', count: 1 }] })
const special: Ability = {
  id: 'T-ACTF:beam', trigger: { kind: 'activated', sourceZone: 'field', cost: { discardSameName: true }, special: { name: 'T Beam' } },
  text: 'T Beam [S]: draw 1', effects: [{ kind: 'draw', count: 1 }],
}
const DEFS: CardDef[] = [
  ...VANILLA_POOL,
  makeDef({ code: 'T-CHARLOTTE', name: 'Charlotte', cost: 3, power: 7000, hasAbilities: true, abilityClauses: 1, abilities: [BAN] }),
  makeDef({ code: 'T-ACTF', name: 'Actor', cost: 2, power: 5000, generic: false, hasAbilities: true, abilityClauses: 2, abilities: [act('T-ACTF'), special] }),
  makeDef({ code: 'T-ACTB', type: 'backup', cost: 2, power: null, hasAbilities: true, abilityClauses: 1, abilities: [act('T-ACTB')] }),
]

/** Player 0 controls Charlotte; each side has an action-ability Forward; player 1 also a Backup and a same-name card. */
function board(): { s: GameState; charlotte: CardId; theirs: CardId; mine: CardId; backup: CardId } {
  let s = makeGame({ defs: DEFS, decks: [deckOf(VANILLA_POOL.map((d) => d.code)), deckOf(VANILLA_POOL.map((d) => d.code))] })
  let charlotte: CardId, theirs: CardId, mine: CardId, backup: CardId
  ;[s, charlotte] = withField(s, 0, 'forwards', 'T-CHARLOTTE')
  ;[s, mine] = withField(s, 0, 'forwards', 'T-ACTF')
  ;[s, theirs] = withField(s, 1, 'forwards', 'T-ACTF')
  ;[s, backup] = withField(s, 1, 'backups', 'T-ACTB')
  ;[s] = withHand(s, 1, 'T-ACTF')
  return { s, charlotte, theirs, mine, backup }
}
/** Player 1 holding priority in player 0's Main Phase, where an action ability may be used (§9.3.1.7). */
const theirPriority = (s: GameState): GameState => ({ ...s, priority: 1 })
const usable = (s: GameState, p: 0 | 1): string[] =>
  legalCommands(s, p).flatMap((c) => (c.type === 'activateAbility' ? [`${c.source}:${c.abilityId}`] : []))

describe('V1-A3 — "Forwards your opponent controls cannot use action abilities" (Charlotte)', () => {
  it('L1 §11.6 — the opponent’s Forward cannot use its action ability, and the refusal names the ban', () => {
    const { s, theirs } = board()
    const t = theirPriority(s)
    expect(flagsOf(t, findFieldCard(t, theirs)!.card).has('cannotUseActionAbilities')).toBe(true)
    expect(activationCheck(t, 1, theirs, 'T-ACTF:act')).toMatch(/cannot use action abilities/)
    expect(usable(t, 1)).not.toContain(`${theirs}:T-ACTF:act`)
  })

  it('L1 §11.7 — its special ability is not an action ability, and stays usable', () => {
    const { s, theirs } = board()
    const t = theirPriority(s)
    expect(activationCheck(t, 1, theirs, 'T-ACTF:beam')).toBeNull()
    expect(usable(t, 1)).toContain(`${theirs}:T-ACTF:beam`)
  })

  it('L1 §11.6 — the opponent’s Backup, not a Forward, still uses its action ability; the controller’s own Forward too', () => {
    const { s, backup, mine } = board()
    expect(usable(theirPriority(s), 1)).toContain(`${backup}:T-ACTB:act`)
    expect(activationCheck(s, 0, mine, 'T-ACTF:act')).toBeNull()
    expect(usable(s, 0)).toContain(`${mine}:T-ACTF:act`)
  })

  it('L1 §11.6 — the ban lifts when its source leaves the field', () => {
    const { s, charlotte, theirs } = board()
    const gone: GameState = { ...s, players: [{ ...s.players[0], forwards: s.players[0].forwards.filter((c) => c.id !== charlotte), breakZone: [...s.players[0].breakZone, charlotte] }, s.players[1]] }
    expect(activationCheck(theirPriority(gone), 1, theirs, 'T-ACTF:act')).toBeNull()
  })
})
