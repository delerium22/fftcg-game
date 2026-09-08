import { describe, expect, it } from 'vitest'
import { applyCastCharacter, applyCastSummon, castCheck } from '../src/cast.js'
import { IllegalCommandError } from '../src/errors.js'
import { drainResolution } from '../src/resolve.js'
import { makeDef, makeGame, VANILLA_POOL, withField, withHand } from './helpers.js'
import type { GameState } from '../src/state.js'

const NAMED = [...VANILLA_POOL, makeDef({ code: 'V-N1', name: 'Cloud', cost: 1, power: 3000 }), makeDef({ code: 'V-N2', name: 'Cloud', cost: 1, power: 3000 }), makeDef({ code: 'V-G1', name: 'Red Mage', generic: true, cost: 1, power: 3000 })]

function ready() {
  let s = makeGame({ defs: NAMED })
  s = { ...s, players: [{ ...s.players[0], hand: [] }, s.players[1]] }
  let b1: number, b2: number
  ;[s, b1] = withField(s, 0, 'backups', 'V-B1')
  ;[s, b2] = withField(s, 0, 'backups', 'V-B2')
  return { s, b1, b2 }
}

describe('§11.4 casting a Character', () => {
  it('a Forward enters the field active with enteredTurn = current turn, cost paid', () => {
    let { s, b1, b2 } = ready(); let f: number
    ;[s, f] = withHand(s, 0, 'V-F2')   // earth cost 2
    const [t, events] = applyCastCharacter(s, 0, f, { dullBackups: [b1, b2], discards: [] })
    expect(t.players[0].forwards).toEqual([{ id: f, status: 'active', damage: 0, enteredTurn: 1, attackedThisTurn: false, granted: [], powerBonus: 0, flags: [], usedThisTurn: [] }])
    expect(t.players[0].hand).not.toContain(f)
    expect(t.players[0].backups.every((b) => b.status === 'dull')).toBe(true)
    expect(events).toContainEqual({ type: 'cast', player: 0, card: f, cardType: 'forward' })
  })
  it('§5.2.3.1.1.3: a Backup enters dull', () => {
    let { s, b1 } = ready(); let b: number
    ;[s, b] = withHand(s, 0, 'V-B3')   // a different non-generic name from the V-B1 already on the field
    const [t] = applyCastCharacter(s, 0, b, { dullBackups: [b1], discards: [] })
    expect(t.players[0].backups.find((c) => c.id === b)?.status).toBe('dull')
  })
  it('rejects insufficient or wrong-element payment', () => {
    let { s, b2 } = ready(); let f: number
    ;[s, f] = withHand(s, 0, 'V-F2')
    expect(() => applyCastCharacter(s, 0, f, { dullBackups: [b2], discards: [] })).toThrow(IllegalCommandError)
  })
  it('emits unimplementedAbility for cards with ability text', () => {
    let { s, b1 } = ready(); let f: number
    const defs = [...NAMED, makeDef({ code: 'V-A1', cost: 1, power: 1000, hasAbilities: true, text: 'When V-A1 enters the field, draw 1 card.' })]
    s = { ...s, defs: Object.fromEntries(defs.map((d) => [d.code, d])) }
    ;[s, f] = withHand(s, 0, 'V-A1')
    const [, events] = applyCastCharacter(s, 0, f, { dullBackups: [b1], discards: [] })
    expect(events).toContainEqual({ type: 'unimplementedAbility', card: f, code: 'V-A1' })
  })
  it('an unknown card id throws IllegalCommandError instead of a plain Error (castCheck runs before defOf)', () => {
    const { s } = ready()
    expect(() => applyCastCharacter(s, 0, 99999, { dullBackups: [], discards: [] })).toThrow(IllegalCommandError)
  })
})

describe('castCheck', () => {
  it('only in a main phase with priority and nothing pending', () => {
    let { s } = ready(); let f: number
    ;[s, f] = withHand(s, 0, 'V-F1')
    expect(castCheck(s, 0, f)).toBeNull()
    expect(castCheck({ ...s, phase: 'attack' }, 0, f)).toMatch(/main phase/i)
    expect(castCheck({ ...s, priority: 1 }, 0, f)).toMatch(/priority/i)
    expect(castCheck(s, 1, f)).toMatch(/hand/i)
    expect(castCheck({ ...s, pending: { kind: 'mulligan', player: 0 } }, 0, f)).toMatch(/pending/i)
  })
  it('§7.7.4: no 6th backup', () => {
    let { s } = ready(); let b: number
    for (const code of ['V-B3', 'V-B4', 'V-B5']) [s] = withField(s, 0, 'backups', code)   // 5 distinct names on the field
    ;[s, b] = withHand(s, 0, 'V-B6')
    expect(castCheck(s, 0, b)).toMatch(/5 backups/i)
  })
  it('§7.7.3: same-name non-generic characters cannot coexist; generic ones can', () => {
    let { s } = ready(); let n2: number, g: number
    ;[s] = withField(s, 0, 'forwards', 'V-N1')     // "Cloud"
    ;[s, n2] = withHand(s, 0, 'V-N2')               // another "Cloud", different code
    expect(castCheck(s, 0, n2)).toMatch(/same name/i)
    ;[s] = withField(s, 0, 'forwards', 'V-G1')     // generic "Red Mage"
    ;[s, g] = withHand(s, 0, 'V-G1')
    expect(castCheck(s, 0, g)).toBeNull()
    // an opponent's Cloud does not block yours
    let t = ready().s; let mine: number
    ;[t] = withField(t, 1, 'forwards', 'V-N1')
    ;[t, mine] = withHand(t, 0, 'V-N2')
    expect(castCheck(t, 0, mine)).toBeNull()
  })
})

describe('§11.3 casting a Summon (rung J1: onto the stack)', () => {
  it('pays, goes onto the stack, and once resolved reaches the break zone with summonResolvedNoEffect; no unimplementedAbility for a vanilla summon', () => {
    let { s, b2 } = ready(); let x: number
    ;[s, x] = withHand(s, 0, 'V-S1')   // lightning cost 2
    ;[s] = withField(s, 0, 'backups', 'V-B5')
    const b3 = s.players[0].backups[2]!.id
    const [t, events] = applyCastSummon(s, 0, x, { dullBackups: [b2, b3], discards: [] })
    expect(t.players[0].hand).not.toContain(x)
    expect(t.stack.map((i) => (i.kind === 'summon' ? i.card : -1)), 'a cast Summon sits on the stack (§11.3.2)').toEqual([x])
    expect(events).toContainEqual({ type: 'stackPushed', item: { kind: 'summon', card: x }, controller: 0 })
    expect(events.some((e) => e.type === 'unimplementedAbility')).toBe(false)
    const [u, more] = drainResolution(t)
    expect(u.players[0].breakZone, 'a resolved Summon goes to the Break Zone (§11.11.10)').toContain(x)
    expect(more).toContainEqual({ type: 'summonResolvedNoEffect', card: x })
  })
  it('is castable by the priority holder in an Attack Phase WINDOW, not in the declaration step (§9.3.1.6)', () => {
    let { s } = ready(); let x: number
    ;[s, x] = withHand(s, 0, 'V-S1')
    expect(castCheck({ ...s, phase: 'attack', attack: { step: 'declaration', attackers: [], blocker: null } }, 0, x)).toMatch(/main phase/i)
    expect(castCheck({ ...s, phase: 'attack', attack: { step: 'preparation', attackers: [], blocker: null } }, 0, x)).toBeNull()
    // And by the NON-turn player when they hold priority — a Character never is.
    expect(castCheck({ ...s, priority: 1 }, 0, x)).toMatch(/priority/)
  })
  it('an unknown card id throws IllegalCommandError instead of a plain Error (castCheck runs before defOf)', () => {
    const { s } = ready()
    expect(() => applyCastSummon(s, 0, 99999, { dullBackups: [], discards: [] })).toThrow(IllegalCommandError)
  })
})

describe('castBlocker — the structured reason a cast is refused (rung I1)', () => {
  it('names the reason as a code, and castCheck is its English', async () => {
    const { castBlocker } = await import('../src/cast.js')
    let { s } = ready(); let f: number
    ;[s, f] = withHand(s, 0, 'V-F2')
    expect(castBlocker(s, 0, f)).toBeNull()
    expect(castBlocker({ ...s, phase: 'attack' }, 0, f)).toBe('phase')
    expect(castCheck({ ...s, phase: 'attack' }, 0, f)).toMatch(/main phase/)
    expect(castBlocker({ ...s, pending: { kind: 'mulligan', player: 0 } }, 0, f)).toBe('pending')
    expect(castBlocker({ ...s, priority: 1 }, 0, f)).toBe('priority')
    let b: number
    ;[s, b] = withHand(s, 0, 'V-B3')
    const five = { ...s, players: [{ ...s.players[0], backups: [...s.players[0].backups, ...s.players[0].backups, ...s.players[0].backups] }, s.players[1]] as GameState['players'] }
    expect(castBlocker(five, 0, b)).toBe('backupsFull')
    let twin: number
    ;[s, twin] = withHand(s, 0, 'V-B1')
    expect(castBlocker(s, 0, twin)).toBe('sameName')
  })
})
