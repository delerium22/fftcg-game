import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { FrameStats } from '../src/dev/frameStats'
import { PerfOverlay } from '../src/dev/PerfOverlay'

describe('FrameStats', () => {
  it('reports nothing before two frames', () => {
    const s = new FrameStats()
    expect(s.maxGapMs).toBe(0)
    expect(s.fps).toBe(0)
    s.frame(0)
    expect(s.maxGapMs).toBe(0)
  })

  it('reports the largest gap and the mean rate', () => {
    const s = new FrameStats()
    for (const t of [0, 16, 32, 132, 148]) s.frame(t)
    expect(s.maxGapMs).toBe(100)
    expect(s.fps).toBeCloseTo(1000 / 37, 5)   // four gaps: 16, 16, 100, 16 → mean 37 ms
  })

  it('keeps only the most recent window of gaps', () => {
    const s = new FrameStats(2)
    for (const t of [0, 200, 216, 232]) s.frame(t)   // the 200 ms gap has left the window
    expect(s.maxGapMs).toBe(16)
  })
})

let root: Root | null = null
afterEach(() => { act(() => root?.unmount()); root = null; document.body.innerHTML = '' })

describe('PerfOverlay', () => {
  it('mounts without PerformanceObserver support and stays out of the accessibility tree', () => {
    const host = document.body.appendChild(document.createElement('div'))
    root = createRoot(host)
    act(() => root?.render(createElement(PerfOverlay)))
    const el = host.querySelector('.perf-overlay')
    expect(el).not.toBeNull()
    expect(el?.getAttribute('aria-hidden')).toBe('true')
  })
})
