import { describe, expect, it } from 'vitest'
import type { CardId, Event, GameState } from '@fftcg/engine'
import { checkInvariants, findFieldCard, legalCommands } from '@fftcg/engine'
import { makeGame, step, trace, withField, withHand } from '../harness.js'

/**
 * Rung V1-B, Layer 3: Jecht 18-129C's special ability, "Jecht Beam [S][Dull]: Choose 1 Forward. Deal it 8000 damage."
 * §11.7.1: activated like an action ability, plus discarding a card with the same name; the cost is paid all at once
 * (§11.7.10); the ability goes on the stack and the activator regains priority (§11.7.11). Charlotte's ban on action
 * abilities does not reach it.
 */

const ok = (s: GameState) => expect(checkInvariants(s)).toEqual([])
const ids = (s: GameState) => s.stack.map((i) => (i.kind === 'ability' ? i.frame.abilityId : 'summon'))

describe('scenario: Jecht Beam — a special ability under Charlotte’s ban', () => {
  it('L3 jecht-beam — with Charlotte opposite, Jecht’s action ability is refused and Jecht Beam is not; the second Jecht is discarded as the cost; 8000 breaks Cloud after both forfeit', () => {
    let s = makeGame()
    let jecht: CardId, other: CardId, cloud: CardId, charlotte: CardId
    ;[s, jecht] = withField(s, 0, 'forwards', '18-129C')
    ;[s, other] = withHand(s, 0, '18-129C')
    ;[s, cloud] = withField(s, 1, 'forwards', '27-124S')         // 7000
    ;[s, charlotte] = withField(s, 1, 'forwards', '27-128S')     // "The Forwards opponent controls cannot use action abilities."
    const names = { [jecht]: 'jecht', [other]: 'jecht2', [cloud]: 'cloud', [charlotte]: 'charlotte' }
    const log: Event[] = []
    const acts = legalCommands(s, 0).filter((c) => c.type === 'activateAbility' && c.source === jecht)
    expect(acts.some((c) => c.type === 'activateAbility' && c.abilityId === '18-129C:gains'), 'an action ability: banned').toBe(false)
    const beam = acts.find((c) => c.type === 'activateAbility' && c.abilityId === '18-129C:jecht-beam' && c.targets.includes(cloud))
    expect(beam, '§11.7: a special ability is not an action ability').toBeDefined()
    if (beam?.type !== 'activateAbility') throw new Error('unreachable')
    expect(beam.payment.sameName, '§11.7.1: the other Jecht pays the S').toBe(other)
    s = step(log, s, beam)
    expect(ids(s)).toEqual(['18-129C:jecht-beam'])
    expect(s.players[0].breakZone).toContain(other)
    expect(findFieldCard(s, jecht)?.card.status).toBe('dull')
    expect(s.priority, '§11.7.11: the activator regains priority').toBe(0)
    s = step(log, s, { type: 'pass', player: 0 }); s = step(log, s, { type: 'pass', player: 1 })
    expect(findFieldCard(s, cloud)).toBeNull()
    expect(trace(log, names)).toEqual([
      // The cost's own dull is not narrated as an effect's `dulled`; the discard follows the activation's narration.
      'activate:18-129C:jecht-beam', 'discard:jecht2', 'push:18-129C:jecht-beam',
      'damage:cloud:8000', 'resolve:18-129C:jecht-beam', 'broken:cloud',
    ])
    ok(s)
  })
})
