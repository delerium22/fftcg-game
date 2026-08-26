import type { CardId, Command, PlayerId, PlayerView } from '@fftcg/engine'

/** Spec B4: the human always holds seat 0, `GreedyAgent` seat 1. */
export const HUMAN: PlayerId = 0
export const AI: PlayerId = 1

/**
 * A command the human can choose, paired with the English label the prompt strip shows for it.
 * `card` is the card the click-target maps to, or `null` for commands with no card subject
 * (pass, concede, mulligan, chooseFirst, and the "no block" option).
 */
export interface Choice {
  command: Command
  label: string
  card: CardId | null
}

/**
 * Everything the board needs to know about what is clickable right now, derived from
 * `legalCommands(state, HUMAN)`. Spec B-A4: a card is clickable IFF it appears in `byCard`, so an
 * illegal click is unrepresentable rather than rejected after the fact.
 */
export interface ChoiceSet {
  /** Every choice, in `legalCommands` order. */
  all: Choice[]
  /** Choices grouped by their card subject — the click map for the board. */
  byCard: Map<CardId, Choice[]>
  /** Choices with no card subject — rendered as buttons in the prompt strip. */
  loose: Choice[]
  /** One-line statement of what the game is waiting for, e.g. "Choose a blocker". */
  prompt: string
}

/** A line in the game log. `kind` drives styling; `text` is already human-readable. */
export interface LogLine {
  kind: 'phase' | 'human' | 'ai' | 'event' | 'warning' | 'result'
  text: string
}

/** What `useGame()` hands the React tree. It never exposes `GameState` — spec B3. */
export interface GameApi {
  view: PlayerView
  choices: ChoiceSet
  log: LogLine[]
  /** True while the AI is taking its turn; the board is inert and shows a thinking indicator. */
  aiThinking: boolean
  /** Apply one of `choices.all`. Throws if the command is not currently legal. */
  choose(choice: Choice): void
  /** Start a new game with a fresh seed. */
  restart(): void
}
