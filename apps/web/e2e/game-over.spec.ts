import { expect, test, type Page } from '@playwright/test'

/**
 * The game-over dialog's modality, proved in a real browser — the six-step boundary rung E7's plan review
 * required, and which nothing in jsdom can supply.
 *
 * This jsdom implements neither `showModal` nor `inert`, so the unit tests can only prove the lifecycle
 * CALLS `showModal` and that the accessible relationships are wired. Whether the board actually leaves the
 * tab order, whether Tab is contained, and whether Escape is refused are claims about the platform, and the
 * platform is the only thing that can answer them.
 *
 * The step that matters most is the fifth. With focus starting on the title, the FIRST Tab lands on
 * "Play again" even when the board is entirely non-modal — so a one-Tab check would pass against a plain
 * `<div>`. Only asking a board control to take focus, and being refused, distinguishes the two.
 */

/**
 * Plays a real game to its end, taking whatever the game currently offers.
 *
 * Uniformly driven from the first decision rather than assuming the opening steps. Who chooses first is not
 * fixed — the AI takes that decision in about half of games, in which case no `chooseFirst` button is ever
 * shown to the human, and a driver that waits for one waits forever.
 */
async function playToTheEnd(page: Page): Promise<void> {
  await page.goto('/')
  const deadline = Date.now() + 150_000
  while (Date.now() < deadline) {
    if (await page.locator('dialog.banner').count() > 0) return
    const action = page.locator('.prompt__actions button').filter({ hasNotText: 'Concede' }).first()
    const boardCard = page.locator('.zone [role="gridcell"] button').first()
    const handCard = page.locator('.hand [role="gridcell"] button').first()
    const next = (await action.count()) ? action : (await boardCard.count()) ? boardCard : (await handCard.count()) ? handCard : null
    if (next === null) { await page.waitForTimeout(120); continue }
    await next.click({ timeout: 3000 }).catch(() => {})
  }
  throw new Error('the game did not reach an end within the time allowed')
}

test('the game-over dialog is modal, and the board behind it is not reachable', async ({ page }) => {
  await playToTheEnd(page)
  const dialog = page.locator('dialog.banner')
  await expect(dialog).toBeVisible()

  // 1. It is actually open, not merely rendered.
  expect(await dialog.evaluate((d: HTMLDialogElement) => d.open), 'the dialog rendered but never opened').toBe(true)

  // 2. Focus starts on the outcome, not on the container and not on the button.
  const focused = () => page.evaluate(() => ({
    tag: document.activeElement?.tagName ?? '',
    text: document.activeElement?.textContent?.trim() ?? '',
    inDialog: document.querySelector('dialog.banner')?.contains(document.activeElement) ?? false,
  }))
  expect(await focused()).toMatchObject({ tag: 'H2', inDialog: true })

  // 3. The first Tab reaches the only action.
  await page.keyboard.press('Tab')
  expect(await focused()).toMatchObject({ tag: 'BUTTON', text: 'Play again', inDialog: true })

  // 4. Tabbing on never lands on the board. It may pass through the document root, which is what a modal
  //    dialog with a single tabbable child does — what matters is that no board control is ever reached.
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Tab')
    const onBoard = await page.evaluate(() =>
      !!document.activeElement?.closest('.table__seat, .table__hand, .table__prompt, .table__rail'))
    expect(onBoard, `Tab ${i + 2} escaped the dialog onto the board`).toBe(false)
  }

  // 5. THE decisive step. Ask a board control to take focus directly; a modal dialog must refuse it. A Tab
  //    count alone cannot distinguish a real modal from a `<div>` that happens to be last in the DOM.
  const refused = await page.evaluate(() => {
    const outside = document.querySelector<HTMLElement>('.seat button, .hand [role="gridcell"], .prompt__actions button')
    if (!outside) return 'no board control to try'
    outside.focus()
    return document.activeElement === outside ? 'took focus' : 'refused'
  })
  expect(refused, 'a board control behind the modal dialog could still be focused').toBe('refused')

  // 6. Escape leaves it open — the game is over and there is nothing to dismiss to.
  await page.keyboard.press('Escape')
  expect(await dialog.evaluate((d: HTMLDialogElement) => d.open), 'Escape closed the dialog onto a dead board').toBe(true)
})

test('restarting hands focus to the new game rather than to the document body', async ({ page }) => {
  // The defect the jsdom suite concealed: a new game's first decision is often the AI's, so the render right
  // after a restart offers no button, and an effect that spends its flag there leaves focus on `body`.
  await playToTheEnd(page)
  await page.locator('dialog.banner button').click()
  await expect(page.locator('dialog.banner')).toHaveCount(0)
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.closest('.prompt__actions') !== null), { timeout: 15_000 })
    .toBe(true)
})
