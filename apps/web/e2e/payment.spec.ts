import { expect, test } from '@playwright/test'

/**
 * Choosing what you pay with, in a real browser (rung E11-A5).
 *
 * The jsdom tests pin which commands exist and what clicking submits. What they cannot answer is whether each
 * alternative is a control Chromium exposes with a name that says which of your cards it spends — the
 * accessibility tree is derived by the browser, not written by us.
 *
 * ROUTE PINNED, NOT PLAYED. `?seed=11` reaches Main Phase 1 in one click ("Keep hand"), where Class Tenth
 * Moogle can be cast three ways: discarding Geomancer (cost 1), Prishe (2) or Cloud (3). That is the decision
 * this rung exists to hand back — before it, the game discarded Geomancer for you and never mentioned that
 * Cloud or Prishe were the alternatives. If the route stops arriving, this fails saying so.
 */

const SEED = 11

test('the other ways to pay are real controls that name the cards they spend', async ({ page }) => {
  await page.goto(`/?seed=${SEED}`)
  await page.getByRole('button', { name: /Keep hand/ }).click()

  // Selecting, not casting: a move that hides a payment choice must not fire on the first touch.
  await page.getByRole('button', { name: /^Class Tenth Moogle.*Cast/ }).click()
  const strip = page.locator('.prompt__actions')
  await expect(strip.locator('[data-command="castCharacter"]'),
    'the preferred cast is not offered after selecting').toHaveCount(1)

  const disclosure = strip.locator('[data-command="payDifferently"]')
  await expect(disclosure, 'no way to reach the other payments').toHaveCount(1)
  // It says how many, so pressing it is not a guess.
  await expect(disclosure).toHaveText(/Pay differently \(\d+ other ways?\)/)

  // Before asking, the alternatives are NOT in the strip — the thing this rung must not do is put every
  // payment on a button, which is the interface spec B6 collapsed them to avoid.
  await expect(strip.getByRole('button', { name: /discard Cloud as earth/ }),
    'an alternative payment was in the strip before being asked for').toHaveCount(0)

  await disclosure.click()

  const options = strip.locator('[data-command="castCharacter"]')
  await expect(options, 'asking to pay differently did not list the payments').toHaveCount(3)
  const names = await options.evaluateAll((els) => els.map((e) => e.textContent ?? ''))
  expect(new Set(names).size, `two payment options read alike: ${JSON.stringify(names)}`).toBe(3)
  for (const n of names) {
    // Each names the card it spends AND the element it is declared as — both are part of the command's
    // identity, and a label omitting the element would make two distinct payments read the same.
    expect(n, `"${n}" does not say what it discards`).toMatch(/discard .+ as (earth|lightning)/)
  }
  expect(names.some((n) => /discard Cloud as earth/.test(n)),
    'the expensive alternative this rung exists to surface is missing').toBe(true)

  // And it is a real choice: taking the non-preferred payment casts the card and clears the strip of it.
  await options.filter({ hasText: /discard Cloud as earth/ }).click()
  await expect(page.locator('.prompt__actions [data-command="payDifferently"]'),
    'the payment view survived the cast').toHaveCount(0)
  await expect(page.locator('.log__lines'), 'the cast was not narrated').toContainText(/Class Tenth Moogle/)
})
