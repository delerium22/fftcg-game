import { describe, expect, it } from 'vitest'
import type { Ability } from '../src/abilities.js'
import type { CardDef } from '../src/types.js'
import type { CardId, GameState } from '../src/state.js'
import { findFieldCard } from '../src/state.js'
import { apply } from '../src/apply.js'
import { castBlocker } from '../src/cast.js'
import { IllegalCommandError } from '../src/errors.js'
import { legalCommands } from '../src/legal.js'
import { checkInvariants } from '../src/invariants.js'
import { runRuleProcesses } from '../src/rules.js'
import { makeDef, makeGame, VANILLA_POOL, withField, withHand } from './helpers.js'

/**
 * Rung J4 — the field limits as rule processes (CR §7.7.3–5, §12.4.6–8). A cast that would exceed a limit is
 * refused (§7.7: the action is prohibited); a card that ARRIVES over the limit by an effect is allowed to,
 * and the rule process then repairs the field. Driven through `runRuleProcesses` directly and through
 * `apply`, whose `settle` runs it.
 */

const ok = (s: GameState) => expect(checkInvariants(s)).toEqual([])
const on = (s: GameState, id: CardId) => findFieldCard(s, id) !== null
const inBreak = (s: GameState, p: 0 | 1, id: CardId) => s.players[p].breakZone.includes(id)

/** A watcher of "put from the field into the Break Zone", any owner, any type: it must see the rule process. */
const WATCH: Ability = {
  id: 'T-WATCH:seen', trigger: { kind: 'observesZoneChange', from: 'field', to: 'breakZone', whose: 'any', of: 'forward' },
  text: 'synthetic watcher', effects: [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'self' }, then: [{ kind: 'grantKeyword', keyword: 'haste' }] }],
}
const DEFS: CardDef[] = [
  ...VANILLA_POOL,
  makeDef({ code: 'T-CLOUD-A', name: 'Cloud', generic: false, cost: 0 }),
  makeDef({ code: 'T-CLOUD-B', name: 'Cloud', generic: false, cost: 0, power: 7000 }),
  makeDef({ code: 'T-CLOUD-G', name: 'Cloud', generic: true, cost: 0 }),
  makeDef({ code: 'T-LIGHT', name: 'Warrior of Light', elements: ['light'], cost: 0 }),
  makeDef({ code: 'T-DARK', name: 'Garland', elements: ['dark'], cost: 0 }),
  makeDef({ code: 'T-DARK2', name: 'Chaos', elements: ['dark'], cost: 0 }),
  makeDef({ code: 'T-WATCH', name: 'Watcher', generic: true, cost: 0, hasAbilities: true, abilityClauses: 1, abilities: [WATCH] }),
]

describe('J4-A1 — §12.4.6: two non-generic Characters of one name under one player go to the Break Zone together', () => {
  it('both copies leave in one batch, a zone-change watcher fires for each, and nothing is "broken"', () => {
    let s = makeGame({ defs: DEFS }); let a: CardId, b: CardId, w: CardId
    ;[s, w] = withField(s, 0, 'forwards', 'T-WATCH')
    ;[s, a] = withField(s, 0, 'forwards', 'T-CLOUD-A')
    ;[s, b] = withField(s, 0, 'forwards', 'T-CLOUD-B')   // a second "Cloud", different printing — arrived by effect
    const [t, events] = runRuleProcesses(s)
    expect(on(t, a)).toBe(false); expect(on(t, b)).toBe(false)
    expect(inBreak(t, 0, a) && inBreak(t, 0, b)).toBe(true)
    expect(on(t, w), 'the watcher, a generic card of another name, stays').toBe(true)
    expect(events).toContainEqual({ type: 'putIntoBreakZone', card: a, reason: 'sameName' })
    expect(events).toContainEqual({ type: 'putIntoBreakZone', card: b, reason: 'sameName' })
    expect(events.some((e) => e.type === 'broken'), 'a rule-process removal for a name clash is not a break').toBe(false)
    // Two transitions, two occurrences for the watcher (spec C2-3), held in the triggered list for placement.
    expect(t.resolution.queue.map((f) => f.abilityId)).toEqual(['T-WATCH:seen', 'T-WATCH:seen'])
  })

  it('`settle` runs it: an `apply` on the position repairs the field before the command returns', () => {
    let s = makeGame({ defs: DEFS }); let a: CardId, b: CardId
    ;[s, a] = withField(s, 0, 'forwards', 'T-CLOUD-A')
    ;[s, b] = withField(s, 0, 'forwards', 'T-CLOUD-B')
    const t = apply(s, { type: 'pass', player: 0 }).state
    expect(on(t, a) || on(t, b)).toBe(false)
    ok(t)
  })

  it('generic copies coexist, a generic and a non-generic of one name coexist (§7.7.3.1), and the opponent’s copy is untouched', () => {
    let s = makeGame({ defs: DEFS }); let g1: CardId, g2: CardId, n: CardId, theirs: CardId
    ;[s, g1] = withField(s, 0, 'forwards', 'T-CLOUD-G')
    ;[s, g2] = withField(s, 0, 'forwards', 'T-CLOUD-G')
    ;[s, n] = withField(s, 0, 'forwards', 'T-CLOUD-A')
    ;[s, theirs] = withField(s, 1, 'forwards', 'T-CLOUD-A')
    const [t, events] = runRuleProcesses(s)
    for (const id of [g1, g2, n, theirs]) expect(on(t, id), `${id} should stay`).toBe(true)
    expect(events).toEqual([])
    ok(t)
  })

  it('a Backup clashes with a Forward of the same non-generic name', () => {
    let s = makeGame({ defs: DEFS }); let f: CardId, b: CardId
    ;[s, f] = withField(s, 0, 'forwards', 'T-CLOUD-A')
    ;[s, b] = withField(s, 0, 'backups', 'T-CLOUD-B')
    const [t] = runRuleProcesses(s)
    expect(on(t, f)).toBe(false); expect(on(t, b)).toBe(false)
    ok(t)
  })
})

describe('J4-A2 — §12.4.7: two Light and/or Dark Characters under one player go to the Break Zone', () => {
  it('a Light and a Dark together both go; one alone stays', () => {
    let s = makeGame({ defs: DEFS }); let l: CardId, d: CardId
    ;[s, l] = withField(s, 0, 'forwards', 'T-LIGHT')
    const [alone] = runRuleProcesses(s)
    expect(on(alone, l)).toBe(true)
    ;[s, d] = withField(s, 0, 'backups', 'T-DARK')
    const [t, events] = runRuleProcesses(s)
    expect(on(t, l)).toBe(false); expect(on(t, d)).toBe(false)
    expect(events).toContainEqual({ type: 'putIntoBreakZone', card: l, reason: 'lightDark' })
    expect(events).toContainEqual({ type: 'putIntoBreakZone', card: d, reason: 'lightDark' })
    ok(t)
  })
})

describe('J4-A3 — §12.4.8: six Backups — the controller chooses the extra one', () => {
  function six(): { s: GameState; backups: CardId[] } {
    let s = makeGame({ defs: DEFS })
    const backups: CardId[] = []
    for (const code of ['V-B1', 'V-B2', 'V-B3', 'V-B4', 'V-B5', 'V-B6']) { let id: CardId; [s, id] = withField(s, 0, 'backups', code); backups.push(id) }
    return { s, backups }
  }

  it('raises the pending for the controller, with the count over five', () => {
    const { s } = six()
    const [t, events] = runRuleProcesses(s)
    expect(t.pending).toEqual({ kind: 'breakExcessBackups', player: 0, count: 1 })
    expect(events).toEqual([])
    ok(t)   // six on the field is legal exactly while the choice is owed
  })

  it('offers one command per Backup, rejects a wrong count or a card that is not a Backup of theirs, and the answer leaves five', () => {
    const { s, backups } = six()
    const t = apply(s, { type: 'pass', player: 0 }).state   // `settle` raises it
    expect(t.pending).toEqual({ kind: 'breakExcessBackups', player: 0, count: 1 })
    const cmds = legalCommands(t, 0).filter((c) => c.type === 'breakExcessBackups')
    expect(cmds).toHaveLength(6)
    expect(legalCommands(t, 1).map((c) => c.type)).toEqual(['concede'])
    expect(() => apply(t, { type: 'breakExcessBackups', player: 0, cards: [] })).toThrow(IllegalCommandError)
    expect(() => apply(t, { type: 'breakExcessBackups', player: 0, cards: [backups[0]!, backups[1]!] })).toThrow(IllegalCommandError)
    expect(() => apply(t, { type: 'breakExcessBackups', player: 0, cards: [t.players[0].hand[0]!] })).toThrow(IllegalCommandError)
    expect(() => apply(t, { type: 'pass', player: 0 })).toThrow(IllegalCommandError)
    const r = apply(t, { type: 'breakExcessBackups', player: 0, cards: [backups[5]!] })
    expect(r.state.pending).toBeNull()
    expect(r.state.players[0].backups.map((c) => c.id)).toEqual(backups.slice(0, 5))
    expect(inBreak(r.state, 0, backups[5]!)).toBe(true)
    expect(r.events).toContainEqual({ type: 'putIntoBreakZone', card: backups[5], reason: 'backupLimit' })
    expect(r.state.phase, 'still the Main Phase the choice interrupted').toBe('main1')
    ok(r.state)
  })
})

describe('J4-A4 — §7.7.5: the cast that would put a second Light or Dark card on the field is refused', () => {
  it('the first is castable; the second is `lightDark`; the opponent’s does not count', () => {
    let s = makeGame({ defs: DEFS }); let light: CardId, dark: CardId
    ;[s, light] = withHand(s, 0, 'T-LIGHT')
    expect(castBlocker(s, 0, light)).toBeNull()
    ;[s] = withField(s, 1, 'forwards', 'T-DARK')
    expect(castBlocker(s, 0, light), 'the opponent’s Dark card is not on your field').toBeNull()
    ;[s] = withField(s, 0, 'backups', 'T-DARK')
    expect(castBlocker(s, 0, light)).toBe('lightDark')
    ;[s, dark] = withHand(s, 0, 'T-DARK2')   // another name, so §7.7.3's same-name guard does not fire first
    expect(castBlocker(s, 0, dark)).toBe('lightDark')
  })
})
