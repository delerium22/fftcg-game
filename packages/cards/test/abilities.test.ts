import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { CardDef, CardId, FieldCard, GameState, PlayerId } from '@fftcg/engine'
import { apply, applyChooseFirst, applyMulligan, castRequirement, checkInvariants, createGame, defOf, findFieldCard, legalCommands, powerOf } from '@fftcg/engine'
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

  it('loadCards merges the nineteen implemented clauses on, and only those nineteen', () => {
    // Five from C1, five from C2, six from C3's activated abilities, two from C4 (both of Odin's), one from
    // C5 (Cloud's Attack-Phase clause). Any clause added without a test lands here first.
    const implemented = DEFS.filter((d) => (d.abilities?.length ?? 0) > 0).map((d) => d.code).sort()
    expect(implemented).toEqual([
      '1-121C', '12-120C', '13-072R', '16-092C', '18-064C', '18-069C', '18-124C', '19-052C', '20-074C',
      '20-103H', '22-068R', '27-124S', '27-125S', '27-127S',
    ])
    expect(DEFS.flatMap((d) => d.abilities ?? []).map((a) => a.id).sort()).toEqual([
      '1-121C:haste', '12-120C:etb', '13-072R:cost-reduction', '13-072R:summon', '16-092C:dull-all',
      '16-092C:etb', '18-064C:draw', '18-069C:draw',
      '18-124C:etb', '19-052C:pump', '20-074C:draw', '20-103H:summon', '22-068R:damages-opponent',
      '27-124S:attack-phase', '27-124S:etb', '27-125S:damages-forward', '27-125S:damages-opponent',
      '27-127S:etb', '27-127S:opponent-forward-broken',
    ])
  })

  // Spec C3-A6: `ABILITY_CLAUSES` counts PRINTED clauses, implemented or not, so landing a clause must NOT
  // change it. Reducing Miner from 2 to 1 would silently hide the deck-reveal clause it still does not have.
  it('landing six clauses did not change any printed-clause count', () => {
    expect(ABILITY_CLAUSES['20-074C']).toBe(2)   // action landed; the ETB deck reveal is still missing
    expect(ABILITY_CLAUSES['19-052C']).toBe(2)   // pump landed; remove-from-game is still missing
    expect(ABILITY_CLAUSES['1-121C']).toBe(1)
    expect(ABILITY_CLAUSES['18-064C']).toBe(1)
    // And the cards with a clause still missing must still say so.
    for (const code of ['20-074C', '19-052C']) {
      const def = DEFS.find((d) => d.code === code)
      expect((def?.abilityClauses ?? 0) - (def?.abilities?.length ?? 0)).toBe(1)
    }
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
    let s = makeGame()
    let cloud: CardId
    ;[s, cloud] = withField(s, 0, 'forwards', '27-124S')

    const r = pass(s, 0)
    const done = apply(r.state, { type: 'chooseTargets', player: 0, targets: [cloud] })
    const flags = fc(done.state, cloud)?.flags ?? []
    expect([...flags].sort()).toEqual(['cannotBeBroken', 'cannotBeReturnedByOpponent'])
    // Only the first is consulted by anything today (spec C5-4); assert that half for real.
    const broken = apply(done.state, { type: 'concede', player: 1 })
    expect(broken.state.result?.winner).toBe(0)
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
