import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { CardArt } from '../src/ui/CardArt'
import { cardArt, hashCode } from '../src/ui/crystalArt'

describe('cardArt', () => {
  it('is the same for the same card, every time (Review Focus 2)', () => {
    expect(cardArt('27-124S', ['lightning'])).toEqual(cardArt('27-124S', ['lightning']))
  })

  it('differs between cards', () => {
    expect(cardArt('27-124S', ['lightning'])).not.toEqual(cardArt('27-125S', ['lightning']))
    expect(hashCode('27-124S')).not.toBe(hashCode('27-125S'))
  })

  it('draws five to eight shards inside a padded 100 × 140 box', () => {
    for (const code of ['1-121C', '12-120C', '27-124S', '2-085H', '18-064C']) {
      const { shards } = cardArt(code, ['earth'])
      expect(shards.length, code).toBeGreaterThanOrEqual(5)
      expect(shards.length, code).toBeLessThanOrEqual(8)
      for (const s of shards) {
        for (const pair of s.points.split(' ')) {
          const [x, y] = pair.split(',').map(Number) as [number, number]
          expect(x).toBeGreaterThan(-60); expect(x).toBeLessThan(160)
          expect(y).toBeGreaterThan(-60); expect(y).toBeLessThan(200)
        }
        expect(s.opacity).toBeGreaterThan(0); expect(s.opacity).toBeLessThanOrEqual(1)
      }
    }
  })

  it("colours with the card's own elements only (Review Focus 1)", () => {
    const fills = new Set(cardArt('12-120C', ['earth', 'lightning']).shards.map((s) => s.fill))
    expect([...fills].sort()).toEqual(['var(--el-earth)', 'var(--el-lightning)'])
    const three = new Set(cardArt('12-120C', ['fire', 'ice', 'wind']).shards.map((s) => s.fill))
    for (const f of three) expect(['var(--el-fire)', 'var(--el-ice)', 'var(--el-wind)']).toContain(f)
  })

  it('falls back to a neutral colour for a card with no element (Review Focus 1)', () => {
    const art = cardArt('0-000X', [])
    expect(art.shards.length).toBeGreaterThanOrEqual(5)
    for (const s of art.shards) expect(s.fill).toBe('var(--state-invalid)')
    expect(art.glow.fill).toBe('var(--state-invalid)')
  })
})

let root: Root | null = null
afterEach(() => { act(() => root?.unmount()); root = null; document.body.innerHTML = '' })

describe('<CardArt>', () => {
  it('draws one polygon per shard, hidden from assistive technology', () => {
    const host = document.body.appendChild(document.createElement('div'))
    root = createRoot(host)
    act(() => root?.render(createElement(CardArt, { code: '12-120C', elements: ['earth'] })))
    const svg = host.querySelector('svg.card__genart')
    expect(svg?.getAttribute('aria-hidden')).toBe('true')
    expect(svg?.querySelectorAll('polygon').length).toBe(cardArt('12-120C', ['earth']).shards.length)
  })

  it('gives each instance its own gradient id, safe inside url(#…) (Review Focus 3)', () => {
    const host = document.body.appendChild(document.createElement('div'))
    root = createRoot(host)
    act(() => root?.render(createElement('div', null,
      createElement(CardArt, { code: '12-120C', elements: ['earth'] }),
      createElement(CardArt, { code: '12-120C', elements: ['earth'] }))))
    // By id suffix, not by tag: jsdom's selector engine may lowercase an SVG tag name like radialGradient.
    const ids = [...host.querySelectorAll('[id$="-glow"]')].map((g) => g.id)
    expect(ids).toHaveLength(2)
    expect(ids[0]).not.toBe(ids[1])
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})
