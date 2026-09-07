import { expect, test } from '@playwright/test'

/**
 * Paying crystal by crystal, in a real browser (rung I2-A8).
 *
 * The jsdom tests pin which commands exist and what Confirm submits. What they cannot answer is whether the
 * sheet is modal, whether the crystals are an image Chromium exposes with the spoken total, and whether a
 * board card is a control a person can press while the tray is open — the accessibility tree is derived by
 * the browser, not written by us.
 *
 * ROUTE PINNED, NOT PLAYED. `?seed=11` reaches Main Phase 1 in one click ("Keep hand"), where Class Tenth
 * Moogle can be cast three ways: discarding Geomancer (cost 1), Prishe (2) or Cloud (3). The game used to
 * discard Geomancer for you and never mention the other two; E11 listed the three as buttons; I2 lets you
 * click Cloud and watch the crystal light. If the route stops arriving, this fails saying so.
 */

const SEED = 11

test('a cast is paid by pressing the cards you spend, and Confirm casts it', async ({ page }) => {
  await page.goto(`/?seed=${SEED}`)
  await page.getByRole('button', { name: /Keep hand/ }).click()

  // The card's press opens its sheet — a modal dialog named after the card — and the sheet offers the cast
  // WITHOUT a payment, because the payment has not been chosen yet.
  await page.getByRole('button', { name: /^Class Tenth Moogle, cost/ }).click()
  const sheet = page.getByRole('dialog', { name: 'Class Tenth Moogle' })
  await expect(sheet, 'pressing the card opened no sheet').toBeVisible()
  await expect(sheet.locator('.sheet__printed'), 'the sheet does not show the printed text').toHaveText(/Class Tenth Moogle can produce Lightning CP/)
  const cast = sheet.getByRole('button', { name: 'Cast Class Tenth Moogle', exact: true })
  await expect(cast).toBeVisible()
  await cast.click()

  // The tray: two crystals (Moogle costs 2, one of them earth), greyed, and Confirm disabled.
  const tray = page.locator('[data-payment-tray]')
  await expect(tray).toBeVisible()
  await expect(tray.getByRole('img', { name: '0 of 2 CP paid' }), 'the crystal row does not say what is paid').toHaveCount(1)
  await expect(tray.locator('.crystal')).toHaveCount(2)
  await expect(tray.locator('.crystal--earth')).toHaveCount(1)
  await expect(tray.locator('.crystal.is-lit')).toHaveCount(0)
  await expect(tray.getByRole('button', { name: 'Confirm' })).toBeDisabled()
  // The live region says what is being asked.
  await expect(page.locator('.prompt__text')).toHaveText(/Cast Class Tenth Moogle — 0 of 2 CP paid/)

  // A hand card that can pay is a control that says so, in Chromium's computed name.
  const cloud = page.getByRole('button', { name: /^Cloud, cost 3.*, Discard for 2 earth CP$/ })
  await expect(cloud, 'Cloud is not offered as a source').toHaveCount(1)
  await cloud.click()
  // A discard is two CP of one element: both crystals light at once.
  await expect(tray.locator('.crystal.is-lit'), 'pressing Cloud lit no crystal').toHaveCount(2)
  await expect(tray.getByRole('img', { name: '2 of 2 CP paid' })).toHaveCount(1)
  await expect(page.getByRole('button', { name: /^Cloud, cost 3.*will be discarded to pay/ })).toHaveCount(1)
  // A source that would now over-pay is no longer offered.
  await expect(page.getByRole('button', { name: /^Prishe, cost 2.*, Discard for 2 earth CP$/ })).toHaveCount(0)

  const confirm = tray.getByRole('button', { name: 'Confirm' })
  await expect(confirm).toBeEnabled()
  await confirm.click()
  await expect(tray, 'the tray survived the cast').toHaveCount(0)
  await expect(page.locator('.log__lines'), 'the cast was not narrated with the payment built')
    .toContainText(/Cast Class Tenth Moogle paying: discard Cloud as earth/)
})
