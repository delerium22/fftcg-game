import { expect, test } from '@playwright/test'
import { expectNoArt, watchArtRequests } from './artGuard'

/**
 * The card fixture gallery's screenshot baseline (UI overhaul D18): the only committed screenshot in the suite.
 * Art off and Instant, so the image depends on nothing git-ignored and on no timing. Re-baseline deliberately, with
 * `pnpm test:browser fixtures --update-snapshots`, when a rung changes the card on purpose (U1 will).
 *
 * The baseline is recorded on macOS with system fonts, and this repo has no CI, so another platform has no image to
 * compare against: it skips there rather than failing, until someone records one with `--update-snapshots`.
 */
test.skip(process.platform !== 'darwin', 'the gallery baseline is recorded on macOS; record one for this platform with --update-snapshots')

test('the card fixture gallery matches its baseline', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  const art = watchArtRequests(page)
  await page.goto('/fixtures.html?art=off&motion=instant')
  await expect(page.locator('figure[data-fixture]').first()).toBeVisible()
  // Fail closed: a regression in ?art=off must stop the recording, not write a card scan into git.
  await expectNoArt(page, art)
  // A tiny tolerance for font antialiasing between runs; a changed card is far above it.
  await expect(page).toHaveScreenshot('card-gallery.png', { fullPage: true, maxDiffPixelRatio: 0.001 })
})
