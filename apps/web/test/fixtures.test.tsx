import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { CARD_FIXTURES } from '../src/fixtures/cardFixtures'
import { Gallery } from '../src/fixtures/Gallery'

let root: Root | null = null
afterEach(() => { act(() => root?.unmount()); root = null; document.body.innerHTML = '' })

describe('the fixture gallery', () => {
  it('names every fixture uniquely', () => {
    const names = CARD_FIXTURES.map((f) => f.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('covers each state the card can show today', () => {
    const has = (pred: (f: (typeof CARD_FIXTURES)[number]) => boolean): boolean => CARD_FIXTURES.some(pred)
    expect(has((f) => f.props.type === 'forward')).toBe(true)
    expect(has((f) => f.props.type === 'backup')).toBe(true)
    expect(has((f) => f.props.type === 'summon')).toBe(true)
    for (const size of ['hand', 'field', 'small', 'large'] as const) expect(has((f) => f.props.size === size), size).toBe(true)
    expect(has((f) => f.props.dull === true)).toBe(true)
    expect(has((f) => f.props.frozen === true)).toBe(true)
    expect(has((f) => (f.props.damage ?? 0) > 0)).toBe(true)
    expect(has((f) => f.props.actionable === true)).toBe(true)
    expect(has((f) => f.props.selected === true)).toBe(true)
    expect(has((f) => f.props.chosen === true)).toBe(true)
    expect(has((f) => f.props.faceDown === true)).toBe(true)
    for (const paying of ['dull', 'discard', 'flip'] as const) expect(has((f) => f.props.paying === paying), paying).toBe(true)
    for (const lb of ['down', 'up'] as const) expect(has((f) => f.props.lb === lb), lb).toBe(true)
  })

  it('covers the roles and emphasis states the board will set (U1)', () => {
    const has = (pred: (f: (typeof CARD_FIXTURES)[number]) => boolean): boolean => CARD_FIXTURES.some(pred)
    for (const role of ['targetable', 'targeted', 'invalid'] as const) expect(has((f) => f.props.role === role), role).toBe(true)
    for (const e of ['attacking', 'blocking', 'on-stack', 'just-played'] as const) expect(has((f) => f.props.emphasis === e), e).toBe(true)
  })

  it('shows every card in both pools once, so the generative art of each is on the baseline', () => {
    const pool = CARD_FIXTURES.filter((f) => f.group === 'Every pool card')
    expect(pool.length).toBeGreaterThan(20)
    expect(new Set(pool.map((f) => f.props.code)).size).toBe(pool.length)
  })

  it('renders one labelled figure per fixture, each holding a card', () => {
    const host = document.body.appendChild(document.createElement('div'))
    root = createRoot(host)
    act(() => root?.render(createElement(Gallery)))
    const figures = host.querySelectorAll('figure[data-fixture]')
    expect(figures.length).toBe(CARD_FIXTURES.length)
    for (const fig of figures) expect(fig.querySelector('.card'), fig.getAttribute('data-fixture') ?? '').not.toBeNull()
  })
})
