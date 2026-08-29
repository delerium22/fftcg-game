import type { JSX } from 'react'
import { unimplementedClauseCount, type CardDef } from '@fftcg/engine'

/**
 * What a card actually DOES, for the card the player last pointed at.
 *
 * Found by playing: the game dealt five cards, asked "keep or mulligan", and there was no way to learn what
 * any of them did. Clicking a card changed nothing but focus, and `title` duplicated the aria-label —
 * "Ramuh, cost 2, lightning, summon". Name, cost, element, type, power; never the card's text. So every
 * decision in the game was made blind unless the player already knew the pool by heart, while the AI read
 * the ability AST directly. `def.text` was in the browser's memory on every render the whole time.
 *
 * ONE card at a time, and it does not clear when the pointer leaves. Reading a card and then moving to the
 * button that acts on it must not blank the thing you just read — and a plan review confirmed that serial
 * inspection is enough even for blocking, where two cards are compared, because the card faces already show
 * effective power, damage, grants and flags side by side.
 */
export function CardDetails({ def, action }: { def: CardDef | undefined; action?: string | null }): JSX.Element {
  if (!def) {
    return (
      <section className="details details--empty" aria-label="Card details">
        <p className="details__hint">Point at a card to read it.</p>
      </section>
    )
  }

  // How many PRINTED clauses this build does not implement. Deliberately the engine's own function, not a
  // second copy of the arithmetic: it is the same rule the game log's "played as vanilla" warning uses, and
  // two implementations would mean the panel and the log telling the player two different stories about one
  // card. In the current pool this is always 0 — every card is fully implemented, and a pool invariant in
  // the cards package fires on the day that stops being true. Do not go looking for a card that trips it.
  const missing = unimplementedClauseCount(def)

  return (
    <section className="details" aria-label="Card details">
      <h3 className="details__name">{def.name}</h3>
      <p className="details__meta">
        <span>{def.code}</span>
        <span>{def.type}</span>
        <span>{def.elements.join(' / ')}</span>
        <span>{def.cost} CP</span>
        {def.power !== null && <span>{def.power}</span>}
      </p>
      {/* `def.text` — everything the card PRINTS. Not the implemented clauses joined together: for Cloud
          those happen to reconstruct the printed text exactly, so joining them looks right and silently
          drops whatever this build has not implemented, which is the one thing this panel exists to show. */}
      {def.text !== '' && <p className="details__text">{def.text}</p>}
      {/* What clicking this card will spend, BEFORE the click. One click used to cast a 2-cost Summon by
          discarding a 5-cost bomb, and said so only afterwards, in the past tense, in the log. This is the
          same `Choice.label` string the click submits — passed in, never rebuilt, so the two cannot drift. */}
      {action != null && action !== '' && <p className="details__action">{action}</p>}
      {missing > 0 && (
        <p className="details__caveat">
          {missing === 1
            ? 'One printed ability is not implemented in this build and will do nothing.'
            : `${missing} printed abilities are not implemented in this build and will do nothing.`}
        </p>
      )}
    </section>
  )
}
