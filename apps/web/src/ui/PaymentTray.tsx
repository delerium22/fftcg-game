import type { JSX } from 'react'
import type { CardId, Element } from '@fftcg/engine'
import { paidText, type Crystal } from '../game/payment.js'

const ELEMENT_LABEL: Record<Element, string> = {
  fire: 'Fire', ice: 'Ice', wind: 'Wind', earth: 'Earth', lightning: 'Lightning', water: 'Water', light: 'Light', dark: 'Dark',
}

/**
 * The payment tray (rung I2): the cost as crystals, lit as the player picks sources on the board.
 *
 * It lives in the prompt strip's row — the centre of the table, between the backups it dulls and the hand it
 * discards from — and replaces the strip's buttons while a payment is being built. The crystal row is an
 * image with a spoken total; what is being paid for and the running total go through the strip's live
 * region (its prompt text), so a screen reader hears every change without a fourth live channel being added,
 * and the tray does not repeat the title beside it.
 */
export function PaymentTray({ crystals, complete, ask, flips, onAuto, onClear, onCancel, onConfirm, onDeclare }: {
  crystals: readonly Crystal[]
  complete: boolean
  /** Rung J8: the Limit Break cost — how many LB-deck cards must turn face up, and how many are picked. Null when none. */
  flips?: { need: number; chosen: number } | null | undefined
  /** A two-element discard waiting for its element to be declared (I2-D4), or null. */
  ask: { card: CardId; name: string; options: readonly Element[] } | null
  onAuto: () => void
  onClear: () => void
  onCancel: () => void
  onConfirm: () => void
  onDeclare: (card: CardId, element: Element) => void
}): JSX.Element {
  const paid = paidText(crystals)
  return (
    <div className="tray" data-payment-tray>
      {flips && flips.need > 0 && (
        <span className="tray__lb" role="img" aria-label={`Limit Break: ${flips.chosen} of ${flips.need} LB cards turned face up`} data-lb-flips={`${flips.chosen}/${flips.need}`}>
          {Array.from({ length: flips.need }, (_, i) => <i key={i} className={['lbflip', i < flips.chosen ? 'is-lit' : ''].filter(Boolean).join(' ')} title="Turn an LB-deck card face up" />)}
        </span>
      )}
      <span className="tray__crystals" role="img" aria-label={paid}>
        {crystals.map((c, i) => (
          <i
            key={i}
            className={['crystal', c.element ? `crystal--${c.element}` : 'crystal--any', c.lit ? 'is-lit' : ''].filter(Boolean).join(' ')}
            title={c.element ? ELEMENT_LABEL[c.element] : 'Any element'}
          />
        ))}
      </span>
      <span className="tray__paid">{paid}</span>
      {ask && (
        <span className="tray__ask" role="group" aria-label={`Discard ${ask.name} as which element?`}>
          <span className="tray__ask-label">Discard {ask.name} as</span>
          {ask.options.map((e) => (
            <button key={e} type="button" className="btn btn--ghost" data-command="declareElement" onClick={() => onDeclare(ask.card, e)}>
              {ELEMENT_LABEL[e]}
            </button>
          ))}
        </span>
      )}
      <span className="tray__buttons">
        <button type="button" className="btn btn--ghost" data-command="payAuto" onClick={onAuto}>Auto</button>
        <button type="button" className="btn btn--ghost" data-command="payClear" onClick={onClear}>Clear</button>
        <button type="button" className="btn btn--ghost" data-command="payCancel" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn btn--primary" data-command="payConfirm" disabled={!complete} onClick={onConfirm}>Confirm</button>
      </span>
    </div>
  )
}
