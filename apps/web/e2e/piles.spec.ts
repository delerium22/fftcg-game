import { expect, test } from '@playwright/test'
import { playToTheEnd } from './drive'

/** UI overhaul U2b — a pile opens a modal sheet over the board instead of a row inside it (spec section 6). */
test('a pile opens as a sheet; a card inside opens its own sheet on top; Escape backs out one at a time', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/?seed=1&decks=vol2,vol2&art=off')
  const opener = page.locator('button.stat__open[aria-label*="Break Zone"]').first()
  // Stop only with no card sheet open, or the opener is behind a modal.
  await playToTheEnd(page, 90_000, async () => (await opener.count()) > 0 && (await page.locator('dialog[data-card-sheet]').count()) === 0)
  await opener.click()
  const sheet = page.locator('dialog[data-zone-sheet]')
  await expect(sheet).toBeVisible()
  await expect(opener).toHaveAttribute('aria-expanded', 'true')
  await expect(sheet.locator('[role="grid"][aria-label*="Break Zone"]')).toBeVisible()
  await expect(page.locator('.table__seat .zone__label', { hasText: 'Break Zone' })).toHaveCount(0)
  const pileCard = sheet.locator('[role="gridcell"] button').first()
  await pileCard.click()
  await expect(page.locator('dialog[data-card-sheet]')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('dialog[data-card-sheet]')).toHaveCount(0)
  await expect(sheet).toBeVisible()
  await expect(pileCard, 'focus did not come back to the pile card').toBeFocused()
  await page.keyboard.press('Escape')
  await expect(sheet).toHaveCount(0)
  await expect(opener).toHaveAttribute('aria-expanded', 'false')
  await expect(opener, 'focus did not come back to the pile opener').toBeFocused()
})

test("the AI's LB deck is a pile; yours sits beside your hand", async ({ page }) => {
  await page.goto('/?seed=1&decks=vol2,vol2&art=off')
  await expect(page.locator('.table__hand [role="grid"][aria-label="Your LB deck"]')).toBeVisible()
  await expect(page.locator('.table__seat [role="grid"][aria-label="AI LB deck"]')).toHaveCount(0)
  await page.locator('button.stat__open[aria-label^="the AI\'s LB deck"]').click()
  await expect(page.locator('dialog[data-zone-sheet] [role="grid"][aria-label="AI LB deck"]')).toBeVisible()
})
