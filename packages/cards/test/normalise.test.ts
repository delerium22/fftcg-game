import { describe, expect, it } from 'vitest'
import { normaliseSeCard, parseKeywords, parseLimitBreak, cleanText, textLines, type SeCard } from '../src/normalise.js'

const base: SeCard = {
  code: '1-014C', name_en: 'Samurai', type_en: 'Forward', element: ['火'], cost: '3', power: '5000',
  multicard: '1', ex_burst: '0',
  text_en: 'Brave (Attacking does not cause this Forward to dull.)',
}

describe('normaliseSeCard', () => {
  it('maps elements, numbers, flags', () => {
    const c = normaliseSeCard(base)
    expect(c).toMatchObject({ code: '1-014C', name: 'Samurai', type: 'forward', elements: ['fire'], cost: 3, power: 5000, generic: true, exBurst: false })
  })
  it('treats power 0 on non-Forwards as null', () => {
    const c = normaliseSeCard({ ...base, type_en: 'Backup', power: '0', text_en: '' })
    expect(c.power).toBeNull()
  })
  it('maps dual elements in order', () => {
    expect(normaliseSeCard({ ...base, element: ['土', '雷'] }).elements).toEqual(['earth', 'lightning'])
  })
  it('throws on null element (token cards)', () => {
    expect(() => normaliseSeCard({ ...base, element: null })).toThrow(/element/)
  })
})

describe('parseKeywords', () => {
  it('reads a bare keyword line', () => {
    expect(parseKeywords('Haste')).toEqual(['haste'])
  })
  it('reads keyword lines with reminder text and other lines', () => {
    expect(parseKeywords('Brave (Attacking does not cause this Forward to dull.)[[br]]When X attacks, draw 1 card.')).toEqual(['brave'])
  })
  it('reads First Strike and Back Attack', () => {
    expect(parseKeywords('First Strike[[br]]Back Attack')).toEqual(['firstStrike', 'backAttack'])
  })
  it('does not treat granted keywords as innate', () => {
    expect(parseKeywords('When X enters the field, it gains Haste until the end of the turn.')).toEqual([])
  })
})

describe('Limit Break (rung J8, §15.2.8.2)', () => {
  it('reads "Limit Break -- X" as the LB cost, and neither it nor the LB reminder line is a clause', () => {
    const maat = '(Cards with 《LB》 cannot be included in your main deck.)[[br]]   [[i]]Limit Break -- 1[[/]][[br]]   Brave[[br]]   When Maat enters the field, all the Forwards you control gain +1000 power.'
    expect(parseLimitBreak(maat)).toBe(1)
    const c = normaliseSeCard({ ...base, text_en: maat })
    expect(c.limitBreak).toBe(1)
    expect(c.keywords).toEqual(['brave'])
    expect(c.hasAbilities, 'the ETB is the one clause').toBe(true)
    expect(normaliseSeCard({ ...base, text_en: '[[i]]Limit Break -- 2[[/]]' }).hasAbilities, 'the LB line alone is no clause').toBe(false)
    expect(normaliseSeCard(base).limitBreak, 'absent on an ordinary card').toBeUndefined()
    expect(parseLimitBreak('Brave')).toBeUndefined()
  })
})

describe('a special ability line (rung V1-A3, §11.7.1, R4)', () => {
  it('reads "[[s]]Name[[/]] 《S》《ダル》: effect" as ONE printed line, the proper name and the S icon kept', () => {
    const jecht = '《火》《水》: Jecht gains Haste, First Strike and Brave until the end of the turn. You can only use this ability during your turn.[[br]][[s]]Jecht Beam[[/]] 《S》《ダル》: Choose 1 Forward. Deal it 8000 damage.'
    expect(textLines(jecht)).toEqual([
      '[Fire][Water]: Jecht gains Haste, First Strike and Brave until the end of the turn. You can only use this ability during your turn.',
      'Jecht Beam [S][Dull]: Choose 1 Forward. Deal it 8000 damage.',
    ])
    expect(normaliseSeCard({ ...base, text_en: jecht }).hasAbilities).toBe(true)
  })
})

describe('cleanText / hasAbilities', () => {
  it('strips markup and joins lines with newlines', () => {
    expect(cleanText('[[ex]]EX BURST[[/]] When [[i]]Card Name Noel[[/]] enters the field.[[br]]《雷》《ダル》: Draw 1 card.'))
      .toBe('EX BURST When Card Name Noel enters the field.\n[Lightning][Dull]: Draw 1 card.')
  })
  it('hasAbilities is false for keyword-only or empty text', () => {
    expect(normaliseSeCard(base).hasAbilities).toBe(false)
    expect(normaliseSeCard({ ...base, text_en: '' }).hasAbilities).toBe(false)
    expect(normaliseSeCard({ ...base, text_en: 'Brave[[br]]When Samurai attacks, draw 1 card.' }).hasAbilities).toBe(true)
  })
})

import { cardDb } from '../src/index.js'
describe('cards.json', () => {
  it('contains the Vol. 2 and Vol. 1 pools with the exclusives patched in', () => {
    const db = cardDb()
    expect(db.size).toBe(24 + 22)   // rung V1-B: the Vol. 1 pool (its cards are pinned in abilities-vol1.test.ts)
    expect(db.get('27-123S')?.name).toBe('Zack')
    expect(db.get('27-124S')?.name).toBe('Cloud')
    expect(db.get('12-120C')?.elements).toEqual(['earth', 'lightning'])
    expect(db.get('9-074C')?.power).toBeNull()
    expect(['1-121C', '18-069C', '18-064C', '20-074C'].map((c) => db.get(c)?.generic)).toEqual([true, true, true, true])
    expect(db.get('27-124S')?.generic).toBe(false)
  })
})
