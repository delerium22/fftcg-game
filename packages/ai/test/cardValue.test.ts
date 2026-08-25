import { describe, expect, it } from 'vitest'
import { cardValue } from '../src/cardValue.js'
import { makeDef } from '../../engine/test/helpers.js'

describe('cardValue', () => {
  it('ranks a big forward above a small one, a backup above a summon, and a summon lowest', () => {
    const big = cardValue(makeDef({ code: 'A', cost: 5, power: 9000 })), small = cardValue(makeDef({ code: 'B', cost: 1, power: 3000 }))
    const backup = cardValue(makeDef({ code: 'C', type: 'backup', cost: 2, power: null })), summon = cardValue(makeDef({ code: 'D', type: 'summon', cost: 2, power: null }))
    const dearBackup = cardValue(makeDef({ code: 'E', type: 'backup', cost: 4, power: null })), dearSummon = cardValue(makeDef({ code: 'F', type: 'summon', cost: 5, power: null }))
    expect(big).toBeGreaterThan(small); expect(small).toBeGreaterThan(summon); expect(backup).toBeGreaterThan(summon); expect(dearBackup).toBeGreaterThan(dearSummon)
  })
})
