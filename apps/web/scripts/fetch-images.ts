/**
 * One-shot fetcher for the real card art (spec B8): `public/cards/<CODE>.jpg`, git-ignored, never committed.
 *
 *   pnpm --filter @fftcg/web fetch-images [--dry-run]
 *
 * The Square Enix CDN sits behind a Cloudflare WAF that rate-limits hard — roughly a dozen rapid requests
 * IP-blocked this machine in a previous session, and retrying does not undo that. Every rule below exists
 * for that one reason: strictly serial (never `Promise.all`, never a pool), >= 1 s between requests, abort
 * on the first 403/429 instead of pushing on, and skip anything already on disk so a re-run is free and
 * resumes exactly where an aborted run stopped. 18 distinct codes, so a cold run is ~20 s.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseDeckFile } from '@fftcg/cards/deck'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..', '..')

export const DECK_FILE = join(repoRoot, 'decks', 'starter-2025-vol2.txt')
export const OUT_DIR = join(here, '..', 'public', 'cards')

const CDN = 'https://fftcg.cdn.sewest.net/images/cards/full'
/** >= 1 request/second with headroom; the WAF's real threshold is unknown, so err slow. */
const DELAY_MS = 1100
/** A longer Retry-After than this means "come back later", not "hold the terminal open". */
const MAX_WAIT_MS = 60_000

export interface FetchPlanEntry {
  code: string
  url: string
  dest: string
}

export function cdnUrl(code: string): string {
  return `${CDN}/${encodeURIComponent(code)}_eg.jpg`
}

/**
 * What a run would fetch: the distinct codes of `deckText` in first-appearance order, minus the ones already
 * cached. Pure (the caller supplies `cached`) so `--dry-run` and the tests exercise the same planner the real
 * run uses without touching the network.
 */
export function planFetches(deckText: string, outDir: string, cached: ReadonlySet<string>): FetchPlanEntry[] {
  const seen = new Set<string>()
  const plan: FetchPlanEntry[] = []
  for (const code of parseDeckFile(deckText)) {
    if (seen.has(code)) continue
    seen.add(code)
    if (cached.has(code)) continue
    plan.push({ code, url: cdnUrl(code), dest: join(outDir, `${code}.jpg`) })
  }
  return plan
}

/** Codes already on disk. `.part` files are ignored — a truncated write must not read as cached. */
export function cachedCodes(outDir: string): Set<string> {
  if (!existsSync(outDir)) return new Set()
  return new Set(readdirSync(outDir).filter((f) => f.endsWith('.jpg')).map((f) => f.slice(0, -'.jpg'.length)))
}

/** Retry-After is either delta-seconds or an HTTP-date (RFC 9110 §10.2.3); accept both, reject junk. */
export function retryAfterMs(header: string | null | undefined, now: number = Date.now()): number | null {
  const raw = header?.trim()
  if (!raw) return null
  const secs = Number(raw)
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000)
  const at = Date.parse(raw)
  return Number.isNaN(at) ? null : Math.max(0, at - now)
}

class CdnError extends Error {
  constructor(
    message: string,
    readonly rateLimited: boolean,
    readonly waitMs: number | null,
  ) {
    super(message)
    this.name = 'CdnError'
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const secs = (ms: number): string => `${Math.ceil(ms / 1000)}s`

async function fetchOne(entry: FetchPlanEntry): Promise<number> {
  const res = await fetch(entry.url, { headers: { accept: 'image/jpeg,image/*;q=0.8' } })
  const wait = retryAfterMs(res.headers.get('retry-after'))
  if (res.status === 403 || res.status === 429) throw new CdnError(`HTTP ${res.status}`, true, wait)
  if (!res.ok) throw new CdnError(`HTTP ${res.status}`, false, wait)
  const type = res.headers.get('content-type') ?? ''
  // A WAF challenge answers 200 with an HTML interstitial. Writing that as a .jpg would poison the cache
  // permanently, since the skip-if-present check would then never re-fetch the code.
  if (!type.startsWith('image/')) throw new CdnError(`200 but content-type "${type}" — WAF challenge, not an image`, true, wait)
  const bytes = new Uint8Array(await res.arrayBuffer())
  if (bytes.byteLength === 0) throw new CdnError('empty body', false, wait)
  // Write-then-rename: an interrupted run must not leave a truncated .jpg that later reads as cached.
  const part = `${entry.dest}.part`
  try {
    writeFileSync(part, bytes)
    renameSync(part, entry.dest)
  } catch (e) {
    rmSync(part, { force: true })
    throw e
  }
  return bytes.byteLength
}

export async function main(argv: readonly string[]): Promise<number> {
  const dryRun = argv.includes('--dry-run')
  const unknown = argv.filter((a) => a !== '--dry-run')
  if (unknown.length) {
    console.error(`usage: fetch-images [--dry-run] (unrecognised: ${unknown.join(' ')})`)
    return 2
  }

  const deckText = readFileSync(DECK_FILE, 'utf8')
  const cached = cachedCodes(OUT_DIR)
  const plan = planFetches(deckText, OUT_DIR, cached)
  const distinct = planFetches(deckText, OUT_DIR, new Set()).length
  const skipped = distinct - plan.length
  console.log(`${DECK_FILE}: ${distinct} distinct codes, ${skipped} already cached in ${OUT_DIR}`)

  if (dryRun) {
    for (const e of plan) console.log(`  would fetch ${e.code}  ${e.url}  ->  ${e.dest}`)
    console.log(`dry run: ${plan.length} would be fetched, ${skipped} skipped, 0 network requests made`)
    return 0
  }
  if (!plan.length) {
    console.log('nothing to do — all art already cached')
    return 0
  }

  mkdirSync(OUT_DIR, { recursive: true })
  let fetched = 0
  let failed = 0
  for (const [i, entry] of plan.entries()) {
    if (i > 0) await sleep(DELAY_MS) // between requests only — no dead second before the first one
    try {
      const size = await fetchOne(entry)
      fetched++
      console.log(`  [${i + 1}/${plan.length}] ${entry.code} ok (${Math.round(size / 1024)} KiB)`)
    } catch (e) {
      const err = e instanceof CdnError ? e : new CdnError(e instanceof Error ? e.message : String(e), false, null)
      if (err.rateLimited) {
        console.error(`  [${i + 1}/${plan.length}] ${entry.code} ${err.message}`)
        console.error(`ABORTED after ${fetched} fetched: this machine's IP is likely rate-limited by the CDN's WAF.`)
        console.error(err.waitMs === null ? 'Retry later — do not re-run immediately.' : `Retry-After says wait ${secs(err.waitMs)}.`)
        console.error('Cached files are skipped, so re-running later resumes from here rather than starting over.')
        return 1
      }
      failed++
      console.error(`  [${i + 1}/${plan.length}] ${entry.code} FAILED: ${err.message}`)
      // Honour a Retry-After on a non-WAF failure by waiting it out before the next card; a long window
      // is reported instead, because sleeping through it is what a fresh run tomorrow is for.
      if (err.waitMs !== null) {
        if (err.waitMs <= MAX_WAIT_MS) { console.error(`    retry-after ${secs(err.waitMs)} — waiting`); await sleep(err.waitMs) }
        else console.error(`    retry-after ${secs(err.waitMs)} — too long to wait; re-run later`)
      }
    }
  }

  console.log(`done: ${fetched} fetched, ${skipped} skipped, ${failed} failed`)
  return failed ? 1 : 0
}

/** Only run when invoked as a script — the tests import the planner from this module. */
function invokedDirectly(): boolean {
  const entry = process.argv[1]
  if (!entry) return false
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href
  } catch {
    return false
  }
}

if (invokedDirectly()) {
  main(process.argv.slice(2)).then(
    (code) => { process.exitCode = code },
    (e: unknown) => { console.error(e); process.exitCode = 1 },
  )
}
