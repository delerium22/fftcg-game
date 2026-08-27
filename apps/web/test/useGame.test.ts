import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  actingPlayer, apply, applyChooseFirst, createGame, learn, legalCommands, viewFor,
  type Ability, type CardDef, type CardId, type Command, type Event, type FieldCard, type Frame, type GameState, type PlayerId, type PlayerView,
} from '@fftcg/engine'
import { GreedyAgent, type Agent, type SearchDiagnostics, type SearchResult } from '@fftcg/ai'
import { withAbilities } from '@fftcg/cards'
import { CARD_DEFS, DECKS } from '../src/deck.js'
import { buildChoiceSet, describeChoice, preferredChoices, sameCommand } from '../src/game/commands.js'
import { AI, HUMAN, type ChoiceSet, type GameApi, type LogLine } from '../src/game/types.js'
import { Board, clickableChoices, orphanTargetIds } from '../src/ui/Board.js'
import {
  FALLBACK_WARNING, searchSeed,
  type Clock, type SearchTransport, type SearchTransportFactory, type TransportHandlers,
} from '../src/game/search/coordinator.js'
import type { WorkerRequestMessage, WorkerResponseMessage, WorkerSearchRequest } from '../src/game/search/protocol.js'
import {
  AI_STEP_MS, aiHandlers, createAiSearch, describeEvent, eventLines, narrator, stepAi,
  type AiSearch, type AiSink,
} from '../src/game/useGame.js'

const newGame = (seed: number, defs: CardDef[] = CARD_DEFS): GameState => createGame({ seed, decks: DECKS, defs })

/** Spec B-A3, asserted rather than inspected: nothing the AI holds in hand may reach the human's view. */
function assertNoAiHandLeak(state: GameState, view: PlayerView): void {
  for (const id of state.players[AI].hand) {
    expect(view.cards[id]).toBeUndefined()
    expect(view.hand).not.toContain(id)
  }
}

interface PlayedGame { state: GameState; log: LogLine[]; humanMoves: number; commandTypes: Set<Command['type']>; orphanStates: number }

/**
 * Human policies for the sweeps below. Taking the first choice every time is one narrow path through the game;
 * these four together reach decisions that path never makes.
 */
type Policy = (usable: readonly { command: Command }[], step: number) => number

const POLICIES: Policy[] = [
  () => 0,
  (u) => u.length - 1,
  (u, step) => step % u.length,
  (u, step) => (step * 7 + 3) % u.length,
]

/**
 * A policy that STEERS toward one command type. The index policies above are blind, so whether they ever
 * produce a given command is luck — and rung C1 halved game length, which silently cost them `castSummon`.
 * Reachability is what B-A2 actually asserts, so seek the type rather than hoping a rotation lands on it.
 */
/**
 * Steer toward one command type: take it when offered, otherwise take the choice most likely to LEAD to it.
 *
 * The fallback used to be index 0 unconditionally, which made `assignPartyDamage` unreachable by seeking at
 * all: a party split only happens after a BLOCK, and at a `declareBlock` decision there is no
 * `assignPartyDamage` option to steer at — so it fell back to "don't block", which is always index 0. Only
 * the blind policies ever stumbled into it, and every rung that shortened games pushed the first stumble
 * further out, so the seed bound had to be raised again and again. Steering at the precondition instead makes
 * this robust to trajectory changes rather than needing a bigger number each time.
 */
const seeking = (type: Command['type']): Policy => (u) => {
  const i = u.findIndex((c) => c.command.type === type)
  if (i >= 0) return i
  if (type === 'assignPartyDamage') {
    const block = u.findIndex((c) => c.command.type === 'declareBlock' && c.command.blocker !== null)
    if (block >= 0) return block
  }
  return 0
}

/**
 * Play a whole game headlessly: `stepAi` drives the agent, and the "human" always takes the first non-concede
 * choice `buildChoiceSet` offers. This is B-A1 (a game reaches a result), B-A2 (only UI-reachable commands are
 * used) and B-A4 (every applied command was in `legalCommands` at the time) without a browser.
 */
function playFullGame(seed: number, pick: Policy = () => 0, defs: CardDef[] = CARD_DEFS): PlayedGame {
  let state = newGame(seed, defs)
  const agent: Agent = new GreedyAgent({ seed, decks: DECKS, depth: 1 })
  const log: LogLine[] = []
  const commandTypes = new Set<Command['type']>()
  let humanMoves = 0
  let orphanStates = 0
  for (let step = 0; step < 4000 && !state.result; step++) {
    const view = viewFor(state, HUMAN)
    assertNoAiHandLeak(state, view)
    if (actingPlayer(state) === AI) {
      const before = state
      const stepped = stepAi(state, agent)
      expect(stepped.state).not.toBe(before)   // stepAi applies exactly one command
      state = stepped.state
      log.push(...stepped.lines)
      continue
    }
    const legal = legalCommands(state, HUMAN)
    const choices = buildChoiceSet(view, preferredChoices(view, legal))
    // From the BOARD's click surface, not `choices.all`: `all` includes choices keyed to cards no component
    // renders, which is how Billy Bob's Break-Zone target shipped unanswerable while this sweep passed. If the
    // board ever stops drawing a targetable card, the surface shrinks, the game dead-ends, and this fails.
    if (orphanTargetIds(view, choices).length) orphanStates++
    const usable = clickableChoices(view, choices).filter((ch) => ch.command.type !== 'concede')
    const choice = usable[Math.min(usable.length - 1, Math.max(0, pick(usable, step)))]
    expect(choice, `no non-concede choice in ${view.phase}`).toBeDefined()
    // independent of the hook's own guard: the command really is in the legal set at this instant
    expect(legal.some((c) => sameCommand(c, choice!.command))).toBe(true)
    commandTypes.add(choice!.command.type)
    const result = apply(state, choice!.command)
    log.push({ kind: 'human', text: describeChoice(view, choice!.command) })
    // `eventLines`, not a per-event `describeEvent` map, and fed the pre-command agenda queue exactly as the
    // hook feeds it: the C2 cause is threaded across the whole batch, so narrating one event at a time here
    // would have silently tested a different log from the one the browser shows.
    log.push(...eventLines(narrator(view, viewFor(result.state, HUMAN)), result.events, state.resolution.queue))
    state = result.state
    humanMoves++
  }
  return { state, log, humanMoves, commandTypes, orphanStates }
}

describe('stepAi', () => {
  it('applies exactly one command and narrates it', () => {
    const state = newGame(5)
    const agent = new GreedyAgent({ seed: 5, decks: DECKS, depth: 1 })
    const acting = actingPlayer(state)
    if (acting === HUMAN) {
      // seed 5 opened on the human; still fine — stepAi drives whoever is acting
      expect(acting).toBe(HUMAN)
    }
    const { state: next, lines } = stepAi(state, agent)
    expect(next).not.toBe(state)
    expect(lines[0]?.kind).toBe('ai')
    expect(lines[0]?.text.length).toBeGreaterThan(0)
  })

  it('is a no-op once the game is over', () => {
    const over = apply(newGame(5), { type: 'concede', player: HUMAN }).state
    const agent = new GreedyAgent({ seed: 5, decks: DECKS, depth: 1 })
    const stepped = stepAi(over, agent)
    expect(stepped.state).toBe(over)
    expect(stepped.lines).toEqual([])
  })

  it('refuses to apply a command outside the legal set (B-A4)', () => {
    const state = newGame(5)
    const rogue: Agent = { decide: (): Command => ({ type: 'declareAttack', player: actingPlayer(state)!, attackers: [1] }) }
    expect(() => stepAi(state, rogue)).toThrow(/illegal command/)
  })
})

describe('describeEvent', () => {
  const view = viewFor(newGame(1), HUMAN)
  it('surfaces unimplemented abilities as a warning (B-A6)', () => {
    const line = describeEvent(view, { type: 'unimplementedAbility', card: 1, code: '25-001H' })
    expect(line?.kind).toBe('warning')
    expect(line?.text).toContain('25-001H')
  })
  it('surfaces a skipped EX Burst as a warning', () => {
    expect(describeEvent(view, { type: 'exBurstSkipped', player: HUMAN, card: 1 })?.kind).toBe('warning')
  })
  it('drops the events the move line already states', () => {
    expect(describeEvent(view, { type: 'cast', player: HUMAN, card: 1, cardType: 'forward' })).toBeNull()
    expect(describeEvent(view, { type: 'attackDeclared', player: HUMAN, attackers: [1] })).toBeNull()
    expect(describeEvent(view, { type: 'cpGenerated', player: HUMAN, cp: [['fire']] })).toBeNull()
  })
  it('reports the result from the human seat', () => {
    expect(describeEvent(view, { type: 'gameOver', result: { winner: HUMAN, reason: 'damage' } })?.text).toContain('you win')
    expect(describeEvent(view, { type: 'gameOver', result: { winner: AI, reason: 'damage' } })?.text).toContain('the AI wins')
  })
})

describe('a look and a reveal in the log (rung C9)', () => {
  // The narrator redacts against the VIEW, not against the event's `audience` — so one code path serves
  // Reeve's private look and Miner's public reveal, and neither can name a card this seat was not shown.
  // Opening hands are dealt by `chooseFirst`, not by `createGame` — and the added-to-hand line needs one.
  const base = (() => {
    const s = newGame(1)
    const chooser = s.pending?.kind === 'chooseFirst' ? s.pending.player : HUMAN
    return applyChooseFirst(s, chooser, chooser === HUMAN)[0]
  })()
  const nameOf = (v: PlayerView, id: CardId): string => v.defs[v.cards[id]!.code]!.name

  it("names the cards for the human's OWN look", () => {
    const ids = base.players[HUMAN].deck.slice(0, 3)
    const v = viewFor(learn(base, [HUMAN], ids), HUMAN)
    const line = describeEvent(v, { type: 'deckExposed', player: HUMAN, count: 3, audience: 'self', cards: ids })
    expect(line?.text).toContain('You look at the top 3 cards of your deck: ')
    for (const id of ids) expect(line?.text).toContain(nameOf(v, id))
  })

  it("gives the AI's private look as a bare COUNT — the human is told THAT, not WHICH", () => {
    const ids = base.players[AI].deck.slice(0, 3)
    const v = viewFor(learn(base, [AI], ids), HUMAN)
    const line = describeEvent(v, { type: 'deckExposed', player: AI, count: 3, audience: 'self', cards: ids })
    expect(line?.text).toBe('The AI looks at the top 3 cards of its deck')
  })

  it("names every card of the AI's public REVEAL, because the human saw them", () => {
    const ids = base.players[AI].deck.slice(0, 5)
    const v = viewFor(learn(base, [HUMAN, AI], ids), HUMAN)
    const line = describeEvent(v, { type: 'deckExposed', player: AI, count: 5, audience: 'all', cards: ids })
    expect(line?.text).toContain('The AI reveals the top 5 cards of its deck: ')
    for (const id of ids) expect(line?.text).toContain(nameOf(v, id))
  })

  it('says what was added to a hand — by name for the human, unnamed for the AI', () => {
    const v = viewFor(base, HUMAN)
    const mine = base.players[HUMAN].hand[0]!
    expect(describeEvent(v, { type: 'addedToHand', player: HUMAN, card: mine })?.text)
      .toBe(`You add ${nameOf(v, mine)} to your hand`)
    // The AI's hand is not in this view at all, so the line physically cannot name it (spec B-A3).
    const theirs = base.players[AI].hand[0]!
    expect(v.cards[theirs]).toBeUndefined()
    expect(describeEvent(v, { type: 'addedToHand', player: AI, card: theirs })?.text)
      .toBe('The AI adds a card to its hand')
  })
})

describe('a complete headless game (B-A1/B-A2/B-A4)', () => {
  const played = playFullGame(1)

  it('terminates with a result', () => {
    expect(played.state.result).not.toBeNull()
    expect(viewFor(played.state, HUMAN).result).not.toBeNull()
    expect(played.humanMoves).toBeGreaterThan(5)
  })

  it('reaches the setup, main-phase and attack commands from the choice set alone', () => {
    for (const type of ['chooseFirst', 'mulligan', 'pass'] as const) expect(played.commandTypes).toContain(type)
    expect([...played.commandTypes].some((t) => t === 'castCharacter' || t === 'castSummon')).toBe(true)
    expect(played.commandTypes).toContain('declareAttack')
  })

  it('logs the game, ending in a result line, with the vanilla-pool warning visible (B-A6)', () => {
    expect(played.log.at(-1)?.kind).toBe('result')
    expect(played.log.some((l) => l.kind === 'warning')).toBe(true)
    expect(played.log.some((l) => l.kind === 'phase')).toBe(true)
    expect(played.log.some((l) => l.kind === 'ai')).toBe(true)
    expect(played.log.some((l) => l.kind === 'human')).toBe(true)
  })

  it('is deterministic for a fixed seed', () => {
    expect(playFullGame(1).log.map((l) => l.text)).toEqual(played.log.map((l) => l.text))
  })

  it('B-A2: EVERY command type the engine can ask for is reachable from the choice set alone', () => {
    // Taking the first choice every time is one narrow path through the game: the human never blocks (the
    // no-block option is first), never splits party damage, and never fills a hand past the discard limit. So
    // sweep seeds AND several human policies — first choice, last choice, and a couple of deterministic
    // rotations — until every command type has been produced. If one never appears, the UI cannot reach it,
    // which is exactly what B-A2 forbids.
    const need = new Set<Command['type']>([
      'chooseFirst', 'mulligan', 'castCharacter', 'castSummon',
      'declareAttack', 'declareBlock', 'assignPartyDamage', 'discardToHandSize', 'pass',
    ])
    // The seed range has to be generous: abilities roughly HALVE game length (the greedy-vs-random gate went
    // from 23.7 average turns to 12.5), so a short game reaches the discard limit and an affordable Summon far
    // less often than the vanilla pool did. 12 seeds was enough before rung C1 and silently stopped being
    // enough after — the loop exits the moment the set is complete, so a wide bound costs nothing when it is.
    const seen = new Set<Command['type']>()
    // Containment, NOT `seen.size >= need.size`: `commandTypes` also collects command types outside `need`
    // (rung C1's `chooseTargets`/`chooseMode`), so a size comparison declared the sweep finished while
    // `castSummon` was still missing — and every later sweep then exited immediately.
    const done = (): boolean => [...need].every((t) => seen.has(t))
    const sweep = (policies: Policy[], seeds: number): void => {
      for (let seed = 1; seed <= seeds && !done(); seed++) {
        for (const policy of policies) {
          for (const t of playFullGame(seed, policy).commandTypes) seen.add(t)
          if (done()) break
        }
      }
    }
    // 12 → 24. `assignPartyDamage` only ever comes from the BLIND policies: at a `declareBlock` decision there
    // is no `assignPartyDamage` choice for `seeking` to steer at, so it falls back to index 0 — "don't block" —
    // and the party split never happens. C2's clauses shortened games again (Luso and Lightning both remove a
    // Forward), which pushed the first blind party split past seed 12. 20 is the smallest bound that passes.
    sweep(POLICIES, 24)
    // Whatever the blind policies missed, go looking for on purpose.
    // Fewer seeds than the blind sweep on purpose: a steering policy that actually steers should find its
    // target in the first game or two, so a wide bound here only buys slow failures.
    for (const type of need) if (!seen.has(type)) sweep([seeking(type)], 12)
    const missing = [...need].filter((t) => !seen.has(t))
    expect(missing, `unreachable from the UI: ${missing.join(', ')}`).toEqual([])
    // An exhaustive sweep over dozens of full games; it is legitimately the slowest test in the suite.
  }, 30_000)
})

describe('viewFor hides the AI hand throughout (B-A3)', () => {
  it('never exposes an AI hand card id to the human view', () => {
    let state = newGame(2)
    const agent = new GreedyAgent({ seed: 2, decks: DECKS, depth: 1 })
    let checked = 0
    for (let step = 0; step < 2000 && !state.result; step++) {
      const view = viewFor(state, HUMAN)
      assertNoAiHandLeak(state, view)
      const visible = new Set<CardId>(Object.keys(view.cards).map(Number))
      for (const id of state.players[AI].deck) expect(visible.has(id)).toBe(false)
      checked++
      if (actingPlayer(state) === AI) { state = stepAi(state, agent).state; continue }
      const legal = legalCommands(state, HUMAN)
      const next = legal.find((c) => c.type !== 'concede')
      if (!next) break
      state = apply(state, next).state
    }
    expect(checked).toBeGreaterThan(20)
    expect(state.players[AI].hand.length).toBeGreaterThan(0)   // there was something to hide
  })
})

// ---------------------------------------------------------------------------
// Abilities (rung C1)
// ---------------------------------------------------------------------------

/*
 * FIXTURE clauses, not the shipped pool's. The five C1 clauses belong to `packages/cards` and are asserted
 * against their own printed text there; what THIS file has to prove is spec C1-A3 — that a choice an ability
 * raises routes through `legalCommands` and is therefore reachable from the browser's own choice set, with no
 * new decision channel. Forcing the clauses onto three cheap, plentiful cards is what makes that reachable in
 * a bounded seed sweep instead of depending on which real clauses have landed and how often they get cast.
 */
const DULL_TWO: Ability = {
  id: 'ui-fixture:etb-dull', trigger: { kind: 'enterField' },
  text: 'When this Forward enters the field, choose up to 2 other Forwards. Dull them.',
  effects: [{
    kind: 'chooseTargets', min: 0, max: 2,
    from: { zone: 'forwards', controller: 'any', filter: { excludeSource: true } },
    then: [{ kind: 'dull' }],
  }],
}
const THREE_MODES: Ability = {
  id: 'ui-fixture:summon-modes', trigger: { kind: 'summonResolve' },
  text: 'Select up to 2 of the 3 following. Deal 3000 damage to all the Forwards opponent controls. Choose 1 Forward. Dull it. All the Forwards you control gain Haste until the end of the turn.',
  effects: [{
    kind: 'chooseModes', min: 0, max: 2,
    modes: [
      { label: 'Deal 3000 damage to all the Forwards opponent controls.', effects: [{ kind: 'forEach', from: { zone: 'forwards', controller: 'opponent' }, do: [{ kind: 'damage', amount: 3000 }] }] },
      // nests a target choice inside a mode, so the mode → target chain is exercised from the UI too
      { label: 'Choose 1 Forward. Dull it.', effects: [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'any' }, then: [{ kind: 'dull' }] }] },
      { label: 'All the Forwards you control gain Haste until the end of the turn.', effects: [{ kind: 'forEach', from: { zone: 'forwards', controller: 'self' }, do: [{ kind: 'grantKeyword', keyword: 'haste' }] }] },
    ],
  }],
}

/** `abilityClauses` is 2 so one clause stays unimplemented on every fixture card — C1-9's honest log line. */
const FIXTURES: Record<string, Ability> = {
  '12-120C': DULL_TWO,    // Shantotto, cost 2 Forward
  '27-125S': DULL_TWO,    // Luso, cost 1 Forward, 3 copies
  '20-103H': THREE_MODES, // Ramuh, cost 2 Summon, 3 copies — the only exercise of the Summon path
}
const ABILITY_DEFS: CardDef[] = CARD_DEFS.map((d) => {
  const ability = FIXTURES[d.code]
  return ability ? { ...d, abilities: [ability], abilityClauses: 2 } : d
})

describe('describeEvent narrates ability resolution (rung C1)', () => {
  const RAMUH: CardId = 950
  /** `createGame` deals nothing, so the fixture registers the instances the log lines name. */
  const abilityView = (): PlayerView => {
    const v = viewFor(newGame(1, ABILITY_DEFS), HUMAN)
    v.cards[RAMUH] = { id: RAMUH, code: '20-103H', owner: HUMAN }
    return v
  }
  const view = abilityView()
  const anyCard = RAMUH

  it('quotes the printed wording of the clause that triggered', () => {
    const line = describeEvent(view, { type: 'abilityTriggered', player: HUMAN, card: RAMUH, abilityId: THREE_MODES.id })
    expect(line?.kind).toBe('event')
    expect(line?.text).toContain('Ramuh')
    expect(line?.text).toContain(THREE_MODES.text)
  })

  it('reports a clause that found nothing to hit rather than staying silent', () => {
    expect(describeEvent(view, { type: 'abilityNoLegalTarget', card: anyCard, abilityId: DULL_TWO.id })?.text).toContain('no legal target')
  })

  it('narrates what the clause DID to the board', () => {
    const text = (e: Parameters<typeof describeEvent>[1]): string => describeEvent(view, e)?.text ?? ''
    expect(text({ type: 'dulled', card: anyCard })).toContain('is dulled')
    expect(text({ type: 'abilityDamage', source: anyCard, target: anyCard, amount: 3000 })).toContain('3000 damage')
    expect(text({ type: 'powerModified', card: anyCard, amount: 3000 })).toContain('+3000 power until the end of the turn')
    expect(text({ type: 'powerModified', card: anyCard, amount: -1000 })).toContain('-1000 power')
    expect(text({ type: 'keywordGranted', card: anyCard, keyword: 'haste' })).toContain('gains Haste')
    expect(text({ type: 'flagGranted', card: anyCard, flag: 'cannotBeBroken' })).toContain('cannot be broken this turn')
    expect(text({ type: 'brokenByAbility', card: anyCard, source: anyCard })).toContain('is broken by')
    expect(text({ type: 'breakPrevented', card: anyCard, flag: 'cannotBeBroken' })).toContain('survives')
    expect(text({ type: 'returnedToHand', player: HUMAN, card: anyCard })).toContain('returns to your hand')
    expect(text({ type: 'returnedToHand', player: AI, card: anyCard })).toContain("returns to the AI's hand")
  })

  it('still names a card an ability moved from a public zone into a hidden hand', () => {
    // Billy Bob returns a Forward from the Break Zone to its owner's HAND. Narrated from the after-view alone
    // that card has no name left, and the log reads `#51 returns to the AI's hand`.
    const before = viewFor(newGame(1, ABILITY_DEFS), HUMAN)
    const gone: CardId = 51
    before.cards[gone] = { id: gone, code: '27-124S', owner: AI }
    const after = viewFor(newGame(1, ABILITY_DEFS), HUMAN)
    expect(describeEvent(after, { type: 'returnedToHand', player: AI, card: gone })?.text).toContain(`#${gone}`)
    expect(describeEvent(narrator(before, after), { type: 'returnedToHand', player: AI, card: gone })?.text).toContain('Cloud')
  })

  it('collapses a multi-line printed clause onto one log line', () => {
    const multi: Ability = { ...THREE_MODES, id: 'ui-fixture:multiline', text: 'Line one.\n\nLine two.' }
    const v = abilityView()
    v.defs['20-103H'] = { ...(v.defs['20-103H'] as CardDef), abilities: [multi] }
    expect(describeEvent(v, { type: 'abilityTriggered', player: HUMAN, card: RAMUH, abilityId: multi.id })?.text).toContain('Line one. Line two.')
  })

  it('counts the clauses still missing on a card that HAS an implemented one (C1-9)', () => {
    const partial = describeEvent(view, { type: 'unimplementedAbility', card: anyCard, code: '20-103H', clauses: 1 })
    expect(partial?.kind).toBe('warning')
    expect(partial?.text).toContain('1 more ability clause')
    // no `clauses` means nothing at all is implemented — the vanilla-pool line keeps its rung-B wording
    expect(describeEvent(view, { type: 'unimplementedAbility', card: anyCard, code: '25-001H' })?.text).toContain('played as vanilla')
  })
})

describe('a complete headless game WITH abilities (C1-A3)', () => {
  // Sweep seeds and human policies until both new command types have been produced from the choice set alone,
  // exactly as the vanilla B-A2 test does. Every game in the sweep must still reach a result.
  const games: PlayedGame[] = []
  const seen = new Set<Command['type']>()
  for (let seed = 1; seed <= 12; seed++) {
    let done = false
    for (const policy of POLICIES) {
      const played = playFullGame(seed, policy, ABILITY_DEFS)
      games.push(played)
      for (const t of played.commandTypes) seen.add(t)
      if (seen.has('chooseTargets') && seen.has('chooseMode')) { done = true; break }
    }
    if (done) break
  }

  it('drives every game to a result with abilities enabled', () => {
    expect(games.length).toBeGreaterThan(0)
    for (const g of games) expect(g.state.result).not.toBeNull()
  })

  it('reaches chooseTargets AND chooseMode from the choice set alone', () => {
    const missing = (['chooseTargets', 'chooseMode'] as const).filter((t) => !seen.has(t))
    expect(missing, `unreachable from the UI: ${missing.join(', ')}`).toEqual([])
  })

  it('narrates the resolution in the log — what triggered, and what it did', () => {
    const log = games.flatMap((g) => g.log)
    expect(log.some((l) => l.text.includes("ability triggers"))).toBe(true)
    expect(log.some((l) => l.text.includes('is dulled') || l.text.includes('gains Haste') || l.text.includes('damage to'))).toBe(true)
  })

  it('is deterministic for a fixed seed and policy', () => {
    const a = playFullGame(1, POLICIES[0], ABILITY_DEFS).log.map((l) => l.text)
    expect(playFullGame(1, POLICIES[0], ABILITY_DEFS).log.map((l) => l.text)).toEqual(a)
  })
})

/**
 * The same sweep over the REAL C1 clauses. `apps/web/src/deck.ts` reads `data/cards.json` directly — the
 * package index cannot run in a browser — and the ASTs are merged on top of that JSON by `withAbilities`, so
 * this is also the assertion that the shipped pool's own wording survives the trip through the choice set.
 */
describe('the shipped C1 clauses reach the UI (C1-A3)', () => {
  const REAL_DEFS = withAbilities(CARD_DEFS)
  const implemented = REAL_DEFS.filter((d) => d.abilities?.length)

  it('carries at least one hand-written clause per C1 card', () => {
    expect(implemented.length).toBeGreaterThan(0)
  })

  it('C1-A3: a target the board does not draw in a named zone is still clickable (Billy Bob)', () => {
    // Billy Bob's ETB targets your BREAK ZONE, which the board shows only as a count. Its answer therefore lived
    // entirely in `byCard` under an id no Card rendered: the strip offered Concede alone while telling the player
    // to "click a highlighted card", and the human game dead-ended. `min: 1` means there was not even a
    // "choose no targets" button to escape with. The board now draws any such orphan target in its own row.
    let orphanStates = 0
    let sawOrphan = false
    for (let seed = 1; seed <= 24 && !sawOrphan; seed++) {
      for (const policy of POLICIES) {
        const played = playFullGame(seed, policy, REAL_DEFS)
        orphanStates += played.orphanStates
        // Every game still reaches a result: a dead-end would strand the driver instead.
        expect(played.state.result, `seed ${seed} did not finish`).not.toBeNull()
        if (played.orphanStates > 0) { sawOrphan = true; break }
      }
    }
    expect(sawOrphan, 'no game ever raised a target outside the board\'s named zones — the regression is untested').toBe(true)
    expect(orphanStates).toBeGreaterThan(0)
  })

  it('offers those clauses choices the human can click, and drives to a result', () => {
    const seen = new Set<Command['type']>()
    const results: (GameState['result'])[] = []
    for (let seed = 1; seed <= 12; seed++) {
      let done = false
      for (const policy of POLICIES) {
        const played = playFullGame(seed, policy, REAL_DEFS)
        results.push(played.state.result)
        for (const t of played.commandTypes) seen.add(t)
        if (seen.has('chooseTargets') && seen.has('chooseMode')) { done = true; break }
      }
      if (done) break
    }
    for (const r of results) expect(r).not.toBeNull()
    const missing = (['chooseTargets', 'chooseMode'] as const).filter((t) => !seen.has(t))
    expect(missing, `unreachable from the UI: ${missing.join(', ')}`).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Observer triggers (rung C2)
// ---------------------------------------------------------------------------

/*
 * The shipped ASTs, not fixtures: `apps/web/src/deck.ts` already runs `withAbilities` over `cards.json`, so
 * `CARD_DEFS` carries the real C2 clauses and these tests narrate the same clause the browser resolves.
 */
const LIGHTNING = '27-127S', LUSO = '27-125S', PRISHE = '22-068R', SPHENE = '27-126S'
const LIGHTNING_ETB = '27-127S:etb'
const LIGHTNING_WATCH = '27-127S:opponent-forward-broken'
const LUSO_DAMAGES = '27-125S:damages-forward'
const HUGH_YURG = '24-063H'
const HUGH_YURG_WATCH = '24-063H:cheap-forward'
const PRINCESS = '19-052C'

const ids = { lightning: 900, sphene: 902, prishe: 901, luso: 903, victim: 904, aiLightning: 905, mine: 906, arrival: 907, yurg: 908 }

/**
 * A human view with the C2 cast already on the table: a Lightning per seat, the AI Forwards its clause watches
 * sitting BROKEN in the AI's Break Zone — which is where narration has to find them, because they have left the
 * field by the time the trigger resolves — and a Luso with a Forward it can damage.
 */
function c2View(): PlayerView {
  const v = viewFor(newGame(1), HUMAN)
  const put = (id: CardId, code: string, owner: PlayerId): CardId => { v.cards[id] = { id, code, owner }; return id }
  put(ids.lightning, LIGHTNING, HUMAN)
  put(ids.aiLightning, LIGHTNING, AI)
  put(ids.prishe, PRISHE, AI)
  put(ids.sphene, SPHENE, AI)
  put(ids.luso, LUSO, HUMAN)
  put(ids.victim, PRISHE, AI)
  put(ids.mine, PRISHE, HUMAN)
  v.fields[AI].breakZone = [ids.prishe, ids.sphene, ids.victim]
  v.fields[HUMAN].breakZone = [ids.mine]
  return v
}

const texts = (v: PlayerView, events: Event[]): string[] => eventLines(v, events).map((l) => l.text)
const triggered = (player: PlayerId, card: CardId, abilityId: string): Event => ({ type: 'abilityTriggered', player, card, abilityId })

describe('the log says WHY an observer trigger fired (spec C2-5)', () => {
  it('names the card whose break fired it, not just the watcher', () => {
    const out = texts(c2View(), [{ type: 'broken', card: ids.prishe }, triggered(HUMAN, ids.lightning, LIGHTNING_WATCH)])
    expect(out[0]).toBe('Prishe is broken')
    expect(out[1]).toContain("Lightning's ability triggers — the AI's Prishe was broken")
    // the printed wording is still quoted after the cause — rung C1's contract, unchanged
    expect(out[1]).toContain('It gains Haste until the end of the turn.')
  })

  it('C2-A3: two simultaneous breaks give two triggers that name DIFFERENT cards', () => {
    const out = texts(c2View(), [
      { type: 'broken', card: ids.prishe },
      { type: 'broken', card: ids.sphene },
      triggered(HUMAN, ids.lightning, LIGHTNING_WATCH),
      triggered(HUMAN, ids.lightning, LIGHTNING_WATCH),
    ])
    expect(out[2]).toContain("the AI's Prishe was broken")
    expect(out[3]).toContain("the AI's Sphene was broken")
    expect(out[2]).not.toEqual(out[3])
  })

  it("C2-10: \"opponent controls\" is read from the WATCHER's seat, either way round", () => {
    // Both sides lose a Forward in the same batch. The human's Lightning must name the AI's, the AI's must name
    // the human's — a cause resolved against the turn player instead would give both lines the same card.
    const out = texts(c2View(), [
      { type: 'broken', card: ids.mine },
      { type: 'broken', card: ids.prishe },
      triggered(HUMAN, ids.lightning, LIGHTNING_WATCH),
      triggered(AI, ids.aiLightning, LIGHTNING_WATCH),
    ])
    expect(out[2]).toContain("the AI's Prishe was broken")
    expect(out[3]).toContain('your Prishe was broken')
  })

  it('leaves a self-trigger unexplained — there is nothing to explain', () => {
    // Lightning's ETB is about Lightning. Its line keeps rung C1's exact wording, break in the batch or not.
    const out = texts(c2View(), [{ type: 'broken', card: ids.prishe }, triggered(HUMAN, ids.lightning, LIGHTNING_ETB)])
    expect(out[1]?.startsWith('Lightning\'s ability triggers: "EX BURST')).toBe(true)
  })

  it('C8: names the card whose ARRIVAL fired it, from the events alone', () => {
    // The mirror of the break case above, and it needed its own producer. C8 shipped the `enteredField`
    // TriggerCause and its narration but no branch in `causeOf`, so the ordinary line — a trigger raised and
    // started inside the same command, with nothing in the pre-command queue — came out bare. With two
    // watchers the two routes then disagreed: one line carried a cause and the other did not.
    const v = c2View()
    v.cards[ids.arrival] = { id: ids.arrival, code: PRINCESS, owner: HUMAN }
    v.cards[ids.yurg] = { id: ids.yurg, code: HUGH_YURG, owner: HUMAN }
    const out = eventLines(v, [
      { type: 'cast', player: HUMAN, card: ids.arrival, cardType: 'forward' },
      triggered(HUMAN, ids.yurg, HUGH_YURG_WATCH),
    ]).map((l) => l.text)
    expect(out.at(-1)).toContain("Hugh Yurg's ability triggers — your Undead Princess entered the field")
  })

  it("C8: an arrival on the OPPONENT's field does not lend its cause to your watcher", () => {
    // `whose: 'self'` is read from the WATCHER's seat, exactly as the break case is (spec C2-10). A cause
    // taken from the wrong side would be worse than none: it would name a card that did not fire it.
    const v = c2View()
    v.cards[ids.arrival] = { id: ids.arrival, code: PRINCESS, owner: AI }
    v.cards[ids.yurg] = { id: ids.yurg, code: HUGH_YURG, owner: HUMAN }
    const out = eventLines(v, [
      { type: 'cast', player: AI, card: ids.arrival, cardType: 'forward' },
      triggered(HUMAN, ids.yurg, HUGH_YURG_WATCH),
    ]).map((l) => l.text)
    expect(out.at(-1)).not.toContain('entered the field')
  })

  it('recovers a cause from a frame that queued in an EARLIER batch', () => {
    // CR §11.8.6's second occurrence waits in the agenda across the prompt the first one raised, so by the
    // time it starts, the break that fired it is nowhere in this batch's events. The frame still carries its
    // own `triggerEvent` (spec C2-5) — read it rather than let the line go bare.
    const frame: Frame = {
      abilityId: LIGHTNING_WATCH, source: ids.lightning, controller: HUMAN, path: [], chosen: [], modes: [],
      triggerEvent: { kind: 'zoneChange', card: ids.sphene, from: 'field', to: 'breakZone', controller: AI, owner: AI , reason: 'ability'},
    }
    const out = eventLines(c2View(), [triggered(HUMAN, ids.lightning, LIGHTNING_WATCH)], [frame]).map((l) => l.text)
    expect(out[0]).toContain("the AI's Sphene was broken")
  })

  it('falls back to the events when the queue is not what this trigger came from', () => {
    // A queue head belonging to another clause must never lend its subject: the identity check rejects it and
    // the reconstruction takes over.
    const other: Frame = {
      abilityId: LUSO_DAMAGES, source: ids.luso, controller: HUMAN, path: [], chosen: [], modes: [],
      triggerEvent: { kind: 'damage', source: ids.luso, sourceController: HUMAN, target: ids.victim, victim: null, amount: 3000 },
    }
    const out = eventLines(c2View(), [{ type: 'broken', card: ids.prishe }, triggered(HUMAN, ids.lightning, LIGHTNING_WATCH)], [other]).map((l) => l.text)
    expect(out[1]).toContain("the AI's Prishe was broken")
    expect(out[1]).not.toContain('damage')
  })

  it('drops the cause rather than inventing one when nothing matches', () => {
    const bare = triggered(HUMAN, ids.lightning, LIGHTNING_WATCH)
    expect(texts(c2View(), [bare])[0]).toBe(describeEvent(c2View(), bare)?.text)
    expect(texts(c2View(), [bare])[0]).not.toContain('—')
  })
})

describe('Luso has no prompt, so the log is the only evidence (spec C2-A5)', () => {
  const abilityHit = (amount: number): Event => ({ type: 'abilityDamage', source: ids.luso, target: ids.victim, amount })
  const combatHit = (amount: number): Event => ({ type: 'battleDamage', source: ids.luso, target: ids.victim, amount })

  it('narrates the cause of a damage trigger, combat and ability alike (C2-7)', () => {
    const v = c2View()
    for (const hit of [abilityHit(3000), combatHit(3000)]) {
      const out = texts(v, [hit, triggered(HUMAN, ids.luso, LUSO_DAMAGES)])
      expect(out[1]).toContain("Luso's ability triggers — Luso dealt 3000 damage to Prishe")
      expect(out[1]).toContain('When Luso deals damage to a Forward, break it.')
    }
  })

  it('reads differently on lethal and non-lethal damage, which is the whole point', () => {
    // Lethal: §12.4.5 broke it BEFORE the trigger resolved, so the break line comes first and Luso's own
    // `breakCard` is a silent no-op. Non-lethal: the trigger does the breaking, and says so.
    const lethal = texts(c2View(), [abilityHit(7000), { type: 'broken', card: ids.victim }, triggered(HUMAN, ids.luso, LUSO_DAMAGES)])
    const survives = texts(c2View(), [abilityHit(3000), triggered(HUMAN, ids.luso, LUSO_DAMAGES), { type: 'brokenByAbility', card: ids.victim, source: ids.luso }])
    const trigger = (out: string[]): number => out.findIndex((t) => t.includes('ability triggers'))
    expect(trigger(lethal)).toBeGreaterThan(lethal.indexOf('Prishe is broken'))
    expect(lethal.some((t) => t.includes('is broken by Luso'))).toBe(false)
    expect(trigger(survives)).toBeLessThan(survives.findIndex((t) => t.includes('is broken by Luso')))
    expect(lethal).not.toEqual(survives)
  })

  it('C2-8: picks its OWN hit out of a party, not whichever landed first', () => {
    // A party's damage is simultaneous, and Luso may be second in field order. Pairing on position alone would
    // put the other attacker's victim in Luso's line — the array-position bug C2-8 names, wearing a log line.
    const out = texts(c2View(), [
      { type: 'battleDamage', source: ids.mine, target: ids.sphene, amount: 5000 },
      { type: 'battleDamage', source: ids.luso, target: ids.victim, amount: 3000 },
      triggered(HUMAN, ids.luso, LUSO_DAMAGES),
    ])
    expect(out[2]).toContain('Luso dealt 3000 damage to Prishe')
    expect(out[2]).not.toContain('Sphene')
  })

  it("does not steal a break trigger's cause, and is not stolen from", () => {
    // Luso's damage trigger and Lightning's break trigger are queued from the SAME batch. Each has to take the
    // candidate of its own KIND: pairing on position alone would cross them.
    const out = texts(c2View(), [
      abilityHit(7000), { type: 'broken', card: ids.victim },
      triggered(HUMAN, ids.luso, LUSO_DAMAGES),
      triggered(HUMAN, ids.lightning, LIGHTNING_WATCH),
    ])
    expect(out.find((t) => t.startsWith("Luso's"))).toContain('Luso dealt 7000 damage to Prishe')
    expect(out.find((t) => t.startsWith("Lightning's"))).toContain("the AI's Prishe was broken")
  })
})

describe('the C2 cascade reaches a real game (C2-A8/C2-A13)', () => {
  // Sweep seeds and policies until the SHIPPED observer clauses fire in games that all reach a result.
  //
  // Seek COVERAGE, not a count. This used to stop at `caused.length >= 2`, which two Lightning triggers
  // satisfy just as well as one of each — it only ever passed because the first seeds happened to produce
  // both. Rung C3 gave the driver six new commands, the trajectories moved, and it stopped on two Lightnings
  // with no Luso. The bug was in the stopping rule, not in the clauses.
  const CLAUSES: readonly (readonly [string, (t: string) => boolean])[] = [
    ['Luso', (t) => t.includes("Luso's ability triggers — Luso dealt")],
    ['Lightning', (t) => t.includes("Lightning's ability triggers — ") && t.includes('was broken')],
  ]
  const games: PlayedGame[] = []
  const caused: string[] = []
  const seen = new Set<string>()
  for (let seed = 1; seed <= 40 && seen.size < CLAUSES.length; seed++) {
    for (const policy of POLICIES) {
      const played = playFullGame(seed, policy)
      games.push(played)
      for (const l of played.log) {
        if (l.text.includes('ability triggers — ')) caused.push(l.text)
        for (const [name, matches] of CLAUSES) if (matches(l.text)) seen.add(name)
      }
      if (seen.size >= CLAUSES.length) break
    }
  }

  it('drives every game to a result with the C2 clauses live', () => {
    expect(games.length).toBeGreaterThan(0)
    for (const g of games) expect(g.state.result, 'a C2 clause dead-ended the driver').not.toBeNull()
  })

  it('narrates an observer trigger with its cause in a real game log', () => {
    expect(caused.length, 'no shipped C2 clause ever triggered — the narration is untested').toBeGreaterThan(0)
    // cause first, printed contract after: both halves, on every such line.
    for (const line of caused) expect(line).toMatch(/ability triggers — .+: ".+"/)
  })

  it('shows both shipped C2 clauses firing across the sweep', () => {
    expect([...seen].sort()).toEqual(['Lightning', 'Luso'])
  })
})

// ---------------------------------------------------------------------------
// Every target stays clickable (spec B-A4 / C2-A13)
// ---------------------------------------------------------------------------

const fieldCard = (id: CardId): FieldCard =>
  ({ id, status: 'active', damage: 0, enteredTurn: 1, attackedThisTurn: false, granted: [], powerBonus: 0, flags: [] })

/** What the board would really hand a mouse: its markup, and the buttons in it. */
function renderBoard(view: PlayerView, choices: ChoiceSet): string {
  const game: GameApi = { view, choices, log: [], aiThinking: false, choose: () => undefined, restart: () => undefined }
  return renderToStaticMarkup(createElement(Board, { game }))
}

describe('a target the board draws in no named zone is still a real button', () => {
  /*
   * C1 dead-ended on exactly this: Billy Bob's Break-Zone target lived in `byCard` under an id no component
   * rendered, so the strip offered Concede alone while telling the player to click a highlighted card. C2-9
   * widens the class — "Character" is Forward, Backup OR Monster, and both Prishe's and Luso's retrieval reach
   * for one — so a BACKUP in the Break Zone is the case to prove, not another Forward.
   */
  const REEVE = '20-105C'
  const backup: CardId = 910, onField: CardId = 911
  const setup = (): { v: PlayerView; choices: ChoiceSet } => {
    const v = viewFor(newGame(1), HUMAN)
    v.cards[backup] = { id: backup, code: REEVE, owner: HUMAN }
    v.cards[onField] = { id: onField, code: PRISHE, owner: HUMAN }
    v.fields[HUMAN].breakZone = [backup]
    v.fields[HUMAN].forwards = [fieldCard(onField)]
    v.pending = { kind: 'chooseTargets', player: HUMAN, min: 1, max: 1, candidates: [backup] }
    const choices = buildChoiceSet(v, [
      { type: 'chooseTargets', player: HUMAN, targets: [backup] },
      { type: 'concede', player: HUMAN },
    ])
    return { v, choices }
  }

  it('is an orphan target, and every byCard key survives into the clickable set', () => {
    const { v, choices } = setup()
    expect(orphanTargetIds(v, choices)).toEqual([backup])
    const clickable = new Set(clickableChoices(v, choices).map((c) => c.card))
    for (const id of choices.byCard.keys()) expect(clickable.has(id)).toBe(true)
  })

  it('renders as a <button> the human can actually press', () => {
    const { v, choices } = setup()
    const html = renderBoard(v, choices)
    expect(html).toContain('Choose a card')   // the orphan row exists at all
    expect(html).toMatch(new RegExp(`<button[^>]*aria-label="${v.defs[REEVE]!.name}[^"]*"`))
    // and the strip says so: this is the exact state that offered Concede alone in C1
    expect(html).toContain('click a highlighted card')
    // and it is not merely present: the Forward on the field is no candidate, so it stays a plain <div>
    expect(html).toMatch(new RegExp(`<div[^>]*aria-label="${v.defs[PRISHE]!.name}[^"]*"`))
  })

  it('leaves no clickable choice off the board across a real game', () => {
    // The sweep's guard asserted DIRECTLY, rather than inferred from the driver not getting stuck.
    let state = newGame(3)
    const agent = new GreedyAgent({ seed: 3, decks: DECKS, depth: 1 })
    let checked = 0
    for (let step = 0; step < 2000 && !state.result; step++) {
      if (actingPlayer(state) === AI) { state = stepAi(state, agent).state; continue }
      const view = viewFor(state, HUMAN)
      const choices = buildChoiceSet(view, preferredChoices(view, legalCommands(state, HUMAN)))
      const usable = clickableChoices(view, choices)
      const clickable = new Set(usable.map((c) => c.card))
      for (const id of choices.byCard.keys()) expect(clickable.has(id), `card ${id} is targetable but unreachable`).toBe(true)
      checked++
      const next = usable.find((c) => c.command.type !== 'concede')
      if (!next) break
      state = apply(state, next.command).state
    }
    expect(checked).toBeGreaterThan(20)
  })
})

// -----------------------------------------------------------------------------------------------------------
// Rung D2: the AI half of the hook. There is no DOM in this suite, so what is driven here is the React-FREE
// seam the effect installs — `createAiSearch` + `aiHandlers` — which is the whole of the hook's AI behaviour
// minus React's own scheduling. The races behind it are asserted against the coordinator itself in
// search-coordinator.test.ts; what these cover is what the HOOK adds: narration, the legality re-check, the
// seed reset a restart performs, and the fallback being visible in the log a player is actually reading.
// -----------------------------------------------------------------------------------------------------------

const EMPTY_DIAGNOSTICS: SearchDiagnostics = {
  determinisations: 1, treeApplies: 1, rolloutApplies: 1, evaluations: 1, nodes: 1, maxCommandDepth: 1, rootChildren: [],
}

/** Fast-forward to a position the AI actually owns — the only kind the hook ever asks about. */
function aiToAct(seed: number): GameState {
  let state = newGame(seed)
  const agent = new GreedyAgent({ seed, decks: DECKS, depth: 1 })
  for (let i = 0; i < 400; i++) {
    const p = actingPlayer(state)
    if (p === null) break
    if (p === AI) return state
    state = apply(state, agent.decide(viewFor(state, p), legalCommands(state, p))).state
  }
  throw new Error(`seed ${seed} never reached an AI decision`)
}

class TestClock implements Clock {
  private t = 0
  private seq = 0
  private readonly timers = new Map<number, { at: number; fn: () => void }>()

  now(): number { return this.t }

  after(ms: number, fn: () => void): () => void {
    const id = ++this.seq
    this.timers.set(id, { at: this.t + ms, fn })
    return () => { this.timers.delete(id) }
  }

  advance(ms: number): void {
    const target = this.t + ms
    for (;;) {
      let next: { id: number; at: number; fn: () => void } | null = null
      for (const [id, timer] of this.timers) if (timer.at <= target && (!next || timer.at < next.at)) next = { id, ...timer }
      if (!next) break
      this.timers.delete(next.id)
      this.t = next.at
      next.fn()
    }
    this.t = target
  }
}

class TestTransport implements SearchTransport {
  readonly sent: WorkerRequestMessage[] = []
  terminations = 0
  constructor(readonly handlers: TransportHandlers) {}

  post(message: WorkerRequestMessage): void { this.sent.push(message) }
  terminate(): void { this.terminations++ }

  get searches(): WorkerSearchRequest[] {
    return this.sent.filter((m): m is WorkerSearchRequest => m.type === 'search')
  }
}

/** A worker reply carrying a command that really is legal there, so nothing downstream of the wire is faked. */
function resultMessage(state: GameState, requestId: number, command?: Command): WorkerResponseMessage {
  const chosen = command ?? legalCommands(state, AI)[0]
  if (!chosen) throw new Error('no legal AI command')
  const result: SearchResult = { command: chosen, diagnostics: EMPTY_DIAGNOSTICS }
  return { type: 'result', requestId, result }
}

interface AiHarness {
  readonly clock: TestClock
  readonly search: AiSearch
  readonly transports: TestTransport[]
  readonly lines: LogLine[]
  readonly commits: GameState[]
  readonly handlers: ReturnType<typeof aiHandlers>
  state(): GameState
  setState(next: GameState): void
  /** The engine narrates `unimplementedAbility` as a warning too, so the fallback line is found by its text. */
  fallbacks(): LogLine[]
}

function aiHarness(seed: number, factory?: SearchTransportFactory): AiHarness {
  const clock = new TestClock()
  const transports: TestTransport[] = []
  const lines: LogLine[] = []
  const commits: GameState[] = []
  let current = aiToAct(seed)
  const sink: AiSink = {
    commit: (next, produced) => { current = next; commits.push(next); lines.push(...produced) },
    log: (line) => { lines.push(line) },
  }
  const createTransport: SearchTransportFactory = factory ?? ((h) => {
    const t = new TestTransport(h)
    transports.push(t)
    return t
  })
  return {
    clock, transports, lines, commits,
    handlers: aiHandlers(sink),
    search: createAiSearch(() => current, seed, { clock, createTransport }),
    state: () => current,
    setState: (next) => { current = next },
    fallbacks: () => lines.filter((l) => l.kind === 'warning' && l.text.includes(FALLBACK_WARNING)),
  }
}

describe('the hook drives the search worker (rung D2)', () => {
  it('narrates and commits a delivered result on the pacing deadline (D2-5)', () => {
    const h = aiHarness(11)
    const before = h.state()
    h.search.request(before, h.handlers)
    const transport = h.transports[0]!
    h.clock.advance(50)
    transport.handlers.message(resultMessage(before, transport.searches[0]!.requestId))
    expect(h.commits).toHaveLength(0)   // the search was fast; the board is still showing 600 ms of thinking
    h.clock.advance(AI_STEP_MS - 50)
    expect(h.commits).toHaveLength(1)
    expect(h.state()).not.toBe(before)
    expect(h.lines[0]?.kind).toBe('ai')
    expect(h.lines[0]?.text.length).toBeGreaterThan(0)
  })

  it('surfaces the fallback as exactly one warning and keeps playing (D2-6)', () => {
    const h = aiHarness(11, () => { throw new Error('this browser does not support Web Workers') })
    h.search.request(h.state(), h.handlers)
    h.clock.advance(AI_STEP_MS)
    expect(h.fallbacks()).toHaveLength(1)
    expect(h.fallbacks()[0]!.text).toContain('this browser does not support Web Workers')
    expect(h.commits).toHaveLength(1)   // a warning, not a stop: Greedy played on the same deadline
    for (let i = 0; i < 6 && actingPlayer(h.state()) === AI; i++) {
      h.search.request(h.state(), h.handlers)
      h.clock.advance(AI_STEP_MS)
    }
    expect(h.commits.length).toBeGreaterThan(1)
    expect(h.fallbacks()).toHaveLength(1)
  })

  it('does not apply an in-flight result once the game has restarted (D2-4)', () => {
    const h = aiHarness(11)
    const stale = h.state()
    h.search.request(stale, h.handlers)
    const transport = h.transports[0]!
    const inFlight = transport.searches[0]!.requestId
    h.search.restart(99)
    h.setState(aiToAct(99))
    transport.handlers.message(resultMessage(stale, inFlight))
    h.clock.advance(10 * AI_STEP_MS)
    expect(h.commits).toHaveLength(0)
    expect(h.lines).toHaveLength(0)
    expect(transport.terminations).toBe(1)
  })

  it('restarts the decision index the search seed comes from (D2-3)', () => {
    const h = aiHarness(11)
    const first = h.state()
    h.search.request(first, h.handlers)
    const transport = h.transports[0]!
    transport.handlers.message(resultMessage(first, transport.searches[0]!.requestId))
    h.clock.advance(AI_STEP_MS)
    expect(h.commits).toHaveLength(1)
    h.search.request(h.state(), h.handlers)
    expect(transport.searches[0]!.seed).toBe(searchSeed(11, 0))
    expect(transport.searches[1]!.seed).toBe(searchSeed(11, 1))
    h.search.restart(99)
    h.setState(aiToAct(99))
    h.search.request(h.state(), h.handlers)
    expect(h.transports[1]!.searches[0]!.seed).toBe(searchSeed(99, 0))
  })

  it('refuses a command that is not legal in the state it was chosen for (B-A4)', () => {
    const h = aiHarness(11)
    const before = h.state()
    h.search.request(before, h.handlers)
    const transport = h.transports[0]!
    transport.handlers.message(resultMessage(before, transport.searches[0]!.requestId, { type: 'concede', player: HUMAN }))
    h.clock.advance(AI_STEP_MS)
    // B-A4's guarantee is that the ILLEGAL command never commits — and it does not: the concede the worker
    // sent would have ended the game, and the game is not over.
    expect(h.state().result).toBeNull()
    expect(h.lines.some((l) => l.kind === 'warning' && l.text.includes('not legal'))).toBe(true)
    // But refusing it is only half the job. Before, refusal ended the turn: no move was scheduled and the
    // state never changed, so the state-keyed effect never re-requested and the AI sat there forever. The
    // refusal must now be recovered from, so the game still moves.
    expect(h.commits).toHaveLength(1)
    expect(h.state()).not.toBe(before)
  })

  it('drops the outstanding request when a human commit lands mid-search (D2-4)', () => {
    const h = aiHarness(11)
    const before = h.state()
    h.search.request(before, h.handlers)
    const transport = h.transports[0]!
    // What `choose` does: invalidate, then apply. Concede is legal off-turn, so this really can happen.
    h.search.invalidate()
    h.setState(apply(before, { type: 'concede', player: HUMAN }).state)
    transport.handlers.message(resultMessage(before, transport.searches[0]!.requestId))
    h.clock.advance(10 * AI_STEP_MS)
    expect(h.commits).toHaveLength(0)
    expect(h.lines).toHaveLength(0)
  })
})
