import { expect, test, type Page } from '@playwright/test'
import { playToTheEnd } from './drive'

/**
 * UI overhaul UO-A1 — the board fits the screen: no page, seat or hand scroll, both Forward rows fully on screen, and the
 * prompt text and the actions over no card. A real mid-game position (turn 3 of seed 1), at three desktop sizes.
 */
type Box = { x: number; y: number; width: number; height: number }
const overlaps = (a: Box, b: Box): boolean => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

async function turn3(page: Page, decks = 'vol2,vol2'): Promise<void> {
  await page.goto(`/?seed=1&decks=${decks}&art=off`)
  await playToTheEnd(page, 90_000, async () => /Turn 3\b/.test((await page.locator('.prompt__phase').textContent().catch(() => '')) ?? ''))
}

for (const [w, h] of [[1280, 720], [1440, 900], [1920, 1080]] as const) {
  test(`the board fits ${w}×${h} with nothing scrolled or covered (UO-A1)`, async ({ page }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width: w, height: h })
    await turn3(page)
    const fit = await page.evaluate(() => ({
      pageScrollsY: document.documentElement.scrollHeight > innerHeight + 1,
      pageScrollsX: document.documentElement.scrollWidth > innerWidth + 1,
      seatScrolls: [...document.querySelectorAll<HTMLElement>('.table__seat')].some((s) => s.scrollHeight > s.clientHeight + 1),
      handScrollsY: [...document.querySelectorAll<HTMLElement>('.hand')].some((s) => s.scrollHeight > s.clientHeight + 1),
    }))
    expect(fit).toEqual({ pageScrollsY: false, pageScrollsX: false, seatScrolls: false, handScrollsY: false })
    for (const label of ['AI Forwards', 'Your Forwards']) {
      const row = page.locator('.zone').filter({ has: page.locator('.zone__label', { hasText: label }) })
      const box = await row.boundingBox()
      expect(box, `${label} is not rendered`).not.toBeNull()
      expect(box!.y, `${label} starts above the viewport`).toBeGreaterThanOrEqual(0)
      expect(box!.y + box!.height, `${label} ends below the viewport`).toBeLessThanOrEqual(h)
    }
    const cards = await page.locator('.card').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON() as Box))
    for (const sel of ['.prompt__text', '.prompt__actions']) {
      const box = await page.locator(sel).boundingBox()
      if (!box) continue
      expect(cards.filter((c) => overlaps(box, c)), `${sel} covers a card`).toEqual([])
    }
  })
}

test('dulling a card moves no other card (D29)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/fixtures.html?art=off&motion=instant')
  const active = await page.locator('figure[data-fixture="forward, field"] .card').boundingBox()
  const dull = await page.locator('figure[data-fixture="forward, dull"] .card').boundingBox()
  expect(dull!.width).toBeCloseTo(active!.width, 0)
  expect(dull!.height).toBeCloseTo(active!.height, 0)
})

/*
 * The final review's stresses (U2b): states turn 3 of seed 1 does not reach, built in the live DOM at 1280×720 and measured
 * at once, before anything re-renders. Each guards one review finding.
 */
const scrolls = (sel: string) => `[...document.querySelectorAll('${sel}')].map((e) => ({ x: e.scrollWidth > e.clientWidth + 1, y: e.scrollHeight > e.clientHeight + 1 }))`

test('five more strip buttons leave the prompt text readable and the seats whole (review F1)', async ({ page }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1280, height: 720 })
  await turn3(page)
  await page.evaluate(`(() => {
    const actions = document.querySelector('.prompt__actions')
    const proto = actions.querySelector('button')
    for (let i = 0; i < 5; i++) { const b = proto.cloneNode(true); b.textContent = 'Use ability: Class Tenth Moogle ' + i; actions.append(b) }
  })()`)
  const text = (await page.locator('.prompt__text').boundingBox())!
  const track = (await page.locator('.phase-track').boundingBox())!
  // The centre column's floor is 16ch (about 139px here): three short lines, not one word per line.
  expect(text.width, 'the prompt text keeps a readable width').toBeGreaterThanOrEqual(130)
  expect(overlaps(text, track), 'the prompt text runs over the phase tracker').toBe(false)
  expect(await page.evaluate(scrolls('.table__seat'))).toEqual([{ x: false, y: false }, { x: false, y: false }])
})

test('a seat that overflows can still be scrolled (review F2)', async ({ page }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1280, height: 720 })
  await turn3(page)
  await page.evaluate(`document.querySelector('.prompt__lead').append(Object.assign(document.createElement('div'), { style: 'height: 200px' }))`)
  const seats = await page.evaluate(`[...document.querySelectorAll('.table__seat')].map((s) => ({ over: s.scrollHeight > s.clientHeight + 1, y: getComputedStyle(s).overflowY }))`) as { over: boolean; y: string }[]
  expect(seats.some((s) => s.over), 'the spacer did not make a seat overflow').toBe(true)
  for (const s of seats.filter((x) => x.over)) expect(['auto', 'scroll']).toContain(s.y)
})

for (const [w, h, n] of [[1280, 720, 10], [2560, 1440, 12]] as const) {
  test(`a ${n}-card hand fans inside its row at ${w}×${h} (review F3)`, async ({ page }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width: w, height: h })
    await turn3(page)
    await page.evaluate(`(() => {
      const row = document.querySelector('.hand .grid__row')
      const cells = [...row.children]
      for (let i = 0; row.children.length < ${n}; i++) row.append(cells[i % cells.length].cloneNode(true))
      ;[...row.children].forEach((c, i) => { c.style.setProperty('--i', String(i)); c.style.setProperty('--n', '${n}') })
    })()`)
    expect(await page.evaluate(scrolls('.hand'))).toEqual([{ x: false, y: false }])
    const hand = (await page.locator('.hand').boundingBox())!
    const cards = await page.locator('.hand .card').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON() as Box))
    expect(cards).toHaveLength(n)
    expect(Math.min(...cards.map((c) => c.x)), 'the first card leaves the hand on the left').toBeGreaterThanOrEqual(hand.x - 1)
    expect(Math.max(...cards.map((c) => c.x + c.width)), 'the last card leaves the hand on the right').toBeLessThanOrEqual(hand.x + hand.width + 1)
  })
}

test('an 8-card LB deck sits beside a full hand without either scrolling (review C1)', async ({ page }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1280, height: 720 })
  await turn3(page, 'vol1,vol2')
  const lb = page.locator('.table__hand .zone').filter({ has: page.locator('.zone__label', { hasText: 'Your LB deck' }) })
  expect(await lb.locator('.card').count(), 'Vol. 1 brings eight LB cards').toBe(8)
  expect(await page.evaluate(scrolls('.hand, .table__hand .zone__cards'))).toEqual([{ x: false, y: false }, { x: false, y: false }])
})

test('a long orphan row gives way before the hand does (review F4)', async ({ page }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1280, height: 720 })
  await turn3(page)
  await page.evaluate(`(() => {
    const lb = [...document.querySelectorAll('.table__hand .zone')].find((z) => z.querySelector('.zone__label').textContent === 'Your LB deck')
    const orphan = lb.cloneNode(true)
    orphan.className = 'zone'
    orphan.querySelector('.zone__label').textContent = 'Choose a card'
    const row = orphan.querySelector('.grid__row')
    const cells = [...row.children]
    for (let i = 0; row.children.length < 8; i++) row.append(cells[i % cells.length].cloneNode(true))
    lb.parentElement.prepend(orphan)
  })()`)
  expect(await page.evaluate(scrolls('.hand')), 'the hand scrolls').toEqual([{ x: false, y: false }])
  const orphan = (await page.locator('.table__hand .zone').first().boundingBox())!
  expect(orphan.width, 'the orphan row keeps room for its choices').toBeGreaterThanOrEqual(120)
})
