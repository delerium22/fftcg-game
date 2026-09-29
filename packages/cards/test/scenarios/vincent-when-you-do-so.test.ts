import { describe, expect, it } from 'vitest'
import type { CardId, Event, GameState } from '@fftcg/engine'
import { checkInvariants, findFieldCard } from '@fftcg/engine'
import { FIRE_BACKUP, makeGame, step, trace, withCp, withField, withHand } from '../harness.js'

const REFLEX = '23-119R:when-you-do-so'

/**
 * Rung V1-B, Layer 3: LB Vincent 23-119R — "you may put 1 Fire Backup you control into the Break Zone. When you do so,
 * choose 1 Forward opponent controls. Deal it 9000 damage." The put is a select (min 0), `onlyIfChosen`. Since rung V1-D
 * "When you do so" is its own auto-ability (official ruling 2019-07-19, Fusilier 9-013C): it triggers when the put is
 * done, is placed on the stack after the ETB resolves with its Forward declared as it is placed, and waits for a window
 * in which the opponent may respond.
 */

const ok = (s: GameState) => expect(checkInvariants(s)).toEqual([])

function setup() {
  let s = makeGame()
  let vincent: CardId, lightning: CardId, cp: CardId[]
  ;[s, lightning] = withField(s, 1, 'forwards', '27-127S')   // 9000
  ;[s, vincent] = withHand(s, 0, '23-119R')
  ;[s, cp] = withCp(s, 0, [FIRE_BACKUP, FIRE_BACKUP, FIRE_BACKUP, FIRE_BACKUP, FIRE_BACKUP])
  const log: Event[] = []
  s = step(log, s, { type: 'castCharacter', player: 0, card: vincent, payment: { dullBackups: cp, discards: [] } })
  expect(s.pending, 'a select is not declared at placement').toBeNull()
  s = step(log, s, { type: 'pass', player: 0 }); s = step(log, s, { type: 'pass', player: 1 })
  expect(s.pending).toEqual({ kind: 'chooseTargets', player: 0, min: 0, max: 1, candidates: cp })
  return { s, log, vincent, lightning, cp, names: { [vincent]: 'vincent', [lightning]: 'lightning', [cp[0]!]: 'machinist' } }
}

describe('scenario: Vincent — "When you do so"', () => {
  it('L3 vincent-when-you-do-so — declining the put asks nothing more and deals nothing', () => {
    const { s: s0, log, lightning, cp, names } = setup()
    const s = step(log, s0, { type: 'chooseTargets', player: 0, targets: [] })
    expect(s.pending).toBeNull()
    expect(findFieldCard(s, lightning)?.card.damage).toBe(0)
    expect(s.players[0].backups.map((b) => b.id)).toEqual(cp)
    expect(trace(log, names)).toEqual(['trigger:23-119R:etb', 'push:23-119R:etb', 'resolve:23-119R:etb'])
    ok(s)
  })

  it('L3 vincent-when-you-do-so — putting a Fire Backup triggers the second clause, placed after the first; 9000 breaks the 9000 Lightning', () => {
    const { s: s0, log, lightning, cp, names } = setup()
    let s = step(log, s0, { type: 'chooseTargets', player: 0, targets: [cp[0]!] })
    expect(s.resolution.active?.abilityId, 'the reflexive clause declares as it is placed').toBe(REFLEX)
    expect(s.pending).toEqual({ kind: 'chooseTargets', player: 0, min: 1, max: 1, candidates: [lightning] })
    s = step(log, s, { type: 'chooseTargets', player: 0, targets: [lightning] })
    expect(findFieldCard(s, lightning), 'on the stack, not resolved').not.toBeNull()
    s = step(log, s, { type: 'pass', player: 0 }); s = step(log, s, { type: 'pass', player: 1 })
    expect(findFieldCard(s, lightning)).toBeNull()
    expect(trace(log, names)).toEqual([
      'trigger:23-119R:etb', 'push:23-119R:etb', 'put:machinist', 'resolve:23-119R:etb',
      `trigger:${REFLEX}`, `push:${REFLEX}`, 'damage:lightning:9000', `resolve:${REFLEX}`, 'broken:lightning',
    ])
    ok(s)
  })

  it('L3 vincent-when-you-do-so — the opponent responds after the put: Ifrit breaks the chosen Forward first, and the 9000 is cancelled (§11.11.2)', () => {
    const { s: s0, log, vincent, lightning, cp, names } = setup()
    let s = step(log, s0, { type: 'chooseTargets', player: 0, targets: [cp[0]!] })
    s = step(log, s, { type: 'chooseTargets', player: 0, targets: [lightning] })
    let ifrit: CardId, theirs: CardId[]
    ;[s, ifrit] = withHand(s, 1, '12-005C')
    ;[s, theirs] = withCp(s, 1, [FIRE_BACKUP, FIRE_BACKUP, FIRE_BACKUP, FIRE_BACKUP, FIRE_BACKUP])
    s = step(log, s, { type: 'pass', player: 0 })
    expect(s.priority, 'the window: the opponent holds priority with the 9000 waiting').toBe(1)
    s = step(log, s, { type: 'castSummon', player: 1, card: ifrit, payment: { dullBackups: theirs, discards: [] } })
    s = step(log, s, { type: 'chooseTargets', player: 1, targets: [lightning] })
    s = step(log, s, { type: 'pass', player: 1 }); s = step(log, s, { type: 'pass', player: 0 })
    expect(findFieldCard(s, lightning), 'Ifrit resolved first').toBeNull()
    s = step(log, s, { type: 'pass', player: 0 }); s = step(log, s, { type: 'pass', player: 1 })
    expect(log).toContainEqual({ type: 'stackCancelled', item: { kind: 'ability', source: vincent, abilityId: REFLEX }, reason: 'targetsGone' })
    expect(trace(log, { ...names, [ifrit]: 'ifrit' })).toEqual([
      'trigger:23-119R:etb', 'push:23-119R:etb', 'put:machinist', 'resolve:23-119R:etb', `trigger:${REFLEX}`, `push:${REFLEX}`,
      'push:summon:ifrit', 'damage:lightning:9000', 'resolve:summon:ifrit', 'broken:lightning',
      `noTarget:${REFLEX}`, `cancel:${REFLEX}`,
    ])
    expect(s.stack).toEqual([])
    ok(s)
  })
})
