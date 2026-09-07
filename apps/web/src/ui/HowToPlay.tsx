import { useEffect, useId, useRef, type JSX } from 'react'
import { markIntroSeen } from '../game/intro.js'

/**
 * The rules, before the first decision (rung H1).
 *
 * Found by sitting a first-time player down: the first thing on screen was "Choose who goes first" and a
 * Concede button, and nothing said what the goal was, what CP is, or that the cards are clickable. The README
 * explains all of it — to a developer, in another window.
 *
 * The same native `<dialog>` + `showModal()` mechanism as game over, for the same reason: while the sheet is
 * up the board is inert, so a player cannot start the game through it by accident. Unlike game over it is an
 * ordinary `role="dialog"` and Escape closes it — there is a board to return to. The text describes THIS
 * BUILD's rules (sorcery-speed abilities, auto-paid CP, no First Strike), not the Comprehensive Rules; a
 * rules sheet that promises a combat trick the engine refuses is worse than none.
 */
export function HowToPlay({ onClose }: { onClose: () => void }): JSX.Element {
  const ref = useRef<HTMLDialogElement | null>(null)
  const titleId = useId()

  useEffect(() => {
    const el = ref.current
    if (!el) return
    // Absent in this jsdom — guard rather than throw. The unit tests spy on it; modality itself is proved
    // in a real browser (e2e/how-to-play.spec.ts).
    if (typeof el.showModal === 'function' && !el.open) el.showModal()
    // The heading, not the button: a screen reader then hears what this is before what it can do.
    el.querySelector<HTMLHeadingElement>('[data-dialog-title]')?.focus()
  }, [])

  const close = (): void => { markIntroSeen(); onClose() }

  return (
    <dialog
      ref={ref}
      className="howto"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onCancel={(e) => { e.preventDefault(); close() }}
    >
      <div className="howto__sheet">
        <h2 id={titleId} className="howto__title" data-dialog-title tabIndex={-1}>How to play</h2>
        <p className="howto__lede">
          Final Fantasy Trading Card Game, against an AI. You each start with a 50-card deck and a hand of five.
        </p>

        <section className="howto__section">
          <h3>The goal</h3>
          <p>
            Deal <strong>7 damage</strong> to your opponent. Each point of damage moves the top card of their
            deck into their damage zone. A player who cannot draw a card also loses.
          </p>
        </section>

        <section className="howto__section">
          <h3>Your turn</h3>
          <p>
            <strong>Active</strong> — everything you control stands up. <strong>Draw</strong> — two cards
            (one on the very first turn). <strong>Main Phase 1</strong> — cast cards, use abilities.{' '}
            <strong>Attack</strong> — send Forwards at the opponent. <strong>Main Phase 2</strong> — more of
            the same. <strong>End</strong> — discard down to five cards.
          </p>
        </section>

        <section className="howto__section">
          <h3>Paying for cards: CP</h3>
          <p>
            Every card has a cost in Crystal Points. Dull a <strong>Backup</strong> for 1 CP of its element, or
            discard a card from your hand for 2 CP of its element. At least one CP must match the card's
            element. <strong>This app pays for you</strong>, choosing the cheapest way; when there is more
            than one way, the strip offers <em>Pay differently</em>.
          </p>
        </section>

        <section className="howto__section">
          <h3>Backups and Forwards</h3>
          <p>
            <strong>Backups</strong> (at most five) sit at the back and make CP. <strong>Forwards</strong> fight:
            each has a power, and takes damage until the end of the turn. A Forward with damage equal to its
            power is broken. Attack with one Forward at a time, or with several of one element as a party. The
            defender may <strong>block</strong> with one Forward; the two deal damage to each other. An
            unblocked attack deals 1 damage to the player. <em>Haste</em> lets a Forward attack the turn it
            arrives; <em>Brave</em> means it does not dull when it attacks.
          </p>
        </section>

        <section className="howto__section">
          <h3>Summons, abilities, EX Burst</h3>
          <p>
            <strong>Summons</strong> are one-shot effects. Cards with abilities show them as choices on the
            card, labelled with their cost; in this build you use them only in your own Main Phases. When a
            damage card has <strong>EX Burst</strong>, its effect fires for free as it is dealt.
          </p>
        </section>

        <section className="howto__section">
          <h3>Using this table</h3>
          <p>
            The strip in the middle says what the game is waiting for and offers the buttons that answer it.
            When the answer is a card, the strip goes quiet and says <em>click a highlighted card</em> — the
            glowing cards are the only ones that do anything. Point at any card, or focus it with the keyboard,
            to read its full text in the panel on the right. <strong>Concede</strong> asks twice. Reopen this
            sheet any time with <em>How to play</em> in the right rail.
          </p>
        </section>

        <div className="howto__actions">
          <button className="btn btn--primary" onClick={close}>Play</button>
        </div>
      </div>
    </dialog>
  )
}
