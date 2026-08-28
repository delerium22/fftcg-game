import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { CardDef, CardId, Event, FieldCard, GameState, PlayerId } from '@fftcg/engine'
import { actingPlayer, apply, applyChooseFirst, applyMulligan, backupElements, finishEndPhase, canPay, castRequirement, checkInvariants, createGame, deckPickCandidates, defOf, describeAbilityEffect, knows, warnUnimplemented, viewFor, findFieldCard, generateCp, legalCommands, powerOf, runRuleProcesses } from '@fftcg/engine'
import { ABILITIES, ABILITY_CLAUSES, INERT_CLAUSES, loadCards } from '../src/index.js'

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
  const fc: FieldCard = { id, status: 'active', damage: 0, enteredTurn: 0, attackedThisTurn: false, granted: [], powerBonus: 0, flags: [], usedThisTurn: [], ...over }
  const ps = s.players[player]
  return [setPlayer(s, player, { ...ps, [zone]: [...ps[zone], fc] }), id]
}
function withHand(state: GameState, player: PlayerId, code: string): [GameState, CardId] {
  const [s, id] = addInstance(state, player, code)
  const ps = s.players[player]
  return [setPlayer(s, player, { ...ps, hand: [...ps.hand, id] }), id]
}
/** Stack `codes` on top of `player`'s deck, TOP FIRST, and return their ids in that order. */
function withDeckTops(state: GameState, player: PlayerId, codes: string[]): [GameState, CardId[]] {
  let s = state
  const ids: CardId[] = []
  for (const code of codes) { let id: CardId; [s, id] = addInstance(s, player, code); ids.push(id) }
  const ps = s.players[player]
  return [setPlayer(s, player, { ...ps, deck: [...ids, ...ps.deck] }), ids]
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
    expect(r.events).toContainEqual({ type: 'abilityNoLegalTarget', card: r.card, abilityId: '16-092C:etb', controller: 0 })
  })

  it('warns about nothing now that C3 landed its second clause', () => {
    // Until rung C3 this asserted the opposite: Noel's "[Dull], put Noel into the Break Zone: Dull all the
    // Forwards opponent controls." was unimplemented and the cast had to say so. Both printed clauses now
    // have ASTs, so the warning must STOP — a card that keeps apologising for a clause it has is as
    // dishonest as one that stays silent about a clause it lacks. Cloud and Miner still carry that half of
    // the C1-9 property.
    const r = cast(makeGame(), '16-092C', Array<string>(5).fill(LIGHTNING_BACKUP))
    expect(r.events.some((e) => e.type === 'unimplementedAbility')).toBe(false)
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

  it('warns about nothing now that C5 landed its Attack-Phase clause', () => {
    // Until rung C5 this asserted the opposite: "At the beginning of the Attack Phase during each of your
    // turns, …" needed the phase continuation C2 left a seam for, and Cloud had to keep saying so. Both
    // printed clauses now have ASTs, so the warning must STOP.
    const { r } = cloudOnBoard()
    expect(r.events.some((e) => e.type === 'unimplementedAbility')).toBe(false)
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
    expect(r.events).toContainEqual({ type: 'abilityNoLegalTarget', card: r.card, abilityId: '18-124C:etb', controller: 0 })
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

  it('warns about nothing — C11 landed the when-chosen clause', () => {
    // It was deferred because "when Prishe is chosen" must fire while a frame is mid-flight choosing
    // targets, which the agenda cannot preempt (C2-13). C11 landed it WITHOUT preemption: the effect is
    // choice-free, so it is applied inline where the choice is fixed.
    const r = cast(makeGame(), '22-068R', [EARTH_BACKUP, EARTH_BACKUP])
    expect(r.events.some((e) => e.type === 'unimplementedAbility')).toBe(false)
    expect(ABILITY_CLAUSES['22-068R']).toBe(2)
    expect(ABILITIES['22-068R']?.length).toBe(2)
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

  it('C2-A10: Luso, Lightning and (since C11) Prishe all warn about nothing', () => {
    // Lightning costs 7, which is more CP than five Backups (§7.7.4) can make, so its coverage is asserted on
    // the tables rather than on a live cast.
    const missing = (code: string) => (ABILITY_CLAUSES[code] as number) - (ABILITIES[code]?.length ?? 0)
    expect([missing('27-125S'), missing('27-127S'), missing('22-068R')]).toEqual([0, 0, 0])
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

  it('loadCards merges the twenty-seven implemented clauses on, and only those twenty-seven', () => {
    // Five from C1, five from C2, six from C3's activated abilities, two from C4 (both of Odin's), one from
    // C5 (Cloud's Attack-Phase clause), one from C6 (Moogle's colour fixing), one from C7 (Undead Princess's
    // removal), one from C8 (Hugh Yurg's enters-field observer), three from C9 (Reeve's look, Miner's reveal and Hugh Yurg's search) and one from C10 (Sphene's
    // retrieve). Any
    // clause added without a test lands here first.
    const implemented = DEFS.filter((d) => (d.abilities?.length ?? 0) > 0).map((d) => d.code).sort()
    expect(implemented).toEqual([
      '1-121C', '12-120C', '13-072R', '16-092C', '18-064C', '18-069C', '18-124C', '19-052C', '20-074C',
      '20-103H', '20-105C', '22-068R', '24-063H', '27-124S', '27-125S', '27-126S', '27-127S', '9-074C',
    ].sort())
    expect(DEFS.flatMap((d) => d.abilities ?? []).map((a) => a.id).sort()).toEqual([
      // Sorted on both sides: these are card codes, so '9-074C' sorts AFTER '27-…' as a string, and pinning
      // a hand-written order just makes the next insertion fail for the wrong reason.
      '1-121C:haste', '12-120C:etb', '13-072R:cost-reduction', '13-072R:summon', '16-092C:dull-all',
      '16-092C:etb', '18-064C:draw', '18-069C:draw',
      '18-124C:etb', '19-052C:pump', '19-052C:remove', '20-074C:draw', '20-074C:etb', '20-103H:summon',
      '20-105C:etb', '22-068R:chosen', '22-068R:damages-opponent', '24-063H:cheap-forward', '24-063H:search', '27-126S:retrieve',
      '27-124S:attack-phase', '27-124S:etb', '27-125S:damages-forward', '27-125S:damages-opponent',
      '27-127S:etb', '27-127S:opponent-forward-broken', '9-074C:lightning-cp',
    ].sort())
  })

  // Spec C3-A6: `ABILITY_CLAUSES` counts PRINTED clauses, implemented or not, so landing a clause must NOT
  // change it. Reducing Miner from 2 to 1 would silently hide the deck-reveal clause it still does not have.
  it('landing a clause never changes a printed-clause count', () => {
    expect(ABILITY_CLAUSES['20-074C']).toBe(2)   // action landed; the ETB deck reveal is still missing
    expect(ABILITY_CLAUSES['19-052C']).toBe(2)   // BOTH clauses land as of C7, and the count still does not move
    expect(ABILITY_CLAUSES['1-121C']).toBe(1)
    expect(ABILITY_CLAUSES['18-064C']).toBe(1)
    // And the cards with a clause still missing must still say so.
    // Miner is complete as of C9 — both printed clauses have ASTs, and the count still does not move.
    expect(ABILITY_CLAUSES['20-074C']).toBe(2)
    expect(ABILITIES['20-074C']?.length).toBe(2)
    // Undead Princess is complete as of C7, so she must now warn about nothing.
    const princess = DEFS.find((d) => d.code === '19-052C')
    expect((princess?.abilityClauses ?? 0) - (princess?.abilities?.length ?? 0)).toBe(0)
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
      delete stripped.inertClauses
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

// ---------------------------------------------------------------------------
// Rung C3 — the six ACTIVATED clauses, executed through the real command pipeline
// ---------------------------------------------------------------------------

/**
 * The engine suite proves the activation transaction on synthetic cards; these prove the six hand-written
 * ASTs do what their printed text says, driven end to end. Every one goes through `legalCommands` first, so
 * reachability and behaviour are asserted together — an ability the engine would execute but never offer is
 * as useless as one that does the wrong thing.
 */
describe('C3 activated abilities, on the real defs', () => {
  /** The activation of `abilityId` on `source`, taken from `legalCommands` rather than hand-built. */
  function offered(s: GameState, source: CardId, abilityId: string) {
    return legalCommands(s, 0).filter((c) => c.type === 'activateAbility' && c.source === source && c.abilityId === abilityId)
  }

  it('1-121C Red Mage — "[Lightning][Dull]: Choose 1 Forward. It gains Haste until the end of the turn."', () => {
    let s = makeGame()
    let src: CardId; let target: CardId
    ;[s, src] = withField(s, 0, 'backups', '1-121C')
    ;[s] = withCp(s, 0, [LIGHTNING_BACKUP])   // the Lightning CP — NOT Red Mage itself
    ;[s, target] = withField(s, 0, 'forwards', '27-124S')

    const cmds = offered(s, src, '1-121C:haste')
    expect(cmds.length).toBeGreaterThan(0)
    // The source may never pay for itself (spec C3-5).
    for (const c of cmds) if (c.type === 'activateAbility') expect(c.payment.dullBackups).not.toContain(src)
    const pick = cmds.find((c) => c.type === 'activateAbility' && c.targets.includes(target))
    expect(pick).toBeDefined()

    const r = apply(s, pick!)
    expect(fc(r.state, target)?.granted).toContain('haste')
    expect(fc(r.state, src)?.status).toBe('dull')
    ok(r.state)
  })

  it('16-092C Noel — "[Dull], put Noel into the Break Zone: Dull all the Forwards opponent controls."', () => {
    let s = makeGame()
    let src: CardId; let a: CardId; let b: CardId
    ;[s, src] = withField(s, 0, 'forwards', '16-092C')
    ;[s, a] = withField(s, 1, 'forwards', '27-124S')
    ;[s, b] = withField(s, 1, 'forwards', '27-125S')

    const cmds = offered(s, src, '16-092C:dull-all')
    expect(cmds.length).toBe(1)   // no CP, no targets — exactly one way to do it
    const r = apply(s, cmds[0]!)

    expect(r.state.players[1].forwards.find((c) => c.id === a)?.status).toBe('dull')
    expect(r.state.players[1].forwards.find((c) => c.id === b)?.status).toBe('dull')
    // The cost removed Noel, and it was NOT a break.
    expect(r.state.players[0].breakZone).toContain(src)
    expect(r.events.some((e) => e.type === 'brokenByAbility')).toBe(false)
    ok(r.state)
  })

  it('20-074C Miner — "[2][Dull], put Miner into the Break Zone: Draw 1 card."', () => {
    let s = makeGame()
    let src: CardId
    ;[s, src] = withField(s, 0, 'backups', '20-074C')
    ;[s] = withCp(s, 0, [EARTH_BACKUP, EARTH_BACKUP])   // a GENERIC [2]: any two CP will do
    const before = s.players[0].hand.length

    const cmds = offered(s, src, '20-074C:draw')
    expect(cmds.length).toBeGreaterThan(0)
    const r = apply(s, cmds[0]!)

    expect(r.state.players[0].hand.length).toBe(before + 1)
    expect(r.state.players[0].breakZone).toContain(src)
    ok(r.state)
  })

  it('19-052C Undead Princess — "Put Undead Princess into the Break Zone: Choose 1 Forward. +4000 power."', () => {
    let s = makeGame()
    let src: CardId; let ally: CardId
    ;[s, src] = withField(s, 0, 'forwards', '19-052C')
    ;[s, ally] = withField(s, 0, 'forwards', '27-124S')
    const base = powerOfId(s, ally)

    const cmds = offered(s, src, '19-052C:pump')
    // She is in the Break Zone by the time targets are validated, so she is never offered as her own target.
    for (const c of cmds) if (c.type === 'activateAbility') expect(c.targets).not.toContain(src)
    const pick = cmds.find((c) => c.type === 'activateAbility' && c.targets.includes(ally))
    expect(pick).toBeDefined()

    const r = apply(s, pick!)
    expect(powerOfId(r.state, ally)).toBe(base + 4000)
    expect(r.state.players[0].breakZone).toContain(src)
    ok(r.state)
  })

  it('19-052C Undead Princess is illegal when she is the only Forward', () => {
    // Nothing to pump once she has paid, so the activation must not be offered at all (§11.6.5).
    let s = makeGame()
    let src: CardId
    ;[s, src] = withField(s, 0, 'forwards', '19-052C')
    expect(offered(s, src, '19-052C:pump')).toEqual([])
    expect(s.players[0].breakZone).not.toContain(src)
  })

  for (const [code, id, element] of [['18-064C', '18-064C:draw', EARTH_BACKUP], ['18-069C', '18-069C:draw', LIGHTNING_BACKUP]] as const) {
    it(`${code} — "[Element], discard: Draw 1 card. You can only use this ability if it is in your hand."`, () => {
      let s = makeGame()
      let src: CardId
      ;[s, src] = withHand(s, 0, code)
      ;[s] = withCp(s, 0, [element])
      const before = s.players[0].hand.length

      const cmds = offered(s, src, id)
      expect(cmds.length).toBeGreaterThan(0)
      const r = apply(s, cmds[0]!)

      // -1 for the discarded source, +1 for the draw.
      expect(r.state.players[0].hand.length).toBe(before)
      expect(r.state.players[0].hand).not.toContain(src)
      expect(r.state.players[0].breakZone).toContain(src)
      ok(r.state)
    })

    it(`${code} cannot use its hand-only ability from the field`, () => {
      let s = makeGame()
      let onField: CardId
      ;[s, onField] = withField(s, 0, 'backups', code)
      ;[s] = withCp(s, 0, [element])
      expect(offered(s, onField, id)).toEqual([])
    })
  }
})

// ---------------------------------------------------------------------------
// Rung C4 — 13-072R Odin's Summon clause
// ---------------------------------------------------------------------------

describe('13-072R Odin — "EX BURST Choose 1 Forward of cost 5 or less. Break it."', () => {
  /** Odin cast for its full printed cost, with the resulting target prompt live. */
  function castOdin(extra: (s: GameState) => GameState = (x) => x): { state: GameState; events: ReturnType<typeof apply>['events'] } {
    let s = makeGame()
    ;[s] = withCp(s, 0, Array<string>(5).fill(LIGHTNING_BACKUP))
    s = extra(s)
    let odin: CardId
    ;[s, odin] = withHand(s, 0, '13-072R')
    const cast = legalCommands(s, 0).find((c) => c.type === 'castSummon' && c.card === odin)
    expect(cast, 'Odin was not castable').toBeDefined()
    return apply(s, cast!)
  }

  it('offers every Forward of printed cost 5 or less, on EITHER side, and nothing above it', () => {
    let cheapMine: CardId; let cheapTheirs: CardId; let expensive: CardId
    const r = castOdin((s0) => {
      let s = s0
      ;[s, cheapMine] = withField(s, 0, 'forwards', '19-052C')    // cost 1
      ;[s, cheapTheirs] = withField(s, 1, 'forwards', '27-124S')  // cost 3
      ;[s, expensive] = withField(s, 1, 'forwards', '16-092C')    // cost 5 — inclusive, so still legal
      return s
    })
    expect(r.state.pending?.kind).toBe('chooseTargets')
    const candidates = r.state.pending?.kind === 'chooseTargets' ? [...r.state.pending.candidates] : []
    // "Choose 1 Forward" is unrestricted by controller, and "cost 5 or less" is inclusive.
    expect(candidates.sort()).toEqual([cheapMine!, cheapTheirs!, expensive!].sort())
  })

  it('excludes a Forward whose PRINTED cost is above 5', () => {
    // Lightning (27-127S) is the pool's only Forward above the ceiling, at cost 7; Noel is exactly 5, which
    // "5 or less" includes. Both on the board, so the test distinguishes a working filter from an absent one.
    let over: CardId; let atLimit: CardId
    const r = castOdin((s0) => {
      let s = s0
      ;[s, over] = withField(s, 1, 'forwards', '27-127S')     // cost 7 — must NOT be offered
      ;[s, atLimit] = withField(s, 1, 'forwards', '16-092C')  // cost 5 — must be offered
      return s
    })
    const candidates = r.state.pending?.kind === 'chooseTargets' ? r.state.pending.candidates : []
    expect(candidates).toContain(atLimit!)
    expect(candidates).not.toContain(over!)
  })

  it('breaks the chosen Forward', () => {
    let victim: CardId
    const r = castOdin((s0) => {
      let s = s0
      ;[s, victim] = withField(s, 1, 'forwards', '27-124S')
      return s
    })
    const done = apply(r.state, { type: 'chooseTargets', player: 0, targets: [victim!] })
    expect(done.state.players[1].forwards.some((c) => c.id === victim!)).toBe(false)
    expect(done.state.players[1].breakZone).toContain(victim!)
    ok(done.state)
  })

  it('warns about nothing, now that BOTH of Odin\'s printed clauses have ASTs', () => {
    // ABILITY_CLAUSES counts PRINTED clauses and must not move; what changes is that the implemented count
    // caught up with it. Doing both clauses of one card is the only way to watch a whole card work.
    expect(ABILITY_CLAUSES['13-072R']).toBe(2)
    expect(ABILITIES['13-072R']?.length).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// Rung C4 — 13-072R Odin's static cost reduction
// ---------------------------------------------------------------------------

describe('13-072R Odin — "If you have received 5 points of damage or more, the cost … is reduced by 3."', () => {
  /** `n` cards in `p`'s damage zone, taken off their own deck so every instance stays in exactly one zone. */
  function damaged(state: GameState, p: PlayerId, n: number): GameState {
    const ps = state.players[p]
    return setPlayer(state, p, { ...ps, damageZone: ps.deck.slice(0, n), deck: ps.deck.slice(n) })
  }

  /** What Odin costs `caster` right now. `withHand` MINTS the instance, so the requirement must be read off
   *  the state it returned — not the one handed in, which has never heard of the card. */
  const odinCost = (state: GameState, caster: PlayerId = 0) => {
    const [s, odin] = withHand(state, caster, '13-072R')
    return castRequirement(s, odin, caster).amount
  }

  it('costs its printed 5 below the threshold and 2 at it (C4-A1)', () => {
    const base = makeGame()
    expect(odinCost(base)).toBe(5)
    expect(odinCost(damaged(base, 0, 4))).toBe(5)   // four is not "5 or more"
    expect(odinCost(damaged(base, 0, 5))).toBe(2)
    expect(odinCost(damaged(base, 0, 6))).toBe(2)
  })

  it('reads the CASTER\'s damage, not the opponent\'s (C4-A2)', () => {
    // The one mistake a symmetric fixture cannot catch: reversed, Odin would be cheap exactly when you are
    // winning, and a test that only checks "the reduction happened" would still pass.
    const base = makeGame()
    expect(odinCost(damaged(base, 1, 5), 0)).toBe(5)
    expect(odinCost(damaged(base, 0, 5), 0)).toBe(2)
  })

  it('is actually castable for the reduced cost, through legalCommands (C4-A1)', () => {
    let s = damaged(makeGame(), 0, 5)
    ;[s] = withCp(s, 0, [LIGHTNING_BACKUP, LIGHTNING_BACKUP])   // exactly 2 CP — not the printed 5
    let odin: CardId
    ;[s, odin] = withHand(s, 0, '13-072R')
    ;[s] = withField(s, 1, 'forwards', '27-124S')               // a legal target, so the Summon can resolve

    const casts = legalCommands(s, 0).filter((c) => c.type === 'castSummon' && c.card === odin)
    expect(casts.length, 'Odin was not castable for the reduced cost').toBeGreaterThan(0)
    // Every enumerated payment totals the REDUCED cost: two dulled Backups, never five.
    for (const c of casts) if (c.type === 'castSummon') expect(c.payment.dullBackups.length).toBe(2)
    ok(apply(s, casts[0]!).state)
  })

  it('never resolves: no frame, no event, no resolution step (C4-A4)', () => {
    let s = damaged(makeGame(), 0, 5)
    ;[s] = withCp(s, 0, [LIGHTNING_BACKUP, LIGHTNING_BACKUP])
    let odin: CardId
    ;[s, odin] = withHand(s, 0, '13-072R')
    ;[s] = withField(s, 1, 'forwards', '27-124S')
    const cast = legalCommands(s, 0).find((c) => c.type === 'castSummon' && c.card === odin)
    const r = apply(s, cast!)

    // Exactly one clause reaches the agenda — the Summon effect. The static contributes nothing.
    const triggered = r.events.filter((e) => e.type === 'abilityTriggered')
    expect(triggered.map((e) => (e as { abilityId: string }).abilityId)).toEqual(['13-072R:summon'])
    const queued = [r.state.resolution.active, ...r.state.resolution.queue].filter(Boolean)
    expect(queued.every((f) => f?.abilityId !== '13-072R:cost-reduction')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Rung C5 — 27-124S Cloud's Attack-Phase clause, and the split transition
// ---------------------------------------------------------------------------

describe('27-124S Cloud — "At the beginning of the Attack Phase during each of your turns, …"', () => {
  const pass = (state: GameState, player: PlayerId) => apply(state, { type: 'pass', player })

  it('reaches declaration in one pass when nothing triggers, emitting each phase event once (C5-A2)', () => {
    const r = pass(makeGame(), 0)
    expect(r.state.phase).toBe('attack')
    expect(r.state.attack?.step).toBe('declaration')
    const steps = r.events.filter((e) => e.type === 'phaseStarted' && e.phase === 'attack')
      .map((e) => (e as { step?: string }).step)
    expect(steps).toEqual(['preparation', 'declaration'])
  })

  it('raises Cloud\'s choice DURING preparation, and declaration follows the answer (C5-A1)', () => {
    let s = makeGame()
    let cloud: CardId; let ally: CardId
    ;[s, cloud] = withField(s, 0, 'forwards', '27-124S')
    ;[s, ally] = withField(s, 0, 'forwards', '19-052C')

    const r = pass(s, 0)
    // The clause fired at a moment the state genuinely says Attack Phase — the whole point of the split.
    expect(r.state.phase).toBe('attack')
    expect(r.state.attack?.step).toBe('preparation')
    expect(r.state.pending?.kind).toBe('chooseTargets')
    const candidates = r.state.pending?.kind === 'chooseTargets' ? [...r.state.pending.candidates].sort() : []
    expect(candidates).toEqual([cloud, ally].sort())   // "1 Forward you control" — Cloud may choose itself

    const done = apply(r.state, { type: 'chooseTargets', player: 0, targets: [ally] })
    expect(done.state.attack?.step).toBe('declaration')
    expect(done.state.pending).toBeNull()
    ok(done.state)
  })

  it('grants BOTH printed protections, and cannotBeBroken really prevents a break (C5-A4)', () => {
    // Two Forwards, ONE of them chosen, then lethal damage to BOTH. The unchosen one is the control: without
    // it this test could pass while proving nothing about the flag, which is exactly what its first version
    // did — it asserted that player 1 conceding makes player 0 the winner, which is true of every state.
    let s = makeGame()
    let cloud: CardId; let control: CardId
    ;[s, cloud] = withField(s, 0, 'forwards', '27-124S')
    ;[s, control] = withField(s, 0, 'forwards', '16-092C')

    const r = pass(s, 0)
    const done = apply(r.state, { type: 'chooseTargets', player: 0, targets: [cloud] })
    expect([...(fc(done.state, cloud)?.flags ?? [])].sort()).toEqual(['cannotBeBroken', 'cannotBeReturnedByOpponent'])
    expect(fc(done.state, control)?.flags ?? []).toEqual([])

    // Lethal damage to both, then a legal command so `apply` settles and §12.4.5 runs.
    const lethal = (state: GameState): GameState => {
      const ps = state.players[0]
      const players = [state.players[0], state.players[1]] as typeof state.players
      players[0] = { ...ps, forwards: ps.forwards.map((c) => ({ ...c, damage: powerOf(state, c) + 1000 })) }
      return { ...state, players }
    }
    const settled = apply(lethal(done.state), { type: 'pass', player: 0 })

    // The protected one survives; the identically-damaged control does not. Only `cannotBeBroken` separates
    // them, so the assertion cannot pass without it. §12.4.5 filters the protected card out of the transition
    // list entirely, so there is no event to look for — survival IS the observable.
    expect(settled.state.players[0].forwards.some((c) => c.id === cloud)).toBe(true)
    expect(settled.state.players[0].forwards.some((c) => c.id === control)).toBe(false)
    expect(settled.state.players[0].breakZone).toContain(control)
    ok(settled.state)
  })

  it('fires ONLY on its controller\'s turn, with a Cloud on each side (C5-A3)', () => {
    // The mistake a one-sided fixture cannot catch: scanning both fields would hand the opponent a free
    // protection every round.
    let s = makeGame()
    let mine: CardId; let theirs: CardId
    ;[s, mine] = withField(s, 0, 'forwards', '27-124S')
    ;[s, theirs] = withField(s, 1, 'forwards', '27-124S')

    const r = pass(s, 0)
    expect(r.state.pending?.kind).toBe('chooseTargets')
    const candidates = r.state.pending?.kind === 'chooseTargets' ? r.state.pending.candidates : []
    // Only player 0's own Forward is offered, and the opponent's Cloud never got a choice of its own.
    expect(candidates).toEqual([mine])
    expect(candidates).not.toContain(theirs)

    const done = apply(r.state, { type: 'chooseTargets', player: 0, targets: [mine] })
    expect(fc(done.state, theirs)?.flags ?? []).toEqual([])
  })

  it('keeps both printed clause counts honest (C5-A5)', () => {
    expect(ABILITY_CLAUSES['27-124S']).toBe(2)
    expect(ABILITIES['27-124S']?.length).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// Rung C6 — 9-074C Class Tenth Moogle's colour fixing
// ---------------------------------------------------------------------------

describe('9-074C Class Tenth Moogle — "… can produce Lightning CP."', () => {
  const EARTH_ONLY = '18-064C'   // Geomancer: printed Earth, no colour fixing

  /** Can `player` cover `req` by dulling exactly `backups`? */
  const covers = (state: GameState, backups: CardId[], amount: number, els: ('earth' | 'lightning')[]) =>
    canPay(amount, els, generateCp(state, 0, { dullBackups: backups, discards: [] }, []))

  it('a dulled Moogle counts as EITHER of its Elements (C6-A1)', () => {
    let s = makeGame()
    let moogle: CardId
    ;[s, moogle] = withField(s, 0, 'backups', '9-074C')
    expect(covers(s, [moogle], 1, ['lightning'])).toBe(true)
    expect(covers(s, [moogle], 1, ['earth'])).toBe(true)   // its printed Element still works
  })

  it('is still only ONE CP, so it cannot cover a doubled requirement (C6-A2)', () => {
    let s = makeGame()
    let moogle: CardId
    ;[s, moogle] = withField(s, 0, 'backups', '9-074C')
    expect(covers(s, [moogle], 2, ['lightning', 'lightning'])).toBe(false)
  })

  it('does not fix colours for anyone else (C6-A3)', () => {
    let s = makeGame()
    let plain: CardId
    ;[s, plain] = withField(s, 0, 'backups', EARTH_ONLY)
    expect(covers(s, [plain], 1, ['lightning'])).toBe(false)
    expect(covers(s, [plain], 1, ['earth'])).toBe(true)
  })

  it('is matched, not assigned greedily (C6-A4)', () => {
    // The case a greedy pass gets wrong: taking the requirements in printed order gives Earth to Moogle
    // first, stranding the pure-Earth Backup on Lightning. Only a search that backtracks finds the swap.
    let s = makeGame()
    let moogle: CardId; let plain: CardId
    ;[s, moogle] = withField(s, 0, 'backups', '9-074C')
    ;[s, plain] = withField(s, 0, 'backups', EARTH_ONLY)
    expect(covers(s, [moogle, plain], 2, ['earth', 'lightning'])).toBe(true)
    expect(covers(s, [moogle, plain], 2, ['lightning', 'earth'])).toBe(true)   // and in either order
  })

  it('applies only from the FIELD (C6-A5)', () => {
    // "If Class Tenth Moogle is on the field" — in hand or the Break Zone it fixes nothing.
    //
    // The first version of this test placed Moogles in those zones and then paid with a DIFFERENT Backup,
    // so it asserted nothing that the "does not fix colours for anyone else" test above did not already.
    // A card off the field cannot be dulled at all, so the observable is `backupElements` itself.
    let s = makeGame()
    let onField: CardId; let inHand: CardId; let inBreak: CardId
    ;[s, onField] = withField(s, 0, 'backups', '9-074C')
    ;[s, inHand] = withHand(s, 0, '9-074C')
    ;[s, inBreak] = withBreakZone(s, 0, '9-074C')

    expect(backupElements(s, onField).sort()).toEqual(['earth', 'lightning'])
    expect(backupElements(s, inHand)).toEqual(['earth'])
    expect(backupElements(s, inBreak)).toEqual(['earth'])
  })

  it('does not fix colours for the OPPONENT (C6-A5)', () => {
    // The other half of the scope: a Moogle on the far side of the board is on "the field", but it is not
    // yours to dull, and its static must not reach your payment.
    let s = makeGame()
    let mine: CardId
    ;[s, mine] = withField(s, 0, 'backups', EARTH_ONLY)
    ;[s] = withField(s, 1, 'backups', '9-074C')
    expect(covers(s, [mine], 1, ['lightning'])).toBe(false)
  })

  it('keeps its printed clause count honest (C6-A7)', () => {
    expect(ABILITY_CLAUSES['9-074C']).toBe(1)
    expect(ABILITIES['9-074C']?.length).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Rung C7 — 19-052C Undead Princess's remove-from-game clause
// ---------------------------------------------------------------------------

describe('19-052C Undead Princess — "Remove Undead Princess in the Break Zone from the game: …"', () => {
  const EARTH_FORWARD = '19-052C'      // Undead Princess herself is Earth
  const LIGHTNING_FORWARD = '27-127S'  // Lightning

  const offered = (state: GameState, source: CardId) =>
    legalCommands(state, 0).filter((c) => c.type === 'activateAbility' && c.source === source && c.abilityId === '19-052C:remove')

  it('is offered only from the Break Zone, with an Earth Forward to target (C7-A1)', () => {
    let s = makeGame()
    let inBreak: CardId; let onField: CardId
    ;[s, inBreak] = withBreakZone(s, 0, '19-052C')
    ;[s, onField] = withField(s, 0, 'forwards', EARTH_FORWARD)

    expect(offered(s, inBreak).length).toBeGreaterThan(0)
    // The same card sitting on the FIELD cannot use a Break-Zone ability.
    expect(offered(s, onField)).toEqual([])
  })

  it('is not offered with no Earth Forward on the board (C7-A1)', () => {
    let s = makeGame()
    let inBreak: CardId
    ;[s, inBreak] = withBreakZone(s, 0, '19-052C')
    ;[s] = withField(s, 0, 'forwards', LIGHTNING_FORWARD)
    expect(offered(s, inBreak)).toEqual([])
  })

  it('offers an Earth Forward on EITHER side, and never a non-Earth one (C7-A3)', () => {
    let s = makeGame()
    let inBreak: CardId; let mine: CardId; let theirs: CardId; let wrongElement: CardId
    ;[s, inBreak] = withBreakZone(s, 0, '19-052C')
    ;[s, mine] = withField(s, 0, 'forwards', EARTH_FORWARD)
    ;[s, theirs] = withField(s, 1, 'forwards', EARTH_FORWARD)
    ;[s, wrongElement] = withField(s, 1, 'forwards', LIGHTNING_FORWARD)

    const targets = offered(s, inBreak).flatMap((c) => (c.type === 'activateAbility' ? [...c.targets] : []))
    expect([...new Set(targets)].sort()).toEqual([mine, theirs].sort())
    expect(targets).not.toContain(wrongElement)
  })

  it('removes her from the game and pumps the chosen Forward (C7-A2/C7-A6)', () => {
    let s = makeGame()
    let inBreak: CardId; let target: CardId
    ;[s, inBreak] = withBreakZone(s, 0, '19-052C')
    ;[s, target] = withField(s, 0, 'forwards', EARTH_FORWARD)
    const base = powerOfId(s, target)

    const cmd = offered(s, inBreak).find((c) => c.type === 'activateAbility' && c.targets.includes(target))
    expect(cmd).toBeDefined()
    const r = apply(s, cmd!)

    expect(r.state.players[0].removedFromGame).toContain(inBreak)
    expect(r.state.players[0].breakZone).not.toContain(inBreak)
    expect(powerOfId(r.state, target)).toBe(base + 2000)
    // Removal is neither a break nor a discard.
    expect(r.events.some((e) => e.type === 'removedFromGame')).toBe(true)
    expect(r.events.some((e) => e.type === 'brokenByAbility' || e.type === 'discarded')).toBe(false)
    ok(r.state)   // C7-A4: still exactly one place for every card
  })
})

// ---------------------------------------------------------------------------
// Rung C8 — 24-063H Hugh Yurg's enters-field observer
// ---------------------------------------------------------------------------

describe('24-063H Hugh Yurg — "When a Forward of cost 1 enters your field, …"', () => {
  const COST_1_FORWARD = '19-052C'   // Undead Princess, cost 1 — the C7 combo
  const COST_1_BACKUP = '18-064C'    // Geomancer, cost 1
  const COST_3_FORWARD = '27-124S'   // Cloud

  /** Cast `code` for player 0 with exactly enough CP, and return the resulting state. */
  function castFor(state: GameState, code: string) {
    const def = DEFS.find((d) => d.code === code)!
    let s = state
    ;[s] = withCp(s, 0, Array<string>(def.cost).fill(EARTH_BACKUP))
    let card: CardId
    ;[s, card] = withHand(s, 0, code)
    const cmd = legalCommands(s, 0).find((c) => (c.type === 'castCharacter' || c.type === 'castSummon') && c.card === card)
    expect(cmd, `${code} was not castable`).toBeDefined()
    return { r: apply(s, cmd!), card }
  }

  it('fires on a cost-1 Forward, granting +2000 and Brave (C8-A1)', () => {
    let s = makeGame()
    let yurg: CardId; let ally: CardId; let theirs: CardId
    ;[s, yurg] = withField(s, 0, 'forwards', '24-063H')
    ;[s, ally] = withField(s, 0, 'forwards', COST_3_FORWARD)
    ;[s, theirs] = withField(s, 1, 'forwards', COST_3_FORWARD)
    const base = powerOfId(s, ally)

    const { r } = castFor(s, COST_1_FORWARD)
    expect(r.state.pending?.kind).toBe('chooseTargets')
    // "Choose 1 Forward" is unrestricted by controller. Without this the scope could be narrowed to 'self'
    // and no test in the repo would notice — the card comment asserts the property, so a test must too.
    const candidates = r.state.pending?.kind === 'chooseTargets' ? r.state.pending.candidates : []
    expect(candidates).toContain(theirs)

    const done = apply(r.state, { type: 'chooseTargets', player: 0, targets: [ally] })
    expect(powerOfId(done.state, ally)).toBe(base + 2000)
    expect(fc(done.state, ally)?.granted).toContain('brave')
    void yurg
    ok(done.state)
  })

  it('does NOT fire on a cost-3 Forward — the filter is exact, not a ceiling (C8-A2)', () => {
    let s = makeGame()
    ;[s] = withField(s, 0, 'forwards', '24-063H')
    const { r } = castFor(s, COST_3_FORWARD)
    // Cloud's own ETB needs no choice, so any pending here would be Hugh Yurg's.
    expect(r.state.pending).toBeNull()
  })

  it('does NOT fire on a cost-1 BACKUP (C8-A4)', () => {
    let s = makeGame()
    ;[s] = withField(s, 0, 'forwards', '24-063H')
    const { r } = castFor(s, COST_1_BACKUP)
    expect(r.state.pending).toBeNull()
  })

  it('fires only for the watcher whose OWN field the card entered (C8-A3)', () => {
    // The mistake one Hugh Yurg cannot detect: "your field" resolved against the turn player instead of the
    // watcher would make the opponent's copy fire too. C2-10 had to fix exactly this for the mirror trigger.
    let s = makeGame()
    let mine: CardId; let theirs: CardId; let ally: CardId
    ;[s, mine] = withField(s, 0, 'forwards', '24-063H')
    ;[s, theirs] = withField(s, 1, 'forwards', '24-063H')
    ;[s, ally] = withField(s, 0, 'forwards', COST_3_FORWARD)

    const { r } = castFor(s, COST_1_FORWARD)
    // Exactly ONE trigger is queued: player 0's. Two would mean the opponent's copy fired as well.
    const queued = [r.state.resolution.active, ...r.state.resolution.queue].filter((f) => f?.abilityId === '24-063H:cheap-forward')
    expect(queued).toHaveLength(1)
    expect(queued[0]?.source).toBe(mine)
    expect(queued[0]?.controller).toBe(0)
    void theirs; void ally
  })

  it('warns about nothing — C9 landed the deck search, so Hugh Yurg is complete', () => {
    expect(ABILITY_CLAUSES['24-063H']).toBe(2)
    expect(ABILITIES['24-063H']?.length).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// Rung C9 — 20-105C Reeve's private look
// ---------------------------------------------------------------------------

describe('20-105C Reeve — "look at the top 3 cards of your deck. Add 1 among them to your hand …"', () => {
  /** Cast Reeve for player 0 and return the state with its choice pending. */
  function castReeve() {
    let s = makeGame()
    // Reeve is LIGHTNING, cost 4 — Earth CP will not pay for it, and the assertion below says so rather
    // than letting the test pass on a cast that never happened.
    ;[s] = withCp(s, 0, Array<string>(4).fill(LIGHTNING_BACKUP))
    let reeve: CardId
    ;[s, reeve] = withHand(s, 0, '20-105C')
    const cmd = legalCommands(s, 0).find((c) => c.type === 'castCharacter' && c.card === reeve)
    expect(cmd, 'Reeve was not castable').toBeDefined()
    const top3 = s.players[0].deck.slice(0, 3)
    return { r: apply(s, cmd!), top3, before: s }
  }

  it('raises a choice among exactly three, answered by INDEX', () => {
    const { r } = castReeve()
    expect(r.state.pending?.kind).toBe('chooseFromDeck')
    if (r.state.pending?.kind !== 'chooseFromDeck') throw new Error('unreachable')
    expect(r.state.pending.count).toBe(3)
    // "1 card among them" — no filter, so every exposed position is a legal answer. The pending carries the
    // QUESTION; `deckPickCandidates` is what turns it into positions, against whichever deck the caller holds.
    expect(r.state.pending.filter).toBeUndefined()
    expect(deckPickCandidates(r.state, r.state.pending)).toEqual([0, 1, 2])
    expect(r.state.pending.min).toBe(1)
    expect(r.state.pending.max).toBe(1)
    // The pending carries no card id at all. That is what makes it valid in every determinisation.
    expect(JSON.stringify(r.state.pending)).not.toMatch(String(r.state.players[0].deck[0]))
  })

  it('takes the chosen card and bottoms the other two', () => {
    const { r, top3, before } = castReeve()
    const deckBefore = before.players[0].deck.length
    const handBefore = r.state.players[0].hand.length

    const done = apply(r.state, { type: 'chooseFromDeck', player: 0, picks: [1] })
    expect(done.state.players[0].hand).toContain(top3[1])
    expect(done.state.players[0].hand.length).toBe(handBefore + 1)
    // The other two are at the BOTTOM, in exposed order, and the deck is one shorter.
    expect(done.state.players[0].deck.slice(-2)).toEqual([top3[0], top3[2]])
    expect(done.state.players[0].deck.length).toBe(deckBefore - 1)
    expect(done.state.pending).toBeNull()
    ok(done.state)
  })

  it('is PRIVATE: the controller learns all three, the opponent learns none', () => {
    const { r, top3 } = castReeve()
    for (const id of top3) {
      expect(knows(r.state, 0, id!), 'the controller did not learn what it looked at').toBe(true)
      expect(knows(r.state, 1, id!), 'the opponent learned a card it never saw').toBe(false)
    }
  })

  it("the opponent's view shows THAT three were looked at, but not WHICH", () => {
    const { r, top3 } = castReeve()
    const theirs = viewFor(r.state, 1)
    const slots = theirs.fields[0].deck.slice(0, 3)
    expect(slots.map((d) => d.card)).toEqual([null, null, null])
    expect(slots.map((d) => d.knownBy)).toEqual([1, 1, 1])   // player 0's bit, and only that
    for (const id of top3) expect(theirs.cards[id!]).toBeUndefined()

    // And the controller's own view does name them.
    const mine = viewFor(r.state, 0)
    expect(mine.fields[0].deck.slice(0, 3).map((d) => d.card)).toEqual(top3)
  })

})

// ---------------------------------------------------------------------------
// Rung C9 — 20-074C Miner's public reveal
// ---------------------------------------------------------------------------

describe('20-074C Miner — "reveal the top 5 cards of your deck. Add 1 Backup among them to your hand ..."', () => {
  const BACKUP = '18-064C'      // Geomancer, a Backup
  const FORWARD = '27-124S'     // Cloud, a Forward - never eligible for "1 Backup among them"

  /** Cast Miner for player 0 over a deck whose top five are exactly `topFive`. */
  function castMiner(topFive: string[]) {
    let s = makeGame()
    // Miner is EARTH, cost 3.
    ;[s] = withCp(s, 0, Array<string>(3).fill(EARTH_BACKUP))
    let top: CardId[]
    ;[s, top] = withDeckTops(s, 0, topFive)
    let miner: CardId
    ;[s, miner] = withHand(s, 0, '20-074C')
    const cmd = legalCommands(s, 0).find((c) => c.type === 'castCharacter' && c.card === miner)
    expect(cmd, 'Miner was not castable').toBeDefined()
    return { r: apply(s, cmd!), top, before: s }
  }

  it('exposes five but offers only the BACKUPS among them, by index', () => {
    const { r } = castMiner([FORWARD, BACKUP, FORWARD, BACKUP, FORWARD])
    expect(r.state.pending?.kind).toBe('chooseFromDeck')
    if (r.state.pending?.kind !== 'chooseFromDeck') throw new Error('unreachable')
    expect(r.state.pending.count).toBe(5)
    // "1 BACKUP among them" - the Forwards are not offered.
    expect(r.state.pending.filter).toEqual({ type: 'backup' })
    expect(deckPickCandidates(r.state, r.state.pending)).toEqual([1, 3])
    expect(r.state.pending.min).toBe(1)
    expect(r.state.pending.max).toBe(1)
  })

  it('is PUBLIC: both players learn all five, which is the whole difference from Reeve', () => {
    const { r, top } = castMiner([FORWARD, BACKUP, FORWARD, BACKUP, FORWARD])
    for (const id of top) {
      expect(knows(r.state, 0, id), 'the controller did not learn what it revealed').toBe(true)
      expect(knows(r.state, 1, id), 'a REVEAL must tell the opponent too').toBe(true)
    }
    // And the opponent's view NAMES them, where Reeve's leaves `card: null`.
    const theirs = viewFor(r.state, 1)
    const slots = theirs.fields[0].deck.slice(0, 5)
    expect(slots.map((d) => d.card)).toEqual(top)
    expect(slots.map((d) => d.knownBy)).toEqual([3, 3, 3, 3, 3])   // both players' bits
    for (const id of top) expect(theirs.cards[id]?.code).toBeDefined()
  })

  it('takes the chosen Backup and bottoms the other four in exposed order', () => {
    const { r, top, before } = castMiner([FORWARD, BACKUP, FORWARD, BACKUP, FORWARD])
    const deckBefore = before.players[0].deck.length
    const done = apply(r.state, { type: 'chooseFromDeck', player: 0, picks: [3] })
    expect(done.state.players[0].hand).toContain(top[3])
    expect(done.state.players[0].deck.slice(-4)).toEqual([top[0], top[1], top[2], top[4]])
    expect(done.state.players[0].deck.length).toBe(deckBefore - 1)
    expect(done.state.pending).toBeNull()
    ok(done.state)
  })

  it('with NO Backup among the five, reveals anyway, takes nothing, and does not hang', () => {
    // The reveal is the effect; the addition is conditional on it. `settleLook` treats this as the same move
    // with an empty pick rather than as a failed ability, so nothing is added but the cards still go under.
    const { r, top, before } = castMiner([FORWARD, FORWARD, FORWARD, FORWARD, FORWARD])
    expect(r.state.pending, 'no eligible card must not leave a prompt standing').toBeNull()
    for (const id of top) expect(knows(r.state, 1, id), 'the reveal still happened').toBe(true)
    expect(r.state.players[0].deck.slice(-5)).toEqual(top)
    expect(r.state.players[0].deck.length).toBe(before.players[0].deck.length)
    for (const id of top) expect(r.state.players[0].hand).not.toContain(id)
    ok(r.state)
  })
})

// ---------------------------------------------------------------------------
// Rung C9 — 24-063H Hugh Yurg's search
// ---------------------------------------------------------------------------

describe('24-063H Hugh Yurg — "you may search for 1 Earth Forward of cost 1 and play it onto the field"', () => {
  const PRINCESS = '19-052C'   // Undead Princess — the STARTER deck's only Earth Forward of cost 1

  /** What the printed text finds: an Earth Forward of cost 1, EXACTLY 1 (spec C8-3's trap, on this clause too). */
  const findable = (s: GameState, id: CardId): boolean => {
    const def = defOf(s, id)
    return def.type === 'forward' && def.cost === 1 && def.elements.includes('earth')
  }

  /**
   * Cast Hugh Yurg for player 0 over a deck holding EXACTLY `copies` legal targets, stacked on top.
   *
   * This file's `DECK` is every code in the pool cycled to 50, not the starter list, so it carries several
   * other cost-1 Earth Forwards. Stripping them first is what makes `eligible` mean what the test says it
   * means — otherwise the assertion would be reading the pool's contents, not the clause's filter.
   */
  function castHughYurg(copies: number) {
    let s = makeGame()
    // Hugh Yurg is EARTH, cost 4.
    ;[s] = withCp(s, 0, Array<string>(4).fill(EARTH_BACKUP))
    const p0 = s.players[0]
    // Out of the deck, but not out of the GAME: `checkInvariants` counts every instance, so they go to a real
    // zone. `removedFromGame` is the quiet one — nothing in the pool reads it, where the Break Zone would make
    // Undead Princess's own C7 clause activatable and put noise in every assertion below.
    s = setPlayer(s, 0, {
      ...p0,
      deck: p0.deck.filter((id) => !findable(s, id)),
      removedFromGame: [...p0.removedFromGame, ...p0.deck.filter((id) => findable(s, id))],
    })
    let targets: CardId[]
    ;[s, targets] = withDeckTops(s, 0, Array<string>(copies).fill(PRINCESS))
    let hugh: CardId
    ;[s, hugh] = withHand(s, 0, '24-063H')
    const cmd = legalCommands(s, 0).find((c) => c.type === 'castCharacter' && c.card === hugh)
    expect(cmd, 'Hugh Yurg was not castable').toBeDefined()
    return { r: apply(s, cmd!), targets, hugh, before: s }
  }

  it('exposes the WHOLE deck, not a slice, and offers only the cost-1 Earth Forwards', () => {
    const { r, targets, before } = castHughYurg(2)
    expect(r.state.pending?.kind).toBe('chooseFromDeck')
    if (r.state.pending?.kind !== 'chooseFromDeck') throw new Error('unreachable')
    expect(r.state.pending.count).toBe(before.players[0].deck.length)
    // The two stacked copies are on top, so they are the first two indices — and nothing else qualifies.
    expect(r.state.pending.filter).toEqual({ type: 'forward', element: 'earth', cost: 1 })
    expect(deckPickCandidates(r.state, r.state.pending)).toEqual([0, 1])
    expect(r.state.pending.min, '"you MAY search" — declining is legal').toBe(0)
    expect(r.state.pending.max).toBe(1)
    void targets
  })

  it('tells the opponent WHAT may be taken, never WHICH positions hold it (C9 review HIGH)', () => {
    // The pending is copied into both seats' views verbatim, so everything on it is public. It used to carry
    // the resolved index list, and for a search that is a map of the searcher's hidden deck: "positions 4, 12,
    // 16, 31 and 37 are cost-1 Earth Forwards and nothing else is". The filter is the printed text and public;
    // the positions are not.
    const { r } = castHughYurg(2)
    if (r.state.pending?.kind !== 'chooseFromDeck') throw new Error('unreachable')
    const theirs = viewFor(r.state, 1)
    expect(theirs.pending?.kind).toBe('chooseFromDeck')
    expect(JSON.stringify(theirs.pending)).not.toMatch(/\d+,\d+/)   // no index list of any kind survives

    // And the opponent cannot reconstruct it: from their seat every deck slot is `card: null`, so the shared
    // computation returns nothing for them while the searcher gets both positions.
    expect(deckPickCandidates(r.state, r.state.pending)).toEqual([0, 1])
    expect(theirs.fields[0].deck.every((slot) => slot.card === null)).toBe(true)
  })

  it('answers the question against the deck the CALLER holds, not the one the pending was raised on', () => {
    // The point of carrying the filter: a determinised world computes eligibility over ITS deck. Simulated
    // here by answering the same pending against a state whose deck has been re-stacked — the resolved index
    // list would still say [0, 1] and name two cards that no longer match.
    const { r } = castHughYurg(2)
    if (r.state.pending?.kind !== 'chooseFromDeck') throw new Error('unreachable')
    const p0 = r.state.players[0]
    const rotated = setPlayer(r.state, 0, { ...p0, deck: [...p0.deck.slice(2), ...p0.deck.slice(0, 2)] })
    expect(deckPickCandidates(rotated, r.state.pending)).toEqual([p0.deck.length - 2, p0.deck.length - 1])
  })

  it('is PRIVATE: the controller sees the whole deck, the opponent sees none of it', () => {
    const { r } = castHughYurg(1)
    for (const id of r.state.players[0].deck) {
      expect(knows(r.state, 0, id), 'the searcher did not see their own deck').toBe(true)
      expect(knows(r.state, 1, id), 'a search must not show the opponent the deck').toBe(false)
    }
    const theirs = viewFor(r.state, 1)
    expect(theirs.fields[0].deck.every((slot) => slot.card === null)).toBe(true)
  })

  it('plays the found Forward onto the FIELD, not into hand, and shuffles the rest away', () => {
    const { r, targets, before } = castHughYurg(1)
    const found = targets[0]!
    const done = apply(r.state, { type: 'chooseFromDeck', player: 0, picks: [0] })

    expect(done.state.players[0].forwards.map((c) => c.id)).toContain(found)
    expect(done.state.players[0].hand, 'a search PLAYS the card; it never touches the hand').not.toContain(found)
    expect(done.state.players[0].deck).not.toContain(found)
    expect(done.state.players[0].deck.length).toBe(before.players[0].deck.length - 1)
    // The shuffle is what pays for the look: nothing left in the deck is known to anyone afterwards.
    for (const id of done.state.players[0].deck) expect(knows(done.state, 0, id)).toBe(false)
    ok(done.state)
  })

  it("triggers Hugh Yurg's OWN second clause — the card combos with itself", () => {
    // A cost-1 Earth Forward is exactly what the sibling clause watches for, so searching one out raises that
    // clause's "choose 1 Forward" straight after. This is the whole reason the search goes through
    // `putOntoField` rather than placing the card itself.
    const { r } = castHughYurg(1)
    const done = apply(r.state, { type: 'chooseFromDeck', player: 0, picks: [0] })
    expect(done.state.pending?.kind, "the watcher clause did not fire on the searched-out Forward").toBe('chooseTargets')
  })

  it('declining is a legal answer that changes nothing but the order of the deck', () => {
    const { r, before } = castHughYurg(1)
    const done = apply(r.state, { type: 'chooseFromDeck', player: 0, picks: [] })
    expect(done.state.pending).toBeNull()
    expect(done.state.players[0].deck.length).toBe(before.players[0].deck.length)
    expect(done.state.players[0].forwards.map((c) => c.id)).not.toContain(before.players[0].deck[0])
    for (const id of done.state.players[0].deck) expect(knows(done.state, 0, id)).toBe(false)
    ok(done.state)
  })

  it('can find a second copy of a name already on the field — a PINNED deviation, not an accident', () => {
    // MVP0-SIMPLIFICATION (§7.7.3/§12.4.6): casting a second non-generic same-name Character is illegal here,
    // but entry by ABILITY is not checked, so the search places it. The CR agrees the entry happens — §7.7.3
    // prohibits simultaneous deployment, and §12.4.6 then breaks ALL copies of that name — so the deviation is
    // the missing rule process, not the placement. This pins the current behaviour so the day §12.4.6 lands,
    // this test fails and says exactly what has to change.
    let s = makeGame()
    ;[s] = withCp(s, 0, Array<string>(4).fill(EARTH_BACKUP))
    let standing: CardId
    ;[s, standing] = withField(s, 0, 'forwards', PRINCESS)
    const p0 = s.players[0]
    s = setPlayer(s, 0, {
      ...p0,
      deck: p0.deck.filter((id) => !findable(s, id)),
      removedFromGame: [...p0.removedFromGame, ...p0.deck.filter((id) => findable(s, id))],
    })
    let found: CardId[]
    ;[s, found] = withDeckTops(s, 0, [PRINCESS])
    let hugh: CardId
    ;[s, hugh] = withHand(s, 0, '24-063H')
    const cmd = legalCommands(s, 0).find((c) => c.type === 'castCharacter' && c.card === hugh)
    const r = apply(s, cmd!)
    if (r.state.pending?.kind !== 'chooseFromDeck') throw new Error('the search did not offer the second copy')
    const done = apply(r.state, { type: 'chooseFromDeck', player: 0, picks: [0] })

    const names = done.state.players[0].forwards.map((c) => defOf(done.state, c.id).name)
    expect(names.filter((n) => n === defOf(done.state, standing).name)).toHaveLength(2)
    expect(done.state.players[0].forwards.map((c) => c.id)).toContain(found[0])
    ok(done.state)
  })

  it('with no legal target in the deck at all, raises no prompt and still shuffles', () => {
    // `take.min` is 0, so "nothing eligible" is settled as the empty pick rather than treated as a failure —
    // but the deck was still searched, so it must still be shuffled and forgotten.
    const { r, before } = castHughYurg(0)
    expect(before.players[0].deck.some((id) => findable(before, id)), 'the fixture left a findable card in').toBe(false)
    expect(r.state.pending, 'nothing to find must not leave a prompt standing').toBeNull()
    for (const id of r.state.players[0].deck) expect(knows(r.state, 0, id)).toBe(false)
    ok(r.state)
  })
})

// ---------------------------------------------------------------------------
// Rung C10 — 27-126S Sphene's [0] retrieve
// ---------------------------------------------------------------------------

describe('27-126S Sphene — "[0]: Choose 1 Forward other than Sphene put in your Break Zone from the field during this turn"', () => {
  const RETRIEVE = '27-126S:retrieve'
  const offered = (s: GameState, src: CardId) =>
    legalCommands(s, 0).filter((c) => c.type === 'activateAbility' && c.source === src && c.abilityId === RETRIEVE)

  /** Sphene on P0's field, plus whatever the case needs. */
  function withSphene(state: GameState = makeGame()): [GameState, CardId] {
    return withField(state, 0, 'forwards', '27-126S')
  }

  /**
   * Break `victim` (a Forward on P0's field) via the §12.4.4 zero-power rule process, IN PLACE.
   *
   * `runRuleProcesses` rather than `apply(pass)`: passing advances out of the Main Phase, and every activated
   * ability is Main-Phase-only (C3-11), so a fixture that broke the card by passing could never then activate
   * anything — it would test the phase restriction while claiming to test the retrieve.
   */
  function breakByRule(state: GameState, victim: CardId): GameState {
    const ps = state.players[0]
    const s = setPlayer(state, 0, { ...ps, forwards: ps.forwards.map((c) => (c.id === victim ? { ...c, powerBonus: -99_000 } : c)) })
    const [after] = runRuleProcesses(s)
    return after
  }

  it('C10-A1 retrieves a Forward broken from the field this turn, and leaves invariants clean', () => {
    let s = makeGame(); let sphene: CardId; let victim: CardId
    ;[s, sphene] = withSphene(s)
    ;[s, victim] = withField(s, 0, 'forwards', '27-124S')
    s = breakByRule(s, victim)
    expect(s.players[0].breakZone, 'the fixture did not actually break it').toContain(victim)
    expect(s.players[0].putIntoBreakZoneFromFieldThisTurn).toContain(victim)

    const cmds = offered(s, sphene)
    expect(cmds.length, 'the retrieve was not offered').toBeGreaterThan(0)
    const pick = cmds.find((c) => c.type === 'activateAbility' && c.targets.includes(victim))
    expect(pick).toBeDefined()

    const done = apply(s, pick!)
    expect(done.state.players[0].hand).toContain(victim)
    expect(done.state.players[0].breakZone).not.toContain(victim)
    // The blocker the plan review found: leaving the Break Zone must FORGET the arrival, or this very move
    // breaks the invariant it just satisfied.
    expect(done.state.players[0].putIntoBreakZoneFromFieldThisTurn).not.toContain(victim)
    ok(done.state)
  })

  it('C10-A2 offers nothing it should not — hand discards, Sphene itself, Backups, previous turns', () => {
    let s = makeGame(); let sphene: CardId
    ;[s, sphene] = withSphene(s)
    // A Forward that reached the Break Zone from the HAND, not the field.
    let discarded: CardId
    ;[s, discarded] = withBreakZone(s, 0, '27-124S')
    // A Backup broken from the field this turn — a real arrival, but the wrong TYPE.
    let backup: CardId
    ;[s, backup] = withField(s, 0, 'backups', '18-064C')
    const ps = s.players[0]
    s = setPlayer(s, 0, {
      ...ps,
      backups: ps.backups.filter((c) => c.id !== backup),
      breakZone: [...ps.breakZone, backup],
      putIntoBreakZoneFromFieldThisTurn: [...ps.putIntoBreakZoneFromFieldThisTurn, backup],
    })
    // A second Sphene in the Break Zone, broken this turn — excluded by NAME.
    let otherSphene: CardId
    ;[s, otherSphene] = withBreakZone(s, 0, '27-126S')
    const q = s.players[0]
    s = setPlayer(s, 0, { ...q, putIntoBreakZoneFromFieldThisTurn: [...q.putIntoBreakZoneFromFieldThisTurn, otherSphene] })

    const targets = offered(s, sphene).flatMap((c) => (c.type === 'activateAbility' ? [...c.targets] : []))
    expect(targets, 'a card discarded from HAND is not "from the field"').not.toContain(discarded)
    expect(targets, 'a Backup is not "1 Forward"').not.toContain(backup)
    expect(targets, '"other than Sphene" excludes the NAME').not.toContain(otherSphene)
  })

  it('C10-A3 counts all three field→Break Zone producers, not just the one the first test used', () => {
    // The plan review named this exactly: recording the rule process and the self-cost but missing
    // `breakCard` passes a suite whose only case breaks by lethal damage.
    for (const how of ['rule process', 'ability break', 'self cost'] as const) {
      let s = makeGame(); let sphene: CardId
      ;[s, sphene] = withSphene(s)
      let victim: CardId

      if (how === 'rule process') {
        ;[s, victim] = withField(s, 0, 'forwards', '27-124S')
        s = breakByRule(s, victim)
      } else if (how === 'ability break') {
        // Luso's "when it damages the opponent" breaks a Forward; simpler here: put a Forward on the field
        // and break it through the ability path by giving Sphene's controller a cost-1 Forward and using
        // Undead Princess's self-break, which is the `selfToBreakZone` COST path — covered below. For the
        // ability path use `27-127S` Lightning's ETB, which breaks a Forward outright.
        ;[s, victim] = withField(s, 1, 'forwards', '27-124S')
        let caster: CardId
        ;[s, caster] = withHand(s, 0, '27-127S')
        ;[s] = withCp(s, 0, Array<string>(defOf(s, caster).cost).fill(LIGHTNING_BACKUP))
        const cast = legalCommands(s, 0).find((c) => c.type === 'castCharacter' && c.card === caster)
        expect(cast, 'the ability-break fixture could not cast').toBeDefined()
        let r = apply(s, cast!)
        // Lightning's ETB CHOOSES what to break, so the break has not happened yet — answering the prompt is
        // what exercises `breakCard`. Asserting before this passed for the wrong reason and proved nothing.
        expect(r.state.pending?.kind, 'the ETB did not raise its choice').toBe('chooseTargets')
        const answer = legalCommands(r.state, 0).find((c) => c.type === 'chooseTargets' && c.targets.includes(victim))
        expect(answer, 'the opponent Forward was not a legal break target').toBeDefined()
        r = apply(r.state, answer!)
        // The broken card is the OPPONENT's, so it lands in THEIR Break Zone — assert the recording there.
        expect(r.state.players[1].breakZone, 'the ability break did not happen').toContain(victim)
        expect(r.state.players[1].putIntoBreakZoneFromFieldThisTurn, 'an ability break was not recorded').toContain(victim)
        continue
      } else {
        ;[s, victim] = withField(s, 0, 'forwards', '19-052C')
        let pumpTarget: CardId
        ;[s, pumpTarget] = withField(s, 0, 'forwards', '27-124S')
        const use = legalCommands(s, 0).find((c) => c.type === 'activateAbility' && c.source === victim && c.abilityId === '19-052C:pump')
        expect(use, 'the self-cost fixture could not activate').toBeDefined()
        s = apply(s, use!).state
        void pumpTarget
      }

      expect(s.players[0].putIntoBreakZoneFromFieldThisTurn, `${how} was not recorded`).toContain(victim)
      const targets = offered(s, sphene).flatMap((c) => (c.type === 'activateAbility' ? [...c.targets] : []))
      expect(targets, `${how} did not make the card retrievable`).toContain(victim)
    }
  })

  it('C10-A4 is once per turn, per INSTANCE, and refreshes on a new turn', () => {
    let s = makeGame(); let sphene: CardId; let a: CardId; let b: CardId
    ;[s, sphene] = withSphene(s)
    ;[s, a] = withField(s, 0, 'forwards', '27-124S')
    ;[s, b] = withField(s, 0, 'forwards', '18-124C')
    s = breakByRule(s, a)
    s = breakByRule(s, b)

    const first = offered(s, sphene).find((c) => c.type === 'activateAbility' && c.targets.includes(a))
    expect(first).toBeDefined()
    const after = apply(s, first!).state
    expect(findFieldCard(after, sphene)?.card.usedThisTurn).toContain(RETRIEVE)
    // `b` is still there and still eligible — so an empty offer here is the LIMIT, not a lack of targets.
    expect(after.players[0].putIntoBreakZoneFromFieldThisTurn).toContain(b)
    expect(offered(after, sphene), 'the ability was usable twice in one turn').toHaveLength(0)
    ok(after)
  })

  it('C10-A4 (cont.) a Sphene that left the field and returned has a fresh allowance', () => {
    // CR §7.4: a card entering a zone is a NEW object, so the allowance is not a property of the name.
    let s = makeGame(); let sphene: CardId; let victim: CardId
    ;[s, sphene] = withSphene(s)
    ;[s, victim] = withField(s, 0, 'forwards', '27-124S')
    s = breakByRule(s, victim)
    const use = offered(s, sphene).find((c) => c.type === 'activateAbility' && c.targets.includes(victim))
    s = apply(s, use!).state
    expect(offered(s, sphene)).toHaveLength(0)

    // Same instance id, but a genuinely fresh FieldCard — what `putOntoField` builds.
    const ps = s.players[0]
    s = setPlayer(s, 0, { ...ps, forwards: ps.forwards.map((c) => (c.id === sphene ? { ...c, usedThisTurn: [] } : c)) })
    let again: CardId
    ;[s, again] = withField(s, 0, 'forwards', '18-124C')
    s = breakByRule(s, again)
    expect(offered(s, sphene).length, 'a fresh instance did not get a fresh allowance').toBeGreaterThan(0)
  })

  it('C10-A4 (cont.) the limit is per INSTANCE — a second Sphene has its own allowance', () => {
    // The plan review named this as an implementation that passes everything else: a player-global flag
    // limits the ability once per PLAYER per turn, which is not what "this ability" means.
    //
    // The board below is not reachable by legal play — §7.7.3 forbids deploying a second non-generic
    // same-name Character, and no card in this pool both has a `oncePerTurn` ability and is generic. The
    // MECHANISM is still what is under test, and building the state directly is the only way to see it.
    let s = makeGame(); let one: CardId; let two: CardId; let victim: CardId
    ;[s, one] = withField(s, 0, 'forwards', '27-126S')
    ;[s, two] = withField(s, 0, 'forwards', '27-126S')
    ;[s, victim] = withField(s, 0, 'forwards', '27-124S')
    s = breakByRule(s, victim)

    const use = offered(s, one).find((c) => c.type === 'activateAbility' && c.targets.includes(victim))
    expect(use).toBeDefined()
    const after = apply(s, use!).state
    expect(findFieldCard(after, one)?.card.usedThisTurn).toContain(RETRIEVE)
    expect(findFieldCard(after, two)?.card.usedThisTurn, "the other instance was charged for a use it did not make").toEqual([])

    // The retrieve consumed the only eligible card, so put another one there to prove the SECOND Sphene is
    // still allowed — otherwise an empty offer would mean "no targets", not "no allowance".
    let more: CardId
    ;[s, more] = withField(after, 0, 'forwards', '18-124C')
    const restocked = breakByRule(s, more)
    expect(offered(restocked, one), 'the used instance is still limited').toHaveLength(0)
    expect(offered(restocked, two).length, 'a second instance was wrongly limited by the first').toBeGreaterThan(0)
  })

  it('C10-A5 is illegal on the opponent\'s turn, and (MVP0) outside a Main Phase', () => {
    let s = makeGame(); let sphene: CardId; let victim: CardId
    ;[s, sphene] = withSphene(s)
    ;[s, victim] = withField(s, 0, 'forwards', '27-124S')
    s = breakByRule(s, victim)
    expect(offered(s, sphene).length).toBeGreaterThan(0)

    // Sphene's own printed restriction: "during your turn".
    const theirTurn = { ...s, turnPlayer: 1 as PlayerId, priority: 1 as PlayerId }
    expect(legalCommands(theirTurn, 0).filter((c) => c.type === 'activateAbility')).toHaveLength(0)

    // And the engine's own MVP0-SIMPLIFICATION (C3-11), which is NOT Sphene's text: Main Phase only.
    const attacking = { ...s, phase: 'attack' as const }
    expect(legalCommands(attacking, 0).filter((c) => c.type === 'activateAbility' && c.abilityId === RETRIEVE)).toHaveLength(0)
  })

  it('C10-A6 is not offered at all when nothing is retrievable — no dead prompt', () => {
    let s = makeGame(); let sphene: CardId
    ;[s, sphene] = withSphene(s)
    ;[s] = withBreakZone(s, 0, '27-124S')   // in the Break Zone, but not from the field this turn
    expect(offered(s, sphene)).toHaveLength(0)
  })

  it('C10-A7 a card retrieved and re-discarded the same turn is not retrievable again', () => {
    // CR §7.4 again: the card that comes back is a new object in the Break Zone, not the one Sphene took.
    let s = makeGame(); let sphene: CardId; let victim: CardId
    ;[s, sphene] = withSphene(s)
    ;[s, victim] = withField(s, 0, 'forwards', '27-124S')
    s = breakByRule(s, victim)
    const use = offered(s, sphene).find((c) => c.type === 'activateAbility' && c.targets.includes(victim))
    s = apply(s, use!).state
    expect(s.players[0].hand).toContain(victim)

    // Back to the Break Zone by a discard, in the same turn.
    const ps = s.players[0]
    s = setPlayer(s, 0, { ...ps, hand: ps.hand.filter((id) => id !== victim), breakZone: [...ps.breakZone, victim] })
    ok(s)
    expect(s.players[0].putIntoBreakZoneFromFieldThisTurn, 'the arrival was not forgotten on the way out').not.toContain(victim)
  })
})

describe('nothing in the engine writes to the card database (spec D4-A3)', () => {
  /**
   * `determinise` stopped deep-cloning `defs` because the card database is immutable reference data —
   * cloning it was 12 % of all search CPU for a value that never changes. That holds only while nothing
   * writes to it, and a comment saying so is not a guard. This freezes the REAL defs, RECURSIVELY, and then
   * plays a game: any write throws at its source, because ES modules are strict.
   *
   * It lives here rather than beside `determinise` because the engine's own tests cannot see this package,
   * and a pool with NO abilities never reaches the code that reads a def. An earlier version of this test
   * sat in `determinise.test.ts` over `VANILLA_POOL`, and a deliberate write into a `CardDef` sailed
   * straight through it — `matchesDefFilter` was never called at all.
   */
  function deepFreeze(v: unknown): void {
    if (v === null || typeof v !== 'object' || Object.isFrozen(v)) return
    Object.freeze(v)
    for (const k of Object.keys(v as object)) deepFreeze((v as Record<string, unknown>)[k])
  }

  it('plays a whole game over deeply frozen defs without a single write', () => {
    const frozen = loadCards()
    frozen.forEach(deepFreeze)
    let s = createGame({ seed: 3, decks: [DECK, DECK], defs: frozen })
    deepFreeze(s.defs)

    const chooser = s.pending?.kind === 'chooseFirst' ? s.pending.player : 0
    ;[s] = applyChooseFirst(s, chooser, chooser === 0)
    ;[s] = applyMulligan(s, 0, false)
    ;[s] = applyMulligan(s, 1, false)

    let casts = 0
    let abilityPrompts = 0
    for (let step = 0; step < 400 && !s.result; step++) {
      const p = actingPlayer(s)
      if (p === null) break
      const legal = legalCommands(s, p).filter((c) => c.type !== 'concede')
      if (!legal.length) break
      // Prefer a cast, so ability text actually resolves rather than both sides passing to a quiet end.
      const cmd = legal.find((c) => c.type === 'castCharacter' || c.type === 'castSummon') ?? legal[0]
      if (!cmd) break
      if (cmd.type === 'castCharacter' || cmd.type === 'castSummon') casts++
      s = apply(s, cmd).state
      if (s.pending && s.pending.kind !== 'chooseFirst' && s.pending.kind !== 'mulligan') abilityPrompts++
    }
    // The guard is worthless if the game never exercised an ability.
    expect(casts, 'no card was ever cast, so no ability code ran').toBeGreaterThan(3)
    expect(abilityPrompts, 'no ability ever raised a choice').toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Rung C11 — 22-068R Prishe's "when chosen"
// ---------------------------------------------------------------------------

describe('22-068R Prishe — "When Prishe is chosen by a Summon or an ability, Prishe gains +2000 power"', () => {
  const RAMUH = '20-103H'   // modal Summon: its modes include damage and a separate target choice

  /** Prishe on `owner`'s field, plus enough CP for `caster` to cast `code`. */
  function board(code: string, cp: string[], prisheOwner: PlayerId = 0, caster: PlayerId = 0) {
    let s = makeGame()
    let prishe: CardId
    ;[s, prishe] = withField(s, prisheOwner, 'forwards', '22-068R')
    ;[s] = withCp(s, caster, cp)
    let card: CardId
    ;[s, card] = withHand(s, caster, code)
    return { s, prishe, card }
  }

  it('C11-A1 a 5000 Prishe chosen by a 5000-damage Summon SURVIVES — the ordering IS the card', () => {
    // Ramuh's second mode is exactly "Choose 1 Forward. Deal it 5000 damage." Prishe is 5000: she dies if
    // the damage lands first and lives at 7000 if the pump does. The assertion is SURVIVAL.
    //
    // Every step is asserted rather than skipped. An earlier version of this test bailed out with `return`
    // when a step was not reached, which would have passed without ever choosing Prishe at all.
    const { s: start, prishe, card } = board(RAMUH, Array<string>(2).fill(LIGHTNING_BACKUP), 1, 0)
    const cast = legalCommands(start, 0).find((c) => c.type === 'castSummon' && c.card === card)
    expect(cast, 'Ramuh was not castable').toBeDefined()
    const summoned = apply(start, cast!)
    expect(summoned.state.pending?.kind, 'Ramuh did not raise its mode choice').toBe('chooseMode')

    // Mode index 1 is the damage mode; take only that one.
    const modes = apply(summoned.state, { type: 'chooseMode', player: 0, modes: [1] })
    expect(modes.state.pending?.kind, 'the damage mode did not raise a target choice').toBe('chooseTargets')

    const pick = legalCommands(modes.state, 0).find((c) => c.type === 'chooseTargets' && c.targets.includes(prishe))
    expect(pick, 'Prishe was not a legal target for the damage mode').toBeDefined()
    const done = apply(modes.state, pick!)

    // `toBeDefined()` would NOT do here: `findFieldCard` returns null when the card is gone, and null is
    // "defined" — the assertion would pass on a broken Prishe and fail later with an unreadable TypeError.
    const alive = findFieldCard(done.state, prishe)
    expect(alive, 'Prishe was broken — the +2000 did not land before the 5000 damage').not.toBeNull()
    expect(done.state.players[1].breakZone).not.toContain(prishe)
    expect(powerOfId(done.state, prishe)).toBe(7000)
    expect(alive?.card.damage).toBe(5000)
    ok(done.state)
  })

  it('C11-A2 fires on an answered PROMPT, including for the OPPONENT\'s ability', () => {
    // Noel's ETB chooses up to 2 Forwards the opponent controls. P0 casts it; Prishe is P1's. The pump is
    // the CHOSEN card's, not the chooser's — a helper scanning only the acting player's field would miss it.
    const { s, prishe, card } = board('16-092C', Array<string>(5).fill(LIGHTNING_BACKUP), 1, 0)
    const cast = legalCommands(s, 0).find((c) => c.type === 'castCharacter' && c.card === card)
    expect(cast, 'Noel was not castable').toBeDefined()
    const r = apply(s, cast!)
    expect(r.state.pending?.kind).toBe('chooseTargets')
    const pick = legalCommands(r.state, 0).find((c) => c.type === 'chooseTargets' && c.targets.includes(prishe))
    expect(pick, 'the opponent Prishe was not a legal target').toBeDefined()

    const before = powerOfId(r.state, prishe)
    const done = apply(r.state, pick!)
    expect(powerOfId(done.state, prishe), "an opponent's ability choosing Prishe still pumps her").toBe(before + 2000)
    expect(done.events.some((e) => e.type === 'abilityTriggered' && e.abilityId === '22-068R:chosen')).toBe(true)
    ok(done.state)
  })

  it('C11-A4 pumps ONCE for a choice that took Prishe and a bystander', () => {
    // Noel takes "up to 2". A wrong implementation multiplying by `targets.length` gives +4000.
    let s = makeGame()
    let prishe: CardId; let bystander: CardId; let noel: CardId
    ;[s, prishe] = withField(s, 1, 'forwards', '22-068R')
    ;[s, bystander] = withField(s, 1, 'forwards', '27-124S')
    ;[s] = withCp(s, 0, Array<string>(5).fill(LIGHTNING_BACKUP))
    ;[s, noel] = withHand(s, 0, '16-092C')
    const cast = legalCommands(s, 0).find((c) => c.type === 'castCharacter' && c.card === noel)
    const r = apply(s, cast!)
    const both = legalCommands(r.state, 0).find((c) =>
      c.type === 'chooseTargets' && c.targets.includes(prishe) && c.targets.includes(bystander))
    expect(both, 'no choice took both Forwards').toBeDefined()

    const before = powerOfId(r.state, prishe)
    const done = apply(r.state, both!)
    expect(powerOfId(done.state, prishe), 'the pump was multiplied by the number of targets').toBe(before + 2000)
  })

  it('C11-A3 (cont.) does NOT fire when a choice took a DIFFERENT Forward', () => {
    // The review's sharpest test gap: with only the `forEach` negative landed, a helper that ignored its
    // `chosen` argument entirely — pumping every Prishe on the board whenever ANY choice happened — passed
    // all 680 tests. This is the case that distinguishes "the card that was chosen" from "a card".
    let s = makeGame()
    let prishe: CardId; let other: CardId; let mage: CardId
    ;[s, prishe] = withField(s, 0, 'forwards', '22-068R')
    ;[s, other] = withField(s, 0, 'forwards', '27-124S')
    ;[s, mage] = withField(s, 0, 'backups', '1-121C')
    ;[s] = withCp(s, 0, [LIGHTNING_BACKUP])

    const use = legalCommands(s, 0).find((c) =>
      c.type === 'activateAbility' && c.source === mage && c.targets.includes(other) && !c.targets.includes(prishe))
    expect(use, 'no activation chose the OTHER Forward alone').toBeDefined()
    const done = apply(s, use!)
    expect(powerOfId(done.state, prishe), 'Prishe was pumped by a choice that did not take her').toBe(5000)
    expect(done.events.some((e) => e.type === 'abilityTriggered' && e.abilityId === '22-068R:chosen')).toBe(false)
  })

  it("C11-A2 (cont.) fires cross-table on the DECLARED-targets route too", () => {
    // The other half of C11-A2, which the first pass did not land: an activated ability whose declared
    // targets name a Prishe the ACTIVATING player does not own. Red Mage's Haste is `controller: 'any'`, so
    // this is reachable. A call-site filter keeping only the actor's own targets survives every other test.
    let s = makeGame()
    let prishe: CardId; let mage: CardId
    ;[s, prishe] = withField(s, 1, 'forwards', '22-068R')   // the OPPONENT's Prishe
    ;[s, mage] = withField(s, 0, 'backups', '1-121C')
    ;[s] = withCp(s, 0, [LIGHTNING_BACKUP])

    const use = legalCommands(s, 0).find((c) =>
      c.type === 'activateAbility' && c.source === mage && c.targets.includes(prishe))
    expect(use, "the opponent's Prishe was not a legal Haste target").toBeDefined()
    const done = apply(s, use!)
    expect(powerOfId(done.state, prishe), 'a declared target the actor does not own was skipped').toBe(7000)
    // The pump belongs to the CHOSEN card's owner, not the chooser's.
    expect(done.events).toContainEqual({ type: 'abilityTriggered', player: 1, card: prishe, abilityId: '22-068R:chosen' })
  })

  it('C11-A3 does NOT fire when nobody chose her', () => {
    // Cloud's ETB is an untargeted `forEach` over "all the Forwards you control" — it pumps Prishe, but it
    // never CHOOSES her, so the when-chosen clause must not add its own +2000 on top.
    let s = makeGame()
    let prishe: CardId; let cloud: CardId
    ;[s, prishe] = withField(s, 0, 'forwards', '22-068R')
    ;[s] = withCp(s, 0, Array<string>(3).fill(EARTH_BACKUP))
    ;[s, cloud] = withHand(s, 0, '27-124S')
    const cast = legalCommands(s, 0).find((c) => c.type === 'castCharacter' && c.card === cloud)
    expect(cast, 'Cloud was not castable').toBeDefined()
    const done = apply(s, cast!)
    // Cloud gives +3000 to each Forward its controller has. Exactly that, with no when-chosen pump.
    expect(powerOfId(done.state, prishe)).toBe(5000 + 3000)
    expect(done.events.some((e) => e.type === 'abilityTriggered' && e.abilityId === '22-068R:chosen')).toBe(false)
  })

  it('C11-A4 (cont.) stacks across separate choosings, and expires at end of turn', () => {
    let s = makeGame()
    let prishe: CardId
    ;[s, prishe] = withField(s, 0, 'forwards', '22-068R')
    // Two separate Red Mage activations, each choosing Prishe: +2000 then +4000.
    for (let i = 0; i < 2; i++) {
      let mage: CardId
      ;[s, mage] = withField(s, 0, 'backups', '1-121C')
      ;[s] = withCp(s, 0, [LIGHTNING_BACKUP])
      const use = legalCommands(s, 0).find((c) =>
        c.type === 'activateAbility' && c.source === mage && c.targets.includes(prishe))
      expect(use, `activation ${i + 1} was not offered`).toBeDefined()
      s = apply(s, use!).state
      expect(powerOfId(s, prishe)).toBe(5000 + 2000 * (i + 1))
    }
    const [ended] = finishEndPhase(s)
    expect(powerOfId(ended, prishe), 'the pump outlived the turn').toBe(5000)
  })

  it('C11-A4 pumps TWICE when ONE frame chooses her in two modal nodes', () => {
    // The same-frame half of the cardinality criterion, which the first pass substituted two separate
    // activations for — two FRAMES, which a per-frame dedupe would also pass. Ramuh selects up to 2 of its
    // 3 modes and each mode raises its OWN target choice, so choosing Prishe twice inside one frame is
    // reachable, and an implementation deduplicating per frame pumps her once.
    let s = makeGame()
    let prishe: CardId; let ramuh: CardId
    ;[s, prishe] = withField(s, 0, 'forwards', '22-068R')
    ;[s] = withCp(s, 0, Array<string>(2).fill(LIGHTNING_BACKUP))
    ;[s, ramuh] = withHand(s, 0, '20-103H')
    const cast = legalCommands(s, 0).find((c) => c.type === 'castSummon' && c.card === ramuh)
    expect(cast, 'Ramuh was not castable').toBeDefined()
    let r = apply(s, cast!)
    expect(r.state.pending?.kind).toBe('chooseMode')

    // Modes 0 (dull) and 2 (Haste) both choose a Forward and neither damages her, so two choices land on
    // the same Prishe inside one frame.
    r = apply(r.state, { type: 'chooseMode', player: 0, modes: [0, 2] })
    let choices = 0
    while (r.state.pending?.kind === 'chooseTargets') {
      const pick = legalCommands(r.state, 0).find((c) => c.type === 'chooseTargets' && c.targets.includes(prishe))
      expect(pick, `target choice ${choices + 1} could not take Prishe`).toBeDefined()
      r = apply(r.state, pick!)
      choices++
    }
    expect(choices, 'the fixture did not produce TWO target choices in one frame').toBe(2)
    expect(powerOfId(r.state, prishe), 'two choices in one frame pumped her only once').toBe(5000 + 4000)
  })

  it('C11-A3 (cont.) an `onSubject` binding is NOT a choice — Prishe pumps once, not twice', () => {
    // Luso's c2 mode 1 CHOOSES a Forward and deals it 3000; that damage fires his c1, whose `onSubject`
    // binds the SAME card ("break it") — a card the printed text names, which nobody chose. So Prishe must
    // pump exactly once, from the choice. Hooking chosen-dispatch into the `onSubject` binding would pump
    // her twice, and every other test here would stay green.
    let s = makeGame()
    let luso: CardId; let prishe: CardId
    ;[s, luso] = withField(s, 0, 'forwards', '27-125S')     // earth 3000
    ;[s, prishe] = withField(s, 1, 'forwards', '22-068R')   // 5000, so 3000 is not lethal even unpumped
    const hit = attackUnblocked(s, [luso])
    let t = apply(hit.state, { type: 'chooseMode', player: 0, modes: [0] })

    const pick = legalCommands(t.state, 0).find((c) => c.type === 'chooseTargets' && c.targets.includes(prishe))
    expect(pick, 'Luso could not choose Prishe').toBeDefined()
    t = apply(t.state, pick!)

    // She IS broken — c1's "break it" is unconditional, not damage-based — and that is what proves the
    // `onSubject` path actually ran. What it must not have done is count as a second choosing.
    expect(t.state.players[1].breakZone, 'the onSubject break never happened, so this proves nothing').toContain(prishe)
    const pumps = t.events.filter((e) => e.type === 'abilityTriggered' && e.abilityId === '22-068R:chosen')
    expect(pumps, 'the onSubject binding was treated as a second choosing').toHaveLength(1)
    const bumps = t.events.filter((e) => e.type === 'powerModified' && e.card === prishe)
    expect(bumps).toHaveLength(1)
    ok(t.state)
  })

  it('C11-A5 emits the trigger BEFORE the power change, in the real event stream', () => {
    // The narrator test hands `eventLines` the two events already in order, so it cannot see the engine
    // emitting them the other way round. This reads the order off a real `apply`.
    const { s, prishe, card } = board('16-092C', Array<string>(5).fill(LIGHTNING_BACKUP), 1, 0)
    const cast = legalCommands(s, 0).find((c) => c.type === 'castCharacter' && c.card === card)
    const r = apply(s, cast!)
    const pick = legalCommands(r.state, 0).find((c) => c.type === 'chooseTargets' && c.targets.includes(prishe))
    const done = apply(r.state, pick!)
    const trigger = done.events.findIndex((e) => e.type === 'abilityTriggered' && e.abilityId === '22-068R:chosen')
    const power = done.events.findIndex((e) => e.type === 'powerModified' && e.card === prishe)
    expect(trigger, 'no trigger event').toBeGreaterThanOrEqual(0)
    expect(power, 'no power event').toBeGreaterThanOrEqual(0)
    expect(trigger, 'the power change was announced before the clause that caused it').toBeLessThan(power)
  })

  it('C11-A6 does not mutate the state it was handed', () => {
    // An in-place `powerBonus += 2000` passes every test above while corrupting sibling search branches,
    // because `searchView` shares structure with the live state and `apply` is relied on to be immutable.
    const { s, prishe, card } = board('16-092C', Array<string>(5).fill(LIGHTNING_BACKUP), 1, 0)
    const cast = legalCommands(s, 0).find((c) => c.type === 'castCharacter' && c.card === card)
    const r = apply(s, cast!)
    const pick = legalCommands(r.state, 0).find((c) => c.type === 'chooseTargets' && c.targets.includes(prishe))
    const snapshot = JSON.stringify(r.state)
    apply(r.state, pick!)
    expect(JSON.stringify(r.state), 'applyChooseTargets mutated its input state').toBe(snapshot)
  })
})

describe('the button text for an activated clause (found by playing)', () => {
  /**
   * Hand-written from the printed text of every activated clause in the pool, and checked against the cards
   * by eye — NOT recorded from what `describeAbilityEffect` happens to emit.
   *
   * This table is the oracle, and it exists because the first version of these tests derived its expectation
   * with the same `indexOf(': ')` and sentence split the production function uses, then asserted only the
   * FIRST sentence. That is the production parser compared with itself: Codex mutated the function to return
   * `kept[0]` and every sweep stayed green while real labels silently lost "It gains Haste until the end of
   * the turn" and "Add it to your hand".
   */
  const EXPECTED: Record<string, string> = {
    '1-121C:haste': 'Choose 1 Forward. It gains Haste until the end of the turn',
    '16-092C:dull-all': 'Dull all the Forwards opponent controls',
    '18-064C:draw': 'Draw 1 card',
    '18-069C:draw': 'Draw 1 card',
    '19-052C:pump': 'Choose 1 Forward. It gains +4000 power until the end of the turn',
    '19-052C:remove': 'Choose 1 Earth Forward. It gains +2000 power until the end of the turn',
    '20-074C:draw': 'Draw 1 card',
    // Sphene keeps its once-per-turn marker: that is not a timing condition the engine gates for you, it is
    // what pressing the button COSTS you for the rest of the turn (Codex MAJOR).
    '27-126S:retrieve': 'Choose 1 Forward other than Sphene put in your Break Zone from the field during this turn. Add it to your hand (once per turn)',
  }

  const activated = loadCards().flatMap((d) => (d.abilities ?? []).filter((a) => a.trigger.kind === 'activated'))

  it('every activated clause in the pool is covered by the table', () => {
    expect(activated.length, 'the pool has no activated clauses').toBeGreaterThan(0)
    expect(activated.map((a) => a.id).sort()).toEqual(Object.keys(EXPECTED).sort())
  })

  it('reads the whole effect, and only the effect', () => {
    for (const ability of activated) {
      expect(describeAbilityEffect(ability), ability.id).toBe(EXPECTED[ability.id])
    }
  })

  it('drops the timing conditions the engine already enforces, and nothing else', () => {
    // Stated separately from the table so the intent survives a table edit: a legality condition cannot change
    // the decision, because the command is not offered when it fails.
    for (const ability of activated) {
      const out = describeAbilityEffect(ability) ?? ''
      expect(out, ability.id).not.toContain('You can only use this ability')
      expect(out, ability.id).not.toContain('in your hand.')
      // ...but every OTHER sentence of the printed effect survives whole.
      const printed = ability.text.slice(ability.text.indexOf(': ') + 2)
      for (const sentence of printed.split(/(?<=\.)\s+/)) {
        if (sentence.startsWith('You can only use this ability')) continue
        expect(out, `${ability.id}: lost "${sentence}"`).toContain(sentence.replace(/\.$/, ''))
      }
    }
  })
})

describe('clauses left unimplemented ON PURPOSE (found by playing)', () => {
  /**
   * Sphene prints a static that protects your Break Zone from an opponent removing cards from the game. The
   * pool cannot do that to anyone, so the clause is unreachable — but the log warned "Sphene has 1 more
   * ability clause that is not implemented yet" in every game Sphene was cast, which tells the player
   * something was lost when nothing was. A warning that cries wolf is worse than no warning, because the EX
   * Burst ones are real.
   *
   * Suppressing it is a claim about the whole POOL, so these tests are the proof obligation, not the comment.
   */

  /**
   * The codes this file actually PROVES inert, one test each. `INERT_CLAUSES` may not contain anything else:
   * a reason string is prose, and prose cannot be checked (Codex MAJOR — a future entry could hide a real
   * gap behind a long, false explanation). Adding an entry without adding its proof fails here.
   */
  const PROVEN = ['27-126S']

  it('nothing is declared inert without a proof in this file', () => {
    expect(Object.keys(INERT_CLAUSES).sort(), 'an inert entry has no proof test — add one, or drop the entry').toEqual([...PROVEN].sort())
  })

  it('every inert entry names a real card, a real gap, and a reason', () => {
    const defs = new Map(loadCards().map((d) => [d.code, d]))
    expect(Object.keys(INERT_CLAUSES).length, 'nothing is declared inert, so this proves nothing').toBeGreaterThan(0)
    for (const [code, entry] of Object.entries(INERT_CLAUSES) as [string, { count: number; why: string }][]) {
      const def = defs.get(code)
      expect(def, `${code} is not in the pool`).toBeDefined()
      expect(entry.why.length, `${code} suppresses a warning without saying why`).toBeGreaterThan(20)
      const printed = def!.abilityClauses ?? (def!.hasAbilities ? 1 : 0)
      const implemented = def!.abilities?.length ?? 0
      // Cannot declare more clauses inert than are actually missing — that would suppress a real gap.
      expect(printed - implemented, `${code} declares ${entry.count} inert but only ${printed - implemented} are unimplemented`)
        .toBeGreaterThanOrEqual(entry.count)
    }
  })

  it("PROOF for Sphene: only a card's OWN activation cost can remove anything from the game", () => {
    // The claim is about REACHABILITY, so the guard watches the transition, not the vocabulary. An earlier
    // version of this walked ability ASTs rejecting effect kinds matching /remove/i, and Codex broke it in
    // one line: `{ kind: 'moveCard', to: 'removedFromGame' }` is a removal that never says "remove". A
    // `banish` effect, a generic `moveToZone`, a rule process or an EX Burst writing the zone directly would
    // all have passed too — so the guarantee the comment claimed was simply false.
    //
    // There is exactly one way into that zone, so that is what is pinned: the engine appends to
    // `removedFromGame` in ONE file, and it appends the activating card itself, paying its own cost out of
    // its own Break Zone. Neither an opponent's doing, nor anything Sphene's clause would stop.
    const dir = new URL('../../engine/src/', import.meta.url)
    const APPEND = /removedFromGame:\s*\[\s*\.\.\./          // an append, not `[]` construction or a copy
    const writers = readdirSync(dir).filter((f) => f.endsWith('.ts'))
      .filter((f) => APPEND.test(readFileSync(new URL(f, dir), 'utf8')))
    expect(writers.length, 'no file appends to removedFromGame at all — the pattern has drifted').toBeGreaterThan(0)
    expect(writers, "a new path removes cards from the game — revisit INERT_CLAUSES['27-126S']").toEqual(['activate.ts'])

    const activate = readFileSync(new URL('activate.ts', dir), 'utf8')
    const line = activate.split('\n').find((l) => APPEND.test(l))!
    expect(line, 'the removal no longer appends the activating card itself').toContain('source')
    expect(activate, 'the removal is no longer gated on the self-cost').toContain('selfRemoveFromGame')

    // And the secondary check the AST walk was always good for: the costs that DO remove are self-costs paid
    // from the card's own Break Zone.
    for (const clauses of Object.values(ABILITIES)) {
      for (const a of clauses) {
        if (a.trigger.kind !== 'activated' || a.trigger.cost.selfRemoveFromGame !== true) continue
        expect(a.trigger.sourceZone, `${a.id} removes itself from somewhere other than its own Break Zone`).toBe('breakZone')
      }
    }
  })

  it('Sphene no longer warns, and a card with a REAL gap still does', () => {
    const defs = loadCards()
    const sphene = defs.find((d) => d.code === '27-126S')!
    const events: Event[] = []
    warnUnimplemented(sphene, 1 as CardId, events)
    expect(events, 'Sphene still warns about a clause that cannot do anything').toEqual([])

    // The suppression must be surgical: the same card with the inert marker removed warns again, and so does
    // any card that really is short a clause.
    const unmarked: CardDef = { ...sphene, inertClauses: 0 }
    const stillWarns: Event[] = []
    warnUnimplemented(unmarked, 1 as CardId, stillWarns)
    expect(stillWarns, 'the suppression is not doing the work — Sphene was silent for some other reason').toHaveLength(1)

    const genuinelyShort: CardDef = { ...sphene, abilityClauses: 5, inertClauses: 1 }
    const short: Event[] = []
    warnUnimplemented(genuinelyShort, 1 as CardId, short)
    expect(short).toHaveLength(1)
    expect(short[0]?.type === 'unimplementedAbility' && short[0].clauses, 'the inert clause was not subtracted from a real gap').toBe(3)
  })
})
