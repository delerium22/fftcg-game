import { describe, expect, it } from 'vitest'
import type { Ability, StaticEffect } from '../src/abilities.js'
import type { CardDef } from '../src/types.js'
import type { CardId, GameState } from '../src/state.js'
import { effectivePower, findFieldCard, flagsOf, keywordsOf, powerOf } from '../src/state.js'
import { apply } from '../src/apply.js'
import { attackCheck } from '../src/attack.js'
import { createGame } from '../src/setup.js'
import { runRuleProcesses } from '../src/rules.js'
import { checkInvariants } from '../src/invariants.js'
import { continuousStatics } from '../src/layer.js'
import * as filters from '../src/filters.js'
import { DEFAULT_DECK, endPhase, makeDef, makeGame, VANILLA_POOL, withField, withHand } from './helpers.js'

/**
 * Rung J6 — the continuous-effect layer (CR §11.12.4.4–5): a field ability's ongoing effect applies while
 * its source is on the field, to cards that arrive later too, and stops when the source leaves. Read only
 * through the three readers (`effectivePower`, `keywordsOf`, `flagsOf`).
 */

const ok = (s: GameState) => expect(checkInvariants(s)).toEqual([])
const fc = (s: GameState, id: CardId) => findFieldCard(s, id)!.card

const stat = (id: string, effect: StaticEffect): Ability =>
  ({ id, trigger: { kind: 'static', effect }, text: `synthetic ${id}`, effects: [] })

const DEFS: CardDef[] = [
  ...VANILLA_POOL,
  // "Forwards you control gain +1000 power."
  makeDef({ code: 'T-BANNER', type: 'backup', power: null, cost: 1, hasAbilities: true, abilityClauses: 1,
    abilities: [stat('T-BANNER:pump', { kind: 'modifyPower', amount: 1000, to: { controller: 'self', filter: { type: 'forward' } } })] }),
  // "Other Forwards you control gain Haste."
  makeDef({ code: 'T-HERALD', cost: 2, power: 3000, hasAbilities: true, abilityClauses: 1,
    abilities: [stat('T-HERALD:haste', { kind: 'grantKeyword', keyword: 'haste', to: { controller: 'self', excludeSource: true, filter: { type: 'forward' } } })] }),
  // "Forwards you control cannot be broken."
  makeDef({ code: 'T-AEGIS', type: 'backup', power: null, cost: 1, hasAbilities: true, abilityClauses: 1,
    abilities: [stat('T-AEGIS:shield', { kind: 'grantFlag', flag: 'cannotBeBroken', to: { controller: 'self', filter: { type: 'forward' } } })] }),
  // "Forwards opponent controls get −5000 power." (a debuff, for the floor and §12.4.4)
  makeDef({ code: 'T-CURSE', type: 'backup', power: null, cost: 1, hasAbilities: true, abilityClauses: 1,
    abilities: [stat('T-CURSE:drain', { kind: 'modifyPower', amount: -5000, to: { controller: 'opponent', filter: { type: 'forward' } } })] }),
  // "If you have received 3 or more damage, Forwards you control gain +2000 power."
  makeDef({ code: 'T-RALLY', type: 'backup', power: null, cost: 1, hasAbilities: true, abilityClauses: 1,
    abilities: [stat('T-RALLY:late', { kind: 'modifyPower', amount: 2000, to: { controller: 'self', filter: { type: 'forward' } }, when: { kind: 'damageReceived', atLeast: 3 } })] }),
]

describe('J6-A1 — a field ability pumps Forwards that arrive later and stops when the source leaves', () => {
  it('+1000 to your Forwards, not the opponent’s; gone with the source', () => {
    let s = makeGame({ defs: DEFS }); let banner: CardId, mine: CardId, theirs: CardId
    ;[s, mine] = withField(s, 0, 'forwards', 'V-F2')      // 5000
    ;[s, theirs] = withField(s, 1, 'forwards', 'V-F2')
    expect(powerOf(s, fc(s, mine))).toBe(5000)
    ;[s, banner] = withField(s, 0, 'backups', 'T-BANNER')
    expect(powerOf(s, fc(s, mine)), 'a card already present is pumped').toBe(6000)
    expect(powerOf(s, fc(s, theirs)), 'the opponent’s is not').toBe(5000)
    let later: CardId
    ;[s, later] = withField(s, 0, 'forwards', 'V-F1')     // 3000, arrives after the source (§11.12.4.5)
    expect(powerOf(s, fc(s, later))).toBe(4000)
    // The source leaves: the pump is gone the moment it is read again.
    s = { ...s, players: [{ ...s.players[0], backups: s.players[0].backups.filter((c) => c.id !== banner), breakZone: [...s.players[0].breakZone, banner] }, s.players[1]] }
    expect(powerOf(s, fc(s, mine))).toBe(5000)
    expect(powerOf(s, fc(s, later))).toBe(3000)
    ok(s)
  })
})

describe('J6-A2 — a keyword the layer grants is a real keyword', () => {
  it('"other Forwards you control gain Haste" excludes the source, and unlocks an attack this turn only while the source is in play', () => {
    let s = endPhase(makeGame({ defs: DEFS })); let herald: CardId, fresh: CardId
    ;[s, herald] = withField(s, 0, 'forwards', 'T-HERALD', { enteredTurn: s.turn })
    ;[s, fresh] = withField(s, 0, 'forwards', 'V-F2', { enteredTurn: s.turn })   // entered this turn: no attack without Haste
    expect(keywordsOf(s, fc(s, fresh)).has('haste')).toBe(true)
    expect(keywordsOf(s, fc(s, herald)).has('haste'), 'the source is excluded').toBe(false)
    expect(attackCheck(s, 0, [fresh])).toBeNull()
    expect(attackCheck(s, 0, [herald])).toMatch(/Haste/)
    const gone: GameState = { ...s, players: [{ ...s.players[0], forwards: s.players[0].forwards.filter((c) => c.id !== herald), breakZone: [...s.players[0].breakZone, herald] }, s.players[1]] }
    expect(attackCheck(gone, 0, [fresh])).toMatch(/Haste/)
  })
})

describe('J6-A3 — stamps and the layer add; the floor holds; the rule processes read the layer', () => {
  it('a stamped +3000 and a layer +1000 give +4000; a −5000 layer debuff floors at 0 and §12.4.4 breaks the card', () => {
    let s = makeGame({ defs: DEFS }); let mine: CardId
    ;[s, mine] = withField(s, 0, 'forwards', 'V-F2', { powerBonus: 3000 })
    ;[s] = withField(s, 0, 'backups', 'T-BANNER')
    expect(effectivePower(s, fc(s, mine))).toBe(9000)
    ;[s] = withField(s, 1, 'backups', 'T-CURSE')
    expect(effectivePower(s, fc(s, mine))).toBe(4000)
    let weak: CardId
    ;[s, weak] = withField(s, 0, 'forwards', 'V-F1')   // 3000 + 1000 − 5000 → 0
    expect(effectivePower(s, fc(s, weak))).toBe(0)
    const [t, events] = runRuleProcesses(s)
    expect(findFieldCard(t, weak)).toBeNull()
    expect(events).toContainEqual({ type: 'putIntoBreakZone', card: weak, reason: 'zeroPower' })
    expect(findFieldCard(t, mine)).not.toBeNull()
    ok(t)
  })

  it('a layer `cannotBeBroken` stops the §12.4.5 break and a `breakCard` alike', () => {
    let s = makeGame({ defs: DEFS }); let mine: CardId
    ;[s, mine] = withField(s, 0, 'forwards', 'V-F2', { damage: 5000 })   // lethal damage sitting on it
    ;[s] = withField(s, 0, 'backups', 'T-AEGIS')
    expect(flagsOf(s, fc(s, mine)).has('cannotBeBroken')).toBe(true)
    const [t] = runRuleProcesses(s)
    expect(findFieldCard(t, mine), 'protected from the damage break').not.toBeNull()
    ok(t)
  })
})

describe('J6-A4 — a condition gates a continuous effect by its SOURCE’s controller', () => {
  it('+2000 only once the controller has taken 3 damage', () => {
    let s = makeGame({ defs: DEFS }); let mine: CardId
    ;[s, mine] = withField(s, 0, 'forwards', 'V-F2')
    ;[s] = withField(s, 0, 'backups', 'T-RALLY')
    expect(powerOf(s, fc(s, mine))).toBe(5000)
    const hit = (p: 0 | 1, n: number) => ({ ...s.players[p], damageZone: s.players[p].deck.slice(0, n), deck: s.players[p].deck.slice(n) })
    expect(powerOf({ ...s, players: [s.players[0], hit(1, 3)] }, fc(s, mine)), 'the opponent’s damage does not count').toBe(5000)
    expect(powerOf({ ...s, players: [hit(0, 3), s.players[1]] }, fc(s, mine))).toBe(7000)
  })
})

describe('J6-A5 — with no continuous source in play the readers do no filter matching', () => {
  it('a full random game on the vanilla pool never calls matchesDefFilter from a reader', () => {
    // The vanilla pool has no continuous static, so `continuousStatics` is empty and `layerFor` exits before
    // any scope is matched. Counted through the module's export: `layerFor` imports it from filters.js.
    const original = filters.matchesDefFilter
    let calls = 0
    Object.defineProperty(filters, 'matchesDefFilter', { value: (...args: Parameters<typeof original>) => { calls++; return original(...args) }, configurable: true })
    try {
      let s = createGame({ seed: 3, decks: [DEFAULT_DECK, DEFAULT_DECK], defs: VANILLA_POOL })
      expect(continuousStatics(s.defs).size).toBe(0)
      for (let i = 0; i < 60 && !s.result; i++) {
        const p = s.pending?.player ?? s.priority
        const cmd = (s.pending?.kind === 'chooseFirst') ? { type: 'chooseFirst' as const, player: p, goFirst: true }
          : (s.pending?.kind === 'mulligan') ? { type: 'mulligan' as const, player: p, redraw: false }
          : { type: 'pass' as const, player: p }
        try { s = apply(s, cmd).state } catch { break }
        for (const q of [0, 1] as const) for (const c of s.players[q].forwards) { powerOf(s, c); keywordsOf(s, c); flagsOf(s, c) }
      }
    } finally {
      Object.defineProperty(filters, 'matchesDefFilter', { value: original, configurable: true })
    }
    expect(calls).toBe(0)
  })
})

describe('J6-D9 — a continuous static that arrived as data is validated once', () => {
  it('createGame refuses a non-finite amount and an instance axis in a scope', () => {
    const bad = makeDef({ code: 'T-BAD', type: 'backup', power: null, hasAbilities: true, abilityClauses: 1,
      abilities: [stat('T-BAD:x', { kind: 'modifyPower', amount: Number.NaN, to: { controller: 'self', filter: { type: 'forward', ...({ maxPower: 5000 } as object) } } })] })
    expect(() => createGame({ seed: 1, decks: [DEFAULT_DECK, DEFAULT_DECK], defs: [...VANILLA_POOL, bad] })).toThrow(/non-finite amount.*instance axis|instance axis.*non-finite/s)
  })
  it('a Summon in hand with a continuous static is not a source: only the field radiates (§11.12.4.4)', () => {
    let s = makeGame({ defs: DEFS }); let mine: CardId
    ;[s, mine] = withField(s, 0, 'forwards', 'V-F2')
    ;[s] = withHand(s, 0, 'T-BANNER')
    expect(powerOf(s, fc(s, mine))).toBe(5000)
  })
})
