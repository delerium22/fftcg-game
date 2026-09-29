import type { JSX } from 'react'
import { Card } from '../ui/Card.js'
import { CARD_FIXTURES } from './cardFixtures.js'

/** The fixture page body: every `CARD_FIXTURES` entry, grouped, each in a `figure[data-fixture]` a test can select. */
export function Gallery(): JSX.Element {
  const groups = [...new Set(CARD_FIXTURES.map((f) => f.group))]
  return (
    <main className="gallery">
      <h1>Card fixtures</h1>
      {groups.map((g) => (
        <section key={g} className="gallery__group">
          <h2>{g}</h2>
          <div className="gallery__row">
            {CARD_FIXTURES.filter((f) => f.group === g).map((f) => (
              <figure key={f.name} className="gallery__item" data-fixture={f.name}>
                <Card {...f.props} />
                <figcaption>{f.name}</figcaption>
              </figure>
            ))}
          </div>
        </section>
      ))}
    </main>
  )
}
