import { createGame, legalCommands, viewFor } from '@fftcg/engine'
import { CARD_DEFS, DECKS } from './deck.js'

// Scaffold smoke screen: proves the engine and the card database run unmodified in a browser.
// Replaced by the real board in the next step.
export function App() {
  const state = createGame({ seed: 1, decks: DECKS, defs: CARD_DEFS })
  const view = viewFor(state, 0)
  const legal = legalCommands(state, 0)
  return (
    <main style={{ padding: '2rem', fontFamily: 'ui-monospace, monospace' }}>
      <h1>FFTCG engine is running in the browser</h1>
      <p>
        turn {view.turn} · phase {view.phase} · {CARD_DEFS.length} card defs · deck {view.fields[0].deckCount} ·
        hand {view.hand.length} · {legal.length} legal commands
      </p>
    </main>
  )
}
