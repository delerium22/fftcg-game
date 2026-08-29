import { useId, useState, type CSSProperties, type JSX } from 'react'
import type { CardType, Element, FieldFlag, Keyword } from '@fftcg/engine'
import { artUrl, isArtMissing, markArtMissing } from '../game/art.js'
import './Card.css'

const KEYWORD_LABEL: Record<Keyword, string> = { haste: 'Haste', brave: 'Brave', firstStrike: 'First Strike', backAttack: 'Back Attack' }
const FLAG_LABEL: Record<FieldFlag, string> = { cannotBeBroken: 'Unbreakable', cannotBeReturnedByOpponent: 'Unreturnable' }

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
  /**
   * "The player is looking at this card" — hover, or keyboard focus. Drives the details panel.
   *
   * Deliberately NOT the click. A hand card during a cast choice is already a button whose click plays it,
   * and overloading that is how a player casts a card they meant to read. There is no matching "stopped
   * looking" signal on purpose: the panel keeps the last card, so reading one and then moving to the button
   * that acts on it does not blank what you just read.
   *
   * Only fires on FOCUS for a selectable card, since a non-selectable one renders as an unfocusable
   * `role="img"` div. That is rung E3a's known gap and rung E3b (roving tabindex) is what closes it —
   * a keyboard-only player currently cannot inspect the mulligan hand, where no card is selectable.
   */
  /**
   * The card's printed text, exposed as an accessible DESCRIPTION rather than folded into its name.
   *
   * The details panel shows this to a sighted player, but it is not a live region and it is not
   * programmatically related to the focused card — so a screen reader is never told the text exists. Rung
   * E3b's plan review found that: a rung making every card focusable would have gone green while the person
   * it was written for still could not read a single card.
   *
   * A description, not a longer `aria-label`, because the name should stay concise enough to be useful when
   * skimming a row of six cards; WAI's guidance puts verbose information here for exactly this reason. It
   * lives in the DOM BEFORE focus, so the announcement cannot race React replacing the panel's content.
   */
  text?: string | undefined
  onInspect?: (() => void) | undefined
  /**
   * What clicking this card will DO, right now — "Cast Ramuh paying: discard Odin as lightning".
   *
   * Appended to the accessible name rather than replacing it, so a screen-reader user still hears the card's
   * name, cost, element, type and power first. They were the ones worst served before: a sighted player at
   * least saw the log update afterwards.
   *
   * Only ever set when the card offers exactly ONE thing, because that is the click that commits
   * immediately. A card with several options opens the prompt strip instead, which lists all of them.
   */
  action?: string | undefined
}

/** Every card on the board — the opponent's hand, the decks, both fields — renders through here. */
export function Card(props: CardProps): JSX.Element {
  const { code, name, cost, elements, type, power, powerBonus = 0, granted = [], flags = [], damage = 0, dull = false, selectable = false, selected = false, faceDown = false, size = 'field', onClick, onInspect, action, text } = props

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
  // A power modifier is spoken as part of the power phrase ("power 9000 of 11000, including 3000 that
  // expires…"), so on a card with no power there is nothing for it to be "included" in — the sentence would
  // read "backup, including 3000 that expires at the end of the turn" (Codex MINOR). Nothing in the pool pumps
  // a Backup, but the component's contract allows it — and a +3000 badge on a card with no power is no more
  // meaningful than the sentence, so both stand down together.
  const modifier = powerBonus === 0 || power === null ? []
    : [{
        badge: powerBonus > 0 ? `+${powerBonus}` : `${powerBonus}`,
        said: powerBonus > 0
          ? `including ${powerBonus} that expires at the end of the turn`
          : `reduced by ${Math.abs(powerBonus)} until the end of the turn`,
      }]
  const buffs = [
    ...modifier,
    ...granted.map((k) => ({ badge: KEYWORD_LABEL[k], said: `${KEYWORD_LABEL[k]} granted` })),
    ...flags.map((f) => ({ badge: FLAG_LABEL[f], said: FLAG_LABEL[f].toLowerCase() })),
  ]

  const className = ['card', `card--${size}`, dull ? 'is-dull' : '', selectable ? 'is-selectable' : '', selected ? 'is-selected' : ''].filter(Boolean).join(' ')
  const label = faceDown
    ? 'Face-down card'
    : [`${name}, cost ${cost}`, elements.join(' and '), type, remaining === null ? '' : `power ${remaining} of ${power}`, dull ? 'dull' : '', ...buffs.map((b) => b.said), action ?? ''].filter(Boolean).join(', ')

  // A stable id per rendered card, so `aria-describedby` points at this card's own text and not another's.
  const descId = useId()
  const described = !faceDown && text !== undefined && text !== ''
  const description = described ? <span id={descId} className="sr-only">{text}</span> : null

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
                {/* The printed maximum is shown only once it MATTERS. An undamaged card is at its printed
                    power by definition, so "2000/2000" spends the widest thing on the plate saying the same
                    number twice — and measured in the browser it overflowed the plate on every field card by
                    10px and on every hand card by 29px, clipping the one number combat turns on. */}
                {damage > 0 && <em>/{power}</em>}
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
      <button
        type="button" className={className} style={vars as CSSProperties} title={label} aria-label={label}
        {...(described ? { 'aria-describedby': descId } : {})}
        aria-pressed={selected} onClick={onClick} onMouseEnter={onInspect} onFocus={onInspect}
      >
        <span className="card__face">{face}</span>
        {description}
      </button>
    )
  }
  return (
    <div
      className={className} style={vars as CSSProperties} title={label} role="img" aria-label={label}
      {...(described ? { 'aria-describedby': descId } : {})}
      onMouseEnter={onInspect}
    >
      <span className="card__face">{face}</span>
      {description}
    </div>
  )
}
