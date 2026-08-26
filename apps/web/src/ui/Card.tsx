import { useState, type CSSProperties, type JSX } from 'react'
import type { CardType, Element, FieldFlag, Keyword } from '@fftcg/engine'
import { artUrl, isArtMissing, markArtMissing } from '../game/art.js'
import './Card.css'

const KEYWORD_LABEL: Record<Keyword, string> = { haste: 'Haste', brave: 'Brave', firstStrike: 'First Strike', backAttack: 'Back Attack' }
const FLAG_LABEL: Record<FieldFlag, string> = { cannotBeBroken: 'Unbreakable' }

/*
 * Until-end-of-turn modifiers ride as badges over the art. They are styled inline rather than in Card.css
 * because this rung owns Card.tsx and not the stylesheet; the values are the same design tokens the sheet uses.
 */
const BUFF_ROW: CSSProperties = {
  position: 'absolute', left: '3px', bottom: '6px', zIndex: 1,
  display: 'flex', flexWrap: 'wrap', gap: '2px', maxWidth: 'calc(100% - 6px)',
}
const BUFF: CSSProperties = {
  padding: '0 3px', borderRadius: '3px', background: 'var(--gold)', color: '#0b1216',
  fontFamily: 'var(--font-condensed)', fontSize: '8px', fontWeight: 700, letterSpacing: '0.06em',
  textTransform: 'uppercase', lineHeight: '12px', whiteSpace: 'nowrap',
}

export interface CardProps {
  code: string
  name: string
  cost: number
  elements: Element[]
  type: CardType
  /**
   * The power the GAME uses, not the printed number: `fieldCardDisplay` feeds this `effectivePower(def, card)`
   * for a card on the field (spec C1-7) and printed power for one in hand. Remaining power, the damage bar and
   * the accessibility label are all derived from it, so a pumped Forward reads correctly everywhere.
   * Null for backups and summons.
   */
  power: number | null
  /** Until-end-of-turn power modifier already folded into `power` — shown as a badge so the pump is visible. */
  powerBonus?: number | undefined
  /** Keywords granted by an ability, on top of the printed ones. */
  granted?: readonly Keyword[] | undefined
  /** Protection an ability granted, e.g. `cannotBeBroken` (spec C1-7). */
  flags?: readonly FieldFlag[] | undefined
  /** Damage already on a forward, in power units. */
  damage?: number | undefined
  /** Dull = the card is turned sideways (CR 1.4.2). */
  dull?: boolean | undefined
  /** True iff this card is a key of `ChoiceSet.byCard` — spec B-A4 makes it the only clickable set. */
  selectable?: boolean | undefined
  selected?: boolean | undefined
  faceDown?: boolean | undefined
  size?: 'hand' | 'field' | 'small' | undefined
  onClick?: (() => void) | undefined
}

/** Every card on the board — the opponent's hand, the decks, both fields — renders through here. */
export function Card(props: CardProps): JSX.Element {
  const { code, name, cost, elements, type, power, powerBonus = 0, granted = [], flags = [], damage = 0, dull = false, selectable = false, selected = false, faceDown = false, size = 'field', onClick } = props

  // Local state is keyed on `code` rather than reset by an effect, so reusing one component instance
  // for a different card re-attempts that card's art instead of inheriting the previous failure. The
  // module-level miss cache covers the other direction: a code that already 404'd this session skips
  // the `<img>` on every later mount, so no copy of it ever flashes a broken image again.
  const [art, setArt] = useState<{ code: string; status: 'ok' | 'failed' }>({ code: '', status: 'failed' })
  const status = isArtMissing(code) ? 'failed' : art.code === code ? art.status : 'loading'

  const remaining = power === null ? null : power - damage
  const vars: Record<string, string> = {}
  const primary = elements[0]
  if (primary) {
    vars['--el-a'] = `var(--el-${primary})`
    vars['--el-b'] = `var(--el-${elements[1] ?? primary})`
  }
  if (power !== null && damage > 0) vars['--dmg'] = `${Math.min(100, (damage / power) * 100)}%`

  // Why this Forward survived, or hit harder than its printed power. Badges, not prose: the whole card is 96px.
  const buffs = [
    ...(powerBonus === 0 ? [] : [{ badge: powerBonus > 0 ? `+${powerBonus}` : `${powerBonus}`, said: `${powerBonus > 0 ? 'plus' : 'minus'} ${Math.abs(powerBonus)} power this turn` }]),
    ...granted.map((k) => ({ badge: KEYWORD_LABEL[k], said: `${KEYWORD_LABEL[k]} granted` })),
    ...flags.map((f) => ({ badge: FLAG_LABEL[f], said: FLAG_LABEL[f].toLowerCase() })),
  ]

  const className = ['card', `card--${size}`, dull ? 'is-dull' : '', selectable ? 'is-selectable' : '', selected ? 'is-selected' : ''].filter(Boolean).join(' ')
  const label = faceDown
    ? 'Face-down card'
    : [`${name}, cost ${cost}`, elements.join(' and '), type, remaining === null ? '' : `power ${remaining} of ${power}`, dull ? 'dull' : '', ...buffs.map((b) => b.said)].filter(Boolean).join(', ')

  const face = faceDown ? (
    <span className="card__back" />
  ) : (
    <span className="card__frame">
      <span className="card__body">
        <span className="card__art">
          <span className="card__crystal" />
          <span className="card__code">{code}</span>
          {status !== 'failed' && (
            // Art lies over the finished text card and fades in, so a missing file (B9) or a slow
            // one is never a hole — `alt` is empty because the plate below already names the card.
            <img
              className={status === 'ok' ? 'card__img is-loaded' : 'card__img'}
              src={artUrl(code)}
              alt=""
              draggable={false}
              onLoad={() => setArt({ code, status: 'ok' })}
              onError={() => {
                markArtMissing(code)
                setArt({ code, status: 'failed' })
              }}
            />
          )}
          {buffs.length > 0 && (
            <span className="card__buffs" style={BUFF_ROW}>
              {buffs.map((b) => (
                <span key={b.badge} style={BUFF}>{b.badge}</span>
              ))}
            </span>
          )}
          {remaining !== null && damage > 0 && <span className="card__damage" />}
        </span>
        <span className="card__plate">
          <span className="card__name">{name}</span>
          <span className="card__meta">
            <span className="card__type">{type}</span>
            {remaining !== null && (
              <span className={damage > 0 ? 'card__power card__power--hurt' : 'card__power'}>
                {remaining}
                <em>/{power}</em>
              </span>
            )}
          </span>
        </span>
      </span>
      <span className="card__gem">
        <span>{cost}</span>
      </span>
      <span className="card__pips">
        {elements.map((e) => (
          <i key={e} className={`pip pip--${e}`} />
        ))}
      </span>
    </span>
  )

  // A selectable card is a real button: keyboard activation, pressed state and disabled semantics
  // all come from the element rather than from hand-rolled key handling.
  if (selectable) {
    return (
      <button type="button" className={className} style={vars as CSSProperties} aria-label={label} aria-pressed={selected} onClick={onClick}>
        <span className="card__face">{face}</span>
      </button>
    )
  }
  return (
    <div className={className} style={vars as CSSProperties} role="img" aria-label={label}>
      <span className="card__face">{face}</span>
    </div>
  )
}
