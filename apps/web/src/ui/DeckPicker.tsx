import { useId, type JSX } from 'react'
import { DECK_CHOICES, DECK_KEYS, isDeckKey, pairLabel, type DeckPair } from '../deck.js'

/**
 * Rung V1-C (spec V1-D17, plan R1): the toolbar that picks a deck per seat and starts a new game with them.
 *
 * It holds a SELECTION, not the game's pair (R2). Changing a select changes only what the button will start — the
 * button says so in its own name, "New game (Vol. 2 vs Vol. 1)" — and the game in progress, and the worker
 * searching it, are untouched until the button (or "Play again") is pressed (C-D1).
 *
 * Its own component and its own CSS block (`.picker`), so a later layout can move it without unpicking the board.
 */
export function DeckPicker({ selected, onSelect, onNewGame }: {
  selected: DeckPair
  onSelect: (pair: DeckPair) => void
  onNewGame: () => void
}): JSX.Element {
  const yours = useId()
  const theirs = useId()
  const pick = (seat: 0 | 1, value: string): void => {
    if (!isDeckKey(value)) return
    onSelect(seat === 0 ? [value, selected[1]] : [selected[0], value])
  }
  const options = DECK_KEYS.map((k) => <option key={k} value={k}>{DECK_CHOICES[k].label}</option>)
  return (
    <div className="table__toolbar picker" role="group" aria-label="Decks">
      {/* Visible labels, tied by `htmlFor`: the two selects are otherwise identical, and which one is YOURS is
          exactly what a player has to know before pressing the button. */}
      <label className="picker__label" htmlFor={yours}>Your deck</label>
      <select id={yours} className="picker__select" value={selected[0]} onChange={(e) => { pick(0, e.target.value) }}>{options}</select>
      <label className="picker__label" htmlFor={theirs}>AI deck</label>
      <select id={theirs} className="picker__select" value={selected[1]} onChange={(e) => { pick(1, e.target.value) }}>{options}</select>
      <button type="button" className="btn" onClick={onNewGame}>
        New game ({pairLabel(selected)})
      </button>
    </div>
  )
}
