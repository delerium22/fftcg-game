import { useEffect, useId, useRef, type JSX, type ReactNode } from 'react'
import { useReturnFocus } from './useReturnFocus.js'

/**
 * A public pile, opened (UI overhaul spec section 6): the Break Zone, the Damage Zone, Removed from game, or the AI's
 * LB deck, shown over the board instead of as a row inside it — a Break Zone grows all game and a row of it pushed the
 * Forwards off the screen. The same native modal `<dialog>` contract as the card sheet: `showModal()` so the board
 * behind is inert, focus on the heading, Escape closes, focus returns to the opener.
 */
export function ZoneSheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }): JSX.Element {
  useReturnFocus()
  const ref = useRef<HTMLDialogElement | null>(null)
  const titleId = useId()
  useEffect(() => {
    const el = ref.current
    if (!el) return
    // Absent in this jsdom — guard rather than throw; modality is proved in a real browser.
    if (typeof el.showModal === 'function' && !el.open) el.showModal()
    el.querySelector<HTMLHeadingElement>('[data-dialog-title]')?.focus()
  }, [])
  return (
    <dialog
      ref={ref} className="sheet zone-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} data-zone-sheet
      onCancel={(e) => { e.preventDefault(); onClose() }}
    >
      <div className="zone-sheet__body">
        <h2 id={titleId} className="sheet__name" data-dialog-title tabIndex={-1}>{title}</h2>
        {children}
        <div className="sheet__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </dialog>
  )
}
