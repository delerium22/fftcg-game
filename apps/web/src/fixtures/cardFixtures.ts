import type { CardDef } from '@fftcg/engine'
import { CARD_DEFS, DECK_CHOICES } from '../deck.js'
import type { CardProps } from '../ui/Card.js'

/**
 * Every visual state of `<Card>`, from real pool cards (UI overhaul U0, spec section 10). The fixture page renders these
 * and its Playwright screenshot is the visual-regression surface for the card; U1 redesigns the card against it.
 *
 * Cards are picked by TYPE from the real pool, never by a hard-coded code, so a pool change cannot silently empty a
 * fixture — `def()` throws instead.
 */
export interface CardFixture { name: string; group: string; props: CardProps }

function def(pred: (d: CardDef) => boolean, what: string): CardDef {
  const d = CARD_DEFS.find(pred)
  if (!d) throw new Error(`fixture gallery: no card in the pool is ${what}`)
  return d
}

const inPool = new Set([...DECK_CHOICES.vol1.main, ...DECK_CHOICES.vol2.main])
const lbCodes = new Set([...DECK_CHOICES.vol1.lb, ...DECK_CHOICES.vol2.lb])

const forward = def((d) => inPool.has(d.code) && d.type === 'forward' && (d.power ?? 0) >= 7000, 'a forward of 7000+ power')
const backup = def((d) => inPool.has(d.code) && d.type === 'backup', 'a backup')
const summon = def((d) => inPool.has(d.code) && d.type === 'summon', 'a summon')
const lbCard = def((d) => lbCodes.has(d.code), 'an LB card')

function props(d: CardDef, extra: Partial<CardProps> = {}): CardProps {
  return {
    code: d.code, name: d.name, cost: d.cost, elements: [...d.elements], type: d.type,
    power: d.type === 'forward' ? d.power ?? 0 : null,
    text: d.text,
    size: 'field',
    ...extra,
  }
}

export const CARD_FIXTURES: readonly CardFixture[] = [
  { group: 'Types and sizes', name: 'forward, field', props: props(forward) },
  { group: 'Types and sizes', name: 'forward, hand', props: props(forward, { size: 'hand' }) },
  { group: 'Types and sizes', name: 'forward, small', props: props(forward, { size: 'small' }) },
  { group: 'Types and sizes', name: 'forward, large', props: props(forward, { size: 'large' }) },
  { group: 'Types and sizes', name: 'backup, field', props: props(backup) },
  { group: 'Types and sizes', name: 'summon, hand', props: props(summon, { size: 'hand' }) },
  { group: 'Types and sizes', name: 'two elements (synthetic)', props: props(forward, { elements: ['earth', 'lightning'] }) },
  { group: 'Types and sizes', name: 'face down', props: props(forward, { faceDown: true }) },
  { group: 'Board state', name: 'forward, dull', props: props(forward, { dull: true }) },
  { group: 'Board state', name: 'backup, dull', props: props(backup, { dull: true }) },
  { group: 'Board state', name: 'frozen', props: props(forward, { frozen: true }) },
  { group: 'Board state', name: 'damaged', props: props(forward, { damage: 3000 }) },
  { group: 'Board state', name: 'buffed', props: props(forward, { power: (forward.power ?? 0) + 2000, powerBonus: 2000, granted: ['haste', 'brave'] }) },
  { group: 'Board state', name: 'cannot be broken', props: props(forward, { flags: ['cannotBeBroken'] }) },
  { group: 'Interaction', name: 'selectable', props: props(forward, { actionable: true }) },
  { group: 'Interaction', name: 'selected', props: props(forward, { selected: true }) },
  { group: 'Interaction', name: 'chosen for a set', props: props(forward, { chosen: true }) },
  { group: 'Payment', name: 'paying by dulling', props: props(backup, { paying: 'dull' }) },
  { group: 'Payment', name: 'paying by discarding', props: props(forward, { size: 'hand', paying: 'discard' }) },
  { group: 'Payment', name: 'paying by an LB flip', props: props(lbCard, { lb: 'down', paying: 'flip', size: 'small' }) },
  { group: 'Limit Break', name: 'LB face down', props: props(lbCard, { lb: 'down', size: 'small' }) },
  { group: 'Limit Break', name: 'LB spent', props: props(lbCard, { lb: 'up', size: 'small' }) },
]
