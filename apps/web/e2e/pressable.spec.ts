import { expect, test } from '@playwright/test'

/**
 * Rung F6-A5 — every pressable card says what pressing it does, in the accessible name Chromium computes.
 *
 * The jsdom corpus pins which cards carry which of the three forms. What it cannot answer is whether the
 * browser exposes that text as the button's NAME, which is what a screen reader reads. Read via `getByRole`,
 * because reading `textContent` while claiming to check accessibility is a mistake a review already caught
 * here once.
 *
 * ROUTE PINNED. `?seed=21` is where this defect was found by playing: turn 1, Main Phase 1, six pressable
 * hand cards under a prompt saying "cast, attack, or pass", and not one of them said what pressing it did.
 * One click ("Keep hand") reaches it, and the human moves first, so no AI timing enters the route.
 */

test('no pressable card is silent about what pressing it does', async ({ page }) => {
  await page.goto('/?seed=21')
  await page.getByRole('button', { name: /Keep hand/ }).click()

  await expect(page.locator('.prompt__text'), 'the pinned route no longer reaches Main Phase 1')
    .toHaveText(/Main Phase 1/)

  const cards = page.locator('.hand [data-card-id] button')
  await expect(cards, 'seed 21 turn 1 should offer a hand of pressable cards').toHaveCount(6)

  const names = await cards.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''))
  for (const n of names) {
    // Every card must carry one of the three forms. Before F6 these read "Lightning, cost 7, lightning,
    // forward, power 9000 of 9000" and stopped — pressable, and silent about the press.
    expect(n, `"${n}" says nothing about what pressing it does`)
      .toMatch(/(\d+ options|\d+ ways to pay|Cast |Attack with |Block with |Discard |Target |Play )/)
  }

  // And the specific form is right for this position: with no backups out, every cast is funded by
  // discarding and there are several ways to do it, so each card opens a payment choice.
  expect(names.filter((n) => /\d+ ways to pay/.test(n)).length,
    'no card offered a payment choice, so the pinned position is not the one this test describes')
    .toBeGreaterThan(0)
})
