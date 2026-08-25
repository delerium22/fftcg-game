import type { CardDef, CardType, Element, Keyword } from '@fftcg/engine'

export interface SeCard {
  code: string
  name_en: string
  type_en: string
  element: string[] | null
  cost: string
  power: string
  multicard: string
  ex_burst: string
  text_en: string
}

const ELEMENT_BY_KANJI: Record<string, Element> = {
  '火': 'fire', '氷': 'ice', '風': 'wind', '土': 'earth', '雷': 'lightning', '水': 'water', '光': 'light', '闇': 'dark',
}
const ELEMENT_LABEL: Record<string, string> = {
  '火': 'Fire', '氷': 'Ice', '風': 'Wind', '土': 'Earth', '雷': 'Lightning', '水': 'Water', '光': 'Light', '闇': 'Dark',
}
const TYPE_BY_NAME: Record<string, CardType> = { Forward: 'forward', Backup: 'backup', Summon: 'summon', Monster: 'monster' }
const KEYWORD_BY_LABEL: Record<string, Keyword> = { Haste: 'haste', Brave: 'brave', 'First Strike': 'firstStrike', 'Back Attack': 'backAttack' }
const KEYWORD_LINE = /^(Haste|Brave|First Strike|Back Attack)(\s*\(.*\))?$/

function stripInline(line: string): string {
  return line
    .replace(/\[\[[^\]]*\]\]/g, '')
    .replace(/《ダル》/g, '[Dull]')
    .replace(/《([火氷風土雷水光闇])》/g, (_, k: string) => `[${ELEMENT_LABEL[k]}]`)
    .replace(/《([^》]*)》/g, '[$1]')
    .replace(/\s+/g, ' ')
    .trim()
}

export function textLines(textEn: string): string[] {
  return textEn.split('[[br]]').map(stripInline).filter((l) => l.length > 0)
}

export function cleanText(textEn: string): string {
  return textLines(textEn).join('\n')
}

export function parseKeywords(textEn: string): Keyword[] {
  const out: Keyword[] = []
  for (const line of textLines(textEn)) {
    const m = KEYWORD_LINE.exec(line)
    if (m?.[1]) out.push(KEYWORD_BY_LABEL[m[1]] as Keyword)
  }
  return out
}

export function normaliseSeCard(se: SeCard): CardDef {
  if (!se.element || se.element.length === 0) throw new Error(`${se.code}: missing element`)
  const elements = se.element.map((k) => {
    const e = ELEMENT_BY_KANJI[k]
    if (!e) throw new Error(`${se.code}: unknown element ${k}`)
    return e
  })
  const type = TYPE_BY_NAME[se.type_en]
  if (!type) throw new Error(`${se.code}: unknown type ${se.type_en}`)
  const rawPower = Number.parseInt(se.power, 10)
  const power = type === 'forward' && Number.isFinite(rawPower) ? rawPower : null
  const keywords = parseKeywords(se.text_en)
  const nonKeywordLines = textLines(se.text_en).filter((l) => !KEYWORD_LINE.test(l))
  return {
    code: se.code,
    name: se.name_en,
    type,
    elements,
    cost: Number.parseInt(se.cost, 10),
    power,
    keywords,
    generic: se.multicard === '1',
    exBurst: se.ex_burst === '1',
    text: cleanText(se.text_en),
    hasAbilities: nonKeywordLines.length > 0,
  }
}
