/**
 * Card art addressing (spec B8/B9). Art is fetched once by `scripts/fetch-images.ts` into
 * `public/cards/<CODE>.jpg` and served from our own origin. Nothing here ever names the SE CDN:
 * hot-linking it at runtime is exactly what gets the IP WAF-blocked, and a single board render would
 * be dozens of requests.
 *
 * Whether a given file exists is never probed from JS — the `<Card>` component just renders an `<img>`
 * and falls back to the styled text card in `onError`. That keeps the app fully playable with zero
 * images downloaded (B-A5), and costs one 404 per missing code instead of a HEAD per card.
 */

/** Served from `public/cards/`, so this is the URL path too. */
export const ART_DIR = '/cards'

/** Local path for a card's art. Codes are `[0-9A-Za-z]+-[0-9]{3}[A-Z]`, so the encode is a no-op guard. */
export function artUrl(code: string): string {
  return `${ART_DIR}/${encodeURIComponent(code)}.jpg`
}

/**
 * Codes whose `<img>` has already errored this session. A board shows many copies of the same card, and
 * a fresh `<Card>` mounts on every choice; without this each one would re-request the same missing file
 * and flash the broken image before falling back.
 */
const missing = new Set<string>()

/** Call from `<img onError>`. Note this does NOT re-render — the component owns its own fallback state. */
export function markArtMissing(code: string): void {
  missing.add(code)
}

/** `?art=off` (UI overhaul U0): every card renders as its text card, with no `<img>` and so no request at all. */
let disabled = false

/** Turn art off for this page load. Used by `bootstrap` for `?art=off`, which the screenshot baselines rely on. */
export function disableArt(): void {
  disabled = true
}

/** True once this code's art is known absent, or art is off; `<Card>` then renders the text card without an `<img>`. */
export function isArtMissing(code: string): boolean {
  return disabled || missing.has(code)
}

/** Test seam — the cache and the off switch are module-global and would otherwise leak between cases. */
export function resetMissingArt(): void {
  missing.clear()
  disabled = false
}
