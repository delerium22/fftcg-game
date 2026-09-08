import type { JSX } from 'react'
import type { CardId } from '@fftcg/engine'

/**
 * The set picker's tray (rung J7-D3): the cards chosen so far as chips, with Clear / Cancel / Confirm. It
 * takes the prompt strip's row exactly as the payment tray does, and for the same reason: the decision is
 * made on the board (press a card to pick it, press it again to put it back) and the tray is where it is
 * confirmed. What is being built and how far along it is goes through the strip's live region.
 */
export function SelectionTray({ chosen, name, refusal, onClear, onCancel, onConfirm, onRemove }: {
  chosen: readonly CardId[]
  name: (id: CardId) => string
  /** Why Confirm is disabled — the engine's own words — or null when the set is a legal answer. */
  refusal: string | null
  onClear: () => void
  onCancel: () => void
  onConfirm: () => void
  onRemove: (id: CardId) => void
}): JSX.Element {
  return (
    <div className="tray" data-selection-tray>
      <span className="tray__chips" role="group" aria-label="Chosen cards">
        {chosen.length === 0 && <span className="tray__paid">Nothing chosen yet</span>}
        {chosen.map((id) => (
          <button key={id} type="button" className="chip" data-command="selectRemove" onClick={() => onRemove(id)} aria-label={`Put back ${name(id)}`}>
            {name(id)} ×
          </button>
        ))}
      </span>
      {refusal !== null && chosen.length > 0 && <span className="tray__paid">{refusal}</span>}
      <span className="tray__buttons">
        <button type="button" className="btn btn--ghost" data-command="selectClear" onClick={onClear}>Clear</button>
        <button type="button" className="btn btn--ghost" data-command="selectCancel" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn btn--primary" data-command="selectConfirm" disabled={refusal !== null} onClick={onConfirm}>Confirm</button>
      </span>
    </div>
  )
}
