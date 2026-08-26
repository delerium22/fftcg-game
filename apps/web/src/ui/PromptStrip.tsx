import type { JSX } from 'react'
import type { PlayerView } from '@fftcg/engine'
import type { Choice, ChoiceSet } from '../game/types.js'
import { HUMAN } from '../game/types.js'

const PHASE_LABEL: Record<string, string> = {
  setup: 'Setup', active: 'Active Phase', draw: 'Draw Phase', main1: 'Main Phase 1',
  attack: 'Attack Phase', main2: 'Main Phase 2', end: 'End Phase',
}

/**
 * The strip is the app's answer to "what am I supposed to do?" — spec B5 requires it to always say whose turn
 * it is and what the game is waiting for. Every command with no card subject (pass, mulligan, concede, the
 * no-block option) is a button here, plus whatever the currently selected card can do.
 */
export function PromptStrip({ view, choices, shown, aiThinking, onChoose }: {
  view: PlayerView
  choices: ChoiceSet
  shown: Choice[]
  aiThinking: boolean
  onChoose: (c: Choice) => void
}): JSX.Element {
  const yours = !view.result && (view.pending?.player ?? view.priority) === HUMAN
  const phase = `Turn ${view.turn} · ${PHASE_LABEL[view.phase] ?? view.phase}`
  // Some decisions have no button of their own because every one of their commands names a card — discarding to
  // hand size is the clearest case: the strip would otherwise offer nothing but Concede and read as a dead end
  // until the player guesses that hand cards are clickable. Say it instead.
  const cardOnly = yours && !shown.some((c) => c.command.type !== 'concede') && choices.byCard.size > 0
  const text = view.result ? 'Game over'
    : aiThinking ? 'The AI is thinking'
    : !yours ? 'Waiting for the AI'
    : cardOnly ? `${choices.prompt} — click a highlighted card`
    : choices.prompt
  return (
    <div className="prompt table__prompt">
      <span className={yours ? 'prompt__phase prompt__phase--yours' : 'prompt__phase'}>{phase}</span>
      <span className="prompt__text">
        {text}
        {aiThinking && <span className="thinking" aria-hidden="true"><span /><span /><span /></span>}
      </span>
      <div className="prompt__actions">
        {yours && shown.map((c, i) => (
          <button
            key={i}
            className={c.command.type === 'concede' ? 'btn btn--danger' : c.command.type === 'pass' ? 'btn btn--ghost' : 'btn btn--primary'}
            onClick={() => onChoose(c)}
          >
            {c.label}
          </button>
        ))}
      </div>
    </div>
  )
}
