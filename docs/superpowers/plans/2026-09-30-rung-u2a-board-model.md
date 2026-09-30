# Rung U2a — the render projection (`BoardModel`) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a pure `project(view): BoardModel` — a flat, render-only model of every card the human can see and every
seat counter — and the Board rendering its zones and seats from it, with **identical output**. U3's director will diff
two of these; U2b rebuilds the layout on top of it.

**Architecture:** `apps/web/src/game/presentation/boardModel.ts` owns the types and `project`. It runs only on a
complete `PlayerView`, computes every display value there (power through `fieldCardDisplay`/`stateShim`, names through
`displayName`), and stores no cross-references. `Board.tsx` keeps every piece of interaction logic (choices, the
payment tray, the selection tray, the sheet's actions) exactly as it is and takes only the *display* half of each card's
props from the model: `{ ...model.cards[id].face, size, ...interaction }`.

**Tech Stack:** TypeScript (strict), React 19, Vitest (jsdom), the engine's `createGame`/`apply`, `@fftcg/ai`'s
`GreedyAgent` for a self-play corpus.

**Spec:** `docs/superpowers/specs/2026-09-30-ui-overhaul-design.md` — section 4.1 (the render projection), 4.3 (the
properties the model must keep), 4.6 (the Board falls back to `project(game.view)`), section 11 row U2. **Ruling (D32,
recorded in Task 3):** U2 is split into U2a (this plan: the projection, no visible change), U2b (the layout) and U2c
(log drawer, hover preview, settings popover) — one rung was a projection refactor, a layout rewrite and three new
components at once.

## Global Constraints

- `project` runs only on complete views; no engine or shim code ever runs on a partial state (spec section 4.1).
- The model holds no cross-references that need another record to render: no frames, no `knownBy`, no `resolution`
  (spec section 4.1).
- Face-up-ness comes from the zone, not from membership in `view.cards` (both LB decks are in `cards` while face down).
- **Identical output:** every existing unit and browser test passes unmodified, and the fixture gallery baseline is
  unchanged. No DOM, class, text or accessible-name change.
- Interaction stays authoritative and view-based in U2a (`choices`, `paying`, `selecting`, `sheet`); only display moves.
- No section sign followed by a number in code, tests or specs; `git add` named paths; commit trailers as before.
- Verify: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:browser`.

## Review Focus

1. **A card visible in no board zone** (a revealed deck card, a Summon on the stack, a pending candidate): it must have
   a record (zone `elsewhere`), or the orphan row and the sheet lose it. Pinned in Task 1's corpus test.
2. **A hidden card**: the model must never contain an id the view does not carry (IDs follow decklist order and would
   reveal the card). Pinned in Task 1's corpus test.
3. **Two copies of one card** ("Luso (1)", "Luso (2)"): names come from `displayName` over the complete view, so the
   occurrence markers match what the log and the buttons say. Pinned in Task 1 (names equal `displayName`).
4. **A pumped or debuffed Forward** (a continuous static from another card): the face's power is the layered power
   from the complete view. Pinned in Task 1 (field faces equal `fieldCardDisplay`).
5. **The AI's known hand cards and both LB decks**: in the model with the right side, zone and LB face state. Pinned
   in Task 1.

---

### Task 1: `BoardModel` and `project`

**Files:**
- Create: `apps/web/src/game/presentation/boardModel.ts`
- Test: `apps/web/test/board-model.test.ts`

**Interfaces:**
- Produces (exact):

```ts
export type ZoneKey = 'hand' | 'forwards' | 'backups' | 'lbDeck' | 'knownHand' | 'breakZone' | 'damageZone' | 'removedFromGame' | 'elsewhere'
/** The display half of `CardProps`: everything a card SHOWS, nothing about what pressing it does. */
export interface CardFace {
  code: string; name: string; cost: number; elements: Element[]; type: CardType; power: number | null
  powerBonus?: number; granted?: readonly Keyword[]; flags?: readonly FieldFlag[]
  damage?: number; dull?: boolean; frozen?: boolean; text?: string
}
export interface CardModel { id: CardId; side: PlayerId; zone: ZoneKey; index: number; face: CardFace; lbFaceUp?: boolean }
export interface SeatModel {
  deckCount: number; handCount: number
  forwards: CardId[]; backups: CardId[]; lbDeck: CardId[]; knownHand: CardId[]
  breakZone: CardId[]; damageZone: CardId[]; removedFromGame: CardId[]
}
/** One stack entry, keyed so a diff can insert or remove it (spec section 4.3). */
export interface StackEntryModel { key: string; kind: 'summon' | 'ability'; card: CardId; controller: PlayerId; label: string }
export interface BoardModel {
  cards: Record<CardId, CardModel>
  hand: CardId[]
  seats: [SeatModel, SeatModel]
  /** Bottom first, as `view.stack`. */
  stack: StackEntryModel[]
  /** Whose seat is highlighted: holds priority or owes the pending decision. */
  active: [boolean, boolean]
  turn: number; turnPlayer: PlayerId; phase: Phase; attackStep: AttackStep | null
  priority: PlayerId; pending: { kind: Pending['kind']; player: PlayerId } | null; result: GameResult | null
}
export function project(view: PlayerView): BoardModel
```

- [ ] **Step 1: Write the failing test** — `apps/web/test/board-model.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { GreedyAgent } from '@fftcg/ai'
import { actingPlayer, createGame, viewFor, type GameState, type PlayerView } from '@fftcg/engine'
import { CARD_DEFS, DECK_CHOICES } from '../src/deck.js'
import { displayName, fieldCardDisplay, stateShim } from '../src/game/commands.js'
import { project, type BoardModel } from '../src/game/presentation/boardModel.js'
import { AI, HUMAN } from '../src/game/types.js'
import { stepAi } from '../src/game/useGame.js'

const game = (seed: number): GameState => createGame({
  seed, defs: CARD_DEFS,
  decks: [DECK_CHOICES.vol2.main, DECK_CHOICES.vol1.main],
  lbDecks: [DECK_CHOICES.vol2.lb, DECK_CHOICES.vol1.lb],
})

/** Every human view along a Greedy-vs-Greedy game, up to `max` steps. */
function* views(seed: number, max = 400): Generator<PlayerView> {
  const decks: [string[], string[]] = [DECK_CHOICES.vol2.main, DECK_CHOICES.vol1.main]
  const agents = [new GreedyAgent({ seed, decks, depth: 1 }), new GreedyAgent({ seed: seed + 1, decks, depth: 1 })] as const
  let s = game(seed)
  for (let i = 0; i < max && !s.result; i++) {
    yield viewFor(s, HUMAN)
    const p = actingPlayer(s)
    if (p === null) break
    s = stepAi(s, agents[p]).state
  }
  yield viewFor(s, HUMAN)
}

/** The spec's well-formedness invariants (section 4.3), for one model against the view it came from. */
function expectWellFormed(v: PlayerView, m: BoardModel): void {
  const visible = new Set(Object.keys(v.cards).map(Number))
  // No hidden id (Review Focus 2), and every visible id has exactly one record (Review Focus 1).
  expect(new Set(Object.keys(m.cards).map(Number))).toEqual(visible)
  const listed: number[] = [...m.hand, ...m.seats.flatMap((s) => [...s.forwards, ...s.backups, ...s.lbDeck, ...s.knownHand, ...s.breakZone, ...s.damageZone, ...s.removedFromGame])]
  expect(new Set(listed).size).toBe(listed.length)
  for (const id of listed) expect(m.cards[id]?.zone).not.toBe('elsewhere')
  for (const p of [0, 1] as const) {
    const f = v.fields[p]
    const seat = m.seats[p]
    expect(seat.forwards).toEqual(f.forwards.map((c) => c.id))
    expect(seat.backups).toEqual(f.backups.map((c) => c.id))
    expect(seat.lbDeck).toEqual(f.lbDeck.map((x) => x.id))
    expect(seat.knownHand).toEqual(f.knownHand)
    expect(seat.breakZone).toEqual(f.breakZone)
    expect(seat.damageZone).toEqual(f.damageZone)
    expect(seat.removedFromGame).toEqual(f.removedFromGame)
    expect(seat.deckCount).toBe(f.deck.length)
    expect(seat.handCount).toBe(p === v.me ? v.hand.length : f.handCount)
    for (const x of f.lbDeck) expect(m.cards[x.id]?.lbFaceUp, 'LB face (Review Focus 5)').toBe(x.faceUp)
    for (const id of f.knownHand) expect(m.cards[id]).toMatchObject({ side: AI, zone: 'knownHand' })
  }
  expect(m.hand).toEqual(v.hand)
}

describe('project (spec section 4.1)', () => {
  it('projects the opening position', () => {
    const v = viewFor(game(1), HUMAN)
    const m = project(v)
    expectWellFormed(v, m)
    expect(m.turn).toBe(v.turn)
    expect(m.phase).toBe(v.phase)
    expect(m.result).toBeNull()
  })

  it('holds the invariants, the names and the layered power over a self-play corpus (Review Focus 1-5)', () => {
    let positions = 0
    // What the corpus must reach, or the assertions below prove nothing about it (plan review finding 2).
    const saw = { pumped: false, knownHand: false, lbFaceUp: false, elsewhere: false, breakZone: false, damageZone: false, stack: false }
    for (const seed of [1, 2, 3, 4]) {
      for (const v of views(seed)) {
        const m = project(v)
        expectWellFormed(v, m)
        const shim = stateShim(v)
        for (const [id, rec] of Object.entries(m.cards)) expect(rec.face.name, `name of ${id}`).toBe(displayName(v, Number(id)))
        for (const p of [0, 1] as const) {
          for (const c of [...v.fields[p].forwards, ...v.fields[p].backups]) {
            const shown = fieldCardDisplay(v, c, shim)
            expect(m.cards[c.id]?.face).toMatchObject({ power: shown.power, powerBonus: shown.powerBonus, damage: c.damage, dull: c.status === 'dull', frozen: c.frozen === true })
            expect(m.cards[c.id]?.face.granted).toEqual(shown.granted)
            expect(m.cards[c.id]?.face.flags).toEqual(shown.flags)
          }
        }
        expect(m.active).toEqual([v.priority === HUMAN || v.pending?.player === HUMAN, v.priority === AI || v.pending?.player === AI])
        expect(m.stack.map((e) => e.card)).toEqual(v.stack.map((i) => (i.kind === 'summon' ? i.card : i.frame.source)))
        expect(new Set(m.stack.map((e) => e.key)).size).toBe(m.stack.length)
        expect(m).toMatchObject({ turnPlayer: v.turnPlayer, priority: v.priority, pending: v.pending ? { kind: v.pending.kind, player: v.pending.player } : null })
        const recs = Object.values(m.cards)
        if (recs.some((r) => (r.face.powerBonus ?? 0) !== 0)) saw.pumped = true
        if (recs.some((r) => r.zone === 'knownHand')) saw.knownHand = true
        if (recs.some((r) => r.lbFaceUp === true)) saw.lbFaceUp = true
        if (recs.some((r) => r.zone === 'elsewhere')) saw.elsewhere = true
        if (recs.some((r) => r.zone === 'breakZone')) saw.breakZone = true
        if (recs.some((r) => r.zone === 'damageZone')) saw.damageZone = true
        if (m.stack.length > 0) saw.stack = true
        positions++
      }
    }
    expect(positions).toBeGreaterThan(200)
    for (const [what, reached] of Object.entries(saw)) expect(reached, `the corpus never reached: ${what}`).toBe(true)
  }, 30_000)
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run apps/web/test/board-model.test.ts`
Expected: FAIL — `../src/game/presentation/boardModel.js` does not resolve.

- [ ] **Step 3: Implement** — `apps/web/src/game/presentation/boardModel.ts`

```ts
import type { AttackStep, CardId, CardType, Element, FieldCard, FieldFlag, GameResult, Keyword, Pending, Phase, PlayerId, PlayerView } from '@fftcg/engine'
import { displayName, fieldCardDisplay, stackItemLabel, stateShim } from '../commands.js'

/**
 * The render projection (UI overhaul spec section 4.1): a flat model of everything the board SHOWS, computed from a
 * complete `PlayerView`. The board draws its zones and seats from this; U3's director diffs two of them, one per side of
 * an apply, and releases the differences beat by beat.
 *
 * Why a model and not the view: several displayed values are COMPUTED — a Forward's power runs the continuous-effect
 * layer over the whole field through `stateShim`, and a name's occurrence marker ("Luso (2)") counts copies across
 * zones. Both are correct only on a complete, real view; on a half-applied one they are wrong or throw. So every such
 * value is computed here, once, and a record never needs another record to render.
 *
 * Only what the human's view carries: an id the view does not carry never appears (ids follow decklist order, so a
 * hidden id would name the card).
 */
export type ZoneKey = 'hand' | 'forwards' | 'backups' | 'lbDeck' | 'knownHand' | 'breakZone' | 'damageZone' | 'removedFromGame' | 'elsewhere'

/** The display half of `CardProps`: everything a card SHOWS, nothing about what pressing it does. */
export interface CardFace {
  code: string; name: string; cost: number; elements: Element[]; type: CardType; power: number | null
  powerBonus?: number; granted?: readonly Keyword[]; flags?: readonly FieldFlag[]
  damage?: number; dull?: boolean; frozen?: boolean; text?: string
}

export interface CardModel {
  id: CardId
  /** Whose side of the table the card is on (the owner for a card in no zone). */
  side: PlayerId
  zone: ZoneKey
  /** Position in its zone; 0 for `elsewhere`. */
  index: number
  face: CardFace
  /** Only for a card in an LB deck: turned face up (spent) or not. From the zone, never from `view.cards`. */
  lbFaceUp?: boolean
}

export interface SeatModel {
  deckCount: number
  handCount: number
  forwards: CardId[]
  backups: CardId[]
  lbDeck: CardId[]
  knownHand: CardId[]
  breakZone: CardId[]
  damageZone: CardId[]
  removedFromGame: CardId[]
}

/**
 * One stack entry (spec section 4.3), keyed so U3 can diff the stack as inserts and removes: a Summon by its card, an
 * ability by source and clause, with an occurrence count for the rare same ability twice. Bottom first.
 */
export interface StackEntryModel {
  key: string
  kind: 'summon' | 'ability'
  /** The Summon card, or the ability's source. */
  card: CardId
  controller: PlayerId
  label: string
}

export interface BoardModel {
  cards: Record<CardId, CardModel>
  hand: CardId[]
  seats: [SeatModel, SeatModel]
  stack: StackEntryModel[]
  /** Whose seat is highlighted: holds priority or owes the pending decision. */
  active: [boolean, boolean]
  turn: number
  turnPlayer: PlayerId
  phase: Phase
  attackStep: AttackStep | null
  priority: PlayerId
  pending: { kind: Pending['kind']; player: PlayerId } | null
  result: GameResult | null
}

const SEATS = [0, 1] as const

/** The face every card that is not on the field shows: its printing, named as the view names it. */
function printedFace(v: PlayerView, id: CardId): CardFace {
  const inst = v.cards[id]
  const d = inst ? v.defs[inst.code] : undefined
  return {
    code: d?.code ?? '?', name: displayName(v, id), cost: d?.cost ?? 0, elements: d?.elements ?? [], type: d?.type ?? 'forward',
    power: d?.power ?? null,
    ...(d?.text === undefined ? {} : { text: d.text }),
  }
}

/** A field card's face: layered power, keywords and flags through the engine's readers, and its board state. */
function fieldFace(v: PlayerView, c: FieldCard, shim: ReturnType<typeof stateShim>): CardFace {
  const shown = fieldCardDisplay(v, c, shim)
  return {
    ...printedFace(v, c.id),
    power: shown.power, powerBonus: shown.powerBonus, granted: shown.granted, flags: shown.flags,
    damage: c.damage, dull: c.status === 'dull', frozen: c.frozen === true,
  }
}

export function project(v: PlayerView): BoardModel {
  // One shim for every field card — the engine's readers want a GameState, built once from the whole view.
  const shim = stateShim(v)
  const cards: Record<CardId, CardModel> = {}
  const put = (id: CardId, side: PlayerId, zone: ZoneKey, index: number, face: CardFace, extra: Partial<CardModel> = {}): void => {
    cards[id] = { id, side, zone, index, face, ...extra }
  }
  v.hand.forEach((id, i) => put(id, v.me, 'hand', i, printedFace(v, id)))
  const seats = SEATS.map((p): SeatModel => {
    const f = v.fields[p]
    f.forwards.forEach((c, i) => put(c.id, p, 'forwards', i, fieldFace(v, c, shim)))
    f.backups.forEach((c, i) => put(c.id, p, 'backups', i, fieldFace(v, c, shim)))
    f.lbDeck.forEach((x, i) => put(x.id, p, 'lbDeck', i, printedFace(v, x.id), { lbFaceUp: x.faceUp }))
    f.knownHand.forEach((id, i) => put(id, p, 'knownHand', i, printedFace(v, id)))
    f.breakZone.forEach((id, i) => put(id, p, 'breakZone', i, printedFace(v, id)))
    f.damageZone.forEach((id, i) => put(id, p, 'damageZone', i, printedFace(v, id)))
    f.removedFromGame.forEach((id, i) => put(id, p, 'removedFromGame', i, printedFace(v, id)))
    return {
      deckCount: f.deck.length, handCount: p === v.me ? v.hand.length : f.handCount,
      forwards: f.forwards.map((c) => c.id), backups: f.backups.map((c) => c.id), lbDeck: f.lbDeck.map((x) => x.id),
      knownHand: [...f.knownHand], breakZone: [...f.breakZone], damageZone: [...f.damageZone], removedFromGame: [...f.removedFromGame],
    }
  }) as [SeatModel, SeatModel]
  // Every other card the view carries — a revealed deck card, a Summon on the stack, a pending candidate — so the
  // orphan row and the sheet can still draw it (Review Focus 1).
  for (const key of Object.keys(v.cards)) {
    const id = Number(key) as CardId
    const inst = v.cards[id]
    if (cards[id] === undefined && inst) put(id, inst.owner, 'elsewhere', 0, printedFace(v, id))
  }
  const owes = (p: PlayerId): boolean => v.priority === p || v.pending?.player === p
  const seen = new Map<string, number>()
  const stack = v.stack.map((item): StackEntryModel => {
    const card = item.kind === 'summon' ? item.card : item.frame.source
    const controller = item.kind === 'summon' ? item.controller : item.frame.controller
    const base = item.kind === 'summon' ? `s:${card}` : `a:${card}:${item.frame.abilityId}`
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    return { key: n === 0 ? base : `${base}#${n}`, kind: item.kind, card, controller, label: stackItemLabel(v, item) }
  })
  return {
    cards, hand: [...v.hand], seats, stack, active: [owes(0), owes(1)],
    turn: v.turn, turnPlayer: v.turnPlayer, phase: v.phase, attackStep: v.attack?.step ?? null,
    priority: v.priority, pending: v.pending ? { kind: v.pending.kind, player: v.pending.player } : null, result: v.result,
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm vitest run apps/web/test/board-model.test.ts`
Expected: PASS (2 tests), with more than 200 positions checked.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/game/presentation/boardModel.ts apps/web/test/board-model.test.ts
git commit -m "feat(web): the render projection — project(view) → BoardModel (U2a)"
```

---

### Task 2: the Board renders its zones and seats from the model

**Files:**
- Modify: `apps/web/src/ui/Board.tsx`

**Interfaces:**
- Consumes: `project`, `BoardModel`, `CardFace` (Task 1).
- Produces: no new exports. `boardCardIds`, `orphanTargetIds`, `clickableChoices` keep their signatures (tests import them).

- [ ] **Step 1: Pin the Board's markup before touching it** (plan review finding 1: no committed test pins the Board's
  DOM, and the gallery screenshots cards, not the Board). Create a THROWAWAY test,
  `apps/web/test/zz-board-markup.test.tsx`, that walks the Task 1 corpus (seeds 1–4), builds the human's choices for
  each position with `buildChoiceSet(view, preferredChoices(view, legal), paymentAlternatives(legal), capped)` from
  `legalCommandsWithMeta(state, HUMAN)` (as `useGame` does), renders
  `<Board game={{ view, choices, log: [], aiThinking: actingPlayer(state) === AI, choose: () => {}, restart: () => {} }} />`
  with `renderToStaticMarkup`, and — when `process.env.U2A_MARKUP === 'write'` — writes the array of HTML strings to
  `$WS/board-markup.json`; otherwise reads that file and asserts each position's HTML is byte-equal. Run it once in write
  mode BEFORE Step 2:

Run: `U2A_MARKUP=write pnpm vitest run apps/web/test/zz-board-markup.test.tsx`
Expected: PASS, and `board-markup.json` holds one entry per corpus position.

Also record the web suite's count: `pnpm vitest run --project @fftcg/web > "$WS/before.txt" 2>&1; grep -E "Tests " "$WS/before.txt"`.

- [ ] **Step 2: Implement** — in `Board.tsx`:

1. Import `project` and `type CardFace` from `'../game/presentation/boardModel.js'`.
2. In `Board`, after `const shim = …`, add `const model = useMemo(() => project(view), [view])` and a helper:

```ts
  /** A card's display props from the model — `size` and every interaction prop are the caller's. */
  const faceOf = (id: CardId): CardFace => model.cards[id]?.face ?? { code: '?', name: displayName(view, id), cost: 0, elements: [], type: 'forward', power: null }
```

3. `field(p, kind)`: iterate `model.seats[p][kind]` and build props as
   `{ ...faceOf(id), actionable: glows(id), size: kind === 'backups' ? 'small' : 'field', ...action/paying/chosen as today }`.
4. `pileItems(p, kind)`: `model.seats[p][kind].map((id) => gridItem(id, { ...faceOf(id), actionable: false, size: 'small' }))`.
5. `knownHandItems()`: `model.seats[AI].knownHand.map((id) => gridItem(id, { ...faceOf(id), actionable: false, size: 'small' }, { selected: sheet === id }))`.
6. `lbItems(p)`: `model.seats[p].lbDeck.map((id) => gridItem(id, { ...faceOf(id), actionable: glows(id), size: 'small', lb: model.cards[id]?.lbFaceUp ? 'up' : 'down', …action/paying as today }, { selected: sheet === id }))`.
7. The hand: `model.hand.map((id) => gridItem(id, { ...faceOf(id), actionable: glows(id), size: 'hand', …as today }, …))`.
8. `orphanCards`: `{ ...faceOf(id), actionable: true, size: 'small', …action as today }`.
9. `sheetProps(id)`: `face` is `{ ...faceOf(id), actionable: false, size: 'field' }` for a card on the field
   (`model.cards[id]?.zone === 'forwards' || … 'backups'`), and `faceOf(id)` otherwise; `d` (the def, for the sheet's text)
   stays `defOf(view, id)`.
10. `Seat`: pass `seat={model.seats[p]}` and `active={model.active[p]}`; inside, read `deckCount`, `handCount`,
    `breakZone.length`, `damageZone.length`, `removedFromGame.length` from `seat` instead of `v.fields[p]`/`v.hand`.
11. Delete `fieldCardProps`, the now-unused `shim` in `Board`, and the imports that only they used (`fieldCardDisplay`,
    `stateShim`, `FieldCard`, `GameState`) — `eslint`'s `no-unused-vars` is an error here.

Each rendered `<Card>` receives the same props by value (key order may differ; `Card` destructures, so it cannot
tell).

- [ ] **Step 3: Prove the output is identical**

Run: `pnpm vitest run apps/web/test/zz-board-markup.test.tsx`
Expected: PASS — every corpus position renders byte-identical markup. Then delete `zz-board-markup.test.tsx` (it is a
one-off proof, not a permanent test).

Run: `pnpm vitest run --project @fftcg/web > "$WS/after.txt" 2>&1; grep -E "Tests " "$WS/after.txt"`
Expected: the same count as Step 1, same failures only (the known load timeout, which passes alone).

Run: `pnpm test:browser`
Expected: every spec passes, and `fixtures.spec.ts` matches its baseline without `--update-snapshots`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/ui/Board.tsx
git commit -m "refactor(web): the Board draws its zones and seats from the BoardModel (U2a)"
```

---

### Task 3: the split, as built, and the gate

- [ ] **Step 1:** In the spec, add to `## Decisions`:
  `- **D32 — U2 is three rungs.** U2a: the projection, with no visible change. U2b: the layout. U2c: the log drawer,
  the hover preview and the settings popover. One rung was a data-model refactor, a layout rewrite and three new
  components at once; each part now ships and is reviewed on its own.`
  and replace the U2 row of the ladder with three rows (U2a, U2b, U2c) carrying the scope split above.
- [ ] **Step 2:** Add a **U2a** entry to `## As built`.
- [ ] **Step 3:** Run `pnpm typecheck && pnpm lint && pnpm test && pnpm test:browser`. Expected: green bar the known
  load timeout.
- [ ] **Step 4:** Commit: `git add docs/superpowers/specs/2026-09-30-ui-overhaul-design.md && git commit -m "docs: U2 split into U2a/U2b/U2c; U2a as built"`.
