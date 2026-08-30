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
  // Named WITHOUT its cast. A card hiding a payment choice does not name the cast, because pressing it does
  // not cast — it opens the chooser. Since rung F6 it is not SILENT either: it says "3 ways to pay", which
  // is what the press actually does. Matching on the card's own facts keeps this route independent of that
  // wording.
  await page.getByRole('button', { name: /^Class Tenth Moogle, cost/ }).click()
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

  // The disclosure names its OWN move. The design allows one per shown move, so two can be on screen at once
  // — Geomancer can be cast and can use its hand ability, and both may hide the same number of payments. The
  // visible text stays short; the accessible name carries the move, because adjacency is not part of a name
  // and is lost entirely to a button list, to voice control, and to a flex row that wraps.
  await expect(
    strip.getByRole('button', { name: /^Pay differently for: Cast Class Tenth Moogle paying/ }),
    'the disclosure does not say which move it belongs to',
  ).toHaveCount(1)

  await disclosure.click()

  const options = strip.locator('[data-command="castCharacter"]')
  await expect(options, 'asking to pay differently did not list the payments').toHaveCount(3)

  // CHROMIUM'S COMPUTED NAMES, via `getByRole`, which matches on the accessible name the browser derives —
  // not on `textContent`, which is what the first version of this test read while claiming to check
  // accessibility. Adding `aria-label="Payment option"` to every button would have left that version green
  // while making all three indistinguishable to a screen reader: the exact defect this rung is about, one
  // layer down. A review caught it.
  //
  // The three names are written out rather than read off the page, because expectations derived from the
  // rendering validate the rendering against itself. This route is pinned, so they are knowable: seed 11's
  // Class Tenth Moogle can be funded by discarding Geomancer (cost 1), Prishe (2) or Cloud (3) — and the
  // whole point of the rung is that the game used to pick Geomancer without mentioning the other two.
  for (const card of ['Geomancer', 'Prishe', 'Cloud']) {
    await expect(
      strip.getByRole('button', { name: `Cast Class Tenth Moogle paying: discard ${card} as earth`, exact: true }),
      `no payment option is NAMED as discarding ${card}`,
    ).toHaveCount(1)
  }

  // And it is a real choice: taking the non-preferred payment casts the card and clears the strip of it.
  await options.filter({ hasText: /discard Cloud as earth/ }).click()
  await expect(page.locator('.prompt__actions [data-command="payDifferently"]'),
    'the payment view survived the cast').toHaveCount(0)
  await expect(page.locator('.log__lines'), 'the cast was not narrated').toContainText(/Class Tenth Moogle/)
})
