import { describe, expect, it } from 'vitest'
import { parseDeckFile } from '../src/deck.js'
describe('parseDeckFile', () => {
  it('expands counts, ignores comments and blank lines', () => {
    expect(parseDeckFile('# c\n\n2 A-1\n1 B-2\n')).toEqual(['A-1', 'A-1', 'B-2'])
  })
  it('rejects malformed lines', () => {
    expect(() => parseDeckFile('three A-1')).toThrow(/line 1/)
  })
})
