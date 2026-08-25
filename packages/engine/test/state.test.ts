import { describe, expect, it } from 'vitest'
import { findFieldCard, keywordsOf, powerOf } from '../src/state.js'
import { makeGame, withField } from './helpers.js'

describe('state helpers', () => {
  it('findFieldCard locates a forward and a backup', () => {
    let s = makeGame()
    let f: number, b: number
    ;[s, f] = withField(s, 0, 'forwards', 'V-F2')
    ;[s, b] = withField(s, 1, 'backups', 'V-B1')
    expect(findFieldCard(s, f)).toMatchObject({ owner: 0, zone: 'forwards' })
    expect(findFieldCard(s, b)).toMatchObject({ owner: 1, zone: 'backups' })
    expect(findFieldCard(s, 9999)).toBeNull()
  })
  it('powerOf and keywordsOf read def plus granted', () => {
    let s = makeGame(); let f: number
    ;[s, f] = withField(s, 0, 'forwards', 'V-F2', { granted: ['haste'] })
    const fc = findFieldCard(s, f)!.card
    expect(powerOf(s, fc)).toBe(5000)
    expect(keywordsOf(s, fc)).toEqual(new Set(['haste']))
  })
})
