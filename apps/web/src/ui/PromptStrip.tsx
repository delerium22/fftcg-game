import type { CSSProperties, JSX } from 'react'
import type { PlayerView } from '@fftcg/engine'
import type { Choice, ChoiceSet } from '../game/types.js'
import { HUMAN } from '../game/types.js'

const PHASE_LABEL: Record<string, string> = {
  setup: 'Setup', active: 'Active Phase', draw: 'Draw Phase', main1: 'Main Phase 1',
  attack: 'Attack Phase', main2: 'Main Phase 2', end: 'End Phase',
}

/*
 * A mode button carries the card's PRINTED wording verbatim — a whole sentence, not a two-word verb like the
 * rest of the strip. So ability buttons drop `.btn`'s uppercase/tracking, wrap, and cap their width, and the
 * row wraps under them instead of pushing the strip off the side. Inline because this rung owns PromptStrip.tsx
 * and not styles.css; every value below is a token the sheet already defines.
 */
const ACTIONS_WRAP: CSSProperties = { flexWrap: 'wrap', justifyContent: 'flex-end' }
const ABILITY_BTN: CSSProperties = {
  textTransform: 'none', letterSpacing: '0.01em', fontWeight: 500,
  maxWidth: '26rem', whiteSpace: 'normal', textAlign: 'left',
}
const isAbility = (c: Choice): boolean => c.command.type === 'chooseMode' || c.command.type === 'chooseTargets'

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
  // `chooseTargets` is the same case wearing a disguise: the "choose no targets" answer IS a strip button, so
  // the strip is not empty — but every actual target still has to be clicked on the board, and saying so is the
  // only thing that tells the player the highlighted Forwards are the point (spec B-A4).
  const picking = yours && view.pending?.kind === 'chooseTargets'
  const cardOnly = yours && choices.byCard.size > 0 && (picking || !shown.some((c) => c.command.type !== 'concede'))
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
      <div className="prompt__actions" style={ACTIONS_WRAP}>
        {yours && shown.map((c, i) => (
          <button
            key={i}
            className={c.command.type === 'concede' ? 'btn btn--danger' : c.command.type === 'pass' ? 'btn btn--ghost' : 'btn btn--primary'}
            style={isAbility(c) ? ABILITY_BTN : undefined}
            onClick={() => onChoose(c)}
          >
            {c.label}
          </button>
        ))}
      </div>
    </div>
  )
}
