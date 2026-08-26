import type { JSX } from 'react'
import { useGame } from './game/useGame.js'
import { Board } from './ui/Board.js'

export function App(): JSX.Element {
  const game = useGame()
  return <Board game={game} />
}
