import { expect, test, type Page } from '@playwright/test'
import { playToTheEnd } from './drive'

/**
 * UI overhaul UO-A1 — the board fits the screen: no page, seat or hand scroll, both Forward rows fully on screen, and the
 * prompt text and the actions over no card. A real mid-game position (turn 3 of seed 1), at three desktop sizes.
 */
type Box = { x: number; y: number; width: number; height: number }
const overlaps = (a: Box, b: Box): boolean => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

async function turn3(page: Page): Promise<void> {
  await page.goto('/?seed=1&decks=vol2,vol2&art=off')
  await playToTheEnd(page, 90_000, async () => /Turn 3\b/.test((await page.locator('.prompt__phase').textContent().catch(() => '')) ?? ''))
}

for (const [w, h] of [[1280, 720], [1440, 900], [1920, 1080]] as const) {
  test(`the board fits ${w}×${h} with nothing scrolled or covered (UO-A1)`, async ({ page }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width: w, height: h })
    await turn3(page)
    const fit = await page.evaluate(() => ({
      pageScrollsY: document.documentElement.scrollHeight > innerHeight + 1,
      pageScrollsX: document.documentElement.scrollWidth > innerWidth + 1,
      seatScrolls: [...document.querySelectorAll<HTMLElement>('.table__seat')].some((s) => s.scrollHeight > s.clientHeight + 1),
      handScrollsY: [...document.querySelectorAll<HTMLElement>('.hand')].some((s) => s.scrollHeight > s.clientHeight + 1),
    }))
    expect(fit).toEqual({ pageScrollsY: false, pageScrollsX: false, seatScrolls: false, handScrollsY: false })
    for (const label of ['AI Forwards', 'Your Forwards']) {
      const row = page.locator('.zone').filter({ has: page.locator('.zone__label', { hasText: label }) })
      const box = await row.boundingBox()
      expect(box, `${label} is not rendered`).not.toBeNull()
      expect(box!.y, `${label} starts above the viewport`).toBeGreaterThanOrEqual(0)
      expect(box!.y + box!.height, `${label} ends below the viewport`).toBeLessThanOrEqual(h)
    }
    const cards = await page.locator('.card').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON() as Box))
    for (const sel of ['.prompt__text', '.prompt__actions']) {
      const box = await page.locator(sel).boundingBox()
      if (!box) continue
      expect(cards.filter((c) => overlaps(box, c)), `${sel} covers a card`).toEqual([])
    }
  })
}

test('dulling a card moves no other card (D29)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/fixtures.html?art=off&motion=instant')
  const active = await page.locator('figure[data-fixture="forward, field"] .card').boundingBox()
  const dull = await page.locator('figure[data-fixture="forward, dull"] .card').boundingBox()
  expect(dull!.width).toBeCloseTo(active!.width, 0)
  expect(dull!.height).toBeCloseTo(active!.height, 0)
})
