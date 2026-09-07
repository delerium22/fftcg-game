import { expect, test } from '@playwright/test'
import { playToTheEnd as drive } from './drive.js'

/*
 * WHICH STEPS ACTUALLY EARN THEIR PLACE, measured rather than assumed.
 *
 *   step 2 (focus starts on the heading)  — fails on its own when focus is sent to the button instead.
 *   step 3 (first Tab reaches the action) — give "Play again" `tabIndex={-1}`: heading focus, modality,
 *                                           direct-focus refusal and Escape all still pass, and only this
 *                                           step notices that the sole action is sequentially unreachable.
 *   step 4 (forward Tabs stay inside)     — catches `show()` in place of `showModal()`, at the third Tab.
 *                                           This is the step that detects a genuinely non-modal dialog.
 *   step 5 (Shift+Tab stays inside)       — containment in one direction is not containment; no forward
 *                                           Tab can see a backwards escape.
 *   step 6 (direct focus is refused)      — I claimed I could not construct a mutation this catches alone.
 *                                           I was wrong, and the review built one: `show()` plus a
 *                                           hand-written bidirectional Tab trap. Steps 2–5 all pass — the
 *                                           trap really does contain Tab — while `outside.focus()` succeeds,
 *                                           because a scripted trap moves focus back but never makes the
 *                                           board inert. Only this step sees the difference.
 *   step 7 (Escape refused)               — fails on its own when `onCancel` stops preventing default.
 *
 * Saying "step 6 is unproven on its own" is better than implying every step is load-bearing.
 */

/**
 * The game-over dialog's modality, proved in a real browser — the boundary rung E7's plan review required,
 * and which nothing in jsdom can supply.
 *
 * This jsdom implements neither `showModal` nor `inert`, so the unit tests can only prove the lifecycle
 * CALLS `showModal` and that the accessible relationships are wired. Whether the board actually leaves the
 * tab order, whether Tab is contained, and whether Escape is refused are claims about the platform, and the
 * platform is the only thing that can answer them.
 *
 * Which step catches what is recorded above, from mutations rather than from reasoning about them.
 */

test('the game-over dialog is modal, and the board behind it is not reachable', async ({ page }) => {
  await page.goto('/')
  await drive(page)
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

  // 5. The REVERSE boundary. Shift+Tab from the first stop must not walk backwards onto the board either —
  //    a containment that only holds in one direction is not containment, and forward Tabs alone cannot see
  //    it. Return to "Play again" first, so the traversal starts from a known place.
  await page.locator('dialog.banner button').focus()
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Shift+Tab')
    const onBoard = await page.evaluate(() =>
      !!document.activeElement?.closest('.table__seat, .table__hand, .table__prompt, .table__rail'))
    expect(onBoard, `Shift+Tab ${i + 1} escaped the dialog backwards onto the board`).toBe(false)
  }

  // 6. THE decisive step. Ask a board control to take focus directly; a modal dialog must refuse it. A Tab
  //    count alone cannot distinguish a real modal from a `<div>` that happens to be last in the DOM.
  const refused = await page.evaluate(() => {
    const outside = document.querySelector<HTMLElement>('.seat button, .hand [role="gridcell"] button, .prompt__actions button')
    if (!outside) return 'no board control to try'
    outside.focus()
    return document.activeElement === outside ? 'took focus' : 'refused'
  })
  expect(refused, 'a board control behind the modal dialog could still be focused').toBe('refused')

  // 7. Escape leaves it open — the game is over and there is nothing to dismiss to.
  await page.keyboard.press('Escape')
  expect(await dialog.evaluate((d: HTMLDialogElement) => d.open), 'Escape closed the dialog onto a dead board').toBe(true)
})

test('restarting hands focus to the new game rather than to the document body', async ({ page }) => {
  // The defect the jsdom suite concealed: a new game's first decision is often the AI's, so the render right
  // after a restart offers no button, and an effect that spends its flag there leaves focus on `body`.
  await page.goto('/')
  await drive(page)
  await page.locator('dialog.banner button').click()
  await expect(page.locator('dialog.banner')).toHaveCount(0)
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.closest('.prompt__actions') !== null), { timeout: 15_000 })
    .toBe(true)
})
