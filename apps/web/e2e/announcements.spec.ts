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
    nodes: { role?: { value?: string }; name?: { value?: string } }[]
  }
  const node = nodes[0]
  expect(node!.role?.value, 'the AI’s moves arrive with no announcement channel').toBe('log')
  // Exactly "Game log", not "GAME LOG". Labelling the region by its visible heading produced the latter,
  // because Chromium folds CSS `text-transform` into the computed name and the heading is styled uppercase.
  expect(node!.name?.value, 'the log region is unnamed, or its name is a side effect of styling').toBe('Game log')
})
