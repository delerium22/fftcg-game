import { useState, type JSX } from 'react'
import { hasSeenIntro } from './game/intro.js'
import { useGame } from './game/useGame.js'
import { Board } from './ui/Board.js'
import { HowToPlay } from './ui/HowToPlay.js'

/**
 * The seed from `?seed=`, or `undefined` for a fresh random game.
 *
 * A production surface added for a test, and worth saying so: E10 needs a browser check over a REPRODUCIBLE
 * route, because a check that plays randomly until it happens to reach a deck search is both vacuous when it
 * misses and flaky when it does not. It earns its place independently — a player who hits a bug can now say
 * which game it was, and get the same one back.
 *
 * A malformed seed does NOT brick the game: the CLI's lesson was to reject unknown FLAGS loudly, and a typo
 * in an address bar is not that. It starts an ordinary random game and says so in the console, rather than
 * silently pretending the parameter was honoured.
 */
export function seedFromLocation(search: string): number | undefined {
  const raw = new URLSearchParams(search).get('seed')
  if (raw === null) return undefined
  // Digits only, deliberately. `Number` would take "" as 0, "0x10" as 16, " 5" as 5 and "1e3" as 1000 — four
  // ways to be handed a game other than the one asked for, which is the whole point of asking by seed.
  const n = /^\d+$/.test(raw) ? Number(raw) : NaN
  if (Number.isSafeInteger(n) && n <= 2_147_483_647) return n
  console.warn(`Ignoring ?seed=${raw}: a seed must be a whole number from 0 to 2147483647. Starting a random game.`)
  return undefined
}

export function App(): JSX.Element {
  const game = useGame(seedFromLocation(window.location.search))
  // Rung H1: the rules sheet, once per browser (a lazy initialiser, so storage is read once, not per render).
  // Mounted only while open — a native `<dialog>` that is closed is still in the DOM and still announced.
  const [help, setHelp] = useState(() => !hasSeenIntro())
  return (
    <>
      <Board game={game} onHelp={() => setHelp(true)} />
      {help && <HowToPlay onClose={() => setHelp(false)} />}
    </>
  )
}
