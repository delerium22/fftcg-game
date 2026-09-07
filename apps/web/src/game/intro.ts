/**
 * Whether this browser has already been shown "How to play" (rung H1-D2).
 *
 * Per BROWSER, not per game: "Play again" is the same person at the same table, and re-explaining the rules
 * to them is the pop-up nobody asked for. Every access is wrapped because `localStorage` is allowed to throw
 * — private windows, blocked site data, some embedded views — and a rules sheet is not worth a blank page. A
 * browser that throws simply sees the intro every time, which is the safe side to land on.
 */
export const INTRO_SEEN_KEY = 'fftcg.howToPlay.seen'

export function hasSeenIntro(): boolean {
  try {
    return localStorage.getItem(INTRO_SEEN_KEY) === '1'
  } catch {
    return false
  }
}

export function markIntroSeen(): void {
  try {
    localStorage.setItem(INTRO_SEEN_KEY, '1')
  } catch {
    // Nothing to do: the sheet will show again next load, which is the documented fallback.
  }
}
