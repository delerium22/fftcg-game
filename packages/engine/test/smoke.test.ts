import { describe, expect, it } from 'vitest'
import { ENGINE_VERSION } from '../src/index.js'

describe('workspace', () => {
  it('resolves the engine package', () => {
    expect(ENGINE_VERSION).toBe('0.0.0')
  })
})
