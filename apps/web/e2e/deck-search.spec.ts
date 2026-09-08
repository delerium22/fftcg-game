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
 * vacuous when it misses and flaky when it hits. `?seed=8` reaches Hugh Yurg's whole-deck search in a fixed
 * sequence of clicks — "Take the first turn", "Keep hand", the Hugh Yurg card (which opens its sheet since
 * rung I1), "Cast Hugh Yurg", Auto and Confirm on the payment tray (rung I2), then Pass through the response
 * window rung J1 opens on his ETB. The AI's only decisions on the way are its mulligan and its forced pass. If the route ever stops arriving, this
 * fails loudly rather than passing quietly with nothing checked.
 *
 * WHAT IT PROVES THAT NOTHING ELSE DOES. Before E10 this choice was three prompt-strip buttons all reading
 * "Play Luso onto the field", for three cards the player had never seen and could not tell apart. The
 * assertions below are the two halves of fixing that: the candidates are real controls with accessible names,
 * and those names carry both the card's own facts and the marker that says WHICH copy.
 */

const SEED_WITH_A_SEARCH = 8

test('a deck search offers its candidates as cards a person can see and press', async ({ page }) => {
  await page.goto(`/?seed=${SEED_WITH_A_SEARCH}`)

  // Seed 8, not 5: rung J1 moved the AI's opening choice at seed 5 (it now takes the first turn). At seed 8
  // the human chooses first, keeps a hand holding Hugh Yurg, and — after the AI's one mulligan decision —
  // opens Main Phase 1 with him castable.
  await page.getByRole('button', { name: 'Take the first turn', exact: true }).click()
  await page.getByRole('button', { name: /Keep hand/ }).click()
  await expect(page.locator('.prompt__text'), 'the pinned route no longer reaches Main Phase 1')
    .toHaveText(/Main Phase 1/, { timeout: 20_000 })
  // Hugh Yurg is funded more than one way, so since rung E11 the card SELECTS rather than casting on the
  // first click — an action that hides a decision about your own hand should not fire the instant you touch
  // it. The cast is then the strip button. This check caught that change, which is what it is for.
  // Named WITHOUT its cast: since E11 a card that hides a payment choice no longer announces an action,
  // because pressing it no longer performs one. Matching on "…Cast Hugh Yurg paying…" here would be matching
  // on a claim the interface deliberately stopped making.
  // Rung I1/I2: the card's press opens its sheet, Cast opens the tray, Auto fills the preferred payment.
  await page.getByRole('button', { name: /^Hugh Yurg, cost/ }).click()
  await page.getByRole('dialog', { name: 'Hugh Yurg' }).getByRole('button', { name: 'Cast Hugh Yurg', exact: true }).click()
  await page.getByRole('button', { name: 'Auto', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()

  // Rung J1: Hugh Yurg's ETB is on the stack and the AI may respond to it. The human, holding priority, still
  // has real options (Geomancer's hand ability), so the window is a real one: pass, and the AI's forced pass
  // resolves the search. Guarded, so a hand without a second option (a pass-only window, closed by the app
  // itself) does not strand the route on a button that never appears.
  const pass = page.getByRole('button', { name: 'Pass', exact: true })
  if (await pass.isVisible({ timeout: 3000 }).catch(() => false)) await pass.click()

  // The prompt says what is being asked. If the route drifted, this is where it fails, and it names the
  // reason rather than timing out on a selector.
  await expect(page.locator('.prompt__text'), 'the pinned route no longer reaches a deck search')
    .toHaveText(/choose up to 1 card in your deck/i)

  // Seed 8's deck still holds every eligible Forward: three Lusos and two Undead Princesses.
  const candidates = page.getByRole('grid', { name: 'Choose a card' }).getByRole('button')
  await expect(candidates, 'this deck runs three Lusos and two Undead Princesses, and the search should offer all five').toHaveCount(5)

  // Chromium's own accessible names. Each names the card's facts — this is the detail a player needs and
  // could not get from "Play Luso onto the field" — and each carries a DIFFERENT occurrence marker, which is
  // the only thing distinguishing three copies of one card.
  const names = await candidates.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''))
  expect(new Set(names).size, `two candidates are indistinguishable: ${JSON.stringify(names)}`).toBe(5)
  for (const marker of ['Luso (1)', 'Luso (2)', 'Luso (3)', 'Undead Princess (1)', 'Undead Princess (2)']) {
    expect(names.some((n) => n.startsWith(marker)), `no candidate is named "${marker}"`).toBe(true)
  }
  for (const n of names) {
    expect(n, 'a candidate does not say what the card actually is').toMatch(/cost \d+.*forward.*power/i)
  }

  // And it is a real choice, not a display: pressing one opens its sheet, whose pick answers the pending
  // and the row goes away.
  await candidates.first().click()
  await page.getByRole('dialog').getByRole('button', { name: /^Play (Luso|Undead Princess)/ }).click()
  await expect(page.locator('.prompt__text'), 'the search did not resolve when a candidate was pressed')
    .not.toHaveText(/choose up to 1 card in your deck/i)
})
