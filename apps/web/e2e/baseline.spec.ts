import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { expectNoArt, watchArtRequests } from './artGuard'
import { playToTheEnd } from './drive'

/**
 * UI overhaul U0 — a recorded baseline of today's UI, for the later rungs to compare against. NOT a regression test:
 * the AI's search is time-boxed, so the positions differ run to run. Skipped unless asked for:
 *
 *   FFTCG_BASELINE=1 pnpm test:browser baseline
 *
 * Writes into docs/superpowers/measurements/u0/. Art off, and the art guard proves it before every screenshot, so
 * nothing git-ignored or copyrighted reaches a committed image.
 */
const OUT = fileURLToPath(new URL('../../../docs/superpowers/measurements/u0/', import.meta.url))
const ROUTE = '/?seed=1&decks=vol2,vol2&art=off'
const GAMES = 3

test.skip(!process.env['FFTCG_BASELINE'], 'set FFTCG_BASELINE=1 to re-measure the U0 baseline')
// Serial, never side by side: the performance game must not share the machine with the screenshot games, or the
// frame gaps and long tasks measure the contention instead of the UI (U0 review).
test.describe.configure({ mode: 'serial' })

test('screenshots of the board at turn 3, three desktop sizes', async ({ page }) => {
  test.setTimeout(240_000)
  mkdirSync(OUT, { recursive: true })
  const art = watchArtRequests(page)
  for (const [w, h] of [[1280, 720], [1440, 900], [1920, 1080]] as const) {
    await page.setViewportSize({ width: w, height: h })
    await page.goto(ROUTE)
    // textContent, not innerText: the prompt is styled uppercase, and innerText applies text-transform ("TURN 3").
    await playToTheEnd(page, 90_000, async () => /Turn 3\b/.test((await page.locator('.prompt').textContent().catch(() => '')) ?? ''))
    await expectNoArt(page, art)
    await page.screenshot({ path: `${OUT}board-${w}x${h}.png` })
  }
})

interface GameMeasure {
  gameMs: number
  frames: number
  frameGapMs: { p50: number; p95: number; p99: number; max: number }
  longTasks: { count: number; maxMs: number; totalMs: number }
}

async function measureOneGame(page: Page): Promise<GameMeasure> {
  const started = Date.now()
  await page.goto(ROUTE)
  await playToTheEnd(page, 360_000)
  const gameMs = Date.now() - started
  const raw = await page.evaluate(() => (window as unknown as { __perf: { gaps: number[]; longTasks: number[] } }).__perf)
  const sorted = [...raw.gaps].sort((a, b) => a - b)
  const at = (q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0
  return {
    gameMs,
    frames: raw.gaps.length,
    frameGapMs: { p50: at(0.5), p95: at(0.95), p99: at(0.99), max: sorted.at(-1) ?? 0 },
    longTasks: { count: raw.longTasks.length, maxMs: Math.max(0, ...raw.longTasks), totalMs: raw.longTasks.reduce((a, b) => a + b, 0) },
  }
}

const median = (xs: readonly number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0

test('full games at 4× CPU throttling: frame gaps and long tasks', async ({ page }) => {
  test.setTimeout(GAMES * 400_000)
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
  // Several games, because one time-boxed AI game is one sample: the medians are what later rungs compare against.
  const games: GameMeasure[] = []
  for (let i = 0; i < GAMES; i++) games.push(await measureOneGame(page))
  const result = {
    measured: new Date().toISOString(), route: ROUTE, viewport: '1440x900', cpuThrottle: 4, games,
    median: {
      gameMs: median(games.map((g) => g.gameMs)),
      frameGapP95Ms: median(games.map((g) => g.frameGapMs.p95)),
      frameGapP99Ms: median(games.map((g) => g.frameGapMs.p99)),
      frameGapMaxMs: median(games.map((g) => g.frameGapMs.max)),
      longTaskCount: median(games.map((g) => g.longTasks.count)),
    },
  }
  mkdirSync(OUT, { recursive: true })
  writeFileSync(`${OUT}perf-baseline.json`, `${JSON.stringify(result, null, 2)}\n`)
  expect(games.every((g) => g.frames > 0)).toBe(true)
})
