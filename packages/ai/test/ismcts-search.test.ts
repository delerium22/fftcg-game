import { describe, expect, it } from 'vitest'
import {
  SYNTHETIC_ID_BASE, actingPlayer, apply, createGame, drainResolution, enqueueTrigger, legalCommands, seedRng, shuffle, viewFor,
  type Ability, type CardDef, type CardId, type Command, type Effect, type GameState, type PlayerId, type PlayerView,
} from '@fftcg/engine'
import { candidateCommands } from '../src/candidates.js'
import { GreedyAgent } from '../src/greedy.js'
import { actionKey, compareKeys, decodeAction, observationKey, type ActionKey, type ObservationKey, type SearchInput } from '../src/ismcts/keys.js'
import {
  DEFAULT_EXPLORATION_C, backpropagate, createNode, edgeFor, exploitation, leafReward, makeStreams, meanReward,
  rankRootEdges, rolloutToCap, searchIsmcts, searchTree, searchView, selectKey, ucb,
  type SearchEdge, type SearchNode, type SearchTree,
} from '../src/ismcts/search.js'
import { IsmctsAgent } from '../src/ismcts/agent.js'
import { DEFAULT_DECK, VANILLA_POOL, makeDef, makeGame, withField, withHand, withHandSize } from '../../engine/test/helpers.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** The declared list as a MULTISET read off the state — `withField`/`withHand` mint instances DEFAULT_DECK lacks. */
const decksOf = (s: GameState): [string[], string[]] => ([0, 1] as const).map((p) => {
  const q = s.players[p]
  return [...q.deck, ...q.hand, ...q.forwards.map((c) => c.id), ...q.backups.map((c) => c.id), ...q.damageZone, ...q.breakZone, ...q.removedFromGame].map((id) => s.cards[id]!.code)
}) as [string[], string[]]

interface Opts { iterations?: number; seed?: number; cap?: number; c?: number; decks?: [string[], string[]] }

const inputFor = (s: GameState, me: PlayerId, o: Opts = {}): SearchInput => ({
  view: viewFor(s, me),
  decks: o.decks ?? decksOf(s),
  iterations: o.iterations ?? 200,
  seed: o.seed ?? 1,
  rolloutCommandCap: o.cap ?? 8,
  explorationC: o.c ?? DEFAULT_EXPLORATION_C,
})

const search = (s: GameState, me: PlayerId, o: Opts = {}): SearchTree => searchTree(inputFor(s, me, o))

const clause = (id: string, effects: readonly Effect[]): Ability => ({ id, trigger: { kind: 'enterField' }, text: `synthetic clause ${id}`, effects })
const bearer = (code: string, a: Ability): CardDef => makeDef({ code, type: 'backup', power: null, cost: 1, hasAbilities: true, abilityClauses: 1, abilities: [a] })
/** Put a clause on the agenda and run it until it asks its question — the state the search meets in play. */
const arm = (s: GameState, source: CardId, controller: PlayerId, a: Ability): GameState => drainResolution(enqueueTrigger(s, source, controller, a))[0] as GameState

const toAttackDeclaration = (s: GameState): GameState => apply(s, { type: 'pass', player: 0 }).state

/** A 3000 of mine against an active 7000 of theirs: attacking trades my Forward for one point of damage. */
function suicideAttackPosition(): GameState {
  let s = withHandSize(makeGame(), 0, 0)
  s = withHandSize(s, 1, 0)
  ;[s] = withField(s, 0, 'forwards', 'V-F1')   // 3000, earth
  ;[s] = withField(s, 1, 'forwards', 'V-F3')   // 7000, active, can block
  return toAttackDeclaration(s)
}

/** Two earth Forwards of mine into one big active blocker — a block here owes a party-damage split. */
function partyAttackPosition(): GameState {
  let s = withHandSize(makeGame(), 0, 0)
  s = withHandSize(s, 1, 0)
  ;[s] = withField(s, 0, 'forwards', 'V-F1')   // 3000 earth
  ;[s] = withField(s, 0, 'forwards', 'V-F5')   // 7000 earth
  ;[s] = withField(s, 1, 'forwards', 'V-F7')   // 8000 earth, active
  return toAttackDeclaration(s)
}

// ---------------------------------------------------------------------------
// Tree walking (the tests are structural — that is where this rung's risk lives, D-A2)
// ---------------------------------------------------------------------------

interface Visit { readonly obs: ObservationKey; readonly node: SearchNode; readonly via: ActionKey; readonly depth: number }

/** Every node below `root`, in a deterministic (key-sorted) order. */
function walk(root: SearchNode): Visit[] {
  const out: Visit[] = []
  const rec = (node: SearchNode, depth: number): void => {
    for (const edge of [...node.edges.values()].sort((a, b) => compareKeys(a.key, b.key))) {
      for (const [obs, child] of [...edge.children.entries()].sort((a, b) => compareKeys(a[0], b[0]))) {
        out.push({ obs, node: child, via: edge.key, depth: depth + 1 })
        rec(child, depth + 1)
      }
    }
  }
  rec(root, 0)
  return out
}

/** `kind/player` of the pending an observation key describes, or null when it describes an idle position. */
const pendingOf = (obs: ObservationKey): string | null => {
  const m = /\|pend:([A-Za-z]+)\/([01])/.exec(obs)
  return m ? `${m[1] as string}/${m[2] as string}` : null
}

/** Every `pending` a tree contains, as `kind/player`, paired with the ACTOR the node was created with. */
function pendingPlies(root: SearchNode): Map<string, Set<PlayerId>> {
  const out = new Map<string, Set<PlayerId>>()
  for (const v of walk(root)) {
    const p = pendingOf(v.obs)
    if (p === null) continue
    const set = out.get(p) ?? new Set<PlayerId>()
    set.add(v.node.actor)
    out.set(p, set)
  }
  return out
}

const bestEdgeOf = (node: SearchNode): SearchEdge =>
  [...node.edges.values()].filter((e) => e.visits > 0).sort((a, b) => b.visits - a.visits || compareKeys(a.key, b.key))[0] as SearchEdge

/** The single child under `root`'s edge `key` — the position that action leads to. */
function childUnder(root: SearchNode, key: ActionKey): SearchNode {
  const edge = root.edges.get(key)
  if (!edge) throw new Error(`no root edge ${key}; have ${[...root.edges.keys()].join(' ')}`)
  const kids = [...edge.children.values()]
  expect(kids.length).toBe(1)   // a block decision follows an attack deterministically: one observation
  return kids[0] as SearchNode
}

// ---------------------------------------------------------------------------

describe('searchView', () => {
  /** The one duplication in the search: `viewFor`'s projection without its `structuredClone`. If it ever drifts
   *  — most dangerously in WHICH cards it makes visible — every key in the tree is wrong, silently. */
  /**
   * The trace below runs on `VANILLA_POOL`, whose defs have no abilities — so nothing ever removes a card
   * from the game and the trace CANNOT reach a non-empty `removedFromGame`. C7 added that zone to
   * `searchView`'s FieldView but not to its visible-cards loop, and this guard stayed green throughout: the
   * one zone it most needed to police was the one its fixture could not produce.
   *
   * So the zones are covered explicitly first, by construction, before the trace runs.
   */
  it('projects every zone viewFor does, including ones a vanilla trace cannot reach', () => {
    let s = makeGame()
    const ps = s.players[0]
    const moved = ps.deck[0] as CardId
    const players = [s.players[0], s.players[1]] as typeof s.players
    players[0] = { ...ps, deck: ps.deck.slice(1), removedFromGame: [...ps.removedFromGame, moved] }
    s = { ...s, players }

    for (const p of [0, 1] as const) {
      expect(searchView(s, p)).toEqual(viewFor(s, p))
      expect(searchView(s, p).cards[moved], `seat ${p} lost the removed card`).toBeDefined()
    }
  })

  it('produces byte-identical keys to viewFor across a self-play trace', () => {
    let s = makeGame()
    const decks = decksOf(s)
    const agents = [new GreedyAgent({ seed: 1, decks }), new GreedyAgent({ seed: 2, decks })]
    let compared = 0
    for (let i = 0; i < 40 && !s.result; i++) {
      const actor = actingPlayer(s) as PlayerId
      for (const p of [0, 1] as const) {
        // Structural equality first: it is the WHICH-CARDS-ARE-VISIBLE half that the key comparison below
        // cannot see, because `keys.ts` reads the root's hand off `view.hand` rather than off `view.cards`.
        expect(searchView(s, p)).toEqual(viewFor(s, p))
        expect(observationKey(searchView(s, p))).toBe(observationKey(viewFor(s, p)))
        for (const c of candidateCommands(s, actor)) {
          expect(actionKey(searchView(s, p), c)).toBe(actionKey(viewFor(s, p), c))
          compared++
        }
      }
      s = apply(s, (agents[actor] as GreedyAgent).decide(viewFor(s, actor), [])).state
    }
    expect(compared).toBeGreaterThan(100)
  })
})

describe('UCB1 with availability (D-4)', () => {
  const edge = (visits: number, availability: number, reward: number): SearchEdge =>
    ({ key: 'k', visits, availability, reward, children: new Map() })

  it('is mean + C * sqrt(log A / N) — availability inside the log, never a divisor of the bonus', () => {
    const e = edge(4, 100, 2)
    expect(meanReward(e)).toBeCloseTo(0.5, 12)
    expect(ucb(e, true, 1)).toBeCloseTo(0.5 + Math.sqrt(Math.log(100) / 4), 12)
    expect(ucb(e, true, 2)).toBeCloseTo(0.5 + 2 * Math.sqrt(Math.log(100) / 4), 12)
    // The bonus must depend on A only through the logarithm: quadrupling A does NOT quarter it.
    expect(ucb(edge(4, 400, 2), true, 1)).toBeCloseTo(0.5 + Math.sqrt(Math.log(400) / 4), 12)
  })

  it('treats an untried action as infinitely urgent, and a once-available one as bonus-free', () => {
    expect(ucb(edge(0, 5, 0), true, 1)).toBe(Number.POSITIVE_INFINITY)
    expect(ucb(edge(1, 1, 0.5), true, 1)).toBeCloseTo(0.5, 12)   // log 1 = 0
  })

  it('counts availability for every compatible sibling, and visits only along the selected path', () => {
    const node = createNode(0)
    const both = ['a', 'b']
    backpropagate([{ node, edge: edgeFor(node, 'a'), available: both }], 1)
    expect(edgeFor(node, 'a')).toMatchObject({ visits: 1, availability: 1, reward: 1 })
    expect(edgeFor(node, 'b')).toMatchObject({ visits: 0, availability: 1, reward: 0 })
    expect(node.visits).toBe(1)
  })

  /**
   * The deterministic toy bandit D-A2 asks for. `rare` is offered on one visit in ten and is slightly WORSE
   * than `always`, so exploitation alone would never take it — only the exploration term can, and only if that
   * term is scaled by how often `rare` was offered rather than by how often the node was visited.
   *
   * Revision 1's "divide by availability" would leave `rare` with a bonus a hundredth the size and starve it
   * to a single visit; using the parent visit count instead of A would over-explore it. Both are invisible to a
   * win-rate gate: the search still plays legal, plausible moves either way.
   */
  it('does not starve a rarely-available action (toy bandit)', () => {
    const node = createNode(0)
    const streams = makeStreams(11)
    const REWARD: Record<string, number> = { always: 0.5, rare: 0.45 }
    for (let i = 0; i < 1000; i++) {
      const available = i % 10 === 0 ? ['always', 'rare'] : ['always']
      const { key } = selectKey(node, available, 0, 1, streams)
      expect(available).toContain(key)
      backpropagate([{ node, edge: edgeFor(node, key), available }], REWARD[key] as number)
    }
    const always = edgeFor(node, 'always')
    const rare = edgeFor(node, 'rare')
    expect(always.availability).toBe(1000)   // available at every visit, selected or not
    expect(rare.availability).toBe(100)
    expect(always.visits + rare.visits).toBe(1000)
    expect(node.visits).toBe(1000)
    expect(rare.visits).toBeGreaterThanOrEqual(60)   // measured 100/100; a divide-by-A bug leaves exactly 1
    expect(rare.visits).toBeLessThanOrEqual(100)     // it cannot be selected when it is not on offer
  })
})

describe('the final root choice (D-5)', () => {
  const edge = (key: string, visits: number, reward: number): SearchEdge => ({ key, visits, availability: visits, reward, children: new Map() })

  it('is the most-visited action, not the best mean', () => {
    const lucky = edge('lucky', 3, 2.97)      // mean 0.99 off three rollouts
    const solid = edge('solid', 100, 62)      // mean 0.62 off a hundred
    expect(meanReward(lucky)).toBeGreaterThan(meanReward(solid))
    expect(rankRootEdges([lucky, solid])[0]).toBe(solid)
    expect(rankRootEdges([solid, lucky])[0]).toBe(solid)   // and not an artefact of the argument order
  })

  it('breaks a visit tie on the total key order, never on insertion order', () => {
    const a = edge('aaa', 10, 1)
    const b = edge('bbb', 10, 9)
    expect(rankRootEdges([b, a]).map((e) => e.key)).toEqual(['aaa', 'bbb'])
    expect(rankRootEdges([a, b]).map((e) => e.key)).toEqual(['aaa', 'bbb'])
  })

  it('drops actions that were available but never selected', () => {
    expect(rankRootEdges([edge('never', 0, 0), edge('once', 1, 0.5)]).map((e) => e.key)).toEqual(['once'])
  })
})

describe('opponent nodes minimise the root reward (D-5)', () => {
  const edge = (visits: number, reward: number): SearchEdge => ({ key: 'k', visits, availability: visits, reward, children: new Map() })

  it('reads the mean through the actor', () => {
    const e = edge(10, 8)
    expect(exploitation(e, true)).toBeCloseTo(0.8, 12)
    expect(exploitation(e, false)).toBeCloseTo(0.2, 12)
  })

  it('picks the root-worst action at an opponent node and the root-best at a root node', () => {
    const build = (actor: PlayerId): SearchNode => {
      const n = createNode(actor)
      Object.assign(edgeFor(n, 'goodForRoot'), { visits: 20, availability: 20, reward: 18 })
      Object.assign(edgeFor(n, 'badForRoot'), { visits: 20, availability: 20, reward: 2 })
      return n
    }
    const streams = makeStreams(3)
    expect(selectKey(build(0), ['goodForRoot', 'badForRoot'], 0, 1, streams).key).toBe('goodForRoot')
    expect(selectKey(build(1), ['goodForRoot', 'badForRoot'], 0, 1, streams).key).toBe('badForRoot')
  })

  /**
   * The same bug at full scale. My 3000 attacks into their active 7000: a MINIMISING defender blocks and eats
   * the attacker for free, so the attack is worth less than passing. A COOPERATIVE defender would decline the
   * block to let one point of damage through, which prices the attack as pure profit and makes the search
   * declare it. The chosen root move is visibly different, which is what makes this bug win-rate-invisible but
   * unit-testable.
   */
  it('declines a suicidal attack because the defender blocks', () => {
    const s = suicideAttackPosition()
    const { root, result } = search(s, 0, { iterations: 400, cap: 12 })
    expect(result.command.type).toBe('pass')

    const attack = [...root.edges.keys()].find((k) => k.startsWith('declareAttack')) as ActionKey
    const blockNode = childUnder(root, attack)
    expect(blockNode.actor).toBe(1)
    const blocks = [...blockNode.edges.values()].filter((e) => e.visits > 0)
    expect(blocks.length).toBeGreaterThan(1)   // both blocking and declining were tried
    const chosen = bestEdgeOf(blockNode)
    expect(chosen.key).not.toBe('declareBlock|p1|-')          // the cooperative answer
    expect(chosen.key).toBe('declareBlock|p1|f1:0')
    // ...and it is chosen precisely because it is the WORST for the root, not the best.
    const declined = blockNode.edges.get('declareBlock|p1|-') as SearchEdge
    expect(meanReward(chosen)).toBeLessThan(meanReward(declined))
  })
})

describe('every Pending is a tree ply, whoever owns it (D-3)', () => {
  it('the defender owns the declareBlock ply that follows my attack, and decides it in the tree', () => {
    const { root } = search(suicideAttackPosition(), 0, { iterations: 200, cap: 6 })
    expect(pendingPlies(root).get('declareBlock/1')).toEqual(new Set([1]))
    const attack = [...root.edges.keys()].find((k) => k.startsWith('declareAttack')) as ActionKey
    // Not merely present: the block is SEARCHED. A drained pending would leave a node nothing ever chose at.
    expect([...childUnder(root, attack).edges.values()].filter((e) => e.visits > 0).length).toBeGreaterThan(1)
  })

  it('the blocking player owns the assignPartyDamage ply that follows their block', () => {
    const { root } = search(partyAttackPosition(), 0, { iterations: 600, cap: 6 })
    const plies = pendingPlies(root)
    expect(plies.get('declareBlock/1')).toEqual(new Set([1]))
    expect(plies.get('assignPartyDamage/1')).toEqual(new Set([1]))   // §10.1.4.2.1 — the DEFENDER splits
  })

  it('the turn player owns the discardToHandSize ply that follows their pass', () => {
    let s = withHandSize(makeGame(), 0, 5)
    for (const code of ['V-F1', 'V-F2']) { [s] = withHand(s, 0, code) }   // 7 cards, so the End Phase owes 2
    s = apply(apply(s, { type: 'pass', player: 0 }).state, { type: 'pass', player: 0 }).state   // -> main2
    const { root } = search(s, 0, { iterations: 200, cap: 4 })
    expect(pendingPlies(root).get('discardToHandSize/0')).toEqual(new Set([0]))
  })

  it('both players own their own mulligan ply during setup', () => {
    const s = createGame({ seed: 5, decks: [DEFAULT_DECK, DEFAULT_DECK], defs: VANILLA_POOL })
    const me = (s.pending as { player: PlayerId }).player
    const { root, result } = search(s, me, { iterations: 200, cap: 4 })
    expect(root.actor).toBe(me)
    expect(result.command.type).toBe('chooseFirst')
    const plies = pendingPlies(root)
    expect(plies.get('mulligan/0')).toEqual(new Set([0]))
    expect(plies.get('mulligan/1')).toEqual(new Set([1]))
  })

  it('an ability prompt is a ply, and so is the prompt its answer raises', () => {
    // A modal clause whose every mode then asks for a target: the chooseMode node is the root, and the
    // chooseTargets nodes it leads to are in the tree. Both belong to the ability's controller.
    const modal = clause('modal', [{
      kind: 'chooseModes', min: 1, max: 1, modes: [
        { label: 'Dull a Forward', effects: [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'any' }, then: [{ kind: 'dull' }] }] },
        { label: 'Deal it 1000 damage', effects: [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'any' }, then: [{ kind: 'damage', amount: 1000 }] }] },
      ],
    }])
    let s = makeGame({ defs: [...VANILLA_POOL, bearer('V-X1', modal)] })
    s = withHandSize(s, 0, 0)
    s = withHandSize(s, 1, 0)
    ;[s] = withField(s, 0, 'forwards', 'V-F5')
    ;[s] = withField(s, 1, 'forwards', 'V-F3')
    let src: CardId
    ;[s, src] = withField(s, 0, 'backups', 'V-X1')
    s = arm(s, src, 0, modal)
    expect(s.pending?.kind).toBe('chooseMode')

    const { root, result } = search(s, 0, { iterations: 200, cap: 4 })
    expect(root.actor).toBe(0)
    expect(result.command.type).toBe('chooseMode')   // the root prompt is answered, not skipped past
    expect(pendingPlies(root).get('chooseTargets/0')).toEqual(new Set([0]))
  })

  /** The root prompt trap: `decide` is routinely called WHILE a decision is owed, and any code path that
   *  "drains forced decisions" first would answer the question with the rollout policy and then return the
   *  command after it. */
  it('returns a BLOCK when a declareBlock is pending, not the move after it', () => {
    let s = suicideAttackPosition()
    s = apply(s, { type: 'declareAttack', player: 0, attackers: [s.players[0].forwards[0]!.id] }).state
    expect(s.pending).toEqual({ kind: 'declareBlock', player: 1 })

    const { root, result } = search(s, 1, { iterations: 200, cap: 6 })
    expect(root.actor).toBe(1)
    expect(result.command.type).toBe('declareBlock')
    for (const key of root.edges.keys()) expect(key.startsWith('declareBlock|p1|')).toBe(true)

    const agent = new IsmctsAgent({ seed: 1, decks: decksOf(s), iterations: 100 })
    expect(agent.decide(viewFor(s, 1), legalCommands(s, 1)).type).toBe('declareBlock')
  })
})

describe('rollouts are hard-bounded by a COMMAND cap (D-6)', () => {
  it('never plays more commands than the cap, at every cap', () => {
    const s = partyAttackPosition()
    for (const cap of [0, 1, 3, 12]) {
      const r = rolloutToCap(s, 0, cap)
      expect(r.commands).toBeLessThanOrEqual(cap)
      expect(r.commands).toBe(cap)   // this position is nowhere near ending, so the cap is what stops it
      expect(r.applies).toBeGreaterThanOrEqual(r.commands)
      expect(r.reward).toBeGreaterThanOrEqual(0)
      expect(r.reward).toBeLessThanOrEqual(1)
    }
  })

  /** R4, arriving by a new route: a rollout that stops the instant after `declareAttack` would hand `evaluate`
   *  a board with the attack declared, the attacker dulled and no damage dealt — pricing an attack as pure
   *  loss. The forced-decision tail is budget-exempt for exactly this reason. */
  it('settles the combat it started before scoring, even at cap 0', () => {
    let s = partyAttackPosition()
    s = apply(s, { type: 'declareAttack', player: 0, attackers: s.players[0].forwards.map((c) => c.id) }).state
    expect(s.pending?.kind).toBe('declareBlock')
    const r = rolloutToCap(s, 0, 0)
    expect(r.commands).toBe(0)
    expect(r.state.pending).toBeNull()
    expect(r.state.attack === null || r.state.attack.step === 'declaration').toBe(true)
    expect(r.applies).toBeGreaterThan(0)   // the exempt tail did real work
  })

  /**
   * ...and that tail is why a COMMAND cap alone is not a hard bound on WORK. It used to run with
   * `cap: Infinity` — a counter, not a limit — so after the command cap the settlement tail was unbounded,
   * and `greedyStep` inside it applies every candidate it scores. That is precisely the runaway a Worker
   * with no cancellation cannot survive, and it is invisible to a win-rate gate.
   */
  it('bounds WORK with a separate apply cap, and still returns a fully settled leaf', () => {
    let s = partyAttackPosition()
    s = apply(s, { type: 'declareAttack', player: 0, attackers: s.players[0].forwards.map((c) => c.id) }).state
    const generous = rolloutToCap(s, 0, 12)
    const tight = rolloutToCap(s, 0, 12, undefined, undefined, 4)

    // The cap bites: a tight budget really does less work than a generous one on the same position.
    expect(tight.applies).toBeLessThan(generous.applies)
    // But it never buys that by leaving the leaf half-resolved — which would price a declared attack that
    // dealt no damage as pure loss (R4 by another route).
    expect(tight.state.pending).toBeNull()
    expect(tight.state.resolution.active).toBeNull()
    expect(tight.state.resolution.queue).toEqual([])
    expect(tight.reward).toBeGreaterThanOrEqual(0)
    expect(tight.reward).toBeLessThanOrEqual(1)
  })

  it('bounds every reward to [0,1] with terminals exact', () => {
    const s = makeGame()
    expect(leafReward({ ...s, result: { winner: 0, reason: 'x' } }, 0)).toBe(1)
    expect(leafReward({ ...s, result: { winner: 1, reason: 'x' } }, 0)).toBe(0)
    expect(leafReward({ ...s, result: { winner: null, reason: 'x' } }, 0)).toBe(0.5)
    const r = leafReward(s, 0)
    expect(r).toBeGreaterThan(0)
    expect(r).toBeLessThan(1)
  })
})

describe('fairness is non-interference (D-9)', () => {
  /** Swap `k` cards between a player's hand and deck: their real hand changes, the opponent's view does not. */
  function swapHidden(s: GameState, p: PlayerId, k: number): GameState {
    const ps = s.players[p]
    const players: GameState['players'] = [s.players[0], s.players[1]]
    players[p] = { ...ps, hand: [...ps.deck.slice(0, k), ...ps.hand.slice(k)], deck: [...ps.hand.slice(0, k), ...ps.deck.slice(k)] }
    return { ...s, players }
  }

  it('two live states with the same view and deck multiset produce the same trace', () => {
    // No Forwards for player 0: an attack would put one of player 1's unseen cards into their damage zone,
    // which is public, and the two games would stop being the same information set after two plies.
    let a = withHandSize(makeGame(), 0, 5)
    ;[a] = withField(a, 0, 'backups', 'V-B1')
    ;[a] = withField(a, 0, 'backups', 'V-B3')
    // Different hidden hand, different deck order, different live RNG. Nothing player 0 can see changes.
    let b = swapHidden(a, 1, 4)
    b = { ...b, players: [b.players[0], { ...b.players[1], deck: shuffle(seedRng(99), b.players[1].deck)[0] }], rng: seedRng(12345) }

    expect(b.players[1].hand).not.toEqual(a.players[1].hand)
    expect(viewFor(b, 0)).toEqual(viewFor(a, 0))

    const decks = decksOf(a)
    expect([...decksOf(b)[1]].sort()).toEqual([...decks[1]].sort())
    const agents = [new IsmctsAgent({ seed: 4, decks, iterations: 60 }), new IsmctsAgent({ seed: 4, decks, iterations: 60 })]
    const sameView = (x: GameState, y: GameState): boolean => JSON.stringify(viewFor(x, 0)) === JSON.stringify(viewFor(y, 0))
    let compared = 0
    // The premise holds only while the hidden difference stays hidden — the moment one of player 1's unseen
    // cards becomes public (a card taken as damage, say) the two games are genuinely different positions.
    for (let i = 0; i < 8 && a.turnPlayer === 0 && !a.result && sameView(a, b); i++) {
      const actor = actingPlayer(a) as PlayerId
      expect(actingPlayer(b)).toBe(actor)
      if (actor === 0) {
        const ca = agents[0]!.decide(viewFor(a, 0), [])
        const cb = agents[1]!.decide(viewFor(b, 0), [])
        expect(cb).toEqual(ca)
        expect(agents[1]!.lastDiagnostics).toEqual(agents[0]!.lastDiagnostics)
        compared++
        a = apply(a, ca).state
        b = apply(b, cb).state
      } else {
        // Player 1 answers with a command that names no hidden card, so nothing is revealed by the answer.
        const c: Command = a.pending?.kind === 'declareBlock' ? { type: 'declareBlock', player: 1, blocker: null } : { type: 'pass', player: 1 }
        a = apply(a, c).state
        b = apply(b, c).state
      }
    }
    expect(compared).toBeGreaterThanOrEqual(3)
  })

  it('samples from the deck as a multiset, not in the order the caller listed it', () => {
    const s = withHandSize(makeGame(), 0, 5)
    const decks = decksOf(s)
    const rotated: [string[], string[]] = [shuffle(seedRng(7), decks[0])[0], [...decks[1]].reverse()]
    const straight = searchIsmcts(inputFor(s, 0))
    const scrambled = searchIsmcts(inputFor(s, 0, { decks: rotated }))
    expect(scrambled.command).toEqual(straight.command)
    expect(scrambled.diagnostics).toEqual(straight.diagnostics)
  })
})

describe('determinism (D-A3, D-8)', () => {
  it('two fresh same-seed agents over one view trace agree on every command and diagnostic', () => {
    let s = makeGame()
    const decks = decksOf(s)
    const views: PlayerView[] = []
    const greedy = [new GreedyAgent({ seed: 1, decks }), new GreedyAgent({ seed: 2, decks })]
    for (let i = 0; i < 24 && !s.result; i++) {
      const actor = actingPlayer(s) as PlayerId
      if (actor === 0) views.push(viewFor(s, 0))
      s = apply(s, (greedy[actor] as GreedyAgent).decide(viewFor(s, actor), [])).state
    }
    expect(views.length).toBeGreaterThan(4)

    const a = new IsmctsAgent({ seed: 9, decks, iterations: 40 })
    const b = new IsmctsAgent({ seed: 9, decks, iterations: 40 })
    for (const view of views) {
      const ca = a.decide(view, [])
      const cb = b.decide(view, [])
      expect(cb).toEqual(ca)
      expect(b.lastDiagnostics).toEqual(a.lastDiagnostics)
    }
  })

  it('rebuilds the tree per decide: the same view twice running gives the same search', () => {
    const s = withHandSize(makeGame(), 0, 5)
    const one = searchIsmcts(inputFor(s, 0, { seed: 21 }))
    const two = searchIsmcts(inputFor(s, 0, { seed: 21 }))
    expect(two).toEqual(one)
    // ...and a different seed is a genuinely different search, not the same one relabelled.
    const other = searchIsmcts(inputFor(s, 0, { seed: 22 }))
    expect(other.diagnostics.rootChildren).not.toEqual(one.diagnostics.rootChildren)
  })
})

describe('searchIsmcts', () => {
  it('fills in every diagnostic counter and accounts for every iteration at the root', () => {
    const s = withHandSize(makeGame(), 0, 5)
    const { root, result } = search(s, 0, { iterations: 150 })
    const d = result.diagnostics
    expect(d.determinisations).toBe(150)
    expect(d.treeApplies).toBeGreaterThanOrEqual(150)
    expect(d.rolloutApplies).toBeGreaterThan(0)
    expect(d.evaluations).toBeGreaterThan(0)
    expect(d.nodes).toBeGreaterThan(1)
    expect(d.maxCommandDepth).toBeGreaterThan(1)
    // Every simulation backpropagates through exactly one root edge.
    expect([...root.edges.values()].reduce((n, e) => n + e.visits, 0)).toBe(150)
    expect(root.visits).toBe(150)
    // Reported best first, and consistent with the returned command.
    const visits = d.rootChildren.map(([, v]) => v)
    expect([...visits].sort((a, b) => b - a)).toEqual(visits)
    for (const [, v, mean] of d.rootChildren) {
      expect(v).toBeGreaterThan(0)
      expect(mean).toBeGreaterThanOrEqual(0)
      expect(mean).toBeLessThanOrEqual(1)
    }
  })

  it('returns a command that is legal in the LIVE game and names no synthetic id', () => {
    let s = withHandSize(makeGame(), 0, 5)
    ;[s] = withField(s, 0, 'backups', 'V-B1')
    for (let i = 0; i < 6 && !s.result; i++) {
      const actor = actingPlayer(s) as PlayerId
      const command = actor === 0
        ? searchIsmcts(inputFor(s, 0, { iterations: 40, seed: 3 + i })).command
        : (legalCommands(s, 1).find((c) => c.type !== 'concede') as Command)
      if (actor === 0) {
        for (const id of JSON.stringify(command).match(/\d+/g) ?? []) expect(Number(id)).toBeLessThan(SYNTHETIC_ID_BASE)
        expect(legalCommands(s, 0).some((c) => JSON.stringify(c) === JSON.stringify(command))).toBe(true)
      }
      s = apply(s, command).state   // throws if the command was not legal
    }
  })

  it('refuses to search a position it is not entitled to decide', () => {
    const s = suicideAttackPosition()
    expect(() => searchIsmcts(inputFor(s, 1))).toThrow(/not the acting player/)
    expect(() => searchIsmcts(inputFor(s, 0, { iterations: 0 }))).toThrow(/iterations/)
  })

  /**
   * A deliberate, load-bearing property of a SINGLE-observer search, not an oversight. Two different cards cast
   * out of the opponent's hand share one `ActionKey` (`castCharacter|p1|?|…`) because before the card lands
   * that is genuinely all the root player knows — splitting them by the code the current determinisation
   * happens to have dealt would key the root's own tree on information the root does not have. The split comes
   * back one ply later, through the `ObservationKey`: once the card is on the field, its code is public.
   */
  it('names an opponent hand cast by its CODE, so the modelled opponent is adversarial rather than random', () => {
    // Keying an opponent cast from the ROOT's view collapsed every hand cast onto one opaque
    // `castCharacter|p0|?|…` edge — measured, that pooled a 1-cost Backup with an 8000 Forward, and which one
    // a world played was drawn from the tie stream. So at the commonest decision in the game the modelled
    // opponent chose among materially different cards UNIFORMLY AT RANDOM, and `availability` went inert
    // exactly where it exists to work, because the pooled edge was available in every world.
    //
    // Every command in this pool has a public effect — a cast reveals the card — so naming it leaks nothing
    // the root will not observe a moment later. Single-observer fairness lives in the OBSERVATION key, which
    // stays root-only, and that is asserted separately.
    let s = makeGame()
    ;[s] = withField(s, 0, 'forwards', 'V-F5')
    ;[s] = withField(s, 0, 'backups', 'V-B1')
    ;[s] = withField(s, 0, 'backups', 'V-B3')
    s = withHandSize(s, 1, 0)
    s = apply(toAttackDeclaration(s), { type: 'declareAttack', player: 0, attackers: [s.players[0].forwards[0]!.id] }).state
    const { root } = search(s, 1, { iterations: 900, cap: 4 })

    const edges = walk(root).flatMap((v) => [...v.node.edges.values()])
    const oppCasts = edges.filter((e) => /^(castCharacter|castSummon)\|p0\|/.test(e.key))
    expect(oppCasts.length, 'the fixture must actually reach the opponent casting').toBeGreaterThan(0)
    // Named, not pooled: no opponent cast may be opaque any more...
    for (const e of oppCasts) expect(e.key).not.toContain('?')
    // ...and distinct cards must be distinct edges, which is what makes minimisation able to say
    // "they will play the 8000" instead of only "they will play something".
    expect(new Set(oppCasts.map((e) => e.key)).size).toBeGreaterThan(1)
  })

  it('the root action is always one the root player can name', () => {
    const s = withHandSize(makeGame(), 0, 5)
    const { root } = search(s, 0, { iterations: 100 })
    for (const key of root.edges.keys()) expect(key).not.toContain('?')
  })
})

describe('IsmctsAgent', () => {
  it('is deterministic per seed, never concedes, and publishes its counters', () => {
    const s = withHandSize(makeGame(), 0, 5)
    const decks = decksOf(s)
    const a = new IsmctsAgent({ seed: 7, decks, iterations: 50 })
    const b = new IsmctsAgent({ seed: 7, decks, iterations: 50 })
    const ca = a.decide(viewFor(s, 0), [])
    expect(b.decide(viewFor(s, 0), [])).toEqual(ca)
    expect(ca.type).not.toBe('concede')
    expect(a.lastDiagnostics?.determinisations).toBe(50)
    expect(a.needsLegalCommands).toBe(false)
    // Successive decisions get their own stream, so decision 2 is not a replay of decision 1.
    a.decide(viewFor(s, 0), [])
    expect(a.lastDiagnostics).not.toEqual(b.lastDiagnostics)
  })

  it('takes lethal: attacks when the opponent is at 6 damage and cannot block', () => {
    let s = withHandSize(makeGame(), 0, 5)
    let f: CardId
    ;[s, f] = withField(s, 0, 'forwards', 'V-F2')
    const ps = s.players[1]
    s = { ...s, players: [s.players[0], { ...ps, damageZone: ps.deck.slice(0, 6), deck: ps.deck.slice(6) }] }
    s = toAttackDeclaration(s)
    const agent = new IsmctsAgent({ seed: 1, decks: decksOf(s), iterations: 120 })
    expect(agent.decide(viewFor(s, 0), [])).toEqual({ type: 'declareAttack', player: 0, attackers: [f] })
  })
})

describe('the returned command is the one the tree EVALUATED', () => {
  /**
   * Keys sort their lists, because order is not semantic to `apply` — but the engine PRESERVES command order
   * where the search then reads it back: Break-Zone order after a multi-card discard, and a frame's `chosen`
   * binding. Reproduced directly: a discard of `[V-F7, V-F1]` keys to `discardToHandSize|p0|h:V-F1,h:V-F7`,
   * decodes to `[V-F1, V-F7]`, and lands in the Break Zone in the OTHER order — a different `observationKey`
   * from the one every simulation scored. So the root must return the candidate it evaluated, not a re-decode.
   */
  it('a re-decode can change the observation, so the search returns the candidate itself', () => {
    let s: GameState = withHandSize(makeGame({ seed: 4 }), 0, 0)
    let a = 0
    let b = 0
    // `candidateCommands` orders a discard by ASCENDING cardValue; keys order it by CODE. These two disagree
    // — the cheap Summon is the lower value but the later code — so the candidate is genuinely not ref-sorted.
    ;[s, a] = withHand(s, 0, 'V-F8')   // 9000: high value, early code
    ;[s, b] = withHand(s, 0, 'V-S2')   // cost-1 summon: low value, late code
    s = { ...s, phase: 'end', pending: { kind: 'discardToHandSize', player: 0, count: 2 }, priority: 0 }
    const view = viewFor(s, 0)

    // First: the hazard is real on this fixture, or the rest of the test proves nothing.
    const unsorted: Command = { type: 'discardToHandSize', player: 0, cards: [b, a] }   // value order
    const decoded = decodeAction(view, actionKey(view, unsorted))
    const obs = (c: Command): ObservationKey => observationKey(viewFor(apply(s, c).state, 0))
    expect(decoded).not.toBeNull()
    expect(obs(decoded as Command), 'the fixture must actually exhibit the reorder').not.toBe(obs(unsorted))

    // Then: what the search returns is a command `candidateCommands` really offered — identically, not merely
    // up to its key — so the game gets the transition the statistics were gathered on.
    const agent = new IsmctsAgent({ seed: 3, decks: decksOf(s), iterations: 40 })
    const chosen = agent.decide(view, [])
    const cands = candidateCommands(s, 0)
    expect(cands.some((c) => JSON.stringify(c) === JSON.stringify(chosen)), `returned ${JSON.stringify(chosen)}`).toBe(true)
  })
})
