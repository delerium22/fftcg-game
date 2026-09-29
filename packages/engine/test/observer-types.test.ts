import { describe, expect, it } from 'vitest'
import type { Ability } from '../src/abilities.js'
import type { CardDef } from '../src/types.js'
import type { CardId } from '../src/state.js'
import { findFieldCard } from '../src/state.js'
import { checkInvariants } from '../src/invariants.js'
import { applyNow as apply, makeDef, makeGame, VANILLA_POOL, withField, withHand } from './helpers.js'

/**
 * Rung V1-A5: an enters-the-field observer may watch several card TYPES. LB Luso 23-130H prints "When a Job Standard
 * Unit enters your field", and a Standard Unit may be a Forward (Dragoon 1-147C) or a Backup (Geomancer 18-064C).
 */

const FREE = { dullBackups: [], discards: [] }
const WATCH: Ability = {
  id: 'T-UNITWATCH:enter', trigger: { kind: 'observesEnterField', whose: 'self', of: ['forward', 'backup'], filter: { job: 'Standard Unit' } },
  text: 'When a Job Standard Unit enters your field, draw 1 card.', effects: [{ kind: 'draw', count: 1 }],
}
const DEFS: CardDef[] = [
  ...VANILLA_POOL,
  makeDef({ code: 'T-UNITWATCH', cost: 0, power: 5000, hasAbilities: true, abilityClauses: 1, abilities: [WATCH] }),
  makeDef({ code: 'T-SU-F', cost: 0, power: 5000, job: 'Standard Unit' }),
  makeDef({ code: 'T-SU-B', type: 'backup', cost: 0, power: null, job: 'Standard Unit' }),
  makeDef({ code: 'T-OTHER', cost: 0, power: 5000, job: 'Knight' }),
]
const fired = (events: readonly { type: string; abilityId?: string }[]) => events.filter((e) => e.type === 'abilityTriggered' && e.abilityId === 'T-UNITWATCH:enter').length

describe('V1-A5 — observesEnterField over a list of types', () => {
  it('L1 §11.8.1 — a watcher of Forwards and Backups fires for a Standard Unit of either type, and not for another job', () => {
    for (const [code, expected] of [['T-SU-F', 1], ['T-SU-B', 1], ['T-OTHER', 0]] as const) {
      let s = makeGame({ defs: DEFS }); let card: CardId
      ;[s] = withField(s, 0, 'forwards', 'T-UNITWATCH')
      ;[s, card] = withHand(s, 0, code)
      const r = apply(s, { type: 'castCharacter', player: 0, card, payment: FREE })
      expect(fired(r.events), code).toBe(expected)
      expect(findFieldCard(r.state, card)).not.toBeNull()
      expect(checkInvariants(r.state)).toEqual([])
    }
  })
})
