import type { Command, PlayerId, PlayerView } from '@fftcg/engine'

/**
 * Canonical, cross-determinisation identity for search (spec D-2). **This is the crux of the rung.**
 *
 * `Command` embeds `CardId` everywhere, and `determinise()` mints fresh sequential synthetic ids for hidden
 * cards on every iteration. So raw commands cannot key a tree in either direction:
 *   - the same numeric id can mean a DIFFERENT card in a different world  → false matches, and the search
 *     pools statistics for two unrelated moves;
 *   - the same semantic card gets a DIFFERENT id in another world         → false splits, and the search
 *     never accumulates enough visits on anything to choose well.
 * Neither shows up as a crash or an illegal move. Both just make the search quietly worse than greedy,
 * which is why `ActionKey` correctness is pinned by unit tests and not by a win-rate gate.
 *
 * The rule: **a key names what a human would name.** Public cards are identified by where they sit, because
 * both players can see that and it survives redeterminisation. Private cards are identified by what they
 * are, because their id is meaningless outside one world.
 */

/**
 * A card reference that means the same thing in every determinisation.
 *
 *  - `f0:2`  — player 0's forwards, index 2 (public: position is observable and stable)
 *  - `b1:0`  — player 1's backups, index 0
 *  - `z0:3`  — player 0's break zone, index 3 (public and ordered)
 *  - `h:9-074C#1` — the SECOND copy of 9-074C in the root player's own hand. Hand cards are private, so
 *    position in a determinised hand is meaningless; the card CODE plus an occurrence counter is what a
 *    player actually distinguishes. Two copies of one code are interchangeable, which is why the counter is
 *    by code and not by id.
 *  - `?`     — a hidden card with no canonical identity (an opponent hand card the root player cannot name).
 *    A key containing `?` must never be used to pool statistics; see `isOpaque`.
 */
export type CardRef = string

/** Canonical identity of one action, stable across determinisations. */
export type ActionKey = string

/**
 * Canonical digest of what the ROOT player can observe after an action. Nodes are
 * `(parent history, ActionKey, ObservationKey)`, because an action alone does not identify the resulting
 * information set: turn advancement draws cards automatically (`phases.ts`), so two identical actions can
 * leave the root player in observably different positions. Every id inside — including in `attack`,
 * `pending` and `resolution` — is replaced by a `CardRef`.
 */
export type ObservationKey = string

/** A key is opaque if any part of it names a card the root player cannot identify. */
export function isOpaque(key: string): boolean {
  return key.includes('?')
}

/**
 * The contract the implementation must satisfy. Written here as documentation-with-teeth: the tests in
 * `test/keys.test.ts` assert exactly these properties, and they are the ones a tournament cannot check.
 *
 *  1. DETERMINISM     — `actionKey(v, c)` depends only on `v` and `c`, never on iteration order or a Map.
 *  2. NO FALSE MATCH  — two commands naming different card CODES never share a key, even when their
 *                       `CardId`s collide across worlds.
 *  3. NO FALSE SPLIT  — the same semantic action in two determinisations shares a key, even though its
 *                       `CardId`s differ.
 *  4. TOTALITY        — every `Command` variant produces a key; sets (attackers, targets, payment sources,
 *                       assignments, modes) are normalised by sorting, because order is not semantic.
 *  5. ROUND TRIP      — `decodeAction(view, key)` returns a command that is legal in THIS determinisation,
 *                       or null when the key names something absent from this world. The tree stores keys;
 *                       only the root returns a real `Command`.
 */
export interface KeyContract {
  actionKey(view: PlayerView, command: Command): ActionKey
  observationKey(view: PlayerView): ObservationKey
  decodeAction(view: PlayerView, key: ActionKey): Command | null
  cardRef(view: PlayerView, id: number, root: PlayerId): CardRef
}

// ---------------------------------------------------------------------------
// The worker-safe search seam (spec D-7)
// ---------------------------------------------------------------------------

/**
 * Everything the search needs, and nothing it must not have (spec D-9). There is deliberately no
 * `GameState` here: the search derives every simulated world from a `PlayerView` plus the two publicly
 * declared deck lists, so it cannot read the live game even by accident.
 *
 * Structured-cloneable by construction, so D2 can post it to a Web Worker unchanged.
 */
export interface SearchInput {
  readonly view: PlayerView
  /** Both players' publicly declared lists. Semantically a MULTISET — sort a copy before sampling. */
  readonly decks: readonly [readonly string[], readonly string[]]
  readonly iterations: number
  /** Seeds the world sampling, expansion and tie-breaking streams — kept separate (spec D-8). */
  readonly seed: number
  readonly rolloutCommandCap: number
  readonly explorationC: number
}

/** Counters that make cost measurable rather than guessed (spec D-A4). */
export interface SearchDiagnostics {
  readonly determinisations: number
  readonly treeApplies: number
  readonly rolloutApplies: number
  readonly evaluations: number
  readonly nodes: number
  readonly maxCommandDepth: number
  /** Root children as `[ActionKey, visits, meanReward]`, best first — the search's own explanation. */
  readonly rootChildren: readonly (readonly [ActionKey, number, number])[]
}

export interface SearchResult {
  readonly command: Command
  readonly diagnostics: SearchDiagnostics
}
