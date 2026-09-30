import { expect, test, type Page } from '@playwright/test'

/**
 * UI overhaul U1 review — the card's state signals must stay distinct, checked on computed styles in a real browser
 * (jsdom has no CSS): keyboard focus apart from the playable ring, a taken payment source without the playable pulse,
 * and a card chosen for a set with its gold ring.
 */
const GOLD = 'rgb(255, 201, 77)'
const face = (page: Page, fixture: string) => page.locator(`figure[data-fixture="${fixture}"] .card__face`)

test.beforeEach(async ({ page }) => {
  await page.goto('/fixtures.html?art=off&motion=instant')
  await expect(page.locator('figure[data-fixture]').first()).toBeVisible()
})

test('keyboard focus is a white ring outside the cyan playable ring', async ({ page }) => {
  await page.keyboard.press('Tab')
  const outline = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement
    const cs = getComputedStyle(el)
    return { card: el.classList.contains('card'), color: cs.outlineColor, offset: parseFloat(cs.outlineOffset) }
  })
  expect(outline.card).toBe(true)
  expect(outline.color).toBe('rgb(255, 255, 255)')
  // The playable ring reaches 5 px outside the face (inset -3 px, 2 px spread): focus sits clear of it.
  expect(outline.offset).toBeGreaterThanOrEqual(6)
})

test('a taken payment source shows its payment ring, not the playable pulse', async ({ page }) => {
  for (const fixture of ['paying by dulling', 'paying by discarding', 'paying by an LB flip']) {
    const opacity = await face(page, fixture).evaluate((el) => getComputedStyle(el, '::after').opacity)
    expect(opacity, fixture).toBe('0')
  }
})

test('a card chosen for a set carries the gold selected ring', async ({ page }) => {
  const shadow = await face(page, 'chosen for a set').evaluate((el) => getComputedStyle(el).boxShadow)
  expect(shadow).toContain(GOLD)
})
