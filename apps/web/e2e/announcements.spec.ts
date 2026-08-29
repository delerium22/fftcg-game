import { expect, test } from '@playwright/test'

/**
 * The live regions, as the BROWSER computes them — not as the DOM declares them.
 *
 * I had written in the spec that automation could prove "none of the behaviour" here. That was too strong in
 * the opposite direction from my usual error, and the plan review corrected it: Chromium computes `live`,
 * `atomic` and `relevant` into its accessibility tree, and they can be read back. An attribute in the DOM
 * and a live property in the accessibility tree are different claims, and only the second is what assistive
 * technology actually consumes.
 *
 * The honest boundary is still real, and narrower than I said: automation proves the DOM and the
 * browser-accessibility contract. Whether a screen reader SPOKE — its timing, ordering, interruption and
 * duplication — needs a screen reader, and nothing here claims it.
 *
 * AND THERE IS A SECOND BOUNDARY, measured rather than assumed. These tests CANNOT tell an explicit
 * `aria-live="polite"` / `aria-atomic="true"` from the implicit values `role="status"` already carries:
 * Chromium computes the same tree either way, so deleting both attributes leaves this suite green. The
 * jsdom tests in `test/announcements.test.tsx` are what pin the explicit declarations, and the explicit
 * declarations exist because not every environment honours the implicit ones.
 *
 * So the two suites are complementary rather than redundant: jsdom pins the DOM contract we wrote, the
 * browser pins the accessibility contract Chromium derives. Either alone leaves a real mutant alive, which
 * is why both are here.
 */

test('the browser computes the prompt as a polite, atomic status region', async ({ page }) => {
  await page.goto('/')
  const prompt = page.locator('.prompt__text')
  await expect(prompt).toBeVisible()

  // Chromium's own computed accessibility node, via CDP — not the attributes we wrote.
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Accessibility.enable')
  const { root } = await cdp.send('DOM.getDocument') as { root: { nodeId: number } }
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '.prompt__text' }) as { nodeId: number }
  expect(nodeId, 'the prompt text is not in the document').toBeGreaterThan(0)
  const { nodes } = await cdp.send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false }) as {
    nodes: { role?: { value?: string }; properties?: { name: string; value: { value?: unknown } }[] }[]
  }
  const node = nodes[0]
  expect(node, 'the prompt has no accessibility node at all').toBeDefined()
  expect(node!.role?.value, 'the browser does not compute the prompt as a status region').toBe('status')

  const prop = (name: string): unknown => node!.properties?.find((p) => p.name === name)?.value?.value
  expect(prop('live'), 'the browser computes no live politeness for the prompt').toBe('polite')
  expect(prop('atomic'), 'the browser would announce only the changed fragment of an instruction').toBe(true)
})

test('the browser computes the event log as a log region with a name', async ({ page }) => {
  await page.goto('/')
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Accessibility.enable')
  const { root } = await cdp.send('DOM.getDocument') as { root: { nodeId: number } }
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '.log__lines' }) as { nodeId: number }
  expect(nodeId, 'the event log is not in the document').toBeGreaterThan(0)
  const { nodes } = await cdp.send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false }) as {
    nodes: { role?: { value?: string }; name?: { value?: string }; properties?: { name: string; value: { value?: unknown } }[] }[]
  }
  const node = nodes[0]
  // Guarded before dereferencing, like the prompt test: an absent AX node would otherwise throw a raw
  // TypeError before any matcher ran, and a crash is not a diagnosis.
  expect(node, 'the event log has no accessibility node at all').toBeDefined()
  expect(node!.role?.value, 'the AI’s moves arrive with no announcement channel').toBe('log')
  // `log` is implicitly polite, so a computed-role check alone cannot see `aria-live="off"` — which would
  // silence the channel while leaving the role in place, restoring the exact defect this rung fixed.
  const prop = (name: string): unknown => node!.properties?.find((p) => p.name === name)?.value?.value
  expect(prop('live'), 'the log has a role but announces nothing').toBe('polite')
  // Exactly "Game log", not "GAME LOG". Labelling the region by its visible heading produced the latter,
  // because Chromium folds CSS `text-transform` into the computed name and the heading is styled uppercase.
  expect(node!.name?.value, 'the log region is unnamed, or its name is a side effect of styling').toBe('Game log')
})

test('the live regions fall silent for the dialog and come back for the next game', async ({ page }) => {
  /*
   * The whole lifecycle, in one real game. Three live channels would otherwise fire on the result
   * transition — the status changing to "Game over", the log gaining the result line, and the alertdialog
   * mounting and taking focus — so the other two stand down while the dialog speaks.
   *
   * The half that had no coverage anywhere is the RECOVERY. Switching a live region off mid-life is only
   * safe if it comes back; a region left silent after "Play again" would mean the next whole game is played
   * without a single announcement, which is worse than the defect this rung was written to fix and would
   * look identical to a working build in every unit test.
   */
  const live = () => page.evaluate(() => ({
    prompt: document.querySelector('.prompt__text')?.getAttribute('aria-live') ?? null,
    log: document.querySelector('.log__lines')?.getAttribute('aria-live') ?? null,
  }))

  await page.goto('/')
  expect(await live(), 'the regions are not announcing during play').toEqual({ prompt: 'polite', log: 'polite' })

  const deadline = Date.now() + 120_000
  while (Date.now() < deadline && await page.locator('dialog.banner').count() === 0) {
    const action = page.locator('.prompt__actions button').filter({ hasNotText: 'Concede' }).first()
    const boardCard = page.locator('.zone [role="gridcell"] button').first()
    const handCard = page.locator('.hand [role="gridcell"] button').first()
    const next = (await action.count()) ? action : (await boardCard.count()) ? boardCard : (await handCard.count()) ? handCard : null
    if (next === null) { await page.waitForTimeout(120); continue }
    await next.click({ timeout: 3000 }).catch(() => {})
  }
  await expect(page.locator('dialog.banner')).toBeVisible()
  expect(await live(), 'the regions talk over the game-over dialog').toEqual({ prompt: 'off', log: 'off' })

  await page.locator('dialog.banner button').click()
  await expect(page.locator('dialog.banner')).toHaveCount(0)
  await expect.poll(live, { timeout: 15_000 })
    .toEqual({ prompt: 'polite', log: 'polite' })
})
