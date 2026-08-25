import { nextInt, seedRng, type Command, type PlayerView, type Rng } from '@fftcg/engine'

export interface Agent { decide(view: PlayerView, legal: Command[]): Command }

export class RandomAgent implements Agent {
  private rng: Rng
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
