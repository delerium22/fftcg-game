import { useEffect, useRef, useState, type JSX, type KeyboardEvent } from 'react'
import type { CardId } from '@fftcg/engine'

export interface GridItem {
  readonly id: CardId
  /** True iff the card renders as a `<button>`; that button is then the focus target, not the cell. */
  readonly selectable: boolean
  /**
   * Renders the card with the tab position the grid has decided for it. A function rather than a ready-made
   * node because the roving state lives HERE — a selectable card's `<button>` is its own focus target, so
   * the grid has to reach into it, and threading that back out to the caller would put one piece of the
   * roving invariant in a different file from the rest.
   */
  readonly render: (tabIndex: number | undefined) => JSX.Element
}

/**
 * One row of cards as a keyboard-navigable **layout grid**: a single tab stop, arrow keys within.
 *
 * A layout grid, not a listbox — a listbox means *selecting* an option, which is false for the opponent's
 * cards, and false for your own hand at the mulligan where no card is playable. WAI defines layout grids for
 * exactly this: collapsing a group of widgets into one tab stop while preserving the descendants' own
 * semantics, so a castable card stays a `<button>` and keeps Enter and Space.
 *
 * Without this the mulligan is unreachable by keyboard at all. Mulligan is a subjectless command, so no hand
 * card enters `choices.byCard`, so none is `selectable`, so all five render as `role="img"` divs which are
 * not in the tab order — the opening decision of every game, made blind. That is the defect rung E3 was
 * written about and E3a explicitly did not close.
 *
 * The roving position is tracked by `CardId`, never by index: a hand renumbers itself the moment a card is
 * cast, and an index would silently follow whatever card slid into that slot.
 */
export function CardGrid({ label, items, className, onFocusItem }: {
  label: string
  items: readonly GridItem[]
  className?: string
  /**
   * The player is looking at this card, by keyboard.
   *
   * Wired at the CELL rather than inside `Card`, because the focus target differs by card: a selectable one
   * is focused on its own `<button>`, a non-selectable one on the cell itself. React's `onFocus` bubbles, so
   * the cell sees both. Without this the grid made the mulligan hand reachable but not readable — every card
   * could be moved to and none of them said anything, which is most of the original defect still standing.
   */
  onFocusItem?: ((id: CardId) => void) | undefined
}): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null)
  const [rovingId, setRovingId] = useState<CardId | null>(null)

  // The card that currently owns the tab stop. Falls back to the first card whenever the remembered one has
  // left — which is the common case, not an edge case: casting a card removes it from the hand.
  const activeId = items.some((i) => i.id === rovingId) ? rovingId : items[0]?.id ?? null

  /** The element that actually takes focus for a card: its button when it has one, else its cell. */
  const targetFor = (id: CardId): HTMLElement | null => {
    const cell = ref.current?.querySelector<HTMLElement>(`[data-card-id="${id}"]`) ?? null
    return cell?.querySelector<HTMLButtonElement>('button') ?? cell
  }

  /**
   * If the focused card leaves, put focus on whatever now occupies its place rather than letting the browser
   * drop it to `document.body` — from which a keyboard player is tabbing in from the top of the document
   * again. Guarded on the grid ALREADY owning focus, so a zone that was not being used never steals it: a
   * card leaving the AI's field must not yank focus off the button you were about to press.
   */
  const owned = useRef(false)
  useEffect(() => {
    if (!owned.current) return
    const active = document.activeElement
    if (active && active !== document.body && ref.current?.contains(active)) return
    if (activeId === null) { owned.current = false; return }
    targetFor(activeId)?.focus()
  }, [items, activeId])

  const move = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (!items.length) return
    const from = items.findIndex((i) => i.id === activeId)
    const last = items.length - 1
    let to: number
    switch (e.key) {
      case 'ArrowRight': to = Math.min(last, from + 1); break
      case 'ArrowLeft': to = Math.max(0, from - 1); break
      case 'Home': to = 0; break
      case 'End': to = last; break
      // Everything else falls through untouched — Enter and Space must reach the button, and Tab must leave.
      default: return
    }
    // Only after deciding this key is ours: a swallowed Tab would trap the player inside the row.
    e.preventDefault()
    const id = items[to]?.id
    if (id === undefined) return
    setRovingId(id)
    targetFor(id)?.focus()
  }

  return (
    <div
      ref={ref}
      role="grid"
      aria-label={label}
      className={className}
      onKeyDown={move}
      onFocus={() => { owned.current = true }}
      onBlur={(e) => { if (!ref.current?.contains(e.relatedTarget)) owned.current = false }}
    >
      <div role="row" className="grid__row">
        {items.map((item) => (
          <div
            key={item.id}
            role="gridcell"
            data-card-id={item.id}
            // The cell takes the tab stop only when the card has no button of its own to take it. A
            // selectable card keeps its button as the focus target so Enter and Space still play it.
            tabIndex={item.selectable ? undefined : item.id === activeId ? 0 : -1}
            onFocus={() => onFocusItem?.(item.id)}
          >
            {item.render(item.selectable ? (item.id === activeId ? 0 : -1) : undefined)}
          </div>
        ))}
      </div>
    </div>
  )
}
