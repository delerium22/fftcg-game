import { expect, type Page } from '@playwright/test'

/**
 * Fail closed before any screenshot that gets committed: card art is Square Enix's and must never reach the
 * repository. Every committed image is taken with `?art=off`; these two helpers prove that flag was in force for the
 * page in question, so a regression in `?art=off` stops the recording instead of writing a scan into git.
 */

/** Start recording requests for card art. Call before `page.goto`. */
export function watchArtRequests(page: Page): string[] {
  const urls: string[] = []
  page.on('request', (r) => { if (new URL(r.url()).pathname.startsWith('/cards/')) urls.push(r.url()) })
  return urls
}

/** The page shows no scan and asked for none. Call immediately before taking the screenshot. */
export async function expectNoArt(page: Page, requests: readonly string[]): Promise<void> {
  await expect(page.locator('img.card__img'), 'a card rendered its scan: ?art=off is not in force').toHaveCount(0)
  expect(requests, 'card art was requested: ?art=off is not in force').toEqual([])
}
