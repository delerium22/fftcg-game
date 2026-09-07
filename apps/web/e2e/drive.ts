import type { Page } from '@playwright/test'

/**
 * Plays a real game to its end, taking whatever the game currently offers.
 *
 * Uniformly driven from the first decision rather than assuming the opening steps. Who chooses first is not
 * fixed — the AI takes that decision in about half of games, in which case no `chooseFirst` button is ever
 * shown to the human, and a driver that waits for one waits forever.
 *
 * Since rung I1 a card's press opens its sheet, and the sheet's first action commits (or, for a cast, opens
 * the tray, where Auto + Confirm pay). Strip buttons are preferred; then any GLOWING card, through its sheet.
 * A sheet with nothing to offer is backed out of.
 */
export async function playToTheEnd(page: Page, budgetMs = 120_000): Promise<void> {
  const deadline = Date.now() + budgetMs
  while (Date.now() < deadline) {
    if (await page.locator('dialog.banner').count() > 0) return
    const sheet = page.locator('dialog[data-card-sheet]')
    if (await sheet.count()) {
      await sheet.locator('.sheet__actions button:not([disabled])').first().click({ timeout: 3000 }).catch(() => {})
      continue
    }
    const tray = page.locator('[data-payment-tray]')
    if (await tray.count()) {
      await tray.getByRole('button', { name: 'Auto' }).click({ timeout: 3000 }).catch(() => {})
      const confirm = tray.getByRole('button', { name: 'Confirm' })
      if (await confirm.isEnabled().catch(() => false)) await confirm.click({ timeout: 3000 }).catch(() => {})
      else await tray.getByRole('button', { name: 'Cancel' }).click({ timeout: 3000 }).catch(() => {})
      continue
    }
    const action = page.locator('.prompt__actions button').filter({ hasNotText: 'Concede' }).first()
    const glowing = page.locator('[role="gridcell"] button.is-selectable').first()
    const next = (await action.count()) ? action : (await glowing.count()) ? glowing : null
    if (next === null) { await page.waitForTimeout(120); continue }
    await next.click({ timeout: 3000 }).catch(() => {})
  }
  throw new Error('the game did not reach an end within the time allowed')
}
