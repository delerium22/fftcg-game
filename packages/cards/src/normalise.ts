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
  /** Rung J5: the printed Job and the one or two Categories. */
  job_en?: string | null
  category_1?: string | null
  category_2?: string | null
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
/** §15.2.8.2 (rung J8): "Limit Break -- X" is the LB cost, a field ability, not a clause. */
const LB_LINE = /^Limit Break -- (\d+)$/
/** The reminder some LB cards print above the cost (Maat 22-119R); a rule restatement, not a clause. */
const LB_REMINDER = /^\(Cards with \[LB\] cannot be included in your main deck\.\)$/
const isRuleLine = (l: string): boolean => KEYWORD_LINE.test(l) || LB_LINE.test(l) || LB_REMINDER.test(l)

export function parseLimitBreak(textEn: string): number | undefined {
  for (const line of textLines(textEn)) {
    const m = LB_LINE.exec(line)
    if (m?.[1]) return Number.parseInt(m[1], 10)
  }
  return undefined
}

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
  const limitBreak = parseLimitBreak(se.text_en)
  const nonKeywordLines = textLines(se.text_en).filter((l) => !isRuleLine(l))
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
    ...(limitBreak !== undefined ? { limitBreak } : {}),
    // Rung J5. Categories print as "VII" or, for a few cards, "XIV &middot; VII" — the separator is kept as
    // the SE data has it; a filter names one category and `matchesDefFilter` asks `includes`, so the list is
    // split on the middle dot too.
    ...(se.job_en ? { job: se.job_en.trim() } : {}),
    categories: [...new Set([se.category_1, se.category_2].flatMap((c) => (c ? c.split(/\s*(?:&middot;|·)\s*/) : [])).map((c) => c.trim()).filter((c) => c.length > 0))],
  }
}
