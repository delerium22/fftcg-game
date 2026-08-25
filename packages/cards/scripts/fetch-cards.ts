import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CardDef } from '@fftcg/engine'
import { normaliseSeCard, type SeCard } from '../src/normalise.js'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..', '..')
const dataDir = join(here, '..', 'data')
const ENDPOINT = 'https://fftcg.square-enix-games.com/en/get-cards'
const BODY = { language: 'en', text: '', type: [], element: [], cost: [], rarity: [], power: [], category_1: [], set: [], multicard: '', ex_burst: '', code: '', special: '', exactmatch: 0 }

function deckCodes(): Set<string> {
  const codes = new Set<string>()
  for (const f of readdirSync(join(root, 'decks'))) {
    if (!f.endsWith('.txt')) continue
    for (const raw of readFileSync(join(root, 'decks', f), 'utf8').split('\n')) {
      const line = raw.trim()
      if (!line || line.startsWith('#')) continue
      const [, code] = line.split(/\s+/)
      if (code) codes.add(code)
    }
  }
  return codes
}

const ELEMENTS = new Set(['fire', 'ice', 'wind', 'earth', 'lightning', 'water', 'light', 'dark'])
const TYPES = new Set(['forward', 'backup', 'summon', 'monster'])
/** Reject malformed defs early — the engine trusts this file completely. */
function assertCardDef(c: unknown, where: string): CardDef {
  const d = c as CardDef
  const bad = (msg: string) => { throw new Error(`${where}: ${msg}`) }
  if (typeof d?.code !== 'string' || !/^[0-9A-Za-z]+-[0-9]{3}[A-Z]$/.test(d.code)) bad(`bad code ${JSON.stringify(d?.code)}`)
  if (typeof d.name !== 'string' || !d.name) bad(`${d.code}: bad name`)
  if (!TYPES.has(d.type)) bad(`${d.code}: bad type ${d.type}`)
  if (!Array.isArray(d.elements) || !d.elements.length || !d.elements.every((e) => ELEMENTS.has(e))) bad(`${d.code}: bad elements`)
  if (!Number.isInteger(d.cost) || d.cost < 0 || d.cost > 15) bad(`${d.code}: bad cost ${d.cost}`)
  if (d.type === 'forward' ? !(Number.isInteger(d.power) && (d.power as number) >= 0) : d.power !== null) bad(`${d.code}: bad power ${d.power}`)
  for (const k of ['generic', 'exBurst', 'hasAbilities'] as const) if (typeof d[k] !== 'boolean') bad(`${d.code}: ${k} must be boolean`)
  if (!Array.isArray(d.keywords) || typeof d.text !== 'string') bad(`${d.code}: bad keywords/text`)
  return d
}

function patches(): CardDef[] {
  const dir = join(dataDir, 'patches')
  return readdirSync(dir).flatMap((f) => (JSON.parse(readFileSync(join(dir, f), 'utf8')) as unknown[]).map((c, i) => assertCardDef(c, `${f}[${i}]`)))
}

async function main() {
  const wanted = deckCodes()
  const res = await fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(BODY) })
  if (!res.ok) throw new Error(`SE endpoint ${res.status}`)
  const { cards } = (await res.json()) as { cards: SeCard[] }
  const byCode = new Map<string, CardDef>()
  for (const p of patches()) { if (byCode.has(p.code)) throw new Error(`duplicate patch for ${p.code}`); byCode.set(p.code, p) }
  for (const se of cards) if (wanted.has(se.code) && !byCode.has(se.code)) byCode.set(se.code, assertCardDef(normaliseSeCard(se), se.code))
  const missing = [...wanted].filter((c) => !byCode.has(c))
  if (missing.length) throw new Error(`cards not found in SE data or patches: ${missing.join(', ')}`)
  const out = [...byCode.values()].filter((c) => wanted.has(c.code)).sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }))
  writeFileSync(join(dataDir, 'cards.json'), JSON.stringify(out, null, 2) + '\n')
  writeFileSync(join(dataDir, 'cards.meta.json'), JSON.stringify({ fetchedAt: new Date().toISOString(), endpoint: ENDPOINT, count: out.length, patched: patches().map((p) => p.code) }, null, 2) + '\n')

  const count = (f: (c: CardDef) => boolean) => out.filter(f).length
  console.log(`wrote ${out.length} cards`)
  console.log(`forwards=${count((c) => c.type === 'forward')} backups=${count((c) => c.type === 'backup')} summons=${count((c) => c.type === 'summon')} monsters=${count((c) => c.type === 'monster')}`)
  console.log(`multi-element=${count((c) => c.elements.length > 1)} exBurst=${count((c) => c.exBurst)} generic=${count((c) => c.generic)} withAbilities=${count((c) => c.hasAbilities)}`)
  console.log(`innate keywords: ${JSON.stringify(Object.fromEntries(out.filter((c) => c.keywords.length).map((c) => [c.code, c.keywords])))}`)
  console.log(`light/dark=${count((c) => c.elements.some((e) => e === 'light' || e === 'dark'))}`)
}
main().catch((e) => { console.error(e); process.exit(1) })
