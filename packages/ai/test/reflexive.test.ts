import { describe, expect, it } from 'vitest'
import { actingPlayer, apply, checkInvariants, createGame, legalCommands, viewFor, type Ability, type CardDef, type CardId, type Command, type Event, type GameState } from '@fftcg/engine'
import { RandomAgent, type Agent } from '../src/agent.js'
import { candidateCommands } from '../src/candidates.js'
import { GreedyAgent } from '../src/greedy.js'
import { IsmctsAgent } from '../src/ismcts/agent.js'
import { VANILLA_POOL, deckOf, makeDef, makeGame, withField, withHand } from '../../engine/test/helpers.js'

/**
 * Rung V1-D (plan D-D2, R2): the AI and "When you do so". The select that fires a reflexive clause is priced THROUGH that
 * clause's effects — Vincent's 9000 on the best opposing Forward — so the "you may" put is taken when it buys a kill;
 * priced by the put alone it would always be declined. And the reflexive clause is just another stack item, which
 * random, greedy and ISMCTS play through under strict self-play.
 */

const ETB: Ability = {
  id: 'T-VINC:etb', trigger: { kind: 'enterField' }, text: 'synthetic: you may put 1 Fire Backup you control into the Break Zone.',
  effects: [{
    kind: 'chooseTargets', select: 'self', onlyIfChosen: true, min: 0, max: 1,
    from: { zone: 'backups', controller: 'self', filter: { element: 'fire' } },
    then: [{ kind: 'putIntoBreakZone' }, { kind: 'triggerReflexive', abilityId: 'T-VINC:when-you-do-so' }],
  }],
}
const REFLEX: Ability = {
  id: 'T-VINC:when-you-do-so', trigger: { kind: 'reflexive' }, text: 'When you do so, choose 1 Forward opponent controls. Deal it 9000 damage.',
  effects: [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'opponent' }, then: [{ kind: 'damage', amount: 9000 }] }],
}
const DEFS: CardDef[] = [
  ...VANILLA_POOL,
  makeDef({ code: 'T-VINC', elements: ['fire'], cost: 1, power: 7000, hasAbilities: true, abilityClauses: 2, abilities: [ETB, REFLEX] }),
  makeDef({ code: 'T-FB', type: 'backup', elements: ['fire'], cost: 1, power: null }),
  makeDef({ code: 'T-FB2', type: 'backup', elements: ['fire'], cost: 2, power: null }),
]

/** Vincent cast for free onto a board with one Fire Backup; both pass; the select is asked. */
function atSelect(victim: boolean): { s: GameState; fb: CardId } {
  let s = makeGame({ defs: DEFS })
  let fb: CardId, vinc: CardId
  if (victim) [s] = withField(s, 1, 'forwards', 'V-F7')   // 8000: the 9000 kills it
  ;[s, fb] = withField(s, 0, 'backups', 'T-FB')
  ;[s, vinc] = withHand(s, 0, 'T-VINC')
  s = { ...s, defs: { ...s.defs, 'T-VINC': { ...s.defs['T-VINC']!, cost: 0 } } }
  s = apply(s, { type: 'castCharacter', player: 0, card: vinc, payment: { dullBackups: [], discards: [] } }).state
  s = apply(apply(s, { type: 'pass', player: 0 }).state, { type: 'pass', player: 1 }).state
  expect(s.pending).toEqual({ kind: 'chooseTargets', player: 0, min: 0, max: 1, candidates: [fb] })
  return { s, fb }
}

describe('V1-D — the AI prices a select through the reflexive clause it fires (R2)', () => {
  it('puts the Fire Backup when the reflexive 9000 has a Forward to kill', () => {
    const { s, fb } = atSelect(true)
    expect(candidateCommands(s, 0)[0]).toEqual({ type: 'chooseTargets', player: 0, targets: [fb] })
  })

  it('declines when there is nothing for the reflexive clause to hit', () => {
    const { s } = atSelect(false)
    expect(candidateCommands(s, 0)[0]).toEqual({ type: 'chooseTargets', player: 0, targets: [] })
  })
})

describe('V1-D — strict self-play with a reflexive clause', () => {
  // Three Fire Backups' worth of codes up front, so a Vincent with a Backup to put is common enough to reach.
  const DECK = deckOf(['T-VINC', 'T-FB', 'T-FB2', ...VANILLA_POOL.map((d) => d.code)])
  const DECKS: [string[], string[]] = [DECK, DECK]

  /** One game under the self-play harness's strict checks (no mutation, invariants, no dead end); returns its events. */
  function play(seed: number, agents: readonly [Agent, Agent]): Event[] {
    let s = createGame({ seed, decks: DECKS, defs: DEFS })
    const log: Event[] = []
    for (let i = 0; i < 3000 && !s.result; i++) {
      const p = actingPlayer(s)
      if (p === null) break
      const agent = agents[p]!
      const before = JSON.stringify(s)
      const cmd: Command = agent.decide(viewFor(s, p), agent.needsLegalCommands === false ? [] : legalCommands(s, p))
      const r = apply(s, cmd)
      expect(JSON.stringify(s), `apply mutated its input at step ${i}`).toBe(before)
      s = r.state
      log.push(...r.events)
      expect(checkInvariants(s), `invariants after step ${i}`).toEqual([])
      if (!s.result) expect(legalCommands(s, actingPlayer(s)!).some((c) => c.type !== 'concede'), `dead end after step ${i}`).toBe(true)
    }
    expect(s.result, `seed ${seed} reached a result`).not.toBeNull()
    return log
  }
  const reflexives = (log: readonly Event[]): number => log.filter((e) => e.type === 'abilityTriggered' && e.abilityId === 'T-VINC:when-you-do-so').length

  it('random and greedy games complete, and the reflexive clause is reached', () => {
    let fired = 0
    for (let seed = 1; seed <= 3; seed++) {
      fired += reflexives(play(seed, [new GreedyAgent({ seed, decks: DECKS }), new RandomAgent(seed)]))
      fired += reflexives(play(seed + 10, [new RandomAgent(seed), new GreedyAgent({ seed, decks: DECKS })]))
    }
    expect(fired, 'no game reached the reflexive clause — the check proved nothing').toBeGreaterThan(0)
  })

  it('small ISMCTS games complete, and the reflexive clause is reached', () => {
    let fired = 0
    for (const seed of [1, 2, 3]) fired += reflexives(play(seed, [new IsmctsAgent({ seed, decks: DECKS, iterations: 4 }), new GreedyAgent({ seed, decks: DECKS })]))
    expect(fired, 'no ISMCTS game reached the reflexive clause').toBeGreaterThan(0)
  }, 60_000)
})
