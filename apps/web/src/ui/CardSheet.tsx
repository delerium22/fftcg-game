import { useEffect, useId, useRef, type JSX } from 'react'
import { unimplementedClauseCount, type CardDef } from '@fftcg/engine'
import type { Choice } from '../game/types.js'
import { Card, type CardProps } from './Card.js'

/** One thing the sheet's card can do: press to commit it, or press to open the payment tray for it. */
export interface SheetAction {
  choice: Choice
  /** The button text — the full label when the press commits, the payment-free headline when it opens the tray. */
  label: string
  kind: 'commit' | 'pay'
}

/**
 * The card sheet (rung I1): a card at reading size, its full printed text, and everything it can do right now.
 *
 * The third native modal `<dialog>` in the app, on the same contract as game over and How to play:
 * `showModal()` so the board behind is inert, focus on the heading so a screen reader hears the card first,
 * Escape closes because there is a board to return to. It replaces the two things a board click used to do —
 * commit at once, or select so the strip grew buttons — with one: open this. Nothing commits from the board
 * any more; the buttons here are where a decision is made, after the card has been read.
 *
 * A hand card that cannot be cast shows Cast anyway, disabled, with the reason under it and in its
 * description (I1-D4): a greyed button that will not say why is the thing the How-to-play sheet promised
 * this table would not have.
 */
export function CardSheet({ face, def, actions, castBlocked, onCommit, onPay, onClose }: {
  face: CardProps
  def: CardDef | undefined
  actions: readonly SheetAction[]
  /** Why a Cast is refused, or null when there is no refused cast to show. */
  castBlocked: string | null
  onCommit: (c: Choice) => void
  onPay: (c: Choice) => void
  onClose: () => void
}): JSX.Element {
  const ref = useRef<HTMLDialogElement | null>(null)
  const titleId = useId()
  const textId = useId()
  const blockedId = useId()

  useEffect(() => {
    const el = ref.current
    if (!el) return
    // Absent in this jsdom — guard rather than throw; modality is proved in a real browser.
    if (typeof el.showModal === 'function' && !el.open) el.showModal()
    el.querySelector<HTMLHeadingElement>('[data-dialog-title]')?.focus()
  }, [])

  const missing = def ? unimplementedClauseCount(def) : 0

  return (
    <dialog
      ref={ref}
      className="sheet"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={textId}
      data-card-sheet
      onCancel={(e) => { e.preventDefault(); onClose() }}
    >
      <div className="sheet__body">
        <div className="sheet__card">
          {/* Presentational: the sheet's heading and text already announce this card, and a second button
              named after it would offer a press that goes nowhere. */}
          <Card {...face} size="large" actionable={false} presentational onClick={undefined} onInspect={undefined} />
        </div>
        <div className="sheet__text">
          <h2 id={titleId} className="sheet__name" data-dialog-title tabIndex={-1}>{face.name}</h2>
          {def && (
            <p className="sheet__meta">
              <span>{def.code}</span>
              <span>{def.type}</span>
              <span>{def.elements.join(' / ')}</span>
              <span>{def.cost} CP</span>
              {def.power !== null && <span>{def.power}</span>}
            </p>
          )}
          <p id={textId} className="sheet__printed">{def?.text || 'No printed text.'}</p>
          {missing > 0 && (
            <p className="sheet__caveat">
              {missing === 1
                ? 'One printed ability is not implemented in this build and will do nothing.'
                : `${missing} printed abilities are not implemented in this build and will do nothing.`}
            </p>
          )}
          <div className="sheet__actions">
            {actions.map((a, i) => (
              <button
                key={`${a.choice.command.type}:${a.label}:${i}`}
                type="button"
                className="btn btn--primary sheet__action"
                data-command={a.choice.command.type}
                data-sheet-action={a.kind}
                onClick={() => (a.kind === 'pay' ? onPay(a.choice) : onCommit(a.choice))}
              >
                {a.label}
              </button>
            ))}
            {castBlocked !== null && (
              <span className="sheet__blocked">
                <button type="button" className="btn btn--primary sheet__action" disabled aria-describedby={blockedId} data-command="castBlocked">
                  Cast {face.name}
                </button>
                <span id={blockedId} className="sheet__why">{castBlocked}</span>
              </span>
            )}
            <button type="button" className="btn btn--ghost" data-command="sheetBack" onClick={onClose}>Back</button>
          </div>
        </div>
      </div>
    </dialog>
  )
}
