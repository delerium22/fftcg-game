import { parseDeckFile } from '@fftcg/cards/deck'
import { withAbilities } from '@fftcg/cards/abilities'
import type { CardDef } from '@fftcg/engine'
import cardsJson from '@fftcg/cards/data/cards.json'
import deckText from '../../../decks/starter-2025-vol2.txt?raw'

// `@fftcg/cards`'s index reads the JSON with `node:fs`, which cannot run in a browser — so the web app
// imports the data file itself (Vite inlines it) and the parser from the package's browser-safe deep export.
//
// `withAbilities` is the other half of what the index would have done, and it is NOT optional: `loadCards()`
// merges the hand-written ability ASTs onto the fetched defs, so a consumer that skips it plays a fully
// VANILLA game. Reading the raw JSON here is what the CLI gets from `loadCards()` minus its abilities —
// which meant the browser was playing a different game from the CLI, and from this app's own tests, which
// call `withAbilities` themselves and so could never catch it.
export const CARD_DEFS: CardDef[] = withAbilities(cardsJson as CardDef[])

/** Both seats play the same Starter Set 2025 Vol. 2 list — see spec B4, and the open-deck-list note in B-risks. */
export const STARTER_DECK: string[] = parseDeckFile(deckText)
export const DECKS: [string[], string[]] = [STARTER_DECK, STARTER_DECK]
