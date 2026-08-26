import { parseDeckFile } from '@fftcg/cards/deck'
import type { CardDef } from '@fftcg/engine'
import cardsJson from '@fftcg/cards/data/cards.json'
import deckText from '../../../decks/starter-2025-vol2.txt?raw'

// `@fftcg/cards`'s index reads the JSON with `node:fs`, which cannot run in a browser — so the web app
// imports the data file itself (Vite inlines it) and the parser from the package's browser-safe deep export.
export const CARD_DEFS: CardDef[] = cardsJson as CardDef[]

/** Both seats play the same Starter Set 2025 Vol. 2 list — see spec B4, and the open-deck-list note in B-risks. */
export const STARTER_DECK: string[] = parseDeckFile(deckText)
export const DECKS: [string[], string[]] = [STARTER_DECK, STARTER_DECK]
