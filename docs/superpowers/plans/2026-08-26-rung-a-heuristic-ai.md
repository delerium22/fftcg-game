# Rung A "Heuristic AI" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deterministic, fair (view-only), greedy-lookahead AI opponent (`GreedyAgent`) that beats `RandomAgent` ≥ 80 % over 200 seeded self-play games on the Vol. 2 pool, with a reusable evaluation function and determinisation utility for the later ISMCTS rung.

**Architecture:** `determinise(view, decks, rng)` (engine) rebuilds a full `GameState` consistent with a `PlayerView` by sampling hidden zones from the unseen multiset of each player's known deck list. `evaluate(state, me, weights)` (ai) scores a state as one scalar. `candidateCommands(state, player)` (ai) builds a small move list without enumerating CP-payment permutations (`preferredPayment` picks one payment per castable card). `GreedyAgent` simulates each candidate on the determinised state, plays the rest of the turn out with the same greedy policy (depth 1; depth 2 adds the opponent's greedy turn), and picks the best score. The CLI self-play harness gains per-seat agent selection and timing so strength is measured, not assumed.

**Tech Stack:** TypeScript 5 strict, pnpm 11 workspaces, Vitest 3, `tsx`. `packages/engine` keeps zero runtime deps; `packages/ai` depends only on `@fftcg/engine`.

**Spec:** `docs/superpowers/specs/2026-08-26-heuristic-ai-design.md`

## Global Constraints

- The agent never sees `GameState`; `decide(view, legal)` plus the two deck lists given at construction are its only inputs. Hidden zones are sampled with the agent's own seeded `Rng` (never `Math.random`).
- `determinise` output must pass `checkInvariants`, preserve every visible card id/zone from the view, and conserve each player's deck-list multiset (visible codes + sampled hidden codes == deck list).
- CP payments are never enumerated by the AI: one `preferredPayment` per castable card. `apply` accepts it because it validates semantically.
- Deterministic: same seed ⇒ same decisions (tested). No `Date`/timers inside decision logic; time budgets are enforced by the simulation cap (`maxSimulations`), not the clock.
- `GreedyAgent` never returns `concede` while any other legal command exists.
- Every commit green: `pnpm test && pnpm typecheck && pnpm lint`, pristine; commit messages `type(scope): summary` ending with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. Relative imports use `.js`; `exactOptionalPropertyTypes`/`noUncheckedIndexedAccess` are on; tests may use `let s; [s, x] = ...`.
- Engine API used as-is (all exported from `@fftcg/engine`): `GameState`, `PlayerState`, `FieldCard`, `PlayerView`, `FieldView`, `CardId`, `PlayerId`, `CardDef`, `Element`, `Command`, `Payment`, `Rng`, `seedRng`, `nextInt`, `shuffle`, `apply`, `legalCommands`, `actingPlayer`, `castCheck`, `canPay`, `generateCp`, `legalAttackSets`, `legalBlockers`, `legalPartyDamageAssignments`, `checkInvariants`, `createGame`, `viewFor`, `defOf`, `powerOf`, `opponentOf`, `HAND_SIZE_LIMIT`, `MAX_BACKUPS`, `DAMAGE_TO_LOSE`, `IllegalCommandError`.
- Test helpers live in `packages/engine/test/helpers.ts` (`makeGame`, `withField`, `withHand`, `withHandSize`, `VANILLA_POOL`, `DEFAULT_DECK`, `makeDef`); `packages/ai` tests may import them by relative path `../../engine/test/helpers.js` (add `"../engine/test"` to `packages/ai/tsconfig.json` `include` only if typecheck complains; Vitest resolves it regardless).

## File Structure

```
packages/engine/src/view.ts            + firstPlayer, mulliganDecided on PlayerView (public info the AI needs to determinise setup states)
packages/engine/src/determinise.ts     determinise(view, decks, rng): GameState
packages/engine/src/index.ts           + export * from './determinise.js'
packages/engine/test/determinise.test.ts
packages/ai/src/cardValue.ts           cardValue(def): number
packages/ai/src/evaluate.ts            Weights, DEFAULT_WEIGHTS, evaluate(state, me, weights?, aggression?)
packages/ai/src/payment.ts             preferredPayment(state, player, card): Payment | null
packages/ai/src/candidates.ts          candidateCommands(state, player): Command[]
packages/ai/src/greedy.ts              GreedyAgent, GreedyOptions, greedyPolicy (rollout)
packages/ai/src/index.ts               re-exports
packages/ai/test/{cardValue,evaluate,payment,candidates,greedy}.test.ts
apps/cli/src/agents.ts                 AgentSpec, makeAgent(spec, seat, decks)
apps/cli/src/selfplay.ts               agents per seat, strict flag, msPerDecision
apps/cli/src/main.ts                   --p0 --p1 --depth flags
apps/cli/test/selfplay.test.ts         + greedy-vs-random strength test
docs/superpowers/specs/2026-08-26-heuristic-ai-design.md   + appendix: measured win rates and final weights
```

---

### Task 1: Engine — public setup info on `PlayerView` and `determinise()`

**Files:**
- Modify: `packages/engine/src/view.ts`, `packages/engine/src/index.ts`
- Create: `packages/engine/src/determinise.ts`
- Test: `packages/engine/test/determinise.test.ts`, update `packages/engine/test/cr7.6-view.test.ts` (one assertion)

**Interfaces:**
- Produces:
```ts
// view.ts — add two public fields (both are public information at the table)
export interface PlayerView { …existing…; firstPlayer: PlayerId; mulliganDecided: [boolean, boolean] }

// determinise.ts
export interface DeterminiseOptions { view: PlayerView; decks: [string[], string[]]; rng: Rng }
/** Rebuild a full GameState consistent with `view`: visible cards keep their ids; the opponent's hand and both decks are sampled from each player's unseen deck-list multiset. Returns the state and the advanced rng. */
export function determinise(opts: DeterminiseOptions): [GameState, Rng]
export const SYNTHETIC_ID_BASE = 100_000
```
Rules: for each player `p`, `unseen = multiset(decks[p]) − codes of p's cards visible in the view` (forwards, backups, damageZone, breakZone; plus `view.hand` when `p === view.me`). For the opponent: shuffle `unseen`, take `handCount` as hand, the rest is the deck (must have length `deckCount`, else throw). For me: `unseen` shuffled is my deck (length must equal `deckCount`). Synthetic ids start at `SYNTHETIC_ID_BASE` and increase; `cards` map = view.cards + synthetic instances. `rng` of the returned state = the advanced rng. `pending`, `attack`, `phase`, `turn`, `turnPlayer`, `priority`, `result`, `firstPlayer`, `mulliganDecided` copied from the view. Throws `Error` (not IllegalCommandError) on any count mismatch — a mismatch means the caller's deck lists are wrong.

- [ ] **Step 1: Failing tests**

`packages/engine/test/determinise.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { createGame } from '../src/setup.js'
import { apply } from '../src/apply.js'
import { actingPlayer, legalCommands } from '../src/legal.js'
import { checkInvariants } from '../src/invariants.js'
import { viewFor } from '../src/view.js'
import { determinise, SYNTHETIC_ID_BASE } from '../src/determinise.js'
import { nextInt, seedRng } from '../src/rng.js'
import type { GameState, PlayerId } from '../src/index.js'
import { DEFAULT_DECK, VANILLA_POOL, makeGame } from './helpers.js'

const DECKS: [string[], string[]] = [DEFAULT_DECK, DEFAULT_DECK]

function codesOf(s: GameState, p: PlayerId): string[] {
  const q = s.players[p]
  return [...q.deck, ...q.hand, ...q.forwards.map((c) => c.id), ...q.backups.map((c) => c.id), ...q.damageZone, ...q.breakZone].map((id) => s.cards[id]!.code).sort()
}

/** random-walk `n` steps from setup and return the state */
function walk(seed: number, n: number): GameState {
  let s = createGame({ seed, decks: DECKS, defs: VANILLA_POOL })
  let rng = seedRng(seed * 13)
  for (let i = 0; i < n && !s.result; i++) {
    const p = actingPlayer(s)!
    const cmds = legalCommands(s, p).filter((c) => c.type !== 'concede')
    const [k, r] = nextInt(rng, cmds.length); rng = r
    s = apply(s, cmds[k]!).state
  }
  return s
}

describe('determinise', () => {
  it('preserves everything visible and conserves each deck list', () => {
    const s = walk(5, 120)
    for (const me of [0, 1] as const) {
      const view = viewFor(s, me)
      const [det] = determinise({ view, decks: DECKS, rng: seedRng(1) })
      expect(checkInvariants(det)).toEqual([])
      expect(det.players[me].hand).toEqual(s.players[me].hand)
      for (const p of [0, 1] as const) {
        expect(det.players[p].forwards).toEqual(s.players[p].forwards)
        expect(det.players[p].backups).toEqual(s.players[p].backups)
        expect(det.players[p].damageZone).toEqual(s.players[p].damageZone)
        expect(det.players[p].breakZone).toEqual(s.players[p].breakZone)
        expect(det.players[p].deck).toHaveLength(s.players[p].deck.length)
        expect(det.players[p].hand).toHaveLength(s.players[p].hand.length)
        expect(codesOf(det, p)).toEqual([...DEFAULT_DECK].sort())   // multiset conservation
      }
      const opp = me === 0 ? 1 : 0
      for (const id of [...det.players[opp].hand, ...det.players[0].deck, ...det.players[1].deck]) expect(id).toBeGreaterThanOrEqual(SYNTHETIC_ID_BASE)
      expect(viewFor(det, me).fields).toEqual(view.fields)
      expect({ ...viewFor(det, me), cards: null }).toEqual({ ...view, cards: null })
    }
  })
  it('is deterministic per rng and differs across rngs', () => {
    const view = viewFor(walk(9, 80), 0)
    const [a] = determinise({ view, decks: DECKS, rng: seedRng(3) })
    const [b] = determinise({ view, decks: DECKS, rng: seedRng(3) })
    const [c] = determinise({ view, decks: DECKS, rng: seedRng(4) })
    expect(a).toEqual(b)
    expect(a.players[1].hand.map((id) => a.cards[id]!.code)).not.toEqual(c.players[1].hand.map((id) => c.cards[id]!.code))
  })
  it('works from setup states (chooseFirst pending; mulligan pending) and mid-attack (declareBlock pending)', () => {
    const s0 = createGame({ seed: 2, decks: DECKS, defs: VANILLA_POOL })
    const [d0] = determinise({ view: viewFor(s0, 1), decks: DECKS, rng: seedRng(1) })
    expect(checkInvariants(d0)).toEqual([]); expect(d0.pending).toEqual(s0.pending); expect(d0.players[1].deck).toHaveLength(50)
    const s1 = walk(2, 1)   // after chooseFirst → mulligan pending, 5 cards each
    const [d1] = determinise({ view: viewFor(s1, 0), decks: DECKS, rng: seedRng(1) })
    expect(d1.mulliganDecided).toEqual(s1.mulliganDecided); expect(d1.firstPlayer).toBe(s1.firstPlayer)
    expect(d1.players[1].hand).toHaveLength(5)
    // mid-attack: find a walk state with declareBlock pending
    let s2: GameState | null = null
    for (let seed = 1; seed < 40 && !s2; seed++) for (let n = 5; n < 200 && !s2; n += 7) { const t = walk(seed, n); if (t.pending?.kind === 'declareBlock') s2 = t }
    expect(s2).not.toBeNull()
    const [d2] = determinise({ view: viewFor(s2!, s2!.pending!.player), decks: DECKS, rng: seedRng(1) })
    expect(d2.attack).toEqual(s2!.attack); expect(checkInvariants(d2)).toEqual([])
  })
  it('throws when the deck lists do not match what is visible', () => {
    const view = viewFor(makeGame(), 0)
    expect(() => determinise({ view, decks: [DEFAULT_DECK.slice(0, 49), DEFAULT_DECK], rng: seedRng(1) })).toThrow(/deck list/)
  })
})
```
Add to `cr7.6-view.test.ts`'s first test: `expect(v.firstPlayer).toBe(s.firstPlayer); expect(v.mulliganDecided).toEqual([true, true])`.

- [ ] **Step 2: Run to verify failure** — `pnpm vitest run packages/engine` → determinise tests FAIL (module missing), view test FAIL (fields missing).

- [ ] **Step 3: Implement**

`view.ts`: add `firstPlayer: state.firstPlayer, mulliganDecided: [state.players[0].mulliganDecided, state.players[1].mulliganDecided]` to the interface and the returned object.

`determinise.ts`:
```ts
import type { PlayerId } from './types.js'
import type { CardId, CardInstance, GameState, PlayerState } from './state.js'
import type { PlayerView } from './view.js'
import { shuffle, type Rng } from './rng.js'

export const SYNTHETIC_ID_BASE = 100_000
export interface DeterminiseOptions { view: PlayerView; decks: [string[], string[]]; rng: Rng }

function removeVisible(multiset: string[], codes: string[], p: PlayerId): string[] {
  const left = [...multiset]
  for (const code of codes) {
    const i = left.indexOf(code)
    if (i < 0) throw new Error(`deck list for player ${p} does not contain visible card ${code}`)
    left.splice(i, 1)
  }
  return left
}

export function determinise({ view, decks, rng }: DeterminiseOptions): [GameState, Rng] {
  const cards: Record<CardId, CardInstance> = { ...view.cards }
  let nextId = SYNTHETIC_ID_BASE
  let r = rng
  const players: PlayerState[] = []
  for (const p of [0, 1] as const) {
    const f = view.fields[p]
    const visibleIds = [...f.forwards.map((c) => c.id), ...f.backups.map((c) => c.id), ...f.damageZone, ...f.breakZone, ...(p === view.me ? view.hand : [])]
    const visibleCodes = visibleIds.map((id) => { const c = view.cards[id]; if (!c) throw new Error(`view lacks visible card ${id}`); return c.code })
    const unseen = removeVisible(decks[p], visibleCodes, p)
    const [order, r2] = shuffle(r, unseen); r = r2
    const mint = (code: string): CardId => { const id = nextId++; cards[id] = { id, code, owner: p }; return id }
    let hand: CardId[]
    let deck: CardId[]
    if (p === view.me) { hand = view.hand; deck = order.map(mint) }
    else { hand = order.slice(0, f.handCount).map(mint); deck = order.slice(f.handCount).map(mint) }
    if (deck.length !== f.deckCount || hand.length !== f.handCount) throw new Error(`deck list for player ${p} is inconsistent with the view (unseen ${unseen.length}, expected hand ${f.handCount} + deck ${f.deckCount})`)
    players.push({ deck, hand, forwards: f.forwards, backups: f.backups, damageZone: f.damageZone, breakZone: f.breakZone, mulliganDecided: view.mulliganDecided[p] })
  }
  const state: GameState = {
    rng: r, turn: view.turn, turnPlayer: view.turnPlayer, firstPlayer: view.firstPlayer, phase: view.phase, attack: view.attack,
    priority: view.priority, pending: view.pending, players: [players[0]!, players[1]!], cards, defs: view.defs, result: view.result,
  }
  return [structuredClone(state), r]
}
```
`index.ts`: add `export * from './determinise.js'`.

- [ ] **Step 4: Run everything** — `pnpm test && pnpm typecheck && pnpm lint` green. Also `apps/cli` tests still pass (render test uses the view).
- [ ] **Step 5: Commit** `feat(engine): determinise a PlayerView into a full state; expose setup info on views`.

---

### Task 2: AI — `cardValue` and `evaluate`

**Files:**
- Create: `packages/ai/src/cardValue.ts`, `packages/ai/src/evaluate.ts`
- Test: `packages/ai/test/cardValue.test.ts`, `packages/ai/test/evaluate.test.ts`

**Interfaces:**
```ts
// cardValue.ts — how much a card in hand is worth (for discard/payment choices); pure function of the def
export function cardValue(def: CardDef): number
//   forward: power/1000 + 1.5; backup: 3 (CP engine) − 0.25·cost; summon: 1 + cost·0.25 (no effect yet, cheap fodder); monster: 1. Cost ≥ 5 forwards +0.5 (win conditions).

// evaluate.ts
export interface Weights { damage: number; forwardPower: number; forwardPresence: number; dullFactor: number; backup: number; hand: number; deck: number; threat: number; terminal: number }
export const DEFAULT_WEIGHTS: Weights = { damage: 30, forwardPower: 1.2, forwardPresence: 4, dullFactor: 0.6, backup: 5, hand: 2, deck: 0.1, threat: 0.8, terminal: 100_000 }
/** Zero-sum board evaluation from `me`'s perspective. aggression ∈ [0,1] scales how much the opponent's material counts vs mine (0.5 = symmetric). */
export function evaluate(state: GameState, me: PlayerId, weights?: Weights, aggression?: number): number
```
Feature definitions (per player `p`, then `mine − opp` with opponent terms scaled by `2·aggression`, mine by `2·(1−aggression)`):
- `damage`: `(DAMAGE_TO_LOSE − damageZone.length) · w.damage`
- `board`: Σ over forwards of `(powerOf/1000 · w.forwardPower · (status === 'dull' ? w.dullFactor : 1)) + w.forwardPresence`
- `backups`: `min(backups.length, MAX_BACKUPS) · w.backup`
- `hand`: `min(hand.length, HAND_SIZE_LIMIT) · w.hand + max(0, hand.length − HAND_SIZE_LIMIT) · w.hand · 0.25`
- `deck`: `deck.length · w.deck`
- `threat` (opponent-only, subtracted from mine): `max(0, Σ opp active forward power/1000 − Σ my active forward power/1000) · w.threat`
- Terminal: `result.winner === me → +w.terminal`, `=== opp → −w.terminal`, draw → 0 (overrides everything).

- [ ] **Step 1: Failing tests**

`packages/ai/test/evaluate.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { DEFAULT_WEIGHTS, evaluate } from '../src/evaluate.js'
import { makeGame, withField } from '../../engine/test/helpers.js'

describe('evaluate', () => {
  it('is zero-sum and symmetric on an empty symmetric board', () => {
    const s = makeGame()   // P0 has 6 cards vs 5 — tiny asymmetry; compare both perspectives sum to 0
    expect(evaluate(s, 0) + evaluate(s, 1)).toBeCloseTo(0, 6)
  })
  it('more own damage is worse; more own board is better; dull forwards count less', () => {
    let s = makeGame(); let f: number
    const base = evaluate(s, 0)
    const hurt = { ...s, players: [{ ...s.players[0], damageZone: s.players[0].deck.slice(0, 2), deck: s.players[0].deck.slice(2) }, s.players[1]] as typeof s.players }
    expect(evaluate(hurt, 0)).toBeLessThan(base)
    ;[s, f] = withField(s, 0, 'forwards', 'V-F3')
    expect(evaluate(s, 0)).toBeGreaterThan(base)
    const dulled = { ...s, players: [{ ...s.players[0], forwards: s.players[0].forwards.map((c) => (c.id === f ? { ...c, status: 'dull' as const } : c)) }, s.players[1]] as typeof s.players }
    expect(evaluate(dulled, 0)).toBeLessThan(evaluate(s, 0))
  })
  it('terminal states dominate', () => {
    const s = makeGame()
    expect(evaluate({ ...s, result: { winner: 0, reason: 'x' } }, 0)).toBe(DEFAULT_WEIGHTS.terminal)
    expect(evaluate({ ...s, result: { winner: 1, reason: 'x' } }, 0)).toBe(-DEFAULT_WEIGHTS.terminal)
    expect(evaluate({ ...s, result: { winner: null, reason: 'x' } }, 0)).toBe(0)
  })
  it('aggression 1 ignores my own material, aggression 0 ignores the opponent\'s', () => {
    let s = makeGame(); [s] = withField(s, 0, 'forwards', 'V-F3'); [s] = withField(s, 1, 'forwards', 'V-F3')
    const mineOnly = evaluate(s, 0, DEFAULT_WEIGHTS, 0)
    const oppOnly = evaluate(s, 0, DEFAULT_WEIGHTS, 1)
    expect(mineOnly).toBeGreaterThan(0); expect(oppOnly).toBeLessThan(0)
  })
})
```
`packages/ai/test/cardValue.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { cardValue } from '../src/cardValue.js'
import { makeDef } from '../../engine/test/helpers.js'

describe('cardValue', () => {
  it('ranks a big forward above a small one, a backup above a summon, and a summon lowest', () => {
    const big = cardValue(makeDef({ code: 'A', cost: 5, power: 9000 })), small = cardValue(makeDef({ code: 'B', cost: 1, power: 3000 }))
    const backup = cardValue(makeDef({ code: 'C', type: 'backup', cost: 2, power: null })), summon = cardValue(makeDef({ code: 'D', type: 'summon', cost: 2, power: null }))
    expect(big).toBeGreaterThan(small); expect(small).toBeGreaterThan(summon); expect(backup).toBeGreaterThan(summon)
  })
})
```

- [ ] **Step 2: Run to verify failure** → FAIL (modules missing).

- [ ] **Step 3: Implement**

`cardValue.ts`:
```ts
import type { CardDef } from '@fftcg/engine'
export function cardValue(def: CardDef): number {
  switch (def.type) {
    case 'forward': return (def.power ?? 0) / 1000 + 1.5 + (def.cost >= 5 ? 0.5 : 0)
    case 'backup': return 3 - def.cost * 0.25
    case 'summon': return 1 + def.cost * 0.25
    case 'monster': return 1
  }
}
```
`evaluate.ts`:
```ts
import { DAMAGE_TO_LOSE, HAND_SIZE_LIMIT, MAX_BACKUPS, opponentOf, powerOf, type GameState, type PlayerId } from '@fftcg/engine'

export interface Weights { damage: number; forwardPower: number; forwardPresence: number; dullFactor: number; backup: number; hand: number; deck: number; threat: number; terminal: number }
export const DEFAULT_WEIGHTS: Weights = { damage: 30, forwardPower: 1.2, forwardPresence: 4, dullFactor: 0.6, backup: 5, hand: 2, deck: 0.1, threat: 0.8, terminal: 100_000 }

function material(state: GameState, p: PlayerId, w: Weights): number {
  const ps = state.players[p]
  let v = (DAMAGE_TO_LOSE - ps.damageZone.length) * w.damage
  for (const c of ps.forwards) v += (powerOf(state, c) / 1000) * w.forwardPower * (c.status === 'dull' ? w.dullFactor : 1) + w.forwardPresence
  v += Math.min(ps.backups.length, MAX_BACKUPS) * w.backup
  v += Math.min(ps.hand.length, HAND_SIZE_LIMIT) * w.hand + Math.max(0, ps.hand.length - HAND_SIZE_LIMIT) * w.hand * 0.25
  v += ps.deck.length * w.deck
  return v
}
function activePower(state: GameState, p: PlayerId): number {
  return state.players[p].forwards.filter((c) => c.status === 'active').reduce((n, c) => n + powerOf(state, c) / 1000, 0)
}

export function evaluate(state: GameState, me: PlayerId, weights: Weights = DEFAULT_WEIGHTS, aggression = 0.5): number {
  const opp = opponentOf(me)
  if (state.result) return state.result.winner === me ? weights.terminal : state.result.winner === opp ? -weights.terminal : 0
  const mine = material(state, me, weights) * 2 * (1 - aggression)
  const theirs = material(state, opp, weights) * 2 * aggression
  const threat = Math.max(0, activePower(state, opp) - activePower(state, me)) * weights.threat * 2 * aggression
  return mine - theirs - threat
}
```
Note the zero-sum test: with aggression 0.5 both scale factors are 1 and `evaluate(s,0) + evaluate(s,1) = -(threat0 + threat1)`, which is 0 only when neither side out-powers the other — true on the empty board in the test. Keep the test's board empty.

- [ ] **Step 4: Run everything** → green. **Step 5: Commit** `feat(ai): card value and board evaluation`.

---
### Task 3: AI — `preferredPayment` and `candidateCommands`

**Files:**
- Create: `packages/ai/src/payment.ts`, `packages/ai/src/candidates.ts`
- Test: `packages/ai/test/payment.test.ts`, `packages/ai/test/candidates.test.ts`

**Interfaces:**
```ts
// payment.ts
/** One canonical payment for casting `card`: dull matching-element backups first (cheapest), then discard the lowest-value hand cards that supply the still-missing CP. null if unaffordable. Result always satisfies canPay. */
export function preferredPayment(state: GameState, player: PlayerId, card: CardId): Payment | null

// candidates.ts
/** The AI's move list for `player` in `state` — never enumerates payment permutations. Excludes concede. Empty only when the game is over or it is not `player`'s decision. */
export function candidateCommands(state: GameState, player: PlayerId): Command[]
```
`preferredPayment` algorithm: `def = defOf(card)`; `need = def.cost`; if 0 → `{ dullBackups: [], discards: [] }`. Required elements = `def.elements`. Sources: active backups (1 CP each, element = `defOf(backup).elements[0]`), hand cards other than `card` and not Light/Dark (2 CP each; declare one of the card's elements that is still required, else its first element), sorted by resource cost ascending (backup = 1; discard = 2 + `cardValue`). Greedy: first satisfy each required element with the cheapest matching source (backup over discard), then fill the remaining `need` with the cheapest remaining sources; stop as soon as total ≥ need. Verify with `canPay(def.cost, def.elements, generateCp(state, player, payment, card))`; return null if it fails or sources run out.

`candidateCommands` by situation (mirror `legalCommands`' structure but cheaper):
- game over → `[]`; `actingPlayer(state) !== player` → `[]`.
- pending `chooseFirst` → both; `mulligan` → both; `discardToHandSize` → ONE command: discard the `count` lowest-`cardValue` cards; `declareBlock` → `null` + each `legalBlockers`; `assignPartyDamage` → `legalPartyDamageAssignments` (already small).
- `main1`/`main2` → for each hand card with `castCheck === null` and a non-null `preferredPayment`: one cast command (`castSummon` for summons); plus `pass`.
- `attack`/declaration → each `legalAttackSets` + `pass`.

- [ ] **Step 1: Failing tests**

`packages/ai/test/payment.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { canPay, generateCp } from '@fftcg/engine'
import { preferredPayment } from '../src/payment.js'
import { makeGame, withField, withHand, withHandSize } from '../../engine/test/helpers.js'

describe('preferredPayment', () => {
  it('dulls matching backups before discarding, and the result satisfies canPay', () => {
    let s = withHandSize(makeGame(), 0, 0); let b1: number, b2: number, card: number
    ;[s, b1] = withField(s, 0, 'backups', 'V-B1')      // earth
    ;[s, b2] = withField(s, 0, 'backups', 'V-B2')      // lightning
    ;[s] = withHand(s, 0, 'V-F8')                       // lightning 9000 — valuable, must not be discarded
    ;[s, card] = withHand(s, 0, 'V-F2')                 // earth cost 2
    const p = preferredPayment(s, 0, card)!
    expect([...p.dullBackups].sort()).toEqual([b1, b2].sort()); expect(p.discards).toEqual([])
    expect(canPay(2, ['earth'], generateCp(s, 0, p, card))).toBe(true)
  })
  it('discards the lowest-value cards when backups are insufficient, never the card itself', () => {
    let s = withHandSize(makeGame(), 0, 0); let cheap: number, card: number
    ;[s, cheap] = withHand(s, 0, 'V-S2')                 // earth summon cost 1 — low value
    ;[s] = withHand(s, 0, 'V-F7')                        // earth 8000 — high value
    ;[s, card] = withHand(s, 0, 'V-F2')                  // earth cost 2
    const p = preferredPayment(s, 0, card)!
    expect(p.discards.map((d) => d.card)).toEqual([cheap]); expect(p.dullBackups).toEqual([])
  })
  it('satisfies multi-element requirements and returns null when unaffordable', () => {
    let s = withHandSize(makeGame(), 0, 0); let dual: number, poor: number
    ;[s] = withField(s, 0, 'backups', 'V-B1')          // earth
    ;[s] = withHand(s, 0, 'V-F6')                       // lightning 2000 — cheap discard supplies lightning
    ;[s, dual] = withHand(s, 0, 'V-F4')                 // earth/lightning cost 2
    const p = preferredPayment(s, 0, dual)!
    expect(canPay(2, ['earth', 'lightning'], generateCp(s, 0, p, dual))).toBe(true)
    let t = withHandSize(makeGame(), 0, 0)
    ;[t, poor] = withHand(t, 0, 'V-F8')                 // cost 5, nothing to pay with
    expect(preferredPayment(t, 0, poor)).toBeNull()
  })
})
```
`packages/ai/test/candidates.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { apply, legalCommands } from '@fftcg/engine'
import { candidateCommands } from '../src/candidates.js'
import { makeGame, withField, withHand, withHandSize } from '../../engine/test/helpers.js'

describe('candidateCommands', () => {
  it('collapses casts to one per card and never includes concede', () => {
    let s = withHandSize(makeGame(), 0, 0); let f: number
    ;[s] = withField(s, 0, 'backups', 'V-B1'); [s] = withField(s, 0, 'backups', 'V-B3')
    ;[s] = withHand(s, 0, 'V-S2'); [s] = withHand(s, 0, 'V-B4')
    ;[s, f] = withHand(s, 0, 'V-F1')
    const c = candidateCommands(s, 0)
    expect(c.filter((x) => x.type === 'castCharacter' && x.card === f)).toHaveLength(1)
    expect(c.some((x) => x.type === 'concede')).toBe(false)
    expect(c.some((x) => x.type === 'pass')).toBe(true)
    expect(legalCommands(s, 0).filter((x) => x.type === 'castCharacter' && x.card === f).length).toBeGreaterThan(1)   // the point
    for (const x of c) expect(() => apply(s, x)).not.toThrow()   // every candidate is legal
  })
  it('chooses discards by value and mirrors legalCommands for decisions', () => {
    let s = makeGame()   // 6 cards → discard pending at end of turn
    s = apply(s, { type: 'pass', player: 0 }).state; s = apply(s, { type: 'pass', player: 0 }).state; s = apply(s, { type: 'pass', player: 0 }).state
    const c = candidateCommands(s, 0)
    expect(c).toHaveLength(1); expect(c[0]!.type).toBe('discardToHandSize')
    expect(() => apply(s, c[0]!)).not.toThrow()
    expect(candidateCommands(s, 1)).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify failure** → FAIL.

- [ ] **Step 3: Implement**

`payment.ts`:
```ts
import { canPay, defOf, generateCp, type CardId, type Element, type GameState, type Payment, type PlayerId } from '@fftcg/engine'
import { cardValue } from './cardValue.js'

interface Source { kind: 'backup' | 'discard'; id: CardId; elements: Element[]; cp: number; cost: number }

export function preferredPayment(state: GameState, player: PlayerId, card: CardId): Payment | null {
  const def = defOf(state, card)
  if (def.cost === 0) return { dullBackups: [], discards: [] }
  const ps = state.players[player]
  const sources: Source[] = []
  for (const b of ps.backups) if (b.status === 'active') sources.push({ kind: 'backup', id: b.id, elements: defOf(state, b.id).elements, cp: 1, cost: 1 })
  for (const id of ps.hand) {
    if (id === card) continue
    const d = defOf(state, id)
    if (d.elements.includes('light') || d.elements.includes('dark')) continue
    sources.push({ kind: 'discard', id, elements: d.elements, cp: 2, cost: 2 + cardValue(d) })
  }
  sources.sort((a, b) => a.cost - b.cost)
  const chosen = new Set<Source>()
  const declared = new Map<CardId, Element>()
  let total = 0
  const take = (s: Source, element: Element) => { chosen.add(s); total += s.cp; if (s.kind === 'discard') declared.set(s.id, element) }
  const provides = (s: Source, e: Element) => (s.kind === 'backup' ? s.elements[0] === e : declared.get(s.id) === e)
  for (const e of def.elements) {                       // §11.2.2.1: at least one CP of each required element
    if ([...chosen].some((s) => provides(s, e))) continue
    const s = sources.find((x) => !chosen.has(x) && x.elements.includes(e))
    if (!s) return null
    take(s, e)
  }
  for (const s of sources) { if (total >= def.cost) break; if (!chosen.has(s)) take(s, s.elements[0] as Element) }
  if (total < def.cost) return null
  const payment: Payment = {
    dullBackups: [...chosen].filter((s) => s.kind === 'backup').map((s) => s.id),
    discards: [...chosen].filter((s) => s.kind === 'discard').map((s) => ({ card: s.id, element: declared.get(s.id) as Element })),
  }
  return canPay(def.cost, def.elements, generateCp(state, player, payment, card)) ? payment : null
}
```

`candidates.ts`:
```ts
import { actingPlayer, castCheck, defOf, legalAttackSets, legalBlockers, legalPartyDamageAssignments, type Command, type GameState, type PlayerId } from '@fftcg/engine'
import { cardValue } from './cardValue.js'
import { preferredPayment } from './payment.js'

export function candidateCommands(state: GameState, player: PlayerId): Command[] {
  if (state.result || actingPlayer(state) !== player) return []
  const out: Command[] = []
  const pending = state.pending
  if (pending) {
    switch (pending.kind) {
      case 'chooseFirst': return [{ type: 'chooseFirst', player, goFirst: true }, { type: 'chooseFirst', player, goFirst: false }]
      case 'mulligan': return [{ type: 'mulligan', player, redraw: false }, { type: 'mulligan', player, redraw: true }]
      case 'discardToHandSize': {
        const byValue = [...state.players[player].hand].sort((a, b) => cardValue(defOf(state, a)) - cardValue(defOf(state, b)))
        return [{ type: 'discardToHandSize', player, cards: byValue.slice(0, pending.count) }]
      }
      case 'declareBlock': return [{ type: 'declareBlock', player, blocker: null }, ...legalBlockers(state, player).map((blocker) => ({ type: 'declareBlock' as const, player, blocker }))]
      case 'assignPartyDamage': return legalPartyDamageAssignments(state).map((assignments) => ({ type: 'assignPartyDamage' as const, player, assignments }))
    }
  }
  if (state.phase === 'main1' || state.phase === 'main2') {
    for (const card of state.players[player].hand) {
      if (castCheck(state, player, card) !== null) continue
      const payment = preferredPayment(state, player, card)
      if (!payment) continue
      out.push({ type: defOf(state, card).type === 'summon' ? 'castSummon' : 'castCharacter', player, card, payment })
    }
    out.push({ type: 'pass', player })
  } else if (state.phase === 'attack' && state.attack?.step === 'declaration') {
    for (const attackers of legalAttackSets(state, player)) out.push({ type: 'declareAttack', player, attackers })
    out.push({ type: 'pass', player })
  }
  return out
}
```

- [ ] **Step 4: Run everything** → green. **Step 5: Commit** `feat(ai): canonical CP payment and candidate move generation`.

---

### Task 4: AI — `GreedyAgent`

**Files:**
- Create: `packages/ai/src/greedy.ts`
- Modify: `packages/ai/src/index.ts` (export cardValue, evaluate, payment, candidates, greedy)
- Test: `packages/ai/test/greedy.test.ts`

**Interfaces:**
```ts
export interface GreedyOptions { seed: number; decks: [string[], string[]]; depth?: 0 | 1 | 2; weights?: Weights; aggression?: number; maxSimulations?: number }
export class GreedyAgent implements Agent {
  constructor(opts: GreedyOptions)
  decide(view: PlayerView, legal: Command[]): Command
  /** number of apply() calls made in the last decide(); for tests/timing */
  readonly lastSimulations: number
}
/** Greedy depth-0 policy on a full state: best candidate by immediate evaluate() from `player`'s perspective. Exported for rollouts and later ISMCTS playouts. */
export function greedyStep(state: GameState, player: PlayerId, weights: Weights, aggression: number): Command | null
```
Algorithm of `decide(view, legal)`:
1. `me = view.me`. `[det, rng'] = determinise({ view, decks, rng })`; store `rng'`.
2. `cands = candidateCommands(det, me)`, non-pass first, `pass` last; if empty → the first non-concede command in `legal`, else `legal[0]`.
3. Effective depth: `depth`, unless `cands.length × 20 > maxSimulations` (default 2000) → 0.
4. For each cand: `s = apply(det, cand).state`; `sims++`. If depth ≥ 1: rollout `while (!s.result && s.turnPlayer === me && sims < maxSimulations) { const p = actingPlayer(s)!; const c = greedyStep(s, p, weights, aggression); if (!c) break; s = apply(s, c).state; sims++ }` — the opponent answers block/party decisions inside my turn with its own greedy step (zero-sum: it maximises `evaluate(·, opp)`). If depth ≥ 2: continue the same loop while `s.turnPlayer !== me` (the opponent's whole turn) under the same cap. Score = `evaluate(s, me, weights, aggression)`.
5. Pick max score; ties → earlier candidate (so a non-pass beats an equal-scoring pass).
6. Set `lastSimulations = sims`; return the chosen command.
Determinism: only the seeded `rng` is consulted, and only by `determinise`.

- [ ] **Step 1: Failing tests**

`packages/ai/test/greedy.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { apply, legalCommands, viewFor, type GameState } from '@fftcg/engine'
import { GreedyAgent } from '../src/greedy.js'
import { DEFAULT_DECK, makeGame, withField, withHandSize } from '../../engine/test/helpers.js'

const DECKS: [string[], string[]] = [DEFAULT_DECK, DEFAULT_DECK]
const agent = (seed = 1, depth: 0 | 1 | 2 = 1) => new GreedyAgent({ seed, decks: DECKS, depth })
const hurt = (s: GameState, p: 0 | 1, n: number): GameState => {
  const ps = s.players[p]
  const players = [s.players[0], s.players[1]] as typeof s.players
  players[p] = { ...ps, damageZone: ps.deck.slice(0, n), deck: ps.deck.slice(n) }
  return { ...s, players }
}
const toAttackDeclaration = (s: GameState): GameState => apply(s, { type: 'pass', player: 0 }).state

describe('GreedyAgent', () => {
  it('is deterministic per seed and never concedes', () => {
    const s = makeGame()
    const a = agent(7).decide(viewFor(s, 0), legalCommands(s, 0)), b = agent(7).decide(viewFor(s, 0), legalCommands(s, 0))
    expect(a).toEqual(b); expect(a.type).not.toBe('concede')
  })
  it('takes lethal: attacks when the opponent is at 6 damage and cannot block', () => {
    let s = withHandSize(makeGame(), 0, 5); let f: number
    ;[s, f] = withField(s, 0, 'forwards', 'V-F2')
    s = toAttackDeclaration(hurt(s, 1, 6))
    expect(agent().decide(viewFor(s, 0), legalCommands(s, 0))).toEqual({ type: 'declareAttack', player: 0, attackers: [f] })
  })
  it('does not attack a 3000 into an active 7000 blocker for no gain (depth 1)', () => {
    let s = withHandSize(makeGame(), 0, 5)
    ;[s] = withField(s, 0, 'forwards', 'V-F1')   // 3000
    ;[s] = withField(s, 1, 'forwards', 'V-F3')   // 7000 active blocker
    s = toAttackDeclaration(s)
    expect(agent().decide(viewFor(s, 0), legalCommands(s, 0)).type).toBe('pass')
  })
  it('blocks a lethal attack when it can', () => {
    let s = withHandSize(makeGame(), 0, 5); let a: number, b: number
    ;[s, a] = withField(s, 0, 'forwards', 'V-F1')   // attacker 3000
    ;[s, b] = withField(s, 1, 'forwards', 'V-F3')   // blocker 7000
    s = toAttackDeclaration(hurt(s, 1, 6))
    s = apply(s, { type: 'declareAttack', player: 0, attackers: [a] }).state
    expect(agent().decide(viewFor(s, 1), legalCommands(s, 1))).toEqual({ type: 'declareBlock', player: 1, blocker: b })
  })
  it('returns a legal command on turn 1 and reports its simulation count', () => {
    const s = makeGame()
    const a = agent()
    const cmd = a.decide(viewFor(s, 0), legalCommands(s, 0))
    expect(() => apply(s, cmd)).not.toThrow()
    expect(a.lastSimulations).toBeGreaterThan(0)
  })
  it('respects maxSimulations by dropping to depth 0', () => {
    const s = makeGame()
    const a = new GreedyAgent({ seed: 1, decks: DECKS, depth: 2, maxSimulations: 5 })
    a.decide(viewFor(s, 0), legalCommands(s, 0))
    expect(a.lastSimulations).toBeLessThanOrEqual(40)
  })
})
```

- [ ] **Step 2: Run to verify failure** → FAIL.

- [ ] **Step 3: Implement `greedy.ts`**

```ts
import { actingPlayer, apply, determinise, seedRng, type Command, type GameState, type PlayerId, type PlayerView, type Rng } from '@fftcg/engine'
import type { Agent } from './agent.js'
import { candidateCommands } from './candidates.js'
import { DEFAULT_WEIGHTS, evaluate, type Weights } from './evaluate.js'

export interface GreedyOptions { seed: number; decks: [string[], string[]]; depth?: 0 | 1 | 2; weights?: Weights; aggression?: number; maxSimulations?: number }
const ROLLOUT_ESTIMATE = 20

export function greedyStep(state: GameState, player: PlayerId, weights: Weights, aggression: number): Command | null {
  let best: Command | null = null
  let bestScore = -Infinity
  for (const c of candidateCommands(state, player)) {
    const score = evaluate(apply(state, c).state, player, weights, aggression)
    if (score > bestScore) { best = c; bestScore = score }
  }
  return best
}

export class GreedyAgent implements Agent {
  private rng: Rng
  private readonly decks: [string[], string[]]
  private readonly depth: 0 | 1 | 2
  private readonly weights: Weights
  private readonly aggression: number
  private readonly maxSimulations: number
  lastSimulations = 0
  constructor(opts: GreedyOptions) {
    this.rng = seedRng(opts.seed); this.decks = opts.decks; this.depth = opts.depth ?? 1
    this.weights = opts.weights ?? DEFAULT_WEIGHTS; this.aggression = opts.aggression ?? 0.5; this.maxSimulations = opts.maxSimulations ?? 2000
  }
  decide(view: PlayerView, legal: Command[]): Command {
    const me = view.me
    const [det, rng] = determinise({ view, decks: this.decks, rng: this.rng })
    this.rng = rng
    const cands = candidateCommands(det, me).sort((a, b) => Number(a.type === 'pass') - Number(b.type === 'pass'))
    if (!cands.length) return legal.find((c) => c.type !== 'concede') ?? (legal[0] as Command)
    const depth = cands.length * ROLLOUT_ESTIMATE > this.maxSimulations ? 0 : this.depth
    let sims = 0
    let best = cands[0] as Command
    let bestScore = -Infinity
    for (const cand of cands) {
      let s = apply(det, cand).state; sims++
      const rollout = (until: (t: GameState) => boolean) => {
        while (!s.result && until(s) && sims < this.maxSimulations) {
          const p = actingPlayer(s)!
          const c = greedyStep(s, p, this.weights, this.aggression)
          if (!c) break
          s = apply(s, c).state; sims++
        }
      }
      if (depth >= 1) rollout((t) => t.turnPlayer === me)
      if (depth >= 2) rollout((t) => t.turnPlayer !== me)
      const score = evaluate(s, me, this.weights, this.aggression)
      if (score > bestScore) { best = cand; bestScore = score }
    }
    this.lastSimulations = sims
    return best
  }
}
```
Move `Agent` and `RandomAgent` out of `index.ts` into `packages/ai/src/agent.ts` (unchanged code) so `greedy.ts` can import `Agent` without a cycle; `index.ts` becomes pure re-exports:
```ts
export * from './agent.js'
export * from './cardValue.js'
export * from './evaluate.js'
export * from './payment.js'
export * from './candidates.js'
export * from './greedy.js'
```
The inner `apply` calls made by `greedyStep` while scoring candidates are deliberately not counted in `sims`; the cap bounds taken steps and `ROLLOUT_ESTIMATE` accounts for the fan-out.

- [ ] **Step 4: Run everything** → green. If the "3000 into 7000" test fails because the evaluation still prefers attacking, first confirm the rollout is letting the opponent block (it should — `greedyStep` for the opponent maximises their evaluation); only then consider weights, and record any change in the spec appendix (Task 6).
- [ ] **Step 5: Commit** `feat(ai): greedy lookahead agent with determinised rollouts`.

---

### Task 5: CLI — agent selection, timing, strength test

**Files:**
- Create: `apps/cli/src/agents.ts`
- Modify: `apps/cli/src/selfplay.ts`, `apps/cli/src/main.ts`
- Test: `apps/cli/test/selfplay.test.ts` (+ strength tests)

**Interfaces:**
```ts
// agents.ts
export type AgentSpec = { kind: 'random' } | { kind: 'greedy'; depth?: 0 | 1 | 2 }
export function parseAgentSpec(s: string): AgentSpec        // 'random' | 'greedy' | 'greedy:0' | 'greedy:2'; throws on anything else
export function describeAgentSpec(spec: AgentSpec): string  // 'random' | 'greedy:1' …
export function makeAgent(spec: AgentSpec, seed: number, decks: [string[], string[]]): Agent
// selfplay.ts
export interface SelfPlayOptions { games: number; seed: number; decks: [string[], string[]]; defs: CardDef[]; maxCommands?: number; agents?: [AgentSpec, AgentSpec]; strict?: boolean }
export interface SelfPlayReport { games; completed; wins; draws; avgTurns; unimplementedAbilities; failures; agents: [string, string]; msPerDecision: [number, number]; decisions: [number, number] }
```
`strict` (default `true`) keeps the per-command mutation/invariant/dead-end checks; `strict: false` skips them for tournaments (still runs `checkInvariants` once at game end). Timing via `performance.now()` around `decide` only — measurement, not decision logic. `main.ts`: `--p0`, `--p1` (default `random`), `--depth` (default 1, applied to greedy specs without an explicit depth), `--fast` → `strict: false`; the printed JSON includes `agents` and `msPerDecision`.

- [ ] **Step 1: Failing tests** — extend `apps/cli/test/selfplay.test.ts`:
```ts
it('greedy beats random decisively (30 games, depth 1, both seats)', () => {
  const deck = parseDeckFile(readFileSync(new URL('../../../decks/starter-2025-vol2.txt', import.meta.url), 'utf8'))
  const a = selfPlay({ games: 15, seed: 500, decks: [deck, deck], defs: loadCards(), agents: [{ kind: 'greedy' }, { kind: 'random' }], strict: false })
  const b = selfPlay({ games: 15, seed: 600, decks: [deck, deck], defs: loadCards(), agents: [{ kind: 'random' }, { kind: 'greedy' }], strict: false })
  expect(a.failures).toEqual([]); expect(b.failures).toEqual([])
  expect(a.wins[0] + b.wins[1]).toBeGreaterThanOrEqual(21)          // ≥ 70 % of 30
  expect(Math.max(a.msPerDecision[0], b.msPerDecision[1])).toBeLessThan(200)
}, 180_000)
it('greedy vs greedy terminates', () => {
  const deck = parseDeckFile(readFileSync(new URL('../../../decks/starter-2025-vol2.txt', import.meta.url), 'utf8'))
  const r = selfPlay({ games: 5, seed: 700, decks: [deck, deck], defs: loadCards(), agents: [{ kind: 'greedy' }, { kind: 'greedy' }], strict: false })
  expect(r.failures).toEqual([]); expect(r.completed).toBe(5)
}, 180_000)
```
Also assert in the existing 20-game test that `r.agents` equals `['random', 'random']`.
- [ ] **Step 2: Run to verify failure** → FAIL (unknown option / missing fields).
- [ ] **Step 3: Implement** `agents.ts`, the `selfPlay` changes (default path stays random-vs-random with `strict: true` so the existing fuzzer behaviour is unchanged), and the CLI flags.
- [ ] **Step 4: Run everything** → green; then run and paste into the task report: `pnpm --filter @fftcg/cli selfplay --games 200 --seed 1 --p0 greedy --p1 random --fast`, `… --p0 random --p1 greedy --fast`, `… --p0 greedy --p1 greedy --fast`. Greedy must win ≥ 160/200 in both seat orders; if not, do NOT tune here — report the numbers (Task 6 tunes).
- [ ] **Step 5: Commit** `feat(cli): per-seat agents, timing and a greedy-vs-random strength test`.

---

### Task 6: Tuning and documentation

**Files:**
- Modify: `packages/ai/src/evaluate.ts` (weights only, if needed), `docs/superpowers/specs/2026-08-26-heuristic-ai-design.md` (appendix), `README.md`

- [ ] **Step 1:** Run the three 200-game tournaments from Task 5 Step 4 at depth 1 and depth 2 (`--depth 2`). If greedy < 80 % vs random in either seat at depth 1: adjust `DEFAULT_WEIGHTS` (try, in order: `damage` 30→40, `threat` 0.8→1.5, `forwardPresence` 4→6), re-run, keep the best; at most 4 iterations; record every run's numbers. Any weight change must keep the Task 2/4 tests green.
- [ ] **Step 2:** Append `## Appendix — rung A measurements (2026-08-26)` to the spec: final weights and a table of win rate / msPerDecision / avgTurns for greedy-vs-random (both seats), greedy-vs-greedy, at depth 1 and 2.
- [ ] **Step 3:** README: document `--p0/--p1/--depth/--fast` and a one-paragraph "AI opponent" section (greedy lookahead; view-only; seeded; deck lists are public knowledge).
- [ ] **Step 4:** `pnpm test && pnpm typecheck && pnpm lint` green; commit `docs(ai): rung A measurements and README`.

## Self-review notes
- Spec coverage: A1–A2 (Task 4), A3 (Task 1), A4 (Task 3), A5–A6 (Task 2), A7 (Tasks 1 and 4 tests), A8 (Task 4 cap + Task 5 timing), A9 (Tasks 5–6), A10 respected.
- Type consistency: `determinise` returns `[GameState, Rng]`; `GreedyAgent` replaces its `rng` after each determinise; `candidateCommands` uses engine `legal*` helpers that take `(state, player)` except `legalPartyDamageAssignments(state)`; `SelfPlayReport` gains `agents`, `msPerDecision`, `decisions`; `Agent`/`RandomAgent` move to `agent.ts` in Task 4.
- Known deviation from MVP0 patterns: `packages/ai` tests import engine test helpers by relative path — acceptable in a private monorepo; noted in Global Constraints.
