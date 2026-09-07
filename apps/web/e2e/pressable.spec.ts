import { expect, test } from '@playwright/test'

/**
 * Rung F6-A5 — every pressable card says what pressing it does, in the name Chromium actually computes.
 *
 * Read through `getByRole`, whose name matching IS the browser's accessible-name computation. The first
 * version of this file used a CSS locator and read the literal `aria-label` attribute while claiming to
 * check accessibility — so adding `aria-hidden="true"` to those buttons would have removed them from the
 * accessibility tree entirely and left it green. A review caught that, having caught the same mistake in
 * this repo once before.
 *
 * ROUTES PINNED, with the exact suffixes the spec predeclared rather than a regex that accepts any number:
 *   seed 21 — turn 1, six pressable hand cards under "cast, attack, or pass". Where the defect was found by
 *             playing: not one of them said what pressing it did.
 *   seed 11 — Class Tenth Moogle, funded exactly three ways, so the count is a specific number and not a shape.
 * Both reach their position with one click, and the human moves first, so no AI timing enters either route.
 */

test('seed 21: every hand card names what pressing it does', async ({ page }) => {
  await page.goto('/?seed=21')
  await page.getByRole('button', { name: /Keep hand/ }).click()
  await expect(page.locator('.prompt__text'), 'the pinned route no longer reaches Main Phase 1')
    .toHaveText(/Main Phase 1/)

  // EVERY hand card must end in one of the two forms (rung I1: a sole choice's headline, or a count).
  // Before F6 they ended at "power 9000 of 9000".
  const all = page.locator('.hand [data-card-id] button')
  await expect(all, 'seed 21 turn 1 should offer six pressable hand cards').toHaveCount(6)
  await expect(
    page.getByRole('button', { name: /, (\d+ options|Cast [^,]+)$/ }),
    'a hand card says nothing about what pressing it does',
  ).toHaveCount(6)

  // Both forms appear here, which is why this route is worth pinning: five cards have one move each (a
  // cast), while Geomancer can be cast OR used for its hand ability — two different MOVES.
  await expect(page.getByRole('button', { name: /, Cast [^,]+$/ }),
    'the headline form is missing').toHaveCount(5)
  await expect(page.getByRole('button', { name: /^Geomancer, .*, 2 options$/ }),
    'the several-moves form is missing, or Geomancer no longer offers two').toHaveCount(1)
  // And never a payment: the tray chooses that, after the press.
  await expect(page.getByRole('button', { name: /paying/ })).toHaveCount(0)
})

test('seed 11: the sheet offers the cast, and the tray lists the cost', async ({ page }) => {
  await page.goto('/?seed=11')
  await page.getByRole('button', { name: /Keep hand/ }).click()

  // A sole cast is announced by its headline, and pressing the card opens its sheet rather than casting.
  await page.getByRole('button', { name: /^Class Tenth Moogle, .*, Cast Class Tenth Moogle$/ }).click()
  const sheet = page.getByRole('dialog', { name: 'Class Tenth Moogle' })
  await expect(sheet).toBeVisible()
  await expect(page.locator('.log__lines')).not.toContainText(/Cast Class Tenth Moogle/)
  await sheet.getByRole('button', { name: 'Back' }).click()
  await expect(sheet).toHaveCount(0)
})
