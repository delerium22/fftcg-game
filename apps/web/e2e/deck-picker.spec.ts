import { expect, test } from '@playwright/test'

/**
 * Rung V1-C — a deck per seat, in a real browser.
 *
 * Every older spec pins `decks=vol2,vol2`, the mirror its route was written against, so the app's REAL default
 * pair — you Vol. 2 against the AI Vol. 1 — would otherwise run nowhere but in jsdom, and jsdom has no `Worker`.
 * The first test here is the one that sends Vol. 1's list through the actual worker: if the AI were handed the
 * wrong list for either seat, its determinisation would fail and the coordinator would fall back to Greedy with
 * an amber warning in the log.
 *
 * ROUTE PINNED BY A FINDER, not played: who makes the first-player choice is the seed's call whatever the decks
 * (`createGame` draws it after both shuffles, whose RNG use depends only on the lists' length, 50 for both; a finder
 * over `createWebGame`: seeds 2, 4, 5, 7 give it to the AI), and seed 5 gives it to the AI — so the AI's first move
 * is a real search with no human click before it.
 */

test('the default pair: the AI plays Vol. 1 through the real worker, with no fallback', async ({ page }) => {
  await page.goto('/?seed=5')
  await expect(page.locator('.log__line').first()).toHaveText('New game — you play Starter Vol. 2, the AI plays Starter Vol. 1')
  await expect(page.getByRole('button', { name: 'New game (Vol. 2 vs Vol. 1)' })).toBeVisible()
  // The AI's opening choice, searched by the worker and paced by the coordinator. That one is decided before
  // the deal, when no card is visible to test a list against — so play on to a decision made WITH the AI's hand
  // in view (its mulligan), keeping the human's own hand whenever asked.
  const aiMoves = page.locator('.log__line--ai')
  await expect(aiMoves.first(), 'the AI never moved').toHaveText(/^The AI: /, { timeout: 20_000 })
  await expect.poll(async () => {
    const keep = page.getByRole('button', { name: /Keep hand/ })
    if (await keep.count()) await keep.click({ timeout: 2000 }).catch(() => {})
    return aiMoves.count()
  }, { timeout: 30_000, message: 'the AI never made a decision after the deal' }).toBeGreaterThanOrEqual(2)
  await expect(page.locator('.log__lines'), 'the AI never took its mulligan decision').toContainText(/The AI (mulligans|keeps its hand)/)
  // No warning of any kind: a worker that failed on the per-seat lists says so here, in amber, and plays on.
  await expect(page.locator('.log__line--warning')).toHaveCount(0)
})

test('the picker is labelled, last in the tab order, and a keyboard can start the chosen pair', async ({ page }) => {
  // Seed 1 hands the HUMAN the first decision, so the board has its own controls to tab through first.
  await page.goto('/?seed=1')
  await expect(page.getByRole('button', { name: 'Take the first turn' })).toBeVisible()

  // Visible labels, as the browser computes them: `getByLabel` resolves the <label>, not an aria-label.
  await expect(page.getByLabel('Your deck')).toHaveValue('vol2')
  await expect(page.getByLabel('AI deck')).toHaveValue('vol1')

  // One full lap of the tab order, from the document root back to it, recording where each stop lands. (Where the
  // FIRST Tab lands depends on Chromium's focus-navigation starting point, which a page load does not reset to the
  // top, so the lap is measured between two visits to the root rather than from the first press.) The toolbar is
  // DRAWN above the board but comes AFTER it: "New game" throws the game away, so a keyboard player meets the
  // board's decision first.
  const stops: { where: string; name: string }[] = []
  let atRoot = 0
  for (let i = 0; i < 80 && atRoot < 2; i++) {
    await page.keyboard.press('Tab')
    const stop = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null
      if (!el || el === document.body) return null
      const where = el.closest('.table__toolbar') ? 'toolbar' : el.closest('.table') ? 'board' : 'other'
      const label = el instanceof HTMLSelectElement ? el.labels?.[0]?.textContent ?? '' : el.textContent ?? ''
      return { where, name: `${el.tagName.toLowerCase()}:${label.trim()}` }
    })
    if (stop === null) atRoot++
    else if (atRoot === 1) stops.push(stop)
  }
  expect(atRoot, 'the tab order never came back round to the document root').toBe(2)
  const firstToolbar = stops.findIndex((s) => s.where === 'toolbar')
  expect(firstToolbar, `the toolbar was never reached: ${JSON.stringify(stops)}`).toBeGreaterThan(0)
  expect(stops.slice(0, firstToolbar).some((s) => s.name === 'button:Take the first turn'), 'the board\'s decision came after the toolbar').toBe(true)
  expect(stops.slice(firstToolbar).map((s) => s.name)).toEqual(['select:Your deck', 'select:AI deck', 'button:New game (Vol. 2 vs Vol. 1)'])

  // Keyboard only from here: change the AI's deck, then press New game with Enter.
  // Type-ahead, not arrow keys: on macOS an arrow key on a closed select opens its popup rather than moving the
  // value, so typing the option's text is the keystroke that behaves the same on every platform.
  await page.getByLabel('AI deck').focus()
  await page.keyboard.type('Vol. 2')
  await expect(page.getByLabel('AI deck'), 'the select did not respond to the keyboard').toHaveValue('vol2')
  // The game in progress is untouched by the choice (C-D1).
  await expect(page.locator('.log__line').first()).toHaveText('New game — you play Starter Vol. 2, the AI plays Starter Vol. 1')
  const newGame = page.getByRole('button', { name: 'New game (Vol. 2 vs Vol. 2)' })
  await newGame.focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('.log__line').first()).toHaveText('New game — you play Starter Vol. 2, the AI plays Starter Vol. 2')
  // And focus goes to the new game's first decision, not back to the end of the tab order. The new game is seed 2,
  // where the AI chooses first: while it thinks the strip holds only the Full control toggle, which is not a
  // decision, so the check is for a `[data-command]` button (V1-C review).
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.matches('.prompt__actions button[data-command]') ?? false), { timeout: 15_000 })
    .toBe(true)
})

test('?seed=5&decks=vol1,vol1 reproduces the same game on reload', async ({ page }) => {
  await page.goto('/?seed=5&decks=vol1,vol1')
  await expect(page.locator('.log__line').first()).toHaveText('New game — you play Starter Vol. 1, the AI plays Starter Vol. 1')
  await expect(page.getByLabel('Your deck')).toHaveValue('vol1')
  await expect(page.getByLabel('AI deck')).toHaveValue('vol1')
  // The AI chooses first at seed 5; once it has, the human's hand is dealt. Read it, reload, read it again.
  const hand = page.getByRole('grid', { name: 'Your hand' })
  await expect(page.locator('.log__line--ai').first()).toBeVisible({ timeout: 20_000 })
  await expect(hand.locator('[data-card-id]').first()).toBeVisible()
  const first = await hand.textContent()
  await page.reload()
  await expect(page.locator('.log__line--ai').first()).toBeVisible({ timeout: 20_000 })
  await expect(hand.locator('[data-card-id]').first()).toBeVisible()
  expect(await hand.textContent()).toBe(first)
})
