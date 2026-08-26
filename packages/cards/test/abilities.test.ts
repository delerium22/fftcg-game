import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { CardDef, CardId, FieldCard, GameState, PlayerId } from '@fftcg/engine'
import { apply, applyChooseFirst, applyMulligan, checkInvariants, createGame, defOf, findFieldCard, legalCommands, powerOf } from '@fftcg/engine'
import { ABILITIES, ABILITY_CLAUSES, loadCards } from '../src/index.js'

/**
 * The five rung-C1 clauses, tested against the REAL defs from `loadCards()` and the printed text quoted in
 * each `it(…)` name (spec C1-A1). The engine's own `abilities-engine.test.ts` proves the executor with
 * synthetic defs; this file proves that the hand-written ASTs encode what the cards actually say.
 *
 * MVP0-SIMPLIFICATION (spec C1-4): every assertion below is the documented IMMEDIATE-RESOLUTION result.
 * There is no stack and no response window in C1, so none of this is a claim of CR correctness.
 */

const DEFS = loadCards()

/** 50 cards, ≤3 copies of each of the 18 codes (§8.1.1.1–2). */
const DECK: string[] = (() => {
  const codes = DEFS.map((d) => d.code)
  const out: string[] = []
  for (let i = 0; out.length < 50; i++) out.push(codes[i % codes.length] as string)
  return out
})()

function makeGame(): GameState {
  let s = createGame({ seed: 1, decks: [DECK, DECK], defs: DEFS })
  const chooser = s.pending?.kind === 'chooseFirst' ? s.pending.player : 0
  ;[s] = applyChooseFirst(s, chooser, chooser === 0)   // player 0 always goes first
  ;[s] = applyMulligan(s, 0, false)
  ;[s] = applyMulligan(s, 1, false)
  // An empty hand keeps payments unambiguous; the cards go under the deck so no instance leaves every zone.
  const p0 = s.players[0]
  return { ...s, players: [{ ...p0, hand: [], deck: [...p0.deck, ...p0.hand] }, s.players[1]] }
}

let nextId = 90_000
function addInstance(state: GameState, owner: PlayerId, code: string): [GameState, CardId] {
  const id = nextId++
  return [{ ...state, cards: { ...state.cards, [id]: { id, code, owner } } }, id]
}
function setPlayer(state: GameState, p: PlayerId, ps: GameState['players'][0]): GameState {
  const players: GameState['players'] = [state.players[0], state.players[1]]
  players[p] = ps
  return { ...state, players }
}
function withField(state: GameState, player: PlayerId, zone: 'forwards' | 'backups', code: string, over: Partial<FieldCard> = {}): [GameState, CardId] {
  const [s, id] = addInstance(state, player, code)
  const fc: FieldCard = { id, status: 'active', damage: 0, enteredTurn: 0, attackedThisTurn: false, granted: [], powerBonus: 0, flags: [], ...over }
  const ps = s.players[player]
  return [setPlayer(s, player, { ...ps, [zone]: [...ps[zone], fc] }), id]
}
function withHand(state: GameState, player: PlayerId, code: string): [GameState, CardId] {
  const [s, id] = addInstance(state, player, code)
  const ps = s.players[player]
  return [setPlayer(s, player, { ...ps, hand: [...ps.hand, id] }), id]
}
function withBreakZone(state: GameState, player: PlayerId, code: string): [GameState, CardId] {
  const [s, id] = addInstance(state, player, code)
  const ps = s.players[player]
  return [setPlayer(s, player, { ...ps, breakZone: [...ps.breakZone, id] }), id]
}

/** `n` active generic Backups of one element, as CP sources. Backups produce their FIRST printed element. */
const EARTH_BACKUP = '18-064C'      // Geomancer, generic
const LIGHTNING_BACKUP = '18-069C'  // Red Mage, generic
function withCp(state: GameState, player: PlayerId, codes: string[]): [GameState, CardId[]] {
  let s = state
  const ids: CardId[] = []
  for (const code of codes) { let id: CardId; [s, id] = withField(s, player, 'backups', code); ids.push(id) }
  return [s, ids]
}

const fc = (s: GameState, id: CardId): FieldCard | undefined => findFieldCard(s, id)?.card
const ok = (s: GameState) => expect(checkInvariants(s)).toEqual([])
const powerOfId = (s: GameState, id: CardId) => powerOf(s, fc(s, id) as FieldCard)

/** Put `code` in P0's hand with exactly enough CP for it, and cast it through the real command pipeline. */
function cast(state: GameState, code: string, cp: string[], type: 'castCharacter' | 'castSummon' = 'castCharacter') {
  let s = state; let card: CardId; let backups: CardId[]
  ;[s, card] = withHand(s, 0, code)
  ;[s, backups] = withCp(s, 0, cp)
  const r = apply(s, { type, player: 0, card, payment: { dullBackups: backups, discards: [] } })
  return { ...r, card }
}

// ---------------------------------------------------------------------------
// 16-092C Noel
// ---------------------------------------------------------------------------

describe('16-092C Noel — "EX BURST When Noel enters the field, choose up to 2 Forwards opponent controls. Dull them."', () => {
  /** The EX BURST tag is C3; the trigger itself fires on a normal cast, which is what `enterField` means. */
  function noelVsThree() {
    let s = makeGame(); const victims: CardId[] = []
    for (const code of ['27-127S', '24-063H', '22-068R']) { let id: CardId; [s, id] = withField(s, 1, 'forwards', code); victims.push(id) }
    return { s, victims }
  }

  it('offers "up to 2" as C(3,0..2) legal answers and dulls exactly the two chosen', () => {
    const { s, victims } = noelVsThree()
    const r = cast(s, '16-092C', Array<string>(5).fill(LIGHTNING_BACKUP))
    let t = r.state
    expect(t.pending).toEqual({ kind: 'chooseTargets', player: 0, min: 0, max: 2, candidates: victims })
    // C1-A3: the choice is an ordinary command, so the AI plays it and the UI can click it.
    expect(legalCommands(t, 0).filter((c) => c.type === 'chooseTargets')).toHaveLength(1 + 3 + 3)
    ok(t)

    t = apply(t, { type: 'chooseTargets', player: 0, targets: [victims[0] as CardId, victims[2] as CardId] }).state
    expect(victims.map((id) => fc(t, id)?.status)).toEqual(['dull', 'active', 'dull'])
    expect(t.pending).toBeNull()
    ok(t)
  })

  it('"up to 2" means declining is legal — the empty answer dulls nothing', () => {
    const { s, victims } = noelVsThree()
    const t = apply(cast(s, '16-092C', Array<string>(5).fill(LIGHTNING_BACKUP)).state, { type: 'chooseTargets', player: 0, targets: [] }).state
    expect(victims.map((id) => fc(t, id)?.status)).toEqual(['active', 'active', 'active'])
    ok(t)
  })

  it('is a logged no-op when the opponent controls no Forwards', () => {
    const r = cast(makeGame(), '16-092C', Array<string>(5).fill(LIGHTNING_BACKUP))
    expect(r.state.pending).toBeNull()
    expect(r.events).toContainEqual({ type: 'abilityNoLegalTarget', card: r.card, abilityId: '16-092C:etb' })
  })

  it('keeps warning about its unimplemented second clause (spec C1-9/C1-A2)', () => {
    // "[Dull], put Noel into the Break Zone: Dull all the Forwards opponent controls." is a C3 action ability.
    const r = cast(makeGame(), '16-092C', Array<string>(5).fill(LIGHTNING_BACKUP))
    expect(r.events).toContainEqual({ type: 'unimplementedAbility', card: r.card, code: '16-092C', clauses: 1 })
  })
})

// ---------------------------------------------------------------------------
// 12-120C Shantotto
// ---------------------------------------------------------------------------

describe('12-120C Shantotto — "When Shantotto enters the field, select 1 of the 2 following actions."', () => {
  /** P0 already controls one Forward; P1 controls one. Candidate order is always player 0 then player 1. */
  function shantottoOnBoard() {
    let s = makeGame(); let mine: CardId, theirs: CardId
    ;[s, mine] = withField(s, 0, 'forwards', '24-063H')     // Hugh Yurg 8000
    ;[s, theirs] = withField(s, 1, 'forwards', '27-127S')   // Lightning 9000
    const r = cast(s, '12-120C', [EARTH_BACKUP, LIGHTNING_BACKUP])
    return { r, mine, theirs, shantotto: r.card }
  }

  it('raises the mode choice with the printed wordings as its labels', () => {
    const { r } = shantottoOnBoard()
    expect(r.state.pending).toEqual({
      kind: 'chooseMode', player: 0, min: 1, max: 1,
      labels: [
        'Choose 1 Forward other than Shantotto. It gains Haste until the end of the turn.',
        'Choose 1 Forward you control. It gains ‘This Forward cannot be broken’ until the end of the turn.',
      ],
    })
    ok(r.state)
  })

  it('mode 1 "Choose 1 Forward other than Shantotto" excludes Shantotto itself and grants Haste', () => {
    const { r, mine, theirs, shantotto } = shantottoOnBoard()
    let t = apply(r.state, { type: 'chooseMode', player: 0, modes: [0] }).state
    // "other than Shantotto" restricts the identity, not the controller — the opponent's Forward is legal too.
    expect(t.pending).toEqual({ kind: 'chooseTargets', player: 0, min: 1, max: 1, candidates: [mine, theirs] })
    t = apply(t, { type: 'chooseTargets', player: 0, targets: [mine] }).state
    expect(fc(t, mine)?.granted).toEqual(['haste'])
    expect(fc(t, shantotto)?.granted).toEqual([])
    ok(t)
  })

  it('mode 2 "Choose 1 Forward you control" is self-only and grants ‘This Forward cannot be broken’', () => {
    const { r, mine, theirs, shantotto } = shantottoOnBoard()
    let t = apply(r.state, { type: 'chooseMode', player: 0, modes: [1] }).state
    // No `excludeSource` on this mode: Shantotto may protect itself, and the opponent's Forward is not a candidate.
    expect(t.pending).toEqual({ kind: 'chooseTargets', player: 0, min: 1, max: 1, candidates: [mine, shantotto] })
    expect(t.pending?.kind === 'chooseTargets' && t.pending.candidates.includes(theirs)).toBe(false)
    t = apply(t, { type: 'chooseTargets', player: 0, targets: [shantotto] }).state
    // `cannotBeBroken` is a FieldFlag, not a Keyword — `granted` holds only real keywords (spec C1-7).
    expect(fc(t, shantotto)?.flags).toEqual(['cannotBeBroken'])
    expect(fc(t, shantotto)?.granted).toEqual([])
    ok(t)
  })

  it('is fully implemented, so it warns about nothing', () => {
    const { r } = shantottoOnBoard()
    expect(r.events.some((e) => e.type === 'unimplementedAbility')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 27-124S Cloud
// ---------------------------------------------------------------------------

describe('27-124S Cloud — "When Cloud enters the field, until the end of the turn, all the Forwards you control gain 3000 power and Brave."', () => {
  function cloudOnBoard() {
    let s = makeGame(); let mineA: CardId, mineB: CardId, theirs: CardId
    ;[s, mineA] = withField(s, 0, 'forwards', '24-063H')     // 8000
    ;[s, mineB] = withField(s, 0, 'forwards', '22-068R')     // 5000
    ;[s, theirs] = withField(s, 1, 'forwards', '27-127S')    // 9000
    const r = cast(s, '27-124S', Array<string>(3).fill(EARTH_BACKUP))
    return { r, mineA, mineB, theirs, cloud: r.card }
  }

  it('needs no choice at all: every Forward YOU control, Cloud included, gains 3000 power and Brave', () => {
    const { r, mineA, mineB, theirs, cloud } = cloudOnBoard()
    const t = r.state
    expect(t.pending).toBeNull()                       // untargeted — `forEach` raises no prompt
    expect(powerOfId(t, mineA)).toBe(11_000)
    expect(powerOfId(t, mineB)).toBe(8000)
    expect(powerOfId(t, cloud)).toBe(10_000)           // Cloud is already on the field when its own ETB resolves
    expect([mineA, mineB, cloud].map((id) => fc(t, id)?.granted)).toEqual([['brave'], ['brave'], ['brave']])
    expect(powerOfId(t, theirs)).toBe(9000)            // "you control" — the opponent's Forward is untouched
    expect(fc(t, theirs)?.granted).toEqual([])
    ok(t)
  })

  it('keeps warning about its unimplemented Attack-Phase clause (spec C1-9/C1-A2)', () => {
    // "At the beginning of the Attack Phase during each of your turns, …" needs a phase continuation — rung C2.
    const { r, cloud } = cloudOnBoard()
    expect(r.events).toContainEqual({ type: 'unimplementedAbility', card: cloud, code: '27-124S', clauses: 1 })
  })
})

// ---------------------------------------------------------------------------
// 18-124C Billy Bob
// ---------------------------------------------------------------------------

describe('18-124C Billy Bob — "When Billy Bob enters the field, choose 1 Forward other than Card Name Billy Bob in your Break Zone. Add it to your hand."', () => {
  function billyBobOnBoard() {
    let s = makeGame(); let forward: CardId, otherBilly: CardId, backup: CardId, theirs: CardId
    ;[s, forward] = withBreakZone(s, 0, '27-127S')     // a Forward — the only legal target
    ;[s, otherBilly] = withBreakZone(s, 0, '18-124C')  // "other than Card Name Billy Bob"
    ;[s, backup] = withBreakZone(s, 0, '18-064C')      // a Backup — the Break Zone is not Forwards-only
    ;[s, theirs] = withBreakZone(s, 1, '24-063H')      // "your Break Zone"
    const r = cast(s, '18-124C', [EARTH_BACKUP, EARTH_BACKUP, LIGHTNING_BACKUP])
    return { r, forward, otherBilly, backup, theirs }
  }

  it('offers only your own Break Zone Forwards, excluding every card named Billy Bob', () => {
    const { r, forward } = billyBobOnBoard()
    expect(r.state.pending).toEqual({ kind: 'chooseTargets', player: 0, min: 1, max: 1, candidates: [forward] })
    ok(r.state)
  })

  it('moves the chosen card from the Break Zone to its owner’s hand', () => {
    const { r, forward, otherBilly, backup } = billyBobOnBoard()
    const t = apply(r.state, { type: 'chooseTargets', player: 0, targets: [forward] }).state
    expect(t.players[0].hand).toContain(forward)
    expect(t.players[0].breakZone).not.toContain(forward)
    expect(t.players[0].breakZone).toEqual(expect.arrayContaining([otherBilly, backup]))
    expect(t.pending).toBeNull()
    ok(t)
  })

  it('is a logged no-op with an empty Break Zone, not an error (spec C1-7)', () => {
    const r = cast(makeGame(), '18-124C', [EARTH_BACKUP, EARTH_BACKUP, LIGHTNING_BACKUP])
    expect(r.state.pending).toBeNull()
    expect(r.events).toContainEqual({ type: 'abilityNoLegalTarget', card: r.card, abilityId: '18-124C:etb' })
    expect(r.events.some((e) => e.type === 'unimplementedAbility')).toBe(false)
    ok(r.state)
  })
})

// ---------------------------------------------------------------------------
// 20-103H Ramuh — the Summon path
// ---------------------------------------------------------------------------

describe('20-103H Ramuh — "Select up to 2 of the 3 following actions." (the only summonResolve clause)', () => {
  function ramuhCast() {
    let s = makeGame(); let mine: CardId, theirs: CardId
    ;[s, mine] = withField(s, 0, 'forwards', '24-063H')     // Hugh Yurg 8000, entered on turn 0 but never attacked
    ;[s, theirs] = withField(s, 1, 'forwards', '27-127S')   // Lightning 9000
    const r = cast(s, '20-103H', [LIGHTNING_BACKUP, LIGHTNING_BACKUP], 'castSummon')
    return { r, mine, theirs, ramuh: r.card }
  }

  it('resolves from the Break Zone instead of reporting no effect (§7.10.1; the path was dead code)', () => {
    const { r, ramuh } = ramuhCast()
    expect(r.state.players[0].breakZone).toContain(ramuh)
    expect(r.events.some((e) => e.type === 'summonResolvedNoEffect')).toBe(false)
    expect(r.events).toContainEqual({ type: 'abilityTriggered', player: 0, card: ramuh, abilityId: '20-103H:summon' })
    expect(r.state.pending).toEqual({
      kind: 'chooseMode', player: 0, min: 0, max: 2,
      labels: ['Choose 1 Forward. Dull it.', 'Choose 1 Forward. Deal it 5000 damage.', 'Choose 1 Forward. It gains Haste until the end of the turn.'],
    })
    ok(r.state)
  })

  it('two modes answered out of order still resolve in PRINTED order, each with its own target', () => {
    const { r, mine, theirs } = ramuhCast()
    let t = apply(r.state, { type: 'chooseMode', player: 0, modes: [2, 0] }).state
    // Mode 0 ("Dull it.") prompts first even though mode 2 was named first. "Choose 1 Forward" is unrestricted,
    // so both players' Forwards are candidates, player 0's first.
    expect(t.pending).toEqual({ kind: 'chooseTargets', player: 0, min: 1, max: 1, candidates: [mine, theirs] })
    t = apply(t, { type: 'chooseTargets', player: 0, targets: [theirs] }).state
    expect(fc(t, theirs)?.status).toBe('dull')
    expect(t.pending).toEqual({ kind: 'chooseTargets', player: 0, min: 1, max: 1, candidates: [mine, theirs] })
    t = apply(t, { type: 'chooseTargets', player: 0, targets: [mine] }).state
    expect(fc(t, mine)?.granted).toEqual(['haste'])
    expect(fc(t, mine)?.status).toBe('active')          // mode 1 was never selected
    expect(fc(t, theirs)?.damage).toBe(0)
    expect(t.pending).toBeNull()
    ok(t)
  })

  it('"Deal it 5000 damage." is survivable damage on a 9000-power Forward', () => {
    const { r, theirs } = ramuhCast()
    let t = apply(r.state, { type: 'chooseMode', player: 0, modes: [1] }).state
    t = apply(t, { type: 'chooseTargets', player: 0, targets: [theirs] }).state
    expect(fc(t, theirs)?.damage).toBe(5000)            // §12.4.5 would break it at ≥ 9000
    ok(t)
  })

  it('"up to 2" allows selecting none, and the Summon still went to the Break Zone', () => {
    const { r, mine, theirs, ramuh } = ramuhCast()
    const t = apply(r.state, { type: 'chooseMode', player: 0, modes: [] }).state
    expect(t.pending).toBeNull()
    expect([mine, theirs].map((id) => fc(t, id)?.status)).toEqual(['active', 'active'])
    expect(t.players[0].breakZone).toContain(ramuh)
    ok(t)
  })

  it('prints exactly one clause, all of it implemented, so it warns about nothing', () => {
    // Ramuh's three quoted actions are the modes of a SINGLE modal ability, not three clauses (spec C1-9).
    const { r } = ramuhCast()
    expect(r.events.some((e) => e.type === 'unimplementedAbility')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 22-068R Prishe and 27-125S Luso — the rung-C2 player-damage clauses
// ---------------------------------------------------------------------------

/** P0 attacks with `attackers`; P1 declines to block, so §10.1.4.1 puts one point of damage on P1. */
function attackUnblocked(state: GameState, attackers: CardId[]) {
  let s = apply(state, { type: 'pass', player: 0 }).state          // §10.1.1–2 into the declaration step
  s = apply(s, { type: 'declareAttack', player: 0, attackers }).state
  return apply(s, { type: 'declareBlock', player: 1, blocker: null })
}

describe('22-068R Prishe — "When Prishe deals damage to your opponent, choose 1 Character in your Break Zone. Add it to your hand."', () => {
  function prisheHits() {
    let s = makeGame(); let prishe: CardId, forward: CardId, summon: CardId, backup: CardId, theirs: CardId
    ;[s, prishe] = withField(s, 0, 'forwards', '22-068R')   // earth 5000
    ;[s, forward] = withBreakZone(s, 0, '27-127S')          // Lightning — a Forward
    ;[s, summon] = withBreakZone(s, 0, '20-103H')           // Ramuh — a Summon, and so NOT a Character (§7.2)
    ;[s, backup] = withBreakZone(s, 0, '18-064C')           // Geomancer — a Backup
    ;[s, theirs] = withBreakZone(s, 1, '24-063H')           // "your Break Zone"
    return { r: attackUnblocked(s, [prishe]), prishe, forward, summon, backup, theirs }
  }

  it('"1 Character" offers Forwards and Backups from your own Break Zone, never a Summon', () => {
    const { r, prishe, forward, summon, backup, theirs } = prisheHits()
    expect(r.events).toContainEqual({ type: 'abilityTriggered', player: 0, card: prishe, abilityId: '22-068R:damages-opponent' })
    expect(r.state.pending).toEqual({ kind: 'chooseTargets', player: 0, min: 1, max: 1, candidates: [forward, backup] })
    const candidates = r.state.pending?.kind === 'chooseTargets' ? r.state.pending.candidates : []
    expect(candidates.includes(summon), 'a Summon is not a Character').toBe(false)
    expect(candidates.includes(theirs), '"your" Break Zone').toBe(false)
    ok(r.state)
  })

  it('adds the chosen Character to its owner’s hand', () => {
    const { r, backup, forward, summon } = prisheHits()
    const t = apply(r.state, { type: 'chooseTargets', player: 0, targets: [backup] }).state
    expect(t.players[0].hand).toContain(backup)
    expect(t.players[0].breakZone).toEqual([forward, summon])
    expect(t.pending).toBeNull()
    ok(t)
  })

  it('keeps warning about its unimplemented "when chosen" clause (spec C2-13)', () => {
    // "When Prishe is chosen by a Summon or an ability, …" must fire while a frame is already mid-flight
    // choosing targets, and the agenda deliberately cannot preempt an active frame (spec C2-A9).
    const r = cast(makeGame(), '22-068R', [EARTH_BACKUP, EARTH_BACKUP])
    expect(r.events).toContainEqual({ type: 'unimplementedAbility', card: r.card, code: '22-068R', clauses: 1 })
  })
})

describe('27-125S Luso — "When Luso deals damage to a Forward, break it." and its modal player-damage clause', () => {
  it('c1: the Forward Luso damages in combat is broken, with no target choice of its own', () => {
    let s = makeGame(); let luso: CardId, blocker: CardId
    ;[s, luso] = withField(s, 0, 'forwards', '27-125S')      // 3000 power
    ;[s, blocker] = withField(s, 1, 'forwards', '24-063H')   // Hugh Yurg 8000 — survives 3000, kills Luso back
    s = apply(s, { type: 'pass', player: 0 }).state
    s = apply(s, { type: 'declareAttack', player: 0, attackers: [luso] }).state
    const r = apply(s, { type: 'declareBlock', player: 1, blocker })
    expect(r.events).toContainEqual({ type: 'brokenByAbility', card: blocker, source: luso })
    expect(r.state.players[1].breakZone).toContain(blocker)
    expect(r.state.pending, '"break it" names its subject — never a choice (spec C2-5)').toBeNull()
    ok(r.state)
  })

  function lusoHits() {
    let s = makeGame(); let luso: CardId, theirs: CardId, backup: CardId, summon: CardId
    ;[s, luso] = withField(s, 0, 'forwards', '27-125S')      // earth 3000
    ;[s, theirs] = withField(s, 1, 'forwards', '24-063H')    // 8000 — 3000 is not lethal, so c1 does the breaking
    ;[s, backup] = withBreakZone(s, 0, '18-064C')
    ;[s, summon] = withBreakZone(s, 0, '20-103H')
    return { r: attackUnblocked(s, [luso]), luso, theirs, backup, summon }
  }

  it('c2 raises "select up to 2 of the 2 following actions" with the printed wordings as its labels', () => {
    const { r, luso } = lusoHits()
    expect(r.events).toContainEqual({ type: 'abilityTriggered', player: 0, card: luso, abilityId: '27-125S:damages-opponent' })
    expect(r.state.pending).toEqual({
      kind: 'chooseMode', player: 0, min: 0, max: 2,
      labels: ['Choose 1 Forward. Deal it 3000 damage.', 'Choose 1 Character in your Break Zone. Add it to your hand.'],
    })
    ok(r.state)
  })

  it('c2 both modes: the 3000 damage cascades into Luso’s OWN c1, and the retrieval takes a Character', () => {
    const { r, luso, theirs, backup, summon } = lusoHits()
    let t = apply(r.state, { type: 'chooseMode', player: 0, modes: [0, 1] })
    // "Choose 1 Forward" is unrestricted — Luso may burn its own side.
    expect(t.state.pending).toEqual({ kind: 'chooseTargets', player: 0, min: 1, max: 1, candidates: [luso, theirs] })

    t = apply(t.state, { type: 'chooseTargets', player: 0, targets: [theirs] })
    expect(t.events).toContainEqual({ type: 'abilityDamage', source: luso, target: theirs, amount: 3000 })
    // Mode 2's prompt belongs to the SAME frame, and only the Backup is a Character.
    expect(t.state.pending).toEqual({ kind: 'chooseTargets', player: 0, min: 1, max: 1, candidates: [backup] })

    t = apply(t.state, { type: 'chooseTargets', player: 0, targets: [backup] })
    expect(t.state.players[0].hand).toContain(backup)
    expect(t.state.players[0].breakZone).toEqual([summon])
    // Only once the frame finished: c1 resolves and breaks the Forward 3000 damage did not kill.
    expect(t.events).toContainEqual({ type: 'abilityTriggered', player: 0, card: luso, abilityId: '27-125S:damages-forward' })
    expect(t.events).toContainEqual({ type: 'brokenByAbility', card: theirs, source: luso })
    expect(t.state.players[1].breakZone).toContain(theirs)
    expect(t.state.pending).toBeNull()
    expect(t.state.resolution.queue).toEqual([])
    ok(t.state)
  })

  it('c2 "up to 2" means neither action is a legal answer', () => {
    const { r, theirs, backup } = lusoHits()
    const t = apply(r.state, { type: 'chooseMode', player: 0, modes: [] })
    expect(fc(t.state, theirs)?.damage).toBe(0)
    expect(t.state.players[0].breakZone).toContain(backup)
    expect(t.state.pending).toBeNull()
    ok(t.state)
  })

  it('C2-A10: Luso and Lightning warn about nothing; Prishe keeps its one deferred clause', () => {
    // Lightning costs 7, which is more CP than five Backups (§7.7.4) can make, so its coverage is asserted on
    // the tables rather than on a live cast.
    const missing = (code: string) => (ABILITY_CLAUSES[code] as number) - (ABILITIES[code]?.length ?? 0)
    expect([missing('27-125S'), missing('27-127S'), missing('22-068R')]).toEqual([0, 0, 1])
    const r = cast(makeGame(), '27-125S', [EARTH_BACKUP])
    expect(r.events.some((e) => e.type === 'unimplementedAbility')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// The database wiring
// ---------------------------------------------------------------------------

describe('the ASTs are merged onto the fetched defs, not stored in them', () => {
  const raw = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'cards.json'), 'utf8')) as CardDef[]

  it('data/cards.json is machine-owned and carries no hand-written ability data', () => {
    // `scripts/fetch-cards.ts` regenerates that file; anything hand-written in it would be wiped by a refetch.
    expect(raw.some((d) => d.abilities !== undefined || d.abilityClauses !== undefined)).toBe(false)
  })

  it('loadCards merges the ten implemented clauses on, and only those ten', () => {
    // Five from rung C1, five from C2 — three in stage 1 (Lightning ×2, Luso c1) and two in stage 2
    // (Luso c2, Prishe c2). Any clause added without a test lands here first.
    const implemented = DEFS.filter((d) => (d.abilities?.length ?? 0) > 0).map((d) => d.code).sort()
    expect(implemented).toEqual(['12-120C', '16-092C', '18-124C', '20-103H', '22-068R', '27-124S', '27-125S', '27-127S'])
    expect(DEFS.flatMap((d) => d.abilities ?? []).map((a) => a.id).sort()).toEqual([
      '12-120C:etb', '16-092C:etb', '18-124C:etb', '20-103H:summon', '22-068R:damages-opponent',
      '27-124S:etb', '27-125S:damages-forward', '27-125S:damages-opponent',
      '27-127S:etb', '27-127S:opponent-forward-broken',
    ])
  })

  it('every ability id is `<code>:<slug>` for a card that exists, and quotes text the card really prints', () => {
    for (const def of DEFS) {
      for (const ability of def.abilities ?? []) {
        expect(ability.id.startsWith(`${def.code}:`), ability.id).toBe(true)
        // C1-1: the AST is checked against `def.text` in review, so `text` must be a verbatim slice of it.
        expect(def.text, ability.id).toContain(ability.text)
      }
    }
    for (const code of Object.keys(ABILITIES)) expect(DEFS.some((d) => d.code === code), code).toBe(true)
  })

  it('every card with printed abilities declares abilityClauses, and never fewer than it implements (spec C1-9)', () => {
    // Without this the engine falls back to `hasAbilities ? 1 : 0` and a partly-implemented card reports
    // nothing missing — the dishonest log C1-9 forbids.
    for (const def of DEFS) {
      if (!def.hasAbilities) continue
      expect(def.abilityClauses, def.code).toBeGreaterThanOrEqual(1)
      expect(def.abilityClauses as number, def.code).toBeGreaterThanOrEqual(def.abilities?.length ?? 0)
    }
    for (const code of Object.keys(ABILITY_CLAUSES)) expect(DEFS.some((d) => d.code === code), code).toBe(true)
  })

  it('leaves everything else about a def alone', () => {
    for (const def of DEFS) {
      const source = raw.find((d) => d.code === def.code) as CardDef
      const stripped: CardDef = { ...def }
      delete stripped.abilities
      delete stripped.abilityClauses
      expect(stripped).toEqual(source)
    }
  })
})

/** Sanity: the defs the engine sees really do carry the ASTs, so `defOf` resolves them mid-game. */
describe('defOf sees the merged abilities', () => {
  it('finds Noel’s ETB through the live GameState', () => {
    let s = makeGame(); let noel: CardId
    ;[s, noel] = withField(s, 0, 'forwards', '16-092C')
    expect(defOf(s, noel).abilities?.[0]?.id).toBe('16-092C:etb')
  })
})
