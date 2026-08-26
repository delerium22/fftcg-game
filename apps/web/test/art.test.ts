import { describe, expect, it, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { artUrl, isArtMissing, markArtMissing, resetMissingArt } from '../src/game/art'
import { DECK_FILE, cdnUrl, planFetches, retryAfterMs } from '../scripts/fetch-images'

// Every assertion below is offline by construction: the planner is pure and nothing here calls `fetch`.
// The CDN's WAF rate-limits hard (spec B8) — a test that touched it could IP-block the machine.

const here = dirname(fileURLToPath(import.meta.url))
const OUT = join(here, '..', 'public', 'cards')
const deckText = (): string => readFileSync(DECK_FILE, 'utf8')

describe('artUrl', () => {
  it('maps real pool codes to the local cache path, never the CDN', () => {
    expect(artUrl('27-124S')).toBe('/cards/27-124S.jpg')
    expect(artUrl('12-120C')).toBe('/cards/12-120C.jpg')
    expect(artUrl('9-074C')).toBe('/cards/9-074C.jpg')
    expect(artUrl('20-103H')).toBe('/cards/20-103H.jpg')
    expect(artUrl('13-072R')).toBe('/cards/13-072R.jpg')
  })

  it('is same-origin for every distinct code in the real deck', () => {
    for (const e of planFetches(deckText(), OUT, new Set())) {
      expect(artUrl(e.code).startsWith('/cards/')).toBe(true)
      expect(artUrl(e.code)).not.toContain('http')
    }
  })
})

describe('missing-art cache', () => {
  beforeEach(() => { resetMissingArt() })

  it('starts empty and remembers what onError reported', () => {
    expect(isArtMissing('27-124S')).toBe(false)
    markArtMissing('27-124S')
    expect(isArtMissing('27-124S')).toBe(true)
    expect(isArtMissing('12-120C')).toBe(false)
  })
})

describe('planFetches (the --dry-run planner)', () => {
  const EXPECTED = [
    '27-124S', '27-125S', '27-126S', '27-127S', '19-052C', '22-068R',
    '24-063H', '16-092C', '12-120C', '18-124C', '9-074C', '18-064C',
    '20-074C', '1-121C', '18-069C', '20-105C', '13-072R', '20-103H',
  ]

  it('returns exactly the 18 distinct codes of the real deck file, in list order', () => {
    const plan = planFetches(deckText(), OUT, new Set())
    expect(plan.map((e) => e.code)).toEqual(EXPECTED)
    expect(plan).toHaveLength(18)
  })

  it('dedupes the 50 physical copies down to distinct codes', () => {
    const plan = planFetches('3 1-121C\n3 1-121C\n2 9-074C\n', OUT, new Set())
    expect(plan.map((e) => e.code)).toEqual(['1-121C', '9-074C'])
  })

  it('skips codes already cached, so a re-run costs nothing', () => {
    const plan = planFetches(deckText(), OUT, new Set(EXPECTED))
    expect(plan).toEqual([])
  })

  it('targets public/cards/<CODE>.jpg and the _eg CDN name', () => {
    const [first] = planFetches('1 27-124S\n', OUT, new Set())
    expect(first?.dest).toBe(join(OUT, '27-124S.jpg'))
    expect(first?.url).toBe('https://fftcg.cdn.sewest.net/images/cards/full/27-124S_eg.jpg')
    expect(cdnUrl('12-120C')).toBe('https://fftcg.cdn.sewest.net/images/cards/full/12-120C_eg.jpg')
  })
})

describe('retryAfterMs', () => {
  const now = Date.parse('2026-08-27T00:00:00Z')

  it('reads delta-seconds', () => {
    expect(retryAfterMs('30', now)).toBe(30_000)
    expect(retryAfterMs(' 0 ', now)).toBe(0)
  })

  it('reads an HTTP-date, clamped at zero for one already past', () => {
    expect(retryAfterMs('Thu, 27 Aug 2026 00:01:00 GMT', now)).toBe(60_000)
    expect(retryAfterMs('Thu, 27 Aug 2026 00:00:00 GMT', now)).toBe(0)
    expect(retryAfterMs('Wed, 26 Aug 2026 23:00:00 GMT', now)).toBe(0)
  })

  it('returns null for absent or unparseable headers', () => {
    for (const bad of [null, undefined, '', '   ', 'soon']) expect(retryAfterMs(bad, now)).toBeNull()
  })
})
