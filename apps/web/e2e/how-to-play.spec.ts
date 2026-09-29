import { expect, test } from '@playwright/test'

/**
 * Rung H1 — the rules sheet, proved where modality actually exists.
 *
 * The Playwright config pre-seeds `fftcg.howToPlay.seen` for every spec so the five older ones land on the
 * board as they always did; this file alone starts from an EMPTY storage state to meet the sheet as a
 * first-time player does. The card-text size (H1-A4) is asserted here too: jsdom loads no CSS, so a computed
 * `font-size` can only be read in a browser.
 */
test.use({ storageState: { cookies: [], origins: [] } })

test('a first-time player meets the rules sheet, and it is modal (H1-A1)', async ({ page }) => {
  // Seed 1 hands the human the first decision, so a strip button exists to reach once the sheet closes.
  // Who chooses first is the seed's call in about half of games, and a free seed would make this flaky.
  await page.goto('/?seed=1&decks=vol2,vol2&motion=instant')
  const dialog = page.getByRole('dialog', { name: 'How to play' })
  await expect(dialog).toBeVisible()
  // Focus starts on the heading, so a screen reader hears what this is before what it can do.
  await expect(page.locator('dialog h2:focus')).toHaveText('How to play')
  // The board is inert: a board control asked to take focus directly must be refused — the decisive step,
  // the same one the game-over spec uses. (`locator.focus()` is the wrong tool here: it waits for the
  // element to become actionable, and an inert element never does.)
  const first = page.getByRole('button', { name: 'Take the first turn' })
  const refused = await page.evaluate(() => {
    // The rail's own "How to play" button: always present, always outside the sheet.
    const outside = document.querySelector<HTMLElement>('.rail__help button')
    if (!outside) return 'no board control to try'
    outside.focus()
    return document.activeElement === outside ? 'took focus' : 'refused'
  })
  expect(refused, 'a board control behind the rules sheet could still be focused').toBe('refused')
  // Tabbing on never lands on the board. It may pass through the document root — what a modal dialog with a
  // single tabbable child does — and what matters is that no board control is ever reached.
  await page.getByRole('button', { name: 'Play', exact: true }).focus()
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Tab')
    const onBoard = await page.evaluate(() =>
      !!document.activeElement?.closest('.table__seat, .table__hand, .table__prompt, .table__rail, .table__toolbar'))
    expect(onBoard, `Tab ${i + 1} escaped the rules sheet onto the board`).toBe(false)
  }

  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await expect(dialog).toBeHidden()
  // Now the board answers: the first decision is reachable.
  await first.focus()
  await expect(first).toBeFocused()

  // A reload does not show it again.
  await page.reload()
  await expect(page.getByRole('dialog', { name: 'How to play' })).toHaveCount(0)
  await expect(first).toBeVisible()
})

test('the rail button reopens it, and Escape closes it (H1-A2)', async ({ page }) => {
  await page.goto('/?motion=instant')
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await page.getByRole('button', { name: 'How to play' }).click()
  const dialog = page.getByRole('dialog', { name: 'How to play' })
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})

test('a card\'s text reads at 15px in full ink once you point at it (H1-A4)', async ({ page }) => {
  await page.goto('/?seed=21&decks=vol2,vol2&motion=instant')
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  // Reach a hand: whoever chooses first, the human eventually holds five cards at the mulligan.
  const chooseFirst = page.getByRole('button', { name: 'Take the first turn' })
  if (await chooseFirst.isVisible().catch(() => false)) await chooseFirst.click()
  const card = page.locator('[role="grid"][aria-label="Your hand"] .card').first()
  await expect(card).toBeVisible({ timeout: 30_000 })
  await card.hover()
  const text = page.locator('.details__text')
  await expect(text).toBeVisible()
  const style = await text.evaluate((el) => {
    const cs = getComputedStyle(el)
    return { size: parseFloat(cs.fontSize), color: cs.color, ink: getComputedStyle(document.documentElement).getPropertyValue('--ink').trim() }
  })
  expect(style.size, 'the printed text is still small type').toBeGreaterThanOrEqual(15)
  // `--ink` is `#e9f0f4`; computed colour comes back as rgb().
  expect(style.color.replace(/\s/g, '')).toBe('rgb(233,240,244)')
})
