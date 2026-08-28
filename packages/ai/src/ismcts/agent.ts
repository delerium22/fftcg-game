import { SYNTHETIC_ID_BASE, nextInt, seedRng, type CardId, type Command, type PlayerView, type Rng } from '@fftcg/engine'
import type { Agent } from '../agent.js'
import { DEFAULT_EXPLORATION_C, DEFAULT_ITERATIONS, DEFAULT_ROLLOUT_COMMAND_CAP, searchIsmcts } from './search.js'
import type { SearchDiagnostics, SearchInput } from './keys.js'

export interface IsmctsOptions {
  /** D7: collect the rollout apply attribution. Diagnostic only; off in play. */
  profile?: boolean
  seed: number
  /** Both players' publicly declared 50-card lists — the same open-decklist assumption `determinise` documents. */
  decks: [string[], string[]]
  iterations?: number | undefined
  rolloutCommandCap?: number | undefined
  explorationC?: number | undefined
}

/** Every `CardId` a command names — the W4 guard `GreedyAgent` carries, for the same reason. */
function commandCardIds(c: Command): readonly CardId[] {
  switch (c.type) {
    case 'castCharacter': case 'castSummon': return [c.card, ...c.payment.dullBackups, ...c.payment.discards.map((d) => d.card)]
    case 'declareAttack': return c.attackers
    case 'declareBlock': return c.blocker === null ? [] : [c.blocker]
    case 'assignPartyDamage': return c.assignments.map((a) => a.target)
    case 'discardToHandSize': return c.cards
    case 'chooseTargets': return c.targets
    case 'activateAbility': return [c.source, ...c.payment.dullBackups, ...c.payment.discards.map((d) => d.card)]
    // `chooseFromDeck` answers with INDICES, so like `chooseMode` it carries no card id to check.
    case 'chooseFirst': case 'mulligan': case 'chooseMode': case 'chooseFromDeck': case 'pass': case 'concede': return []
    default: { const _exhaustive: never = c; return _exhaustive }
  }
}

/**
 * The thin stateful wrapper (D-7). Everything that decides anything lives in `searchIsmcts`, which is pure and
 * takes only a `PlayerView` plus the two declared lists — so D2 can move the search into a Web Worker by
 * posting a `SearchInput` and this class keeps working unchanged.
 *
 * The only state here is the seed stream: the tree is rebuilt from scratch every `decide` (D-8), so nothing
 * carries over between decisions and a replayed view trace replays exactly.
 */
export class IsmctsAgent implements Agent {
  private rng: Rng
  private readonly decks: [string[], string[]]
  private readonly iterations: number
  private readonly rolloutCommandCap: number
  private readonly explorationC: number
  /** D7: ask each search for its rollout apply attribution. Off unless a measurement turns it on. */
  private readonly profile: boolean
  readonly needsLegalCommands = false
  /** Last decision's counters (spec D-A4). `null` before the first `decide`, and on the non-acting fallback. */
  lastDiagnostics: SearchDiagnostics | null = null

  constructor(opts: IsmctsOptions) {
    this.rng = seedRng(opts.seed)
    this.decks = opts.decks
    this.iterations = opts.iterations ?? DEFAULT_ITERATIONS
    this.rolloutCommandCap = opts.rolloutCommandCap ?? DEFAULT_ROLLOUT_COMMAND_CAP
    this.explorationC = opts.explorationC ?? DEFAULT_EXPLORATION_C
    this.profile = opts.profile ?? false
  }

  decide(view: PlayerView, legal: Command[]): Command {
    this.lastDiagnostics = null
    const me = view.me
    // The engine never asks a non-acting player to move; `legalCommands` for one returns `[concede]` alone, so
    // there is nothing to search and `GreedyAgent`'s fallback is the same command by a longer route.
    if ((view.pending?.player ?? view.priority) !== me || view.result) {
      const fallback = legal[0]
      return fallback ?? { type: 'concede', player: me }
    }
    // A fresh stream per decision, so decision N's search is not a function of how much work decision N-1 did.
    const [seed, next] = nextInt(this.rng, 0x4000_0000)
    this.rng = next
    const input: SearchInput = {
      view,
      decks: this.decks,
      iterations: this.iterations,
      seed,
      rolloutCommandCap: this.rolloutCommandCap,
      explorationC: this.explorationC,
      ...(this.profile ? { profile: true } : {}),
    }
    const { command, diagnostics } = searchIsmcts(input)
    this.lastDiagnostics = diagnostics
    // W4: a command that escaped with a determinisation's synthetic id would be illegal in the live game and,
    // worse, would sometimes be *legal* while naming a card the search only imagined.
    for (const id of commandCardIds(command)) {
      if (id >= SYNTHETIC_ID_BASE) throw new Error(`IsmctsAgent.decide: chosen command ${command.type} references synthetic id ${id}`)
    }
    return command
  }
}
