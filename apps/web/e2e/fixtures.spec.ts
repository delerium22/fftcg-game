import { expect, test } from '@playwright/test'

/**
 * The card fixture gallery's screenshot baseline (UI overhaul D18): the only committed screenshot in the suite.
 * Art off and Instant, so the image depends on nothing git-ignored and on no timing. Re-baseline deliberately, with
 * `pnpm test:browser fixtures --update-snapshots`, when a rung changes the card on purpose (U1 will).
 */
test('the card fixture gallery matches its baseline', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/fixtures.html?art=off&motion=instant')
  await expect(page.locator('figure[data-fixture]').first()).toBeVisible()
  await expect(page).toHaveScreenshot('card-gallery.png', { fullPage: true })
})
