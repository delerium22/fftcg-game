import {
  actingPlayer, apply, deckSlotsFor, determinise, nextInt, seedRng, visibleKnownBy,
  type CardId, type CardInstance, type Command, type FieldView, type GameState, type PlayerId, type PlayerView, type Rng,
} from '@fftcg/engine'
import { candidateCommands } from '../candidates.js'
import { DEFAULT_WEIGHTS, evaluate, type Weights } from '../evaluate.js'
import { greedyStep, resolveForcedDecisions } from '../greedy.js'
import {
  actionKey, compareKeys, decodeAction, isOpaque, observationKey,
  type ActionKey, type ObservationKey, type SearchDiagnostics, type SearchInput, type SearchResult,
} from './keys.js'

/**
 * Single-Observer ISMCTS (spec D-1). The tree is over the ROOT player's information sets: nodes are
 * `(parent history, ActionKey, ObservationKey)`, statistics live on the ACTION EDGES, and each edge fans out
 * into one child per distinct observation the root could make afterwards (turn advancement draws cards, an
 * ability reveals what it hit, so one action does not identify one resulting information set).
 *
 * The four things this rung gets wrong invisibly — each still plays legal, plausible moves that beat random,
 * so only a unit test catches them (spec D-A2):
 *   1. draining forced decisions before the search answers the question `decide` was asked (D-3);
 *   2. availability used as a divisor instead of inside the logarithm (D-4);
 *   3. a cooperative opponent node (D-5);
 *   4. unbounded rewards, where one terminal rollout swamps every exploration term (D-5).
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * `evaluate` is an unbounded material score (±100,000 at terminals); `tanh(x / REWARD_SCALE)` squashes it onto
 * the same [0, 1] scale terminals use, so a heuristic leaf can never outrank a real win (D-5). 100 is about
 * seven Forwards' worth of material on `DEFAULT_WEIGHTS`, which keeps the interesting range — a body or two of
 * advantage — off tanh's flat tails, where every position would look identical to the search.
 */
export const REWARD_SCALE = 100

/** `C ≈ 1` (D-5). Rewards are in [0, 1], so this is the usual UCT constant for a normalised reward. */
export const DEFAULT_EXPLORATION_C = 1

/**
 * Measured on the starter matchup at the caps below: ~0.9 ms per iteration, i.e. ~185 ms per decision, of which
 * the greedy rollout is ~95 % (`rolloutApplies` runs ~375 applies per iteration against `treeApplies`' ~4).
 * Not calibrated for strength — that is the D-A1 lane's job on development seeds; this is a default that plays
 * clearly above `GreedyAgent` (66 % over 24 mirrored games at a THIRD of it) without being unusable headless.
 */
export const DEFAULT_ITERATIONS = 200

/** D-6: a cap on rollout COMMANDS, not depth — an ability cascade makes a single command arbitrarily deep. */
export const DEFAULT_ROLLOUT_COMMAND_CAP = 24

/**
 * The hard WORK bound on one rollout, in `apply` calls, covering the settlement tail the command cap cannot.
 * Measured at ~520 applies per iteration on the starter matchup at the command cap above, so this is roughly
 * 4x a normal rollout: high enough never to bind in ordinary play, low enough that a pathological cascade
 * cannot run away inside a Worker with no cancellation.
 */
export const DEFAULT_ROLLOUT_APPLY_CAP = 2048

/** Rollouts price both sides symmetrically; `greedyStep` flips it for the non-perspective player itself. */
const ROLLOUT_AGGRESSION = 0.5

// ---------------------------------------------------------------------------
// Tree
// ---------------------------------------------------------------------------

export interface SearchEdge {
  readonly key: ActionKey
  /** `N(s,a)` — times this edge was SELECTED. Incremented only along the path a simulation actually took. */
  visits: number
  /**
   * `A(s,a)` — visits to `s` at which this canonical action was in `candidateCommands` (D-4). Incremented on
   * backpropagation for EVERY available sibling, not just the selected one. This is the number that replaces
   * the parent-visit count *inside the logarithm*; an action that is legal only in rare determinisations is
   * then judged against how often it was actually offered, instead of being drowned by how often the node was
   * visited at all.
   */
  availability: number
  /** Σ of ROOT-perspective rewards backed up through this edge. Actor-awareness lives in selection, not here. */
  reward: number
  readonly children: Map<ObservationKey, SearchNode>
}

export interface SearchNode {
  /**
   * Who decides here. A function of the `ObservationKey` that created the node (it carries `priority` and the
   * whole `pending`), so it cannot legitimately differ between visits — `descend` throws if it ever does,
   * which is a direct check that the observation key is fine-grained enough to identify a decision point.
   */
  readonly actor: PlayerId
  visits: number
  readonly edges: Map<ActionKey, SearchEdge>
}

/** One selection step, kept so backpropagation knows which siblings were AVAILABLE at each node (D-4). */
export interface PathStep {
  readonly node: SearchNode
  readonly edge: SearchEdge
  readonly available: readonly ActionKey[]
}

export function createNode(actor: PlayerId): SearchNode {
  return { actor, visits: 0, edges: new Map() }
}

/** The edge for `key`, minted on demand. Availability bookkeeping creates edges for actions never selected. */
export function edgeFor(node: SearchNode, key: ActionKey): SearchEdge {
  const hit = node.edges.get(key)
  if (hit) return hit
  const made: SearchEdge = { key, visits: 0, availability: 0, reward: 0, children: new Map() }
  node.edges.set(key, made)
  return made
}

export const meanReward = (edge: SearchEdge): number => (edge.visits === 0 ? 0 : edge.reward / edge.visits)

/**
 * What the ACTOR at this node is trying to maximise (D-5). Rewards are always stored from the root player's
 * point of view, so an opponent node maximises `1 - mean`: the reflection of the root's reward on [0, 1].
 * Drop the flip and the search builds a cooperative opponent that walks into its own losses — legal, plausible
 * play that a win-rate gate cannot distinguish from a working search.
 */
export function exploitation(edge: SearchEdge, actorIsRoot: boolean): number {
  const mean = meanReward(edge)
  return actorIsRoot ? mean : 1 - mean
}

/** `UCB(s,a) = mean(s,a) + C * sqrt( log A(s,a) / N(s,a) )` (D-4), with `mean` read through the actor. */
export function ucb(edge: SearchEdge, actorIsRoot: boolean, c: number): number {
  if (edge.visits === 0) return Number.POSITIVE_INFINITY   // untried: expanded before anything is compared
  return exploitation(edge, actorIsRoot) + c * Math.sqrt(Math.log(Math.max(1, edge.availability)) / edge.visits)
}

export function backpropagate(path: readonly PathStep[], reward: number): void {
  for (const step of path) {
    step.node.visits++
    step.edge.visits++
    step.edge.reward += reward
    for (const key of step.available) edgeFor(step.node, key).availability++
  }
}

// ---------------------------------------------------------------------------
// RNG streams (D-8)
// ---------------------------------------------------------------------------

/**
 * Three streams, so a change in how many worlds get sampled cannot silently reshuffle which action gets
 * expanded, and a tie-break cannot reach back into world sampling. All three are seeded from the one `seed`,
 * so a decision is still reproducible from `(view, seed)` alone.
 */
export interface Streams { world: Rng; expand: Rng; tie: Rng }

export function makeStreams(seed: number): Streams {
  return { world: seedRng(seed), expand: seedRng((seed ^ 0x9e3779b9) >>> 0), tie: seedRng((seed + 0x85ebca6b) >>> 0) }
}

function draw<T>(items: readonly T[], streams: Streams, stream: 'expand' | 'tie' | 'world'): T {
  const [i, next] = nextInt(streams[stream], items.length)
  streams[stream] = next
  return items[i] as T
}

export interface Selection { readonly key: ActionKey; readonly expansion: boolean }

/**
 * Pick one available action at `node`. Untried actions come first (one expansion per simulation), then UCB.
 *
 * `available` is sorted with the total `compareKeys` before anything random happens: an unsorted candidate list
 * would make the uniform draw depend on the order `candidateCommands` happened to emit in THIS determinisation,
 * which is exactly the kind of hidden non-determinism D-8 is about.
 */
export function selectKey(node: SearchNode, available: readonly ActionKey[], root: PlayerId, c: number, streams: Streams): Selection {
  const keys = [...available].sort(compareKeys)
  if (keys.length === 0) throw new Error('selectKey: no available actions')
  const untried = keys.filter((k) => (node.edges.get(k)?.visits ?? 0) === 0)
  if (untried.length) return { key: draw(untried, streams, 'expand'), expansion: true }
  const actorIsRoot = node.actor === root
  let best: ActionKey[] = []
  let bestScore = Number.NEGATIVE_INFINITY
  for (const key of keys) {
    const score = ucb(edgeFor(node, key), actorIsRoot, c)
    if (score > bestScore) { bestScore = score; best = [key] }
    else if (score === bestScore) best.push(key)
  }
  return { key: best.length === 1 ? (best[0] as ActionKey) : draw(best, streams, 'tie'), expansion: false }
}

// ---------------------------------------------------------------------------
// Views without the clone
// ---------------------------------------------------------------------------

/**
 * `viewFor`'s projection minus its final `structuredClone`. The clone is ~all of a `viewFor` call (the same
 * ~100 µs the review measured for `determinise`), and the search builds one view per simulated state — so
 * cloning here would cost more than everything else in the search put together.
 *
 * Sound because nothing downstream mutates: `apply` is immutable (structural sharing), and `keys.ts` only ever
 * reads. The one thing this MUST get right is which cards are visible, because that is what makes an opponent's
 * hand card unnameable (`?`) instead of leaking into a key — so `test/ismcts-search.test.ts` asserts key-for-key
 * agreement with `viewFor` across a whole self-play trace rather than trusting the duplication.
 */
export function searchView(state: GameState, me: PlayerId): PlayerView {
  const field = (p: PlayerId): FieldView => {
    const ps = state.players[p]
    return { forwards: ps.forwards, backups: ps.backups, damageZone: ps.damageZone, breakZone: ps.breakZone, removedFromGame: ps.removedFromGame, deck: deckSlotsFor(state, p, me), handCount: ps.hand.length }
  }
  const cards: Record<CardId, CardInstance> = {}
  const see = (id: CardId): void => { const inst = state.cards[id]; if (inst) cards[id] = inst }
  for (const id of state.players[me].hand) see(id)
  for (const p of [0, 1] as const) {
    const ps = state.players[p]
    for (const c of ps.forwards) see(c.id)
    for (const c of ps.backups) see(c.id)
    for (const id of ps.damageZone) see(id)
    for (const id of ps.breakZone) see(id)
    // Removed cards are public (spec C7-1), exactly as in `viewFor`. Copying the zone onto the FieldView
    // without this made `searchView` name a card that `view.cards` had no instance for — and `determinise`
    // throws "view lacks visible card" on precisely that.
    for (const id of ps.removedFromGame) see(id)
  }
  return {
    me, turn: state.turn, turnPlayer: state.turnPlayer, phase: state.phase, attack: state.attack, priority: state.priority,
    pending: state.pending, resolution: state.resolution, result: state.result, hand: state.players[me].hand,
    fields: [field(0), field(1)], cards, knownBy: visibleKnownBy(state, cards), defs: state.defs, firstPlayer: state.firstPlayer,
    mulliganDecided: [state.players[0].mulliganDecided, state.players[1].mulliganDecided],
  }
}

// ---------------------------------------------------------------------------
// Reward and rollout
// ---------------------------------------------------------------------------

export interface Counters {
  determinisations: number
  treeApplies: number
  rolloutApplies: number
  evaluations: number
  nodes: number
  maxCommandDepth: number
}

const newCounters = (): Counters => ({ determinisations: 0, treeApplies: 0, rolloutApplies: 0, evaluations: 0, nodes: 0, maxCommandDepth: 0 })

/**
 * The root player's reward for a finished simulation, bounded to [0, 1] (D-5). Terminals are exact — 1 / 0 / ½
 * — and everything else is the squashed heuristic, so the two are commensurable.
 */
export function leafReward(state: GameState, root: PlayerId, weights: Weights = DEFAULT_WEIGHTS, counters?: Counters | undefined): number {
  if (state.result) return state.result.winner === null ? 0.5 : state.result.winner === root ? 1 : 0
  if (counters) counters.evaluations++
  return 0.5 + 0.5 * Math.tanh(evaluate(state, root, weights, ROLLOUT_AGGRESSION) / REWARD_SCALE)
}

export interface RolloutResult {
  readonly state: GameState
  readonly reward: number
  /** Commands the rollout POLICY chose. Bounded by `cap` — that is the D-6 guarantee. */
  readonly commands: number
  /** Every `apply` the rollout spent, `greedyStep`'s own candidate scoring included. The real cost number. */
  readonly applies: number
}

/**
 * Greedy play for both sides past the expansion frontier (D-6), then `evaluate`.
 *
 * `greedyStep` answers prompts here, and ONLY here — this is past the frontier, so nothing it decides can
 * consume a decision the tree was supposed to make (D-3). The cap counts chosen commands rather than applies
 * or plies because an ability cascade makes one command arbitrarily expensive and one ply arbitrarily deep.
 *
 * The final `resolveForcedDecisions` is deliberately exempt from the cap, exactly as it is in `greedyStep`
 * (greedy's W1/R4): a rollout that stops on the command after `declareAttack` would otherwise hand `evaluate` a
 * board where the attack was declared, both Forwards are dull and no damage has been dealt — which prices an
 * attack as pure loss and inverts the search's entire view of combat.
 */
export function rolloutToCap(
  state: GameState, root: PlayerId, cap: number, weights: Weights = DEFAULT_WEIGHTS,
  counters?: Counters | undefined, applyCap: number = DEFAULT_ROLLOUT_APPLY_CAP,
): RolloutResult {
  // TWO bounds, because one cannot do both jobs.
  //
  // `cap` bounds trajectory COMMANDS — how far into the future this rollout looks. It cannot bound the
  // settlement tail below, because a state owing a block, a party split or an ability target MUST be resolved
  // before `leafReward` prices it: evaluating a half-resolved position is the R4/C1/C2 defect, and stopping
  // mid-cascade to respect a command budget would reintroduce it deliberately.
  //
  // `applyCap` bounds WORK, and it is the one that actually protects a Worker from an unbounded tail. It was
  // `Infinity` — a counter, not a limit — so after the command cap the settlement tail ran without any bound
  // at all, and `greedyStep` inside it applies every candidate it scores. With a real cap, `within(budget)`
  // degrades that to scoring only the first candidate (rung A's W1 floor): the tail still COMPLETES, so the
  // leaf is always fully resolved, it just chooses more cheaply once the budget is gone. Settlement itself
  // terminates because every forced decision strictly advances, and a true cascade cycle is caught by the
  // engine's own `MAX_RESOLUTION_STEPS`.
  const budget = { used: 0, cap: applyCap }
  let s = state
  let commands = 0
  while (!s.result && commands < cap) {
    const p = actingPlayer(s)
    if (p === null) break
    const c = greedyStep(s, p, weights, ROLLOUT_AGGRESSION, budget)
    if (!c) break
    s = apply(s, c).state
    budget.used++
    commands++
  }
  if (!s.result) s = resolveForcedDecisions(s, weights, ROLLOUT_AGGRESSION, root, budget)
  if (counters) counters.rolloutApplies += budget.used
  return { state: s, reward: leafReward(s, root, weights, counters), commands, applies: budget.used }
}

// ---------------------------------------------------------------------------
// The search
// ---------------------------------------------------------------------------

export interface SearchTree {
  /** Exposed for tests (D-A2): the properties that matter here are structural, not win-rate-shaped. */
  readonly root: SearchNode
  readonly result: SearchResult
}

/** The declared list is a MULTISET (D-9); `determinise` samples in caller order, so sort a copy of each. */
const sortedDecks = (decks: SearchInput['decks']): [string[], string[]] =>
  [[...decks[0]].sort(compareKeys), [...decks[1]].sort(compareKeys)]

const actorOf = (view: PlayerView): PlayerId => view.pending?.player ?? view.priority

/**
 * Root actions best-first (D-5): most VISITS, never best mean. The visit count is the robust statistic — an
 * edge with three visits and a mean of 0.99 was lucky, not good, and picking by mean makes the search's answer
 * a hostage to whichever rollout happened to find a win first. Ties break on the total key order, so the
 * answer never depends on `Map` insertion order (D-8). Unvisited edges (available, never selected) are dropped.
 */
export function rankRootEdges(edges: readonly SearchEdge[]): SearchEdge[] {
  return edges.filter((e) => e.visits > 0).sort((a, b) => b.visits - a.visits || compareKeys(a.key, b.key))
}

export function searchTree(input: SearchInput): SearchTree {
  const root = input.view.me
  if (input.iterations < 1) throw new RangeError(`iterations must be at least 1, got ${input.iterations}`)
  if (input.view.result) throw new Error('searchIsmcts: the game is already over')
  // D-9 has this function seeing a `PlayerView` and two declared lists and nothing else; the root actor is
  // therefore read off the view, and asking it to move for anybody but `view.me` is a caller bug, not a
  // position to be searched.
  if (actorOf(input.view) !== root) throw new Error(`searchIsmcts: player ${root} is not the acting player`)

  const decks = sortedDecks(input.decks)
  const streams = makeStreams(input.seed)
  const counters = newCounters()
  const rootNode = createNode(root)
  counters.nodes++
  /** Fallback only: `decodeAction` against the LIVE view is the authority for what the root key means. */
  const rootCommands = new Map<ActionKey, Command>()

  for (let i = 0; i < input.iterations; i++) {
    const [world, nextWorld] = determinise({ view: input.view, decks, rng: streams.world })
    streams.world = nextWorld
    counters.determinisations++

    let state = world
    let view = searchView(state, root)
    let node = rootNode
    const path: PathStep[] = []
    let commands = 0

    for (;;) {
      // No `resolveForcedDecisions` anywhere in this loop (D-3). `apply` already settled the state to the next
      // decision boundary, whoever owns it — a block, a party-damage split and an ability prompt are all
      // genuine plies. Draining here would, at the root, have the rollout policy answer the very question the
      // caller asked `decide` to answer.
      if (state.result) break
      const actor = actorOf(view)
      const cands = candidateCommands(state, actor)
      if (cands.length === 0) break

      // Action keys are built from the ACTOR's view, not the root's. Every command in this pool has a public
      // effect — a cast reveals the card, a discard puts it face up in the Break Zone, attacks/blocks/targets
      // are all open — so naming the card leaks nothing the root will not observe a moment later.
      //
      // Keying an opponent cast from the ROOT's view instead collapses every hand cast onto one opaque
      // `castCharacter|p1|?|…` edge. Measured, that pooled a 1-cost Backup with an 8000 Forward, and which one
      // the world played was then drawn from the tie stream — so the modelled opponent chose among materially
      // different cards UNIFORMLY AT RANDOM at the commonest decision in the game, and the availability
      // counter went inert exactly where it exists to work (A tracked node visits, because the pooled edge was
      // available in every world). Conditioning on the determinisation is what ISMCTS already does; pricing an
      // action that only some worlds offer is precisely what `availability` is for.
      //
      // The OBSERVATION key stays root-only — that is where single-observer fairness actually lives.
      const keyView = actor === null || actor === root ? view : searchView(state, actor)
      const byKey = new Map<ActionKey, Command[]>()
      const available: ActionKey[] = []
      for (const c of cands) {
        const key = actionKey(keyView, c)
        const group = byKey.get(key)
        if (group) group.push(c)
        else { byKey.set(key, [c]); available.push(key) }
      }
      if (node === rootNode) for (const key of available) if (!rootCommands.has(key)) rootCommands.set(key, (byKey.get(key) as Command[])[0] as Command)

      const { key, expansion } = selectKey(node, available, root, input.explorationC, streams)
      const group = byKey.get(key) as Command[]
      const command = group.length === 1 ? (group[0] as Command) : draw(group, streams, 'tie')
      const edge = edgeFor(node, key)
      path.push({ node, edge, available })

      state = apply(state, command).state
      counters.treeApplies++
      commands++
      view = searchView(state, root)

      if (state.result) break
      const nextActor = actorOf(view)
      const obs = observationKey(view)
      let child = edge.children.get(obs)
      if (!child) {
        child = createNode(nextActor)
        counters.nodes++
        edge.children.set(obs, child)
      } else if (child.actor !== nextActor) {
        // Unreachable unless `observationKey` stopped identifying a decision point: the key carries `priority`
        // and the entire `pending`, which is exactly what `actorOf` reads.
        throw new Error(`ISMCTS: node actor ${child.actor} != ${nextActor} for one observation key`)
      }
      node = child
      if (expansion) break
    }

    const rollout = rolloutToCap(state, root, input.rolloutCommandCap, DEFAULT_WEIGHTS, counters)
    counters.maxCommandDepth = Math.max(counters.maxCommandDepth, commands + rollout.commands)
    backpropagate(path, rollout.reward)
  }

  if (rootCommands.size === 0) {
    // Mirrors `GreedyAgent.decide`'s R2 policy: a gap in `candidateCommands` must fail loudly rather than fall
    // through to a legal-but-catastrophic move.
    throw new Error(`searchIsmcts: no candidate commands at the root in ${input.view.phase}/${input.view.pending?.kind ?? '-'}`)
  }

  const ranked = rankRootEdges([...rootNode.edges.values()])
  const best = ranked[0]
  if (!best) throw new Error('searchIsmcts: no root action was ever visited')
  if (isOpaque(best.key)) throw new Error(`searchIsmcts: root action ${best.key} names a card the root player cannot identify`)

  // Return the command the tree actually EVALUATED, not a fresh decode of its key. Keys sort their lists
  // (order is not semantic to `apply`), but the engine preserves command order in places the search then
  // reads back: Break-Zone order after a multi-card discard, and a resolution frame's `chosen` binding. So a
  // decode could hand back `[V-F1,V-F7]` where the simulations had scored `[V-F7,V-F1]` — a different
  // observation from the one the statistics were gathered on. `rootCommands` holds the real candidate that
  // produced this key, and the root player's own cards keep their live ids through determinisation (only
  // hidden cards are re-minted), so it is already a live command. Decoding stays as the fallback.
  const command = rootCommands.get(best.key) ?? decodeAction(input.view, best.key)
  if (!command) throw new Error(`searchIsmcts: root action ${best.key} does not decode against the live view`)

  // What the counters mean (D-A4), because two of them are easy to misread: `rolloutApplies` includes the
  // applies `greedyStep` spends scoring its own candidates — that is where ~95 % of the time goes, so counting
  // only the commands it chose would report a cost an order of magnitude below the real one. `evaluations`
  // counts the search's own leaf evaluations only (one per simulation that did not end in a terminal), not
  // greedy's internal ones, which track its applies. `maxCommandDepth` is tree commands plus rollout commands.
  const diagnostics: SearchDiagnostics = {
    determinisations: counters.determinisations,
    treeApplies: counters.treeApplies,
    rolloutApplies: counters.rolloutApplies,
    evaluations: counters.evaluations,
    nodes: counters.nodes,
    maxCommandDepth: counters.maxCommandDepth,
    rootChildren: ranked.map((e) => [e.key, e.visits, meanReward(e)] as const),
  }
  return { root: rootNode, result: { command, diagnostics } }
}

/** The pure, synchronous, structured-cloneable search seam (D-7). `searchTree` is the same run with its tree. */
export function searchIsmcts(input: SearchInput): SearchResult {
  return searchTree(input).result
}
