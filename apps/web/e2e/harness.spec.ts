import { expect, test, type Page } from '@playwright/test'

/**
 * UI overhaul U0 — the page-load switches, proved in a real browser: the CSS custom property the motion rungs read,
 * the session-only override, and `?art=off` making no request at all.
 */
const motionScale = (page: Page): Promise<string> =>
  page.evaluate(() => document.documentElement.style.getPropertyValue('--motion-scale'))

test('the suite runs at Instant through the configured storage state', async ({ page }) => {
  await page.goto('/?seed=1&decks=vol2,vol2')
  expect(await motionScale(page)).toBe('0')
  await expect(page.locator('html')).toHaveAttribute('data-speed', 'instant')
})

test.describe('with nothing stored', () => {
  test.use({ storageState: { cookies: [], origins: [{ origin: 'http://localhost:5199', localStorage: [{ name: 'fftcg.howToPlay.seen', value: '1' }] }] } })

  test('the default is Normal', async ({ page }) => {
    await page.goto('/?seed=1&decks=vol2,vol2')
    expect(await motionScale(page)).toBe('1')
  })

  test('?motion=instant applies to this page only and is never saved', async ({ page }) => {
    await page.goto('/?seed=1&decks=vol2,vol2&motion=instant')
    expect(await motionScale(page)).toBe('0')
    expect(await page.evaluate(() => localStorage.getItem('fftcg.settings'))).toBeNull()
  })

  test('a malformed flag is ignored with a warning (Review Focus 3)', async ({ page }) => {
    const warnings: string[] = []
    page.on('console', (m) => { if (m.type() === 'warning') warnings.push(m.text()) })
    await page.goto('/?seed=1&decks=vol2,vol2&motion=slow')
    expect(await motionScale(page)).toBe('1')
    expect(warnings.some((w) => w.includes('?motion=slow'))).toBe(true)
  })
})

test('?art=off renders text cards and requests no art at all (Review Focus 5)', async ({ page }) => {
  const artRequests: string[] = []
  page.on('request', (r) => { if (new URL(r.url()).pathname.startsWith('/cards/')) artRequests.push(r.url()) })
  // Seed 1 hands the human the first decision; both LB decks are face-up cards on the board from the start.
  await page.goto('/?seed=1&decks=vol2,vol2&art=off')
  await expect(page.locator('.card').first()).toBeVisible()
  await expect(page.locator('img.card__img')).toHaveCount(0)
  expect(artRequests).toEqual([])
})

test('?perf=1 shows the overlay, out of the accessibility tree', async ({ page }) => {
  await page.goto('/?seed=1&decks=vol2,vol2&perf=1')
  const overlay = page.locator('.perf-overlay')
  await expect(overlay).toBeVisible()
  await expect(overlay).toHaveAttribute('aria-hidden', 'true')
})
