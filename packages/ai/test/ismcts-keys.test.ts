import { describe, expect, it } from 'vitest'
import {
  SYNTHETIC_ID_BASE, actingPlayer, apply, createGame, determinise, drainResolution, enqueueTrigger, seedRng, viewFor,
  type Ability, type CardDef, type CardId, type Command, type Effect, type Frame, type GameState, type Payment, type PlayerId, type PlayerView, type TargetFilter,
} from '@fftcg/engine'
import { candidateCommands } from '../src/candidates.js'
import { GreedyAgent } from '../src/greedy.js'
import { KEY_CONTRACT, actionKey, cardRef, compareKeys, decodeAction, isOpaque, observationKey } from '../src/ismcts/keys.js'
import { DEFAULT_DECK, VANILLA_POOL, makeDef, makeGame, withField, withHand, withHandSize } from '../../engine/test/helpers.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** The deck list as a MULTISET read off the state itself — every card in the game, wherever it currently sits.
 *  Invariant across a game (nothing ever leaves), so `determinise` accepts it from any position. */
const decksOf = (s: GameState): [string[], string[]] => ([0, 1] as const).map((p) => {
  const q = s.players[p]
  return [...q.deck, ...q.hand, ...q.forwards.map((c) => c.id), ...q.backups.map((c) => c.id), ...q.damageZone, ...q.breakZone, ...q.removedFromGame].map((id) => s.cards[id]!.code)
}) as [string[], string[]]

const clause = (id: string, effects: readonly Effect[]): Ability => ({ id, trigger: { kind: 'enterField' }, text: `synthetic clause ${id}`, effects })
const bearer = (code: string, a: Ability): CardDef => makeDef({ code, type: 'backup', power: null, cost: 1, hasAbilities: true, abilityClauses: 1, abilities: [a] })
/** Put a clause on the agenda and run it until it asks its question — the state `candidateCommands` meets in play. */
const arm = (s: GameState, source: CardId, controller: PlayerId, a: Ability): GameState => drainResolution(enqueueTrigger(s, source, controller, a))[0] as GameState

/** Mint an instance straight into a Break Zone — `withField` only reaches the field. */
function withBreakZone(state: GameState, player: PlayerId, code: string): [GameState, CardId] {
  const [s, id] = withField(state, player, 'backups', code)
  const ps = s.players[player]
  const players: GameState['players'] = [s.players[0], s.players[1]]
  players[player] = { ...ps, backups: ps.backups.filter((c) => c.id !== id), breakZone: [...ps.breakZone, id] }
  return [{ ...s, players }, id]
}

/** Move `n` cards off the top of `p`'s deck into their damage zone, so the digest has damage-zone ids to hide. */
function hurt(s: GameState, p: PlayerId, n: number): GameState {
  const ps = s.players[p]
  const players: GameState['players'] = [s.players[0], s.players[1]]
  players[p] = { ...ps, damageZone: ps.deck.slice(0, n), deck: ps.deck.slice(n) }
  return { ...s, players }
}

const NO_PAYMENT: Payment = { dullBackups: [], discards: [] }

// ---------------------------------------------------------------------------

describe('cardRef', () => {
  it('names public cards by zone and position, and the root hand by code alone', () => {
    let s = makeGame()
    let f0: CardId, f1: CardId, b0: CardId, z0: CardId, h1: CardId, h2: CardId
    ;[s, f0] = withField(s, 0, 'forwards', 'V-F1')
    ;[s, f1] = withField(s, 0, 'forwards', 'V-F5')
    ;[s, b0] = withField(s, 1, 'backups', 'V-B1')
    ;[s, z0] = withBreakZone(s, 0, 'V-F7')
    s = withHandSize(s, 0, 0)
    ;[s, h1] = withHand(s, 0, 'V-F2')
    ;[s, h2] = withHand(s, 0, 'V-F2')
    s = hurt(s, 1, 2)
    const v = viewFor(s, 0)
    expect(cardRef(v, f0, 0)).toBe('f0:0')
    expect(cardRef(v, f1, 0)).toBe('f0:1')
    expect(cardRef(v, b0, 0)).toBe('b1:0')
    expect(cardRef(v, z0, 0)).toBe('z0:0')
    expect(cardRef(v, s.players[1].damageZone[1]!, 0)).toBe('d1:1')
    // Two copies of one code in hand are INTERCHANGEABLE, so they share a ref outright. Numbering them
    // `#1`/`#2` split one semantic action into two tree edges and halved the visits on each — a false split
    // of exactly the kind the keys exist to prevent, and invisible to any win-rate gate.
    expect(cardRef(v, h1, 0)).toBe('h:V-F2')
    expect(cardRef(v, h2, 0)).toBe('h:V-F2')
  })

  it('gives `?` — and only `?` — to cards the root cannot identify', () => {
    const s = makeGame()
    const v = viewFor(s, 0)
    const oppHand = s.players[1].hand[0]!
    expect(cardRef(v, oppHand, 0)).toBe('?')                    // the opponent's hand is not in the view at all
    expect(cardRef(v, s.players[0].deck[0]!, 0)).toBe('?')      // nor is my own deck
    expect(cardRef(v, v.hand[0]!, 1)).toBe('?')                 // and player 1 cannot name player 0's hand
    expect(cardRef(v, v.hand[0]!, 0)).not.toBe('?')
    expect(isOpaque(actionKey(v, { type: 'castCharacter', player: 1, card: oppHand, payment: NO_PAYMENT }))).toBe(true)
  })
})

describe('determinism (contract 1)', () => {
  it('a key depends only on (view, command) — repeat calls and independently built views agree', () => {
    const s = makeGame()
    const a = viewFor(s, 0)
    const b = viewFor(s, 0)   // structurally equal, a DIFFERENT object: no cache and no identity may leak in
    const cmd: Command = { type: 'pass', player: 0 }
    expect(actionKey(a, cmd)).toBe(actionKey(a, cmd))
    expect(actionKey(b, cmd)).toBe(actionKey(a, cmd))
    expect(observationKey(b)).toBe(observationKey(a))
    expect(cardRef(b, a.hand[0]!, 0)).toBe(cardRef(a, a.hand[0]!, 0))
  })

  it('compareKeys is a total order and does not consult the locale', () => {
    const keys = ['pass|p0', 'pass|p1', 'castSummon|p0|h:V-S1#1||', 'concede|p0']
    const sorted = [...keys].sort(compareKeys)
    expect([...keys].reverse().sort(compareKeys)).toEqual(sorted)
    for (const k of keys) expect(compareKeys(k, k)).toBe(0)
    expect(compareKeys('a', 'B')).toBe(1)   // code-unit order: 'B' < 'a'. localeCompare would say the reverse.
  })
})

describe('no false match (contract 2) — the adversarial fixture', () => {
  /** One view, two determinisations, and a numeric id that means a DIFFERENT CODE in each world. This is the
   *  exact hazard D-2 names: the ids `determinise` mints are sequential, so world A's `100045` and world B's
   *  `100045` are both "the opponent's first hand card" and are not the same card. */
  function collidingWorlds(): { va: PlayerView; vb: PlayerView; id: CardId } {
    const s = makeGame()
    const view = viewFor(s, 0)
    const decks = decksOf(s)
    const [wa] = determinise({ view, decks, rng: seedRng(1) })
    for (const seed of [2, 3, 4, 5, 6, 7, 8]) {
      const [wb] = determinise({ view, decks, rng: seedRng(seed) })
      const va = viewFor(wa, 1)
      const vb = viewFor(wb, 1)
      const id = va.hand.find((h) => vb.hand.includes(h) && va.cards[h]?.code !== vb.cards[h]?.code)
      if (id !== undefined) return { va, vb, id }
    }
    throw new Error('fixture failed to find a colliding id')
  }

  it('two commands naming different CODES never share a key, even on the same numeric id', () => {
    const { va, vb, id } = collidingWorlds()
    expect(id).toBeGreaterThanOrEqual(SYNTHETIC_ID_BASE)
    expect(va.cards[id]!.code).not.toBe(vb.cards[id]!.code)
    const cmd: Command = { type: 'castCharacter', player: 1, card: id, payment: NO_PAYMENT }
    // The naive key — the raw command — is byte-identical in the two worlds. That is the bug being prevented.
    expect(JSON.stringify(cmd)).toBe(JSON.stringify(cmd))
    const ka = actionKey(va, cmd)
    const kb = actionKey(vb, cmd)
    expect(isOpaque(ka)).toBe(false)   // both worlds can name it: this is a real split, not two `?`s
    expect(isOpaque(kb)).toBe(false)
    expect(ka).not.toBe(kb)
    expect(ka).toContain(va.cards[id]!.code)
    expect(kb).toContain(vb.cards[id]!.code)
  })

  it('holds for every hand-card slot in a key, not just the cast card', () => {
    const { va, vb, id } = collidingWorlds()
    // A single-ref command over the same colliding id: no other card can account for the difference.
    const cmd: Command = { type: 'discardToHandSize', player: 1, cards: [id] }
    expect(actionKey(va, cmd)).not.toBe(actionKey(vb, cmd))
  })
})

describe('no false split (contract 3)', () => {
  it('the same semantic card at different ids in two worlds shares a key', () => {
    const s = makeGame()
    const view = viewFor(s, 0)
    const decks = decksOf(s)
    const [wa] = determinise({ view, decks, rng: seedRng(1) })
    const va = viewFor(wa, 1)
    let found: { vb: PlayerView; ia: CardId; ib: CardId } | null = null
    for (const seed of [2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      const [wb] = determinise({ view, decks, rng: seedRng(seed) })
      const vb = viewFor(wb, 1)
      for (const ia of va.hand) {
        const code = va.cards[ia]!.code
        // First occurrence of that code in each hand — semantically the same card, different numeric ids.
        if (va.hand.findIndex((h) => va.cards[h]!.code === code) !== va.hand.indexOf(ia)) continue
        const ib = vb.hand.find((h) => vb.cards[h]!.code === code)
        if (ib !== undefined && ib !== ia) { found = { vb, ia, ib }; break }
      }
      if (found) break
    }
    expect(found).not.toBeNull()
    const { vb, ia, ib } = found!
    expect(ia).not.toBe(ib)
    const key = (v: PlayerView, id: CardId): string => actionKey(v, { type: 'castCharacter', player: 1, card: id, payment: NO_PAYMENT })
    expect(key(va, ia)).toBe(key(vb, ib))
  })

  it('public cards key by position, so a renumbered world produces the same action key', () => {
    let s = makeGame()
    let f: CardId
    ;[s, f] = withField(s, 0, 'forwards', 'V-F1')
    const v = viewFor(s, 0)
    const cmd = (id: CardId): Command => ({ type: 'declareAttack', player: 0, attackers: [id] })
    expect(actionKey(remapIds(v, 50_000), cmd(f + 50_000))).toBe(actionKey(v, cmd(f)))
  })
})

describe('totality and normalisation (contract 4)', () => {
  /** One of every `Command` variant. `actionKey`'s `const _: never` default is the compile-time half of
   *  totality; this is the runtime half — every variant keys, and no two variants collide. */
  it('every Command variant produces a distinct, well-formed key', () => {
    let s = makeGame()
    let f: CardId, b: CardId
    ;[s, f] = withField(s, 0, 'forwards', 'V-F1')
    ;[s, b] = withField(s, 0, 'backups', 'V-B1')
    const v = viewFor(s, 0)
    const h = v.hand[0]!
    const all: Command[] = [
      { type: 'chooseFirst', player: 0, goFirst: true },
      { type: 'mulligan', player: 0, redraw: false },
      { type: 'castCharacter', player: 0, card: h, payment: { dullBackups: [b], discards: [] } },
      { type: 'castSummon', player: 0, card: h, payment: { dullBackups: [b], discards: [] } },
      { type: 'declareAttack', player: 0, attackers: [f] },
      { type: 'declareBlock', player: 0, blocker: f },
      { type: 'declareBlock', player: 0, blocker: null },
      { type: 'assignPartyDamage', player: 0, assignments: [{ target: f, amount: 2000 }] },
      { type: 'discardToHandSize', player: 0, cards: [h] },
      { type: 'chooseTargets', player: 0, targets: [f] },
      { type: 'chooseMode', player: 0, modes: [0] },
      { type: 'pass', player: 0 },
      { type: 'concede', player: 0 },
    ]
    const keys = all.map((c) => actionKey(v, c))
    for (const [i, k] of keys.entries()) expect(k.startsWith(`${all[i]!.type}|p0`)).toBe(true)
    expect(new Set(keys).size).toBe(keys.length)
    // The same command by the other player is a different action.
    expect(actionKey(v, { type: 'pass', player: 1 })).not.toBe(actionKey(v, { type: 'pass', player: 0 }))
  })

  it('sets are normalised by sorting — attackers, targets, discards, payment sources and modes', () => {
    let s = makeGame()
    let f1: CardId, f2: CardId, b1: CardId, b2: CardId
    ;[s, f1] = withField(s, 0, 'forwards', 'V-F1')
    ;[s, f2] = withField(s, 0, 'forwards', 'V-F5')
    ;[s, b1] = withField(s, 0, 'backups', 'V-B1')
    ;[s, b2] = withField(s, 0, 'backups', 'V-B3')
    const v = viewFor(s, 0)
    const [h1, h2] = [v.hand[0]!, v.hand[1]!]
    const same = (a: Command, b: Command): void => expect(actionKey(v, a)).toBe(actionKey(v, b))
    same({ type: 'declareAttack', player: 0, attackers: [f1, f2] }, { type: 'declareAttack', player: 0, attackers: [f2, f1] })
    same({ type: 'chooseTargets', player: 0, targets: [f1, f2] }, { type: 'chooseTargets', player: 0, targets: [f2, f1] })
    same({ type: 'discardToHandSize', player: 0, cards: [h1, h2] }, { type: 'discardToHandSize', player: 0, cards: [h2, h1] })
    same({ type: 'chooseMode', player: 0, modes: [0, 2] }, { type: 'chooseMode', player: 0, modes: [2, 0] })
    same(
      { type: 'assignPartyDamage', player: 0, assignments: [{ target: f1, amount: 1000 }, { target: f2, amount: 2000 }] },
      { type: 'assignPartyDamage', player: 0, assignments: [{ target: f2, amount: 2000 }, { target: f1, amount: 1000 }] },
    )
    same(
      { type: 'castCharacter', player: 0, card: h1, payment: { dullBackups: [b1, b2], discards: [{ card: h2, element: 'earth' }] } },
      { type: 'castCharacter', player: 0, card: h1, payment: { dullBackups: [b2, b1], discards: [{ card: h2, element: 'earth' }] } },
    )
    // ...but the element a discard pays IS semantic: it is the CP produced (§11.2.1.1).
    expect(actionKey(v, { type: 'castCharacter', player: 0, card: h1, payment: { dullBackups: [], discards: [{ card: h2, element: 'earth' }] } }))
      .not.toBe(actionKey(v, { type: 'castCharacter', player: 0, card: h1, payment: { dullBackups: [], discards: [{ card: h2, element: 'fire' }] } }))
  })

  it('zone refs sort by index numerically, not lexically (`f0:2` before `f0:10`)', () => {
    let s = makeGame()
    const ids: CardId[] = []
    for (let i = 0; i < 12; i++) { let id: CardId; [s, id] = withField(s, 0, 'forwards', 'V-F1'); ids.push(id) }
    const v = viewFor(s, 0)
    const key = actionKey(v, { type: 'declareAttack', player: 0, attackers: [ids[10]!, ids[2]!] })
    expect(key.endsWith('|f0:2,f0:10')).toBe(true)
    expect(actionKey(v, { type: 'declareAttack', player: 0, attackers: [ids[2]!, ids[10]!] })).toBe(key)
  })
})

describe('round trip (contract 5)', () => {
  function roundTrip(det: GameState, p: PlayerId): number {
    const dv = viewFor(det, p)
    const cands = candidateCommands(det, p)
    for (const c of cands) {
      const key = actionKey(dv, c)
      const back = decodeAction(dv, key)
      expect(back, `decode failed for ${key}`).not.toBeNull()
      // NOT raw-id equality: two copies of one code in hand share a ref, so decode legitimately returns the
      // other copy. The contract is "an EQUIVALENT command that is legal in THIS world", and the two
      // assertions below say exactly that — it keys back to where it came from, and the engine accepts it.
      expect(actionKey(dv, back!)).toBe(key)
      expect(() => apply(det, back!)).not.toThrow()   // legal in THIS world, which is the whole point
    }
    return cands.length
  }

  it('every candidate command round-trips, over many determinisations of a played-out game', () => {
    let s = makeGame()
    const decks = decksOf(s)
    const agents: [GreedyAgent, GreedyAgent] = [new GreedyAgent({ seed: 7, decks }), new GreedyAgent({ seed: 11, decks })]
    let seen = 0
    const kinds = new Set<string>()
    for (let step = 0; step < 60 && !s.result; step++) {
      const p = actingPlayer(s)
      if (p === null) break
      const view = viewFor(s, p)
      for (const seed of [1, 2, 3]) {
        const [det] = determinise({ view, decks, rng: seedRng(seed) })
        seen += roundTrip(det, p)
        for (const c of candidateCommands(det, p)) kinds.add(c.type)
      }
      s = apply(s, agents[p].decide(view, [])).state
    }
    expect(seen).toBeGreaterThan(100)
    // Guard against the loop degenerating into 60 passes and calling that coverage.
    for (const t of ['pass', 'castCharacter', 'declareAttack', 'declareBlock']) expect(kinds).toContain(t)
  })

  it('setup decisions (chooseFirst, mulligan) round-trip too', () => {
    const decks: [string[], string[]] = [DEFAULT_DECK, DEFAULT_DECK]
    let s = createGame({ seed: 3, decks, defs: VANILLA_POOL })
    for (let step = 0; step < 4 && s.pending; step++) {
      const p = s.pending.player
      const [det] = determinise({ view: viewFor(s, p), decks, rng: seedRng(step + 1) })
      expect(roundTrip(det, p)).toBeGreaterThan(0)
      s = apply(s, candidateCommands(det, p)[0]!).state
    }
    expect(s.phase).not.toBe('setup')
  })

  it('ability prompts (chooseTargets, chooseMode) round-trip', () => {
    const targets = clause('T:etb', [{ kind: 'chooseTargets', min: 1, max: 2, from: { zone: 'forwards', controller: 'any' }, then: [{ kind: 'dull' }] }])
    const modes = clause('M:etb', [{ kind: 'chooseModes', min: 1, max: 2, modes: [
      { label: 'Deal it 3000 damage', effects: [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'opponent' }, then: [{ kind: 'damage', amount: 3000 }] }] },
      { label: 'Dull | it, and, tricky punctuation', effects: [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'opponent' }, then: [{ kind: 'dull' }] }] },
    ] }])
    for (const a of [targets, modes]) {
      let s = makeGame({ defs: [...VANILLA_POOL, bearer('X-SRC', a)] })
      let src: CardId
      ;[s, src] = withField(s, 0, 'backups', 'X-SRC')
      ;[s] = withField(s, 0, 'forwards', 'V-F1')
      ;[s] = withField(s, 1, 'forwards', 'V-F5')
      s = arm(s, src, 0, a)
      expect(s.pending?.kind === 'chooseTargets' || s.pending?.kind === 'chooseMode').toBe(true)
      const [det] = determinise({ view: viewFor(s, 0), decks: decksOf(s), rng: seedRng(1) })
      expect(roundTrip(det, 0)).toBeGreaterThan(0)
    }
  })

  it('rejects an answer this world does not offer, even when every ref in it resolves', () => {
    const a = clause('T:etb', [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'opponent' }, then: [{ kind: 'dull' }] }])
    let s = makeGame({ defs: [...VANILLA_POOL, bearer('X-SRC', a)] })
    let src: CardId
    ;[s, src] = withField(s, 0, 'backups', 'X-SRC')
    ;[s] = withField(s, 0, 'forwards', 'V-F1')   // mine: a real card, never a candidate for this clause
    ;[s] = withField(s, 1, 'forwards', 'V-F5')   // the opponent's: the only thing that may be chosen
    s = arm(s, src, 0, a)
    const v = viewFor(s, 0)
    expect(v.pending?.kind).toBe('chooseTargets')
    expect(decodeAction(v, 'chooseTargets|p0|f1:0')).toEqual({ type: 'chooseTargets', player: 0, targets: [v.fields[1].forwards[0]!.id] })
    expect(decodeAction(v, 'chooseTargets|p0|f0:0')).toBeNull()        // resolves, but is not offered here
    expect(decodeAction(v, 'chooseTargets|p0|f1:0,f0:0')).toBeNull()   // over the prompt's max
    expect(decodeAction(v, 'chooseTargets|p1|f1:0')).toBeNull()        // not the player who owes the answer
    expect(decodeAction(v, 'chooseMode|p0|0')).toBeNull()              // not the decision this world is asking
    expect(decodeAction(v, 'pass|p0')).toBeNull()                      // a prompt is outstanding: pass is not legal
    // ...and a mode answer is bounded by the prompt's own printed labels, not by whatever the key claims.
    const withModes: PlayerView = { ...v, pending: { kind: 'chooseMode', player: 0, min: 1, max: 1, labels: ['a', 'b'] } }
    expect(decodeAction(withModes, 'chooseMode|p0|1')).toEqual({ type: 'chooseMode', player: 0, modes: [1] })
    expect(decodeAction(withModes, 'chooseMode|p0|2')).toBeNull()
    expect(decodeAction(withModes, 'chooseMode|p0|0,1')).toBeNull()
    // ...and a discard answers exactly the count the prompt demands.
    const withDiscard: PlayerView = { ...v, pending: { kind: 'discardToHandSize', player: 0, count: 2 } }
    const [c0, c1] = [v.cards[v.hand[0]!]!.code, v.cards[v.hand[1]!]!.code]
    expect(decodeAction(withDiscard, `discardToHandSize|p0|h:${c0}`)).toBeNull()               // one, where two are owed
    expect(decodeAction(withDiscard, `discardToHandSize|p0|h:${c0},h:${c1}`)).not.toBeNull()   // a repeated ref decodes to two DISTINCT copies
  })

  it('returns null when the key names something this world does not contain', () => {
    let s = makeGame()
    let f: CardId
    ;[s, f] = withField(s, 0, 'forwards', 'V-F1')
    const v = viewFor(s, 0)
    expect(decodeAction(v, 'declareAttack|p0|f0:9')).toBeNull()                 // no such position here
    expect(decodeAction(v, 'castCharacter|p0|h:NOT-A-CODE#1||')).toBeNull()     // no such card in hand
    expect(decodeAction(v, `castCharacter|p0|h:${v.cards[v.hand[0]!]!.code}#9||`)).toBeNull()   // not that many copies
    expect(decodeAction(v, 'castCharacter|p0|?||')).toBeNull()                  // an opaque ref names nothing
    expect(decodeAction(v, 'declareBlock|p0|f0:0')).toBeNull()                  // no block is owed in this world
    expect(decodeAction(v, 'nonsense|p0|x')).toBeNull()
    expect(decodeAction(v, '')).toBeNull()
    expect(decodeAction(v, `declareAttack|p2|f0:${f}`)).toBeNull()
    // concede is legal from any position (§2.1), so it always decodes.
    expect(decodeAction(v, 'concede|p1')).toEqual({ type: 'concede', player: 1 })
  })
})

// ---------------------------------------------------------------------------
// observationKey (contract 6)
// ---------------------------------------------------------------------------

/** Shift EVERY id in a view by `n`. If `observationKey` leaks a single raw id — in `attack`, in `pending`, in a
 *  resolution frame or its trigger event — the shifted view keys differently and the invariance test fails. */
function remapIds(view: PlayerView, n: number): PlayerView {
  const m = (id: CardId): CardId => id + n
  const cards: PlayerView['cards'] = {}
  for (const [k, inst] of Object.entries(view.cards)) cards[m(Number(k))] = { ...inst, id: m(inst.id) }
  const res = view.resolution
  const frame = (f: Frame): Frame => ({
    ...f,
    source: m(f.source),
    chosen: f.chosen.map(m),
    triggerEvent: f.triggerEvent === null ? null
      : f.triggerEvent.kind === 'damage'
        ? { ...f.triggerEvent, source: m(f.triggerEvent.source), target: f.triggerEvent.target === null ? null : m(f.triggerEvent.target) }
        : { ...f.triggerEvent, card: m(f.triggerEvent.card) },
  })
  return {
    ...view,
    hand: view.hand.map(m),
    cards,
    fields: view.fields.map((f) => ({
      ...f,
      forwards: f.forwards.map((c) => ({ ...c, id: m(c.id) })),
      backups: f.backups.map((c) => ({ ...c, id: m(c.id) })),
      damageZone: f.damageZone.map(m),
      breakZone: f.breakZone.map(m),
    })) as PlayerView['fields'],
    attack: view.attack === null ? null : { ...view.attack, attackers: view.attack.attackers.map(m), blocker: view.attack.blocker === null ? null : m(view.attack.blocker) },
    pending: view.pending === null ? null : view.pending.kind === 'chooseTargets' ? { ...view.pending, candidates: view.pending.candidates.map(m) } : view.pending,
    resolution: { ...res, active: res.active === null ? null : frame(res.active), queue: res.queue.map(frame) },
  }
}

/** A view with an id in every site the digest has to hide: both fields, a damage zone, a break zone, an
 *  attack with a blocker, a `chooseTargets` pending, and a resolution agenda with both trigger-event shapes. */
function richView(): { view: PlayerView; ids: Record<string, CardId> } {
  let s = makeGame()
  let a1: CardId, a2: CardId, d1: CardId, b1: CardId, z1: CardId
  ;[s, a1] = withField(s, 0, 'forwards', 'V-F2')
  ;[s, a2] = withField(s, 0, 'forwards', 'V-F5')
  ;[s, d1] = withField(s, 1, 'forwards', 'V-F7')
  ;[s, b1] = withField(s, 0, 'backups', 'V-B1')
  ;[s, z1] = withBreakZone(s, 1, 'V-F1')
  s = hurt(s, 1, 2)
  const base = viewFor(s, 0)
  const view: PlayerView = {
    ...base,
    attack: { step: 'damage', attackers: [a1, a2], blocker: d1 },
    pending: { kind: 'chooseTargets', player: 0, min: 1, max: 2, candidates: [d1, a1] },
    resolution: {
      active: { abilityId: 'X-SRC:etb', source: b1, controller: 0, path: [0, 1], chosen: [a1, d1], modes: [1], triggerEvent: { kind: 'damage', source: a2, sourceController: 0, target: d1, victim: null, amount: 3000 } },
      queue: [{ abilityId: 'Y-SRC:etb', source: a1, controller: 1, path: [], chosen: [], modes: [], triggerEvent: { kind: 'zoneChange', card: z1, from: 'field', to: 'breakZone', controller: 1, owner: 1 , reason: 'ability'} }],
      continuation: 'enterAttackDeclaration',
      steps: 7,
    },
  }
  return { view, ids: { a1, a2, d1, b1, z1 } }
}

describe('chooseFromDeck keys name the CARD, not the position (rung C9)', () => {
  /**
   * Codex's C9 findings 1, 2 and 7. The key tests could not reach a deck prompt at all — `VANILLA_POOL` has no
   * abilities, so no trace produces one, and the synthetic prompt fixture covered only targets and modes. So
   * every property below was unasserted, and the index-based key and the unvalidated decoder both survived.
   *
   * A deck prompt is built directly here. That is the right level: these are key tests, not engine tests.
   */
  const CODES = ['V-F1', 'V-F2', 'V-B1'] as const

  /** A view where `chooser`'s top three are `order`, all known to `chooser`, with a deck prompt owed. */
  function deckPrompt(order: readonly string[], chooser: PlayerId = 0, filter?: TargetFilter): PlayerView {
    const base = viewFor(makeGame(), 0)
    const ids = order.map((_, i) => 8000 + i)
    const cards = { ...base.cards }
    order.forEach((code, i) => { cards[ids[i] as CardId] = { id: ids[i] as CardId, code, owner: chooser } })
    const fields = [base.fields[0], base.fields[1]] as PlayerView['fields']
    fields[chooser] = {
      ...fields[chooser],
      deck: [...ids.map((id) => ({ card: id as CardId, knownBy: 1 << chooser })), ...fields[chooser].deck.slice(order.length)],
    }
    return {
      ...base, cards, fields,
      pending: { kind: 'chooseFromDeck', player: chooser, min: 0, max: 1, count: order.length, scope: 'top', to: 'hand',
        ...(filter ? { filter } : {}) },
    }
  }

  const pick = (player: PlayerId, picks: number[]): Command => ({ type: 'chooseFromDeck', player, picks })

  it('keys the same CARD identically however the world happened to order the deck', () => {
    // The false-SPLIT half. Two determinisations of one information set that sampled the chooser's deck
    // differently: taking the V-F2 is position 1 in one and position 0 in the other.
    const a = deckPrompt([CODES[0], CODES[1], CODES[2]])
    const b = deckPrompt([CODES[1], CODES[0], CODES[2]])
    expect(actionKey(a, pick(0, [1]))).toBe(actionKey(b, pick(0, [0])))
  })

  it('keys DIFFERENT cards differently even when they sit in the same position', () => {
    // The false-MATCH half, and the one that actually poisons statistics: `…|0` used to mean whatever the
    // world had put on top, so two unrelated moves shared an edge.
    const a = deckPrompt([CODES[0], CODES[1], CODES[2]])
    const b = deckPrompt([CODES[1], CODES[0], CODES[2]])
    expect(actionKey(a, pick(0, [0]))).not.toBe(actionKey(b, pick(0, [0])))
  })

  it('round-trips through the decoder into a command legal in THIS world', () => {
    const a = deckPrompt([CODES[0], CODES[1], CODES[2]])
    const b = deckPrompt([CODES[1], CODES[0], CODES[2]])
    const key = actionKey(a, pick(0, [1]))
    // Decoded against the OTHER world it must land on that world's copy of the same card, not on position 1.
    expect(decodeAction(b, key)).toEqual(pick(0, [0]))
    expect(decodeAction(a, key)).toEqual(pick(0, [1]))
  })

  it('decodes the empty answer only when declining is legal', () => {
    const v = deckPrompt([CODES[0]])
    expect(decodeAction(v, `chooseFromDeck|p0|`)).toEqual(pick(0, []))
    const mustTake = { ...v, pending: { ...v.pending, min: 1 } } as PlayerView
    expect(decodeAction(mustTake, `chooseFromDeck|p0|`)).toBeNull()
  })

  it('returns null rather than an illegal answer — contract 5', () => {
    const v = deckPrompt([CODES[0], CODES[1], CODES[2]])
    const one = actionKey(v, pick(0, [0]))
    // A card this world does not have in those slots.
    expect(decodeAction(deckPrompt(['V-F5', 'V-F7', 'V-B2']), one)).toBeNull()
    // More picks than `max` allows.
    expect(decodeAction(v, actionKey(v, pick(0, [0, 1])))).toBeNull()
    // A card the printed filter excludes — the decoder must apply it, exactly as `applyChooseFromDeck` does.
    const backupsOnly = deckPrompt([CODES[0], CODES[1], CODES[2]], 0, { type: 'backup' })
    expect(decodeAction(backupsOnly, actionKey(backupsOnly, pick(0, [0])))).toBeNull()
    expect(decodeAction(backupsOnly, actionKey(backupsOnly, pick(0, [2])))).toEqual(pick(0, [2]))
  })
})

describe('observationKey (contract 6)', () => {
  it('hides every id — a wholesale renumbering produces the identical key', () => {
    const { view, ids } = richView()
    expect(Object.values(ids).length).toBeGreaterThan(0)
    for (const shift of [1, 50_000, 900_000]) {
      const shifted = remapIds(view, shift)
      expect(JSON.stringify(shifted)).not.toBe(JSON.stringify(view))   // the fixture really did renumber
      expect(observationKey(shifted)).toBe(observationKey(view))
    }
    // A substring hunt for raw ids is not the assertion to make here — small ids collide with damage amounts and
    // step counts. Invariance under three different shifts is the sound form of "no id survives", and the
    // sibling test below is what stops it being satisfied by dropping the sites altogether.
  })

  it('and every id site is genuinely READ — invariance is not achieved by ignoring them', () => {
    const { view, ids } = richView()
    const key = observationKey(view)
    const active = view.resolution.active!
    // Each variant swaps ONE id site for a DIFFERENT card that is also in the view, so the ref changes and the
    // key must change with it. Together with the renumbering test above, this pins each site to a real `CardRef`:
    // a site that were dropped from the digest would pass the invariance test and fail here.
    const swaps: [string, PlayerView][] = [
      ['attack.attackers', { ...view, attack: { ...view.attack!, attackers: [ids.d1!, ids.a2!] } }],
      ['attack.blocker', { ...view, attack: { ...view.attack!, blocker: ids.a1! } }],
      ['pending.candidates', { ...view, pending: { kind: 'chooseTargets', player: 0, min: 1, max: 2, candidates: [ids.a2!, ids.a1!] } }],
      ['frame.source', { ...view, resolution: { ...view.resolution, active: { ...active, source: ids.a1! } } }],
      ['frame.chosen', { ...view, resolution: { ...view.resolution, active: { ...active, chosen: [ids.a2!, ids.d1!] } } }],
      ['frame.triggerEvent.source', { ...view, resolution: { ...view.resolution, active: { ...active, triggerEvent: { kind: 'damage', source: ids.b1!, sourceController: 0, target: ids.d1!, victim: null, amount: 3000 } } } }],
      ['frame.triggerEvent.target', { ...view, resolution: { ...view.resolution, active: { ...active, triggerEvent: { kind: 'damage', source: ids.a2!, sourceController: 0, target: ids.a1!, victim: null, amount: 3000 } } } }],
      ['queued frame.triggerEvent.card', { ...view, resolution: { ...view.resolution, queue: [{ ...view.resolution.queue[0]!, triggerEvent: { kind: 'zoneChange', card: ids.d1!, from: 'field', to: 'breakZone', controller: 1, owner: 1 , reason: 'ability'} }] } }],
      ['frame.triggerEvent enteredField', { ...view, resolution: { ...view.resolution, active: { ...active, triggerEvent: { kind: 'enteredField', card: ids.a1!, controller: 0 } } } }],
    ]
    for (const [why, v] of swaps) expect(observationKey(v), why).not.toBe(key)
  })

  // C8's `enteredField` shape, pinned against ITSELF rather than against the baseline.
  //
  // The first attempt at this put two enteredField variants in the swaps table above, which proved nothing:
  // each is compared to the baseline, and a digest that flattened every enteredField event to a constant
  // still differed from a baseline carrying a `damage` event. Both entries passed under a deliberately
  // broken digest. Two events of the SAME kind must be compared to each other.
  it('distinguishes two enteredField events from one another', () => {
    const { view, ids } = richView()
    const active = view.resolution.active!
    const withEvent = (card: CardId, controller: PlayerId) =>
      observationKey({ ...view, resolution: { ...view.resolution, active: { ...active, triggerEvent: { kind: 'enteredField', card, controller } } } })

    expect(withEvent(ids.a1!, 0)).not.toBe(withEvent(ids.a2!, 0))   // different card
    expect(withEvent(ids.a1!, 0)).not.toBe(withEvent(ids.a1!, 1))   // different controller
    expect(withEvent(ids.a1!, 0)).toBe(withEvent(ids.a1!, 0))       // and canonical
  })

  it('but not what the root can actually see', () => {
    const { view, ids } = richView()
    const key = observationKey(view)
    const differs = (v: PlayerView, why: string): void => expect(observationKey(v), why).not.toBe(key)
    const f0 = view.fields[0]
    differs({ ...view, turn: view.turn + 1 }, 'turn')
    differs({ ...view, phase: 'main2' }, 'phase')
    differs({ ...view, priority: 1 }, 'priority')
    differs({ ...view, fields: [{ ...f0, deck: f0.deck.slice(1) }, view.fields[1]] }, 'my deck count')
    // C9: two states differing only in WHAT a player knows about their own deck are different information
    // sets, and the digest must say so — a bare count could not.
    differs({ ...view, fields: [{ ...f0, deck: [{ card: null, knownBy: 1 }, ...f0.deck.slice(1)] }, view.fields[1]] }, 'my top card is known to me')
    differs({ ...view, fields: [f0, { ...view.fields[1], deck: [{ card: null, knownBy: 2 }, ...view.fields[1].deck.slice(1)] }] }, 'opponent knows their top card')
    // ...and the mask still counts when the card IS visible. A card only I know, versus the same card the
    // opponent knows too, are different positions — the digest dropped the mask in that branch until Codex's
    // C9 review, collapsing them.
    {
      const known = { card: f0.deck[0]?.card ?? ids.d1!, knownBy: 1 }
      const shared = { ...known, knownBy: 3 }
      const withSlot = (sl: typeof known): PlayerView => ({ ...view, fields: [{ ...f0, deck: [sl, ...f0.deck.slice(1)] }, view.fields[1]] })
      expect(observationKey(withSlot(known)), 'the mask on a VISIBLE slot was dropped').not.toBe(observationKey(withSlot(shared)))
    }
    differs({ ...view, fields: [f0, { ...view.fields[1], handCount: 99 }] }, "opponent's hand size")
    // C10: two positions differing only in whether a once-per-turn ability is still available, or in WHICH of
    // two same-code Break Zone cards is retrievable, are different information sets.
    differs({ ...view, fields: [{ ...f0, forwards: f0.forwards.map((c, i) => (i === 0 ? { ...c, usedThisTurn: ['X:once'] } : c)) }, view.fields[1]] }, 'a spent once-per-turn ability')
    {
      // TWO DISTINCT ids of the SAME code. The first version of this test put one id in both slots, which
      // makes "only one of them retrievable" unrepresentable — `bzEntry` tests id membership, so both slots
      // are marked or neither is. It therefore compared "none eligible" against "both eligible" and pinned
      // only "eligibility appears somewhere", leaving a code-SET encoding green. Same-code duplicates in one
      // Break Zone are ordinary: the starter deck runs three copies of several cards.
      const a = 8100 as CardId
      const b = 8101 as CardId
      const cards = { ...view.cards, [a]: { id: a, code: 'V-F1', owner: 0 as PlayerId }, [b]: { id: b, code: 'V-F1', owner: 0 as PlayerId } }
      const withBz = (elig: readonly CardId[]): PlayerView => ({
        ...view, cards,
        fields: [{ ...f0, breakZone: [a, b], putIntoBreakZoneFromFieldThisTurn: elig }, view.fields[1]],
      })
      // POSITIONAL: `cardRef` names Break Zone cards `z0:0` / `z0:1`, so which one is retrievable is a
      // different legal action. By code alone these two states are indistinguishable — a FALSE MATCH.
      expect(observationKey(withBz([a])), 'Break Zone eligibility is not encoded positionally').not.toBe(observationKey(withBz([b])))
      expect(observationKey(withBz([])), 'Break Zone eligibility is not in the key at all').not.toBe(observationKey(withBz([a])))
    }
    differs({ ...view, fields: [{ ...f0, forwards: f0.forwards.map((c, i) => (i === 0 ? { ...c, damage: 3000 } : c)) }, view.fields[1]] }, 'damage on a forward')
    differs({ ...view, fields: [{ ...f0, forwards: [...f0.forwards].reverse() }, view.fields[1]] }, 'field order (it is what positional refs mean)')
    differs({ ...view, attack: { ...view.attack!, blocker: null } }, 'the blocker')
    differs({ ...view, attack: { ...view.attack!, step: 'block' } }, 'the attack step')
    differs({ ...view, pending: { kind: 'chooseTargets', player: 0, min: 2, max: 2, candidates: [ids.d1!, ids.a1!] } }, 'the prompt bounds')
    differs({ ...view, pending: { kind: 'chooseTargets', player: 1, min: 1, max: 2, candidates: [ids.d1!, ids.a1!] } }, 'who owes the prompt')
    differs({ ...view, resolution: { ...view.resolution, steps: 8 } }, 'agenda budget spent')
    differs({ ...view, resolution: { ...view.resolution, continuation: null } }, 'a queued continuation')
    differs({ ...view, resolution: { ...view.resolution, queue: [] } }, 'a queued frame')
    differs({ ...view, result: { winner: 0, cause: 'damage', reason: 'test' } }, 'the game being over')
    // Two endings with the SAME winner, differing only in how the game ended. "Over" is not enough: a
    // searcher backing up terminal values must not merge information sets that arrived by different routes.
    expect(
      observationKey({ ...view, result: { winner: 0, cause: 'damage', reason: 'player 1 has 7 damage (§12.4.1)' } }),
      'two different endings with the same winner share one key',
    ).not.toBe(observationKey({ ...view, result: { winner: 0, cause: 'deckOut', reason: 'player 1 could not draw a card (§3.1.2)' } }))
  })

  it('treats the root hand as a multiset of codes, not an ordered list of ids', () => {
    let s = makeGame()
    s = withHandSize(s, 0, 0)
    let h1: CardId, h2: CardId
    ;[s, h1] = withHand(s, 0, 'V-F1')
    ;[s, h2] = withHand(s, 0, 'V-F7')
    const v = viewFor(s, 0)
    expect(observationKey({ ...v, hand: [h2, h1] })).toBe(observationKey(v))      // order is not observable
    expect(observationKey({ ...v, hand: [h1] })).not.toBe(observationKey(v))      // content is
  })

  it('a chooseMode prompt keys its printed labels, separators and all', () => {
    const s = makeGame()
    const v = viewFor(s, 0)
    const withLabels = (labels: string[]): PlayerView => ({ ...v, pending: { kind: 'chooseMode', player: 0, min: 1, max: 1, labels } })
    expect(observationKey(withLabels(['a|b', 'c']))).not.toBe(observationKey(withLabels(['a', 'b|c'])))
  })
})

describe('KEY_CONTRACT', () => {
  it('is the documented interface, wired to the real implementations', () => {
    const s = makeGame()
    const v = viewFor(s, 0)
    expect(KEY_CONTRACT.cardRef(v, v.hand[0]!, 0)).toBe(cardRef(v, v.hand[0]!, 0))
    expect(KEY_CONTRACT.observationKey(v)).toBe(observationKey(v))
    expect(KEY_CONTRACT.actionKey(v, { type: 'pass', player: 0 })).toBe(actionKey(v, { type: 'pass', player: 0 }))
    expect(KEY_CONTRACT.decodeAction(v, 'concede|p0')).toEqual({ type: 'concede', player: 0 })
  })
})
