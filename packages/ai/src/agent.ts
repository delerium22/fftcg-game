import { nextInt, seedRng, type Command, type PlayerView, type Rng } from '@fftcg/engine'

export interface Agent {
  decide(view: PlayerView, legal: Command[]): Command
  /**
   * Whether `decide` needs the caller to pass a real `legal` array. `RandomAgent` picks uniformly among the
   * legal commands, so it always needs them (`true`, the default when unset). `GreedyAgent` scores its own
   * `candidateCommands` and computes `legalCommands` itself only in its fallback branch, so callers may pass
   * `[]` and skip that generation cost on the hot path.
   */
  needsLegalCommands?: boolean
}

export class RandomAgent implements Agent {
  private rng: Rng
  readonly needsLegalCommands = true
  constructor(seed: number) { this.rng = seedRng(seed) }
  decide(_view: PlayerView, legal: Command[]): Command {
    const options = legal.filter((c) => c.type !== 'concede')
    const pool = options.length ? options : legal
    if (!pool.length) throw new Error('no legal commands')
    const [i, next] = nextInt(this.rng, pool.length)
    this.rng = next
    return pool[i] as Command
  }
}
