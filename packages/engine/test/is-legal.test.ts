import { describe, expect, it } from 'vitest'
import type { CardId, GameState } from '../src/state.js'
import type { Command } from '../src/commands.js'
import { apply } from '../src/apply.js'
import { IllegalCommandError } from '../src/errors.js'
import { actingPlayer, isLegal, legalCommands } from '../src/legal.js'
import { nextInt, seedRng } from '../src/rng.js'
import { makeGame } from './helpers.js'

/**
 * Rung J7-A1 — `isLegal` is the one legality authority: it accepts a command exactly when `apply` does not
 * throw `IllegalCommandError`, for every listed command AND for set-shaped commands `legalCommands` did not
 * list (random subsets of the acting player's cards), over random walks on 20 seeds.
 */

const accepts = (s: GameState, c: Command): boolean => {
  try { apply(s, c); return true } catch (e) { if (e instanceof IllegalCommandError) return false; throw e }
}

/** A few set-shaped commands built from the position without `legalCommands`: some legal, most not. */
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
  const everything = [...ps.hand, ...fwd, ...ps.backups.map((c) => c.id), ...ps.breakZone, ...s.players[1 - p as 0 | 1].forwards.map((c) => c.id)]
  for (const k of [1, 2, 3]) {
    let set: CardId[]
    ;[set, rng] = pick(fwd, k); if (set.length) out.push({ type: 'declareAttack', player: p, attackers: set })
    ;[set, rng] = pick(everything, k); out.push({ type: 'chooseTargets', player: p, targets: set })
    ;[set, rng] = pick(ps.hand, k); out.push({ type: 'discardToHandSize', player: p, cards: set })
    ;[set, rng] = pick(ps.backups.map((c) => c.id), k); out.push({ type: 'breakExcessBackups', player: p, cards: set })
  }
  return [out, rng]
}

describe('J7-A1 — isLegal accepts exactly what apply accepts', () => {
  it('over 20 seeds of random walks, listed commands and unlisted set probes agree', () => {
    let listed = 0, probed = 0, unlistedAccepted = 0
    for (let seed = 1; seed <= 20; seed++) {
      let s = makeGame({ seed })
      let rng = seedRng(seed * 7919)
      for (let step = 0; step < 120 && !s.result; step++) {
        const p = actingPlayer(s)
        if (p === null) break
        const legal = legalCommands(s, p).filter((c) => c.type !== 'concede')
        if (!legal.length) break
        for (const c of legal) { listed++; expect(isLegal(s, c), `${c.type} listed but refused: ${isLegal(s, c)}`).toBeNull() }
        let ps: Command[]
        ;[ps, rng] = probes(s, rng)
        for (const c of ps) {
          probed++
          const verdict = isLegal(s, c) === null
          expect(verdict, `${c.type} ${JSON.stringify(c)}: isLegal says ${verdict}, apply says otherwise`).toBe(accepts(s, c))
          if (verdict && !legal.some((l) => JSON.stringify(l) === JSON.stringify(c))) unlistedAccepted++
        }
        let n: number
        ;[n, rng] = nextInt(rng, legal.length)
        s = apply(s, legal[n]!).state
      }
    }
    expect(listed).toBeGreaterThan(2000)
    expect(probed).toBeGreaterThan(2000)
    // The point of the predicate: it accepts legal sets the list did not spell out (an unsorted party, say).
    expect(unlistedAccepted, 'no probe was a legal command the list omitted, so the predicate proved nothing beyond the list').toBeGreaterThan(0)
  })
})
