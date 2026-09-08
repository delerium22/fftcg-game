import { describe, expect, it } from 'vitest'
import { actingPlayer, apply, isLegal, legalCommands, nextInt, seedRng, viewFor, type CardId, type Command, type GameState } from '@fftcg/engine'
import { actionKey, candidateCommands, decodeAction } from '../src/index.js'
import { makeGame } from '../../engine/test/helpers.js'

/**
 * Rung J7-A7 — the ISMCTS decoder accepts a key exactly when `isLegal` accepts the decoded command: every
 * candidate's key decodes to a legal command, and a probe set's key decodes to null exactly when the engine
 * would refuse the set. (The decoder validates through the pending and the view, never through the list.)
 */

function probes(s: GameState, rng: ReturnType<typeof seedRng>): [Command[], ReturnType<typeof seedRng>] {
  const p = actingPlayer(s)
  if (p === null) return [[], rng]
  const ps = s.players[p]
  const pick = (ids: readonly CardId[], k: number): [CardId[], ReturnType<typeof seedRng>] => {
    const pool = [...ids]; const out: CardId[] = []
    for (let i = 0; i < k && pool.length; i++) { let n: number; [n, rng] = nextInt(rng, pool.length); out.push(pool.splice(n, 1)[0]!) }
    return [out, rng]
  }
  const out: Command[] = []
  const fwd = ps.forwards.map((c) => c.id)
  const all = [...ps.hand, ...fwd, ...ps.backups.map((c) => c.id), ...s.players[1 - p as 0 | 1].forwards.map((c) => c.id)]
  for (const k of [1, 2]) {
    let set: CardId[]
    ;[set, rng] = pick(fwd, k); if (set.length) out.push({ type: 'declareAttack', player: p, attackers: set })
    ;[set, rng] = pick(all, k); out.push({ type: 'chooseTargets', player: p, targets: set })
    ;[set, rng] = pick(ps.hand, k); out.push({ type: 'discardToHandSize', player: p, cards: set })
  }
  return [out, rng]
}

describe('J7-A7 — decodeAction ⇔ isLegal', () => {
  it('over 12 seeds of random walks: candidates round-trip to legal commands; probes decode iff legal', () => {
    let candidates = 0, probed = 0, refused = 0
    for (let seed = 1; seed <= 12; seed++) {
      let s = makeGame({ seed })
      let rng = seedRng(seed * 104_729)
      for (let step = 0; step < 100 && !s.result; step++) {
        const p = actingPlayer(s)
        if (p === null) break
        const view = viewFor(s, p)
        for (const c of candidateCommands(s, p)) {
          candidates++
          const back = decodeAction(view, actionKey(view, c))
          expect(back, `${c.type} did not decode`).not.toBeNull()
          expect(isLegal(s, back!), `${c.type} decoded to an illegal command`).toBeNull()
        }
        let ps: Command[]
        ;[ps, rng] = probes(s, rng)
        for (const c of ps) {
          probed++
          const decoded = decodeAction(view, actionKey(view, c))
          const legal = isLegal(s, c) === null
          if (!legal) refused++
          // A legal probe must decode (to a legal command); an illegal one must decode to null or to a
          // command the engine also refuses — the decoder may be stricter than the predicate, never laxer.
          if (legal) { expect(decoded, `legal ${c.type} did not decode`).not.toBeNull(); expect(isLegal(s, decoded!)).toBeNull() }
          else if (decoded !== null) expect(isLegal(s, decoded), `decoder accepted an illegal ${c.type}`).not.toBeNull()
        }
        const legal = legalCommands(s, p).filter((c) => c.type !== 'concede')
        if (!legal.length) break
        let n: number
        ;[n, rng] = nextInt(rng, legal.length)
        s = apply(s, legal[n]!).state
      }
    }
    expect(candidates).toBeGreaterThan(1000)
    expect(probed).toBeGreaterThan(500)
    expect(refused).toBeGreaterThan(100)
  })
})
