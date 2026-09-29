import { useEffect, useState, type CSSProperties, type JSX } from 'react'
import { FrameStats } from './frameStats.js'

const BOX: CSSProperties = {
  position: 'fixed', top: 8, right: 8, zIndex: 2147483647, pointerEvents: 'none',
  font: '11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace', color: '#e9f0f4',
  background: 'rgb(8 11 15 / 82%)', border: '1px solid #3d5260', borderRadius: 6, padding: '4px 8px',
}

interface Reading { fps: number; maxGapMs: number; longTasks: number }

/**
 * `?perf=1`: frames per second, the worst frame gap in the last ~5 s, and the long tasks seen since load. A developer
 * aid for the motion rungs, never shown otherwise. Hidden from assistive technology, and it takes no pointer events,
 * so it can sit over the board without changing what a player or a test can reach.
 */
export function PerfOverlay(): JSX.Element {
  const [reading, setReading] = useState<Reading>({ fps: 0, maxGapMs: 0, longTasks: 0 })
  useEffect(() => {
    const stats = new FrameStats()
    let longTasks = 0
    let raf = 0
    const tick = (t: number): void => { stats.frame(t); raf = requestAnimationFrame(tick) }
    // jsdom without `pretendToBeVisual` has no requestAnimationFrame; the overlay then shows zeros instead of throwing.
    if (typeof requestAnimationFrame === 'function') raf = requestAnimationFrame(tick)
    // Long tasks are Chromium-only; elsewhere (and in jsdom) the count simply stays at 0.
    let observer: PerformanceObserver | null = null
    try {
      observer = new PerformanceObserver((list) => { longTasks += list.getEntries().length })
      observer.observe({ type: 'longtask', buffered: true })
    } catch { observer = null }
    // Twice a second, not per frame: the overlay must not become the thing it measures.
    const timer = setInterval(() => { setReading({ fps: stats.fps, maxGapMs: stats.maxGapMs, longTasks }) }, 500)
    return () => { if (raf) cancelAnimationFrame(raf); clearInterval(timer); observer?.disconnect() }
  }, [])
  return (
    <div className="perf-overlay" aria-hidden="true" style={BOX}>
      {reading.fps.toFixed(0)} fps · worst frame {reading.maxGapMs.toFixed(0)} ms · long tasks {reading.longTasks}
    </div>
  )
}
