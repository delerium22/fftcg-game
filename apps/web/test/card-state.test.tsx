import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { disableArt, resetMissingArt } from '../src/game/art'
import { Card, cardVisualState, type CardProps } from '../src/ui/Card'

const base: CardProps = { code: '12-120C', name: 'Shantotto', cost: 2, elements: ['earth', 'lightning'], type: 'forward', power: 7000 }

describe('cardVisualState (spec section 5)', () => {
  it('derives each attribute from the props', () => {
    expect(cardVisualState(base)).toEqual({ orientation: 'active', face: 'up', role: 'none', emphasis: 'none', paying: 'none' })
    expect(cardVisualState({ ...base, dull: true }).orientation).toBe('dull')
    expect(cardVisualState({ ...base, paying: 'dull' })).toMatchObject({ orientation: 'dull', paying: 'dull' })
    expect(cardVisualState({ ...base, faceDown: true }).face).toBe('down')
    expect(cardVisualState({ ...base, actionable: true }).role).toBe('selectable')
    expect(cardVisualState({ ...base, selected: true }).role).toBe('selected')
    expect(cardVisualState({ ...base, chosen: true }).role).toBe('selected')
    expect(cardVisualState({ ...base, emphasis: 'attacking' }).emphasis).toBe('attacking')
  })

  it('lets an explicit role win over the derived one', () => {
    expect(cardVisualState({ ...base, actionable: true, role: 'targetable' }).role).toBe('targetable')
    expect(cardVisualState({ ...base, role: 'invalid' }).role).toBe('invalid')
  })
})

let root: Root | null = null
beforeEach(() => { resetMissingArt() })
afterEach(() => { act(() => root?.unmount()); root = null; document.body.innerHTML = ''; resetMissingArt() })

function render(props: CardProps): HTMLElement {
  const host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  act(() => root?.render(createElement(Card, props)))
  return host.querySelector('.card') as HTMLElement
}

describe('<Card> attributes and art', () => {
  it('puts the state on the root element for CSS and tests', () => {
    const el = render({ ...base, dull: true, actionable: true, emphasis: 'blocking' })
    expect(el.dataset['orientation']).toBe('dull')
    expect(el.dataset['face']).toBe('up')
    expect(el.dataset['role']).toBe('selectable')
    expect(el.dataset['emphasis']).toBe('blocking')
    expect(el.dataset['paying']).toBe('none')
    // The classes the older tests and the e2e driver read are still there.
    expect(el.classList.contains('is-dull')).toBe(true)
    expect(el.classList.contains('is-selectable')).toBe(true)
  })

  it('face-down cards carry the attributes too', () => {
    expect(render({ ...base, faceDown: true }).dataset['face']).toBe('down')
  })

  it('shows generative art while the scan is loading, and when there is none (Review Focus 4)', () => {
    expect(render(base).querySelector('svg.card__genart')).not.toBeNull()   // loading: the <img> has not reported
    act(() => root?.unmount()); root = null; document.body.innerHTML = ''
    disableArt()
    const el = render(base)
    expect(el.querySelector('svg.card__genart')).not.toBeNull()
    expect(el.querySelector('img.card__img')).toBeNull()
  })

  it('drops the generative art once the scan has loaded (Review Focus 4)', () => {
    const el = render(base)
    const img = el.querySelector('img.card__img') as HTMLImageElement
    act(() => { img.dispatchEvent(new Event('load')) })
    expect(el.querySelector('svg.card__genart')).toBeNull()
  })
})
