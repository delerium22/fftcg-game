import { describe, expect, it } from 'vitest'
import { normaliseSeCard, parseKeywords, cleanText, type SeCard } from '../src/normalise.js'

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
  it('contains the Vol. 2 pool with the exclusives patched in', () => {
    const db = cardDb()
    expect(db.size).toBe(18)
    expect(db.get('27-124S')?.name).toBe('Cloud')
    expect(db.get('12-120C')?.elements).toEqual(['earth', 'lightning'])
    expect(db.get('9-074C')?.power).toBeNull()
    expect(['1-121C', '18-069C', '18-064C', '20-074C'].map((c) => db.get(c)?.generic)).toEqual([true, true, true, true])
    expect(db.get('27-124S')?.generic).toBe(false)
  })
})
