import { act, createElement, type CSSProperties } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { CardGrid } from '../src/ui/CardGrid'

describe('CardGrid cell style (the hand fan, U2b)', () => {
  it("puts an item's cellStyle on its gridcell", () => {
    const host = document.body.appendChild(document.createElement('div'))
    const root = createRoot(host)
    act(() => root.render(createElement(CardGrid, {
      label: 'Test', onLookAt: () => {},
      items: [{ id: 1, selectable: false, cellName: 'one', cellStyle: { '--i': 0, '--n': 1 } as CSSProperties, render: () => createElement('span') }],
    })))
    const cell = host.querySelector('[role="gridcell"]') as HTMLElement
    expect(cell.style.getPropertyValue('--i')).toBe('0')
    expect(cell.style.getPropertyValue('--n')).toBe('1')
    act(() => root.unmount())
  })
})
