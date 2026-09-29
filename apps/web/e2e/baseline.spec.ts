import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { playToTheEnd } from './drive'

/**
 * UI overhaul U0 — a recorded baseline of today's UI, for the later rungs to compare against. NOT a regression test:
 * the AI's search is time-boxed, so the positions differ run to run. Skipped unless asked for:
 *
 *   FFTCG_BASELINE=1 pnpm test:browser baseline
 *
 * Writes into docs/superpowers/measurements/u0/. Art off, so nothing git-ignored reaches a committed image.
 */
const OUT = fileURLToPath(new URL('../../../docs/superpowers/measurements/u0/', import.meta.url))
const ROUTE = '/?seed=1&decks=vol2,vol2&art=off'

test.skip(!process.env['FFTCG_BASELINE'], 'set FFTCG_BASELINE=1 to re-measure the U0 baseline')

test('screenshots of the board at turn 3, three desktop sizes', async ({ page }) => {
  test.setTimeout(240_000)
  mkdirSync(OUT, { recursive: true })
  for (const [w, h] of [[1280, 720], [1440, 900], [1920, 1080]] as const) {
    await page.setViewportSize({ width: w, height: h })
    await page.goto(ROUTE)
    // textContent, not innerText: the prompt is styled uppercase, and innerText applies text-transform ("TURN 3").
    await playToTheEnd(page, 90_000, async () => /Turn 3\b/.test((await page.locator('.prompt').textContent().catch(() => '')) ?? ''))
    await page.screenshot({ path: `${OUT}board-${w}x${h}.png` })
  }
})

test('a full game at 4× CPU throttling: frame gaps and long tasks', async ({ page }) => {
  test.setTimeout(420_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.addInitScript(() => {
    const perf = { gaps: [] as number[], longTasks: [] as number[] }
    ;(window as unknown as { __perf: typeof perf }).__perf = perf
    let last: number | null = null
    const tick = (t: number): void => { if (last !== null) perf.gaps.push(t - last); last = t; requestAnimationFrame(tick) }
    requestAnimationFrame(tick)
    try {
      new PerformanceObserver((l) => { for (const e of l.getEntries()) perf.longTasks.push(e.duration) }).observe({ type: 'longtask', buffered: true })
    } catch { /* not Chromium */ }
  })
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  const started = Date.now()
  await page.goto(ROUTE)
  await playToTheEnd(page, 360_000)
  const gameMs = Date.now() - started
  const raw = await page.evaluate(() => (window as unknown as { __perf: { gaps: number[]; longTasks: number[] } }).__perf)
  const sorted = [...raw.gaps].sort((a, b) => a - b)
  const at = (q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0
  const result = {
    measured: new Date().toISOString(), route: ROUTE, viewport: '1440x900', cpuThrottle: 4, gameMs,
    frames: raw.gaps.length,
    frameGapMs: { p50: at(0.5), p95: at(0.95), p99: at(0.99), max: sorted.at(-1) ?? 0 },
    longTasks: { count: raw.longTasks.length, maxMs: Math.max(0, ...raw.longTasks), totalMs: raw.longTasks.reduce((a, b) => a + b, 0) },
  }
  mkdirSync(OUT, { recursive: true })
  writeFileSync(`${OUT}perf-baseline.json`, `${JSON.stringify(result, null, 2)}\n`)
  expect(result.frames).toBeGreaterThan(0)
})
