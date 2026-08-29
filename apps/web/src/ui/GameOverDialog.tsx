import { useEffect, useId, useRef, type JSX } from 'react'
import type { GameResult, PlayerId } from '@fftcg/engine'
import { describeResult } from '../game/commands.js'
import { HUMAN } from '../game/types.js'

/**
 * The end of the game, as a real modal dialog.
 *
 * It used to be a `<div role="alertdialog">` — a curtain, not a dialog. Measured in a browser at the moment
 * it appeared: focus stayed on `document.body`, there was no `aria-modal`, and of seven tab stops on the
 * page only one was inside it, with "Play again" LAST. A player who had just lost had to tab past six board
 * controls to reach the only action the game still offered, and a screen-reader user was told nothing had
 * happened at all.
 *
 * A native `<dialog>` opened with `showModal()`, rather than a hand-managed `inert` sibling. I had chosen the
 * latter because this jsdom implements neither `showModal` nor `inert`, and the plan review ruled that
 * backwards: the real-browser test belongs to this rung anyway, so the native path is testable where it
 * actually exists — and `showModal` supplies the whole contract being claimed (top layer; every node outside
 * the dialog inert for focus, pointer, commands and accessibility exposure), including for controls this rung
 * never enumerated. Letting the test environment pick the production mechanism is the tail wagging the dog.
 */
export function GameOverDialog({ result, me, onRestart }: {
  result: GameResult
  me: PlayerId
  onRestart: () => void
}): JSX.Element {
  const ref = useRef<HTMLDialogElement | null>(null)
  const titleId = useId()
  const reasonId = useId()

  const title = result.winner === null ? 'Draw' : result.winner === HUMAN ? 'You win' : 'The AI wins'
  const reason = describeResult(me, result)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    // `showModal` is absent in this jsdom, so guard rather than throw. The tests spy on it to prove the
    // lifecycle CALLS it; they do not pretend to emulate modality, which is Playwright's job.
    if (typeof el.showModal === 'function' && !el.open) el.showModal()
    // Focus the HEADING, not the dialog and not the button. Focusing the container announces only the
    // dialog's own name — "Game over" — and stops, which is how the first version of this rung would have
    // shipped a player who learned the game had ended but not who won. The heading carries the outcome, and
    // `aria-describedby` carries the reason after it.
    ref.current?.querySelector<HTMLHeadingElement>('[data-dialog-title]')?.focus()
  }, [])

  return (
    <dialog
      ref={ref}
      className="banner"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={reasonId}
      // Escape does nothing: the game is over and there is nothing to dismiss TO. A dialog that closes onto
      // a dead board is worse than one that will not close, and "Play again" is the only way on.
      onCancel={(e) => { e.preventDefault() }}
    >
      <h2 id={titleId} className="banner__title" data-dialog-title tabIndex={-1}>{title}</h2>
      <p id={reasonId} className="banner__reason">{reason}</p>
      <button className="btn btn--primary" onClick={onRestart}>Play again</button>
    </dialog>
  )
}
