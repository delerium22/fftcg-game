import { useEffect, useState } from 'react'

/**
 * Put focus back where it was when a modal opened, once it closes (U2b plan review). A sheet is removed from the DOM on
 * close, which drops focus to `document.body`; with a card sheet opened from a pile sheet, that stranded a keyboard
 * player inside an open dialog with nothing focused. Only if the element is still in the document.
 *
 * Captured at FIRST RENDER, not in the effect: StrictMode runs a mount effect twice, and by the second run the sheet
 * has already focused its own heading — an effect-time capture recorded the heading and returned focus nowhere.
 */
export function useReturnFocus(): void {
  const [before] = useState(() => (typeof document === 'undefined' ? null : document.activeElement))
  useEffect(() => () => { if (before instanceof HTMLElement && before.isConnected) before.focus() }, [before])
}
