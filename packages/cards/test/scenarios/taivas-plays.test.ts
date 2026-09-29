import { describe, expect, it } from 'vitest'
import type { CardId, Event, GameState } from '@fftcg/engine'
import { castCheck, checkInvariants, findFieldCard, legalCommands } from '@fftcg/engine'
import { makeGame, step, trace, withField, withHand } from '../harness.js'

/**
 * Rung V1-B, Layer 3: Taivas 21-010H's "[0]: Play 1 Job Warrior or Card Name Warrior of cost 3 or less from your hand onto
 * the field. You can only use this ability during your turn and only once per turn." The play is a select made as the
 * ability resolves; playing is not casting (§15.1.1.7), so the played card's own ETB fires and nothing is paid. A second
 * copy of a name already on the field is allowed onto it by the effect and removed by §12.4.6 (plan R8).
 */

const ok = (s: GameState) => expect(checkInvariants(s)).toEqual([])
const ids = (s: GameState) => s.stack.map((i) => (i.kind === 'ability' ? i.frame.abilityId : 'summon'))
const play = (s: GameState, taivas: CardId) => legalCommands(s, 0).filter((c) => c.type === 'activateAbility' && c.source === taivas && c.abilityId === '21-010H:play')

describe('scenario: Taivas plays from hand', () => {
  it('L3 taivas-plays — the [0] goes on the stack with no target; at resolution it plays Wuk Lamat (Princess/Warrior, cost 3), whose ETB then chooses; the ability is spent for the turn', () => {
    let s = makeGame()
    let taivas: CardId, wuk: CardId, charlotte: CardId, cloud: CardId
    ;[s, taivas] = withField(s, 0, 'forwards', '21-010H')
    ;[s, wuk] = withHand(s, 0, '27-122S')
    ;[s, charlotte] = withHand(s, 0, '27-128S')   // a Knight of cost 4: not playable
    ;[s, cloud] = withField(s, 1, 'forwards', '27-124S')
    const names = { [taivas]: 'taivas', [wuk]: 'wuk', [charlotte]: 'charlotte', [cloud]: 'cloud' }
    const log: Event[] = []
    const cmds = play(s, taivas)
    expect(cmds).toHaveLength(1)
    s = step(log, s, cmds[0]!)
    expect(ids(s)).toEqual(['21-010H:play'])
    expect(s.pending, 'a select is not declared at activation').toBeNull()
    s = step(log, s, { type: 'pass', player: 0 }); s = step(log, s, { type: 'pass', player: 1 })
    expect(s.pending).toEqual({ kind: 'chooseTargets', player: 0, min: 1, max: 1, candidates: [wuk] })
    s = step(log, s, { type: 'chooseTargets', player: 0, targets: [wuk] })
    expect(findFieldCard(s, wuk), 'played, not cast').not.toBeNull()
    // Wuk Lamat's ETB is placed and declares its Forward (§11.8.9–10).
    expect(s.pending).toEqual({ kind: 'chooseTargets', player: 0, min: 1, max: 1, candidates: [cloud] })
    s = step(log, s, { type: 'chooseTargets', player: 0, targets: [cloud] })
    expect(ids(s)).toEqual(['27-122S:etb'])
    s = step(log, s, { type: 'pass', player: 0 }); s = step(log, s, { type: 'pass', player: 1 })
    expect(findFieldCard(s, cloud)?.card.damage, 'two Characters, not five: no damage').toBe(0)
    expect(play(s, taivas), 'once per turn').toEqual([])
    expect(trace(log, names)).toEqual([
      'activate:21-010H:play', 'push:21-010H:play', 'play:wuk', 'resolve:21-010H:play',
      'trigger:27-122S:etb', 'push:27-122S:etb', 'resolve:27-122S:etb',
    ])
    ok(s)
  })

  it('L3 taivas-plays — with nothing playable the [0] is still usable, resolves with no prompt, and is spent (plan R5)', () => {
    let s = makeGame()
    let taivas: CardId
    ;[s, taivas] = withField(s, 0, 'forwards', '21-010H')
    ;[s] = withHand(s, 0, '21-010H')   // a Warrior, but cost 5
    const log: Event[] = []
    s = step(log, s, play(s, taivas)[0]!)
    s = step(log, s, { type: 'pass', player: 0 }); s = step(log, s, { type: 'pass', player: 1 })
    expect(s.pending).toBeNull()
    expect(s.stack).toEqual([])
    expect(play(s, taivas)).toEqual([])
    expect(trace(log)).toEqual(['activate:21-010H:play', 'push:21-010H:play', 'resolve:21-010H:play'])
    ok(s)
  })

  it('L3 taivas-plays — a second Wuk Lamat is played onto the field, and §12.4.6 puts both copies into the Break Zone (plan R8)', () => {
    let s = makeGame()
    let taivas: CardId, standing: CardId, second: CardId
    ;[s, taivas] = withField(s, 0, 'forwards', '21-010H')
    ;[s, standing] = withField(s, 0, 'forwards', '27-122S')
    ;[s, second] = withHand(s, 0, '27-122S')
    expect(castCheck(s, 0, second), '§7.7.3: CASTING a second copy is refused').toMatch(/same name/)
    const log: Event[] = []
    s = step(log, s, play(s, taivas)[0]!)
    s = step(log, s, { type: 'pass', player: 0 }); s = step(log, s, { type: 'pass', player: 1 })
    s = step(log, s, { type: 'chooseTargets', player: 0, targets: [second] })
    expect(s.players[0].breakZone).toEqual(expect.arrayContaining([standing, second]))
    expect(log).toContainEqual({ type: 'putIntoBreakZone', card: second, reason: 'sameName' })
    expect(log).toContainEqual({ type: 'putIntoBreakZone', card: standing, reason: 'sameName' })
    ok(s)
  })

  it('L3 taivas-plays — LB Zack 22-112R cannot be cast beside Zack 27-123S: they share the name (plan R8)', () => {
    let s = makeGame()
    let lbZack: CardId
    ;[s] = withField(s, 0, 'forwards', '27-123S')
    ;[s, lbZack] = withHand(s, 0, '22-112R')
    expect(castCheck(s, 0, lbZack)).toMatch(/same name/)
  })
})
