import { expect, test } from '@playwright/test'

/**
 * A deck search, in a real browser (rung E10-A6).
 *
 * WHY THIS EXISTS AND NOT ONLY THE JSDOM TESTS. The jsdom tests pin the DOM this app writes: which ids are
 * candidates, what each cell's `data-card-id` is, that clicking one submits a pick naming that card. What
 * they cannot answer is whether a candidate is a control Chromium exposes and a person can press — the
 * accessibility tree is derived by the browser, not written by us, and jsdom does not derive it.
 *
 * THE ROUTE IS PINNED, NOT PLAYED. A check that plays randomly until it stumbles into a deck search is
 * vacuous when it misses and flaky when it hits. `?seed=5` reaches Hugh Yurg's whole-deck search in exactly
 * two clicks — "Keep hand", then "Cast Hugh Yurg" — and, because the human takes the first turn, the route
 * contains no AI decision at all, so no worker timing can move it. If the route ever stops arriving, this
 * fails loudly rather than passing quietly with nothing checked.
 *
 * WHAT IT PROVES THAT NOTHING ELSE DOES. Before E10 this choice was three prompt-strip buttons all reading
 * "Play Luso onto the field", for three cards the player had never seen and could not tell apart. The
 * assertions below are the two halves of fixing that: the candidates are real controls with accessible names,
 * and those names carry both the card's own facts and the marker that says WHICH copy.
 */

const SEED_WITH_A_SEARCH = 5

test('a deck search offers its candidates as cards a person can see and press', async ({ page }) => {
  await page.goto(`/?seed=${SEED_WITH_A_SEARCH}`)

  await page.getByRole('button', { name: /Keep hand/ }).click()
  await page.getByRole('button', { name: /^Hugh Yurg.*Cast/ }).click()

  // The prompt says what is being asked. If the route drifted, this is where it fails, and it names the
  // reason rather than timing out on a selector.
  await expect(page.locator('.prompt__text'), 'the pinned route no longer reaches a deck search')
    .toHaveText(/choose up to 1 card in your deck/i)

  const candidates = page.getByRole('grid', { name: 'Choose a card' }).getByRole('button')
  await expect(candidates, 'this deck runs three Lusos and the search should offer all three').toHaveCount(3)

  // Chromium's own accessible names. Each names the card's facts — this is the detail a player needs and
  // could not get from "Play Luso onto the field" — and each carries a DIFFERENT occurrence marker, which is
  // the only thing distinguishing three copies of one card.
  const names = await candidates.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''))
  expect(new Set(names).size, `two candidates are indistinguishable: ${JSON.stringify(names)}`).toBe(3)
  for (const marker of ['Luso (1)', 'Luso (2)', 'Luso (3)']) {
    expect(names.some((n) => n.startsWith(marker)), `no candidate is named "${marker}"`).toBe(true)
  }
  for (const n of names) {
    expect(n, 'a candidate does not say what the card actually is').toMatch(/cost \d+.*forward.*power/i)
  }

  // And it is a real choice, not a display: pressing one answers the pending and the row goes away.
  await candidates.first().click()
  await expect(page.locator('.prompt__text'), 'the search did not resolve when a candidate was pressed')
    .not.toHaveText(/choose up to 1 card in your deck/i)
})
