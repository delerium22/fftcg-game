import { Fragment, useEffect, useRef, useState } from 'react'
import type { CSSProperties, JSX } from 'react'
import type { PlayerView } from '@fftcg/engine'
import type { Choice, ChoiceSet } from '../game/types.js'
import { HUMAN } from '../game/types.js'
import { stackItemLabel } from '../game/commands.js'

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
// Rung V2-A2: a replacement order's button is a whole sentence too ("Yuzuki's reduction to 0, then …").
const isAbility = (c: Choice): boolean => c.command.type === 'chooseMode' || c.command.type === 'chooseTargets' || c.command.type === 'chooseReplacementOrder'

/**
 * The strip is the app's answer to "what am I supposed to do?" — spec B5 requires it to always say whose turn
 * it is and what the game is waiting for. Every command with no card subject (pass, mulligan, concede, the
 * no-block option) is a button here, plus whatever the currently selected card can do.
 */
export function PromptStrip({ view, choices, shown, aiThinking, onChoose, tray, paying, fullControl = false, onFullControl }: {
  view: PlayerView
  choices: ChoiceSet
  shown: Choice[]
  aiThinking: boolean
  onChoose: (c: Choice) => void
  /** Rung K5: the full-control toggle's state, and the handler that flips it. No handler, no control. */
  fullControl?: boolean
  onFullControl?: ((on: boolean) => void) | undefined
  /** The payment tray (rung I2), which REPLACES the buttons while a payment is being built. */
  tray?: JSX.Element | null
  /** What the tray is asking, for the live region: "Paying for Ramuh — 1 of 2 CP paid". */
  paying?: string | null
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
  const answersOnCards = yours && choices.byCard.size > 0
  // MVP0-SIMPLIFICATION (rung G6, CR §2.1 — a player may concede at any time): when every answer is on a card
  // the strip would hold exactly one button, Concede — the only tab stop, two Enters from game over, at 345 of
  // 2,288 human decisions (15.1 %) in the spec's corpus. So at those decisions the strip offers NOTHING, and the
  // player cannot concede until the next strip, which is one decision away. A strip whose sole affordance ends
  // the game is the worse restriction; `hotseat.test.ts` made the same call for the terminal ("offered LAST,
  // never as option 0"). Concede's ordering and arming are untouched everywhere else.
  const concedeOnly = answersOnCards && !shown.some((c) => c.command.type !== 'concede')
  // `chooseTargets` keeps its "no targets" button, so it is NOT concede-only — but the targets themselves are
  // still on the board, and the prompt has to say so. Same wording as before; only the buttons changed.
  const cardOnly = concedeOnly || (answersOnCards && picking)
  const text = view.result ? 'Game over'
    : aiThinking ? 'The AI is thinking'
    : !yours ? 'Waiting for the AI'
    // Building a payment REPLACES the strip, so the standing instruction is no longer true of it: it said
    // "Main Phase 1 — cast, attack, or pass" while Pass was not on screen. This is also what makes every
    // crystal that lights audible — the prompt is the live region, so the running total is the announcement.
    : paying ? paying
    // "·", not the em-dash the rest of the strip uses: rung C2 spends the dash on the trigger's CAUSE ("The
    // AI's Luso was broken — Lightning: choose 1 Forward…"), and a second one would read as a third clause of
    // the same sentence rather than as the standing instruction it is.
    : cardOnly ? `${choices.prompt} · click a highlighted card`
    : choices.prompt
  // RESTORE focus, never seize it (found by playing with the keyboard).
  //
  // Every control the strip offers is replaced when the prompt changes, so the button the player just pressed
  // is unmounted and the browser drops focus to `document.body`. On a mouse that is invisible; on a keyboard
  // it means tabbing in from the top of the document after every single AI turn, past the whole board and log.
  // Focus styling was always deliberate here — the cyan ring is one of the three signals the CSS says must
  // never be confused — so the intent was there and only this was missing.
  //
  // PROVENANCE, not `document.body`. The first version inferred "focus was lost" from body being active, and
  // body is also active before the player has touched anything — so it grabbed focus on first mount, which is
  // an unrequested context change (WCAG 3.2.5) rather than a restoration. `hadFocus` records that the player
  // was actually in the strip, which is what makes a later `body` mean lost.
  // Conceding asks once (found by playing: it did not).
  //
  // It is the only irreversible thing in the strip, it is one click, and it sits next to the buttons you
  // actually want — `Pass` is its neighbour all game. This project had already mitigated the hazard twice
  // without removing it: `Board` sorts it last precisely because `legalCommands` would otherwise make it
  // "the leftmost, most-reachable button on the strip all game", and the focus restoration above refuses to
  // land on it because the next Enter would end the game. Asking is the mitigation those two imply.
  //
  // A second click rather than a modal: the strip is already how every decision is made here, and a dialog
  // would be the only one in the app. The arming resets on any change of position, so it can never be left
  // armed across a turn and surprise someone later.
  const [armed, setArmed] = useState(false)
  // Disarm on any change of POSITION, and `choices` is what says the position moved: `useGame` memoises it
  // per game state, so its identity changes for every game action and holds still for a log-only re-render.
  //
  // The offer text alone is not enough, and believing it was is how this shipped broken the first time.
  // Codex reproduced it against real engine choices: arm Concede, then click a card whose single cast
  // `Board` submits directly without going through this strip — the game advances, but it is still your Main
  // Phase and the strip still offers exactly `Pass | Concede`, so a text signature never changes and one
  // later click concedes. The offer is kept as a second key because it also moves within a single `choices`
  // (selecting a card widens the strip), and `yours` because the seat changing is a position change too.
  const offered = shown.map((c) => `${c.command.type}:${c.label}`).join('|')
  useEffect(() => { setArmed(false) }, [choices, offered, yours, tray])

  const actions = useRef<HTMLDivElement>(null)
  const hadFocus = useRef(false)
  useEffect(() => {
    const el = actions.current
    if (!el) return undefined
    const mark = (): void => { hadFocus.current = true }
    el.addEventListener('focusin', mark)
    return () => { el.removeEventListener('focusin', mark) }
  }, [])

  useEffect(() => {
    if (!yours || !hadFocus.current || document.activeElement !== document.body) return
    // `[data-command]`, not a CSS class: the first version excluded Concede by `.btn--danger`, which ties
    // whether the game can be conceded by accident to a styling token.
    actions.current?.querySelector<HTMLButtonElement>('button[data-command]:not([data-command="concede"])')?.focus()
  }, [yours, shown])

  return (
    <div className="prompt table__prompt">
      <span className={yours ? 'prompt__phase prompt__phase--yours' : 'prompt__phase'}>{phase}</span>
      {/*
        * The one channel that tells a player who cannot see the board what the game now wants.
        *
        * Before this it was an ordinary span, and the app had ZERO live regions of any kind — so after the
        * AI moved, a screen-reader player was told neither what happened nor what was required, which in a
        * turn-based game is the entire interface. `status` is the semantic for changed application state
        * that must be presented WITHOUT taking focus; moving focus on a state change is the WCAG 3.2.5
        * violation the focus restoration below already exists to avoid.
        *
        * `aria-live` and `aria-atomic` are explicit rather than left to `status`'s implicit values, which
        * are not honoured consistently everywhere. Atomic because the instruction is one sentence and half
        * of it is meaningless — "Choose a blocker for" without the attacker is worse than silence.
        *
        * This element must NOT be keyed or conditionally rendered: a live region has to exist before the
        * content it announces, and one replaced on every change announces nothing at all.
        */}
      {/* Rung J1-D15: the stack is public (§7.12.2). Shown whenever it holds anything, bottom to top, with
        * the top marked — a pass with this row on the table is "let it resolve", and the row is what says so.
        * A pass-only window never renders (the hook closes it), so the row is only ever seen with a real answer. */}
      {view.stack.length > 0 && (
        <ol className="stack-row" data-stack-row aria-label="The stack">
          {view.stack.map((item, i) => (
            <li key={i} className={i === view.stack.length - 1 ? 'stack-row__item stack-row__item--top' : 'stack-row__item'}>
              {stackItemLabel(view, item)}{i === view.stack.length - 1 ? ' — resolves next' : ''}
            </li>
          ))}
        </ol>
      )}
      <span
        className="prompt__text"
        role="status"
        // Silent once the game is over: the alertdialog owns that announcement, and three live channels
        // firing on one transition is how a screen reader ends up saying the same thing three ways.
        aria-live={view.result ? 'off' : 'polite'}
        aria-atomic="true"
      >
        {text}
        {aiThinking && <span className="thinking" aria-hidden="true"><span /><span /><span /></span>}
      </span>
      <div className="prompt__actions" style={ACTIONS_WRAP} ref={actions}>
        {yours && tray}
        {yours && !tray && !concedeOnly && shown.map((c, i) => (
          <Fragment key={`${c.command.type}:${c.label}:${i}`}>
          <button
            data-command={c.command.type}
            className={c.command.type === 'concede' ? 'btn btn--danger' : c.command.type === 'pass' ? 'btn btn--ghost' : 'btn btn--primary'}
            style={isAbility(c) ? ABILITY_BTN : undefined}
            onClick={(e) => {
              // Both mechanisms are needed, and the second only looks redundant. The effect above disarms
              // when the POSITION changes, which covers almost every action; this covers an action that
              // leaves the same offer standing, where the arming would otherwise survive into a fatal click.
              if (c.command.type !== 'concede') { setArmed(false); onChoose(c); return }
              if (!armed) { setArmed(true); return }
              // A double-click delivers two `click` events before `dblclick`, so the same gesture that arms
              // would confirm — one flick of the finger and the game is over, which is the hazard this whole
              // control exists to remove. `detail` is the click count: 2+ means the second half of a
              // double-click, and 0 means a keyboard activation, which is deliberate by definition.
              if (e.detail > 1) return
              onChoose(c)
            }}
          >
            {c.command.type === 'concede' && armed ? 'Concede game' : c.label}
          </button>
          </Fragment>
        ))}

        {yours && !tray && armed && (
          <button className="btn btn--ghost" data-command="cancel-concede" onClick={() => { setArmed(false) }}>
            Keep playing
          </button>
        )}
        {/* Rung K5: "show me every window." Last in the row and without `data-command`, so the focus
          * restoration above never lands on it and it never reads as one of the position's answers. Not while
          * a tray is open: the tray replaces the strip, and a second toggle beside "Auto" read as one control. */}
        {!view.result && !tray && onFullControl && (
          <button
            type="button"
            className="btn btn--ghost"
            data-toggle="full-control"
            aria-pressed={fullControl}
            title="Off: you are asked to respond only when the AI has put something on the stack, and once before combat damage. On: every response window is yours."
            onClick={() => { onFullControl(!fullControl) }}
          >
            Full control: {fullControl ? 'on' : 'off'}
          </button>
        )}
      </div>
    </div>
  )
}
