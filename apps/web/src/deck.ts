import { parseDeckFile } from '@fftcg/cards/deck'
import { withAbilities } from '@fftcg/cards/abilities'
import type { CardDef } from '@fftcg/engine'
import cardsJson from '@fftcg/cards/data/cards.json'
import deckText from '../../../decks/starter-2025-vol2.txt?raw'
import lbDeckText from '../../../decks/starter-2025-vol2-lb.txt?raw'
import vol1DeckText from '../../../decks/starter-2025-vol1.txt?raw'
import vol1LbDeckText from '../../../decks/starter-2025-vol1-lb.txt?raw'

// `@fftcg/cards`'s index reads the JSON with `node:fs`, which cannot run in a browser — so the web app
// imports the data file itself (Vite inlines it) and the parser from the package's browser-safe deep export.
//
// `withAbilities` is the other half of what the index would have done, and it is NOT optional: `loadCards()`
// merges the hand-written ability ASTs onto the fetched defs, so a consumer that skips it plays a fully
// VANILLA game. Reading the raw JSON here is what the CLI gets from `loadCards()` minus its abilities —
// which meant the browser was playing a different game from the CLI, and from this app's own tests, which
// call `withAbilities` themselves and so could never catch it.
export const CARD_DEFS: CardDef[] = withAbilities(cardsJson as CardDef[])

/**
 * The Starter Set 2025 Vol. 2 list — see spec B4, and the open-deck-list note in B-risks.
 *
 * `DECKS`/`LB_DECKS` are the Vol. 2 MIRROR, kept for the test fixtures that were written against it: since rung V1-C
 * the app itself deals a pair chosen per seat (`DECK_CHOICES`), and its default is not the mirror. A fixture that
 * pins a seed pins the mirror game it was written for, so these do not move.
 */
export const STARTER_DECK: string[] = parseDeckFile(deckText)
export const DECKS: [string[], string[]] = [STARTER_DECK, STARTER_DECK]
/** Rung J8: the Vol. 2 LB deck (§7.14), the same four cards for both seats of the mirror. */
export const LB_DECK: string[] = parseDeckFile(lbDeckText)
export const LB_DECKS: [string[], string[]] = [LB_DECK, LB_DECK]
/** The same fixtures under the name that says what they are (rung V1-C, R11). */
export const VOL2_DECKS = DECKS
export const VOL2_LB_DECKS = LB_DECKS

/** Rung V1-C (spec V1-D17): a deck either seat can play. */
export type DeckKey = 'vol1' | 'vol2'
/** One deck per SEAT, `[you, the AI]` — seat 0 then seat 1, so it maps straight onto `createGame`'s `decks`. */
export type DeckPair = readonly [DeckKey, DeckKey]

export interface DeckChoice {
  readonly main: string[]
  readonly lb: string[]
  /** Short, for the picker and the New game button ("Vol. 2 vs Vol. 1"). */
  readonly label: string
  /** Long, for the opening log line ("you play Starter Vol. 2"). */
  readonly name: string
}

export const DECK_CHOICES: Readonly<Record<DeckKey, DeckChoice>> = {
  vol1: { main: parseDeckFile(vol1DeckText), lb: parseDeckFile(vol1LbDeckText), label: 'Vol. 1', name: 'Starter Vol. 1' },
  vol2: { main: STARTER_DECK, lb: LB_DECK, label: 'Vol. 2', name: 'Starter Vol. 2' },
}
export const DECK_KEYS: readonly DeckKey[] = ['vol1', 'vol2']
export const isDeckKey = (s: string): s is DeckKey => (DECK_KEYS as readonly string[]).includes(s)

/** The web default: you play Vol. 2, the AI plays Vol. 1 — the set the user owns (V1-D17). The CLI stays the mirror. */
export const DEFAULT_DECKS: DeckPair = ['vol2', 'vol1']
export const MIRROR_DECKS: DeckPair = ['vol2', 'vol2']

/** "Vol. 2 vs Vol. 1" — your deck first. Both buttons that start a game name the pair with it. */
export const pairLabel = (pair: DeckPair): string => `${DECK_CHOICES[pair[0]].label} vs ${DECK_CHOICES[pair[1]].label}`

/** The per-seat main and LB lists a pair deals — the one place a key becomes a list. */
export function deckLists(pair: DeckPair): { decks: [string[], string[]]; lbDecks: [string[], string[]] } {
  const [you, ai] = [DECK_CHOICES[pair[0]], DECK_CHOICES[pair[1]]]
  return { decks: [you.main, ai.main], lbDecks: [you.lb, ai.lb] }
}
